import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SPONSORSHIP_PRICING_CONFIG } from '../dist/packages/funding-core/src/index.js';
import { prepareContributionWebsite } from '../dist/packages/funding-core/src/contribution-activity.js';
import { contributionNotificationConfig } from '../dist/apps/funding-api/src/contribution-activity.service.js';
import { simulatedCheckoutEnabled } from '../dist/apps/funding-api/src/stripe-checkout-config.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';

test('all admin roles can reserve their own toast without gaining business mutations', () => {
  for (const role of ['reader', 'operator', 'owner'])
    assert.equal(
      adminRoleAllows(role, 'POST', '/api/admin/contribution-activity/present'),
      true
    );
  assert.equal(
    adminRoleAllows('reader', 'POST', '/api/admin/sponsorships/review'),
    false
  );
  assert.equal(
    adminRoleAllows('reader', 'POST', '/api/admin/contribution-activity'),
    false
  );
});

test('navigable simulated Checkout cannot target production or a remote provider', () => {
  assert.equal(simulatedCheckoutEnabled({}), false);
  const local = {
    STRIPE_SIMULATED_CHECKOUT_ENABLED: 'true',
    FUNDING_PLATFORM_ENV: 'development',
    STRIPE_API_HOST: 'stripe-stub',
    STRIPE_SECRET_KEY: 'sk_test_simulation'
  };
  assert.equal(simulatedCheckoutEnabled(local), true);
  for (const patch of [
    { FUNDING_PLATFORM_ENV: 'production' },
    { STRIPE_API_HOST: 'api.stripe.com' },
    { STRIPE_SECRET_KEY: 'sk_live_invalid_fixture' },
    { STRIPE_SIMULATED_CHECKOUT_ENABLED: 'yes' }
  ])
    assert.throws(() => simulatedCheckoutEnabled({ ...local, ...patch }));
});

const websitePreparationFacts = (overrides = {}) => ({
  amountMinor: 5000,
  currency: 'CAD',
  paymentStatus: 'paid',
  contributionType: 'sponsorship_interest',
  publicConsent: true,
  companyName: 'Synthetic company',
  summary: null,
  reviewStatus: 'pending_review',
  hidden: false,
  refundPending: false,
  mediaApproved: false,
  workerEnabled: true,
  ...overrides
});

test('website preparation respects consent, payment, thresholds and worker state', () => {
  const facts = websitePreparationFacts();
  assert.equal(prepareContributionWebsite(facts).state, 'prepared');
  for (const patch of [
    { paymentStatus: 'pending' },
    { paymentStatus: 'refunded' },
    { refundPending: true },
    { hidden: true },
    { reviewStatus: 'rejected' },
    { currency: 'USD' },
    { amountMinor: 4999 },
    { contributionType: 'personal_support' }
  ])
    assert.equal(
      prepareContributionWebsite({ ...facts, ...patch }).cartouche,
      null
    );
  assert.equal(
    prepareContributionWebsite({ ...facts, publicConsent: false }).state,
    'waiting_consent'
  );
  assert.equal(
    prepareContributionWebsite({ ...facts, workerEnabled: false }).state,
    'worker_stopped'
  );
  assert.equal(
    prepareContributionWebsite({ ...facts, companyName: ' ' }).state,
    'waiting_identity'
  );
  assert.ok(
    prepareContributionWebsite({
      ...facts,
      amountMinor: 25000
    }).reasons.includes('facebook_eligible')
  );
  assert.ok(
    prepareContributionWebsite({
      ...facts,
      amountMinor: 50000
    }).reasons.includes('linkedin_eligible')
  );
});

test('website preparation resolves exact minor-unit boundaries and custom paid amounts', () => {
  for (const [amountMinor, facebook, linkedin] of [
    [4999, false, false],
    [5000, false, false],
    [5001, false, false],
    [12345, false, false],
    [24999, false, false],
    [25000, true, false],
    [25001, true, false],
    [32123, true, false],
    [49999, true, false],
    [50000, true, true],
    [50001, true, true],
    [75123, true, true]
  ]) {
    const result = prepareContributionWebsite(
      websitePreparationFacts({
        amountMinor,
        reviewStatus: 'approved',
        mediaApproved: true
      })
    );
    if (amountMinor === 4999) {
      assert.deepEqual(result, {
        state: 'ineligible',
        reasons: ['payment_confirmed', 'unsupported_contribution'],
        cartouche: null
      });
      continue;
    }
    assert.equal(result.state, 'prepared', `${amountMinor} minor units`);
    assert.deepEqual(result.reasons, [
      'payment_confirmed',
      'website_eligible',
      facebook ? 'facebook_eligible' : 'facebook_below_threshold',
      linkedin ? 'linkedin_eligible' : 'linkedin_below_threshold'
    ]);
    assert.equal(result.cartouche.destination, 'website');
  }
});

