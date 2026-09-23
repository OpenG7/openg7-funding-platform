import assert from 'node:assert/strict';
import test from 'node:test';
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

test('website preparation respects consent, payment, thresholds and worker state', () => {
  const facts = {
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
    workerEnabled: true
  };
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
