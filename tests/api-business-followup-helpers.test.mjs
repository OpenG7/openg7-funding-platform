import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildContributionReceiptDescription,
  createContributionPublicReference,
  createContributionReferenceHelpers,
  createReferenceRecoveryIdempotencyKey,
  normalizeReferenceRecoveryEmail
} from '../dist/apps/funding-api/src/business-helpers/contribution-reference.js';
import {
  checkoutSessionPaidAtIso,
  stripeCheckoutSessionStatus
} from '../dist/apps/funding-api/src/business-helpers/checkout.js';
import {
  createSponsorshipFollowupHelpers,
  createSponsorshipFollowupToken,
  FOLLOWUP_TOKEN_BYTES,
  hashSponsorshipFollowupToken,
  isValidFollowupToken
} from '../dist/apps/funding-api/src/business-helpers/sponsorship-followup.js';

const token = 'synthetic_followup_token_1234567890abcd';
const tokenHash = hashSponsorshipFollowupToken(token);
const current = Object.freeze({
  contributionId: '11111111-1111-4111-8111-111111111111',
  stripeSessionId: 'cs_synthetic_followup',
  paymentStatus: 'pending',
  reviewStatus: 'pending_review'
});
const refreshed = Object.freeze({ ...current, paymentStatus: 'paid' });
const metadata = Object.freeze({
  contributionType: 'sponsorship_interest',
  sponsorshipFollowupTokenHash: tokenHash,
  publicReference: ' og7-2026-abcdef ',
  publicDisplayConsent: 'true',
  publicDisplayName: 'Synthetic public company',
  displayAmountConsent: 'false',
  nonCharityAcknowledged: 'true'
});
const session = Object.freeze({
  id: current.stripeSessionId,
  status: 'complete',
  payment_status: 'paid',
  created: 1767225600,
  payment_intent: Object.freeze({ id: 'pi_synthetic_followup' }),
  client_reference_id: 'OG7-2026-FALLBK',
  amount_total: 25000,
  currency: 'cad',
  metadata,
  customer_details: Object.freeze({ email: 'synthetic@example.test' })
});

const fixture = ({
  stripeEnabled = true,
  checkout = session,
  lookups = [refreshed],
  failures = {},
  persistResult = true
} = {}) => {
  const calls = [];
  const reports = [];
  const pendingLookups = [...lookups];
  const record = (name, value) => {
    calls.push({ name, value });
    if (failures[name]) throw failures[name];
  };
  const helpers = createSponsorshipFollowupHelpers({
    sponsorshipFollowupTokenTtlDays: 30,
    stripe: stripeEnabled
      ? {
          checkout: {
            sessions: {
              async retrieve(...args) {
                record('retrieve', args);
                return checkout;
              }
            }
          }
        }
      : null,
    async upsertCheckoutSessionFromWebhook(input) {
      record('upsert', input);
      return persistResult;
    },
    async getSponsorshipFollowupByTokenHash(...args) {
      record('lookup', args);
      return pendingLookups.shift() ?? null;
    },
    reportFailure: (...args) => reports.push(args)
  });
  return { helpers, calls, reports };
};

test('follow-up tokens keep their byte size, URL-safe format and SHA-256 hash', () => {
  const tokens = Array.from({ length: 8 }, createSponsorshipFollowupToken);
  assert.equal(FOLLOWUP_TOKEN_BYTES, 32);
  assert.equal(new Set(tokens).size, tokens.length);
  for (const value of tokens) {
    assert.equal(value.length, 43);
    assert.equal(Buffer.from(value, 'base64url').length, 32);
    assert.equal(isValidFollowupToken(value), true);
    assert.equal(
      hashSponsorshipFollowupToken(value),
      createHash('sha256').update(value).digest('hex')
    );
  }
  for (const length of [32, 128]) {
    assert.equal(isValidFollowupToken('A'.repeat(length)), true);
  }
  for (const value of [
    null,
    undefined,
    32,
    '',
    'A'.repeat(31),
    'A'.repeat(129),
    `${token}=`,
    `${token}\n`
  ]) {
    assert.equal(isValidFollowupToken(value), false);
  }
});

