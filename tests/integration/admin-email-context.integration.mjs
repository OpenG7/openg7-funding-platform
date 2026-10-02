import assert from 'node:assert/strict';
import test from 'node:test';

import { queueDueSponsorshipReviewReminder } from '../../dist/apps/funding-api/src/admin-reminder.service.js';
import {
  processQueuedEmailMessages,
  queuePublicationBatchFullNotification
} from '../../dist/apps/funding-api/src/email-notification.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const createEnv = (name, overrides = {}) => ({
  SMTP_ENABLED: 'true',
  SMTP_HOST: `${name}.example.test`,
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: `${name}@example.test`,
  SMTP_PASSWORD: `synthetic-${name}-password`,
  SMTP_CONNECTION_TIMEOUT_MS: '11000',
  SMTP_GREETING_TIMEOUT_MS: '12000',
  SMTP_SOCKET_TIMEOUT_MS: '21000',
  MAIL_FROM_NAME: 'Synthetic OpenG7',
  MAIL_FROM_ADDRESS: `${name}@example.test`,
  MAIL_REPLY_TO_NAME: 'Synthetic support',
  MAIL_REPLY_TO_ADDRESS: `support-${name}@example.test`,
  FUNDING_ADMIN_NOTIFICATION_EMAIL: `admin-${name}@example.test`,
  ...overrides
});

const createDelivery = (failure) => {
  const transports = [];
  const messages = [];
  const logs = [];
  return {
    transports,
    messages,
    logs,
    dependencies: {
      logger: {
        info: (...args) => logs.push(args),
        error: (...args) => logs.push(args)
      },
      createTransport(options) {
        transports.push(options);
        return {
          async verify() {},
          async sendMail(message) {
            messages.push(message);
            if (failure) throw failure;
            return {
              messageId: 'synthetic-message',
              accepted: message.to,
              rejected: []
            };
          }
        };
      }
    }
  };
};

const readMessage = async (pool, id) =>
  (await pool.query('SELECT * FROM email_messages WHERE id = $1', [id]))
    .rows[0];

