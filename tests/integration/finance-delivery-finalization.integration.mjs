import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import Stripe from 'stripe';
import { createServer } from 'node:net';
import { once } from 'node:events';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { processStripeWebhook } from '../../dist/apps/funding-api/src/stripe-webhook.service.js';
import {
  getAdminEmailQueueMessageById,
  listAdminEmailQueue,
  markEmailSent,
  markEmailFailed
} from '../../dist/apps/funding-api/src/email-queue.repository.js';
import {
  processQueuedEmailMessages,
  retryAdminEmailQueueMessage
} from '../../dist/apps/funding-api/src/services/email/email-queue.service.js';
import { reconcileEmailDelivery } from '../../dist/apps/funding-api/src/email-delivery-reconciliation.repository.js';

const signer = new Stripe('sk_test_synthetic_finalization', {
  host: '127.0.0.1',
  port: 1,
  protocol: 'http',
  maxNetworkRetries: 0
});
const secret = 'whsec_synthetic_finalization';
const origin = 'https://funding.example.test';
const fixture = () => {
  const suffix = randomUUID().replaceAll('-', '');
  const token = suffix + 'T'.repeat(16);
  const metadata = {
    project: 'synthetic-custom',
    projectId: 'synthetic-custom',
    contributionType: 'sponsorship_interest',
    publicReference: 'OG7-2026-' + suffix.slice(0, 6).toUpperCase(),
    nonCharityAcknowledged: 'true',
    publicDisplayConsent: 'false',
    sponsorshipFollowupTokenHash: createHash('sha256')
      .update(token)
      .digest('hex')
  };
  const intent = {
    id: 'pi_' + suffix,
    object: 'payment_intent',
    metadata,
    created: 1780000000,
    status: 'succeeded',
    amount: 10000,
    amount_received: 10000,
    currency: 'cad',
    latest_charge: null
  };
  const session = {
    id: 'cs_' + suffix,
    object: 'checkout.session',
    metadata,
    created: 1780000000,
    payment_status: 'unpaid',
    payment_intent: intent.id,
    amount_total: 10000,
    currency: 'cad',
    success_url: origin + '/success?followup_token=' + token,
    customer_details: { email: 'synthetic-sponsor@example.test' }
  };
  const stripe = {
    webhooks: signer.webhooks,
    checkout: {
      sessions: {
        async retrieve(id) {
          assert.equal(id, session.id);
          return structuredClone(session);
        }
      }
    }
  };
  return { intent, session, stripe };
};
async function deliver(pool, f, type, object, id = 'evt_' + randomUUID()) {
  const payload = JSON.stringify({
    id,
    object: 'event',
    type,
    created: 1780000000,
    livemode: false,
    data: { object }
  });
  return processStripeWebhook(
    payload,
    signer.webhooks.generateTestHeaderString({ payload, secret }),
    {
      stripe: f.stripe,
      webhookSecret: secret,
      pool,
      projectId: 'synthetic-custom',
      publicBaseUrl: origin
    }
  );
}
async function finalized(pool, f) {
  const contribution = (
    await pool.query(
      `SELECT status,public_display_consent,sponsor_review_status,
    stripe_payment_intent_id FROM fund_contributions WHERE stripe_session_id=$1`,
      [f.session.id]
    )
  ).rows[0];
  assert.equal(contribution.status, 'paid');
  assert.equal(contribution.public_display_consent, false);
  assert.notEqual(contribution.sponsor_review_status, 'approved');
  assert.equal(contribution.stripe_payment_intent_id, f.intent.id);
  assert.equal(
    (
      await pool.query(
        'SELECT id FROM sponsorship_invoices WHERE stripe_session_id=$1',
        [f.session.id]
      )
    ).rowCount,
    1
  );
  const emails = await pool.query(
    'SELECT template_key,status FROM email_messages WHERE idempotency_key LIKE $1 ORDER BY template_key',
    [`stripe-session:${f.session.id}:%`]
  );
  assert.deepEqual(emails.rows, [
    { template_key: 'sponsorship_followup', status: 'queued' },
    { template_key: 'sponsorship_invoice', status: 'queued' }
  ]);
}

