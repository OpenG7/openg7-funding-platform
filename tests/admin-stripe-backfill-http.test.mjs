import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminStripeBackfillHttpHandler } from '../dist/apps/funding-api/src/admin-stripe-backfill.http.js';
import { AdminStripeBackfillError } from '../dist/apps/funding-api/src/admin-stripe-backfill.service.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const origin = 'https://funding.example.test';
const id = '00000000-0000-4000-8000-000000000001';
const actor = 'synthetic-owner';
const scope = { from: '2026-09-01', to: '2026-09-02', limit: 10 };
const fixture = ({ denied, source = 'session', unavailable, failure } = {}) => {
  const calls = [];
  const run = { id, status: 'preview', mode: 'test', scope };
  const writeJson = (_request, response, status, payload) => {
    calls.push(['json', status]);
    Object.assign(response, { status, payload });
  };
  const operation =
    (name) =>
    async (...args) => {
      calls.push([name, ...args]);
      if (failure) throw failure;
      return run;
    };
  const handler = createAdminStripeBackfillHttpHandler({
    publicBaseOrigin: origin,
    allowedOrigins: ['https://admin.example.test'],
    ensureAdminAccess: (request, response) => {
      calls.push(['access']);
      if (!denied) return true;
      writeJson(request, response, denied, { error: 'Access rejected.' });
      return false;
    },
    resolveAdminAuthorization: () => {
      calls.push(['authorization']);
      return source ? { source } : null;
    },
    getAdminAuditActor: () => {
      calls.push(['actor']);
      return actor;
    },
    readBody: (request, limit) => {
      calls.push(['body', limit]);
      return readBody(request, limit);
    },
    writeJson,
    adminStripeBackfill: unavailable
      ? null
      : {
          read: operation('read'),
          preview: operation('preview'),
          execute: operation('execute')
        },
    AdminStripeBackfillError
  });
  return {
    calls,
    run,
    async request(
      url = '/admin/stripe-backfill',
      {
        method = 'POST',
        input = { action: 'preview', scope },
        body = JSON.stringify(input),
        contentType = 'application/json',
        requestOrigin
      } = {}
    ) {
      const request = Object.assign(Readable.from([body]), {
        method,
        url,
        headers: {
          ...(contentType ? { 'content-type': contentType } : {}),
          ...(requestOrigin ? { origin: requestOrigin } : {})
        }
      });
      const response = {
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        }
      };
      const handled = await handler(request, response);
      return { handled, ...response };
    }
  };
};

test('backfill aliases forward bounded scope, durable id, confirmation and actor unchanged', async () => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    const f = fixture();
    const read = await f.request(`${prefix}stripe-backfill?id=${id}`, {
      method: 'GET'
    });
    assert.deepEqual(read.payload, { run: f.run });
    assert.deepEqual(
      f.calls.find(([name]) => name === 'read'),
      ['read', id, actor]
    );
    const preview = await f.request(`${prefix}stripe-backfill`, {
      requestOrigin: origin
    });
    assert.equal(preview.status, 200);
    assert.deepEqual(
      f.calls.find(([name]) => name === 'preview'),
      ['preview', scope, actor]
    );
    const input = { action: 'execute', id, confirmation: `test:${id}` };
    for (let repeat = 0; repeat < 2; repeat++) {
      const executed = await f.request(`${prefix}stripe-backfill`, { input });
      assert.deepEqual(executed.payload, { run: f.run });
      assert.equal(executed.headers['Cache-Control'], 'private, no-store');
    }
    assert.deepEqual(
      f.calls.filter(([name]) => name === 'execute'),
      Array(2).fill(['execute', id, `test:${id}`, actor])
    );
    assert.deepEqual(
      f.calls.filter(([name]) => name === 'body').map(([, limit]) => limit),
      [4096, 4096, 4096]
    );
  }
});

test('backfill refuses access, local development, unavailable service and invalid origin before reading', async () => {
  for (const [options, request, status, code] of [
    [{ denied: 401 }, {}, 401, undefined],
    [{ denied: 403 }, {}, 403, undefined],
    [{ denied: 503 }, {}, 503, undefined],
    [{ source: 'local-dev' }, {}, 401, 'ADMIN_SESSION_REQUIRED'],
    [{ unavailable: true }, {}, 503, 'BACKFILL_UNAVAILABLE'],
    [
      {},
      { requestOrigin: 'https://other.example.test' },
      403,
      'ORIGIN_FORBIDDEN'
    ],
    [{}, { contentType: 'APPLICATION/JSON' }, 415, 'JSON_REQUIRED'],
    [{}, { contentType: null }, 415, 'JSON_REQUIRED']
  ]) {
    const f = fixture(options);
    const result = await f.request(undefined, { ...request, body: '{invalid' });
    assert.equal(result.status, status);
    assert.equal(result.payload.code, code);
    assert.equal(
      f.calls.some(([name]) => name === 'body'),
      false
    );
  }
  assert.equal(
    (await fixture({ source: 'static-token' }).request()).status,
    200
  );
});

test('backfill validates JSON envelope and body limit before service effects', async () => {
  for (const body of [
    '{',
    'null',
    '[]',
    '1',
    JSON.stringify({ action: 'preview', scope, extra: true }),
    JSON.stringify({ action: 'other' }),
    ' '.repeat(4097)
  ]) {
    const f = fixture();
    const result = await f.request(undefined, { body });
    assert.equal(result.status, 400);
    assert.deepEqual(result.payload, { code: 'INVALID_REQUEST' });
    assert.equal(
      f.calls.some(([name]) => ['read', 'preview', 'execute'].includes(name)),
      false
    );
  }
});

test('backfill maps conflicts, interrupted reads and provider failures without leaking details', async () => {
  for (const [failure, status, code] of [
    [new AdminStripeBackfillError(409, 'BACKFILL_BUSY'), 409, 'BACKFILL_BUSY'],
    [
      new AdminStripeBackfillError(400, 'CONFIRMATION_REQUIRED'),
      400,
      'CONFIRMATION_REQUIRED'
    ],
    [
      new AdminStripeBackfillError(404, 'BACKFILL_NOT_FOUND'),
      404,
      'BACKFILL_NOT_FOUND'
    ],
    [
      new Error('synthetic provider private detail'),
      503,
      'BACKFILL_UNAVAILABLE'
    ]
  ]) {
    for (const method of ['GET', 'POST']) {
      const result = await fixture({ failure }).request(undefined, { method });
      assert.equal(result.status, status);
      assert.deepEqual(result.payload, { code });
    }
  }
});

test('backfill owns all methods only on its exact routes', async () => {
  const f = fixture();
  assert.equal(
    (await f.request('/admin/stripe-backfill/extra')).handled,
    false
  );
  assert.equal(f.calls.length, 0);
  const result = await f.request(undefined, { method: 'DELETE' });
  assert.equal(result.status, 405);
  assert.deepEqual(result.payload, { code: 'METHOD_NOT_ALLOWED' });
  assert.deepEqual(
    f.calls.map(([name]) => name),
    ['access', 'authorization', 'actor', 'json']
  );
});
