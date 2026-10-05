import assert from 'node:assert/strict';
import test from 'node:test';

import {
  processQueuedEmailMessages,
  queuePublicationBatchFullNotification,
  retryAdminEmailQueueMessage
} from '../dist/apps/funding-api/src/email-notification.service.js';
import {
  enqueueEmailMessage,
  queueAndProcessEmail
} from '../dist/apps/funding-api/src/services/email/email-queue.service.js';

const enabledEnv = () => ({
  SMTP_ENABLED: 'true',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'notifications@example.test',
  SMTP_PASSWORD: 'synthetic-password',
  MAIL_FROM_NAME: 'OpenG7',
  MAIL_FROM_ADDRESS: 'notifications@example.test',
  MAIL_REPLY_TO_NAME: 'OpenG7',
  MAIL_REPLY_TO_ADDRESS: 'contact@example.test',
  FUNDING_ADMIN_NOTIFICATION_EMAIL: 'admin@example.test'
});

const payload = () => ({
  templateKey: 'publication_batch_full',
  to: 'recipient@example.test',
  subject: 'Synthetic notification',
  text: 'Synthetic text',
  html: '<p>Synthetic text</p>',
  metadata: { batchId: 'synthetic-batch' },
  idempotencyKey: 'synthetic-notification'
});

const claimedRow = (id, overrides = {}) => ({
  id,
  delivery_attempt_id: '00000000-0000-4000-8000-000000000001',
  recipient_email: `${id}@example.test`,
  from_email: 'notifications@example.test',
  reply_to_email: 'contact@example.test',
  subject: 'Stored subject',
  text_body: 'Stored text',
  html_body: '<p>Stored text</p>',
  attempts: 1,
  max_attempts: 5,
  ...overrides
});

// Scripted repository responses exercise orchestration; SQL concurrency is covered
// against PostgreSQL in integration/email-recovery.integration.mjs.
const scriptedPool = (steps) => ({
  async query(sql, params) {
    const step = steps.shift();
    assert.ok(step, 'unexpected repository query');
    assert.match(sql, step.sql);
    step.inspect?.(params);
    if (step.error) throw step.error;
    return { rows: step.rows ?? [], rowCount: step.rowCount ?? 1 };
  },
  assertComplete() {
    assert.equal(steps.length, 0, 'repository operations left unexecuted');
  }
});

const transportDependencies = (
  env = enabledEnv(),
  sendMail,
  inspectTransport
) => ({
  env,
  logger: { info() {}, error() {} },
  createTransport(options) {
    inspectTransport?.(options);
    return {
      async verify() {
        assert.fail('delivery does not verify SMTP separately');
      },
      sendMail:
        sendMail ??
        (async () => assert.fail('this operation must not send an email'))
    };
  }
});

test('an absent database reports no attempt and never falls back to a direct send', async () => {
  const empty = {
    attempted: 0,
    sent: 0,
    failed: 0,
    messageIds: [],
    sentMessageIds: [],
    failedMessageIds: []
  };
  assert.deepEqual(await processQueuedEmailMessages(null), empty);
  assert.deepEqual(
    await retryAdminEmailQueueMessage(null, 'synthetic-id'),
    empty
  );
  const result = await queueAndProcessEmail(
    null,
    payload(),
    false,
    transportDependencies()
  );
  assert.equal(result.attempted, false);
  assert.equal(result.queued, false);
  assert.equal(result.messageId, null);
  assert.equal(result.error, 'Email queue requires DATABASE_URL.');
});

