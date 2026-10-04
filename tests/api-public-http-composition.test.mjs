import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createPublicHttpHandlers } from '../dist/apps/funding-api/src/http-composition/public-handlers.js';
import {
  readBody,
  readBodyBuffer
} from '../dist/apps/funding-api/src/http-transport.js';
import { createRequestValidationHelpers } from '../dist/apps/funding-api/src/business-helpers/request-validation.js';
import { createContributionReferenceHelpers } from '../dist/apps/funding-api/src/business-helpers/contribution-reference.js';
import { createMediaExposureHelpers } from '../dist/apps/funding-api/src/business-helpers/media-exposure.js';
import { createHttpErrorHelpers } from '../dist/apps/funding-api/src/business-helpers/http-errors.js';

const origin = 'https://funding.example.test';
const token = 'a'.repeat(43);
const contributionId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const privateBytes = Buffer.from('synthetic-private-image');
const checkoutInput = {
  idempotencyKey: 'synthetic-composition-key-001',
  amount: 25,
  currency: 'CAD',
  projectId: 'synthetic-client-project',
  contributionType: 'personal_support',
  publicDisplayConsent: false,
  displayAmountConsent: true,
  nonCharityAcknowledged: true,
  successUrl: `${origin}/success`,
  cancelUrl: `${origin}/cancel`
};

const fixture = (overrides = {}) => {
  const calls = [];
  const writeJson = (_request, response, status, payload) => {
    calls.push({ name: 'json', status });
    Object.assign(response, { status, payload });
  };
  const sponsorMediaStorage = {
    driver: 'local',
    publicUrl: () => null,
    readPublicObject: async () =>
      assert.fail('Unexpected public storage read.'),
    readPrivateObject: async (key) => {
      calls.push({ name: 'private-storage', key });
      return privateBytes;
    },
    writePrivateObject: async () => assert.fail('Unexpected storage write.'),
    deletePrivateObject: async () =>
      assert.fail('Unexpected private deletion.'),
    deletePublicObject: async () => assert.fail('Unexpected public deletion.')
  };
  const sponsorLogoStorage = {
    readLogo: async () => assert.fail('Unexpected logo read.'),
    deleteLogo: async () => assert.fail('Unexpected logo deletion.')
  };
  const mediaHelpers = createMediaExposureHelpers({
    publicBaseOrigin: origin,
    sponsorMediaStorage,
    sponsorLogoStorage,
    reportWarning: () => assert.fail('Unexpected media warning.')
  });
  const context = {
    publicBaseOrigin: origin,
    publicBaseUrl: null,
    dbPool: null,
    hasDatabase: Boolean(overrides.dbPool),
    stripe: null,
    stripeWebhookSecret: undefined,
    projectId: 'synthetic-server-project',
    isProduction: true,
    businessSponsorshipEnabled: true,
    allowedContributionAmounts: new Set([5, 25, 50]),
    stripeApiHost: undefined,
    navigableSimulatedCheckout: false,
    sponsorshipFollowupTokenTtlDays: 45,
    sponsorMediaMaxBytes: 1024,
    sponsorMediaMaxSupportingImages: 4,
    readStripeTransparency: null,
    readBody: async (request, limit) => {
      calls.push({ name: 'body', limit });
      return readBody(request, limit);
    },
    readBodyBuffer: async (request, limit) => {
      calls.push({ name: 'buffer', limit });
      return readBodyBuffer(request, limit);
    },
    writeJson,
    writeBinary: (
      _request,
      response,
      status,
      payload,
      contentType,
      headers
    ) => {
      calls.push({ name: 'binary', status });
      Object.assign(response, { status, payload, contentType, headers });
    },
    ...createRequestValidationHelpers({
      allowedContributionTypes: new Set([
        'personal_support',
        'sponsorship_interest'
      ])
    }),
    resolveCheckoutReturnUrl: (candidate, fallback) =>
      new URL(candidate || fallback, origin).toString(),
    ...createContributionReferenceHelpers({ publicBaseOrigin: origin }),
    getFreshSponsorshipFollowupByToken: async (value) => {
      calls.push({ name: 'followup', token: value });
      return { contributionId, paymentStatus: 'paid' };
    },
    routeAssetId: mediaHelpers.routeAssetId,
    getSponsorLogoFilenameFromUrl: mediaHelpers.getSponsorLogoFilenameFromUrl,
    deleteSponsorMediaObjects: mediaHelpers.deleteSponsorMediaObjects,
    ...createHttpErrorHelpers({ writeJson }),
    sponsorMediaStorage,
    sponsorLogoStorage,
    ...overrides
  };
  const handlers = createPublicHttpHandlers(context);
  return {
    calls,
    handlers,
    async invoke(name, url, { method = 'GET', body = '', headers = {} } = {}) {
      const chunks = Array.isArray(body) ? body : [Buffer.from(body)];
      const request = Object.assign(Readable.from(chunks), {
        method,
        url,
        headers
      });
      const response = {};
      return {
        handled: await handlers[name](request, response),
        ...response
      };
    }
  };
};

