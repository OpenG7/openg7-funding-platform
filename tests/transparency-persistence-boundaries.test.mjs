import assert from 'node:assert/strict';
import test from 'node:test';

import {
  insertFundTransaction,
  updateContributionFundTransactionBalance
} from '../dist/apps/funding-api/src/fund-transparency.repository.js';

const payment = (overrides = {}) => ({
  stripeEventId: 'evt_test_registry',
  stripeObjectId: 'pi_test_registry',
  stripeBalanceTransactionId: null,
  type: 'payment_intent.succeeded',
  amount: 12_345,
  fee: 345,
  net: 12_000,
  currency: 'cad',
  status: 'succeeded',
  createdAtIso: '2026-09-01T12:00:00.000Z',
  publicCategory: 'contribution',
  metadataJson: { source: 'stripe' },
  ...overrides
});

const transactionPool = ({
  existing = [],
  rowCount = 1,
  failAt = null
} = {}) => {
  const calls = [];
  const failure = new Error('Synthetic registry persistence failure');
  const pool = {
    async query() {
      assert.fail(
        'Logical registry writes must stay on their transaction client'
      );
    },
    async connect() {
      calls.push({ operation: 'connect' });
      return {
        async query(sql, values) {
          const operation = sql.includes('pg_advisory_xact_lock')
            ? 'lock'
            : sql.includes('SELECT amount::text')
              ? 'existing'
              : sql.includes('INSERT INTO fund_transactions')
                ? 'insert'
                : sql;
          calls.push({ operation, sql, values });
          if (operation === failAt) throw failure;
          return operation === 'existing'
            ? { rows: existing }
            : { rows: [], rowCount };
        },
        release() {
          calls.push({ operation: 'release' });
        }
      };
    }
  };
  return { pool, calls, failure };
};

test('historical registry facade preserves unavailable database results', async () => {
  assert.equal(await insertFundTransaction(null, payment()), false);
  assert.equal(await updateContributionFundTransactionBalance(null, {}), false);
});

test('logical payment, payout and refund writes lock and commit on one client', async (t) => {
  const fixtures = [
    { input: payment(), lock: 'fund-payment:pi_test_registry' },
    {
      input: payment({
        type: 'payout.paid',
        status: 'paid',
        stripeObjectId: 'po_test_registry'
      }),
      lock: 'fund-payout:po_test_registry'
    },
    {
      input: payment({
        type: 'charge.refunded',
        stripeObjectId: 'ch_test_registry',
        metadataJson: { refundId: 're_test_registry' }
      }),
      lock: 'fund-refund:re_test_registry'
    }
  ];
  for (const { input, lock } of fixtures) {
    await t.test(input.type, async () => {
      const { pool, calls } = transactionPool();
      assert.equal(await insertFundTransaction(pool, input), true);
      assert.deepEqual(
        calls.map(({ operation }) => operation),
        ['connect', 'BEGIN', 'lock', 'existing', 'insert', 'COMMIT', 'release']
      );
      assert.deepEqual(calls[2].values, [lock]);
      assert.deepEqual(calls[4].values, [
        input.stripeEventId,
        input.stripeObjectId,
        input.stripeBalanceTransactionId,
        input.type,
        input.amount,
        input.fee,
        input.net,
        input.currency,
        input.status,
        input.createdAtIso,
        input.publicCategory,
        JSON.stringify(input.metadataJson)
      ]);
    });
  }
});

test('logical duplicates commit without insertion and currency comparison preserves case tolerance', async () => {
  const { pool, calls } = transactionPool({
    existing: [
      { amount: '12345', currency: 'CAD', type: 'payment_intent.succeeded' }
    ]
  });
  assert.equal(await insertFundTransaction(pool, payment()), false);
  assert.deepEqual(
    calls.map(({ operation }) => operation),
    ['connect', 'BEGIN', 'lock', 'existing', 'COMMIT', 'release']
  );
});

