import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import pg from 'pg';
import Stripe from 'stripe';

import { createDurableCheckoutService } from '../../dist/apps/funding-api/src/checkout-operations.service.js';
import { insertCheckoutSessionRecord } from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const deferred = () => Promise.withResolvers();

function checkoutRequest(label) {
  const key = `synthetic-checkout:${label}:${randomUUID()}`;
  let preparations = 0;
  return {
    key,
    requestHash: hash(`${key}:payload`),
    get preparations() {
      return preparations;
    },
    prepare(operationId) {
      preparations++;
      const publicReference = `OG7-${operationId}`;
      const metadata = {
        projectId: 'openg7',
        publicReference,
        contributionType: 'personal_support',
        nonCharityAcknowledged: 'true',
        checkoutOperationId: operationId
      };
      return {
        params: {
          mode: 'payment',
          success_url: `https://example.test/success?reference=${publicReference}`,
          cancel_url: `https://example.test/cancel?reference=${publicReference}`,
          client_reference_id: publicReference,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: 'cad',
                unit_amount: 2500,
                product_data: { name: 'Synthetic OpenG7 contribution' }
              }
            }
          ],
          payment_intent_data: { metadata },
          metadata
        },
        record: {
          publicReference,
          contributionType: 'personal_support',
          amountCents: 2500,
          currency: 'cad',
          metadata,
          publicDisplayConsent: false,
          publicName: null,
          displayAmountConsent: false,
          nonCharityAcknowledged: true,
          sponsorshipFollowupTokenHash: null
        }
      };
    }
  };
}

// The fake models Stripe's durable idempotency cache, including a session that
// was accepted before the HTTP response was lost. It never contacts Stripe.
function stripeProvider({ beforeCreate, loseFirstResponse = false } = {}) {
  const calls = [];
  const sessions = new Map();
  return {
    calls,
    sessions,
    stripe: {
      checkout: {
        sessions: {
          async create(params, options) {
            assert.match(
              options?.idempotencyKey ?? '',
              /^openg7:checkout:[0-9a-f-]{36}$/
            );
            const savedParams = structuredClone(params);
            calls.push({ params: savedParams, options: { ...options } });
            if (beforeCreate) await beforeCreate(savedParams, options);
            let cached = sessions.get(options.idempotencyKey);
            if (cached) {
              assert.deepEqual(savedParams, cached.params);
            } else {
              const suffix = randomUUID().replaceAll('-', '');
              cached = {
                params: savedParams,
                session: {
                  id: `cs_test_${suffix}`,
                  url: `https://checkout.example.test/${suffix}`,
                  payment_intent: `pi_test_${suffix}`
                }
              };
              sessions.set(options.idempotencyKey, cached);
            }
            if (loseFirstResponse && calls.length === 1) {
              throw new Error('Synthetic lost provider response');
            }
            return structuredClone(cached.session);
          }
        }
      }
    }
  };
}

const operation = async (pool, input) => {
  const { rows } = await pool.query(
    'SELECT * FROM checkout_operations WHERE request_hash=$1',
    [input.requestHash]
  );
  assert.equal(rows.length, 1);
  return rows[0];
};

const assertPendingContribution = async (pool, result) => {
  const { rows } = await pool.query(
    `SELECT c.status, c.paid_at, c.amount_cents, c.currency,
       c.public_display_consent, c.display_amount_consent,
       s.status AS session_status
     FROM fund_contributions c
     JOIN stripe_checkout_sessions s USING (stripe_session_id)
     WHERE c.stripe_session_id=$1`,
    [result.checkoutId]
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    status: 'pending',
    paid_at: null,
    amount_cents: 2500,
    currency: 'cad',
    public_display_consent: false,
    display_amount_consent: false,
    session_status: 'pending'
  });
  assert.equal(
    (await pool.query('SELECT count(*)::int AS count FROM fund_transactions'))
      .rows[0].count,
    0
  );
};

test('Checkout refuses provider effects without durable storage', async () => {
  const provider = stripeProvider();
  const input = checkoutRequest('no-storage');
  const checkout = createDurableCheckoutService(null, provider.stripe);
  await assert.rejects(checkout(input), {
    code: 'CHECKOUT_STORAGE_UNAVAILABLE'
  });
  assert.equal(input.preparations, 0);
  assert.equal(provider.calls.length, 0);
  assert.equal(provider.sessions.size, 0);
});

