import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createPublicPaymentsHttpHandler } from '../dist/apps/funding-api/src/public-payments.http.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';

const origin = 'https://funding.example.test';
const reference = 'OG7-2026-ABCDEF';
const payload = {
  amount: 25,
  projectId: 'synthetic-project',
  contributionType: 'personal_support',
  publicDisplayConsent: false,
  displayAmountConsent: true,
  nonCharityAcknowledged: true,
  successUrl: `${origin}/success`,
  cancelUrl: `${origin}/cancel`
};
const session = {
  id: 'cs_synthetic',
  payment_intent: 'pi_synthetic',
  url: 'https://checkout.example.test/synthetic'
};
const fixture = ({
  stripeEnabled = true,
  failures = {},
  ...overrides
} = {}) => {
  const calls = [];
  const record = (name, value) => {
    calls.push({ name, value });
    if (failures[name]) throw failures[name];
  };
  const handler = createPublicPaymentsHttpHandler({
    publicBaseOrigin: origin,
    projectId: 'synthetic-server-project',
    isProduction: true,
    businessSponsorshipEnabled: true,
    allowedContributionAmounts: new Set([5, 10, 25, 50]),
    PUBLIC_DISPLAY_NAME_MAX_LENGTH: 100,
    stripeApiHost: undefined,
    navigableSimulatedCheckout: false,
    stripe: stripeEnabled
      ? {
          checkout: {
            sessions: {
              create: async (input) => {
                record('provider', input);
                return session;
              }
            }
          }
        }
      : null,
    readBody: async (request, limit) => {
      record('body', limit);
      return readBody(request, limit);
    },
    writeJson: (_request, response, status, result) => {
      record('response', status);
      Object.assign(response, { status, payload: result });
    },
    normalizeAmount: (value) => Number(Number(value).toFixed(2)),
    isAllowedContributionType: (value) =>
      ['personal_support', 'sponsorship_interest'].includes(value),
    isBoolean: (value) => typeof value === 'boolean',
    isNonEmptySponsorText: (value, limit) =>
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.trim().length <= limit,
    isValidOptionalBoundedText: (value, limit) =>
      value == null ||
      (typeof value === 'string' && value.trim().length <= limit),
    createDevelopmentCheckoutResult: (input) => ({
      checkoutId: `stripe-dev-fallback-${input.projectId}-${input.amount}`,
      redirectUrl: input.successUrl,
      status: 'mocked'
    }),
    resolveCheckoutReturnUrl: (candidate, fallback) => {
      record('return-url', { candidate, fallback });
      return new URL(candidate).origin === origin
        ? candidate
        : new URL(fallback, origin).toString();
    },
    createSponsorshipFollowupToken: () => 'synthetic-followup-token',
    hashSponsorshipFollowupToken: () => 'synthetic-followup-hash',
    createContributionPublicReference: () => reference,
    buildContributionCheckoutSuccessUrl: (url, publicReference) => {
      const result = new URL(url);
      result.searchParams.set('reference', publicReference);
      return result.toString();
    },
    buildContributionReceiptDescription: (value) =>
      `Reference OpenG7: ${value}`,
    truncateStripeMetadataValue: (value) => value.slice(0, 480),
    resolveStripePaymentIntentId: (value) =>
      typeof value === 'string' ? value : (value?.id ?? null),
    insertCheckoutSessionRecord: async (input) => record('persist', input),
    reportFailure: (...args) => record('failure', args),
    ...overrides
  });
  const invoke = async (
    input = payload,
    { method = 'POST', url = '/checkout-sessions' } = {}
  ) => {
    const request = Readable.from([
      typeof input === 'string' ? input : JSON.stringify(input)
    ]);
    Object.assign(request, { method, url, headers: {} });
    const response = {};
    const handled = await handler(request, response);
    return { handled, ...response };
  };
  return { calls, invoke };
};

test('Checkout aliases and queries dispatch POST only; other routes never consume a body', async () => {
  for (const url of ['/checkout-sessions?x=1', '/api/checkout-sessions']) {
    const f = fixture();
    assert.equal((await f.invoke(payload, { url })).handled, true);
    assert.equal(f.calls.filter(({ name }) => name === 'provider').length, 1);
  }
  for (const options of [
    { method: 'GET' },
    { method: 'PUT' },
    { url: '/checkout-sessions/other' },
    { url: '/stripe/webhook' }
  ]) {
    const f = fixture();
    assert.deepEqual(await f.invoke(payload, options), { handled: false });
    assert.deepEqual(f.calls, []);
  }
});

test('Checkout preserves validation statuses and blocks provider/persistence on invalid input', async () => {
  const cases = [
    ['{', 400, 'Invalid checkout request body.'],
    [{ ...payload, amount: 7 }, 400, 'Checkout amount is not allowed.'],
    [{ ...payload, amount: 'invalid' }, 400, 'Checkout amount is not allowed.'],
    [
      { ...payload, contributionType: 'unknown' },
      400,
      'Checkout contribution type is not allowed.'
    ],
    [
      { ...payload, publicDisplayConsent: 'true' },
      400,
      'Checkout consent fields are invalid or incomplete.'
    ],
    [
      { ...payload, nonCharityAcknowledged: false },
      400,
      'Checkout consent fields are invalid or incomplete.'
    ],
    [
      { ...payload, publicDisplayConsent: true },
      400,
      'Public display name is required when public display consent is granted.'
    ],
    [
      { ...payload, publicDisplayName: 'x'.repeat(101) },
      400,
      'Public display name is too long.'
    ],
    [
      { ...payload, amount: 49, contributionType: 'sponsorship_interest' },
      400,
      'Checkout amount is not allowed.'
    ]
  ];
  for (const [input, status, error] of cases) {
    const f = fixture();
    assert.deepEqual(await f.invoke(input), {
      handled: true,
      status,
      payload: { error }
    });
    assert.deepEqual(
      f.calls.map(({ name }) => name),
      ['body', 'response']
    );
  }
  const disabled = fixture({ businessSponsorshipEnabled: false });
  assert.deepEqual(
    await disabled.invoke({
      ...payload,
      amount: 250,
      contributionType: 'sponsorship_interest'
    }),
    {
      handled: true,
      status: 403,
      payload: { error: 'Business sponsorship checkout is disabled.' }
    }
  );
});

