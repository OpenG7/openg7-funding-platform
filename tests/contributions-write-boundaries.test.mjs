import assert from 'node:assert/strict';
import test from 'node:test';

import * as facade from '../dist/apps/funding-api/src/fund-contributions.repository.js';
import * as writes from '../dist/apps/funding-api/src/contributions-write.repository.js';

const checkout = (overrides = {}) => ({
  stripeSessionId: 'cs_test_write_boundary',
  stripePaymentIntentId: 'pi_test_write_boundary',
  publicReference: 'OG7-WRITE-BOUNDARY',
  contributionType: 'personal_support',
  amountCents: 12345,
  currency: 'CAD',
  metadata: { fixture: 'write-boundary' },
  publicDisplayConsent: false,
  publicName: null,
  displayAmountConsent: false,
  nonCharityAcknowledged: true,
  sponsorshipFollowupTokenHash: null,
  ...overrides
});
const webhook = (overrides = {}) => ({
  ...checkout(),
  status: 'paid',
  paidAtIso: '2026-09-01T12:00:00.000Z',
  emailPrivate: 'fixture@example.invalid',
  notifyAdmin: true,
  ...overrides
});
const payment = (overrides = {}) => ({
  stripePaymentIntentId: 'pi_test_write_boundary',
  status: 'paid',
  paidAtIso: '2026-09-01T12:00:00.000Z',
  notifyAdmin: true,
  ...overrides
});
const transactionPool = (query) => {
  const calls = [];
  let released = 0;
  let connected = 0;
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return (await query(sql, params)) ?? { rows: [], rowCount: 0 };
    },
    release: () => {
      released++;
    }
  };
  return {
    pool: {
      connect: async () => {
        connected++;
        return client;
      },
      query: () => {
        throw new Error('Writes escaped the acquired transaction client');
      }
    },
    calls,
    assertReleased: () => {
      assert.equal(connected, 1);
      assert.equal(released, 1);
    }
  };
};

test('historical contribution write exports are the owning module functions', () => {
  for (const name of [
    'insertCheckoutSessionRecord',
    'upsertCheckoutSessionFromWebhook',
    'updateContributionStatusByPaymentIntent'
  ]) {
    assert.equal(facade[name], writes[name]);
  }
});

test('contribution writes preserve their unavailable database result', async () => {
  assert.equal(
    await facade.insertCheckoutSessionRecord(null, checkout()),
    false
  );
  assert.equal(
    await facade.upsertCheckoutSessionFromWebhook(null, webhook()),
    false
  );
  assert.equal(
    await facade.updateContributionStatusByPaymentIntent(null, payment()),
    false
  );
});

test('Checkout creation and duplicate delivery both commit the linked contribution write', async () => {
  for (const rowCount of [1, 0]) {
    const db = transactionPool((sql) => {
      if (sql.includes('INSERT INTO stripe_checkout_sessions'))
        return { rows: [], rowCount };
    });
    assert.equal(
      await facade.insertCheckoutSessionRecord(db.pool, checkout()),
      rowCount === 1
    );
    assert.deepEqual(
      db.calls.map(({ sql }) => sql.trim().split('\n')[0]),
      [
        'BEGIN',
        'INSERT INTO stripe_checkout_sessions (',
        'INSERT INTO fund_contributions (',
        'COMMIT'
      ]
    );
    assert.deepEqual(db.calls[1].params, [
      'cs_test_write_boundary',
      'pi_test_write_boundary',
      'personal_support',
      12345,
      'cad',
      '{"fixture":"write-boundary"}'
    ]);
    assert.deepEqual(db.calls[2].params.slice(0, 8), [
      'OG7-WRITE-BOUNDARY',
      'personal_support',
      12345,
      'cad',
      false,
      null,
      false,
      true
    ]);
    db.assertReleased();
  }
});

test('a stored payment confirmation overrides stale Checkout state before linked writes and activity', async () => {
  const paidAt = new Date('2026-08-01T12:00:00.000Z');
  const db = transactionPool((sql) => {
    if (sql.startsWith('SELECT paid_at'))
      return { rows: [{ paid_at: paidAt }] };
    if (sql.includes('INSERT INTO fund_contributions'))
      return { rows: [], rowCount: 1 };
    if (sql.startsWith('UPDATE fund_contributions SET payment_notification'))
      return {
        rows: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            amount_cents: 12345,
            currency: 'cad',
            paid_at: paidAt
          }
        ]
      };
  });
  const input = webhook({ status: 'expired', paidAtIso: null });
  assert.equal(
    await facade.upsertCheckoutSessionFromWebhook(db.pool, input),
    true
  );
  assert.equal(input.status, 'expired');
  assert.equal(input.paidAtIso, null);
  assert.equal(
    db.calls[1].params[0],
    'payment-confirmation:pi_test_write_boundary'
  );
  assert.equal(db.calls[3].params[6], 'paid');
  assert.deepEqual(db.calls[3].params[7], [
    'pending',
    'expired',
    'failed',
    'paid'
  ]);
  assert.equal(db.calls[4].params[11], 'paid');
  assert.equal(db.calls[4].params[12], paidAt.toISOString());
  const activity = db.calls.find(({ sql }) =>
    sql.includes('INSERT INTO contribution_activity')
  );
  assert.deepEqual(activity.params, [
    '11111111-1111-4111-8111-111111111111',
    12345,
    'cad',
    paidAt
  ]);
  assert.equal(db.calls.at(-1).sql, 'COMMIT');
  db.assertReleased();
});

