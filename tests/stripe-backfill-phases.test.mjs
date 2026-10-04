import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { runStripeBackfill } from '../dist/apps/funding-api/src/stripe-backfill.service.js';

const options = {
  projectId: 'openg7',
  includeUnmatched: false,
  includePayouts: false,
  includeRefunds: false,
  includeDisputes: false,
  dryRun: true,
  assumeNonCharityAcknowledged: false,
  created: { gte: 1735689600, lte: 1735776000 },
  maxRecords: 10
};
const schema = {
  has_fund_transactions: true,
  has_stripe_checkout_sessions: true,
  has_fund_contributions: true,
  has_public_reference: true,
  has_followup_token_hash: true
};

function payment(id = 'pi_backfill', overrides = {}) {
  return {
    id,
    status: 'succeeded',
    amount_received: 1500,
    amount: 1500,
    currency: 'cad',
    created: 1735689600,
    metadata: { project: 'openg7' },
    latest_charge: null,
    ...overrides
  };
}

function session(intent = payment(), overrides = {}) {
  return {
    id: 'cs_backfill',
    payment_intent: intent,
    payment_status: 'paid',
    amount_total: 1500,
    currency: 'cad',
    created: 1735689600,
    metadata: { project: 'openg7' },
    ...overrides
  };
}

function simulatedPool({
  readOnly = true,
  known = [],
  schemaRow = schema
} = {}) {
  const queries = [];
  async function query(sql, values = []) {
    queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
    if (sql.includes('to_regclass')) return { rows: [schemaRow], rowCount: 1 };
    if (readOnly) assert.match(sql.trim(), /^SELECT\b/);
    if (/SELECT 1\s+FROM fund_transactions/.test(sql)) {
      const id = sql.includes("type='charge.refunded'") ? values[0] : values[1];
      return {
        rows: known.includes(id) ? [{}] : [],
        rowCount: known.includes(id) ? 1 : 0
      };
    }
    return { rows: [], rowCount: /^\s*(INSERT|UPDATE)\b/.test(sql) ? 1 : 0 };
  }
  return {
    queries,
    query,
    async connect() {
      assert.equal(
        readOnly,
        false,
        'Dry-run must not open a writing transaction'
      );
      return { query, release() {} };
    }
  };
}

function simulatedStripe({ sessions = [], payouts = [], disputes = [] } = {}) {
  const calls = [];
  const list = (kind, records) => (params) => {
    calls.push([kind, params]);
    return (async function* () {
      yield* records;
    })();
  };
  const unexpected = () =>
    assert.fail('Expanded or absent objects must not be retrieved');
  return {
    calls,
    checkout: { sessions: { list: list('checkout', sessions) } },
    payouts: { list: list('payouts', payouts) },
    disputes: { list: list('disputes', disputes) },
    paymentIntents: { retrieve: unexpected },
    charges: { retrieve: unexpected },
    balanceTransactions: { retrieve: unexpected },
    refunds: { list: unexpected }
  };
}

test('backfill checks its schema before fetching Stripe objects or starting its logger', async () => {
  const stripe = simulatedStripe({ sessions: [session()] });
  const pool = simulatedPool({
    schemaRow: { ...schema, has_followup_token_hash: false }
  });
  await assert.rejects(
    runStripeBackfill(stripe, pool, {
      ...options,
      logger: {
        log() {
          assert.fail('Schema failure must precede the start log');
        }
      }
    }),
    /PostgreSQL schema is missing funding tables or columns/
  );
  assert.deepEqual(stripe.calls, []);
  assert.equal(pool.queries.length, 1);
});

