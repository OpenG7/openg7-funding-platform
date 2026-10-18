import assert from 'node:assert/strict';
import test from 'node:test';
import { createSponsorMediaAnalysisHttpHandler } from '../dist/apps/funding-api/src/sponsor-media-analysis.http.js';
import { SponsorMediaAnalysisError } from '../dist/apps/funding-api/src/sponsor-media-analysis/service.js';
const contributionId = '10000000-0000-4000-8000-000000000901';
const base = '/api/admin/sponsorships/media/analyses';
function fixture(overrides = {}) {
  const calls = [],
    output = { headers: {} };
  const handler = createSponsorMediaAnalysisHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    ensureAdminAccess: () => true,
    canReview: () => true,
    getAdminAuditActor: () => 'synthetic-operator',
    readBody: async (_request, max) => {
      calls.push(['body', max]);
      return JSON.stringify({ contributionId });
    },
    writeJson: (_request, _response, status, body) =>
      Object.assign(output, { status, body }),
    mediaAnalysis: Object.fromEntries(
      ['read', 'start', 'review', 'receipt'].map((method) => [
        method,
        async (...args) => {
          calls.push([method, ...args]);
          return { contributionId, runs: [] };
        }
      ])
    ),
    ...overrides
  });
  return {
    calls,
    output,
    run: (
      method,
      url = base,
      headers = { 'content-type': 'application/json' }
    ) =>
      handler(
        { method, url, headers },
        { setHeader: (key, value) => (output.headers[key] = value) }
      )
  };
}
test('both aliases protect private reads and commands before parsing or invoking a service', async () => {
  for (const prefix of ['/admin', '/api/admin'])
    for (const [method, suffix] of [
      ['GET', '?contributionId=' + contributionId],
      ['POST', ''],
      ['POST', '/review']
    ]) {
      const f = fixture({ canReview: () => false });
      assert.equal(
        await f.run(method, prefix + '/sponsorships/media/analyses' + suffix),
        true
      );
      assert.equal(f.output.status, 403);
      assert.equal(f.output.headers['Cache-Control'], 'private, no-store');
      assert.deepEqual(f.calls, []);
    }
  const expired = fixture({
    ensureAdminAccess: () => false,
    canReview: () => assert.fail('session bypass')
  });
  await expired.run('POST');
  assert.deepEqual(expired.calls, []);
});
test('GET reads exact contribution facts without jobs and refuses duplicate or unrelated query inputs', async () => {
  const f = fixture();
  await f.run('GET', base + '?contributionId=' + contributionId);
  assert.deepEqual(f.calls, [['read', contributionId]]);
  for (const suffix of [
    '',
    '?contributionId=invalid',
    '?contributionId=' + contributionId + '&contributionId=' + contributionId,
    '?contributionId=' + contributionId + '&rerun=true'
  ]) {
    const invalid = fixture();
    await invalid.run('GET', base + suffix);
    assert.equal(invalid.output.status, 400);
    assert.deepEqual(invalid.calls, []);
  }
});
test('bounded commands use only their owner use case and the authenticated server actor', async () => {
  for (const [suffix, method] of [
    ['', 'start'],
    ['/review', 'review']
  ]) {
    const f = fixture();
    await f.run('POST', base + suffix);
    assert.equal(f.output.status, 200);
    assert.deepEqual(f.calls, [
      ['body', 8192],
      [method, { contributionId }, 'synthetic-operator']
    ]);
  }
  const wrong = fixture();
  await wrong.run('POST', base, { 'content-type': 'text/plain' });
  assert.equal(wrong.output.status, 415);
  assert.deepEqual(wrong.calls, []);
  const query = fixture();
  await query.run('POST', base + '?rerun=true');
  assert.equal(query.output.status, 400);
  assert.deepEqual(query.calls, []);
  const method = fixture();
  await method.run('DELETE');
  assert.equal(method.output.status, 405);
});
test('domain conflicts remain actionable while storage/provider details stay private', async () => {
  for (const [error, status, code] of [
    [
      new SponsorMediaAnalysisError('MEDIA_ANALYSIS_STALE'),
      409,
      'MEDIA_ANALYSIS_STALE'
    ],
    [new Error('private storage credential'), 503, 'MEDIA_ANALYSIS_UNAVAILABLE']
  ]) {
    const f = fixture({
      mediaAnalysis: {
        read: async () => {
          throw error;
        }
      }
    });
    await f.run('GET', base + '?contributionId=' + contributionId);
    assert.equal(f.output.status, status);
    assert.deepEqual(f.output.body, { code });
  }
});
test('receipt reconciliation reads only the exact actor-bound request and never replays a job', async () => {
  const requestId = '20000000-0000-4000-8000-000000000901';
  const url =
    base + '/receipt?' + new URLSearchParams({ contributionId, requestId });
  const f = fixture();
  await f.run('GET', url);
  assert.deepEqual(f.calls, [
    ['receipt', contributionId, requestId, 'synthetic-operator']
  ]);
  for (const suffix of [
    '?contributionId=' + contributionId,
    '?contributionId=' + contributionId + '&requestId=invalid',
    '?contributionId=' +
      contributionId +
      '&requestId=' +
      requestId +
      '&requestId=' +
      requestId
  ]) {
    const invalid = fixture();
    await invalid.run('GET', base + '/receipt' + suffix);
    assert.equal(invalid.output.status, 400);
    assert.deepEqual(invalid.calls, []);
  }
  const forbidden = fixture({ canReview: () => false });
  await forbidden.run('GET', url);
  assert.equal(forbidden.output.status, 403);
  assert.deepEqual(forbidden.calls, []);
  const mutation = fixture();
  await mutation.run('POST', base + '/receipt');
  assert.equal(mutation.output.status, 405);
  assert.deepEqual(mutation.calls, []);
});
