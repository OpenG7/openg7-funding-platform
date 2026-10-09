import assert from 'node:assert/strict';
import test from 'node:test';

import {
  insertCheckoutSessionRecord,
  updateContributionStatusByPaymentIntent,
  upsertCheckoutSessionFromWebhook
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const paidAtIso = '2026-09-01T12:00:00.000Z';
const checkout = (name) => ({
  stripeSessionId: `cs_test_write_${name}`,
  stripePaymentIntentId: `pi_test_write_${name}`,
  publicReference: `OG7-WRITE-${name}`,
  contributionType: 'sponsorship_interest',
  amountCents: 12345,
  currency: 'CAD',
  metadata: {
    project: 'openg7',
    publicReference: `OG7-WRITE-${name}`,
    fixture: name,
    sponsorshipFollowupToken: 'synthetic-private-token'
  },
  publicDisplayConsent: true,
  publicName: 'Provider fixture',
  displayAmountConsent: true,
  nonCharityAcknowledged: true,
  sponsorshipFollowupTokenHash: `synthetic-token-hash-${name}`
});
const webhook = (fixture, patch = {}) => ({
  ...fixture,
  status: 'paid',
  paidAtIso,
  emailPrivate: 'fixture@example.invalid',
  notifyAdmin: true,
  ...patch
});
const payment = (fixture) => ({
  stripePaymentIntentId: fixture.stripePaymentIntentId,
  status: 'paid',
  paidAtIso,
  notifyAdmin: true
});
const storedState = async (pool, fixture) => {
  const { rows } = await pool.query(
    `SELECT c.*, s.status AS session_status,
       (SELECT count(*)::int FROM contribution_activity a
        WHERE a.contribution_id=c.id) AS activity_count,
       (SELECT count(*)::int FROM contribution_payment_confirmations p
        WHERE p.payment_intent_id=c.stripe_payment_intent_id) AS confirmation_count
     FROM fund_contributions c
     JOIN stripe_checkout_sessions s USING (stripe_session_id)
     WHERE c.stripe_session_id=$1`,
    [fixture.stripeSessionId]
  );
  assert.equal(rows.length, 1);
  return rows[0];
};

// Inject only a query failure; every successful query uses the acquired real
// PostgreSQL client, including BEGIN/ROLLBACK and all preceding financial writes.
const failingPool = (pool, queryFragment) => {
  const failure = new Error('Synthetic transaction failure');
  let releases = 0;
  const commands = [];
  return {
    failure,
    pool: {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: (sql, params) => {
            commands.push(sql);
            if (sql.includes(queryFragment)) throw failure;
            return client.query(sql, params);
          },
          release: () => {
            releases++;
            client.release();
          }
        };
      }
    },
    assertRolledBack: () => {
      assert.equal(releases, 1);
      assert.equal(commands[0], 'BEGIN');
      assert.equal(commands.at(-1), 'ROLLBACK');
      assert.equal(commands.includes('COMMIT'), false);
    }
  };
};