test(
  'deferred Stripe confirmations finalize once across order, replay, concurrency and recovery',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    await t.test(
      'completed unpaid followed by intent success; paid session is retrieved privately',
      async () => {
        const f = fixture();
        assert.equal(
          (await deliver(db.pool, f, 'checkout.session.completed', f.session))
            .statusCode,
          200
        );
        assert.equal(
          (
            await db.pool.query(
              'SELECT id FROM sponsorship_invoices WHERE stripe_session_id=$1',
              [f.session.id]
            )
          ).rowCount,
          0
        );
        f.session.payment_status = 'paid';
        assert.equal(
          (await deliver(db.pool, f, 'payment_intent.succeeded', f.intent))
            .statusCode,
          200
        );
        await finalized(db.pool, f);
        const replay = 'evt_' + randomUUID();
        await Promise.all([
          deliver(
            db.pool,
            f,
            'checkout.session.async_payment_succeeded',
            f.session,
            replay
          ),
          deliver(db.pool, f, 'payment_intent.succeeded', f.intent),
          deliver(db.pool, f, 'checkout.session.completed', {
            ...f.session,
            payment_status: 'unpaid'
          })
        ]);
        assert.equal(
          (
            await deliver(
              db.pool,
              f,
              'checkout.session.async_payment_succeeded',
              f.session,
              replay
            )
          ).payload.duplicate,
          true
        );
        await finalized(db.pool, f);
        assert.equal(
          (
            await db.pool.query(
              'SELECT id FROM fund_transactions WHERE stripe_object_id=$1',
              [f.intent.id]
            )
          ).rowCount,
          1
        );
        await deliver(db.pool, f, 'checkout.session.async_payment_failed', {
          ...f.session,
          payment_status: 'unpaid'
        });
        await finalized(db.pool, f);
      }
    );
    await t.test(
      'intent success arrives before completed unpaid; stored proof still finalizes',
      async () => {
        const f = fixture();
        assert.equal(
          (await deliver(db.pool, f, 'payment_intent.succeeded', f.intent))
            .statusCode,
          200
        );
        assert.equal(
          (await deliver(db.pool, f, 'checkout.session.completed', f.session))
            .statusCode,
          200
        );
        await finalized(db.pool, f);
      }
    );
    await t.test(
      'async Checkout success before completed also finalizes without a browser confirmation',
      async () => {
        const f = fixture();
        f.session.payment_status = 'paid';
        assert.equal(
          (
            await deliver(
              db.pool,
              f,
              'checkout.session.async_payment_succeeded',
              f.session
            )
          ).statusCode,
          200
        );
        await deliver(db.pool, f, 'checkout.session.completed', {
          ...f.session,
          payment_status: 'unpaid'
        });
        await finalized(db.pool, f);
      }
    );
    await t.test(
      'async failure creates no document; a later authoritative success recovers',
      async () => {
        const f = fixture();
        await deliver(
          db.pool,
          f,
          'checkout.session.async_payment_failed',
          f.session
        );
        assert.equal(
          (
            await db.pool.query(
              'SELECT status FROM fund_contributions WHERE stripe_session_id=$1',
              [f.session.id]
            )
          ).rows[0].status,
          'failed'
        );
        assert.equal(
          (
            await db.pool.query(
              'SELECT id FROM sponsorship_invoices WHERE stripe_session_id=$1',
              [f.session.id]
            )
          ).rowCount,
          0
        );
        f.session.payment_status = 'paid';
        await deliver(
          db.pool,
          f,
          'checkout.session.async_payment_succeeded',
          f.session
        );
        await finalized(db.pool, f);
      }
    );
    await t.test(
      'failed provider lookup remains replayable and preserves one ledger transaction',
      async () => {
        const f = fixture();
        await deliver(db.pool, f, 'checkout.session.completed', f.session);
        const retrieve = f.stripe.checkout.sessions.retrieve;
        f.stripe.checkout.sessions.retrieve = async () => {
          throw new Error('Synthetic provider outage');
        };
        const id = 'evt_' + randomUUID();
        assert.equal(
          (await deliver(db.pool, f, 'payment_intent.succeeded', f.intent, id))
            .statusCode,
          500
        );
        f.stripe.checkout.sessions.retrieve = retrieve;
        f.session.payment_status = 'paid';
        assert.equal(
          (await deliver(db.pool, f, 'payment_intent.succeeded', f.intent, id))
            .statusCode,
          200
        );
        await finalized(db.pool, f);
        assert.equal(
          (
            await db.pool.query(
              'SELECT id FROM fund_transactions WHERE stripe_object_id=$1',
              [f.intent.id]
            )
          ).rowCount,
          1
        );
      }
    );
    await t.test('conflicting project metadata remains rejected', async () => {
      const f = fixture();
      f.session.metadata = { ...f.session.metadata, project: 'openg7' };
      const response = await deliver(
        db.pool,
        f,
        'checkout.session.completed',
        f.session
      );
      assert.equal(response.payload.reason, 'PROJECT_MISMATCH');
      assert.equal(
        (
          await db.pool.query(
            'SELECT id FROM fund_contributions WHERE stripe_session_id=$1',
            [f.session.id]
          )
        ).rowCount,
        0
      );
    });
  }
);

