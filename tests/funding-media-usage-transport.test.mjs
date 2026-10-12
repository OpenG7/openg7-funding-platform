import assert from 'node:assert/strict';
import test from 'node:test';
import { FundingSponsorshipFollowupClient } from '../dist/apps/funding-web/src/app/features/funding/services/funding-sponsorship-followup.client.js';
const base = 'https://funding.example.test/api';
const usage = {
  state: 'confirmed',
  channels: ['website', 'facebook'],
  targets: ['openg7'],
  transformations: ['technical', 'portrait'],
  credit: 'Synthetic photo credit',
  restrictions: null
};
test('private rights and preference writes send the exact owned/versioned request without query tokens or admin evidence', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json({ updated: true });
  });
  const client = new FundingSponsorshipFollowupClient(base);
  const grant = {
    token: 'synthetic-private-link',
    requestId: 'synthetic-UUID',
    assetId: 'synthetic-photo',
    expectedVersion: 'v1',
    confirmed: true,
    usage
  };
  const preference = {
    token: 'synthetic-private-link',
    requestId: 'synthetic-preference-UUID',
    expectedRevision: 2,
    assetId: 'synthetic-photo',
    correction: 'Please use the displayed photo.',
    confirmed: true
  };
  await client.updateSponsorshipMediaUsage(grant);
  await client.requestSponsorshipMediaPreference(preference);
  assert.deepEqual(
    calls.map((call) => ({
      url: call.url,
      body: JSON.parse(call.options.body)
    })),
    [
      { url: base + '/sponsorship-followup/media/usage', body: grant },
      { url: base + '/sponsorship-followup/media/preference', body: preference }
    ]
  );
  for (const call of calls) {
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.headers['Content-Type'], 'application/json');
    assert.equal(call.url.includes(grant.token), false);
    assert.equal(call.options.body.includes('evidenceReference'), false);
  }
});
test('multipart uploads preserve explicit usage facts separately from editorial approval', async (t) => {
  const client = new FundingSponsorshipFollowupClient(base);
  let posted;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, base + '/sponsorship-followup/media');
    posted = options.body;
    return Response.json({
      asset: { id: 'synthetic-photo', reviewStatus: 'pending_review' }
    });
  });
  const result = await client.uploadSponsorshipMedia(
    'synthetic-private-link',
    'supporting_image',
    new File(['synthetic image'], 'synthetic.png', { type: 'image/png' }),
    'Exact public description',
    usage
  );
  assert.deepEqual(JSON.parse(posted.get('usage')), usage);
  assert.equal(posted.get('usageConfirmed'), 'true');
  assert.equal(posted.get('altText'), 'Exact public description');
  assert.equal(posted.has('moderationDecision'), false);
  assert.equal(result.asset.reviewStatus, 'pending_review');
});
