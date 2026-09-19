import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getPublicTransparencySummary } from '../dist/apps/funding-api/src/fund-transparency.repository.js';
import { getStripePublicTransparencySummary } from '../dist/apps/funding-api/src/stripe-transparency.service.js';

const tablePresence = (overrides) => ({
  has_fund_contributions: false,
  has_fund_transactions: true,
  has_fund_allocations: false,
  has_sponsor_review_status: false,
  ...overrides
});

const assertProdBackfillTotals = (report) => {
  assert.equal(report.total_received, 20);
  assert.equal(report.total_fees, 1.49);
  assert.equal(report.total_net, 18.51);
  assert.equal(report.total_payouts, 18.42);
  assert.equal(report.current_available_estimate, 18.51);
};

test('Contribution transparency keeps Stripe payouts separate from fund availability', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("to_regclass('public.fund_contributions')")) {
        return {
          rows: [
            tablePresence({
              has_fund_contributions: true,
              has_sponsor_review_status: true
            })
          ]
        };
      }

      if (sql.includes('public_name AS display_name')) {
        return { rows: [] };
      }

      if (sql.includes('FROM fund_allocations')) {
        return { rows: [] };
      }

      if (
        sql.includes('FROM fund_contributions') &&
        sql.includes("TO_CHAR(DATE_TRUNC('month', COALESCE(paid_at")
      ) {
        return {
          rows: [
            {
              month: '2026-07',
              total_received: '2000',
              contribution_refunded: '0',
              contributions_count: '3',
              currency: 'cad'
            }
          ]
        };
      }

      if (
        sql.includes('FROM fund_contributions') &&
        sql.includes('contribution_refunded')
      ) {
        return {
          rows: [
            {
              total_received: '2000',
              contribution_refunded: '0',
              contributions_count: '3',
              currency: 'cad',
              last_updated_at: '2026-07-16T00:34:59.767Z'
            }
          ]
        };
      }

      if (
        sql.includes('FROM fund_transactions') &&
        sql.includes("TO_CHAR(DATE_TRUNC('month', created_at")
      ) {
        return {
          rows: [
            {
              month: '2026-07',
              total_fees: '149',
              total_refunded: '0',
              total_payouts: '1842',
              currency: 'cad'
            }
          ]
        };
      }

      if (
        sql.includes('FROM fund_transactions') &&
        sql.includes('MAX(inserted_at)::text')
      ) {
        return {
          rows: [
            {
              total_fees: '149',
              total_refunded: '0',
              total_payouts: '1842',
              last_updated_at: '2026-07-16T00:35:01.247Z'
            }
          ]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const report = await getPublicTransparencySummary(pool);

  assertProdBackfillTotals(report);
});

const stripeSession = (index, currency = 'cad') => ({
  id: `cs_${index}`,
  payment_status: 'paid',
  currency,
  amount_total: 100,
  created: 1784162100,
  metadata: { projectId: 'openg7' },
  payment_intent: {
    id: `pi_${index}`,
    status: 'succeeded',
    amount_received: 100,
    amount: 100,
    currency,
    created: 1784162100,
    metadata: { projectId: 'openg7' },
    latest_charge: {
      id: `ch_${index}`,
      amount_refunded: 10,
      balance_transaction: {
        id: `txn_${index}`,
        amount: 100,
        fee: 5,
        net: 95,
        currency
      }
    }
  }
});
const stripePayout = (index) => ({
  id: `po_${index}`,
  status: 'paid',
  amount: 50,
  currency: 'cad',
  created: 1784162100
});

test('Stripe-direct distinguishes missing fees from a confirmed zero fee', async () => {
  const session = stripeSession(0);
  const balance = session.payment_intent.latest_charge.balance_transaction;
  session.payment_intent.latest_charge.balance_transaction = null;
  const stripe = {
    checkout: {
      sessions: {
        async list() {
          return { data: [session], has_more: false };
        }
      }
    },
    payouts: {
      async list() {
        return { data: [], has_more: false };
      }
    }
  };
  let report = await getStripePublicTransparencySummary(stripe, {
    projectId: 'openg7'
  });
  assert.equal(report.pending_fee_count, 1);
  assert.equal(report.monthly_summary[0].pending_fee_count, 1);
  session.payment_intent.latest_charge.balance_transaction = {
    ...balance,
    fee: 0,
    net: 100
  };
  report = await getStripePublicTransparencySummary(stripe, {
    projectId: 'openg7'
  });
  assert.equal(report.pending_fee_count, 0);
  assert.equal(report.total_fees, 0);
});

