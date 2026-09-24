import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import Stripe from 'stripe';

import { runStripeBackfill } from '../../dist/apps/funding-api/src/stripe-backfill.service.js';
import { processStripeWebhook } from '../../dist/apps/funding-api/src/stripe-webhook.service.js';
import {
  getPublicTransparencySummary,
  insertFundTransaction
} from '../../dist/apps/funding-api/src/fund-transparency.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const signer = new Stripe('sk_test_synthetic_signer_only');
const secret = 'whsec_synthetic_history_test';
const options = {
  projectId: 'openg7',
  includeUnmatched: false,
  includePayouts: false,
  includeRefunds: false,
  includeDisputes: false,
  dryRun: false,
  assumeNonCharityAcknowledged: false,
  created: null,
  maxRecords: 10
};

function fixture() {
  const suffix = randomUUID().replaceAll('-', '');
  const token = 'synthetic-history-token-' + suffix;
  const metadata = {
    projectId: 'openg7',
    contributionType: 'sponsorship_interest',
    publicReference: 'OG7-2026-' + suffix.slice(0, 8).toUpperCase(),
    publicDisplayConsent: 'true',
    displayAmountConsent: 'true',
    publicDisplayName: 'Nom historique',
    nonCharityAcknowledged: 'true',
    sponsorshipFollowupTokenHash: createHash('sha256')
      .update(token)
      .digest('hex')
  };
  const balance = {
    id: 'txn_' + suffix,
    amount: 25000,
    fee: 755,
    net: 24245,
    currency: 'cad'
  };
  const charge = {
    id: 'ch_' + suffix,
    balance_transaction: balance,
    amount: 25000,
    amount_refunded: 0,
    currency: 'cad',
    status: 'succeeded'
  };
  const intent = {
    id: 'pi_' + suffix,
    object: 'payment_intent',
    amount: 25000,
    amount_received: 25000,
    currency: 'cad',
    status: 'succeeded',
    created: 1788264000,
    latest_charge: charge,
    metadata
  };
  const session = {
    id: 'cs_' + suffix,
    object: 'checkout.session',
    payment_status: 'paid',
    amount_total: 25000,
    currency: 'cad',
    created: 1788264000,
    payment_intent: intent,
    client_reference_id: metadata.publicReference,
    metadata,
    success_url: 'http://localhost/success?followup_token=' + token,
    customer_details: { email: 'history@simulation.example.test' }
  };
  const stripe = {
    webhooks: signer.webhooks,
    checkout: {
      sessions: {
        async *list() {
          yield session;
        }
      }
    },
    charges: {
      async retrieve() {
        return charge;
      }
    }
  };
  return { stripe, intent, session };
}

