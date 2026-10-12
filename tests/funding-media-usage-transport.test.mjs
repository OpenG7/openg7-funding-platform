import assert from 'node:assert/strict';
import test from 'node:test';
import { FundingSponsorshipFollowupClient } from '../dist/apps/funding-web/src/app/features/funding/services/funding-sponsorship-followup.client.js';
import { FundingAdminSponsorshipsClient } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-sponsorships.client.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';
import { SponsorshipFollowupError } from '../dist/apps/funding-web/src/app/features/funding/models/sponsorship-followup-ui.js';
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
test('media mutations preserve explicit error status and code without automatically replaying a refused or uncertain command', async (t) => {
  for (const [status, code] of [
    [409, 'VERSION_CONFLICT'],
    [409, 'IDEMPOTENCY_CONFLICT'],
    [409, 'RECEIPT_UNCERTAIN'],
    [400, 'INVALID_MEDIA_USAGE_REQUEST'],
    [503, 'MEDIA_USAGE_UNAVAILABLE']
  ]) {
    let adminCalls = 0,
      privateCalls = 0;
    const admin = new FundingAdminSponsorshipsClient({
      requestAdminJson: async () => {
        adminCalls++;
        return Response.json({ code, error: 'Synthetic refusal' }, { status });
      }
    });
    t.mock.method(globalThis, 'fetch', async () => {
      privateCalls++;
      return Response.json({ code }, { status });
    });
    for (const invoke of [
      () => admin.updateSponsorMediaUsage({}),
      () => admin.decideSponsorMediaPreference({})
    ])
      await assert.rejects(
        invoke,
        (error) =>
          error instanceof AdminDashboardRequestError &&
          error.status === status &&
          error.code === code &&
          error.message === 'Synthetic refusal'
      );
    const client = new FundingSponsorshipFollowupClient(base);
    for (const invoke of [
      () => client.updateSponsorshipMediaUsage({}),
      () => client.requestSponsorshipMediaPreference({})
    ])
      await assert.rejects(
        invoke,
        (error) =>
          error instanceof SponsorshipFollowupError &&
          error.status === status &&
          error.code === code
      );
    assert.equal(adminCalls, 2);
    assert.equal(privateCalls, 2);
    t.mock.restoreAll();
  }
});
test('unreadable admin media error bodies retain their status and fallback without fabricating a definite refusal', async () => {
  const admin = new FundingAdminSponsorshipsClient({
    requestAdminJson: async () =>
      new Response('Synthetic invalid JSON', { status: 409 })
  });
  await assert.rejects(
    admin.updateSponsorMediaUsage({}),
    (error) =>
      error instanceof AdminDashboardRequestError &&
      error.status === 409 &&
      error.code === undefined &&
      error.message === 'MEDIA_USAGE_UNAVAILABLE'
  );
});