test(
  'extracted contribution writes retain payment priority, local choices, rollback and activity on PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);

    await t.test(
      'Checkout replay preserves local choices and a single confirmed activity',
      async () => {
        const fixture = checkout('replay');
        await upsertCheckoutSessionFromWebhook(db.pool, webhook(fixture));
        await db.pool.query(
          `UPDATE fund_contributions SET
           public_display_consent=false, display_amount_consent=false,
           non_charity_acknowledged=false, public_name='Local fixture',
           email_private='local@example.invalid',
           sponsorship_followup_token_hash='synthetic-local-token-hash'
         WHERE stripe_session_id=$1`,
          [fixture.stripeSessionId]
        );
        for (const status of ['expired', 'pending', 'paid']) {
          await upsertCheckoutSessionFromWebhook(
            db.pool,
            webhook(fixture, {
              status,
              paidAtIso: '2026-10-01T12:00:00.000Z',
              publicReference: 'OG7-WRITE-REPLAY-OTHER',
              metadata: {
                publicDisplayConsent: String(status === 'paid'),
                replay: status,
                sponsorshipFollowupToken: 'synthetic-private-replay-token'
              }
            })
          );
        }
        const state = await storedState(db.pool, fixture);
        assert.equal(state.status, 'paid');
        assert.equal(state.session_status, 'paid');
        assert.equal(state.paid_at.toISOString(), paidAtIso);
        assert.equal(state.public_display_consent, false);
        assert.equal(state.display_amount_consent, false);
        assert.equal(state.non_charity_acknowledged, false);
        assert.equal(state.public_name, 'Local fixture');
        assert.equal(state.email_private, 'local@example.invalid');
        assert.equal(state.public_reference, fixture.publicReference);
        assert.equal(
          state.sponsorship_followup_token_hash,
          'synthetic-local-token-hash'
        );
        assert.equal(state.activity_count, 1);
        assert.equal(state.sponsor_review_status, null);
        assert.equal(state.sponsor_feed_status, 'not_planned');
        const session = await db.pool.query(
          'SELECT metadata FROM stripe_checkout_sessions WHERE stripe_session_id=$1',
          [fixture.stripeSessionId]
        );
        assert.deepEqual(session.rows[0].metadata, {
          project: 'openg7',
          publicReference: fixture.publicReference,
          publicDisplayConsent: 'true'
        });
      }
    );

    await t.test(
      'a PaymentIntent confirmed before Checkout wins over delayed expiry and records activity once',
      async () => {
        const fixture = checkout('proof_first');
        assert.equal(
          await updateContributionStatusByPaymentIntent(
            db.pool,
            payment(fixture)
          ),
          false
        );
        for (let delivery = 0; delivery < 2; delivery++) {
          await upsertCheckoutSessionFromWebhook(
            db.pool,
            webhook(fixture, { status: 'expired', paidAtIso: null })
          );
        }
        const state = await storedState(db.pool, fixture);
        assert.equal(state.status, 'paid');
        assert.equal(state.session_status, 'paid');
        assert.equal(state.paid_at.toISOString(), paidAtIso);
        assert.equal(state.activity_count, 1);
        assert.equal(state.confirmation_count, 1);
      }
    );

    await t.test(
      'Checkout contribution failure rolls back the preceding session insert and permits a retry',
      async () => {
        const fixture = checkout('insert_rollback');
        const injected = failingPool(db.pool, 'INSERT INTO fund_contributions');
        await assert.rejects(
          insertCheckoutSessionRecord(injected.pool, fixture),
          (error) => error === injected.failure
        );
        injected.assertRolledBack();
        const counts = await db.pool.query(
          `SELECT
          (SELECT count(*)::int FROM stripe_checkout_sessions WHERE stripe_session_id=$1) AS sessions,
          (SELECT count(*)::int FROM fund_contributions WHERE stripe_session_id=$1) AS contributions`,
          [fixture.stripeSessionId]
        );
        assert.deepEqual(counts.rows[0], { sessions: 0, contributions: 0 });
        assert.equal(await insertCheckoutSessionRecord(db.pool, fixture), true);
        assert.equal(
          await insertCheckoutSessionRecord(db.pool, fixture),
          false
        );
        assert.equal((await storedState(db.pool, fixture)).status, 'pending');
      }
    );

    for (const [name, operation, input] of [
      ['webhook', upsertCheckoutSessionFromWebhook, webhook],
      ['payment', updateContributionStatusByPaymentIntent, payment]
    ]) {
      await t.test(
        `${name} activity failure rolls back statuses, marker and proof, then a retry commits once`,
        async () => {
          const fixture = checkout(`${name}_rollback`);
          await insertCheckoutSessionRecord(db.pool, fixture);
          const injected = failingPool(
            db.pool,
            'INSERT INTO contribution_activity'
          );
          await assert.rejects(
            operation(injected.pool, input(fixture)),
            (error) => error === injected.failure
          );
          injected.assertRolledBack();
          const rolledBack = await storedState(db.pool, fixture);
          assert.equal(rolledBack.status, 'pending');
          assert.equal(rolledBack.session_status, 'pending');
          assert.equal(rolledBack.paid_at, null);
          assert.equal(rolledBack.payment_notification_recorded_at, null);
          assert.equal(rolledBack.activity_count, 0);
          assert.equal(rolledBack.confirmation_count, 0);
          assert.equal(await operation(db.pool, input(fixture)), true);
          await operation(db.pool, input(fixture));
          const retried = await storedState(db.pool, fixture);
          assert.equal(retried.status, 'paid');
          assert.equal(retried.session_status, 'paid');
          assert.equal(retried.activity_count, 1);
          assert.equal(retried.confirmation_count, name === 'payment' ? 1 : 0);
        }
      );
    }
  }
);
