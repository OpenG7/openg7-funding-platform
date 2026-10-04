import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import Stripe from 'stripe';

import { processStripeWebhook } from '../dist/apps/funding-api/src/stripe-webhook.service.js';
import { withStripeEventProcessing } from '../dist/apps/funding-api/src/stripe-events.repository.js';

const stripe = new Stripe('sk_test_disposable_fixture', {
  host: '127.0.0.1',
  port: 1,
  protocol: 'http',
  maxNetworkRetries: 0
});
const secret = 'whsec_disposable_fixture';
const payload = JSON.stringify({
  id: 'evt_ignored_fixture',
  type: 'test.ignored',
  data: { object: {} }
});

test('a bad Stripe signature never opens a database connection', async () => {
  const pool = {
    connect() {
      throw new Error('Database must not be reached');
    }
  };
  const response = await processStripeWebhook(payload, 'invalid', {
    stripe,
    webhookSecret: secret,
    pool,
    projectId: 'openg7',
    publicBaseUrl: 'https://example.test'
  });
  assert.equal(response.statusCode, 400);
});

test('an ignored verified event is accepted in Stripe-direct mode', async () => {
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret
  });
  const response = await processStripeWebhook(payload, signature, {
    stripe,
    webhookSecret: secret,
    pool: null,
    projectId: 'openg7',
    publicBaseUrl: 'https://example.test'
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ignored, true);
});

test('borrowed destruction fences subsequent writes and retires the owner connection after processing exits', async () => {
  const queries = [];
  const releases = [];
  const client = new EventEmitter();
  client.query = async (sql) => {
    queries.push(sql);
    if (sql.includes('pg_try_advisory_lock'))
      return { rows: [{ locked: true }] };
    return { rows: [], rowCount: 1 };
  };
  client.release = (destroy) => releases.push(destroy);
  const failure = new Error('Synthetic refund unlock failure');
  await assert.rejects(
    withStripeEventProcessing(
      {
        async connect() {
          return client;
        }
      },
      {
        stripeEventId: 'evt_synthetic_destroy',
        eventType: 'refund.updated',
        payload: {}
      },
      async (eventPool) => {
        const borrowed = await eventPool.connect();
        borrowed.release(true);
        assert.deepEqual(releases, []);
        await assert.rejects(
          eventPool.query('SELECT subsequent_write'),
          /connection is unavailable/
        );
        throw failure;
      }
    ),
    (error) => error === failure
  );
  assert.deepEqual(releases, [true]);
  assert.ok(
    queries.every(
      (sql) =>
        !sql.includes('subsequent_write') && !sql.includes('pg_advisory_unlock')
    )
  );
  assert.equal(client.listenerCount('error'), 0);
});

test('unavailable event persistence requests a Stripe retry', async () => {
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret
  });
  const response = await processStripeWebhook(payload, signature, {
    stripe,
    webhookSecret: secret,
    pool: {
      async connect() {
        throw new Error('Simulated DB outage');
      }
    },
    projectId: 'openg7',
    publicBaseUrl: 'https://example.test'
  });
  assert.equal(response.statusCode, 500);
  assert.equal(response.payload.received, false);
});

const signedEvent = async (stripeClient, database, event) => {
  const rawBody = JSON.stringify(event);
  return processStripeWebhook(
    rawBody,
    stripeClient.webhooks.generateTestHeaderString({
      payload: rawBody,
      secret
    }),
    {
      stripe: stripeClient,
      webhookSecret: secret,
      pool: database,
      projectId: 'openg7',
      publicBaseUrl: 'https://example.test'
    }
  );
};

const stripeFixture = () =>
  new Stripe('sk_test_disposable_fixture', {
    host: '127.0.0.1',
    port: 1,
    protocol: 'http',
    maxNetworkRetries: 0
  });