test('Checkout maps integer CAD units, server project, consent and provider result before recording', async () => {
  const f = fixture();
  const result = await f.invoke({
    ...payload,
    publicDisplayConsent: true,
    publicDisplayName: ' Synthetic builder '
  });
  assert.deepEqual(result, {
    handled: true,
    status: 200,
    payload: {
      checkoutId: session.id,
      redirectUrl: session.url,
      status: 'redirected'
    }
  });
  const provider = f.calls.find(({ name }) => name === 'provider').value;
  assert.equal(provider.mode, 'payment');
  assert.equal(provider.line_items[0].price_data.unit_amount, 2500);
  assert.equal(provider.line_items[0].price_data.currency, 'cad');
  assert.equal(provider.metadata.projectId, 'synthetic-server-project');
  assert.equal(provider.metadata.publicDisplayName, 'Synthetic builder');
  assert.equal(provider.metadata.requiresReview, 'false');
  assert.equal(provider.metadata.publicReference, reference);
  assert.deepEqual(provider.metadata, provider.payment_intent_data.metadata);
  assert.equal(
    new URL(provider.cancel_url).searchParams.get('reference'),
    reference
  );
  assert.equal(
    new URL(provider.success_url).searchParams.get('reference'),
    reference
  );
  const persisted = f.calls.find(({ name }) => name === 'persist').value;
  assert.equal(persisted.amountCents, 2500);
  assert.equal(persisted.stripePaymentIntentId, 'pi_synthetic');
  assert.equal(persisted.sponsorshipFollowupTokenHash, null);
  assert.deepEqual(
    f.calls.map(({ name }) => name),
    ['body', 'return-url', 'return-url', 'provider', 'persist', 'response']
  );
  assert.equal('paid' in persisted, false);
});

test('Custom sponsorship Checkout sends a follow-up URL and persists only the token hash', async () => {
  const f = fixture();
  assert.equal(
    (
      await f.invoke({
        ...payload,
        amount: 123.45,
        contributionType: 'sponsorship_interest'
      })
    ).status,
    200
  );
  const provider = f.calls.find(({ name }) => name === 'provider').value;
  assert.equal(provider.line_items[0].price_data.unit_amount, 12345);
  assert.equal(
    new URL(provider.success_url).searchParams.get('token'),
    'synthetic-followup-token'
  );
  assert.equal(provider.metadata.requiresReview, 'true');
  assert.equal(
    provider.metadata.sponsorshipFollowupTokenHash,
    'synthetic-followup-hash'
  );
  assert.equal('sponsorshipFollowupToken' in provider.metadata, false);
  assert.equal(
    f.calls.find(({ name }) => name === 'persist').value
      .sponsorshipFollowupTokenHash,
    'synthetic-followup-hash'
  );
});

test('Stripe absence and simulated-host Checkout preserve production refusal and local fallback', async () => {
  for (const options of [
    { stripeEnabled: false },
    { stripeApiHost: '127.0.0.1' }
  ]) {
    const production = fixture(options);
    assert.deepEqual(await production.invoke(), {
      handled: true,
      status: 503,
      payload: { error: 'Stripe checkout is not configured.' }
    });
    const local = fixture({ ...options, isProduction: false });
    assert.equal((await local.invoke()).payload.status, 'mocked');
    assert.deepEqual(
      local.calls.map(({ name }) => name),
      ['body', 'response']
    );
  }
  const navigable = fixture({
    stripeApiHost: '127.0.0.1',
    navigableSimulatedCheckout: true
  });
  assert.equal((await navigable.invoke()).payload.status, 'redirected');
});

test('Provider failure follows environment fallback; persistence failure after a created session still returns redirect', async () => {
  for (const isProduction of [true, false]) {
    const f = fixture({
      isProduction,
      failures: { provider: new Error('synthetic provider failure') }
    });
    const result = await f.invoke();
    assert.equal(result.status, isProduction ? 502 : 200);
    assert.equal(
      result.payload.error ?? result.payload.status,
      isProduction ? 'Stripe checkout session could not be created.' : 'mocked'
    );
    assert.equal(
      f.calls.some(({ name }) => name === 'persist'),
      false
    );
  }
  const persistedFailure = fixture({
    failures: { persist: new Error('synthetic persistence failure') }
  });
  assert.equal((await persistedFailure.invoke()).payload.status, 'redirected');
  assert.equal(
    persistedFailure.calls.filter(({ name }) => name === 'provider').length,
    1
  );
  assert.deepEqual(
    persistedFailure.calls.slice(-3).map(({ name }) => name),
    ['persist', 'failure', 'response']
  );
});
