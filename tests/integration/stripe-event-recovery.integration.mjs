import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import Stripe from 'stripe';

import { withStripeEventProcessing } from '../../dist/apps/funding-api/src/stripe-events.repository.js';
import { processStripeWebhook } from '../../dist/apps/funding-api/src/stripe-webhook.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const secret = 'whsec_disposable_webhook_test';
const stripe = new Stripe('sk_test_disposable_fixture', {
  host: '127.0.0.1',
  port: 1,
  protocol: 'http',
  maxNetworkRetries: 0
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const event = (id, type = 'test.ignored', object = {}) => ({
  id,
  type,
  object: 'event',
  created: 1_789_200_000,
  data: { object },
  livemode: false
});
const input = (item) => ({
  stripeEventId: item.id,
  eventType: item.type,
  payload: item
});
const deliver = (pool, item, stripeClient = stripe) => {
  const payload = JSON.stringify(item);
  return processStripeWebhook(
    payload,
    stripe.webhooks.generateTestHeaderString({
      payload,
      secret
    }),
    {
      stripe: stripeClient,
      webhookSecret: secret,
      pool,
      publicBaseUrl: 'https://example.test'
    }
  );
};

test('Stripe event ownership and recovery on disposable PostgreSQL', async (t) => {
  const { pool, stop } = await startDisposablePostgres();
  t.after(stop);
  await pool.query(
    'CREATE TABLE webhook_test_effects (event_id text PRIMARY KEY)'
  );

  const status = async (id) =>
    (
      await pool.query(
        'SELECT processing_status FROM stripe_events WHERE stripe_event_id = $1',
        [id]
      )
    ).rows[0]?.processing_status;

  await t.test(
    'invalid signatures never reserve or persist an event',
    async () => {
      const item = event('evt_invalid_signature');
      const response = await processStripeWebhook(
        JSON.stringify(item),
        'invalid',
        {
          stripe,
          webhookSecret: secret,
          pool,
          publicBaseUrl: 'https://example.test'
        }
      );
      assert.equal(response.statusCode, 400);
      assert.equal(await status(item.id), undefined);
    }
  );

  await t.test(
    'processing left by an exited process resumes without a timeout',
    async () => {
      const item = event('evt_orphaned');
      await pool.query(
        `INSERT INTO stripe_events (stripe_event_id, event_type, payload, processing_status)
       VALUES ($1, $2, $3, 'processing')`,
        [item.id, item.type, JSON.stringify(item)]
      );
      const response = await deliver(pool, item);
      assert.equal(response.statusCode, 200);
      assert.equal(response.payload.ignored, true);
      assert.equal(await status(item.id), 'processed');
      assert.equal((await deliver(pool, item)).payload.duplicate, true);
    }
  );

  await t.test(
    'a concurrent delivery retries until its active owner finishes',
    async () => {
      const item = event('evt_concurrent');
      const started = deferred();
      const finish = deferred();
      const first = withStripeEventProcessing(
        pool,
        input(item),
        async (eventPool) => {
          await eventPool.query(
            'INSERT INTO webhook_test_effects VALUES ($1)',
            [item.id]
          );
          const borrowed = await eventPool.connect();
          borrowed.release();
          started.resolve();
          await finish.promise;
          // Inner repository release must not have released the lock connection.
          await eventPool.query('SELECT 1');
        }
      );
      try {
        await started.promise;
        assert.equal((await deliver(pool, item)).statusCode, 503);
        assert.equal(await status(item.id), 'processing');
      } finally {
        finish.resolve();
      }
      assert.equal((await first).status, 'processed');
      assert.equal((await deliver(pool, item)).payload.duplicate, true);
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int AS count FROM webhook_test_effects WHERE event_id=$1',
            [item.id]
          )
        ).rows[0].count,
        1
      );
    }
  );

  await t.test(
    'losing the owning connection rolls back and fences the old processor',
    async () => {
      const item = event('evt_disconnected');
      const started = deferred();
      const disconnected = deferred();
      const resumeOldProcessor = deferred();
      const first = withStripeEventProcessing(
        pool,
        input(item),
        async (eventPool) => {
          const borrowed = await eventPool.connect();
          borrowed.once('error', disconnected.resolve);
          await borrowed.query('BEGIN');
          await borrowed.query('INSERT INTO webhook_test_effects VALUES ($1)', [
            item.id
          ]);
          const pid = (await borrowed.query('SELECT pg_backend_pid() AS pid'))
            .rows[0].pid;
          started.resolve(pid);
          await resumeOldProcessor.promise;
          await eventPool.query(
            'INSERT INTO webhook_test_effects VALUES ($1)',
            [item.id]
          );
        }
      ).then(
        () => null,
        (error) => error
      );
      try {
        const pid = await started.promise;
        await pool.query('SELECT pg_terminate_backend($1)', [pid]);
        await disconnected.promise;
        const retry = await withStripeEventProcessing(
          pool,
          input(item),
          async (eventPool) => {
            await eventPool.query(
              'INSERT INTO webhook_test_effects VALUES ($1)',
              [item.id]
            );
          }
        );
        assert.equal(retry.status, 'processed');
      } finally {
        resumeOldProcessor.resolve();
      }
      assert.match((await first).message, /connection is unavailable/);
      assert.equal(await status(item.id), 'processed');
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int AS count FROM webhook_test_effects WHERE event_id=$1',
            [item.id]
          )
        ).rows[0].count,
        1
      );
    }
  );

  await t.test(
    'an aborted repository transaction is rolled back before marking failed',
    async () => {
      const item = event('evt_transaction_failure');
      await assert.rejects(
        withStripeEventProcessing(pool, input(item), async (eventPool) => {
          const borrowed = await eventPool.connect();
          await borrowed.query('BEGIN');
          await borrowed.query('INSERT INTO webhook_test_effects VALUES ($1)', [
            item.id
          ]);
          await borrowed.query('SELECT 1 / 0');
        }),
        /division by zero/
      );
      assert.equal(await status(item.id), 'failed');
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int AS count FROM webhook_test_effects WHERE event_id=$1',
            [item.id]
          )
        ).rows[0].count,
        0
      );
      assert.equal((await deliver(pool, item)).statusCode, 200);
      assert.equal(await status(item.id), 'processed');
    }
  );

  await t.test(
    'transient Stripe reads retry without duplicating the financial transaction',
    async () => {
      const item = event('evt_retry_payment', 'payment_intent.succeeded', {
        id: 'pi_recovery_payment',
        amount: 2500,
        amount_received: 2500,
        currency: 'cad',
        created: 1_789_200_000,
        status: 'succeeded',
        latest_charge: 'ch_recovery_payment',
        metadata: {}
      });
      let attempts = 0;
      const client = {
        webhooks: stripe.webhooks,
        charges: {
          async retrieve() {
            attempts++;
            if (attempts === 1)
              throw new Error('Simulated transient Stripe outage');
            return {
              balance_transaction: {
                id: 'txn_recovery_payment',
                amount: 2500,
                fee: 102,
                net: 2398,
                currency: 'cad'
              }
            };
          }
        }
      };
      assert.equal((await deliver(pool, item, client)).statusCode, 500);
      assert.equal(await status(item.id), 'failed');
      assert.equal((await deliver(pool, item, client)).statusCode, 200);
      assert.equal((await deliver(pool, item, client)).payload.duplicate, true);
      assert.equal(attempts, 2);
      const rows = await pool.query(
        'SELECT amount, fee, net FROM fund_transactions WHERE stripe_event_id=$1',
        [item.id]
      );
      // pg preserves BIGINT values as exact decimal strings.
      assert.deepEqual(rows.rows, [
        { amount: '2500', fee: '102', net: '2398' }
      ]);
    }
  );

  await t.test(
    'checkout crash recovery retains one invoice and deferred email per purpose',
    async () => {
      const token = 'A'.repeat(43);
      const session = {
        id: 'cs_recovery_sponsor',
        payment_intent: 'pi_recovery_sponsor',
        amount_total: 5000,
        currency: 'cad',
        created: 1_789_200_000,
        payment_status: 'paid',
        customer_details: { email: 'sponsor@example.test' },
        success_url: `https://example.test/followup?token=${token}`,
        metadata: {
          contributionType: 'sponsorship_interest',
          publicReference: 'OG7-2026-RCVR',
          publicDisplayConsent: 'false',
          nonCharityAcknowledged: 'true',
          sponsorshipFollowupTokenHash: createHash('sha256')
            .update(token)
            .digest('hex')
        }
      };
      const item = event(
        'evt_recovery_sponsor',
        'checkout.session.completed',
        session
      );
      const first = await deliver(pool, item);
      assert.equal(first.statusCode, 200);
      assert.equal(first.payload.followupEmailSent, false);
      assert.equal(first.payload.sponsorshipInvoiceEmailSent, false);
      const invoiceBefore = (
        await pool.query(
          'SELECT id, invoice_number FROM sponsorship_invoices WHERE stripe_session_id=$1',
          [session.id]
        )
      ).rows;
      // Model a crash after the writes and before the event was acknowledged.
      await pool.query(
        "UPDATE stripe_events SET processing_status='processing', processed_at=NULL WHERE stripe_event_id=$1",
        [item.id]
      );
      assert.equal((await deliver(pool, item)).statusCode, 200);
      // A distinct event for the same logical Checkout Session is also deduplicated.
      assert.equal(
        (await deliver(pool, { ...item, id: 'evt_recovery_sponsor_repeat' }))
          .statusCode,
        200
      );
      assert.deepEqual(
        (
          await pool.query(
            'SELECT id, invoice_number FROM sponsorship_invoices WHERE stripe_session_id=$1',
            [session.id]
          )
        ).rows,
        invoiceBefore
      );
      assert.equal(invoiceBefore.length, 1);
      const emails = (
        await pool.query(
          'SELECT template_key, status, attempts FROM email_messages WHERE idempotency_key LIKE $1 ORDER BY template_key',
          [`stripe-session:${session.id}:%`]
        )
      ).rows;
      assert.deepEqual(emails, [
        { template_key: 'sponsorship_followup', status: 'queued', attempts: 0 },
        { template_key: 'sponsorship_invoice', status: 'queued', attempts: 0 }
      ]);
    }
  );
});
