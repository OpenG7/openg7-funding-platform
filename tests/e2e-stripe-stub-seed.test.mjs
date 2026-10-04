import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { seedStripeStub } from '../scripts/lib/e2e-seed/stripe-stub.mjs';
import {
  ACCOUNTING_FIXTURES,
  BACKFILL_FIXTURES,
  SPONSORSHIP_FIXTURES,
  WEBHOOK_FIXTURES
} from './playwright/fixtures/e2e-fixtures.mjs';

const fixtures = {
  sponsorshipFixtures: SPONSORSHIP_FIXTURES,
  webhookFixtures: WEBHOOK_FIXTURES,
  accountingFixtures: ACCOUNTING_FIXTURES,
  backfillFixtures: BACKFILL_FIXTURES
};

const capturePorts = ({ failWhen = () => false, error } = {}) => {
  const calls = [];
  let activeCalls = 0;
  const record = async (operation, payload) => {
    assert.equal(activeCalls, 0, 'each provider operation must be awaited');
    activeCalls += 1;
    const call = payload === undefined ? [operation] : [operation, payload];
    calls.push(call);
    await setImmediate();
    activeCalls -= 1;
    if (failWhen(operation, payload)) {
      throw error;
    }
  };
  return {
    calls,
    ports: {
      resetStripeStub: () => record('reset'),
      registerStripePaymentIntent: (payload) =>
        record('paymentIntent', payload),
      registerStripeCheckoutSession: (payload) =>
        record('checkoutSession', payload)
    }
  };
};

const paymentIntent = (fixture, fee) => [
  'paymentIntent',
  {
    id: fixture.stripePaymentIntentId,
    amount: fixture.amountCents,
    chargeId: fixture.stripeChargeId,
    balanceTransactionId: fixture.stripeBalanceTransactionId,
    fee
  }
];

test('registers the existing fixtures with exact payloads in awaited order', async () => {
  const { calls, ports } = capturePorts();
  assert.equal(await seedStripeStub({ ...fixtures, ports }), undefined);

  assert.deepEqual(calls, [
    ['reset'],
    ...[
      SPONSORSHIP_FIXTURES.refund,
      SPONSORSHIP_FIXTURES.partialRefund,
      SPONSORSHIP_FIXTURES.multiPartialRefund,
      SPONSORSHIP_FIXTURES.concurrentRefund
    ].map((fixture) => [
      'paymentIntent',
      { id: fixture.stripePaymentIntentId, amount: fixture.amountCents, fee: 0 }
    ]),
    paymentIntent(WEBHOOK_FIXTURES.idempotence, 175),
    paymentIntent(WEBHOOK_FIXTURES.checkoutAuthoritative, 105),
    paymentIntent(WEBHOOK_FIXTURES.feeBackfill, 300),
    paymentIntent(WEBHOOK_FIXTURES.outOfOrder, 210),
    paymentIntent(ACCOUNTING_FIXTURES.scenario, 320),
    paymentIntent(ACCOUNTING_FIXTURES.fullyRefunded, 200),
    paymentIntent(BACKFILL_FIXTURES.matchedSession, 400),
    [
      'checkoutSession',
      {
        id: BACKFILL_FIXTURES.matchedSession.stripeSessionId,
        paymentIntentId: BACKFILL_FIXTURES.matchedSession.stripePaymentIntentId,
        amountTotal: 12000,
        customerEmail: BACKFILL_FIXTURES.matchedSession.contactEmail,
        metadata: {
          project: 'openg7',
          projectId: 'openg7',
          contributionType: 'personal_support',
          publicReference: BACKFILL_FIXTURES.matchedSession.publicReference,
          nonCharityAcknowledged: 'true'
        }
      }
    ],
    paymentIntent(BACKFILL_FIXTURES.unmatchedSession, 300),
    [
      'checkoutSession',
      {
        id: BACKFILL_FIXTURES.unmatchedSession.stripeSessionId,
        paymentIntentId:
          BACKFILL_FIXTURES.unmatchedSession.stripePaymentIntentId,
        amountTotal: 9000,
        metadata: {
          project: 'some-other-project',
          contributionType: 'personal_support'
        }
      }
    ],
    paymentIntent(BACKFILL_FIXTURES.sponsorshipSession, 2200),
    [
      'checkoutSession',
      {
        id: BACKFILL_FIXTURES.sponsorshipSession.stripeSessionId,
        paymentIntentId:
          BACKFILL_FIXTURES.sponsorshipSession.stripePaymentIntentId,
        amountTotal: 75000,
        customerEmail: BACKFILL_FIXTURES.sponsorshipSession.contactEmail,
        metadata: {
          project: 'openg7',
          projectId: 'openg7',
          contributionType: 'sponsorship_interest',
          publicReference: BACKFILL_FIXTURES.sponsorshipSession.publicReference,
          nonCharityAcknowledged: 'true'
        }
      }
    ]
  ]);
});