test('Public composition preserves unavailable DB/provider refusals before body or storage access', async () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  for (const [name, url, error] of [
    [
      'handleReferenceLookupRequest',
      '/api/reference-lookup',
      'Reference lookup requires DATABASE_URL.'
    ],
    [
      'handleReferenceRecoveryRequest',
      '/reference-recovery',
      'Reference recovery requires DATABASE_URL.'
    ],
    [
      'handleSponsorshipFollowupRequest',
      '/api/sponsorship-followup/recover',
      'Recovery is unavailable.'
    ],
    [
      'handleSponsorshipFollowupRequest',
      '/sponsorship-followup/draft',
      'Draft storage is unavailable.'
    ],
    [
      'handleSponsorshipFollowupMediaRequest',
      '/api/sponsorship-followup/media',
      'Sponsorship media requires DATABASE_URL.'
    ],
    [
      'handleLegacySponsorshipDetailsRequest',
      '/sponsorship-details',
      'Stripe is not configured.'
    ],
    [
      'handleStripeWebhookRequest',
      '/api/stripe/webhook',
      'Stripe webhook is not configured. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.'
    ]
  ]) {
    assert.deepEqual(await f.invoke(name, url, { method: 'POST', body: '{' }), {
      handled: true,
      status: 503,
      payload: { error }
    });
  }
  assert.equal(
    f.calls.every(({ name }) => name === 'json'),
    true
  );
  for (const configuration of [
    { stripe: { webhooks: {} } },
    { stripeWebhookSecret: 'whsec_synthetic_without_provider' }
  ]) {
    const missing = fixture(configuration);
    const result = await missing.invoke(
      'handleStripeWebhookRequest',
      '/stripe/webhook',
      { method: 'POST', body: '{' }
    );
    assert.equal(result.status, 503);
    assert.equal(
      missing.calls.some(({ name }) => name === 'body'),
      false
    );
  }
});

test('Checkout configuration distinguishes production unavailability from the existing development fallback', async () => {
  const production = fixture();
  assert.deepEqual(
    await production.invoke(
      'handlePublicPaymentsRequest',
      '/checkout-sessions',
      {
        method: 'POST',
        body: JSON.stringify(checkoutInput)
      }
    ),
    {
      handled: true,
      status: 503,
      payload: { error: 'Stripe checkout is not configured.' }
    }
  );
  const development = fixture({ isProduction: false });
  const result = await development.invoke(
    'handlePublicPaymentsRequest',
    '/api/checkout-sessions',
    {
      method: 'POST',
      body: JSON.stringify(checkoutInput)
    }
  );
  assert.equal(result.status, 200);
  assert.equal(result.payload.status, 'mocked');
  assert.equal(result.payload.redirectUrl, checkoutInput.successUrl);
  assert.equal(
    production.calls.filter(({ name }) => name === 'body').length,
    1
  );
  assert.equal(
    development.calls.filter(({ name }) => name === 'body').length,
    1
  );
});

test('Webhook composition passes the original fragmented UTF-8 body, signature and configured secret to Stripe', async () => {
  const raw =
    '{\n "id":"evt_synthetic_composition", "description":"échantillon", "space": " preserved "\n}';
  const signature = 'synthetic-signature-as-received';
  const secret = 'whsec_synthetic_composition';
  const verified = [];
  const f = fixture({
    stripeWebhookSecret: secret,
    stripe: {
      webhooks: {
        constructEvent: (...args) => {
          verified.push(args);
          return {
            id: 'evt_synthetic_composition',
            type: 'synthetic.unknown',
            data: { object: {} }
          };
        }
      }
    }
  });
  const bytes = Buffer.from(raw);
  const split = bytes.indexOf(Buffer.from('é')) + 1;
  const result = await f.invoke(
    'handleStripeWebhookRequest',
    '/api/stripe/webhook',
    {
      method: 'POST',
      body: [bytes.subarray(0, split), bytes.subarray(split)],
      headers: { 'stripe-signature': signature }
    }
  );
  assert.deepEqual(verified, [[raw, signature, secret]]);
  assert.deepEqual(result, {
    handled: true,
    status: 200,
    payload: { received: true, ignored: true, type: 'synthetic.unknown' }
  });
});

