import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  insertFundTransaction,
  getAdjustmentTotals,
  getPublicTransparencySummary
} from '../../dist/apps/funding-api/src/fund-transparency.repository.js';
import { runStripeBackfill } from '../../dist/apps/funding-api/src/stripe-backfill.service.js';
import { getStripePublicTransparencySummary } from '../../dist/apps/funding-api/src/stripe-transparency.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const payout = (id, status = 'paid', event = randomUUID()) => ({
  stripeEventId: 'evt_payout_' + event,
  stripeObjectId: id,
  stripeBalanceTransactionId: 'txn_' + id,
  type: 'payout.' + status,
  amount: 20000,
  fee: 0,
  net: -20000,
  currency: 'cad',
  status,
  createdAtIso: '2026-09-01T12:00:00.000Z',
  publicCategory: 'payout',
  metadataJson: { source: 'stripe', eventType: 'payout.' + status }
});

test(
  'payout persistence and public projection preserve the ledger under repeated and reordered outcomes',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    t.beforeEach(() =>
      pool.query('TRUNCATE fund_contributions, fund_transactions CASCADE')
    );
    const ledger = async () =>
      (await pool.query('SELECT * FROM fund_transactions ORDER BY id')).rows;
    const publicPayouts = async () => {
      const report = await getPublicTransparencySummary(pool);
      assert.equal(report.total_received, 0);
      assert.equal(report.total_fees, 0);
      assert.equal(
        report.current_available_estimate,
        0,
        'a bank transfer is not an expense'
      );
      assert.equal(
        Number((await getAdjustmentTotals(pool, true)).total_payouts) / 100,
        report.total_payouts
      );
      assert.equal(
        report.monthly_summary.reduce((sum, m) => sum + m.total_payouts, 0),
        report.total_payouts
      );
      return report.total_payouts;
    };
    await t.test(
      'distinct concurrent events for one successful payout create one logical movement',
      async () => {
        const writes = await Promise.all(
          Array.from({ length: 6 }, () =>
            insertFundTransaction(pool, payout('po_concurrent'))
          )
        );
        assert.equal(writes.filter(Boolean).length, 1);
        assert.equal((await ledger()).length, 1);
        assert.equal(await publicPayouts(), 200);
      }
    );
    await t.test(
      'a failure compensates an earlier success without overwriting either fact',
      async () => {
        await insertFundTransaction(pool, payout('po_failed_later'));
        const initial = await ledger();
        assert.equal(await publicPayouts(), 200);
        await insertFundTransaction(pool, payout('po_failed_later', 'failed'));
        assert.equal(await publicPayouts(), 0);
        assert.deepEqual((await ledger())[0], initial[0]);
        assert.equal((await ledger()).length, 2);
        assert.equal(
          await insertFundTransaction(pool, payout('po_failed_later')),
          false
        );
        assert.equal(await publicPayouts(), 0);
      }
    );
    await t.test(
      'an old success arriving after failure cannot restore it; a replacement has its own identity',
      async () => {
        await insertFundTransaction(pool, payout('po_failed_first', 'failed'));
        await insertFundTransaction(pool, payout('po_failed_first'));
        assert.equal(await publicPayouts(), 0);
        await insertFundTransaction(pool, payout('po_replacement'));
        assert.equal(await publicPayouts(), 200);
        assert.equal((await ledger()).length, 3);
      }
    );
    await t.test(
      'legacy duplicate successes and failure are projected without rewriting old rows',
      async () => {
        await insertFundTransaction(pool, payout('po_legacy'));
        await pool.query(`INSERT INTO fund_transactions
      (stripe_event_id,stripe_object_id,stripe_balance_transaction_id,type,amount,fee,net,currency,status,created_at,public_category,metadata_json)
      SELECT 'evt_legacy_duplicate',stripe_object_id,stripe_balance_transaction_id,type,amount,fee,net,currency,status,created_at,public_category,metadata_json
      FROM fund_transactions WHERE stripe_object_id='po_legacy'`);
        const before = await ledger();
        assert.equal(await publicPayouts(), 200);
        assert.deepEqual(await ledger(), before);
        await insertFundTransaction(pool, payout('po_legacy', 'failed'));
        assert.equal(await publicPayouts(), 0);
        assert.deepEqual((await ledger()).slice(0, 2), before);
      }
    );
    await t.test(
      'concurrent opposite outcomes agree with the current Stripe-direct state',
      async () => {
        await Promise.all([
          insertFundTransaction(pool, payout('po_opposite')),
          insertFundTransaction(pool, payout('po_opposite', 'failed'))
        ]);
        await insertFundTransaction(pool, payout('po_replacement'));
        assert.equal((await ledger()).length, 3);
        const stripe = {
          checkout: {
            sessions: {
              async list() {
                return { data: [], has_more: false };
              }
            }
          },
          payouts: {
            async list() {
              return {
                has_more: false,
                data: [
                  {
                    id: 'po_opposite',
                    status: 'failed',
                    amount: 20000,
                    currency: 'cad',
                    created: 1788264000
                  },
                  {
                    id: 'po_replacement',
                    status: 'paid',
                    amount: 20000,
                    currency: 'cad',
                    created: 1788264000
                  }
                ]
              };
            }
          }
        };
        const direct = await getStripePublicTransparencySummary(stripe, {
          projectId: 'openg7'
        });
        assert.equal(direct.total_payouts, await publicPayouts());
        assert.equal(direct.total_payouts, 200);
        assert.equal(direct.current_available_estimate, 0);
        assert.equal(direct.monthly_summary[0].total_payouts, 200);
      }
    );
    await t.test(
      'contradictory monetary facts for the same outcome fail without replacing its amount',
      async () => {
        await insertFundTransaction(pool, payout('po_conflict'));
        const before = await ledger();
        await assert.rejects(
          insertFundTransaction(pool, {
            ...payout('po_conflict'),
            amount: 10000
          }),
          /payout/i
        );
        await assert.rejects(
          insertFundTransaction(pool, {
            ...payout('po_conflict', 'failed'),
            currency: 'usd'
          }),
          /payout/i
        );
        await assert.rejects(
          insertFundTransaction(pool, {
            ...payout('po_conflict'),
            status: 'failed'
          }),
          /payout/i
        );
        assert.deepEqual(await ledger(), before);
      }
    );
    await t.test(
      'dry-run stays read-only and a backfill racing a webhook keeps one movement',
      async () => {
        const record = {
          id: 'po_backfill_race',
          status: 'paid',
          amount: 20000,
          currency: 'cad',
          created: 1788264000,
          balance_transaction: {
            id: 'txn_backfill',
            amount: -20000,
            fee: 0,
            net: -20000,
            currency: 'cad'
          }
        };
        const stripe = {
          checkout: { sessions: { async *list() {} } },
          payouts: {
            async *list() {
              yield record;
            }
          }
        };
        const options = {
          projectId: 'openg7',
          includeUnmatched: false,
          includePayouts: true,
          includeRefunds: false,
          includeDisputes: false,
          dryRun: true,
          assumeNonCharityAcknowledged: false,
          created: null,
          maxRecords: 10
        };
        const preview = await runStripeBackfill(stripe, pool, options);
        assert.equal(preview.payouts.dryRunWouldInsertTransactions, 1);
        assert.deepEqual(await ledger(), []);
        await Promise.all([
          runStripeBackfill(stripe, pool, { ...options, dryRun: false }),
          insertFundTransaction(pool, payout(record.id))
        ]);
        const original = await ledger();
        assert.equal(original.length, 1);
        assert.equal(await publicPayouts(), 200);
        record.status = 'failed';
        await runStripeBackfill(stripe, pool, { ...options, dryRun: false });
        assert.equal(await publicPayouts(), 0);
        assert.deepEqual((await ledger())[0], original[0]);
        assert.equal((await ledger()).length, 2);
      }
    );
    await t.test(
      'a failed insert releases its transaction lock and can be retried',
      async () => {
        await assert.rejects(
          insertFundTransaction(pool, {
            ...payout('po_retry'),
            createdAtIso: 'invalid'
          })
        );
        assert.equal(
          await insertFundTransaction(pool, payout('po_retry')),
          true
        );
        assert.equal(await publicPayouts(), 200);
      }
    );
  }
);

test(
  'transaction-only transparency also excludes failed payouts',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    t.after(stop);
    await pool.query(
      await readFile(
        new URL(
          '../../apps/funding-api/migrations/001_create_fund_transparency_tables.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    await pool.query(
      await readFile(
        new URL(
          '../../apps/funding-api/migrations/018_add_fund_achievement_tracking.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    await insertFundTransaction(pool, payout('po_fallback'));
    assert.equal((await getPublicTransparencySummary(pool)).total_payouts, 200);
    await insertFundTransaction(pool, payout('po_fallback', 'failed'));
    const failed = await getPublicTransparencySummary(pool);
    assert.equal(failed.total_payouts, 0);
    assert.equal(failed.current_available_estimate, 0);
    assert.ok(failed.last_updated_at);
    await insertFundTransaction(pool, payout('po_fallback_replacement'));
    const replaced = await getPublicTransparencySummary(pool);
    assert.equal(replaced.total_payouts, 200);
    assert.equal(replaced.monthly_summary[0].total_payouts, 200);
  }
);