test('dry-run preserves independent scan limits, provider pagination parameters and all phase counters', async () => {
  const matched = payment('pi_matched', {
    latest_charge: {
      id: 'ch_matched',
      amount: 1500,
      amount_refunded: 200,
      currency: 'cad',
      balance_transaction: null,
      refunds: {
        has_more: false,
        data: [
          {
            id: 're_new',
            status: 'succeeded',
            amount: 100,
            currency: 'cad',
            created: 1735689602
          },
          {
            id: 're_known',
            status: 'succeeded',
            amount: 100,
            currency: 'cad',
            created: 1735689600
          }
        ]
      }
    }
  });
  const foreign = payment('pi_foreign', { metadata: { project: 'other' } });
  const stripe = simulatedStripe({
    sessions: [
      session(foreign, { id: 'cs_foreign', metadata: { project: 'other' } }),
      session(matched),
      session(payment('pi_beyond_limit'))
    ],
    payouts: [
      { id: 'po_pending', status: 'pending' },
      {
        id: 'po_paid',
        status: 'paid',
        amount: 900,
        currency: 'cad',
        created: 1735689600,
        balance_transaction: null
      },
      { id: 'po_beyond_limit', status: 'paid' }
    ],
    disputes: [
      { id: 'dp_foreign', charge: { payment_intent: foreign } },
      { id: 'dp_matched', charge: { payment_intent: matched } },
      { id: 'dp_beyond_limit', charge: { payment_intent: matched } }
    ]
  });
  const pool = simulatedPool({ known: ['pi_matched', 're_known'] });
  const summary = await runStripeBackfill(stripe, pool, {
    ...options,
    maxRecords: 2,
    includeRefunds: true,
    includePayouts: true,
    includeDisputes: true
  });

  assert.deepEqual(stripe.calls, [
    [
      'checkout',
      { limit: 100, expand: ['data.payment_intent'], created: options.created }
    ],
    [
      'payouts',
      {
        limit: 100,
        expand: ['data.balance_transaction'],
        created: options.created
      }
    ],
    [
      'disputes',
      { limit: 100, expand: ['data.charge'], created: options.created }
    ]
  ]);
  assert.deepEqual(summary.checkoutSessions, {
    scanned: 2,
    matched: 1,
    skippedUnmatched: 1,
    upserted: 0,
    dryRunMatched: 1
  });
  assert.deepEqual(summary.paymentIntents, {
    seen: 1,
    insertedTransactions: 0,
    skippedExistingTransactions: 1,
    missingBalanceTransactions: 1,
    dryRunWouldInsertTransactions: 0
  });
  assert.deepEqual(summary.refunds, {
    seen: 2,
    insertedTransactions: 0,
    skippedExistingTransactions: 1,
    dryRunWouldInsertTransactions: 1
  });
  assert.deepEqual(summary.payouts, {
    scanned: 2,
    insertedTransactions: 0,
    skippedExistingTransactions: 0,
    dryRunWouldInsertTransactions: 1
  });
  assert.deepEqual(summary.disputes, {
    scanned: 2,
    matched: 1,
    statusUpdated: 0,
    dryRunWouldUpdate: 1
  });
  assert.equal(summary.projectId, 'openg7');
  assert.equal(summary.dryRun, true);
  assert.equal(summary.includeUnmatched, false);
  assert.ok(Date.parse(summary.finishedAt) >= Date.parse(summary.startedAt));
});

test('includeUnmatched admits partial Checkout objects without manufacturing a payment', async () => {
  const stripe = simulatedStripe({
    sessions: [
      session(null, {
        metadata: { project: 'other' },
        payment_status: 'unpaid',
        status: 'expired'
      })
    ],
    disputes: [{ id: 'dp_missing_intent', charge: { payment_intent: null } }]
  });
  const summary = await runStripeBackfill(stripe, simulatedPool(), {
    ...options,
    created: null,
    includeUnmatched: true,
    includeDisputes: true
  });
  assert.deepEqual(stripe.calls[0], [
    'checkout',
    { limit: 100, expand: ['data.payment_intent'] }
  ]);
  assert.equal(summary.checkoutSessions.matched, 1);
  assert.equal(summary.checkoutSessions.dryRunMatched, 1);
  assert.equal(summary.paymentIntents.seen, 0);
  assert.equal(summary.disputes.scanned, 1);
  assert.equal(summary.disputes.matched, 0);
});