test('keeps webhook exclusions and nullish fee fallback with injected fixtures', async () => {
  const webhookFixtures = Object.freeze({
    replaySponsorship: Object.freeze({
      stripePaymentIntentId: 'pi_replay_excluded'
    }),
    initialZero: Object.freeze({
      stripePaymentIntentId: 'pi_zero',
      amountCents: 1000,
      initialFeeCents: 0,
      feeCents: 99
    }),
    initialFee: Object.freeze({
      stripePaymentIntentId: 'pi_initial',
      amountCents: 2000,
      initialFeeCents: 80,
      feeCents: 90
    }),
    fallbackFee: Object.freeze({
      stripePaymentIntentId: 'pi_fallback',
      amountCents: 3000,
      initialFeeCents: null,
      feeCents: 70
    }),
    noFee: Object.freeze({
      stripePaymentIntentId: 'pi_no_fee',
      amountCents: 4000
    })
  });
  const { calls, ports } = capturePorts();
  await seedStripeStub({
    ...fixtures,
    sponsorshipFixtures: {
      noIntent: { amountCents: 1000 },
      emptyIntent: { stripePaymentIntentId: '', amountCents: 1000 }
    },
    webhookFixtures,
    ports
  });
  assert.deepEqual(calls.slice(0, 5), [
    ['reset'],
    paymentIntent(webhookFixtures.initialZero, 0),
    paymentIntent(webhookFixtures.initialFee, 80),
    paymentIntent(webhookFixtures.fallbackFee, 70),
    paymentIntent(webhookFixtures.noFee, 0)
  ]);
  assert.equal(calls.length, 13);
  assert.equal(
    calls.some(([, payload]) => payload?.id === 'pi_replay_excluded'),
    false
  );
  assert.equal(
    calls.some(
      ([, payload]) =>
        payload?.id ===
          ACCOUNTING_FIXTURES.excludedFailed.stripePaymentIntentId ||
        payload?.id === ACCOUNTING_FIXTURES.excludedExpired.stripeSessionId
    ),
    false
  );
});

test('cleanup only awaits reset without accessing fixtures or registering objects', async () => {
  const { calls, ports } = capturePorts();
  assert.equal(await seedStripeStub({ cleanupOnly: true, ports }), undefined);
  assert.deepEqual(calls, [['reset']]);
});

test('reset failure propagates unchanged and prevents all registrations', async () => {
  const error = new Error('synthetic reset failure');
  const { calls, ports } = capturePorts({
    error,
    failWhen: (operation) => operation === 'reset'
  });
  await assert.rejects(
    seedStripeStub({ ...fixtures, ports }),
    (caught) => caught === error
  );
  assert.deepEqual(calls, [['reset']]);
});

test('payment-intent failure propagates unchanged and stops the remaining operations', async () => {
  const error = new Error('synthetic payment-intent failure');
  const { calls, ports } = capturePorts({
    error,
    failWhen: (operation) => operation === 'paymentIntent'
  });
  await assert.rejects(
    seedStripeStub({ ...fixtures, ports }),
    (caught) => caught === error
  );
  assert.deepEqual(calls, [
    ['reset'],
    [
      'paymentIntent',
      {
        id: SPONSORSHIP_FIXTURES.refund.stripePaymentIntentId,
        amount: SPONSORSHIP_FIXTURES.refund.amountCents,
        fee: 0
      }
    ]
  ]);
});

test('checkout-session failure propagates unchanged before the next backfill fixture', async () => {
  const error = new Error('synthetic checkout-session failure');
  const { calls, ports } = capturePorts({
    error,
    failWhen: (operation) => operation === 'checkoutSession'
  });
  await assert.rejects(
    seedStripeStub({ ...fixtures, ports }),
    (caught) => caught === error
  );
  assert.equal(calls.length, 13);
  assert.deepEqual(
    calls.at(-2),
    paymentIntent(BACKFILL_FIXTURES.matchedSession, 400)
  );
  assert.equal(
    calls.at(-1)[1].id,
    BACKFILL_FIXTURES.matchedSession.stripeSessionId
  );
});

test('import reads no configuration and performs no network or process operation', async (t) => {
  const environment = process.env;
  const forbidden = () =>
    assert.fail('import must not perform external operations');
  for (const method of [
    'spawn',
    'spawnSync',
    'exec',
    'execSync',
    'execFile',
    'execFileSync'
  ]) {
    t.mock.method(childProcess, method, forbidden);
  }
  t.mock.method(globalThis, 'fetch', forbidden);
  syncBuiltinESMExports();
  process.env = new Proxy(environment, {
    get(target, key) {
      // Node's module loader reads this flag before evaluating any ESM module.
      if (key === 'WATCH_REPORT_DEPENDENCIES') {
        return target[key];
      }
      assert.fail('import must not read environment configuration');
    },
    ownKeys: forbidden,
    set: forbidden
  });
  try {
    const module =
      await import('../scripts/lib/e2e-seed/stripe-stub.mjs?import-purity');
    assert.deepEqual(Object.keys(module), ['seedStripeStub']);
    assert.equal(typeof module.seedStripeStub, 'function');
  } finally {
    process.env = environment;
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