// Capture orchestration across the real repositories without a provider or DB.
// PostgreSQL constraints and transaction rollback are covered by integrations.
const databaseFixture = ({ busy = false } = {}) => {
  const calls = [];
  const events = new Map();
  const transactions = new Map();
  const client = new EventEmitter();
  client.release = () => calls.push({ sql: 'RELEASE', values: [] });
  client.query = async (sql, values = []) => {
    calls.push({ sql, values });
    if (sql.includes('pg_try_advisory_lock'))
      return { rows: [{ locked: !busy }] };
    if (sql.includes('pg_advisory_unlock'))
      return { rows: [{ unlocked: true }] };
    if (sql.includes('INSERT INTO stripe_events')) {
      if (events.get(values[0]) === 'processed')
        return { rowCount: 0, rows: [] };
      events.set(values[0], 'processing');
    }
    if (sql.includes("processing_status = 'processed'"))
      events.set(values[0], 'processed');
    if (sql.includes("processing_status = 'failed'"))
      events.set(values[0], 'failed');
    if (sql.includes('FROM contribution_activity'))
      return { rowCount: 0, rows: [] };
    if (sql.includes('SELECT amount::text, currency FROM fund_transactions')) {
      const row = transactions.get(`${values[0]}:payment_intent.succeeded`);
      return {
        rows: row
          ? [{ amount: String(row.amount), currency: row.currency }]
          : []
      };
    }
    if (sql.includes('SELECT amount::text, currency, type')) {
      const existing = [...transactions.values()].filter(
        (row) => row.objectId === values[0] && values[1].includes(row.type)
      );
      return {
        rowCount: existing.length,
        rows: existing.map(({ amount, currency, type }) => ({
          amount: String(amount),
          currency,
          type
        }))
      };
    }
    if (sql.includes('INSERT INTO fund_transactions')) {
      const [
        eventId,
        objectId,
        balanceTransactionId,
        type,
        amount,
        fee,
        net,
        currency,
        status,
        createdAtIso,
        publicCategory,
        metadata
      ] = values;
      transactions.set(`${objectId}:${type}`, {
        eventId,
        objectId,
        balanceTransactionId,
        type,
        amount,
        fee,
        net,
        currency,
        status,
        createdAtIso,
        publicCategory,
        metadata: JSON.parse(metadata)
      });
    }
    if (sql.includes('UPDATE fund_transactions')) {
      const row = transactions.get(`${values[0]}:payment_intent.succeeded`);
      if (!row) return { rowCount: 0, rows: [] };
      Object.assign(row, {
        balanceTransactionId: values[1],
        fee: values[3],
        net: values[4]
      });
    }
    return { rowCount: 1, rows: [] };
  };
  return {
    calls,
    events,
    transactions,
    client,
    pool: { connect: async () => client, query: client.query }
  };
};

test('a tagged project mismatch is ignored before claiming or handling the event', async () => {
  const response = await signedEvent(
    stripe,
    {
      connect() {
        throw new Error('An unrelated event must not be claimed');
      }
    },
    {
      id: 'evt_unrelated_payment',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_unrelated_payment',
          metadata: { project: 'other-project' }
        }
      }
    }
  );
  assert.deepEqual(response, {
    statusCode: 200,
    payload: { received: true, ignored: true, reason: 'PROJECT_MISMATCH' }
  });
});

test('converted payment balances fail safely and the same event recovers after a compatible balance is supplied', async () => {
  const stripeClient = stripeFixture();
  const database = databaseFixture();
  let balance = {
    id: 'txn_currency_guard',
    amount: 1800,
    fee: 100,
    net: 1700,
    currency: 'usd'
  };
  stripeClient.charges.retrieve = async () => ({
    id: 'ch_currency_guard',
    balance_transaction: balance
  });
  const event = {
    id: 'evt_currency_guard',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_currency_guard',
        latest_charge: 'ch_currency_guard',
        amount: 2500,
        amount_received: 2500,
        currency: 'cad',
        status: 'succeeded',
        created: 1735689600,
        metadata: { project: 'openg7' }
      }
    }
  };
  const incompatible = await signedEvent(stripeClient, database.pool, event);
  assert.equal(incompatible.statusCode, 500);
  assert.equal(database.events.get(event.id), 'failed');
  assert.equal(database.transactions.size, 0);
  balance = { ...balance, amount: 2500, fee: 100, net: 2400, currency: 'cad' };
  const compatible = await signedEvent(stripeClient, database.pool, event);
  assert.equal(compatible.statusCode, 200);
  assert.equal(database.events.get(event.id), 'processed');
  assert.equal(database.transactions.size, 1);
  const payment = database.transactions.get(
    'pi_currency_guard:payment_intent.succeeded'
  );
  assert.equal(payment.amount, 2500);
  assert.equal(payment.currency, 'cad');
  assert.equal(payment.net, 2400);
});