const smtpEnv = {
  SMTP_ENABLED: 'true',
  SMTP_HOST: 'synthetic.example.test',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'sender@example.test',
  SMTP_PASSWORD: 'synthetic-only',
  MAIL_FROM_ADDRESS: 'sender@example.test'
};
const dependencies = (sendMail) => ({
  env: smtpEnv,
  logger: { info() {}, error() {} },
  createTransport: () => ({
    async verify() {
      assert.fail('No verification/network');
    },
    sendMail
  })
});
async function insertMessage(pool, status = 'queued') {
  return (
    await pool.query(
      `INSERT INTO email_messages(template_key,recipient_email,from_email,subject,text_body,html_body,status)
    VALUES('sponsorship_followup','recipient@example.test','sender@example.test','Synthetic','Synthetic','<p>Synthetic</p>',$1) RETURNING id`,
      [status]
    )
  ).rows[0].id;
}
const reconciliation = (message, outcome) => ({
  messageId: message.id,
  expectedUpdatedAt: message.updated_at,
  confirmation: message.id,
  outcome,
  evidenceReference: 'synthetic-provider-case:123'
});

test(
  'uncertain SMTP results require audited reconciliation and never automatically resend',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    let accepted = 0;
    const id = await insertMessage(db.pool);
    const options = {
      messageIds: [id],
      emailDependencies: dependencies(async (message) => {
        accepted++;
        assert.equal(message.messageId, `<openg7-email-${id}@openg7.invalid>`);
        throw Object.assign(new Error('Synthetic lost final acknowledgement'), {
          code: 'ETIMEDOUT',
          command: 'DATA'
        });
      })
    };
    await processQueuedEmailMessages(db.pool, options);
    const unknown = await getAdminEmailQueueMessageById(db.pool, id);
    assert.equal(unknown.status, 'uncertain');
    assert.equal(unknown.last_error, 'EMAIL_DELIVERY_UNCERTAIN');
    assert.equal(
      (await processQueuedEmailMessages(db.pool, options)).attempted,
      0
    );
    assert.equal((await retryAdminEmailQueueMessage(db.pool, id)).attempted, 0);
    assert.equal(accepted, 1);
    assert.equal(
      (await listAdminEmailQueue(db.pool)).summary.uncertain_count,
      1
    );
    const confirmations = await Promise.all(
      [1, 2].map(() =>
        reconcileEmailDelivery(
          db.pool,
          reconciliation(unknown, 'sent'),
          'synthetic-operator'
        )
      )
    );
    assert.equal(confirmations.filter(Boolean).length, 1);
    assert.equal(
      (await getAdminEmailQueueMessageById(db.pool, id)).status,
      'sent'
    );
    assert.equal(
      await reconcileEmailDelivery(
        db.pool,
        reconciliation(unknown, 'not_sent'),
        'synthetic-operator'
      ),
      false
    );
    assert.equal(
      (await processQueuedEmailMessages(db.pool, options)).attempted,
      0
    );
    assert.equal(accepted, 1);
    assert.equal(
      (
        await db.pool.query(
          "SELECT id FROM admin_audit_log WHERE action='email_queue.reconcile' AND entity_id=$1",
          [id]
        )
      ).rowCount,
      1
    );

    const notSent = await insertMessage(db.pool, 'uncertain');
    const other = await getAdminEmailQueueMessageById(db.pool, notSent);
    await db.pool
      .query(`CREATE FUNCTION fail_synthetic_reconciliation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.actor='synthetic-audit-failure' THEN RAISE EXCEPTION 'synthetic failure'; END IF;
      IF NEW.actor='synthetic-audit-skipped' THEN RETURN NULL; END IF; RETURN NEW; END $$;
    CREATE TRIGGER synthetic_reconciliation_audit BEFORE INSERT ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION fail_synthetic_reconciliation_audit()`);
    await assert.rejects(
      reconcileEmailDelivery(
        db.pool,
        reconciliation(other, 'not_sent'),
        'synthetic-audit-failure'
      )
    );
    await assert.rejects(
      reconcileEmailDelivery(
        db.pool,
        reconciliation(other, 'not_sent'),
        'synthetic-audit-skipped'
      ),
      /EMAIL_RECONCILIATION_AUDIT_REQUIRED/
    );
    assert.equal(
      (await getAdminEmailQueueMessageById(db.pool, notSent)).status,
      'uncertain'
    );
    assert.equal(
      await reconcileEmailDelivery(
        db.pool,
        reconciliation(other, 'not_sent'),
        'synthetic-operator'
      ),
      true
    );
    const reconciled = await getAdminEmailQueueMessageById(db.pool, notSent);
    assert.equal(reconciled.status, 'failed');
    assert.equal(reconciled.attempts, reconciled.max_attempts);
    assert.equal(
      (
        await processQueuedEmailMessages(db.pool, {
          ...options,
          messageIds: [notSent]
        })
      ).attempted,
      0
    );
    const resumed = await retryAdminEmailQueueMessage(
      db.pool,
      notSent,
      dependencies(async (message) => ({ accepted: message.to, rejected: [] }))
    );
    assert.equal(resumed.sent, 1);
    assert.equal(
      (await getAdminEmailQueueMessageById(db.pool, notSent)).status,
      'sent'
    );
  }
);

