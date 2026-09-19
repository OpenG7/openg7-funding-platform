import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPublicTransparencySummary } from '../../dist/apps/funding-api/src/fund-transparency.repository.js';
import { getStripePublicTransparencySummary } from '../../dist/apps/funding-api/src/stripe-transparency.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'Public transparency on disposable PostgreSQL',
  { timeout: 90_000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    t.beforeEach(() =>
      pool.query('TRUNCATE fund_contributions, fund_transactions CASCADE')
    );
    const contribution = (
      id,
      currency = 'cad',
      status = 'paid',
      date = '2026-08-01T12:00:00Z'
    ) =>
      pool.query(
        `
    INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status, paid_at, stripe_payment_intent_id, non_charity_acknowledged)
    VALUES ('personal_support', 10000, $2, $3, $4, $1, true)`,
        [id, currency, status, date]
      );
    const payment = (id, balance = null, fee = 0) =>
      pool.query(
        `
    INSERT INTO fund_transactions (stripe_event_id, stripe_object_id, stripe_balance_transaction_id, type, amount, fee, net, currency, status, created_at, public_category)
    VALUES ($1, $2, $3, 'payment_intent.succeeded', 10000, $4::bigint, 10000 - $4::bigint, 'cad', 'succeeded', '2026-08-01T12:00:00Z', 'contribution')`,
        [`evt_${id}`, id, balance, fee]
      );
    const refund = (date = '2026-09-02T12:00:00Z', amount = 2500) =>
      pool.query(
        `
    INSERT INTO fund_transactions (stripe_event_id, stripe_object_id, type, amount, fee, net, currency, status, created_at, public_category)
    VALUES ('evt_refund', 're_refund', 'charge.refunded', $1::bigint, 0, -$1::bigint, 'cad', 'succeeded', $2, 'refund')`,
        [amount, date]
      );

    await t.test(
      'a partial refund and a payout retain their month without a new contribution',
      async () => {
        await contribution('pi_partial');
        await payment('pi_partial', 'txn_partial', 300);
        await refund();
        await pool.query(`INSERT INTO fund_transactions (stripe_event_id, stripe_object_id, type, amount, fee, net, currency, status, created_at, public_category)
      VALUES ('evt_payout', 'po_only', 'payout.paid', 1000, 0, 1000, 'cad', 'paid', '2026-10-02', 'payout')`);
        const result = await getPublicTransparencySummary(pool);
        assert.deepEqual(
          result.monthly_summary.map((row) => row.month),
          ['2026-10', '2026-09', '2026-08']
        );
        assert.equal(result.total_refunded, 25);
        assert.equal(result.monthly_summary[1].total_refunded, 25);
        assert.equal(result.monthly_summary[1].total_received, 0);
        assert.equal(result.monthly_summary[0].total_payouts, 10);
        assert.equal(result.current_available_estimate, 72);
        assert.equal(result.pending_fee_count, 0);
      }
    );

    await t.test(
      'a full refund in a later month is counted once, with fallback only when no ledger exists',
      async () => {
        await contribution('pi_full', 'cad', 'refunded');
        let result = await getPublicTransparencySummary(pool);
        assert.equal(result.total_refunded, 100);
        assert.equal(result.monthly_summary[0].total_refunded, 100);
        await refund('2026-09-01T12:00:00Z', 10000);
        result = await getPublicTransparencySummary(pool);
        assert.equal(result.total_refunded, 100);
        assert.equal(
          result.monthly_summary.find((row) => row.month === '2026-08')
            .total_refunded,
          0
        );
        assert.equal(
          result.monthly_summary.find((row) => row.month === '2026-09')
            .total_refunded,
          100
        );
        assert.equal(
          result.monthly_summary.reduce(
            (sum, row) => sum + row.total_refunded,
            0
          ),
          result.total_refunded
        );
      }
    );

    await t.test(
      'missing fee facts include missing payment records and resolve when facts arrive',
      async () => {
        await contribution('pi_fees');
        assert.equal(
          (await getPublicTransparencySummary(pool)).pending_fee_count,
          1
        );
        await payment('pi_fees');
        let result = await getPublicTransparencySummary(pool);
        assert.equal(result.pending_fee_count, 1);
        assert.equal(result.monthly_summary[0].pending_fee_count, 1);
        await pool.query(
          "UPDATE fund_transactions SET stripe_balance_transaction_id = 'txn_confirmed', fee = 300, net = 9700"
        );
        result = await getPublicTransparencySummary(pool);
        assert.equal(result.pending_fee_count, 0);
        assert.equal(result.current_available_estimate, 97);
        // A real zero fee is complete when the balance transaction is present.
        await pool.query('UPDATE fund_transactions SET fee = 0, net = 10000');
        assert.equal(
          (await getPublicTransparencySummary(pool)).pending_fee_count,
          0
        );
      }
    );

    await t.test(
      'mixed confirmed currencies and mismatching ledger currencies are rejected',
      async () => {
        await contribution('pi_cad');
        await contribution('pi_usd', 'usd', 'pending');
        assert.equal(
          (await getPublicTransparencySummary(pool)).currency,
          'CAD'
        );
        await pool.query(
          "UPDATE fund_contributions SET status = 'paid' WHERE stripe_payment_intent_id = 'pi_usd'"
        );
        await assert.rejects(
          () => getPublicTransparencySummary(pool),
          /Multiple currencies/
        );
        await pool.query(
          "DELETE FROM fund_contributions WHERE stripe_payment_intent_id = 'pi_usd'"
        );
        await payment('pi_cad', 'txn_cad');
        await pool.query("UPDATE fund_transactions SET currency = 'usd'");
        await assert.rejects(
          () => getPublicTransparencySummary(pool),
          /Multiple currencies/
        );
      }
    );

    await t.test(
      'the 12-period limit is applied after including refund-only months',
      async () => {
        for (let month = 1; month <= 12; month++)
          await contribution(
            `pi_${month}`,
            'cad',
            'paid',
            `2025-${String(month).padStart(2, '0')}-01T12:00:00Z`
          );
        await refund('2026-01-01T12:00:00Z');
        const result = await getPublicTransparencySummary(pool);
        assert.equal(result.monthly_summary.length, 12);
        assert.equal(result.monthly_summary[0].month, '2026-01');
        assert.equal(result.monthly_summary.at(-1).month, '2025-02');
        assert.equal(result.total_received, 1200);
      }
    );

    await t.test(
      'monthly boundaries are UTC even on a connection using another timezone',
      async () => {
        await contribution(
          'pi_boundary',
          'cad',
          'paid',
          '2026-09-01T00:30:00Z'
        );
        await refund('2026-10-01T00:30:00Z');
        const client = await pool.connect();
        try {
          await client.query("SET TIME ZONE 'America/Los_Angeles'");
          const result = await getPublicTransparencySummary(client);
          assert.deepEqual(
            result.monthly_summary.map((row) => row.month),
            ['2026-10', '2026-09']
          );
        } finally {
          await client.query('RESET TIME ZONE');
          client.release();
        }
      }
    );

    await t.test(
      'transaction-only mode also checks currencies and fee completeness',
      async () => {
        await payment('pi_legacy');
        // Reversible schema change only in this test's disposable database.
        await pool.query(
          'ALTER TABLE fund_contributions RENAME TO transparency_test_contributions'
        );
        try {
          let result = await getPublicTransparencySummary(pool);
          assert.equal(result.pending_fee_count, 1);
          await pool.query(
            "UPDATE fund_transactions SET stripe_balance_transaction_id = 'txn_legacy'"
          );
          result = await getPublicTransparencySummary(pool);
          assert.equal(result.pending_fee_count, 0);
          await refund();
          await pool.query(
            "UPDATE fund_transactions SET currency = 'usd' WHERE type = 'charge.refunded'"
          );
          await assert.rejects(
            () => getPublicTransparencySummary(pool),
            /Multiple currencies/
          );
        } finally {
          await pool.query(
            'ALTER TABLE transparency_test_contributions RENAME TO fund_contributions'
          );
        }
      }
    );

    await t.test(
      'both sources report the same cumulative amounts and fee completeness',
      async () => {
        await contribution('pi_parity');
        await payment('pi_parity', 'txn_parity', 300);
        await refund('2026-08-01T12:00:00Z', 2500);
        const database = await getPublicTransparencySummary(pool);
        const stripe = {
          checkout: {
            sessions: {
              async list() {
                return {
                  has_more: false,
                  data: [
                    {
                      id: 'cs_parity',
                      payment_status: 'paid',
                      amount_total: 10000,
                      currency: 'cad',
                      created: 1785585600,
                      metadata: { projectId: 'openg7' },
                      payment_intent: {
                        id: 'pi_parity',
                        status: 'succeeded',
                        amount_received: 10000,
                        amount: 10000,
                        currency: 'cad',
                        created: 1785585600,
                        metadata: { projectId: 'openg7' },
                        latest_charge: {
                          id: 'ch_parity',
                          amount_refunded: 2500,
                          balance_transaction: {
                            id: 'txn_parity',
                            amount: 10000,
                            fee: 300,
                            net: 9700,
                            currency: 'cad'
                          }
                        }
                      }
                    }
                  ]
                };
              }
            }
          },
          payouts: {
            async list() {
              return { has_more: false, data: [] };
            }
          }
        };
        const direct = await getStripePublicTransparencySummary(stripe, {
          projectId: 'openg7'
        });
        for (const field of [
          'total_received',
          'total_fees',
          'total_refunded',
          'total_net',
          'current_available_estimate',
          'contributions_count',
          'pending_fee_count',
          'currency'
        ])
          assert.equal(database[field], direct[field], field);
        assert.deepEqual(database.monthly_summary, direct.monthly_summary);
        assert.ok(database.generated_at);
      }
    );
  }
);