test('trusted first PaymentIntent attachment and confirmation stay on the same transaction client', async () => {
  const db = transactionPool((sql) => {
    if (sql.includes('RETURNING stripe_session_id'))
      return { rows: [{ stripe_session_id: 'cs_test_write_boundary' }] };
    if (sql.includes('UPDATE fund_contributions\n'))
      return { rows: [], rowCount: 1 };
  });
  assert.equal(
    await facade.updateContributionStatusByPaymentIntent(
      db.pool,
      payment({
        checkoutMatch: {
          publicReference: 'OG7-WRITE-BOUNDARY',
          amountCents: 12345,
          currency: 'CAD'
        }
      })
    ),
    true
  );
  const attachment = db.calls.find(({ sql }) =>
    sql.includes('RETURNING stripe_session_id')
  );
  assert.deepEqual(attachment.params, [
    'pi_test_write_boundary',
    'OG7-WRITE-BOUNDARY',
    12345,
    'cad',
    ['pending', 'expired', 'failed', 'paid']
  ]);
  assert.deepEqual(db.calls[3].params, [
    'pi_test_write_boundary',
    'cs_test_write_boundary'
  ]);
  assert.ok(db.calls[4].sql.includes('contribution_payment_confirmations'));
  assert.ok(db.calls.at(-2).sql.includes('payment_notification_recorded_at'));
  assert.equal(db.calls.at(-1).sql, 'COMMIT');
  db.assertReleased();
});

test('failed, refunded and disputed PaymentIntent updates preserve their guarded states without payment activity', async () => {
  for (const [status, predecessors] of [
    ['failed', ['pending', 'expired', 'failed']],
    ['disputed', ['pending', 'expired', 'failed', 'paid', 'disputed']],
    [
      'refunded',
      ['pending', 'expired', 'failed', 'paid', 'disputed', 'refunded']
    ]
  ]) {
    const db = transactionPool(() => ({ rows: [], rowCount: 0 }));
    assert.equal(
      await facade.updateContributionStatusByPaymentIntent(
        db.pool,
        payment({ status })
      ),
      false
    );
    assert.deepEqual(db.calls[2].params, [
      'pi_test_write_boundary',
      status,
      predecessors
    ]);
    assert.deepEqual(db.calls[3].params, [
      'pi_test_write_boundary',
      status,
      '2026-09-01T12:00:00.000Z',
      predecessors
    ]);
    assert.equal(db.calls.at(-1).sql, 'COMMIT');
    assert.equal(
      db.calls.some(({ sql }) =>
        /contribution_activity|payment_notification_recorded_at|contribution_payment_confirmations/.test(
          sql
        )
      ),
      false
    );
    db.assertReleased();
  }
});

test('a silent paid import records the notification marker without creating admin activity', async () => {
  const db = transactionPool((sql) => {
    if (sql.includes('UPDATE fund_contributions\n'))
      return { rows: [], rowCount: 1 };
    if (sql.includes('payment_notification_recorded_at'))
      return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] };
  });
  assert.equal(
    await facade.updateContributionStatusByPaymentIntent(
      db.pool,
      payment({ notifyAdmin: false })
    ),
    true
  );
  assert.equal(
    db.calls.some(({ sql }) =>
      sql.includes('INSERT INTO contribution_activity')
    ),
    false
  );
  assert.ok(db.calls.at(-2).sql.includes('payment_notification_recorded_at'));
  assert.equal(db.calls.at(-1).sql, 'COMMIT');
  db.assertReleased();
});

test('related write and activity failures roll back and release each acquired client', async () => {
  for (const [operation, input, failureQuery] of [
    [
      facade.insertCheckoutSessionRecord,
      checkout(),
      'INSERT INTO fund_contributions'
    ],
    [
      facade.upsertCheckoutSessionFromWebhook,
      webhook(),
      'payment_notification_recorded_at'
    ],
    [
      facade.updateContributionStatusByPaymentIntent,
      payment(),
      'payment_notification_recorded_at'
    ]
  ]) {
    const failure = new Error('Synthetic transactional write failure');
    const db = transactionPool((sql) => {
      if (sql.includes(failureQuery)) throw failure;
      return { rows: [], rowCount: 1 };
    });
    await assert.rejects(
      operation(db.pool, input),
      (error) => error === failure
    );
    assert.equal(db.calls[0].sql, 'BEGIN');
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(
      db.calls.some(({ sql }) => sql === 'COMMIT'),
      false
    );
    db.assertReleased();
  }
});
