import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';
import Stripe from 'stripe';

import { createStripeWebhookHttpHandler } from '../dist/apps/funding-api/src/stripe-webhook.http.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';
import { processStripeWebhook } from '../dist/apps/funding-api/src/stripe-webhook.service.js';

const stripe = new Stripe('sk_test_synthetic_http_fixture', {
  host: '127.0.0.1',
  port: 1,
  protocol: 'http',
  maxNetworkRetries: 0
});
const secret = 'whsec_synthetic_http_fixture';
const raw =
  '{\n  "id": "evt_synthetic_http", "type": "synthetic.unknown",\n "data": {"object": {"description": "échantillon"}}\n}';
const signature = stripe.webhooks.generateTestHeaderString({
  payload: raw,
  secret
});
const fixture = ({
  isConfigured = true,
  process = async () => ({ statusCode: 200, payload: { received: true } })
} = {}) => {
  const calls = [];
  const handler = createStripeWebhookHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    isConfigured,
    readBody: async (request, limit) => {
      calls.push({ name: 'body', value: limit });
      return readBody(request, limit);
    },
    writeJson: (_request, response, status, payload) => {
      calls.push({ name: 'response', value: status });
      Object.assign(response, { status, payload });
    },
    processStripeWebhook: async (...args) => {
      calls.push({ name: 'process', value: args });
      return process(...args);
    }
  });
  const invoke = async (options = {}) => {
    const { body = raw, method = 'POST', url = '/stripe/webhook' } = options;
    const header = Object.hasOwn(options, 'header')
      ? options.header
      : signature;
    const bytes = Buffer.from(body);
    const request = Readable.from([bytes.subarray(0, 23), bytes.subarray(23)]);
    Object.assign(request, {
      method,
      url,
      headers: header === undefined ? {} : { 'stripe-signature': header }
    });
    const response = {};
    return { handled: await handler(request, response), ...response };
  };
  return { calls, invoke };
};
const service =
  (pool = null) =>
  (body, header) =>
    processStripeWebhook(body, header, {
      stripe,
      webhookSecret: secret,
      pool,
      publicBaseUrl: 'https://funding.example.test',
      projectId: 'synthetic-project'
    });

test('Webhook POST aliases dispatch only their routes and keep unmatched bodies unread', async () => {
  for (const url of ['/stripe/webhook?x=1', '/api/stripe/webhook']) {
    const f = fixture();
    assert.equal((await f.invoke({ url })).status, 200);
    assert.equal(f.calls.filter(({ name }) => name === 'process').length, 1);
  }
  for (const options of [
    { method: 'GET' },
    { method: 'PUT' },
    { url: '/stripe/webhook/extra' },
    { url: '/checkout-sessions' }
  ]) {
    const f = fixture();
    assert.deepEqual(await f.invoke(options), { handled: false });
    assert.deepEqual(f.calls, []);
  }
});

test('Missing configuration and non-string signature reject before body read or service effects', async () => {
  const missing = fixture({ isConfigured: false });
  assert.deepEqual(await missing.invoke(), {
    handled: true,
    status: 503,
    payload: {
      error:
        'Stripe webhook is not configured. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.'
    }
  });
  assert.deepEqual(
    missing.calls.map(({ name }) => name),
    ['response']
  );
  for (const header of [
    undefined,
    null,
    ['synthetic-signature', 'another-signature']
  ]) {
    const f = fixture();
    assert.deepEqual(await f.invoke({ header }), {
      handled: true,
      status: 400,
      payload: { error: 'Missing Stripe-Signature header' }
    });
    assert.deepEqual(
      f.calls.map(({ name }) => name),
      ['response']
    );
  }
});

test('Webhook body limit returns 413 without processing any part of the payload', async () => {
  const f = fixture();
  assert.deepEqual(await f.invoke({ body: 'x'.repeat(256 * 1024 + 1) }), {
    handled: true,
    status: 413,
    payload: { error: 'Webhook request body is too large.' }
  });
  assert.deepEqual(
    f.calls.map(({ name }) => name),
    ['body', 'response']
  );
});

test('Signed raw JSON reaches the signature service unchanged; reformatting fails before database access', async () => {
  let databaseCalls = 0;
  const pool = {
    connect: async () => {
      databaseCalls++;
      throw new Error('Synthetic database must not be read');
    }
  };
  const valid = fixture({ process: service() });
  const result = await valid.invoke();
  assert.equal(result.status, 200);
  assert.equal(result.payload.ignored, true);
  assert.deepEqual(valid.calls[1].value, [raw, signature]);
  const invalid = fixture({ process: service(pool) });
  assert.deepEqual(
    await invalid.invoke({ body: JSON.stringify(JSON.parse(raw)) }),
    {
      handled: true,
      status: 400,
      payload: { error: 'Invalid Stripe webhook signature' }
    }
  );
  assert.equal(databaseCalls, 0);
});

test('Webhook preserves busy, duplicate and retry results without acknowledging a failure as success', async () => {
  const responses = [
    {
      statusCode: 503,
      payload: {
        received: false,
        error: 'Webhook event is already processing. Retry this delivery.'
      }
    },
    {
      statusCode: 500,
      payload: {
        received: false,
        error: 'Webhook event could not be processed.'
      }
    },
    { statusCode: 200, payload: { received: true, type: 'synthetic.unknown' } },
    {
      statusCode: 200,
      payload: { received: true, duplicate: true, type: 'synthetic.unknown' }
    }
  ];
  let index = 0;
  const f = fixture({ process: async () => responses[index++] });
  for (const response of responses) {
    assert.deepEqual(await f.invoke(), {
      handled: true,
      status: response.statusCode,
      payload: response.payload
    });
  }
  assert.equal(f.calls.filter(({ name }) => name === 'process').length, 4);
});

test('Signed webhook database failures can recover and repeated deliveries remain delegated to durable deduplication', async () => {
  let outage = true;
  let completed = false;
  const client = new EventEmitter();
  client.release = () => {};
  client.query = async (sql) => {
    if (sql.includes('pg_try_advisory_lock'))
      return { rows: [{ locked: true }] };
    if (sql.includes('pg_advisory_unlock'))
      return { rows: [{ unlocked: true }] };
    if (sql.includes('INSERT INTO stripe_events'))
      return { rowCount: completed ? 0 : 1, rows: [] };
    if (sql.includes("processing_status = 'processed'")) completed = true;
    return { rows: [], rowCount: 1 };
  };
  const f = fixture({
    process: service({
      connect: async () => {
        if (outage) throw new Error('Synthetic temporary outage');
        return client;
      }
    })
  });
  assert.equal((await f.invoke()).status, 500);
  outage = false;
  const recovered = await f.invoke();
  assert.equal(recovered.status, 200);
  assert.equal(recovered.payload.ignored, true);
  assert.equal(completed, true);
  const repeated = await f.invoke();
  assert.equal(repeated.status, 200);
  assert.equal(repeated.payload.duplicate, true);
  assert.equal(client.listenerCount('error'), 0);
});
