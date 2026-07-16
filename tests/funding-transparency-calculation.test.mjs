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
        sql.includes("TO_CHAR(DATE_TRUNC('month', created_at)")
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
        sql.includes("TO_CHAR(DATE_TRUNC('month', created_at)")
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
