import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminCampaignsHttpHandler } from '../dist/apps/funding-api/src/admin-campaigns.http.js';
import { parseAdminCampaignsQuery } from '../dist/apps/funding-api/src/admin-campaigns-query.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';

const defaults = {
  page: 1,
  pageSize: 25,
  sort: 'preparation',
  direction: 'desc'
};

function fixture({ denied, unavailable = false, failure } = {}) {
  const calls = [];
  const handler = createAdminCampaignsHttpHandler({
    publicBaseOrigin: 'https://synthetic-campaigns.invalid',
    ensureAdminAccess(_request, response) {
      calls.push('access');
      if (denied)
        Object.assign(response, {
          status: denied,
          payload: { code: 'DENIED' }
        });
      return !denied;
    },
    writeJson(_request, response, status, payload, headers) {
      Object.assign(response, { status, payload });
      Object.assign(response.headers, headers);
    },
    campaigns: unavailable
      ? null
      : {
          async list(query) {
            calls.push(query);
            if (failure) throw failure;
            return {
              generatedAt: '2026-10-18T12:00:00Z',
              items: [],
              pagination: { totalItems: 0 }
            };
          }
        }
  });
  return {
    calls,
    async run(path = '/api/admin/campaigns', method = 'GET') {
      const response = {
        headers: {},
        setHeader(key, value) {
          this.headers[key] = value;
        }
      };
      const handled = await handler(
        { url: path, method, headers: {} },
        response
      );
      return { handled, ...response };
    }
  };
}

test('campaign list authorizes before method, query parsing and service access on both aliases', async () => {
  for (const path of ['/admin/campaigns', '/api/admin/campaigns']) {
    for (const denied of [401, 403]) {
      const f = fixture({ denied });
      const result = await f.run(path + '?unknown=private', 'POST');
      assert.equal(result.status, denied);
      assert.equal(result.headers['Cache-Control'], 'private, no-store');
      assert.deepEqual(f.calls, ['access']);
    }
    for (const role of ['reader', 'operator', 'owner'])
      assert.equal(adminRoleAllows(role, 'GET', path), true);
  }
});

test('campaign list accepts complete validated filters and safe defaults', async () => {
  assert.deepEqual(parseAdminCampaignsQuery(new URLSearchParams()), defaults);
  const f = fixture();
  const result = await f.run(
    '/api/admin/campaigns?page=2&pageSize=50&channel=linkedin&target=openg20&state=waiting&search=%20Synthetic%20&sort=due_at&direction=asc'
  );
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(f.calls[1], {
    page: 2,
    pageSize: 50,
    channel: 'linkedin',
    target: 'openg20',
    state: 'waiting',
    search: 'Synthetic',
    sort: 'due_at',
    direction: 'asc'
  });
});

test('campaign filters reject unknown, duplicate and malformed values before service access', async () => {
  for (const query of [
    'unknown=1',
    'page=1&page=2',
    'channel=facebook&channel=facebook',
    'page=0',
    'page=-1',
    'page=1.5',
    'page=01',
    'page=9007199254740991',
    'pageSize=10',
    'pageSize=',
    'channel=instagram',
    'channel=',
    'target=external',
    'state=published',
    'sort=amount',
    'direction=random',
    'search=' + 'x'.repeat(121),
    'search=%00private'
  ]) {
    const f = fixture();
    const result = await f.run('/api/admin/campaigns?' + query);
    assert.equal(result.status, 400, query);
    assert.equal(result.payload.code, 'CAMPAIGNS_INVALID_REQUEST');
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
    assert.deepEqual(f.calls, ['access']);
  }
});

test('campaign reads have explicit methods, safe failures and no false empty success', async () => {
  const wrongMethod = fixture();
  const refused = await wrongMethod.run('/admin/campaigns', 'POST');
  assert.equal(refused.status, 405);
  assert.equal(refused.headers.Allow, 'GET');
  assert.deepEqual(wrongMethod.calls, ['access']);
  for (const options of [
    { unavailable: true },
    { failure: new Error('postgres://private:secret@example.invalid/database') }
  ]) {
    const result = await fixture(options).run();
    assert.equal(result.status, 503);
    assert.equal(result.payload.code, 'CAMPAIGNS_UNAVAILABLE');
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
    assert.doesNotMatch(JSON.stringify(result.payload), /postgres|secret/);
  }
  const unrelated = fixture();
  assert.equal(
    (await unrelated.run('/api/admin/campaigns/execute')).handled,
    false
  );
  assert.deepEqual(unrelated.calls, []);
});
