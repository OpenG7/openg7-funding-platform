import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileStripeDispute } from '../dist/apps/funding-api/src/stripe-disputes.service.js';

function fixture(status = 'needs_response') {
  const calls = [];
  const current = {
    id: 'dp_synthetic',
    payment_intent: 'pi_synthetic',
    status,
    amount: 10000,
    currency: 'cad'
  };
  const query = async (sql, values) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
    return {
      rows: sql.includes('AS unlocked')
        ? [{ unlocked: true }]
        : sql.startsWith('SELECT id,amount_cents,currency')
          ? [
              {
                id: '11111111-1111-4111-8111-111111111111',
                amount_cents: 10000,
                currency: 'cad'
              }
            ]
          : [],
      rowCount: 0
    };
  };
  const pool = {
    connect: async () => ({
      query,
      release() {
        calls.push({ sql: 'release' });
      }
    })
  };
  const stripe = {
    disputes: {
      retrieve: async () => {
        calls.push({ sql: 'retrieve-dispute' });
        return current;
      },
      list: async function* () {
        calls.push({ sql: 'list-disputes' });
        yield current;
      }
    },
    paymentIntents: {
      retrieve: async () => {
        calls.push({ sql: 'retrieve-payment' });
        return {
          id: 'pi_synthetic',
          status: 'succeeded',
          amount: 10000,
          amount_received: 10000,
          currency: 'cad',
          metadata: { projectId: 'openg7' }
        };
      }
    }
  };
  return { calls, current, pool, stripe };
}
const input = { projectId: 'openg7', source: 'stripe' };

test('dispute reconciliation serializes before provider reads and reads current status instead of delayed snapshots', async () => {
  const f = fixture('won');
  await reconcileStripeDispute(
    f.stripe,
    f.pool,
    { ...f.current, status: 'needs_response' },
    input
  );
  assert.match(f.calls[0].sql, /^SELECT pg_advisory_lock/);
  assert.deepEqual(
    f.calls.slice(1, 4).map((c) => c.sql),
    ['retrieve-dispute', 'retrieve-payment', 'list-disputes']
  );
  assert.equal(f.calls[4].sql, 'BEGIN');
  assert.ok(f.calls.some((c) => c.sql.includes("SET status='paid'")));
  assert.equal(f.calls.at(-1).sql, 'release');
});

test('a current lost dispute remains blocking even when the delayed snapshot says won', async () => {
  const f = fixture('lost');
  await reconcileStripeDispute(
    f.stripe,
    f.pool,
    { ...f.current, status: 'won' },
    input
  );
  assert.equal(
    f.calls.some((c) => c.sql === 'list-disputes'),
    false
  );
  assert.ok(
    f.calls.some(
      (c) =>
        c.sql.startsWith('UPDATE fund_contributions') &&
        c.values[1] === 'disputed'
    )
  );
  assert.equal(
    f.calls.some((c) => c.sql.includes("SET status='paid'")),
    false
  );
});

test('failed provider reads and conflicting references release locks before any writing transaction', async (t) => {
  for (const failure of ['outage', 'different-payment'])
    await t.test(failure, async () => {
      const f = fixture('won');
      if (failure === 'outage')
        f.stripe.disputes.retrieve = async () => {
          throw new Error('Synthetic outage');
        };
      else f.current.payment_intent = 'pi_other';
      await assert.rejects(
        reconcileStripeDispute(
          f.stripe,
          f.pool,
          { id: 'dp_synthetic', payment_intent: 'pi_synthetic' },
          input
        )
      );
      assert.equal(
        f.calls.some((c) => c.sql === 'BEGIN'),
        false
      );
      assert.match(f.calls.at(-2).sql, /^SELECT pg_advisory_unlock/);
      assert.equal(f.calls.at(-1).sql, 'release');
    });
});
