import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getAdminDashboard,
  insertCheckoutSessionRecord,
  listAdminContributions,
  updateContributionStatusByPaymentIntent,
  upsertCheckoutSessionFromWebhook
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import {
  getPublicTransparencySummary,
  insertFundTransaction
} from '../../dist/apps/funding-api/src/fund-transparency.repository.js';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const paidAtIso = '2026-08-01T12:00:00.000Z';
const checkout = (name) => ({
  stripeSessionId: `cs_test_${name}`,
  stripePaymentIntentId: `pi_test_${name}`,
  publicReference: null,
  contributionType: 'personal_support',
  amountCents: 10_000,
  currency: 'cad',
  metadata: {},
  publicDisplayConsent: false,
  publicName: null,
  displayAmountConsent: false,
  nonCharityAcknowledged: true,
  sponsorshipFollowupTokenHash: null
});

const updateStatus = (pool, fixture, status) =>
  updateContributionStatusByPaymentIntent(pool, {
    stripePaymentIntentId: fixture.stripePaymentIntentId,
    status,
    paidAtIso
  });

const deliverCheckout = (pool, fixture, status) =>
  upsertCheckoutSessionFromWebhook(pool, {
    ...fixture,
    status,
    paidAtIso: status === 'paid' ? paidAtIso : null,
    emailPrivate: null
  });

const assertStatus = async (pool, fixture, expected) => {
  const result = await pool.query(
    `SELECT c.status AS contribution_status, s.status AS session_status,
            c.paid_at
       FROM fund_contributions c
       JOIN stripe_checkout_sessions s USING (stripe_session_id)
      WHERE c.stripe_session_id = $1`,
    [fixture.stripeSessionId]
  );
  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0].contribution_status, expected);
  assert.equal(result.rows[0].session_status, expected);
  if (
    expected === 'paid' ||
    expected === 'disputed' ||
    expected === 'refunded'
  ) {
    assert.equal(result.rows[0].paid_at.toISOString(), paidAtIso);
  }
};

const refundTransaction = (fixture, name, amount) => ({
  stripeEventId: `evt_test_${name}`,
  stripeObjectId: `re_test_${name}`,
  stripeBalanceTransactionId: `txn_test_${name}`,
  type: 'charge.refunded',
  amount,
  fee: 0,
  net: -amount,
  currency: 'cad',
  status: 'succeeded',
  createdAtIso: paidAtIso,
  publicCategory: 'refund',
  metadataJson: { payment_intent: fixture.stripePaymentIntentId }
});

const assertRefundTotals = async (pool, expected) => {
  const [dashboard, contributions, publicSummary] = await Promise.all([
    getAdminDashboard(pool),
    listAdminContributions(pool),
    getPublicTransparencySummary(pool)
  ]);
  assert.equal(publicSummary.total_refunded, expected);
  assert.equal(dashboard.totals.total_refunded, expected);
  assert.equal(contributions.summary.total_refunded, expected);
  assert.equal(dashboard.totals.currency, 'CAD');
  assert.equal(publicSummary.currency, 'CAD');
};