test('late balance events reject contradictions and preserve the original confirmed payment', async () => {
  const stripeClient = stripeFixture();
  const database = databaseFixture();
  stripeClient.charges.retrieve = async () => ({
    id: 'ch_immutable_gross',
    balance_transaction: null
  });
  await signedEvent(stripeClient, database.pool, {
    id: 'evt_immutable_payment',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_immutable_gross',
        latest_charge: 'ch_immutable_gross',
        amount: 2500,
        amount_received: 2500,
        currency: 'cad',
        status: 'succeeded',
        created: 1735689600,
        metadata: { project: 'openg7' }
      }
    }
  });
  const original = structuredClone(
    database.transactions.get('pi_immutable_gross:payment_intent.succeeded')
  );
  for (const [index, amount, currency] of [
    [1, 1800, 'usd'],
    [2, 2600, 'cad']
  ]) {
    const response = await signedEvent(stripeClient, database.pool, {
      id: `evt_immutable_charge_${index}`,
      type: 'charge.updated',
      data: {
        object: {
          id: 'ch_immutable_gross',
          payment_intent: 'pi_immutable_gross',
          amount,
          currency,
          status: 'succeeded',
          metadata: { project: 'openg7' },
          balance_transaction: {
            id: 'txn_incompatible',
            amount,
            currency,
            fee: 100,
            net: amount - 100
          }
        }
      }
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(
      database.transactions.get('pi_immutable_gross:payment_intent.succeeded'),
      original
    );
  }
});