test(
  'Checkout deduplicates and recovers durable operations across PostgreSQL clients',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres({ migrate: false });
    const secondPool = new pg.Pool({
      ...db.pool.options,
      password: db.pool.options.password,
      application_name: 'og7-disposable-checkout-second-instance'
    });
    t.after(async () => {
      await secondPool.end();
      await db.stop();
    });

    await t.test(
      'the additive migration preserves an existing contribution and session',
      async () => {
        const migrationsDirectory = new URL(
          '../../apps/funding-api/migrations/',
          import.meta.url
        );
        const migrationName = '031_create_checkout_operations.sql';
        const migrations = (await readdir(migrationsDirectory))
          .filter((name) => /^\d+_.+\.sql$/.test(name))
          .sort();
        assert.ok(migrations.includes(migrationName));
        for (const migration of migrations.filter(
          (name) => name < migrationName
        )) {
          await db.pool.query(
            await readFile(new URL(migration, migrationsDirectory), 'utf8')
          );
        }
        const seed = {
          ...checkoutRequest('existing-before-migration').prepare(randomUUID())
            .record,
          stripeSessionId: 'cs_test_preexisting_checkout',
          stripePaymentIntentId: 'pi_test_preexisting_checkout'
        };
        await insertCheckoutSessionRecord(db.pool, seed);
        const snapshot = async () => ({
          contributions: (
            await db.pool.query('SELECT * FROM fund_contributions')
          ).rows,
          sessions: (
            await db.pool.query('SELECT * FROM stripe_checkout_sessions')
          ).rows
        });
        const before = await snapshot();
        assert.equal(
          (
            await db.pool.query(
              "SELECT to_regclass('checkout_operations') AS relation"
            )
          ).rows[0].relation,
          null
        );
        const provider = stripeProvider();
        const uninitialized = checkoutRequest('missing-migration');
        await assert.rejects(
          createDurableCheckoutService(db.pool, provider.stripe)(uninitialized),
          { code: 'CHECKOUT_STORAGE_UNAVAILABLE' }
        );
        assert.equal(provider.calls.length, 0);
        assert.equal(uninitialized.preparations, 0);
        await db.pool.query(
          await readFile(new URL(migrationName, migrationsDirectory), 'utf8')
        );
        assert.deepEqual(await snapshot(), before);
        assert.equal(
          (
            await db.pool.query(
              'SELECT count(*)::int AS count FROM checkout_operations'
            )
          ).rows[0].count,
          0
        );
      }
    );

    await t.test(
      'a restarted instance returns the same session and contribution',
      async () => {
        const provider = stripeProvider();
        const input = checkoutRequest('restart');
        const first = await createDurableCheckoutService(
          db.pool,
          provider.stripe
        )(input);
        const second = await createDurableCheckoutService(
          secondPool,
          provider.stripe
        )({
          ...input,
          prepare() {
            assert.fail(
              'A completed operation must reuse its durable preparation'
            );
          }
        });
        assert.deepEqual(second, first);
        assert.equal(first.status, 'redirected');
        assert.equal(provider.calls.length, 1);
        assert.equal(provider.sessions.size, 1);
        assert.equal(input.preparations, 1);
        const stored = await operation(db.pool, input);
        assert.equal(stored.state, 'completed');
        assert.equal(stored.key_hash, hash(input.key));
        assert.equal(stored.provider_result.checkoutId, first.checkoutId);
        assert.equal(
          provider.calls[0].options.idempotencyKey,
          `openg7:checkout:${stored.id}`
        );
        await assertPendingContribution(db.pool, first);
      }
    );

    await t.test(
      'a single-connection pool persists Checkout without acquiring a second connection',
      async (t) => {
        const singlePool = new pg.Pool({
          ...db.pool.options,
          password: db.pool.options.password,
          max: 1,
          connectionTimeoutMillis: 500,
          application_name: 'og7-disposable-checkout-single-connection'
        });
        t.after(() => singlePool.end());
        const provider = stripeProvider();
        const input = checkoutRequest('single-connection');
        const result = await createDurableCheckoutService(
          singlePool,
          provider.stripe
        )(input);
        assert.equal(provider.calls.length, 1);
        assert.equal((await operation(db.pool, input)).state, 'completed');
        await assertPendingContribution(db.pool, result);
      }
    );

    await t.test(
      'a conflicting payload is refused without provider or contribution effects',
      async () => {
        const provider = stripeProvider();
        const input = checkoutRequest('conflict');
        const first = await createDurableCheckoutService(
          db.pool,
          provider.stripe
        )(input);
        const before = await operation(db.pool, input);
        await assert.rejects(
          createDurableCheckoutService(
            secondPool,
            provider.stripe
          )({
            ...input,
            requestHash: hash(`${input.key}:different-amount`),
            prepare() {
              assert.fail('A conflicting payload must not be prepared');
            }
          }),
          { code: 'CHECKOUT_IDEMPOTENCY_CONFLICT' }
        );
        assert.deepEqual(await operation(db.pool, input), before);
        assert.equal(provider.calls.length, 1);
        assert.equal(provider.sessions.size, 1);
        await assertPendingContribution(db.pool, first);
      }
    );

    await t.test(
      'concurrent instances reject a duplicate while Stripe is pending',
      async () => {
        const entered = deferred();
        const release = deferred();
        const input = checkoutRequest('concurrent');
        const provider = stripeProvider({
          async beforeCreate(params) {
            const stored = await operation(db.pool, input);
            assert.equal(stored.state, 'submitting');
            assert.deepEqual(stored.params, params);
            assert.equal(
              stored.contribution_input.publicReference,
              params.client_reference_id
            );
            assert.ok(stored.first_submitted_at instanceof Date);
            const transactions = await db.pool.query(
              `SELECT count(*)::int AS count FROM pg_stat_activity
             WHERE datname=current_database() AND state='idle in transaction'`
            );
            assert.equal(transactions.rows[0].count, 0);
            entered.resolve();
            await release.promise;
          }
        });
        const first = createDurableCheckoutService(
          db.pool,
          provider.stripe
        )(input);
        try {
          await Promise.race([
            entered.promise,
            first.then(() =>
              assert.fail('Provider call should wait for the test gate')
            )
          ]);
          await assert.rejects(
            createDurableCheckoutService(secondPool, provider.stripe)(input),
            { code: 'CHECKOUT_IN_PROGRESS' }
          );
          assert.equal(provider.calls.length, 1);
          assert.equal(input.preparations, 1);
        } finally {
          release.resolve();
        }
        const result = await first;
        // Releasing the first client's advisory lock allows a later replay.
        assert.deepEqual(
          await createDurableCheckoutService(
            secondPool,
            provider.stripe
          )(input),
          result
        );
        assert.equal(provider.calls.length, 1);
        await assertPendingContribution(db.pool, result);
      }
    );

    await t.test(
      'a lost Stripe response reuses the exact provider key and prepared payload',
      async () => {
        const provider = stripeProvider({ loseFirstResponse: true });
        const input = checkoutRequest('lost-response');
        await assert.rejects(
          createDurableCheckoutService(db.pool, provider.stripe)(input),
          { code: 'CHECKOUT_PROVIDER_UNAVAILABLE' }
        );
        const uncertain = await operation(db.pool, input);
        assert.equal(uncertain.state, 'uncertain');
        assert.equal(uncertain.provider_result, null);
        assert.equal(provider.sessions.size, 1);
        const result = await createDurableCheckoutService(
          secondPool,
          provider.stripe
        )({
          ...input,
          prepare() {
            assert.fail(
              'Recovery must retain the reference and all Stripe parameters'
            );
          }
        });
        assert.equal(provider.calls.length, 2);
        assert.deepEqual(provider.calls[1], provider.calls[0]);
        assert.equal(provider.sessions.size, 1);
        assert.equal((await operation(db.pool, input)).state, 'completed');
        assert.equal(input.preparations, 1);
        assert.equal(
          result.checkoutId,
          [...provider.sessions.values()][0].session.id
        );
        await assertPendingContribution(db.pool, result);
      }
    );

    await t.test(
      'a database connection lost during Stripe creation fails safely and resumes with the same session',
      async (t) => {
        const applicationName = `og7-checkout-disconnect-${randomUUID()}`;
        const checkoutPool = new pg.Pool({
          ...db.pool.options,
          password: db.pool.options.password,
          max: 1,
          application_name: applicationName
        });
        t.after(() => checkoutPool.end());
        let activeClient;
        checkoutPool.on('connect', (client) => {
          activeClient = client;
        });
        const input = checkoutRequest('backend-disconnect');
        const provider = stripeProvider({
          async beforeCreate() {
            if (provider.calls.length !== 1) return;
            const stored = await operation(db.pool, input);
            assert.equal(stored.state, 'submitting');
            // Check the service's protection before observing the actual error,
            // so this observer cannot conceal a missing service error listener.
            assert.ok(activeClient.listenerCount('error') > 0);
            const clientError = once(activeClient, 'error');
            const targets = await secondPool.query(
              `SELECT pid FROM pg_stat_activity
               WHERE datname=current_database() AND application_name=$1`,
              [applicationName]
            );
            assert.equal(targets.rows.length, 1);
            const terminated = await secondPool.query(
              'SELECT pg_terminate_backend($1) AS terminated',
              [targets.rows[0].pid]
            );
            assert.equal(terminated.rows[0].terminated, true);
            const [error] = await clientError;
            assert.ok(error instanceof Error);
          }
        });
        await assert.rejects(
          createDurableCheckoutService(checkoutPool, provider.stripe)(input),
          { code: 'CHECKOUT_STORAGE_UNAVAILABLE', status: 503 }
        );
        assert.equal(provider.sessions.size, 1);
        assert.equal(checkoutPool.totalCount, 0);
        const unresolved = await operation(db.pool, input);
        assert.equal(unresolved.state, 'submitting');
        assert.equal(unresolved.provider_result, null);
        const result = await createDurableCheckoutService(
          checkoutPool,
          provider.stripe
        )({
          ...input,
          prepare() {
            assert.fail(
              'Reconnection must retain the durable Stripe preparation'
            );
          }
        });
        assert.equal(provider.calls.length, 2);
        assert.deepEqual(provider.calls[1], provider.calls[0]);
        assert.equal(provider.sessions.size, 1);
        assert.equal(
          result.checkoutId,
          [...provider.sessions.values()][0].session.id
        );
        const completed = await operation(db.pool, input);
        assert.equal(completed.state, 'completed');
        assert.deepEqual(
          completed.first_submitted_at,
          unresolved.first_submitted_at
        );
        await assertPendingContribution(db.pool, result);
      }
    );

    await t.test(
      'the real Stripe SDK forwards the same Idempotency-Key and form after a lost HTTP response',
      async (t) => {
        const captures = [];
        const sessions = new Map();
        let loseResponses = true;
        const server = createServer(async (request, response) => {
          let body = '';
          for await (const chunk of request) body += chunk;
          const key = request.headers['idempotency-key'];
          captures.push({
            method: request.method,
            path: request.url,
            key,
            body
          });
          if (
            request.method !== 'POST' ||
            request.url !== '/v1/checkout/sessions'
          ) {
            response.writeHead(404);
            response.end('{}');
            return;
          }
          if (!sessions.has(key)) {
            const suffix = randomUUID().replaceAll('-', '');
            sessions.set(key, {
              id: `cs_test_http_${suffix}`,
              object: 'checkout.session',
              url: `https://checkout.example.test/${suffix}`,
              payment_intent: `pi_test_http_${suffix}`
            });
          }
          if (loseResponses) {
            // Stripe accepted the operation; its HTTP response did not reach us.
            request.socket.destroy();
            return;
          }
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify(sessions.get(key)));
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        t.after(async () => {
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
        });
        const stripe = new Stripe('sk_test_synthetic_checkout_idempotency', {
          host: '127.0.0.1',
          port: server.address().port,
          protocol: 'http',
          maxNetworkRetries: 0,
          timeout: 5000
        });
        const input = checkoutRequest('sdk-http-recovery');
        await assert.rejects(
          createDurableCheckoutService(db.pool, stripe)(input),
          { code: 'CHECKOUT_PROVIDER_UNAVAILABLE' }
        );
        const attemptsBeforeRecovery = captures.length;
        assert.ok(attemptsBeforeRecovery >= 1);
        assert.equal((await operation(db.pool, input)).state, 'uncertain');
        loseResponses = false;
        const result = await createDurableCheckoutService(
          secondPool,
          stripe
        )(input);
        assert.equal(captures.length, attemptsBeforeRecovery + 1);
        for (const capture of captures) assert.deepEqual(capture, captures[0]);
        const stored = await operation(db.pool, input);
        assert.equal(captures[0].key, `openg7:checkout:${stored.id}`);
        const form = new URLSearchParams(captures[0].body);
        assert.equal(form.get('mode'), 'payment');
        assert.equal(
          form.get('line_items[0][price_data][unit_amount]'),
          '2500'
        );
        assert.equal(form.get('line_items[0][price_data][currency]'), 'cad');
        assert.equal(
          form.get('client_reference_id'),
          stored.contribution_input.publicReference
        );
        assert.equal(form.get('metadata[checkoutOperationId]'), stored.id);
        assert.equal(form.get('success_url'), stored.params.success_url);
        assert.equal(sessions.size, 1);
        assert.equal(result.checkoutId, [...sessions.values()][0].id);
        assert.equal(input.preparations, 1);
        await assertPendingContribution(db.pool, result);
      }
    );

    for (const afterCommit of [false, true]) {
      await t.test(
        `persistence failure ${afterCommit ? 'after commit' : 'before writes'} resumes without creating another session`,
        async () => {
          const provider = stripeProvider();
          const input = checkoutRequest(`persistence-${afterCommit}`);
          await assert.rejects(
            createDurableCheckoutService(
              db.pool,
              provider.stripe,
              async (record) => {
                if (afterCommit)
                  await insertCheckoutSessionRecord(db.pool, record);
                throw new Error('Synthetic contribution persistence outage');
              }
            )(input),
            { code: 'CHECKOUT_PERSISTENCE_FAILED' }
          );
          const stored = await operation(db.pool, input);
          assert.equal(stored.state, 'created');
          assert.ok(stored.provider_result.checkoutId);
          assert.equal(
            (
              await db.pool.query(
                'SELECT count(*)::int AS count FROM fund_contributions WHERE stripe_session_id=$1',
                [stored.provider_result.checkoutId]
              )
            ).rows[0].count,
            afterCommit ? 1 : 0
          );
          // Provider cache expiry cannot matter once the provider result is known.
          await db.pool.query(
            `UPDATE checkout_operations
           SET first_submitted_at=NOW()-INTERVAL '25 hours' WHERE id=$1`,
            [stored.id]
          );
          const result = await createDurableCheckoutService(
            secondPool,
            provider.stripe
          )({
            ...input,
            prepare() {
              assert.fail(
                'Persistence recovery must reuse the durable contribution input'
              );
            }
          });
          assert.equal(provider.calls.length, 1);
          assert.equal(provider.sessions.size, 1);
          assert.equal(result.checkoutId, stored.provider_result.checkoutId);
          assert.equal((await operation(db.pool, input)).state, 'completed');
          await assertPendingContribution(db.pool, result);
        }
      );
    }

    await t.test(
      'an uncertain operation outside the safe Stripe window requires reconciliation',
      async () => {
        const provider = stripeProvider({ loseFirstResponse: true });
        const input = checkoutRequest('expired-window');
        await assert.rejects(
          createDurableCheckoutService(db.pool, provider.stripe)(input),
          { code: 'CHECKOUT_PROVIDER_UNAVAILABLE' }
        );
        await db.pool.query(
          `UPDATE checkout_operations
         SET first_submitted_at=NOW()-INTERVAL '23 hours 1 minute' WHERE request_hash=$1`,
          [input.requestHash]
        );
        const before = await operation(db.pool, input);
        await assert.rejects(
          createDurableCheckoutService(
            secondPool,
            provider.stripe
          )({
            ...input,
            prepare() {
              assert.fail('Reconciliation must not prepare a new operation');
            }
          }),
          { code: 'CHECKOUT_RECONCILIATION_REQUIRED' }
        );
        assert.equal(provider.calls.length, 1);
        assert.equal(provider.sessions.size, 1);
        assert.deepEqual(await operation(db.pool, input), before);
        assert.equal(
          (
            await db.pool.query(
              'SELECT count(*)::int AS count FROM fund_contributions WHERE stripe_session_id=$1',
              [[...provider.sessions.values()][0].session.id]
            )
          ).rows[0].count,
          0
        );
      }
    );
  }
);