test(
  'expired SMTP leases are quarantined and stale attempts cannot settle a reconciled message',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const id = await insertMessage(db.pool, 'sending');
    const oldAttempt = randomUUID();
    await db.pool.query(
      "UPDATE email_messages SET delivery_attempt_id=$2,attempts=1,updated_at=NOW()-INTERVAL '16 minutes' WHERE id=$1",
      [id, oldAttempt]
    );
    let sends = 0;
    const options = {
      messageIds: [id],
      emailDependencies: dependencies(async () => {
        sends++;
        assert.fail('Expired send cannot be replayed');
      })
    };
    await Promise.all([
      processQueuedEmailMessages(db.pool, options),
      processQueuedEmailMessages(db.pool, options)
    ]);
    const unknown = await getAdminEmailQueueMessageById(db.pool, id);
    assert.equal(unknown.status, 'uncertain');
    assert.equal(unknown.attempts, 1);
    assert.equal(sends, 0);
    assert.equal(await markEmailSent(db.pool, id, oldAttempt), false);
    assert.equal(
      await reconcileEmailDelivery(
        db.pool,
        reconciliation(unknown, 'not_sent'),
        'synthetic-operator'
      ),
      true
    );
    const { claimAdminEmailQueueRetry } =
      await import('../../dist/apps/funding-api/src/email-queue.repository.js');
    const fresh = (await claimAdminEmailQueueRetry(db.pool, id))[0];
    assert.notEqual(fresh.deliveryAttemptId, oldAttempt);
    assert.equal(
      await markEmailFailed(
        db.pool,
        id,
        new Date(),
        'EMAIL_CONNECTION_ERROR',
        oldAttempt
      ),
      false
    );
    assert.equal(await markEmailSent(db.pool, id, oldAttempt), false);
    assert.equal(
      (await getAdminEmailQueueMessageById(db.pool, id)).status,
      'sending'
    );
    assert.equal(
      await markEmailSent(db.pool, id, fresh.deliveryAttemptId),
      true
    );
  }
);