test('public references retain the UTC year, six-character alphabet and receipt description', (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: Date.parse('2026-12-31T23:30:00Z')
  });
  for (let index = 0; index < 8; index += 1) {
    const reference = createContributionPublicReference();
    assert.match(reference, /^OG7-2026-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    assert.equal(
      buildContributionReceiptDescription(reference),
      `Reference OpenG7: ${reference}`
    );
  }
  t.mock.timers.tick(60 * 60 * 1000);
  assert.match(createContributionPublicReference(), /^OG7-2027-/);
});

test('recovery email normalization and hourly keys preserve their privacy and retry boundary', (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: Date.parse('2026-10-04T12:30:00Z')
  });
  const email = normalizeReferenceRecoveryEmail('  Synthetic@Example.Test  ');
  assert.equal(email, 'synthetic@example.test');
  for (const value of [
    null,
    undefined,
    123,
    '',
    'synthetic',
    'synthetic@',
    'synthetic@example.test extra'
  ]) {
    assert.equal(normalizeReferenceRecoveryEmail(value), null);
  }
  const firstKey = createReferenceRecoveryIdempotencyKey(email);
  assert.equal(
    firstKey,
    `reference-recovery:${createHash('sha256').update(email).digest('hex')}:2026-10-04T12`
  );
  assert.equal(firstKey.includes(email), false);
  t.mock.timers.tick(29 * 60 * 1000);
  assert.equal(createReferenceRecoveryIdempotencyKey(email), firstKey);
  assert.notEqual(
    createReferenceRecoveryIdempotencyKey('other@example.test'),
    firstKey
  );
  t.mock.timers.tick(60 * 1000);
  assert.notEqual(createReferenceRecoveryIdempotencyKey(email), firstKey);
});

test('checkout success URLs replace only the reference and resolve relative paths against the supplied origin', () => {
  const { buildContributionCheckoutSuccessUrl } =
    createContributionReferenceHelpers({
      publicBaseOrigin: 'https://funding.example.test'
    });
  assert.equal(
    buildContributionCheckoutSuccessUrl(
      '/return?reference=old&mode=success#receipt',
      'OG7-2026-ABCDEF'
    ),
    'https://funding.example.test/return?reference=OG7-2026-ABCDEF&mode=success#receipt'
  );
  assert.equal(
    buildContributionCheckoutSuccessUrl(
      'https://return.example.test/done?session_id={CHECKOUT_SESSION_ID}',
      'OG7-2026-ABCDEF'
    ),
    'https://return.example.test/done?session_id=%7BCHECKOUT_SESSION_ID%7D&reference=OG7-2026-ABCDEF'
  );
});

test('only Stripe payment_status paid confirms Checkout and paidAt uses the provider creation time', () => {
  for (const [payment_status, status, expected] of [
    ['paid', 'complete', 'paid'],
    ['paid', 'expired', 'paid'],
    ['unpaid', 'expired', 'expired'],
    ['unpaid', 'complete', 'pending'],
    ['no_payment_required', 'complete', 'pending'],
    ['unpaid', 'open', 'pending']
  ]) {
    const checkout = { ...session, payment_status, status };
    assert.equal(stripeCheckoutSessionStatus(checkout), expected);
    assert.equal(
      checkoutSessionPaidAtIso(checkout, expected),
      expected === 'paid' ? '2026-01-01T00:00:00.000Z' : null
    );
  }
});

test('editable statuses and missing Stripe or session short-circuit without reads or writes', async () => {
  for (const [options, followup] of [
    [{}, { ...current, paymentStatus: 'paid' }],
    [{}, { ...current, paymentStatus: 'refunded' }],
    [{}, { ...current, paymentStatus: 'disputed' }],
    [{ stripeEnabled: false }, current],
    [{}, { ...current, stripeSessionId: null }],
    [{}, { ...current, stripeSessionId: '' }]
  ]) {
    const f = fixture(options);
    assert.equal(
      await f.helpers.refreshSponsorshipFollowupPaymentStatus(
        followup,
        tokenHash
      ),
      followup
    );
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.reports, []);
  }
});

