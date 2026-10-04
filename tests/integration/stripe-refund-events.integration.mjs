import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Stripe from 'stripe';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { processStripeWebhook } from '../../dist/apps/funding-api/src/stripe-webhook.service.js';
import { withStripeEventProcessing } from '../../dist/apps/funding-api/src/stripe-events.repository.js';
import {
  upsertCheckoutSessionFromWebhook,
  getSponsorshipRefundTarget
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import {
  beginSponsorshipRefundOperation,
  settleSponsorshipRefundOperation
} from '../../dist/apps/funding-api/src/sponsorship-refund-operations.js';
import { createSponsorshipInvoiceForStripeSession } from '../../dist/apps/funding-api/src/sponsorship-invoices.repository.js';
import { getPublicTransparencySummary } from '../../dist/apps/funding-api/src/fund-transparency.repository.js';

const signer = new Stripe('sk_test_synthetic_refund_events', {
  host: '127.0.0.1',
  port: 1,
  protocol: 'http',
  maxNetworkRetries: 0
});
const secret = 'whsec_synthetic_refund_events';

async function fixture(pool, { invoice = true, amount = 10000 } = {}) {
  const suffix = randomUUID().replaceAll('-', '');
  const sessionId = 'cs_' + suffix;
  const intentId = 'pi_' + suffix;
  await upsertCheckoutSessionFromWebhook(pool, {
    stripeSessionId: sessionId,
    stripePaymentIntentId: intentId,
    publicReference: null,
    contributionType: 'sponsorship_interest',
    amountCents: 10000,
    currency: 'cad',
    metadata: { projectId: 'openg7' },
    publicDisplayConsent: false,
    publicName: null,
    displayAmountConsent: false,
    nonCharityAcknowledged: true,
    sponsorshipFollowupTokenHash: null,
    status: 'paid',
    paidAtIso: new Date().toISOString(),
    emailPrivate: 'synthetic@example.test'
  });
  const id = (
    await pool.query(
      'SELECT id FROM fund_contributions WHERE stripe_session_id=$1',
      [sessionId]
    )
  ).rows[0].id;
  const invoiceInput = {
    stripeSessionId: sessionId,
    stripePaymentIntentId: intentId,
    publicReference: null,
    amountCents: 10000,
    currency: 'cad',
    paidAtIso: new Date().toISOString(),
    customerEmail: 'synthetic@example.test'
  };
  if (invoice)
    await createSponsorshipInvoiceForStripeSession(pool, invoiceInput);
  const target = await getSponsorshipRefundTarget(pool, id);
  const operationId = await beginSponsorshipRefundOperation(pool, {
    contributionId: id,
    expectedVersion: target.version,
    paymentIntentId: intentId,
    amountMinor: amount,
    currency: 'cad',
    reason: 'requested_by_customer',
    note: null,
    actor: 'synthetic-refund-review'
  });
  let refund = {
    id: 're_' + suffix,
    object: 'refund',
    amount,
    currency: 'cad',
    status: 'pending',
    created: Math.floor(Date.now() / 1000),
    payment_intent: intentId,
    charge: 'ch_' + suffix,
    metadata: { openg7RefundOperationId: operationId },
    balance_transaction: null
  };
  await settleSponsorshipRefundOperation(pool, refund);
  const charge = {
    id: refund.charge,
    object: 'charge',
    amount: 10000,
    amount_refunded: amount,
    currency: 'cad',
    status: 'succeeded',
    payment_intent: intentId,
    metadata: {},
    balance_transaction: null,
    // Deliberately retain the older pending snapshot; the handler must use Refund's current state.
    refunds: { data: [structuredClone(refund)], has_more: false }
  };
  let retrieveCount = 0;
  let failRetrieve = false;
  const stripe = {
    webhooks: signer.webhooks,
    paymentIntents: {
      async retrieve() {
        return { id: intentId, metadata: { projectId: 'openg7' } };
      }
    },
    refunds: {
      async retrieve() {
        retrieveCount++;
        if (failRetrieve) throw new Error('Synthetic transient refund outage');
        return structuredClone(refund);
      },
      async *list() {
        yield* charge.refunds.data;
      }
    },
    charges: {
      async retrieve() {
        return structuredClone(charge);
      }
    }
  };
  const deliver = async ({
    type = 'refund.updated',
    eventId = 'evt_' + randomUUID(),
    snapshot = refund,
    signature
  } = {}) => {
    const raw = JSON.stringify({
      id: eventId,
      type,
      data: { object: snapshot }
    });
    return processStripeWebhook(
      raw,
      signature ??
        signer.webhooks.generateTestHeaderString({ payload: raw, secret }),
      {
        stripe,
        webhookSecret: secret,
        pool,
        projectId: 'openg7',
        publicBaseUrl: 'https://example.test'
      }
    );
  };
  return {
    id,
    operationId,
    invoiceInput,
    charge,
    stripe,
    deliver,
    get refund() {
      return refund;
    },
    set refund(value) {
      refund = value;
    },
    get retrieveCount() {
      return retrieveCount;
    },
    set failRetrieve(value) {
      failRetrieve = value;
    }
  };
}

const documents = (pool) =>
  pool.query(
    'SELECT id,invoice_id,invoice_number,stripe_refund_id,total_cents,issued_at,line_items,notes FROM sponsorship_credit_notes ORDER BY id'
  );
const ledger = (pool) =>
  pool.query('SELECT * FROM fund_transactions ORDER BY id');
const status = async (pool, f) => ({
  operation: (
    await pool.query(
      'SELECT status FROM sponsorship_refund_operations WHERE id=$1',
      [f.operationId]
    )
  ).rows[0].status,
  workflow: (await getSponsorshipRefundTarget(pool, f.id)).refundWorkflowStatus
});

test(
  'asynchronous refund events reconcile safely on disposable PostgreSQL',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    t.beforeEach(() =>
      pool.query(
        'TRUNCATE fund_contributions,stripe_checkout_sessions,stripe_events,fund_transactions,email_messages CASCADE'
      )
    );

    await t.test(
      'invalid signatures do not read Stripe or change the pending operation',
      async () => {
        const f = await fixture(pool);
        assert.equal(
          (await f.deliver({ signature: 'invalid' })).statusCode,
          400
        );
        assert.equal(f.retrieveCount, 0);
        assert.deepEqual(await status(pool, f), {
          operation: 'pending',
          workflow: 'processing'
        });
        assert.equal((await ledger(pool)).rows.length, 0);
      }
    );

    await t.test(
      'a borrowed destruction request releases its session locks and lets an interrupted event resume',
      async () => {
        const eventId = 'evt_' + randomUUID();
        const lockKey = 'stripe-refund-reconciliation:re_' + randomUUID();
        let ownerPid;
        const input = {
          stripeEventId: eventId,
          eventType: 'refund.updated',
          payload: {}
        };
        await assert.rejects(
          withStripeEventProcessing(pool, input, async (eventPool) => {
            const borrowed = await eventPool.connect();
            ownerPid = (await borrowed.query('SELECT pg_backend_pid() AS pid'))
              .rows[0].pid;
            await borrowed.query(
              'SELECT pg_advisory_lock(hashtextextended($1::text,0))',
              [lockKey]
            );
            try {
              // A SQL unlock failure can leave a session lock without a network error.
              await borrowed.query('SELECT 1 / 0');
            } catch (error) {
              borrowed.release(true);
              throw error;
            }
          }),
          /division by zero/
        );
        const next = await pool.connect();
        try {
          assert.notEqual(
            (await next.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
            ownerPid
          );
          assert.equal(
            (
              await next.query(
                'SELECT pg_try_advisory_lock(hashtextextended($1::text,0)) AS locked',
                [lockKey]
              )
            ).rows[0].locked,
            true
          );
          await next.query(
            'SELECT pg_advisory_unlock(hashtextextended($1::text,0))',
            [lockKey]
          );
        } finally {
          next.release();
        }
        assert.equal(
          (
            await pool.query(
              'SELECT processing_status FROM stripe_events WHERE stripe_event_id=$1',
              [eventId]
            )
          ).rows[0].processing_status,
          'processing'
        );
        assert.equal(
          (
            await withStripeEventProcessing(pool, input, async () => ({
              resumed: true
            }))
          ).status,
          'processed'
        );
      }
    );

    await t.test(
      'pending succeeds without a charge event, creates one credit note, and never manufactures notification consent',
      async () => {
        const f = await fixture(pool);
        const stale = structuredClone(f.refund);
        f.refund = { ...f.refund, status: 'succeeded' };
        const eventId = 'evt_' + randomUUID();
        const response = await f.deliver({ eventId, snapshot: stale });
        assert.equal(response.statusCode, 200);
        assert.equal(response.payload.creditNoteAvailable, true);
        assert.deepEqual(await status(pool, f), {
          operation: 'succeeded',
          workflow: 'completed'
        });
        assert.equal(
          (await getSponsorshipRefundTarget(pool, f.id)).paymentStatus,
          'refunded'
        );
        assert.equal(
          (await getPublicTransparencySummary(pool)).total_refunded,
          100
        );
        const issued = (await documents(pool)).rows;
        assert.equal(issued.length, 1);
        assert.equal(issued[0].total_cents, 10000);
        assert.equal(
          (await f.deliver({ eventId, snapshot: stale })).payload.duplicate,
          true
        );
        assert.equal(f.retrieveCount, 1);
        const repeats = await Promise.all([
          f.deliver({ snapshot: stale }),
          f.deliver({ snapshot: stale })
        ]);
        assert.ok(repeats.every((r) => r.statusCode === 200));
        assert.equal((await ledger(pool)).rows.length, 1);
        assert.deepEqual((await documents(pool)).rows, issued);
        assert.equal(
          (await pool.query('SELECT count(*)::int n FROM email_messages'))
            .rows[0].n,
          0
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM admin_audit_log WHERE action='sponsorship_refund.succeeded'"
            )
          ).rows[0].n,
          1
        );
      }
    );

    await t.test(
      'current failure settles pending, and an older success snapshot cannot create a refund',
      async () => {
        const f = await fixture(pool, { amount: 2000 });
        const staleSuccess = { ...f.refund, status: 'succeeded' };
        f.refund = { ...f.refund, status: 'failed' };
        assert.equal(
          (await f.deliver({ type: 'refund.failed' })).statusCode,
          200
        );
        assert.deepEqual(await status(pool, f), {
          operation: 'failed',
          workflow: 'failed'
        });
        assert.equal(
          (await f.deliver({ snapshot: staleSuccess })).statusCode,
          200
        );
        assert.equal((await ledger(pool)).rows.length, 0);
        assert.equal((await documents(pool)).rows.length, 0);
        assert.equal(
          (await getSponsorshipRefundTarget(pool, f.id)).paymentStatus,
          'paid'
        );
        const oldCharge = {
          ...f.charge,
          refunds: { data: [staleSuccess], has_more: false }
        };
        assert.equal(
          (await f.deliver({ type: 'charge.refunded', snapshot: oldCharge }))
            .statusCode,
          500
        );
        assert.equal((await ledger(pool)).rows.length, 0);
      }
    );

    await t.test(
      'concurrent stale charge success cannot insert after a current failure settles the operation',
      async () => {
        const f = await fixture(pool);
        let releaseBalance;
        let balanceStarted;
        const balanceReady = new Promise((resolve) => {
          balanceStarted = resolve;
        });
        const balanceReleased = new Promise((resolve) => {
          releaseBalance = resolve;
        });
        f.stripe.balanceTransactions = {
          async retrieve() {
            balanceStarted();
            await balanceReleased;
            return {
              id: 'txn_synthetic_refund',
              amount: -10000,
              fee: 0,
              net: -10000,
              currency: 'cad'
            };
          }
        };
        const stale = {
          ...f.charge,
          refunds: {
            data: [
              {
                ...f.refund,
                status: 'succeeded',
                balance_transaction: 'txn_synthetic_refund'
              }
            ],
            has_more: false
          }
        };
        const delivery = f.deliver({
          type: 'charge.refunded',
          snapshot: stale
        });
        await balanceReady;
        try {
          f.refund = { ...f.refund, status: 'failed' };
          assert.equal(
            (await f.deliver({ type: 'refund.failed' })).statusCode,
            200
          );
        } finally {
          releaseBalance();
        }
        assert.equal((await delivery).statusCode, 500);
        assert.equal((await ledger(pool)).rows.length, 0);
        assert.equal((await documents(pool)).rows.length, 0);
        assert.deepEqual(await status(pool, f), {
          operation: 'failed',
          workflow: 'failed'
        });
      }
    );

    await t.test(
      'failure after a confirmed refund is quarantined for compensation without changing its ledger or issued document',
      async () => {
        const f = await fixture(pool);
        f.refund = { ...f.refund, status: 'succeeded' };
        assert.equal((await f.deliver()).statusCode, 200);
        const originalLedger = (await ledger(pool)).rows;
        const originalDocuments = (await documents(pool)).rows;
        f.refund = { ...f.refund, status: 'failed' };
        const eventId = 'evt_' + randomUUID();
        assert.equal(
          (await f.deliver({ type: 'refund.failed', eventId })).statusCode,
          500
        );
        assert.equal(
          (
            await pool.query(
              'SELECT processing_status FROM stripe_events WHERE stripe_event_id=$1',
              [eventId]
            )
          ).rows[0].processing_status,
          'failed'
        );
        assert.deepEqual((await ledger(pool)).rows, originalLedger);
        assert.deepEqual((await documents(pool)).rows, originalDocuments);
        assert.deepEqual(await status(pool, f), {
          operation: 'succeeded',
          workflow: 'completed'
        });
      }
    );

    await t.test(
      'transient provider failure keeps the event retryable without creating financial facts',
      async () => {
        const f = await fixture(pool, { amount: 2000 });
        f.refund = { ...f.refund, status: 'succeeded' };
        f.failRetrieve = true;
        const eventId = 'evt_' + randomUUID();
        assert.equal((await f.deliver({ eventId })).statusCode, 500);
        assert.deepEqual(await status(pool, f), {
          operation: 'pending',
          workflow: 'processing'
        });
        assert.equal((await ledger(pool)).rows.length, 0);
        f.failRetrieve = false;
        assert.equal((await f.deliver({ eventId })).statusCode, 200);
        assert.equal((await ledger(pool)).rows.length, 1);
        assert.equal((await documents(pool)).rows.length, 1);
        assert.equal(
          (await getSponsorshipRefundTarget(pool, f.id)).paymentStatus,
          'paid'
        );
      }
    );

    await t.test(
      'a missing invoice fails document completion and retry resumes without duplicating the confirmed refund',
      async () => {
        const f = await fixture(pool, { invoice: false, amount: 2000 });
        f.refund = { ...f.refund, status: 'succeeded' };
        const eventId = 'evt_' + randomUUID();
        assert.equal((await f.deliver({ eventId })).statusCode, 500);
        assert.equal((await ledger(pool)).rows.length, 1);
        assert.equal((await documents(pool)).rows.length, 0);
        await createSponsorshipInvoiceForStripeSession(pool, f.invoiceInput);
        assert.equal((await f.deliver({ eventId })).statusCode, 200);
        assert.equal((await ledger(pool)).rows.length, 1);
        assert.equal((await documents(pool)).rows.length, 1);
      }
    );

    await t.test(
      'provider facts inconsistent with the signed snapshot, operation or charge are rejected before any refund write',
      async () => {
        for (const mutate of [
          (f) => {
            f.refund = { ...f.refund, amount: 2500 };
          },
          (f) => {
            f.refund = { ...f.refund, currency: 'usd' };
          },
          (f) => {
            f.charge.payment_intent = 'pi_other';
          },
          (f) => {
            f.charge.currency = 'usd';
          }
        ]) {
          const f = await fixture(pool, { amount: 2000 });
          const snapshot = { ...f.refund, status: 'succeeded' };
          f.refund = { ...f.refund, status: 'succeeded' };
          mutate(f);
          assert.equal((await f.deliver({ snapshot })).statusCode, 500);
          assert.deepEqual(await status(pool, f), {
            operation: 'pending',
            workflow: 'processing'
          });
        }
        assert.equal((await ledger(pool)).rows.length, 0);
        assert.equal((await documents(pool)).rows.length, 0);
      }
    );

    await t.test(
      'current conflicting project metadata never changes the local operation',
      async () => {
        const f = await fixture(pool, { amount: 2000 });
        const snapshot = {
          ...f.refund,
          metadata: { ...f.refund.metadata, projectId: 'openg7' }
        };
        f.refund = {
          ...f.refund,
          status: 'succeeded',
          metadata: { ...f.refund.metadata, projectId: 'other' }
        };
        const response = await f.deliver({ snapshot });
        assert.equal(response.statusCode, 200);
        assert.equal(response.payload.reason, 'PROJECT_MISMATCH');
        assert.deepEqual(await status(pool, f), {
          operation: 'pending',
          workflow: 'processing'
        });
        assert.equal((await ledger(pool)).rows.length, 0);
      }
    );
  }
);
