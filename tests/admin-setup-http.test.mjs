import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminSetupHttpHandler } from '../dist/apps/funding-api/src/admin-setup.http.js';

const fixture = ({ denied, failure } = {}) => {
  const calls = [];
  const setup = { checkedAt: '2026-10-03T12:00:00Z', services: [] };
  const writeJson = (_request, response, status, payload) => {
    calls.push(['json', status]);
    Object.assign(response, { status, payload });
  };
  const handler = createAdminSetupHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    ensureAdminAuthorization: (request, response) => {
      calls.push(['authorization']);
      if (!denied) return true;
      writeJson(request, response, denied, { error: 'Access rejected.' });
      return false;
    },
    writeJson,
    buildAdminSetupStatus: async () => {
      calls.push(['setup']);
      if (failure) throw failure;
      return setup;
    },
    reportFailure: (...args) => calls.push(['report', ...args])
  });
  return {
    calls,
    setup,
    async request(url = '/admin/setup-status', method = 'GET') {
      const response = {
        headers: {},
        setHeader(name, value) {
          this.headers[name] = value;
        }
      };
      return {
        handled: await handler({ url, method, headers: {} }, response),
        ...response
      };
    }
  };
};

test('setup aliases use authorization alone and preserve private cache header', async () => {
  for (const url of [
    '/admin/setup-status',
    '/api/admin/setup-status?unused=true'
  ]) {
    const f = fixture();
    const result = await f.request(url);
    assert.equal(result.handled, true);
    assert.equal(result.status, 200);
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
    assert.deepEqual(result.payload, f.setup);
    assert.deepEqual(f.calls, [['authorization'], ['setup'], ['json', 200]]);
  }
});

test('setup missing, expired, forbidden and unconfigured authorization stop service reads', async () => {
  for (const denied of [401, 403, 503]) {
    const f = fixture({ denied });
    const result = await f.request();
    assert.equal(result.status, denied);
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
    assert.deepEqual(f.calls, [['authorization'], ['json', denied]]);
  }
});

test('setup unexpected failures are reported and preserve the original public error', async () => {
  const failure = new Error('synthetic internal failure');
  const f = fixture({ failure });
  const result = await f.request();
  assert.equal(result.status, 502);
  assert.deepEqual(result.payload, {
    error: 'Admin setup status could not be loaded.'
  });
  assert.deepEqual(f.calls, [
    ['authorization'],
    ['setup'],
    ['report', 'Failed to load admin setup status.', failure],
    ['json', 502]
  ]);
});

test('setup unsupported methods and unrelated paths fall through untouched', async () => {
  const f = fixture();
  for (const [url, method] of [
    ['/admin/setup-status', 'POST'],
    ['/api/admin/setup-status', 'DELETE'],
    ['/admin/setup-status/extra', 'GET']
  ])
    assert.equal((await f.request(url, method)).handled, false);
  assert.deepEqual(f.calls, []);
});