test('incompatible contribution metadata and token hashes never persist a retrieved Checkout', async () => {
  for (const incompatibleMetadata of [
    null,
    {},
    { ...metadata, contributionType: 'personal_support' },
    { ...metadata, contributionType: 'unknown' },
    { ...metadata, sponsorshipFollowupTokenHash: 'different-hash' },
    { ...metadata, sponsorshipFollowupTokenHash: '' }
  ]) {
    const f = fixture({
      checkout: { ...session, metadata: incompatibleMetadata }
    });
    assert.equal(
      await f.helpers.refreshSponsorshipFollowupPaymentStatus(
        current,
        tokenHash
      ),
      current
    );
    assert.deepEqual(f.calls, [
      {
        name: 'retrieve',
        value: [current.stripeSessionId, { expand: ['payment_intent'] }]
      }
    ]);
    assert.deepEqual(f.reports, []);
  }
});

test('a compatible provider payment persists exact consent and financial facts before returning the reread record', async () => {
  for (const paymentIntent of [
    'pi_synthetic_followup',
    session.payment_intent
  ]) {
    const f = fixture({
      checkout: { ...session, payment_intent: paymentIntent }
    });
    assert.equal(
      await f.helpers.refreshSponsorshipFollowupPaymentStatus(
        current,
        tokenHash
      ),
      refreshed
    );
    assert.deepEqual(
      f.calls.map((call) => call.name),
      ['retrieve', 'upsert', 'lookup']
    );
    assert.deepEqual(f.calls[0].value, [
      current.stripeSessionId,
      { expand: ['payment_intent'] }
    ]);
    assert.deepEqual(f.calls[1].value, {
      notifyAdmin: true,
      stripeSessionId: session.id,
      stripePaymentIntentId: 'pi_synthetic_followup',
      publicReference: 'OG7-2026-ABCDEF',
      contributionType: 'sponsorship_interest',
      amountCents: 25000,
      currency: 'cad',
      metadata,
      publicDisplayConsent: true,
      publicName: 'Synthetic public company',
      displayAmountConsent: false,
      nonCharityAcknowledged: true,
      sponsorshipFollowupTokenHash: tokenHash,
      status: 'paid',
      paidAtIso: '2026-01-01T00:00:00.000Z',
      emailPrivate: 'synthetic@example.test'
    });
    assert.equal(f.calls[1].value.metadata, metadata);
    assert.equal(f.calls[2].value[0], tokenHash);
    assert.deepEqual(f.reports, []);
  }
});

test('partial provider data retains nullish fallbacks without replacing empty values', async () => {
  for (const publicReference of [undefined, null, '']) {
    const providerMetadata = {
      contributionType: 'sponsorship_interest',
      publicReference,
      publicDisplayName: '',
      publicDisplayConsent: 'TRUE'
    };
    const f = fixture({
      checkout: {
        ...session,
        status: 'expired',
        payment_status: 'unpaid',
        payment_intent: null,
        amount_total: null,
        currency: null,
        customer_details: null,
        metadata: providerMetadata
      }
    });
    await f.helpers.refreshSponsorshipFollowupPaymentStatus(current, tokenHash);
    const input = f.calls[1].value;
    assert.equal(
      input.publicReference,
      publicReference === '' ? null : 'OG7-2026-FALLBK'
    );
    assert.equal(input.publicName, '');
    assert.equal(input.amountCents, 0);
    assert.equal(input.currency, 'cad');
    assert.equal(input.stripePaymentIntentId, null);
    assert.equal(input.emailPrivate, null);
    assert.equal(input.sponsorshipFollowupTokenHash, tokenHash);
    assert.equal(input.publicDisplayConsent, false);
    assert.equal(input.displayAmountConsent, false);
    assert.equal(input.nonCharityAcknowledged, false);
    assert.equal(input.status, 'expired');
    assert.equal(input.paidAtIso, null);
    assert.equal(input.metadata, providerMetadata);
  }
  const f = fixture({
    checkout: { ...session, amount_total: 0, currency: '' }
  });
  await f.helpers.refreshSponsorshipFollowupPaymentStatus(current, tokenHash);
  assert.equal(f.calls[1].value.amountCents, 0);
  assert.equal(f.calls[1].value.currency, '');
});