test('event-id conflicts retain a false insertion result within the logical transaction', async () => {
  const { pool, calls } = transactionPool({ rowCount: 0 });
  assert.equal(await insertFundTransaction(pool, payment()), false);
  assert.equal(calls.at(-2).operation, 'COMMIT');
  assert.match(
    calls.find(({ operation }) => operation === 'insert').sql,
    /ON CONFLICT \(stripe_event_id\) DO NOTHING/
  );
});

test('contradictory monetary facts roll back and release the transaction client', async (t) => {
  for (const row of [
    { amount: '12344', currency: 'cad' },
    { amount: '12345', currency: 'usd' }
  ]) {
    await t.test(JSON.stringify(row), async () => {
      const { pool, calls } = transactionPool({
        existing: [{ ...row, type: 'payment_intent.succeeded' }]
      });
      await assert.rejects(
        insertFundTransaction(pool, payment()),
        /Inconsistent payment monetary facts\./
      );
      assert.deepEqual(
        calls.map(({ operation }) => operation),
        ['connect', 'BEGIN', 'lock', 'existing', 'ROLLBACK', 'release']
      );
    });
  }
});

test('failed lock, lookup, insert or commit rolls back and preserves the original failure', async (t) => {
  for (const failAt of ['lock', 'existing', 'insert', 'COMMIT']) {
    await t.test(failAt, async () => {
      const { pool, calls, failure } = transactionPool({ failAt });
      await assert.rejects(
        insertFundTransaction(pool, payment()),
        (error) => error === failure
      );
      assert.deepEqual(
        calls.slice(-2).map(({ operation }) => operation),
        ['ROLLBACK', 'release']
      );
    });
  }
});

test('inconsistent outcomes reject before acquiring a database connection', async (t) => {
  for (const input of [
    payment({ status: 'processing' }),
    payment({ type: 'payout.paid', status: 'failed' }),
    payment({
      type: 'charge.refunded',
      status: 'pending',
      metadataJson: { refundId: 're_test_pending' }
    })
  ]) {
    await t.test(input.type, async () => {
      const { pool, calls } = transactionPool();
      await assert.rejects(
        insertFundTransaction(pool, input),
        /Inconsistent .* status\./
      );
      assert.deepEqual(calls, []);
    });
  }
});

test('ordinary events and legacy refunds retain event-id insertion without acquiring another client', async (t) => {
  for (const type of ['charge.dispute.created', 'charge.refunded']) {
    await t.test(type, async () => {
      const calls = [];
      const input = payment({ type });
      const pool = {
        async query(sql, values) {
          calls.push({ sql, values });
          return { rowCount: 1 };
        },
        async connect() {
          assert.fail(
            'Ordinary event insertion must reuse the supplied query connection'
          );
        }
      };
      assert.equal(await insertFundTransaction(pool, input), true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].values[0], input.stripeEventId);
    });
  }
});

test('late balance enrichment retains all minor-unit values, currency and row-count semantics', async (t) => {
  const input = {
    stripePaymentIntentId: 'pi_test_registry',
    stripeBalanceTransactionId: 'txn_test_registry',
    amount: 12_345,
    fee: 345,
    net: 12_000,
    currency: 'cad',
    status: 'succeeded'
  };
  for (const rowCount of [null, 0, 1, 2]) {
    await t.test(`updated rows: ${rowCount}`, async () => {
      const calls = [];
      const pool = {
        async query(sql, values) {
          calls.push({ sql, values });
          return { rowCount };
        }
      };
      assert.equal(
        await updateContributionFundTransactionBalance(pool, input),
        (rowCount ?? 0) > 0
      );
      assert.equal(calls.length, 1);
      assert.match(
        calls[0].sql,
        /WHERE stripe_object_id = \$1\s+AND type = 'payment_intent.succeeded'/
      );
      assert.deepEqual(calls[0].values, Object.values(input));
    });
  }
});