test(
  'migration 033 preserves existing delivery records on a schema-032 database',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres({ migrate: false });
    t.after(db.stop);
    const directory = new URL(
      '../../apps/funding-api/migrations/',
      import.meta.url
    );
    for (const file of (await readdir(directory))
      .filter(
        (name) => /^\d{3}_.+\.sql$/.test(name) && Number(name.slice(0, 3)) <= 32
      )
      .sort())
      await db.pool.query(await readFile(new URL(file, directory), 'utf8'));
    for (const status of ['queued', 'sending', 'sent', 'failed'])
      await insertMessage(db.pool, status);
    const before = (
      await db.pool.query('SELECT * FROM email_messages ORDER BY id')
    ).rows;
    await db.pool.query(
      await readFile(
        new URL('033_add_email_delivery_uncertainty.sql', directory),
        'utf8'
      )
    );
    const after = (
      await db.pool.query('SELECT * FROM email_messages ORDER BY id')
    ).rows;
    assert.deepEqual(
      after,
      before.map((row) => ({ ...row, delivery_attempt_id: null }))
    );
    await insertMessage(db.pool, 'uncertain');
    await assert.rejects(
      insertMessage(db.pool, 'invalid'),
      (error) => error.code === '23514'
    );
  }
);

test(
  'real Nodemailer quarantines a lost final acknowledgement from a loopback SMTP simulator',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    let accepted = 0;
    const sockets = new Set();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {});
      socket.write('220 synthetic.example.test ESMTP\r\n');
      let pending = '',
        data = false;
      socket.on('data', (chunk) => {
        pending += chunk.toString('utf8');
        while (true) {
          if (data) {
            if (!pending.includes('\r\n.\r\n')) return;
            accepted++;
            pending = '';
            socket.end();
            return; // Received once; deliberately lose the final 250.
          }
          const end = pending.indexOf('\r\n');
          if (end < 0) return;
          const line = pending.slice(0, end);
          pending = pending.slice(end + 2);
          if (/^EHLO|^HELO/.test(line))
            socket.write('250-synthetic.example.test\r\n250 AUTH PLAIN\r\n');
          else if (/^AUTH/.test(line))
            socket.write('235 2.7.0 Authentication accepted\r\n');
          else if (/^MAIL FROM|^RCPT TO/.test(line))
            socket.write('250 2.1.0 OK\r\n');
          else if (line === 'DATA') {
            data = true;
            socket.write('354 End with dot\r\n');
          } else if (line === 'QUIT') {
            socket.end('221 Bye\r\n');
            return;
          } else socket.write('250 OK\r\n');
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(
      () =>
        new Promise((resolve) => {
          for (const socket of sockets) socket.destroy();
          server.close(resolve);
        })
    );
    const id = await insertMessage(db.pool);
    const options = {
      messageIds: [id],
      emailDependencies: {
        env: {
          ...smtpEnv,
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: String(server.address().port),
          SMTP_SECURE: 'false'
        },
        logger: { info() {}, error() {} }
      }
    };
    await processQueuedEmailMessages(db.pool, options);
    assert.equal(
      (await getAdminEmailQueueMessageById(db.pool, id)).status,
      'uncertain'
    );
    assert.equal(accepted, 1);
    assert.equal(
      (await processQueuedEmailMessages(db.pool, options)).attempted,
      0
    );
    assert.equal(
      (
        await retryAdminEmailQueueMessage(
          db.pool,
          id,
          options.emailDependencies
        )
      ).attempted,
      0
    );
    assert.equal(accepted, 1);
  }
);