test('a missing reread retains the current record even when persistence returns false', async () => {
  const f = fixture({ lookups: [null], persistResult: false });
  assert.equal(
    await f.helpers.refreshSponsorshipFollowupPaymentStatus(current, tokenHash),
    current
  );
  assert.deepEqual(
    f.calls.map((call) => call.name),
    ['retrieve', 'upsert', 'lookup']
  );
  assert.deepEqual(f.reports, []);
});

test('provider, persistence and reread failures return the current record and report once', async () => {
  for (const [stage, expectedCalls] of [
    ['retrieve', ['retrieve']],
    ['upsert', ['retrieve', 'upsert']],
    ['lookup', ['retrieve', 'upsert', 'lookup']]
  ]) {
    const failure = new Error(`Synthetic ${stage} failure`);
    const f = fixture({ failures: { [stage]: failure } });
    assert.equal(
      await f.helpers.refreshSponsorshipFollowupPaymentStatus(
        current,
        tokenHash
      ),
      current
    );
    assert.deepEqual(
      f.calls.map((call) => call.name),
      expectedCalls
    );
    assert.deepEqual(f.reports, [
      [
        'Failed to refresh sponsorship follow-up payment status from Stripe.',
        failure
      ]
    ]);
  }
});

test('fresh lookup never contacts Stripe for an absent record and preserves initial repository failures', async () => {
  const absent = fixture({ lookups: [null] });
  assert.equal(
    await absent.helpers.getFreshSponsorshipFollowupByToken(token),
    null
  );
  assert.equal(absent.calls.length, 1);
  assert.equal(absent.calls[0].name, 'lookup');
  assert.equal(absent.calls[0].value[0], tokenHash);
  const failure = new Error('Synthetic initial lookup failure');
  const failed = fixture({ failures: { lookup: failure } });
  await assert.rejects(
    failed.helpers.getFreshSponsorshipFollowupByToken(token),
    (error) => error === failure
  );
  assert.deepEqual(failed.reports, []);
});

test('TTL cutoffs read the clock at each lookup, including after provider and persistence delays', async (t) => {
  const start = Date.parse('2026-10-04T12:00:00Z');
  const hour = 60 * 60 * 1000;
  const ttl = 30 * 24 * hour;
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const calls = [];
  const helpers = createSponsorshipFollowupHelpers({
    sponsorshipFollowupTokenTtlDays: 30,
    stripe: {
      checkout: {
        sessions: {
          async retrieve() {
            calls.push({ name: 'retrieve' });
            t.mock.timers.tick(2 * hour);
            return session;
          }
        }
      }
    },
    async upsertCheckoutSessionFromWebhook() {
      calls.push({ name: 'upsert' });
      t.mock.timers.tick(3 * hour);
      return true;
    },
    async getSponsorshipFollowupByTokenHash(hash, cutoff) {
      calls.push({ name: 'lookup', hash, cutoff });
      return calls.length === 1 ? current : refreshed;
    },
    reportFailure: () => assert.fail('No synthetic failure expected')
  });
  t.mock.timers.tick(hour);
  assert.equal(
    await helpers.getFreshSponsorshipFollowupByToken(token),
    refreshed
  );
  assert.deepEqual(calls, [
    {
      name: 'lookup',
      hash: tokenHash,
      cutoff: new Date(start + hour - ttl).toISOString()
    },
    { name: 'retrieve' },
    { name: 'upsert' },
    {
      name: 'lookup',
      hash: tokenHash,
      cutoff: new Date(start + 6 * hour - ttl).toISOString()
    }
  ]);
});
