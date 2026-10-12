import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import Stripe from 'stripe';

import { createDurableCheckoutService } from '../../dist/apps/funding-api/src/checkout-operations.service.js';
import { updateContributionStatusByPaymentIntent } from '../../dist/apps/funding-api/src/contributions-write.repository.js';
import { insertFundTransaction } from '../../dist/apps/funding-api/src/fund-transparency.repository.js';
import { runStripeBackfill } from '../../dist/apps/funding-api/src/stripe-backfill.service.js';
import {
  quoteSponsorshipOffer,
  recordCheckoutSponsorshipOffer
} from '../../dist/apps/funding-api/src/sponsorship-commitments/offers.js';
import { processStripeWebhook } from '../../dist/apps/funding-api/src/stripe-webhook.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const secret = 'whsec_disposable_activation_test';
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

// Only the provider responses are synthetic. Offers, Checkout persistence,
// signature verification, event recovery, journal and activation use real code.
const checkoutFixture = (pool, label, onProvider = async () => {}) => {
  const stripe = new Stripe('sk_test_disposable_fixture', {
    host: '127.0.0.1',
    port: 1,
    protocol: 'http',
    maxNetworkRetries: 0
  });
  const quote = quoteSponsorshipOffer(50000, 'CAD');
  const { fingerprint, ...terms } = quote;
  const publicReference = `OG7-2026-${createHash('sha256').update(label).digest('hex').slice(0, 8).toUpperCase()}`;
  const sessionId = `cs_test_activation_${label}`;
  const intentId = `pi_test_activation_${label}`;
  const key = `synthetic-activation-${randomUUID()}`;
  let session;
  let providerCalls = 0;
  stripe.checkout.sessions.create = async (params) => {
    providerCalls++;
    const offer = (
      await pool.query(
        'SELECT snapshot,fingerprint FROM sponsorship_offers WHERE checkout_operation_id=$1',
        [params.metadata.openg7CheckoutOperationId]
      )
    ).rows[0];
    assert.deepEqual(
      offer.snapshot,
      terms,
      'terms commit before contacting Stripe'
    );
    assert.equal(offer.fingerprint, fingerprint);
    session = {
      id: sessionId,
      object: 'checkout.session',
      url: 'https://checkout.example.invalid/activation',
      payment_intent: intentId,
      amount_total: 50000,
      currency: 'cad',
      created: 1735689600,
      payment_status: 'paid',
      status: 'complete',
      metadata: params.metadata,
      customer_details: { email: null }
    };
    await onProvider(fixture);
    return session;
  };
  stripe.checkout.sessions.retrieve = async (id) => {
    assert.equal(id, sessionId);
    return session;
  };
  const run = createDurableCheckoutService(pool, stripe);
  const attempt = {
    key,
    requestHash: createHash('sha256').update(key).digest('hex'),
    prepare: (operationId) => {
      const metadata = {
        project: 'openg7',
        openg7CheckoutOperationId: operationId,
        publicReference,
        contributionType: 'sponsorship_interest',
        publicDisplayConsent: 'true',
        publicDisplayName: 'Synthetic activation business',
        displayAmountConsent: 'true',
        nonCharityAcknowledged: 'true'
      };
      return {
        params: { mode: 'payment', metadata },
        record: {
          publicReference,
          contributionType: 'sponsorship_interest',
          amountCents: 50000,
          currency: 'CAD',
          metadata,
          publicDisplayConsent: true,
          publicName: 'Synthetic activation business',
          displayAmountConsent: true,
          nonCharityAcknowledged: true,
          sponsorshipFollowupTokenHash: null
        }
      };
    },
    afterPrepare: (db, id) =>
      recordCheckoutSponsorshipOffer(db, id, { publicReference, quote })
  };
  const event = (suffix, type, object) => ({
    id: `evt_test_activation_${label}_${suffix}`,
    object: 'event',
    type,
    created: 1735689600,
    livemode: false,
    data: { object }
  });
  const fixture = {
    stripe,
    intentId,
    sessionId,
    start: () => run(attempt),
    providerCalls: () => providerCalls,
    success: (suffix, amount = 50000, latestCharge = null) =>
      event(suffix, 'payment_intent.succeeded', {
        id: intentId,
        object: 'payment_intent',
        amount,
        amount_received: amount,
        currency: 'cad',
        status: 'succeeded',
        created: 1735689600,
        latest_charge: latestCharge,
        metadata: { project: 'openg7', publicReference }
      }),
    failure: (suffix) =>
      event(suffix, 'payment_intent.payment_failed', {
        id: intentId,
        object: 'payment_intent',
        amount: 50000,
        amount_received: 0,
        currency: 'cad',
        status: 'requires_payment_method',
        metadata: { project: 'openg7', publicReference }
      }),
    completed: (suffix, amount = 50000) => {
      session = { ...session, amount_total: amount };
      return event(suffix, 'checkout.session.completed', session);
    },
    backfill: (receivedAmount) => {
      stripe.checkout.sessions.list = async function* () {
        yield {
          ...session,
          payment_status: 'unpaid',
          payment_intent: {
            ...fixture.success('backfill', receivedAmount).data.object,
            amount: 50000
          }
        };
      };
      return runStripeBackfill(stripe, pool, {
        projectId: 'openg7',
        includeUnmatched: false,
        includePayouts: false,
        includeRefunds: false,
        includeDisputes: false,
        dryRun: false,
        assumeNonCharityAcknowledged: false,
        created: null,
        maxRecords: 1
      });
    },
    deliver: (item) => {
      const payload = JSON.stringify(item);
      return processStripeWebhook(
        payload,
        stripe.webhooks.generateTestHeaderString({ payload, secret }),
        {
          stripe,
          webhookSecret: secret,
          pool,
          projectId: 'openg7',
          publicBaseUrl: 'https://example.test'
        }
      );
    },
    stored: async () =>
      (
        await pool.query(
          `SELECT c.status,c.amount_cents,c.currency,m.state,m.provenance,m.offer_id,m.version,
            m.qualification_reason,
            ARRAY(SELECT ob.id::text FROM sponsorship_obligations ob WHERE ob.contribution_id=c.id ORDER BY ob.id) AS obligation_ids,
            ARRAY(SELECT ob.state FROM sponsorship_obligations ob WHERE ob.contribution_id=c.id ORDER BY ob.id) AS obligation_states,
            (SELECT count(*)::integer FROM contribution_activity a WHERE a.contribution_id=c.id) AS activity_count,
            (SELECT count(*)::integer FROM sponsorship_invoices i WHERE i.contribution_id=c.id) AS invoice_count
           FROM fund_contributions c LEFT JOIN sponsorship_commitments m ON m.contribution_id=c.id
           WHERE c.stripe_session_id=$1`,
          [sessionId]
        )
      ).rows[0] ?? null,
    facts: async () =>
      (
        await pool.query(
          `SELECT amount::text,currency,status FROM fund_transactions
           WHERE stripe_object_id=$1 AND type='payment_intent.succeeded' ORDER BY id`,
          [intentId]
        )
      ).rows
  };
  return fixture;
};

