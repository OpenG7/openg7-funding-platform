import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminAuditHttpHandler } from '../dist/apps/funding-api/src/admin-audit.http.js';

const id = '00000000-0000-4000-8000-000000000001';
const fixture = ({ denied, failure } = {}) => {
  const calls = [];
  const listed = {
    data_source: 'database',
    entries: [],
    last_updated_at: '2026-10-03T12:00:00Z'
  };
  const writeJson = (_request, response, status, payload) => {
    calls.push(['json', status]);
    Object.assign(response, { status, payload });
  };
  const handler = createAdminAuditHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    ensureAdminAccess: (request, response) => {
      calls.push(['access']);
      if (!denied) return true;
      writeJson(request, response, denied, { error: 'Access rejected.' });
      return false;
    },
    writeJson,
    isValidUuid: (value) =>
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value
      ),
    listAdminAuditLog: async (entryId) => {
      calls.push(['list', entryId]);
      if (failure) throw failure;
      return listed;
    },
    reportFailure: (...args) => calls.push(['report', ...args])
  });
  return {
    calls,
    listed,
    async request(url = '/admin/audit-log', method = 'GET') {
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

test('audit aliases retain optional selection and no-store after authorization', async () => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    for (const entryId of [undefined, id, id.toUpperCase()]) {
      const f = fixture();
      const result = await f.request(
        `${prefix}audit-log${entryId ? `?entryId=${entryId}` : ''}`
      );
      assert.equal(result.status, 200);
      assert.deepEqual(result.payload, f.listed);
      assert.equal(result.headers['Cache-Control'], 'no-store');
      assert.deepEqual(f.calls, [['access'], ['list', entryId], ['json', 200]]);
    }
  }
});

test('audit denial precedes cache header and invalid selections stop repository reads', async () => {
  for (const denied of [401, 403, 503]) {
    const f = fixture({ denied });
    const result = await f.request('/admin/audit-log?entryId=bad');
    assert.equal(result.status, denied);
    assert.deepEqual(result.headers, {});
    assert.deepEqual(f.calls, [['access'], ['json', denied]]);
  }
  for (const entryId of ['', 'bad', `${id}x`]) {
    const f = fixture();
    const result = await f.request(`/api/admin/audit-log?entryId=${entryId}`);
    assert.equal(result.status, 400);
    assert.deepEqual(result.payload, { error: 'Invalid entryId.' });
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.deepEqual(f.calls, [['access'], ['json', 400]]);
  }
});

test('audit read errors keep original reporting and public status', async () => {
  const failure = new Error('synthetic internal failure');
  const f = fixture({ failure });
  const result = await f.request();
  assert.equal(result.status, 502);
  assert.deepEqual(result.payload, {
    error: 'Admin audit log could not be loaded.'
  });
  assert.deepEqual(f.calls, [
    ['access'],
    ['list', undefined],
    ['report', 'Failed to load admin audit log.', failure],
    ['json', 502]
  ]);
});

test('audit unsupported methods and paths fall through without reads', async () => {
  const f = fixture();
  for (const [url, method] of [
    ['/admin/audit-log', 'POST'],
    ['/api/admin/audit-log', 'DELETE'],
    ['/admin/audit-log/extra', 'GET']
  ])
    assert.equal((await f.request(url, method)).handled, false);
  assert.deepEqual(f.calls, []);
});