test(
  'historical payments survive backfill, late webhooks and local dossier changes',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    t.beforeEach(() =>
      pool.query(
        'TRUNCATE fund_contributions, stripe_checkout_sessions, stripe_events, fund_transactions, email_messages CASCADE'
      )
    );
    const send = async (f, type, object, eventId = 'evt_' + randomUUID()) => {
      const body = JSON.stringify({
        id: eventId,
        object: 'event',
        type,
        livemode: false,
        created: Math.floor(Date.now() / 1000),
        data: { object }
      });
      const signature = signer.webhooks.generateTestHeaderString({
        payload: body,
        secret
      });
      const result = await processStripeWebhook(body, signature, {
        stripe: f.stripe,
        pool,
        webhookSecret: secret,
        publicBaseUrl: 'http://localhost'
      });
      assert.equal(result.statusCode, 200, JSON.stringify(result.payload));
    };
    const ledger = async () =>
      (await pool.query('SELECT * FROM fund_transactions ORDER BY id')).rows;
    const checkAmounts = async () => {
      const report = await getPublicTransparencySummary(pool);
      assert.equal(report.total_received, 250);
      assert.equal(report.total_fees, 7.55);
      assert.equal(report.total_net, 242.45);
      assert.equal(report.contributions_count, 1);
      assert.equal(report.monthly_summary[0].total_fees, 7.55);
    };
    await t.test(
      'dry-run creates nothing; late distinct payment events keep one ledger row',
      async () => {
        const f = fixture();
        assert.equal(
          (
            await runStripeBackfill(f.stripe, pool, {
              ...options,
              dryRun: true
            })
          ).paymentIntents.dryRunWouldInsertTransactions,
          1
        );
        assert.equal((await ledger()).length, 0);
        assert.equal(
          (await pool.query('SELECT * FROM fund_contributions')).rowCount,
          0
        );
        await runStripeBackfill(f.stripe, pool, options);
        const original = await ledger();
        await Promise.all(
          Array.from({ length: 4 }, () =>
            send(f, 'payment_intent.succeeded', f.intent)
          )
        );
        assert.deepEqual(await ledger(), original);
        await checkAmounts();
      }
    );
    await t.test(
      'a webhook and backfill racing to persist a payment count its fees once',
      async () => {
        const f = fixture();
        await Promise.all([
          runStripeBackfill(f.stripe, pool, options),
          send(f, 'payment_intent.succeeded', f.intent)
        ]);
        assert.equal((await ledger()).length, 1);
        await runStripeBackfill(f.stripe, pool, options);
        await checkAmounts();
      }
    );
    await t.test(
      'historical Checkout replay creates no payment notification, followup email or invoice',
      async () => {
        const f = fixture();
        await runStripeBackfill(f.stripe, pool, options);
        await send(f, 'checkout.session.completed', f.session);
        for (const table of [
          'contribution_activity',
          'email_messages',
          'sponsorship_invoices'
        ]) {
          assert.equal(
            (await pool.query('SELECT * FROM ' + table)).rowCount,
            0,
            table
          );
        }
      }
    );
    await t.test(
      'imports and old Checkout metadata preserve the current local consent and public name',
      async () => {
        const f = fixture();
        await runStripeBackfill(f.stripe, pool, options);
        await pool.query(
          "UPDATE fund_contributions SET public_display_consent=false, display_amount_consent=false, public_name='Nom corrigé localement', non_charity_acknowledged=false"
        );
        const current = async () =>
          (
            await pool.query(
              'SELECT public_display_consent,display_amount_consent,public_name,non_charity_acknowledged FROM fund_contributions'
            )
          ).rows;
        const before = await current();
        await runStripeBackfill(f.stripe, pool, options);
        assert.deepEqual(await current(), before);
        await send(f, 'checkout.session.completed', f.session);
        assert.deepEqual(await current(), before);
      }
    );
    await t.test(
      'legacy duplicate payment rows remain intact and contribute fees only once',
      async () => {
        const f = fixture();
        await runStripeBackfill(f.stripe, pool, options);
        await pool.query(`INSERT INTO fund_transactions
      (stripe_event_id,stripe_object_id,stripe_balance_transaction_id,type,amount,fee,net,currency,status,created_at,public_category,metadata_json)
      SELECT 'evt_legacy_duplicate',stripe_object_id,stripe_balance_transaction_id,type,amount,fee,net,currency,status,created_at,public_category,metadata_json FROM fund_transactions`);
        // The older row was recorded before its fee-bearing balance transaction arrived.
        await pool.query(
          'UPDATE fund_transactions SET stripe_balance_transaction_id=NULL, fee=0, net=amount WHERE id=(SELECT MIN(id) FROM fund_transactions)'
        );
        const before = await ledger();
        await checkAmounts();
        assert.deepEqual(await ledger(), before);
        await pool.query(
          'ALTER TABLE fund_contributions RENAME TO history_test_contributions'
        );
        try {
          await checkAmounts();
        } finally {
          await pool.query(
            'ALTER TABLE history_test_contributions RENAME TO fund_contributions'
          );
        }
      }
    );
    await t.test(
      'a failed ledger write can be retried after the contribution was imported',
      async () => {
        const f = fixture();
        await pool.query(`CREATE FUNCTION history_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic import interruption'; END $$;
        CREATE TRIGGER history_test_failure BEFORE INSERT ON fund_transactions FOR EACH ROW EXECUTE FUNCTION history_test_failure()`);
        try {
          await assert.rejects(
            runStripeBackfill(f.stripe, pool, options),
            /synthetic import interruption/
          );
        } finally {
          await pool.query(
            'DROP TRIGGER history_test_failure ON fund_transactions; DROP FUNCTION history_test_failure()'
          );
        }
        assert.equal(
          (await pool.query('SELECT * FROM fund_contributions')).rowCount,
          1
        );
        assert.equal((await ledger()).length, 0);
        await runStripeBackfill(f.stripe, pool, options);
        await checkAmounts();
        assert.equal(
          (await pool.query('SELECT * FROM contribution_activity')).rowCount,
          0
        );
        assert.equal(
          (await pool.query('SELECT * FROM email_messages')).rowCount,
          0
        );
      }
    );
    await t.test(
      'a new live Checkout still creates its unique activity, followup and invoice',
      async () => {
        const f = fixture();
        await send(f, 'checkout.session.completed', f.session);
        await send(f, 'checkout.session.completed', f.session);
        assert.equal(
          (await pool.query('SELECT * FROM contribution_activity')).rowCount,
          1
        );
        assert.equal(
          (await pool.query('SELECT * FROM email_messages')).rowCount,
          2
        );
        assert.equal(
          (await pool.query('SELECT * FROM sponsorship_invoices')).rowCount,
          1
        );
      }
    );
    await t.test(
      'contradictory duplicate payment amounts are rejected without modifying the ledger',
      async () => {
        const f = fixture();
        await runStripeBackfill(f.stripe, pool, options);
        const before = await ledger();
        await assert.rejects(
          insertFundTransaction(pool, {
            stripeEventId: 'evt_conflict',
            stripeObjectId: f.intent.id,
            stripeBalanceTransactionId: null,
            type: 'payment_intent.succeeded',
            amount: 100,
            fee: 0,
            net: 100,
            currency: 'cad',
            status: 'succeeded',
            createdAtIso: '2026-09-01T12:00:00Z',
            publicCategory: 'contribution',
            metadataJson: { source: 'stripe' }
          }),
          /monetary facts/i
        );
        assert.deepEqual(await ledger(), before);
      }
    );
  }
);