test('Payment ordering and refund projections on disposable PostgreSQL', async (t) => {
  const { pool, stop } = await startDisposablePostgres();
  t.after(stop);
  // These tables belong exclusively to this invocation's temporary container.
  t.beforeEach(() =>
    pool.query(
      'TRUNCATE fund_contributions, stripe_checkout_sessions, fund_transactions CASCADE'
    )
  );

  await t.test(
    'a confirmed payment survives delayed failure and expired Checkout events',
    async () => {
      const fixture = checkout('paid_then_stale');
      await insertCheckoutSessionRecord(pool, fixture);
      await updateStatus(pool, fixture, 'paid');
      await updateStatus(pool, fixture, 'failed');
      await assertStatus(pool, fixture, 'paid');
      for (const status of ['pending', 'expired']) {
        await deliverCheckout(pool, fixture, status);
        await assertStatus(pool, fixture, 'paid');
      }
      const summary = await getPublicTransparencySummary(pool);
      assert.equal(summary.total_received, 100);
      assert.equal(summary.contributions_count, 1);
    }
  );

  await t.test(
    'disputes and refunds survive late payment and Checkout success',
    async () => {
      const fixture = checkout('terminal_status');
      await insertCheckoutSessionRecord(pool, fixture);
      await updateStatus(pool, fixture, 'paid');
      for (const terminalStatus of ['disputed', 'refunded']) {
        await updateStatus(pool, fixture, terminalStatus);
        for (const status of ['failed', 'paid']) {
          await updateStatus(pool, fixture, status);
          await assertStatus(pool, fixture, terminalStatus);
        }
        for (const status of ['pending', 'expired', 'paid']) {
          await deliverCheckout(pool, fixture, status);
          await assertStatus(pool, fixture, terminalStatus);
        }
      }
      await updateStatus(pool, fixture, 'disputed');
      await assertStatus(pool, fixture, 'refunded');
    }
  );

  await t.test(
    'a genuine payment success still confirms earlier failed or expired attempts',
    async () => {
      const failed = checkout('failed_then_paid');
      await insertCheckoutSessionRecord(pool, failed);
      await updateStatus(pool, failed, 'failed');
      await updateStatus(pool, failed, 'paid');
      await assertStatus(pool, failed, 'paid');

      const expired = checkout('expired_then_paid');
      await deliverCheckout(pool, expired, 'expired');
      await deliverCheckout(pool, expired, 'paid');
      await assertStatus(pool, expired, 'paid');
    }
  );

  await t.test(
    'concurrent success, failure and expiry converge to paid without duplicate contributions',
    async () => {
      const fixture = checkout('concurrent_delivery');
      await insertCheckoutSessionRecord(pool, fixture);
      await Promise.all([
        updateStatus(pool, fixture, 'paid'),
        updateStatus(pool, fixture, 'failed'),
        deliverCheckout(pool, fixture, 'expired'),
        deliverCheckout(pool, fixture, 'paid')
      ]);
      await assertStatus(pool, fixture, 'paid');
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS count FROM fund_contributions'
      );
      assert.equal(rows[0].count, 1);
    }
  );

  await t.test(
    'empty data has zero refunded in the admin list, dashboard and public projection',
    async () => {
      await assertRefundTotals(pool, 0);
    }
  );

  await t.test(
    'partial and multiple refunds use the ledger and replay does not double the totals',
    async () => {
      const fixture = checkout('partial_refunds');
      await insertCheckoutSessionRecord(pool, fixture);
      await updateStatus(pool, fixture, 'paid');
      const first = refundTransaction(fixture, 'partial_one', 2_500);
      assert.equal(await insertFundTransaction(pool, first), true);
      await assertRefundTotals(pool, 25);
      await assertStatus(pool, fixture, 'paid');
      assert.equal(await insertFundTransaction(pool, first), false);
      await assertRefundTotals(pool, 25);

      const second = refundTransaction(fixture, 'partial_two', 7_500);
      assert.equal(await insertFundTransaction(pool, second), true);
      await updateStatus(pool, fixture, 'refunded');
      await assertRefundTotals(pool, 100);
      assert.equal(await insertFundTransaction(pool, second), false);
      await assertRefundTotals(pool, 100);
    }
  );

  await t.test(
    'a full refund fallback converges with a later ledger entry without adding it twice',
    async () => {
      const fixture = checkout('full_refund_fallback');
      await insertCheckoutSessionRecord(pool, fixture);
      await updateStatus(pool, fixture, 'paid');
      await updateStatus(pool, fixture, 'refunded');
      await assertRefundTotals(pool, 100);
      await insertFundTransaction(
        pool,
        refundTransaction(fixture, 'full_refund', 10_000)
      );
      await assertRefundTotals(pool, 100);
    }
  );
});