const assertActive = (stored, activityCount = 1) => {
  assert.equal(stored.status, 'paid');
  assert.equal(stored.state, 'active');
  assert.equal(stored.provenance, 'accepted_offer');
  assert.ok(stored.offer_id);
  assert.equal(stored.obligation_ids.length, 3);
  assert.deepEqual(stored.obligation_states, ['pending', 'pending', 'pending']);
  assert.equal(stored.activity_count, activityCount);
};
const assertUnknown = (stored) => {
  assert.equal(stored.status, 'paid');
  assert.equal(stored.state, 'needs_confirmation');
  assert.equal(stored.provenance, 'historical_unverified');
  assert.equal(stored.offer_id, null);
  assert.deepEqual(stored.obligation_ids, []);
};

test(
  'sponsorship activation follows durable monetary evidence on disposable PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);

    await t.test(
      'failed before any payment creates neither commitment nor obligation',
      async () => {
        const fixture = checkoutFixture(pool, 'failed_before_paid');
        await fixture.start();
        assert.equal(
          (await fixture.deliver(fixture.failure('failed'))).statusCode,
          200
        );
        const stored = await fixture.stored();
        assert.equal(stored.status, 'failed');
        assert.equal(stored.state, null);
        assert.deepEqual(stored.obligation_ids, []);
        assert.equal(stored.activity_count, 0);
        assert.equal(stored.invoice_count, 0);
        assert.deepEqual(await fixture.facts(), []);
      }
    );

    await t.test(
      'matching success activates once and survives replay, Checkout confirmation and stale failure',
      async () => {
        const fixture = checkoutFixture(pool, 'matching_paid');
        await fixture.start();
        const item = fixture.success('paid');
        assert.equal((await fixture.deliver(item)).statusCode, 200);
        const first = await fixture.stored();
        assertActive(first);
        assert.equal(first.invoice_count, 1);
        assert.equal((await fixture.deliver(item)).payload.duplicate, true);
        assert.equal(
          (await fixture.deliver(fixture.success('same_facts'))).statusCode,
          200
        );
        assert.equal(
          (await fixture.deliver(fixture.completed('completed'))).statusCode,
          200
        );
        assert.equal(
          (await fixture.deliver(fixture.failure('stale_failed'))).statusCode,
          200
        );
        assert.deepEqual(await fixture.stored(), first);
        assert.deepEqual(await fixture.facts(), [
          { amount: '50000', currency: 'cad', status: 'succeeded' }
        ]);
        assert.equal(fixture.providerCalls(), 1);
      }
    );

    const mismatchedPayment = async (label) => {
      const fixture = checkoutFixture(pool, label);
      await fixture.start();
      assert.equal(
        (await fixture.deliver(fixture.completed('completed', 40000)))
          .statusCode,
        200
      );
      assert.equal(
        (await fixture.deliver(fixture.success('actual_paid', 40000)))
          .statusCode,
        200
      );
      const stored = await fixture.stored();
      assertUnknown(stored);
      assert.equal(
        stored.amount_cents,
        50000,
        'the retained offer is not rewritten to match a divergent payment'
      );
      assert.equal(stored.invoice_count, 0);
      return fixture;
    };

    await t.test(
      'a stale failure at the offer price cannot qualify a divergent paid amount',
      async () => {
        const fixture = await mismatchedPayment('failed_after_paid');
        const before = await fixture.stored();
        assert.equal(
          (await fixture.deliver(fixture.failure('stale_failed'))).statusCode,
          200
        );
        assert.deepEqual(await fixture.stored(), before);
        assert.deepEqual(await fixture.facts(), [
          { amount: '40000', currency: 'cad', status: 'succeeded' }
        ]);
      }
    );

    await t.test(
      'a contradictory success fails without activating terms and exact valid replays remain safe',
      async () => {
        const fixture = await mismatchedPayment('contradictory_paid');
        const before = await fixture.stored();
        const contradictory = fixture.success('contradictory_paid');
        for (let replay = 0; replay < 2; replay++) {
          const response = await fixture.deliver(contradictory);
          assert.equal(response.statusCode, 500);
          assert.equal(response.payload.received, false);
          assert.deepEqual(await fixture.stored(), before);
        }
        assert.equal(
          (
            await pool.query(
              'SELECT processing_status FROM stripe_events WHERE stripe_event_id=$1',
              [contradictory.id]
            )
          ).rows[0].processing_status,
          'failed'
        );
        assert.equal(
          (await fixture.deliver(fixture.success('valid_replay', 40000)))
            .statusCode,
          200
        );
        assert.deepEqual(await fixture.stored(), before);
        assert.deepEqual(await fixture.facts(), [
          { amount: '40000', currency: 'cad', status: 'succeeded' }
        ]);
      }
    );

    await t.test(
      'unpaid Checkout backfill uses the received PI amount and cannot qualify from a different Session price',
      async () => {
        const fixture = checkoutFixture(pool, 'unpaid_backfill');
        await fixture.start();
        const summary = await fixture.backfill(40000);
        assert.equal(summary.paymentIntents.insertedTransactions, 1);
        const before = await fixture.stored();
        assertUnknown(before);
        assert.equal(before.activity_count, 0);
        assert.equal(before.invoice_count, 0);
        assert.deepEqual(await fixture.facts(), [
          { amount: '40000', currency: 'cad', status: 'succeeded' }
        ]);
        assert.equal(
          (await fixture.backfill(40000)).paymentIntents
            .skippedExistingTransactions,
          1
        );
        assert.deepEqual(await fixture.stored(), before);
        await assert.rejects(
          fixture.backfill(50000),
          /Inconsistent payment monetary facts/
        );
        assert.deepEqual(await fixture.stored(), before);
        assert.deepEqual(await fixture.facts(), [
          { amount: '40000', currency: 'cad', status: 'succeeded' }
        ]);
      }
    );

    await t.test(
      'a journal without a confirmation marker blocks a contradictory genuinely paid Session and its replay',
      async () => {
        const fixture = checkoutFixture(pool, 'journal_without_marker');
        await fixture.start();
        await updateContributionStatusByPaymentIntent(pool, {
          stripePaymentIntentId: fixture.intentId,
          status: 'paid',
          paidAtIso: '2025-01-01T00:00:00.000Z'
        });
        await insertFundTransaction(pool, {
          stripeEventId:
            'stripe-backfill:payment_intent.succeeded:' + fixture.intentId,
          stripeObjectId: fixture.intentId,
          stripeBalanceTransactionId: null,
          type: 'payment_intent.succeeded',
          amount: 40000,
          fee: 0,
          net: 40000,
          currency: 'cad',
          status: 'succeeded',
          createdAtIso: '2025-01-01T00:00:00.000Z',
          publicCategory: 'contribution',
          metadataJson: { source: 'stripe_backfill', project: 'openg7' }
        });
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::integer n FROM contribution_payment_confirmations WHERE payment_intent_id=$1',
              [fixture.intentId]
            )
          ).rows[0].n,
          0
        );
        const before = await fixture.stored();
        assertUnknown(before);
        const item = fixture.completed('completed');
        assert.equal((await fixture.deliver(item)).statusCode, 200);
        assert.equal((await fixture.deliver(item)).payload.duplicate, true);
        assert.equal(
          (await fixture.deliver(fixture.completed('same_session'))).statusCode,
          200
        );
        assert.deepEqual(await fixture.stored(), before);
        assert.deepEqual(await fixture.facts(), [
          { amount: '40000', currency: 'cad', status: 'succeeded' }
        ]);
        assert.equal(
          before.activity_count,
          0,
          'historical confirmations remain silent'
        );
        assert.equal(before.invoice_count, 0);
      }
    );

    await t.test(
      'matching silent backfill qualifies once from its committed journal and preserves exact replay',
      async () => {
        const fixture = checkoutFixture(pool, 'matching_backfill');
        await fixture.start();
        assert.equal(
          (await fixture.backfill(50000)).paymentIntents.insertedTransactions,
          1
        );
        const first = await fixture.stored();
        assertActive(first, 0);
        assert.equal(first.invoice_count, 0);
        assert.equal(
          (await fixture.backfill(50000)).paymentIntents
            .skippedExistingTransactions,
          1
        );
        assert.deepEqual(await fixture.stored(), first);
        assert.deepEqual(await fixture.facts(), [
          { amount: '50000', currency: 'cad', status: 'succeeded' }
        ]);
      }
    );

    await t.test(
      'a success received before local Checkout insertion reconciles once from its journal',
      async () => {
        const fixture = checkoutFixture(
          pool,
          'paid_before_checkout',
          async (checkout) => {
            assert.equal(await checkout.stored(), null);
            assert.equal(
              (await checkout.deliver(checkout.success('early_paid')))
                .statusCode,
              200
            );
            assert.equal(await checkout.stored(), null);
          }
        );
        const redirect = await fixture.start();
        const first = await fixture.stored();
        assertActive(first);
        assert.deepEqual(await fixture.start(), redirect);
        assert.equal(
          (await fixture.deliver(fixture.success('replayed_paid'))).statusCode,
          200
        );
        assert.equal(
          (await fixture.deliver(fixture.completed('completed'))).statusCode,
          200
        );
        const final = await fixture.stored();
        assertActive(final);
        assert.deepEqual(final.obligation_ids, first.obligation_ids);
        assert.equal(final.version, first.version);
        assert.equal(final.invoice_count, 1);
        assert.equal(fixture.providerCalls(), 1);
        assert.deepEqual(await fixture.facts(), [
          { amount: '50000', currency: 'cad', status: 'succeeded' }
        ]);
      }
    );

    await t.test(
      'Checkout inserted between the confirmation marker and journal remains unknown until the journal commits',
      async () => {
        const entered = deferred();
        const resume = deferred();
        let pendingPayment;
        let paymentResponse;
        const fixture = checkoutFixture(
          pool,
          'checkout_during_payment',
          async (checkout) => {
            pendingPayment = checkout.deliver(
              checkout.success('racing_paid', 50000, 'ch_test_activation_race')
            );
            await Promise.race([
              entered.promise,
              pendingPayment.then(() => {
                throw new Error(
                  'Payment processing ended before the charge fixture'
                );
              })
            ]);
          }
        );
        fixture.stripe.charges.retrieve = async (id) => {
          assert.equal(id, 'ch_test_activation_race');
          entered.resolve();
          await resume.promise;
          return { id, balance_transaction: null };
        };
        try {
          await fixture.start();
          const beforeJournal = await fixture.stored();
          assertUnknown(beforeJournal);
          assert.equal(beforeJournal.activity_count, 1);
          assert.deepEqual(await fixture.facts(), []);
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::integer n FROM contribution_payment_confirmations WHERE payment_intent_id=$1',
                [fixture.intentId]
              )
            ).rows[0].n,
            1
          );
        } finally {
          resume.resolve();
          if (pendingPayment) paymentResponse = await pendingPayment;
        }
        assert.equal(paymentResponse.statusCode, 200);
        const first = await fixture.stored();
        assertActive(first);
        assert.equal(first.invoice_count, 1);
        assert.equal(
          (await fixture.deliver(fixture.success('same_facts'))).statusCode,
          200
        );
        assert.equal(
          (await fixture.deliver(fixture.completed('completed'))).statusCode,
          200
        );
        assert.deepEqual(await fixture.stored(), first);
        assert.deepEqual(await fixture.facts(), [
          { amount: '50000', currency: 'cad', status: 'succeeded' }
        ]);
      }
    );
  }
);
