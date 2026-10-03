import assert from 'node:assert/strict';
import test from 'node:test';

import {
  insertFundTransaction,
  updateContributionFundTransactionBalance
} from '../../dist/apps/funding-api/src/fund-transparency.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const payment = (id, eventId, overrides = {}) => ({
  stripeEventId: eventId,
  stripeObjectId: id,
  stripeBalanceTransactionId: null,
  type: 'payment_intent.succeeded',
  amount: 12_345,
  fee: 0,
  net: 12_345,
  currency: 'cad',
  status: 'succeeded',
  createdAtIso: '2026-09-01T12:00:00.000Z',
  publicCategory: 'contribution',
  metadataJson: { source: 'stripe' },
  ...overrides
});

test(
  'extracted registry writes preserve concurrency, rollback and late enrichment on PostgreSQL',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    t.beforeEach(() => pool.query('TRUNCATE fund_transactions CASCADE'));
    const rows = async () =>
      (await pool.query('SELECT * FROM fund_transactions ORDER BY id')).rows;

    await t.test(
      'distinct payment events serialize to one immutable monetary fact',
      async () => {
        const writes = await Promise.all(
          Array.from({ length: 6 }, (_, index) =>
            insertFundTransaction(
              pool,
              payment(
                'pi_test_concurrent_registry',
                `evt_test_registry_${index}`
              )
            )
          )
        );
        assert.equal(writes.filter(Boolean).length, 1);
        const before = await rows();
        assert.equal(before.length, 1);
        await assert.rejects(
          insertFundTransaction(
            pool,
            payment(
              'pi_test_concurrent_registry',
              'evt_test_registry_conflict',
              { amount: 12_346 }
            )
          ),
          /Inconsistent payment monetary facts\./
        );
        assert.deepEqual(await rows(), before);
      }
    );

    await t.test(
      'the refund identity deduplicates concurrent deliveries across distinct charge and event identifiers',
      async () => {
        const writes = await Promise.all(
          Array.from({ length: 6 }, (_, index) =>
            insertFundTransaction(
              pool,
              payment(`ch_test_registry_${index}`, `evt_test_refund_${index}`, {
                type: 'charge.refunded',
                amount: 2_345,
                net: -2_345,
                publicCategory: 'refund',
                metadataJson: { refundId: 're_test_registry_concurrent' }
              })
            )
          )
        );
        assert.equal(writes.filter(Boolean).length, 1);
        const ledger = await rows();
        assert.equal(ledger.length, 1);
        assert.equal(
          ledger[0].metadata_json.refundId,
          're_test_registry_concurrent'
        );
        assert.equal(Number(ledger[0].amount), 2_345);
        assert.equal(ledger[0].currency, 'cad');
      }
    );

    await t.test(
      'a failure after a real insert rolls back the complete transaction and allows a retry',
      async () => {
        const failure = new Error('Synthetic failure after registry INSERT');
        const input = payment(
          'pi_test_rollback_registry',
          'evt_test_rollback_registry'
        );
        const failAfterInsert = {
          async connect() {
            const client = await pool.connect();
            return {
              async query(sql, values) {
                const result = await client.query(sql, values);
                if (sql.includes('INSERT INTO fund_transactions'))
                  throw failure;
                return result;
              },
              release() {
                client.release();
              }
            };
          },
          async query() {
            assert.fail(
              'The registry insertion must use its locked transaction client'
            );
          }
        };
        await assert.rejects(
          insertFundTransaction(failAfterInsert, input),
          (error) => error === failure
        );
        assert.deepEqual(await rows(), []);
        assert.equal(await insertFundTransaction(pool, input), true);
        assert.equal(await insertFundTransaction(pool, input), false);
        assert.equal((await rows()).length, 1);
      }
    );

    await t.test(
      'late balance data enriches the existing payment without touching an unrelated payout',
      async () => {
        const input = payment(
          'pi_test_enrichment_registry',
          'evt_test_enrichment_registry'
        );
        await insertFundTransaction(pool, input);
        await insertFundTransaction(
          pool,
          payment(input.stripeObjectId, 'evt_test_payout_registry', {
            type: 'payout.paid',
            status: 'paid',
            publicCategory: 'payout'
          })
        );
        const before = await rows();
        assert.equal(
          await updateContributionFundTransactionBalance(pool, {
            stripePaymentIntentId: input.stripeObjectId,
            stripeBalanceTransactionId: 'txn_test_enrichment_registry',
            amount: 12_345,
            fee: 345,
            net: 12_000,
            currency: 'cad',
            status: 'succeeded'
          }),
          true
        );
        const after = await rows();
        assert.equal(after.length, 2);
        assert.deepEqual(after[1], before[1]);
        assert.equal(after[0].id, before[0].id);
        assert.equal(after[0].stripe_event_id, input.stripeEventId);
        assert.equal(
          after[0].stripe_balance_transaction_id,
          'txn_test_enrichment_registry'
        );
        assert.equal(Number(after[0].amount), 12_345);
        assert.equal(Number(after[0].fee), 345);
        assert.equal(Number(after[0].net), 12_000);
        assert.equal(after[0].currency, 'cad');
      }
    );
  }
);