test('enqueue and deferred delivery only persist the rendered message and its configured identities', async () => {
  const input = payload();
  const db = scriptedPool([
    {
      sql: /INSERT INTO email_messages/,
      rows: [{ id: 'synthetic-message' }],
      inspect(params) {
        assert.deepEqual(params.slice(0, 10), [
          input.idempotencyKey,
          input.templateKey,
          input.to,
          'OpenG7 <notifications@example.test>',
          'contact@example.test',
          input.subject,
          input.text,
          input.html,
          JSON.stringify(input.metadata),
          5
        ]);
        assert.match(
          params[10],
          /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
        );
      }
    }
  ]);
  const result = await queueAndProcessEmail(
    db,
    input,
    true,
    transportDependencies()
  );
  assert.deepEqual(result, {
    queued: true,
    duplicate: false,
    messageId: 'synthetic-message',
    attempted: false,
    sent: false,
    error: null,
    deliveryMode: 'smtp'
  });
  db.assertComplete();

  const transaction = scriptedPool([
    {
      sql: /INSERT INTO email_messages/,
      rows: [{ id: 'synthetic-transaction-message' }],
      inspect: (params) => assert.equal(params[9], 2)
    }
  ]);
  await enqueueEmailMessage(
    transaction,
    { ...input, maxAttempts: 2 },
    enabledEnv()
  );
  transaction.assertComplete();
});

test('a sent duplicate returns its existing message without claiming or sending again', async () => {
  const db = scriptedPool([
    { sql: /INSERT INTO email_messages/ },
    {
      sql: /SELECT id, status/,
      rows: [{ id: 'existing-message', status: 'sent' }]
    }
  ]);
  assert.deepEqual(
    await queueAndProcessEmail(db, payload(), false, transportDependencies()),
    {
      queued: false,
      duplicate: true,
      messageId: 'existing-message',
      attempted: false,
      sent: true,
      error: null,
      deliveryMode: 'smtp'
    }
  );
  db.assertComplete();
});

test('an admin notification uses one configuration snapshot from enqueue through delivery', async () => {
  const env = enabledEnv();
  const delivered = [];
  const db = scriptedPool([
    {
      sql: /INSERT INTO email_messages/,
      rows: [{ id: 'synthetic-message' }],
      inspect(params) {
        assert.equal(params[2], 'admin@example.test');
        env.SMTP_ENABLED = 'false';
        env.SMTP_HOST = 'changed.example.test';
        env.MAIL_FROM_ADDRESS = 'changed@example.test';
        env.FUNDING_ADMIN_NOTIFICATION_EMAIL = 'changed-admin@example.test';
      }
    },
    {
      sql: /WITH selected AS/,
      rows: [
        claimedRow('synthetic-message', {
          recipient_email: 'admin@example.test'
        })
      ],
      inspect: (params) => assert.deepEqual(params, [1, ['synthetic-message']])
    },
    { sql: /status\s*=\s*'sent'/ }
  ]);
  const dependencies = transportDependencies(
    env,
    async (message) => {
      delivered.push(message);
      return { accepted: message.to, rejected: [] };
    },
    (options) => assert.equal(options.host, 'smtp.example.test')
  );
  const result = await queuePublicationBatchFullNotification(
    db,
    {
      channel: 'facebook',
      capacity: 5,
      idempotencyKey: 'synthetic-batch-full'
    },
    dependencies
  );
  assert.equal(result.sent, true);
  assert.equal(result.deliveryMode, 'smtp');
  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0].to, ['admin@example.test']);
  assert.equal(delivered[0].from, 'OpenG7 <notifications@example.test>');
  assert.equal(delivered[0].replyTo, 'OpenG7 <contact@example.test>');
  db.assertComplete();
});

test('the worker keeps its configuration snapshot across claim and consecutive messages', async () => {
  const env = enabledEnv();
  const delivered = [];
  const db = scriptedPool([
    {
      sql: /WITH selected AS/,
      rows: [claimedRow('first'), claimedRow('second')],
      inspect() {
        env.SMTP_HOST = 'changed.example.test';
      }
    },
    { sql: /status\s*=\s*'sent'/ },
    { sql: /status\s*=\s*'sent'/ }
  ]);
  const result = await processQueuedEmailMessages(db, {
    emailDependencies: transportDependencies(
      env,
      async (message) => {
        delivered.push(message);
        env.SMTP_ENABLED = 'false';
        env.MAIL_FROM_ADDRESS = 'changed@example.test';
        return { accepted: message.to, rejected: [] };
      },
      (options) => assert.equal(options.host, 'smtp.example.test')
    )
  });
  assert.equal(result.sent, 2);
  assert.equal(delivered.length, 2);
  for (const message of delivered)
    assert.equal(message.from, 'OpenG7 <notifications@example.test>');
  db.assertComplete();
});