test('website preparation confines CAD benefits to sponsorship contributions', () => {
  assert.equal(
    prepareContributionWebsite(websitePreparationFacts({ currency: 'cad' }))
      .state,
    'prepared'
  );
  for (const patch of [
    { currency: 'USD' },
    { currency: 'EUR' },
    { contributionType: 'personal_support' }
  ]) {
    assert.deepEqual(
      prepareContributionWebsite(
        websitePreparationFacts({ amountMinor: 75123, ...patch })
      ),
      {
        state: 'ineligible',
        reasons: ['payment_confirmed', 'unsupported_contribution'],
        cartouche: null
      }
    );
  }
});

test('website preparation rejects an invalid NaN paid amount', () => {
  assert.deepEqual(
    prepareContributionWebsite(websitePreparationFacts({ amountMinor: NaN })),
    {
      state: 'ineligible',
      reasons: ['payment_confirmed', 'unsupported_contribution'],
      cartouche: null
    }
  );
});

test('website preparation follows every active shared benefit threshold', () => {
  const benefits = DEFAULT_SPONSORSHIP_PRICING_CONFIG.benefits;
  const original = structuredClone(benefits);
  try {
    benefits.websiteMention.minimumAmount = 75;
    benefits.facebookBatch.minimumAmount = 175;
    benefits.linkedinBatch.minimumAmount = 375;
    for (const [amountMinor, website, facebook, linkedin] of [
      [7499, false, false, false],
      [7500, true, false, false],
      [17499, true, false, false],
      [17500, true, true, false],
      [37499, true, true, false],
      [37500, true, true, true]
    ]) {
      const result = prepareContributionWebsite(
        websitePreparationFacts({
          amountMinor,
          reviewStatus: 'approved',
          mediaApproved: true
        })
      );
      assert.equal(result.state, website ? 'prepared' : 'ineligible');
      assert.deepEqual(
        result.reasons,
        website
          ? [
              'payment_confirmed',
              'website_eligible',
              facebook ? 'facebook_eligible' : 'facebook_below_threshold',
              linkedin ? 'linkedin_eligible' : 'linkedin_below_threshold'
            ]
          : ['payment_confirmed', 'unsupported_contribution']
      );
    }
  } finally {
    benefits.websiteMention.minimumAmount =
      original.websiteMention.minimumAmount;
    benefits.facebookBatch.minimumAmount = original.facebookBatch.minimumAmount;
    benefits.linkedinBatch.minimumAmount = original.linkedinBatch.minimumAmount;
  }
});

test('private website preparation preserves independent review and media decisions', () => {
  for (const [reviewStatus, mediaApproved, requiredReasons] of [
    ['pending_review', false, ['review_required', 'media_required']],
    ['pending_review', true, ['review_required']],
    ['approved', false, ['media_required']],
    ['approved', true, []]
  ]) {
    const facts = websitePreparationFacts({ reviewStatus, mediaApproved });
    const original = structuredClone(facts);
    const result = prepareContributionWebsite(facts);
    assert.equal(result.state, 'prepared');
    assert.deepEqual(result.reasons, [
      'payment_confirmed',
      'website_eligible',
      'facebook_below_threshold',
      'linkedin_below_threshold',
      ...requiredReasons
    ]);
    assert.deepEqual(result.cartouche, {
      destination: 'website',
      title: 'Synthetic company',
      body: 'Merci de soutenir le Fonds des Bâtisseurs OpenG7.'
    });
    assert.deepEqual(facts, original);
  }
});

test('notification config defaults off, validates email and confines SMS simulation', () => {
  assert.equal(contributionNotificationConfig({}).smsUrl, null);
  assert.equal(contributionNotificationConfig({}).email, null);
  for (const env of [
    { FUNDING_CONTRIBUTION_EMAIL_ENABLED: 'yes' },
    { FUNDING_CONTRIBUTION_EMAIL_ENABLED: 'true' },
    { FUNDING_CONTRIBUTION_SMS_MODE: 'live' },
    {
      FUNDING_CONTRIBUTION_SMS_MODE: 'mock',
      FUNDING_CONTRIBUTION_SMS_MOCK_URL: 'https://external.example.test'
    },
    {
      FUNDING_PLATFORM_ENV: 'production',
      FUNDING_CONTRIBUTION_SMS_MODE: 'mock',
      FUNDING_CONTRIBUTION_SMS_MOCK_URL: 'http://127.0.0.1:4242/sms'
    }
  ])
    assert.throws(() => contributionNotificationConfig(env));
});