test('a busy claim defers the financial handler without making any payment writes', async () => {
  const database = databaseFixture({ busy: true });
  const response = await signedEvent(stripe, database.pool, {
    id: 'evt_busy_payment',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_busy', metadata: { project: 'openg7' } } }
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.payload.received, false);
  assert.equal(database.events.size, 0);
  assert.equal(database.transactions.size, 0);
  assert.ok(
    database.calls.every(({ sql }) => !/^\s*(INSERT|UPDATE|DELETE)\b/.test(sql))
  );
  assert.equal(database.client.listenerCount('error'), 0);
});

test('payment handling recovers after Charge retrieval fails and late fees enrich the same payment', async () => {
  const stripeClient = stripeFixture();
  const database = databaseFixture();
  let chargeRetrievals = 0;
  const balanceRetrievals = [];
  stripeClient.charges.retrieve = async (id, options) => {
    chargeRetrievals++;
    assert.equal(id, 'ch_recoverable');
    assert.deepEqual(options, { expand: ['balance_transaction'] });
    // Confirmation writes and commit precede provider retrieval.
    assert.ok(
      database.calls.some(({ sql }) =>
        sql.includes('INSERT INTO contribution_payment_confirmations')
      )
    );
    assert.equal(database.calls.at(-1).sql, 'COMMIT');
    if (chargeRetrievals === 1)
      throw new Error('Synthetic temporary Charge outage');
    return { id, balance_transaction: null };
  };
  stripeClient.balanceTransactions.retrieve = async (id) => {
    balanceRetrievals.push(id);
    return { id, amount: 6400, fee: 215, net: 6185, currency: 'cad' };
  };
  const paymentEvent = {
    id: 'evt_recoverable_payment',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_recoverable',
        metadata: { projectId: 'openg7' },
        amount: 6400,
        amount_received: 6400,
        currency: 'cad',
        status: 'succeeded',
        created: 1735689600,
        // Even an expanded snapshot must preserve the webhook's fresh retrieval.
        latest_charge: { id: 'ch_recoverable', balance_transaction: null }
      }
    }
  };
  assert.equal(
    (await signedEvent(stripeClient, database.pool, paymentEvent)).statusCode,
    500
  );
  assert.equal(database.events.get(paymentEvent.id), 'failed');
  assert.equal(database.transactions.size, 0);
  assert.deepEqual(
    await signedEvent(stripeClient, database.pool, paymentEvent),
    {
      statusCode: 200,
      payload: { received: true, inserted: true, statusUpdated: true }
    }
  );
  const transaction = database.transactions.get(
    'pi_recoverable:payment_intent.succeeded'
  );
  assert.equal(transaction.balanceTransactionId, null);
  assert.equal(transaction.fee, 0);
  assert.equal(transaction.net, 6400);
  assert.deepEqual(transaction.metadata, {
    source: 'stripe',
    project: 'openg7',
    eventType: 'payment_intent.succeeded'
  });
  const originalEventId = transaction.eventId;
  assert.deepEqual(
    await signedEvent(stripeClient, database.pool, {
      id: 'evt_late_balance',
      type: 'charge.updated',
      data: {
        object: {
          id: 'ch_recoverable',
          metadata: { project: 'openg7' },
          payment_intent: { id: 'pi_recoverable' },
          balance_transaction: 'txn_late_balance',
          amount: 6400,
          currency: 'cad',
          status: 'succeeded'
        }
      }
    }),
    { statusCode: 200, payload: { received: true, updated: true } }
  );
  assert.equal(database.transactions.size, 1);
  assert.equal(transaction.eventId, originalEventId);
  assert.equal(transaction.balanceTransactionId, 'txn_late_balance');
  assert.equal(transaction.fee, 215);
  assert.equal(transaction.net, 6185);
  assert.deepEqual(balanceRetrievals, ['txn_late_balance']);
  const repeated = await signedEvent(stripeClient, database.pool, paymentEvent);
  assert.equal(repeated.payload.duplicate, true);
  assert.equal(chargeRetrievals, 2);
  assert.equal(transaction.fee, 215);
  assert.equal(database.client.listenerCount('error'), 0);
});

test('an incomplete Charge update is acknowledged without creating a financial fact', async () => {
  const database = databaseFixture();
  assert.deepEqual(
    await signedEvent(stripe, database.pool, {
      id: 'evt_missing_balance',
      type: 'charge.updated',
      data: {
        object: {
          id: 'ch_missing_balance',
          metadata: { project: 'openg7' },
          payment_intent: 'pi_missing_balance',
          balance_transaction: null
        }
      }
    }),
    {
      statusCode: 200,
      payload: {
        received: true,
        updated: false,
        hasBalanceTransaction: false
      }
    }
  );
  assert.equal(database.events.get('evt_missing_balance'), 'processed');
  assert.equal(database.transactions.size, 0);
});