test('worker settlements distinguish accepted, rejected and exhausted SMTP failures with safe retry state', async (t) => {
  const now = Date.UTC(2026, 8, 1, 12);
  t.mock.timers.enable({ apis: ['Date'], now });
  const db = scriptedPool([
    {
      sql: /WITH selected AS/,
      rows: [
        claimedRow('accepted'),
        claimedRow('rejected', { attempts: 2 }),
        claimedRow('exhausted', { attempts: 5 })
      ],
      inspect: (params) => assert.deepEqual(params, [10])
    },
    {
      sql: /status\s*=\s*'sent'/,
      inspect: (params) =>
        assert.deepEqual(params, [
          'accepted',
          '00000000-0000-4000-8000-000000000001'
        ])
    },
    {
      sql: /status\s*=\s*'failed'/,
      inspect: (params) =>
        assert.deepEqual(params, [
          'rejected',
          new Date(now + 2 * 60 * 1000).toISOString(),
          'EMAIL_RECIPIENT_REJECTED',
          '00000000-0000-4000-8000-000000000001'
        ])
    },
    {
      sql: /status\s*=\s*'failed'/,
      inspect: (params) =>
        assert.deepEqual(params, [
          'exhausted',
          null,
          'EMAIL_AUTHENTICATION_ERROR',
          '00000000-0000-4000-8000-000000000001'
        ])
    }
  ]);
  const deliveries = [];
  const result = await processQueuedEmailMessages(db, {
    emailDependencies: transportDependencies(enabledEnv(), async (message) => {
      deliveries.push(message);
      if (message.to[0] === 'exhausted@example.test') {
        throw Object.assign(new Error('Synthetic private provider details'), {
          code: 'EAUTH'
        });
      }
      return message.to[0] === 'rejected@example.test'
        ? { accepted: [], rejected: message.to }
        : { accepted: message.to, rejected: [] };
    })
  });
  assert.deepEqual(result, {
    attempted: 3,
    sent: 1,
    failed: 2,
    messageIds: ['accepted', 'rejected', 'exhausted'],
    sentMessageIds: ['accepted'],
    failedMessageIds: ['rejected', 'exhausted']
  });
  assert.equal(deliveries.length, 3);
  assert.equal(deliveries[0].text, 'Stored text');
  db.assertComplete();
});

test('SMTP disabled remains a visible failed attempt without creating a transport', async () => {
  const db = scriptedPool([
    { sql: /WITH selected AS/, rows: [claimedRow('disabled')] },
    {
      sql: /status\s*=\s*'failed'/,
      inspect(params) {
        assert.equal(params[0], 'disabled');
        assert.equal(typeof params[1], 'string');
        assert.equal(new Date(params[1]).toISOString(), params[1]);
        assert.equal(params[2], 'EMAIL_DISABLED');
      }
    }
  ]);
  const dependencies = transportDependencies({
    ...enabledEnv(),
    SMTP_ENABLED: 'false'
  });
  dependencies.createTransport = () => assert.fail('SMTP is disabled');
  const result = await processQueuedEmailMessages(db, {
    emailDependencies: dependencies
  });
  assert.equal(result.failed, 1);
  assert.equal(result.sent, 0);
  db.assertComplete();
});

test('a persistence failure after SMTP acceptance remains an error and stops the batch', async () => {
  const incident = new Error('Synthetic persistence outage');
  let sends = 0;
  const db = scriptedPool([
    {
      sql: /WITH selected AS/,
      rows: [claimedRow('accepted'), claimedRow('next')]
    },
    { sql: /status\s*=\s*'sent'/, error: incident }
  ]);
  await assert.rejects(
    processQueuedEmailMessages(db, {
      emailDependencies: transportDependencies(
        enabledEnv(),
        async (message) => {
          sends += 1;
          return { accepted: message.to, rejected: [] };
        }
      )
    }),
    (error) => error === incident
  );
  assert.equal(sends, 1);
  db.assertComplete();
});
