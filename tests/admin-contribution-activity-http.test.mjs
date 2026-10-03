import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createAdminContributionActivityHttpHandler } from '../dist/apps/funding-api/src/admin-contribution-activity.http.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const fixture = ({ denied, failure, unavailable } = {}) => {
  const calls = [];
  const claimed = new Set();
  const listed = { items: [], hasMore: false };
  const writeJson = (_request, response, status, payload) => {
    calls.push(['json', status]);
    Object.assign(response, { status, payload });
  };
  const handler = createAdminContributionActivityHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    ensureAdminAccess: (request, response) => {
      calls.push(['access']);
      if (!denied) return true;
      writeJson(request, response, denied, { error: 'Access rejected.' });
      return false;
    },
    getAdminAuditActor: () => {
      calls.push(['actor']);
      return 'synthetic-owner';
    },
    readBody: (request, limit) => {
      calls.push(['body', limit]);
      return readBody(request, limit);
    },
    writeJson,
    contributionActivity: unavailable
      ? null
      : {
          list: async (query) => {
            calls.push(['list', query]);
            if (failure) throw failure;
            return listed;
          },
          claimPresentation: async (ids, actor) => {
            calls.push(['claim', ids, actor]);
            if (failure) throw failure;
            if (!Array.isArray(ids))
              throw new RangeError('Invalid activity IDs.');
            const fresh = ids.filter((id) => !claimed.has(`${actor}:${id}`));
            fresh.forEach((id) => claimed.add(`${actor}:${id}`));
            return { ids: fresh };
          }
        }
  });
  return {
    calls,
    listed,
    async request(url, { method = 'GET', body = '{"ids":["1","2"]}' } = {}) {
      const request = Object.assign(Readable.from([body]), {
        url,
        method,
        headers: {}
      });
      const response = {};
      return { handled: await handler(request, response), ...response };
    }
  };
};

test('activity aliases preserve optional cursor presence and listing results', async () => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    for (const [suffix, query] of [
      ['', {}],
      ['?before=3&after=1&id=2', { before: '3', after: '1', id: '2' }],
      ['?before=', { before: '' }]
    ]) {
      const f = fixture();
      const result = await f.request(`${prefix}contribution-activity${suffix}`);
      assert.equal(result.handled, true);
      assert.deepEqual(result.payload, f.listed);
      assert.deepEqual(f.calls, [['access'], ['list', query], ['json', 200]]);
    }
  }
});

test('presentation aliases forward the authenticated actor and preserve repeat receipts', async () => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    const f = fixture();
    const first = await f.request(`${prefix}contribution-activity/present`, {
      method: 'POST'
    });
    const repeat = await f.request(`${prefix}contribution-activity/present`, {
      method: 'POST'
    });
    assert.deepEqual(first.payload, { ids: ['1', '2'] });
    assert.deepEqual(repeat.payload, { ids: [] });
    assert.deepEqual(f.calls.slice(0, 5), [
      ['access'],
      ['body', undefined],
      ['actor'],
      ['claim', ['1', '2'], 'synthetic-owner'],
      ['json', 200]
    ]);
  }
});

test('activity access and method checks precede reading and service effects', async () => {
  for (const denied of [401, 403, 503]) {
    for (const url of [
      '/admin/contribution-activity',
      '/api/admin/contribution-activity/present'
    ]) {
      const f = fixture({ denied });
      assert.equal(
        (await f.request(url, { method: 'POST', body: '{' })).status,
        denied
      );
      assert.deepEqual(
        f.calls.map(([name]) => name),
        ['access', 'json']
      );
    }
  }
  for (const [url, method] of [
    ['/admin/contribution-activity', 'POST'],
    ['/api/admin/contribution-activity/present', 'GET']
  ]) {
    const f = fixture();
    const result = await f.request(url, { method });
    assert.equal(result.status, 405);
    assert.deepEqual(result.payload, { code: 'METHOD_NOT_ALLOWED' });
    assert.deepEqual(
      f.calls.map(([name]) => name),
      ['access', 'json']
    );
  }
});

test('activity errors retain validation and unavailable distinctions', async () => {
  for (const [failure, status, code] of [
    [new RangeError('invalid'), 400, 'INVALID_ACTIVITY_CURSOR'],
    [new Error('private'), 503, 'ACTIVITY_UNAVAILABLE']
  ]) {
    const result = await fixture({ failure }).request(
      '/admin/contribution-activity?before=bad'
    );
    assert.equal(result.status, status);
    assert.deepEqual(result.payload, { code });
  }
  for (const [options, body, status] of [
    [{}, '{', 400],
    [{}, '{}', 400],
    [{ failure: new RangeError('invalid') }, '{}', 400],
    [{ failure: new Error('private') }, '{}', 503],
    [{ unavailable: true }, '{}', 503]
  ]) {
    const result = await fixture(options).request(
      '/admin/contribution-activity/present',
      { method: 'POST', body }
    );
    assert.equal(result.status, status);
    assert.deepEqual(result.payload, { code: 'ACTIVITY_PRESENTATION_FAILED' });
  }
  assert.deepEqual(
    (
      await fixture({ unavailable: true }).request(
        '/admin/contribution-activity'
      )
    ).payload,
    { code: 'ACTIVITY_UNAVAILABLE' }
  );
});

test('unowned activity routes fall through without checks', async () => {
  const f = fixture();
  assert.equal(
    (await f.request('/admin/contribution-activity/extra')).handled,
    false
  );
  assert.deepEqual(f.calls, []);
});