test('Shared media runtime keeps approved public reads separate from token-owned private previews', async () => {
  const queries = [];
  const row = {
    id: assetId,
    contribution_id: contributionId,
    review_status: 'approved',
    processed_storage_key: 'synthetic/private.webp',
    public_storage_key: 'synthetic/public.webp'
  };
  const dbPool = {
    query: async (sql, values) => {
      queries.push({ sql, values });
      return { rows: [row] };
    }
  };
  const f = fixture({ dbPool });
  const publicResult = await f.invoke(
    'handlePublicSponsorMediaRequest',
    `/api/public/sponsor-media/${assetId}`
  );
  assert.equal(publicResult.status, 200);
  assert.deepEqual(publicResult.payload, privateBytes);
  assert.deepEqual(publicResult.headers, { 'Cache-Control': 'no-store' });
  assert.equal(
    queries[0].sql.includes("media.review_status = 'approved'"),
    true
  );
  assert.deepEqual(queries[0].values, [assetId]);
  assert.deepEqual(
    f.calls.filter(({ name }) => name.endsWith('-storage')),
    [{ name: 'private-storage', key: 'synthetic/private.webp' }]
  );
  assert.equal(
    f.calls.some(({ name }) => name === 'followup'),
    false
  );

  f.calls.length = 0;
  queries.length = 0;
  const privateUrl = `/sponsorship-followup/media/content/${assetId}`;
  assert.equal(
    (await f.invoke('handleSponsorshipFollowupMediaRequest', privateUrl))
      .status,
    401
  );
  assert.equal(queries.length, 0);
  assert.equal(
    f.calls.some(({ name }) => name.endsWith('-storage')),
    false
  );

  const privateResult = await f.invoke(
    'handleSponsorshipFollowupMediaRequest',
    privateUrl,
    {
      headers: { 'x-sponsorship-followup-token': token }
    }
  );
  assert.equal(privateResult.status, 200);
  assert.deepEqual(privateResult.payload, privateBytes);
  assert.deepEqual(privateResult.headers, {
    'Cache-Control': 'private, no-store'
  });
  assert.deepEqual(queries[0].values, [assetId]);
  assert.deepEqual(
    f.calls.filter(({ name }) => name === 'followup'),
    [{ name: 'followup', token }]
  );
  assert.deepEqual(
    f.calls.filter(({ name }) => name.endsWith('-storage')),
    [{ name: 'private-storage', key: 'synthetic/private.webp' }]
  );

  const wrongOwner = fixture({
    dbPool,
    getFreshSponsorshipFollowupByToken: async () => ({
      contributionId: '00000000-0000-4000-8000-000000000003'
    })
  });
  assert.equal(
    (
      await wrongOwner.invoke(
        'handleSponsorshipFollowupMediaRequest',
        privateUrl,
        {
          headers: { 'x-sponsorship-followup-token': token }
        }
      )
    ).status,
    404
  );
  assert.equal(
    wrongOwner.calls.some(({ name }) => name.endsWith('-storage')),
    false
  );
});

test('Public funding binds runtime configuration and the no-DB transparency reader without starting provider work', async () => {
  const summary = { data_source: 'stripe', total_received: 125 };
  let reads = 0;
  const f = fixture({
    businessSponsorshipEnabled: false,
    allowedContributionAmounts: new Set([10, 50]),
    readStripeTransparency: async () => {
      reads += 1;
      return summary;
    }
  });
  assert.equal(reads, 0);
  const configuration = await f.invoke(
    'handlePublicFundingRequest',
    '/api/public/funding-config'
  );
  assert.equal(configuration.status, 200);
  assert.equal(configuration.payload.business_sponsorship_enabled, false);
  assert.deepEqual(
    configuration.payload.allowed_contribution_amounts,
    [10, 50]
  );
  assert.equal(reads, 0);
  const transparency = await f.invoke(
    'handlePublicFundingRequest',
    '/public/fund-transparency'
  );
  assert.equal(transparency.status, 200);
  assert.equal(transparency.payload, summary);
  assert.equal(reads, 1);
  const empty = await fixture().invoke(
    'handlePublicFundingRequest',
    '/api/public/fund-transparency'
  );
  assert.equal(empty.status, 200);
  assert.equal(empty.payload.data_source, 'empty');
});