test('Checkout forwards references and consents while a historical payment remains silent', async () => {
  const database = databaseFixture();
  const metadata = {
    project: 'openg7',
    contributionType: 'sponsorship_interest',
    publicReference: ' og7-2025-abcd ',
    publicDisplayConsent: 'true',
    publicDisplayName: 'Synthetic Sponsor',
    displayAmountConsent: 'false',
    nonCharityAcknowledged: 'true',
    sponsorshipFollowupTokenHash: 'synthetic-hash'
  };
  assert.deepEqual(
    await signedEvent(stripe, database.pool, {
      id: 'evt_historical_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_historical_checkout',
          payment_intent: { id: 'pi_historical_checkout' },
          payment_status: 'paid',
          amount_total: 6400,
          currency: 'cad',
          created: 1735689600,
          metadata,
          customer_details: { email: 'synthetic@example.test' },
          success_url: `https://example.test/success?followup_token=${'a'.repeat(40)}`
        }
      }
    }),
    {
      statusCode: 200,
      payload: {
        received: true,
        updated: true,
        followupEmailSent: false,
        sponsorshipInvoiceEmailSent: false
      }
    }
  );
  const session = database.calls.find(({ sql }) =>
    sql.includes('INSERT INTO stripe_checkout_sessions')
  );
  assert.deepEqual(JSON.parse(session.values[5]), metadata);
  const contribution = database.calls.find(({ sql }) =>
    sql.includes('INSERT INTO fund_contributions')
  );
  assert.deepEqual(contribution.values.slice(0, 14), [
    'OG7-2025-ABCD',
    'sponsorship_interest',
    6400,
    'cad',
    'synthetic@example.test',
    true,
    'Synthetic Sponsor',
    false,
    true,
    'cs_historical_checkout',
    'pi_historical_checkout',
    'paid',
    '2025-01-01T00:00:00.000Z',
    'synthetic-hash'
  ]);
  assert.ok(
    database.calls.some(({ sql }) => sql.includes('FROM contribution_activity'))
  );
  assert.ok(
    database.calls.every(
      ({ sql }) =>
        !sql.includes('email_queue') && !sql.includes('sponsorship_invoices')
    )
  );
});

test('a failed PaymentIntent keeps the trusted Checkout match and failed status', async () => {
  const database = databaseFixture();
  assert.deepEqual(
    await signedEvent(stripe, database.pool, {
      id: 'evt_failed_payment',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_failed_payment',
          amount: 6400,
          currency: 'cad',
          metadata: { project: 'openg7', publicReference: ' og7-2025-abcd ' }
        }
      }
    }),
    { statusCode: 200, payload: { received: true, updated: true } }
  );
  const checkoutMatch = database.calls.find(({ sql }) =>
    sql.includes(
      'WHERE public_reference = $2 AND amount_cents = $3 AND currency = $4'
    )
  );
  assert.deepEqual(checkoutMatch.values.slice(0, 4), [
    'pi_failed_payment',
    'OG7-2025-ABCD',
    6400,
    'cad'
  ]);
  const statusUpdate = database.calls.find(({ sql }) =>
    sql.includes('UPDATE stripe_checkout_sessions')
  );
  assert.deepEqual(statusUpdate.values.slice(0, 2), [
    'pi_failed_payment',
    'failed'
  ]);
  assert.equal(database.transactions.size, 0);
});

test('a project-tagged payout persists as a payout while an untagged account payout is ignored', async () => {
  const stripeClient = stripeFixture();
  stripeClient.balanceTransactions.retrieve = async () => {
    throw new Error('Expanded payout balance must not be retrieved again');
  };
  const database = databaseFixture();
  const payout = {
    id: 'po_project_payout',
    amount: 5000,
    currency: 'cad',
    status: 'paid',
    created: 1735689600,
    metadata: { project: 'openg7' },
    balance_transaction: {
      id: 'txn_project_payout',
      amount: -5000,
      fee: 0,
      net: -5000,
      currency: 'cad'
    }
  };
  assert.deepEqual(
    await signedEvent(stripeClient, database.pool, {
      id: 'evt_project_payout',
      type: 'payout.paid',
      data: { object: payout }
    }),
    { statusCode: 200, payload: { received: true, inserted: true } }
  );
  const transaction = database.transactions.get(
    'po_project_payout:payout.paid'
  );
  assert.equal(transaction.publicCategory, 'payout');
  assert.equal(transaction.amount, 5000);
  assert.equal(transaction.net, -5000);
  assert.deepEqual(transaction.metadata, {
    source: 'stripe',
    eventType: 'payout.paid'
  });
  const queryCount = database.calls.length;
  const unrelated = await signedEvent(stripeClient, database.pool, {
    id: 'evt_account_payout',
    type: 'payout.paid',
    data: { object: { ...payout, metadata: {} } }
  });
  assert.equal(unrelated.payload.reason, 'PROJECT_MISMATCH');
  assert.equal(database.calls.length, queryCount);
});