test(
  'admin notifications retain one configuration from eligibility through queued delivery',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const previous = {
      SMTP_ENABLED: process.env.SMTP_ENABLED,
      FUNDING_ADMIN_NOTIFICATION_EMAIL:
        process.env.FUNDING_ADMIN_NOTIFICATION_EMAIL
    };
    process.env.SMTP_ENABLED = 'false';
    process.env.FUNDING_ADMIN_NOTIFICATION_EMAIL = 'global-admin@example.test';
    t.after(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    const {
      rows: [sponsorship]
    } = await db.pool.query(`
    INSERT INTO fund_contributions
      (contribution_type, amount_cents, status, paid_at, public_reference,
       sponsor_company_name, sponsor_contact_email, sponsor_details_submitted_at)
    VALUES ('sponsorship_interest', 10000, 'paid', '2029-01-01',
      'SP-SYNTHETIC-REMINDER', 'Private synthetic company',
      'private-sponsor@example.test', '2029-01-01') RETURNING id
  `);
    await db.pool.query(
      `
    INSERT INTO sponsor_media_assets
      (contribution_id, kind, original_filename, original_mime_type,
       original_size_bytes, original_storage_key, processed_size_bytes,
       processed_storage_key, checksum_sha256, width, height)
    VALUES ($1, 'supporting_image', 'fixture.png', 'image/png', 1,
      'synthetic/original', 1, 'synthetic/processed', $2, 1, 1)
  `,
      [sponsorship.id, 'a'.repeat(64)]
    );
    const originalSponsorship = (
      await db.pool.query('SELECT * FROM fund_contributions WHERE id = $1', [
        sponsorship.id
      ])
    ).rows[0];

    await t.test(
      'an injected environment survives mutation while database reads are pending',
      async () => {
        const env = createEnv('reminder');
        const originalEnv = { ...env };
        const delivery = createDelivery();
        const entered = Promise.withResolvers();
        const release = Promise.withResolvers();
        let paused = false;
        const pool = {
          async query(sql, params) {
            if (!paused) {
              paused = true;
              entered.resolve();
              await release.promise;
            }
            return db.pool.query(sql, params);
          }
        };
        const pending = queueDueSponsorshipReviewReminder(pool, {
          now: new Date('2030-01-01'),
          env,
          emailDependencies: delivery.dependencies
        });
        await entered.promise;
        Object.assign(env, createEnv('changed', { SMTP_ENABLED: 'false' }));
        release.resolve();
        const result = await pending;
        assert.equal(result.dueCount, 1);
        assert.equal(result.sent, true);
        assert.equal(result.attempted, true);
        const row = await readMessage(db.pool, result.messageId);
        assert.equal(
          row.recipient_email,
          originalEnv.FUNDING_ADMIN_NOTIFICATION_EMAIL
        );
        assert.equal(
          row.from_email,
          '"Synthetic OpenG7" <reminder@example.test>'
        );
        assert.equal(row.reply_to_email, 'support-reminder@example.test');
        assert.equal(row.status, 'sent');
        assert.equal(row.attempts, 1);
        assert.deepEqual(delivery.messages[0].to, [row.recipient_email]);
        assert.equal(delivery.messages[0].from, row.from_email);
        assert.equal(
          delivery.messages[0].replyTo,
          '"Synthetic support" <support-reminder@example.test>'
        );
        assert.deepEqual(delivery.transports[0], {
          host: originalEnv.SMTP_HOST,
          port: 465,
          secure: true,
          auth: {
            user: originalEnv.SMTP_USER,
            pass: originalEnv.SMTP_PASSWORD
          },
          connectionTimeout: 11000,
          greetingTimeout: 12000,
          socketTimeout: 21000
        });
        const persisted = JSON.stringify(row);
        assert.ok(!persisted.includes(originalEnv.SMTP_PASSWORD));
        assert.ok(!persisted.includes('private-sponsor@example.test'));
        assert.ok(!persisted.includes('Private synthetic company'));
      }
    );

    await t.test(
      'concurrent daily reminders share one row and one SMTP attempt',
      async () => {
        const delivery = createDelivery();
        const options = {
          now: new Date('2030-01-02'),
          env: createEnv('daily'),
          emailDependencies: delivery.dependencies
        };
        const results = await Promise.all([
          queueDueSponsorshipReviewReminder(db.pool, options),
          queueDueSponsorshipReviewReminder(db.pool, options)
        ]);
        assert.equal(results[0].messageId, results[1].messageId);
        assert.equal(results.filter((result) => result.duplicate).length, 1);
        assert.equal(delivery.messages.length, 1);
        const before = await readMessage(db.pool, results[0].messageId);
        const repeated = await queueDueSponsorshipReviewReminder(db.pool, {
          ...options,
          env: createEnv('other-recipient')
        });
        assert.equal(repeated.duplicate, true);
        assert.equal(repeated.sent, true);
        assert.equal(repeated.attempted, false);
        assert.equal(delivery.messages.length, 1);
        assert.deepEqual(
          await readMessage(db.pool, repeated.messageId),
          before
        );
      }
    );

    await t.test(
      'concurrent batch notifications keep independent recipients and SMTP configurations',
      async () => {
        const results = await Promise.all(
          ['first', 'second'].map(async (name) => {
            const delivery = createDelivery();
            const env = createEnv(name);
            const result = await queuePublicationBatchFullNotification(
              db.pool,
              {
                channel: 'facebook',
                capacity: 5,
                idempotencyKey: `synthetic:${name}`
              },
              { ...delivery.dependencies, env }
            );
            assert.equal(result.sent, true);
            const row = await readMessage(db.pool, result.messageId);
            assert.equal(row.template_key, 'publication_batch_full');
            assert.equal(
              row.recipient_email,
              env.FUNDING_ADMIN_NOTIFICATION_EMAIL
            );
            assert.deepEqual(delivery.messages[0].to, [row.recipient_email]);
            assert.equal(delivery.messages[0].from, row.from_email);
            assert.equal(delivery.transports[0].host, env.SMTP_HOST);
            assert.equal(delivery.transports[0].auth.pass, env.SMTP_PASSWORD);
            return result;
          })
        );
        assert.notEqual(results[0].messageId, results[1].messageId);
      }
    );

    await t.test(
      'disabled or unconfigured reminders avoid database and SMTP effects',
      async () => {
        const delivery = createDelivery();
        const pool = {
          query() {
            throw new Error('Unexpected database access.');
          }
        };
        for (const [overrides, reason] of [
          [{ FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'false' }, 'disabled'],
          [{ SMTP_ENABLED: 'false' }, 'smtp_disabled'],
          [
            { FUNDING_ADMIN_NOTIFICATION_EMAIL: ' ' },
            'recipient_not_configured'
          ]
        ]) {
          const result = await queueDueSponsorshipReviewReminder(pool, {
            env: createEnv('skipped', overrides),
            emailDependencies: delivery.dependencies
          });
          assert.equal(result.skippedReason, reason);
          assert.equal(result.queued, false);
          assert.equal(result.attempted, false);
        }
        const missingBatch = await queuePublicationBatchFullNotification(
          pool,
          {
            channel: 'facebook',
            capacity: 5
          },
          {
            ...delivery.dependencies,
            env: createEnv('missing', { FUNDING_ADMIN_NOTIFICATION_EMAIL: '' })
          }
        );
        assert.equal(
          missingBatch.error,
          'Admin notification address is not configured.'
        );
        assert.equal(delivery.transports.length, 0);
      }
    );

    await t.test(
      'failed delivery persists a safe retry and later uses worker configuration',
      async () => {
        const env = createEnv('failure');
        const rawError = `private SMTP failure ${env.SMTP_PASSWORD}`;
        const failure = createDelivery(
          Object.assign(new Error(rawError), { code: 'ECONNECTION' })
        );
        const options = {
          now: new Date('2030-01-03'),
          env,
          emailDependencies: failure.dependencies
        };
        const result = await queueDueSponsorshipReviewReminder(
          db.pool,
          options
        );
        assert.equal(result.sent, false);
        assert.equal(result.attempted, true);
        assert.equal(
          result.error,
          'Email delivery failed and will be retried.'
        );
        const failed = await readMessage(db.pool, result.messageId);
        assert.equal(failed.status, 'failed');
        assert.equal(failed.last_error, 'EMAIL_CONNECTION_ERROR');
        assert.ok(failed.next_attempt_at.getTime() > Date.now());
        assert.ok(!JSON.stringify(failure.logs).includes(rawError));
        assert.ok(!JSON.stringify(failure.logs).includes(env.SMTP_PASSWORD));
        const deferred = await queueDueSponsorshipReviewReminder(
          db.pool,
          options
        );
        assert.equal(deferred.duplicate, true);
        assert.equal(deferred.attempted, false);
        assert.equal(failure.messages.length, 1);
        await db.pool.query(
          'UPDATE email_messages SET next_attempt_at = NOW() WHERE id = $1',
          [result.messageId]
        );
        const recovery = createDelivery();
        const workerEnv = createEnv('worker');
        const retried = await processQueuedEmailMessages(db.pool, {
          messageIds: [result.messageId],
          emailDependencies: { ...recovery.dependencies, env: workerEnv }
        });
        assert.equal(retried.sent, 1);
        assert.equal(recovery.transports[0].host, workerEnv.SMTP_HOST);
        assert.deepEqual(recovery.messages[0].to, [
          env.FUNDING_ADMIN_NOTIFICATION_EMAIL
        ]);
        const recovered = await readMessage(db.pool, result.messageId);
        assert.equal(recovered.status, 'sent');
        assert.equal(recovered.attempts, 2);
        assert.equal(recovered.last_error, null);
        assert.equal(recovered.from_email, failed.from_email);
      }
    );

    await t.test(
      'default admin recipient is read at invocation rather than module import',
      async () => {
        const delivery = createDelivery();
        const result = await queuePublicationBatchFullNotification(
          db.pool,
          {
            channel: 'facebook',
            capacity: 5,
            idempotencyKey: 'synthetic:default-env'
          },
          delivery.dependencies
        );
        assert.equal(result.deliveryMode, 'disabled');
        const row = await readMessage(db.pool, result.messageId);
        assert.equal(row.recipient_email, 'global-admin@example.test');
        assert.equal(delivery.transports.length, 0);
      }
    );

    assert.deepEqual(
      (
        await db.pool.query('SELECT * FROM fund_contributions WHERE id = $1', [
          sponsorship.id
        ])
      ).rows[0],
      originalSponsorship
    );
  }
);
