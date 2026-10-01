import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import Stripe from 'stripe';

import { readStripeConnection } from '../dist/apps/funding-api/src/admin-cockpit/stripe-connection.js';

test('Stripe connectivity uses one authenticated read, rejects errors and times out without retries', async (t) => {
  let mode = 'success';
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    assert.equal(
      request.headers.authorization,
      'Bearer sk_test_connection_fixture'
    );
    if (mode === 'timeout') return;
    response.setHeader('Content-Type', 'application/json');
    if (mode === 'success') {
      response.end(
        JSON.stringify({
          object: 'account',
          id: 'acct_connection_fixture',
          email: 'private@example.invalid'
        })
      );
    } else if (mode === 'malformed') {
      response.end(JSON.stringify({ object: 'list', data: [] }));
    } else {
      response.statusCode = Number(mode);
      response.end(
        JSON.stringify({
          error: { type: 'api_error', message: 'Fixture failure' }
        })
      );
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const stripe = new Stripe('sk_test_connection_fixture', {
    host: '127.0.0.1',
    port: server.address().port,
    protocol: 'http',
    maxNetworkRetries: 2
  });
  assert.equal(await readStripeConnection(stripe), undefined);
  for (const failure of ['401', '403', '500', 'malformed', 'timeout']) {
    mode = failure;
    const before = requests.length;
    await assert.rejects(readStripeConnection(stripe));
    assert.equal(requests.length - before, 1, failure + ' is not retried');
  }
  assert.ok(
    requests.every(
      (request) => request.method === 'GET' && request.path === '/v1/account'
    )
  );
});