test('writing phases retain metadata, references, consent and provenance in their original effect order', async () => {
  const balance = {
    id: 'txn_backfill',
    amount: 1500,
    fee: 75,
    net: 1425,
    currency: 'cad'
  };
  const intent = payment('pi_retrieved', {
    latest_charge: 'ch_retrieved',
    metadata: {
      project: 'openg7',
      publicDisplayName: 'Intent name',
      publicDisplayConsent: 'false',
      publicReference: 'OG7-2025-AAAABBBB',
      contributionType: 'sponsorship_interest',
      intentOnly: 'preserved'
    }
  });
  const checkout = session('pi_retrieved', {
    metadata: {
      project: 'openg7',
      publicDisplayName: 'Session name',
      publicDisplayConsent: 'true',
      displayAmountConsent: 'true',
      publicReference: 'OG7-2025-1234ABCD',
      sponsorshipFollowupTokenHash: 'synthetic-hash'
    },
    customer_details: { email: 'history@example.test' }
  });
  const stripe = simulatedStripe({
    sessions: [checkout],
    payouts: [
      {
        id: 'po_backfill',
        status: 'paid',
        amount: 1000,
        currency: 'cad',
        created: 1735689600,
        balance_transaction: null
      }
    ],
    disputes: [{ id: 'dp_backfill', charge: { payment_intent: intent } }]
  });
  const retrievals = [];
  stripe.paymentIntents.retrieve = async (...args) => {
    retrievals.push(['payment', ...args]);
    return intent;
  };
  stripe.charges.retrieve = async (...args) => {
    retrievals.push(['charge', ...args]);
    return {
      id: 'ch_retrieved',
      balance_transaction: 'txn_backfill',
      amount_refunded: 0
    };
  };
  stripe.balanceTransactions.retrieve = async (...args) => {
    retrievals.push(['balance', ...args]);
    return balance;
  };
  const pool = simulatedPool({ readOnly: false });
  const summary = await runStripeBackfill(stripe, pool, {
    ...options,
    dryRun: false,
    includePayouts: true,
    includeDisputes: true,
    assumeNonCharityAcknowledged: true
  });

  assert.deepEqual(retrievals, [
    [
      'payment',
      'pi_retrieved',
      { expand: ['latest_charge.balance_transaction'] }
    ],
    [
      'charge',
      'ch_retrieved',
      { expand: ['balance_transaction', 'payment_intent'] }
    ],
    ['balance', 'txn_backfill']
  ]);
  const upsert = pool.queries.find(({ sql }) =>
    sql.startsWith('INSERT INTO stripe_checkout_sessions')
  );
  const mergedMetadata = JSON.parse(upsert.values[5]);
  assert.equal(mergedMetadata.intentOnly, 'preserved');
  assert.equal(mergedMetadata.publicDisplayName, 'Session name');
  const contribution = pool.queries.find(({ sql }) =>
    sql.startsWith('INSERT INTO fund_contributions')
  );
  assert.deepEqual(contribution.values.slice(0, 14), [
    'OG7-2025-1234ABCD',
    'sponsorship_interest',
    1500,
    'cad',
    'history@example.test',
    true,
    'Session name',
    true,
    true,
    'cs_backfill',
    'pi_retrieved',
    'paid',
    '2025-01-01T00:00:00.000Z',
    'synthetic-hash'
  ]);
  const payments = pool.queries.filter(({ sql }) =>
    sql.startsWith('INSERT INTO fund_transactions')
  );
  assert.deepEqual(payments[0].values.slice(0, 11), [
    'stripe-backfill:payment_intent.succeeded:pi_retrieved',
    'pi_retrieved',
    'txn_backfill',
    'payment_intent.succeeded',
    1500,
    75,
    1425,
    'cad',
    'succeeded',
    '2025-01-01T00:00:00.000Z',
    'contribution'
  ]);
  assert.deepEqual(JSON.parse(payments[0].values[11]), {
    source: 'stripe_backfill',
    project: 'openg7',
    checkoutSessionId: 'cs_backfill',
    eventType: 'payment_intent.succeeded'
  });
  assert.equal(
    payments[1].values[0],
    'stripe-backfill:payout.paid:po_backfill'
  );
  assert.equal(payments[1].values[10], 'payout');
  assert.deepEqual(JSON.parse(payments[1].values[11]), {
    source: 'stripe_backfill',
    eventType: 'payout.paid'
  });
  const indexOf = (predicate) => pool.queries.findIndex(predicate);
  const paid = indexOf(
    ({ sql, values }) =>
      sql.startsWith('UPDATE fund_contributions SET status') &&
      values[1] === 'paid'
  );
  const disputed = indexOf(
    ({ sql, values }) =>
      sql.startsWith('UPDATE fund_contributions SET status') &&
      values[1] === 'disputed'
  );
  assert.ok(indexOf((q) => q === contribution) < paid);
  assert.ok(paid < indexOf((q) => q === payments[0]));
  assert.ok(
    indexOf((q) => q === payments[0]) < indexOf((q) => q === payments[1])
  );
  assert.ok(indexOf((q) => q === payments[1]) < disputed);
  assert.equal(
    pool.queries.some(({ sql }) =>
      /INSERT INTO (contribution_activity|email_|sponsorship_invoices)/.test(
        sql
      )
    ),
    false
  );
  assert.equal(summary.checkoutSessions.upserted, 1);
  assert.equal(summary.paymentIntents.insertedTransactions, 1);
  assert.equal(summary.payouts.insertedTransactions, 1);
  assert.equal(summary.disputes.statusUpdated, 1);
});

