import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminPreparationAssistanceHttpHandler } from '../dist/apps/funding-api/src/admin-preparation-assistance.http.js';
import { PreparationAssistanceError } from '../dist/apps/funding-api/src/preparation-assistance/errors.js';

const contributionId = '10000000-0000-4000-8000-000000000901';
const base = '/api/admin/preparation-assistance';
function fixture(overrides = {}) {
  const calls = [];
  const output = { headers: {} };
  const methods = [
    'read',
    'summary',
    'saveSource',
    'enqueue',
    'review',
    'apply'
  ];
  const handler = createAdminPreparationAssistanceHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    ensureAdminAccess: () => true,
    canOwn: () => true,
    getAdminAuditActor: () => 'synthetic-owner',
    readBody: async (_request, limit) => {
      calls.push(['body', limit]);
      return JSON.stringify({ contributionId });
    },
    writeJson: (_request, _response, status, payload) => {
      Object.assign(output, { status, payload });
    },
    assistance: Object.fromEntries(
      methods.map((method) => [
        method,
        async (...args) => {
          calls.push([method, ...args]);
          return { contributionId, revision: 'synthetic-revision' };
        }
      ])
    ),
    ...overrides
  });
  return {
    output,
    calls,
    run: (
      method,
      url = base,
      headers = { 'content-type': 'application/json' }
    ) =>
      handler(
        { method, url, headers },
        {
          setHeader: (key, value) => {
            output.headers[key] = value;
          }
        }
      )
  };
}

test('private sources and proposals require an owner even on GET and both route aliases', async () => {
  for (const prefix of ['/api/admin', '/admin']) {
    for (const [method, suffix] of [
      ['GET', `?contributionId=${contributionId}`],
      ['GET', `/summary?contributionId=${contributionId}`],
      ...['source', 'runs', 'review', 'apply'].map((name) => [
        'POST',
        `/${name}`
      ])
    ]) {
      const f = fixture({ canOwn: () => false });
      assert.equal(
        await f.run(method, `${prefix}/preparation-assistance${suffix}`),
        true
      );
      assert.equal(f.output.status, 403);
      assert.equal(f.output.headers['Cache-Control'], 'private, no-store');
      assert.deepEqual(f.calls, []);
    }
  }
  const expired = fixture({
    ensureAdminAccess: () => false,
    canOwn: () => assert.fail('authorization was bypassed')
  });
  await expired.run('POST', base + '/apply');
  assert.deepEqual(expired.calls, []);
});

test('GET is side effect free and rejects missing, duplicate and unknown query parameters', async () => {
  const f = fixture();
  await f.run('GET', `${base}?contributionId=${contributionId}`);
  assert.equal(f.output.status, 200);
  assert.deepEqual(f.calls, [['read', contributionId]]);
  for (const query of [
    '',
    '?contributionId=invalid',
    `?contributionId=${contributionId}&contributionId=${contributionId}`,
    `?contributionId=${contributionId}&run=true`
  ]) {
    const invalid = fixture();
    await invalid.run('GET', base + query);
    assert.equal(invalid.output.status, 400, query);
    assert.deepEqual(invalid.calls, []);
  }
});

test('compact summary reads never request private source or review contents and validate every query parameter', async () => {
  for (const prefix of ['/api/admin', '/admin']) {
    const path = prefix + '/preparation-assistance/summary';
    const f = fixture();
    await f.run('GET', `${path}?contributionId=${contributionId}`);
    assert.equal(f.output.status, 200);
    assert.deepEqual(f.calls, [['summary', contributionId]]);
    for (const query of [
      '',
      '?contributionId=invalid',
      `?contributionId=${contributionId}&contributionId=${contributionId}`,
      `?contributionId=${contributionId}&view=summary`
    ]) {
      const invalid = fixture();
      await invalid.run('GET', path + query);
      assert.equal(invalid.output.status, 400);
      assert.deepEqual(invalid.calls, []);
    }
  }
});

test('a compact rerun uses the existing command and returns only the dedicated summary', async () => {
  const compact = {
    contributionId,
    revision: 'safe-summary',
    sourceVersion: 2
  };
  const calls = [];
  const f = fixture({
    assistance: {
      enqueue: async (input, actor) => {
        calls.push(['enqueue', input, actor]);
        return {
          contributionId,
          source: { text: 'private agreement' },
          run: { review: { reason: 'private reason' } }
        };
      },
      summary: async (id) => {
        calls.push(['summary', id]);
        return compact;
      }
    }
  });
  await f.run('POST', base + '/runs?view=summary');
  assert.equal(f.output.status, 200);
  assert.deepEqual(f.output.payload, compact);
  assert.doesNotMatch(JSON.stringify(f.output.payload), /private/);
  assert.deepEqual(calls, [
    ['enqueue', { contributionId }, 'synthetic-owner'],
    ['summary', contributionId]
  ]);
  for (const path of [
    '/source?view=summary',
    '/runs?view=private',
    '/runs?view=summary&view=summary',
    '/runs?view=summary&rerun=true'
  ]) {
    const invalid = fixture();
    await invalid.run('POST', base + path);
    assert.equal(invalid.output.status, 400);
    assert.deepEqual(invalid.calls, []);
  }
});

test('mutation routes dispatch bounded JSON to their single use case with server actor', async () => {
  for (const [path, method] of [
    ['source', 'saveSource'],
    ['runs', 'enqueue'],
    ['review', 'review'],
    ['apply', 'apply']
  ]) {
    const f = fixture();
    await f.run('POST', `${base}/${path}`);
    assert.equal(f.output.status, 200);
    assert.deepEqual(f.calls, [
      ['body', 96 * 1024],
      [method, { contributionId }, 'synthetic-owner']
    ]);
  }
  const invalid = fixture({ readBody: async () => '{invalid' });
  await invalid.run('POST', base + '/source');
  assert.equal(invalid.output.status, 400);
  assert.deepEqual(invalid.calls, []);
  const wrongType = fixture();
  await wrongType.run('POST', base + '/apply', {
    'content-type': 'text/plain'
  });
  assert.equal(wrongType.output.status, 415);
  assert.deepEqual(wrongType.calls, []);
});

test('wrong methods and mutation query parameters are refused without touching persistence', async () => {
  for (const [method, path] of [
    ['PUT', base],
    ['POST', base],
    ['GET', base + '/apply'],
    ['POST', base + '/summary'],
    ['DELETE', base + '/source'],
    ['POST', base + '/runs?rerun=true']
  ]) {
    const f = fixture();
    await f.run(method, path);
    assert.equal(
      f.output.status,
      method === 'POST' && path.endsWith('?rerun=true') ? 400 : 405
    );
    assert.deepEqual(f.calls, []);
  }
  const other = fixture();
  assert.equal(
    await other.run('GET', '/api/public/preparation-assistance'),
    false
  );
});

test('domain conflicts survive while infrastructure details and missing database stay private', async () => {
  for (const [error, status, code] of [
    [
      new PreparationAssistanceError('ASSISTANCE_STALE', 409),
      409,
      'ASSISTANCE_STALE'
    ],
    [new Error('private database credential'), 503, 'ASSISTANCE_UNAVAILABLE']
  ]) {
    const f = fixture({
      assistance: {
        read: async () => {
          throw error;
        }
      }
    });
    await f.run('GET', `${base}?contributionId=${contributionId}`);
    assert.equal(f.output.status, status);
    assert.deepEqual(f.output.payload, { code });
  }
  const unavailable = fixture({ assistance: null });
  await unavailable.run('GET', `${base}?contributionId=${contributionId}`);
  assert.equal(unavailable.output.status, 503);
});