test('Stripe-direct reads every session and payout page, without counting a payment twice', async () => {
  const sessionCursors = [];
  const payoutCursors = [];
  const stripe = {
    checkout: {
      sessions: {
        async list(params) {
          sessionCursors.push(params.starting_after);
          assert.equal(params.limit, 100);
          return params.starting_after
            ? {
                data: [
                  stripeSession(100),
                  { ...stripeSession(0), id: 'cs_duplicate' }
                ],
                has_more: false
              }
            : {
                data: Array.from({ length: 100 }, (_, i) => stripeSession(i)),
                has_more: true
              };
        }
      }
    },
    payouts: {
      async list(params) {
        payoutCursors.push(params.starting_after);
        return params.starting_after
          ? { data: [stripePayout(100)], has_more: false }
          : {
              data: Array.from({ length: 100 }, (_, i) => stripePayout(i)),
              has_more: true
            };
      }
    }
  };
  const report = await getStripePublicTransparencySummary(stripe, {
    projectId: 'openg7'
  });
  assert.deepEqual(sessionCursors, [undefined, 'cs_99']);
  assert.deepEqual(payoutCursors, [undefined, 'po_99']);
  assert.equal(report.contributions_count, 101);
  assert.equal(report.total_received, 101);
  assert.equal(report.total_fees, 5.05);
  assert.equal(report.total_refunded, 10.1);
  assert.equal(report.total_payouts, 50.5);
  assert.equal(report.current_available_estimate, 85.85);
  assert.equal(report.monthly_summary[0].total_received, 101);
});

test('Stripe pagination failure or non-advancing cursor never returns a partial total', async () => {
  for (const fail of [true, false]) {
    let count = 0;
    const stripe = {
      checkout: {
        sessions: {
          async list() {
            if (++count > 1 && fail) throw new Error('Stripe unavailable');
            return { data: [stripeSession(0)], has_more: true };
          }
        }
      }
    };
    await assert.rejects(
      () => getStripePublicTransparencySummary(stripe, { projectId: 'openg7' }),
      /Stripe unavailable|Incomplete Stripe pagination/
    );
    assert.equal(count, 2);
  }
});

test('Stripe-direct rejects mixed contribution currencies and FX settlement instead of summing them', async () => {
  const fx = stripeSession(1);
  fx.payment_intent.latest_charge.balance_transaction.currency = 'usd';
  for (const data of [[stripeSession(0), stripeSession(1, 'usd')], [fx]]) {
    const stripe = {
      checkout: {
        sessions: {
          async list() {
            return { data, has_more: false };
          }
        }
      }
    };
    await assert.rejects(
      () => getStripePublicTransparencySummary(stripe, { projectId: 'openg7' }),
      /currenc/
    );
  }
});

test('Stripe-direct reports only paid transfers in the contribution currency', async () => {
  const stripe = {
    checkout: {
      sessions: {
        async list() {
          return { data: [stripeSession(0)], has_more: false };
        }
      }
    },
    payouts: {
      async list() {
        return {
          data: [
            stripePayout(0),
            { ...stripePayout(1), currency: 'usd' },
            { ...stripePayout(2), status: 'pending' }
          ],
          has_more: false
        };
      }
    }
  };
  const report = await getStripePublicTransparencySummary(stripe, {
    projectId: 'openg7'
  });
  assert.equal(report.currency, 'CAD');
  assert.equal(report.total_payouts, 0.5);
  assert.equal(report.current_available_estimate, 0.85);
});

test('Transaction-only transparency keeps Stripe payouts separate from fund availability', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("to_regclass('public.fund_contributions')")) {
        return { rows: [tablePresence({ has_fund_contributions: false })] };
      }

      if (sql.includes('FROM fund_allocations')) {
        return { rows: [] };
      }

      if (
        sql.includes('FROM fund_transactions') &&
        sql.includes("TO_CHAR(DATE_TRUNC('month', created_at")
      ) {
        return {
          rows: [
            {
              month: '2026-07',
              total_received: '2000',
              total_fees: '149',
              total_net: '1851',
              total_refunded: '0',
              total_payouts: '1842',
              contributions_count: '3',
              currency: 'cad'
            }
          ]
        };
      }

      if (sql.includes('FROM fund_transactions') && sql.includes('total_net')) {
        return {
          rows: [
            {
              total_received: '2000',
              total_fees: '149',
              total_net: '1851',
              total_refunded: '0',
              total_payouts: '1842',
              contributions_count: '3',
              currency: 'cad',
              last_updated_at: '2026-07-16T00:35:01.247Z'
            }
          ]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const report = await getPublicTransparencySummary(pool);

  assertProdBackfillTotals(report);
});

test('Stripe-direct transparency keeps payouts separate from fund availability', async () => {
  const balanceTransaction = {
    id: 'txn_prod_backfill',
    amount: 2000,
    fee: 149,
    net: 1851,
    currency: 'cad'
  };
  const paymentIntent = {
    id: 'pi_prod_backfill',
    status: 'succeeded',
    amount_received: 2000,
    amount: 2000,
    currency: 'cad',
    created: 1784162100,
    metadata: { projectId: 'openg7' },
    latest_charge: {
      id: 'ch_prod_backfill',
      amount_refunded: 0,
      balance_transaction: balanceTransaction
    }
  };
  const stripe = {
    checkout: {
      sessions: {
        async list() {
          return {
            data: [
              {
                id: 'cs_prod_backfill',
                payment_status: 'paid',
                amount_total: 2000,
                currency: 'cad',
                created: 1784162100,
                metadata: { projectId: 'openg7' },
                payment_intent: paymentIntent
              }
            ]
          };
        }
      }
    },
    payouts: {
      async list() {
        return {
          data: [
            {
              id: 'po_prod_backfill',
              status: 'paid',
              amount: 1842,
              currency: 'cad',
              created: 1784162200
            }
          ]
        };
      }
    }
  };

  const report = await getStripePublicTransparencySummary(stripe, {
    projectId: 'openg7'
  });

  assertProdBackfillTotals(report);
});