test('expired Checkout without metadata keeps a stable fallback reference and explicit false acknowledgment', async () => {
  const checkout = session(null, {
    id: 'cs_fallback',
    payment_status: 'unpaid',
    status: 'expired',
    metadata: { nonCharityAcknowledged: 'false' }
  });
  const pool = simulatedPool({ readOnly: false });
  await runStripeBackfill(simulatedStripe({ sessions: [checkout] }), pool, {
    ...options,
    dryRun: false,
    includeUnmatched: true,
    assumeNonCharityAcknowledged: true
  });
  const contribution = pool.queries.find(({ sql }) =>
    sql.startsWith('INSERT INTO fund_contributions')
  );
  const suffix = createHash('sha256')
    .update('cs_fallback')
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
  assert.equal(contribution.values[0], 'OG7-2025-' + suffix);
  assert.equal(contribution.values[8], false);
  assert.equal(contribution.values[11], 'expired');
  assert.equal(contribution.values[12], null);
  assert.equal(
    pool.queries.some(({ sql }) =>
      sql.startsWith('INSERT INTO fund_transactions')
    ),
    false
  );
});

test('provider failure retains its identity and prevents subsequent backfill phases and completion log', async () => {
  const failure = new Error('Synthetic transient provider failure');
  const stripe = simulatedStripe({ sessions: [session('pi_failure')] });
  stripe.paymentIntents.retrieve = async () => {
    throw failure;
  };
  const messages = [];
  await assert.rejects(
    runStripeBackfill(stripe, simulatedPool(), {
      ...options,
      includePayouts: true,
      includeDisputes: true,
      logger: {
        log(message) {
          messages.push(message);
        }
      }
    }),
    (error) => error === failure
  );
  assert.deepEqual(
    stripe.calls.map(([kind]) => kind),
    ['checkout']
  );
  assert.deepEqual(messages, [
    'Stripe backfill started for project openg7 (dry run).'
  ]);
});

test('Checkout deadline rejects before resolving or mutating its first object', async () => {
  const stripe = simulatedStripe({
    sessions: [session('pi_must_not_resolve')]
  });
  const pool = simulatedPool();
  await assert.rejects(
    runStripeBackfill(stripe, pool, {
      ...options,
      deadlineAt: 1,
      includePayouts: true
    }),
    /Backfill time limit reached\./
  );
  assert.equal(pool.queries.length, 1);
  assert.deepEqual(
    stripe.calls.map(([kind]) => kind),
    ['checkout']
  );
});
