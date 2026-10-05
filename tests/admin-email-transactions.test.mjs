import assert from 'node:assert/strict';
import test from 'node:test';
import nodemailer from 'nodemailer';

import { queueAdminDocumentResend } from '../dist/apps/funding-api/src/admin-document-resend.service.js';
import { queueEmailConfigurationTest } from '../dist/apps/funding-api/src/email-notification.service.js';

const requestId = '10000000-0000-4000-8000-00000000000a';
const recipient = 'recipient@example.test';
const actor = 'synthetic-owner';
const document = {
  id: 'synthetic-document',
  invoiceId: 'synthetic-invoice',
  invoiceNumber: 'OG7-SYNTHETIC',
  creditNoteNumber: 'OG7-CN-SYNTHETIC',
  publicReference: 'OG7-TEST',
  stripeSessionId: 'cs_test_document',
  stripePaymentIntentId: null,
  stripeRefundId: 're_test_document',
  issuedAtIso: '2026-09-01T00:00:00.000Z',
  paidAtIso: '2026-09-01T00:00:00.000Z',
  currency: 'CAD',
  subtotalCents: 50000,
  taxCents: 0,
  totalCents: 50000,
  taxLabel: '',
  issuerName: 'OpenG7 test',
  sponsorName: 'Synthetic sponsor',
  lineItems: [],
  notes: null
};

const documentInput = (kind = 'invoice') => ({
  [kind]: document,
  to: recipient,
  requestId
});
const configurationInput = () => ({ to: recipient, requestId, actor });

// In-memory queue/audit snapshots expose orchestration and cleanup failures.
// PostgreSQL locking and constraints have separate disposable integration tests.
const fixture = ({
  failures = {},
  beforeCommit,
  auditAvailable = true
} = {}) => {
  let committed = { messages: [], audits: [] };
  let transaction = null;
  let released = true;
  const calls = [];
  const fail = (phase) => {
    if (Object.hasOwn(failures, phase)) throw failures[phase];
  };
  const outsideTransaction = () => {
    assert.equal(
      transaction,
      null,
      'delivery must follow transaction completion'
    );
    assert.equal(released, true, 'delivery must follow client release');
  };
  const client = {
    async query(command, params = []) {
      const sql = command.replace(/\s+/g, ' ').trim();
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
        calls.push(sql);
        fail(sql);
        if (sql === 'BEGIN') transaction = structuredClone(committed);
        else if (sql === 'COMMIT') {
          await beforeCommit?.();
          committed = transaction;
          transaction = null;
        } else transaction = null;
        return { rows: [] };
      }
      assert.ok(transaction, 'queue and audit must share an open transaction');
      if (sql.includes('pg_advisory_xact_lock')) {
        calls.push('lock');
        assert.deepEqual(params, ['admin-document-resend:' + requestId]);
        return { rows: [] };
      }
      if (sql.startsWith('INSERT INTO email_messages')) {
        calls.push('queue');
        fail('queue');
        if (
          transaction.messages.some((row) => row.idempotency_key === params[0])
        )
          return { rows: [] };
        const row = {
          id: 'synthetic-message',
          idempotency_key: params[0],
          template_key: params[1],
          recipient_email: params[2],
          from_email: params[3],
          reply_to_email: params[4],
          subject: params[5],
          text_body: params[6],
          html_body: params[7],
          metadata: JSON.parse(params[8]),
          max_attempts: params[9],
          status: 'queued',
          attempts: 0,
          last_error: null
        };
        transaction.messages.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (sql.startsWith('SELECT') && sql.includes('FROM email_messages')) {
        calls.push('binding');
        const id = sql.includes('WHERE id=$1') ? 'id' : 'idempotency_key';
        return {
          rows: transaction.messages.filter((row) => row[id] === params[0])
        };
      }
      if (sql.includes('to_regclass')) {
        calls.push('audit-presence');
        return { rows: [{ has_audit_log: auditAvailable }] };
      }
      if (sql.startsWith('INSERT INTO admin_audit_log')) {
        calls.push('audit');
        fail('audit');
        transaction.audits.push(
          sql.includes("'email.test.queued'")
            ? {
                actor: params[0],
                action: 'email.test.queued',
                entityId: params[1],
                metadata: JSON.parse(params[2])
              }
            : {
                actor: params[0],
                action: params[1],
                entityId: params[3],
                metadata: JSON.parse(params[5])
              }
        );
        return { rows: [], rowCount: 1 };
      }
      assert.fail(`Unexpected synthetic transaction query: ${sql}`);
    },
    release() {
      calls.push('release');
      released = true;
      fail('release');
    }
  };
  const pool = {
    async connect() {
      calls.push('connect');
      fail('connect');
      released = false;
      return client;
    },
    async query(command, params) {
      outsideTransaction();
      const sql = command.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('WITH selected AS')) {
        calls.push('claim');
        assert.deepEqual(params, [1, ['synthetic-message']]);
        const rows = committed.messages.filter(
          (row) => row.status === 'queued'
        );
        rows.forEach((row) => {
          row.status = 'sending';
          row.delivery_attempt_id = '00000000-0000-4000-8000-000000000001';
          row.attempts += 1;
        });
        return { rows };
      }
      if (sql.startsWith('UPDATE email_messages')) {
        calls.push('settle');
        assert.match(sql, /status\s*=\s*'sent'/);
        const row = committed.messages.find((row) => row.id === params[0]);
        row.status = 'sent';
        return { rows: [], rowCount: 1 };
      }
      if (
        sql.startsWith('SELECT id,status,recipient_email,attempts,last_error')
      ) {
        calls.push('project');
        return {
          rows: committed.messages.filter(
            (row) =>
              row.idempotency_key === params[0] &&
              row.template_key === 'email_configuration_test' &&
              row.metadata.actor === params[1]
          )
        };
      }
      assert.fail(`Unexpected synthetic pool query: ${sql}`);
    }
  };
  return { pool, calls, state: () => committed, outsideTransaction };
};

const mockTransport = (t, db) => {
  const env = {
    SMTP_ENABLED: 'true',
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'notifications@example.test',
    SMTP_PASSWORD: 'synthetic-password',
    MAIL_FROM_ADDRESS: 'notifications@example.test',
    MAIL_REPLY_TO_ADDRESS: 'contact@example.test'
  };
  for (const [name, value] of Object.entries(env)) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  t.mock.method(console, 'info', () => {});
  const deliveries = [];
  t.mock.method(nodemailer, 'createTransport', () => {
    db.outsideTransaction();
    return {
      async sendMail(message) {
        db.outsideTransaction();
        db.calls.push('send');
        deliveries.push(message);
        return { accepted: message.to, rejected: [] };
      }
    };
  });
  return deliveries;
};

test('invoice and credit-note resends commit one queue entry and audit without starting delivery', async (t) => {
  for (const kind of ['invoice', 'creditNote']) {
    await t.test(kind, async (t) => {
      const db = fixture();
      const deliveries = mockTransport(t, db);
      const input = documentInput(kind);
      const result = await queueAdminDocumentResend(db.pool, input, actor);
      assert.deepEqual(result, {
        queued: true,
        attempted: false,
        sent: false,
        messageId: 'synthetic-message',
        error: null
      });
      const template =
        kind === 'invoice' ? 'sponsorship_invoice' : 'sponsorship_credit_note';
      assert.equal(db.state().messages[0].template_key, template);
      assert.deepEqual(db.state().audits, [
        {
          actor,
          action: template + '.resend',
          entityId: document.id,
          metadata: { messageId: result.messageId, requestId }
        }
      ]);
      assert.deepEqual(db.calls.slice(0, 4), [
        'connect',
        'BEGIN',
        'lock',
        'binding'
      ]);
      assert.deepEqual(db.calls.slice(-2), ['COMMIT', 'release']);
      for (const status of ['queued', 'failed', 'sent']) {
        db.state().messages[0].status = status;
        db.state().messages[0].attempts = 2;
        const before = structuredClone(db.state());
        const repeated = await queueAdminDocumentResend(
          db.pool,
          { ...input, requestId: requestId.toUpperCase() },
          actor
        );
        assert.equal(repeated.messageId, result.messageId);
        assert.equal(repeated.sent, status === 'sent');
        assert.equal(repeated.queued, status !== 'sent');
        assert.deepEqual(db.state(), before);
      }
      assert.deepEqual(deliveries, []);
      assert.equal(db.calls.filter((call) => call === 'queue').length, 1);
      assert.equal(db.calls.filter((call) => call === 'audit').length, 1);
    });
  }
});

test('document request conflicts roll back without changing the recipient, document or template binding', async (t) => {
  const db = fixture();
  const deliveries = mockTransport(t, db);
  const input = documentInput();
  await queueAdminDocumentResend(db.pool, input, actor);
  const before = structuredClone(db.state());
  for (const changed of [
    { ...input, to: 'other@example.test' },
    { ...input, invoice: { ...document, id: 'another-document' } },
    documentInput('creditNote')
  ]) {
    await assert.rejects(queueAdminDocumentResend(db.pool, changed, actor), {
      code: 'REQUEST_CONFLICT'
    });
    assert.deepEqual(db.state(), before);
    assert.deepEqual(db.calls.slice(-2), ['ROLLBACK', 'release']);
  }
  assert.deepEqual(deliveries, []);
});

test('configuration tests claim and send only after successful commit and release, then replay without another attempt', async (t) => {
  let commitStarted;
  let finishCommit;
  const started = new Promise((resolve) => (commitStarted = resolve));
  const permit = new Promise((resolve) => (finishCommit = resolve));
  const db = fixture({
    beforeCommit: async () => {
      commitStarted();
      await permit;
    }
  });
  const deliveries = mockTransport(t, db);
  const input = configurationInput();
  const pending = queueEmailConfigurationTest(db.pool, input);
  await started;
  assert.deepEqual(db.state(), { messages: [], audits: [] });
  assert.deepEqual(deliveries, []);
  assert.equal(db.calls.includes('claim'), false);
  assert.equal(db.calls.includes('release'), false);
  finishCommit();
  assert.deepEqual(await pending, {
    requestId,
    messageId: 'synthetic-message',
    status: 'sent',
    to: recipient,
    queued: false,
    attempted: true,
    sent: true,
    error: null,
    deliveryMode: 'smtp'
  });
  assert.deepEqual(db.calls.slice(-6), [
    'COMMIT',
    'release',
    'claim',
    'send',
    'settle',
    'project'
  ]);
  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0].to, [recipient]);
  assert.deepEqual(db.state().audits, [
    {
      actor,
      action: 'email.test.queued',
      entityId: 'synthetic-message',
      metadata: { requestId, result: 'queued' }
    }
  ]);
  for (const status of ['queued', 'failed', 'sent']) {
    db.state().messages[0].status = status;
    const before = structuredClone(db.state());
    const result = await queueEmailConfigurationTest(db.pool, {
      ...input,
      requestId: requestId.toUpperCase()
    });
    assert.equal(result.status, status);
    assert.equal(result.sent, status === 'sent');
    assert.equal(result.attempted, true);
    assert.deepEqual(db.state(), before);
  }
  assert.equal(db.calls.filter((call) => call === 'claim').length, 1);
  assert.equal(db.calls.filter((call) => call === 'audit').length, 1);
  assert.equal(deliveries.length, 1);
});

test('configuration request conflicts roll back without another audit or delivery', async (t) => {
  const db = fixture();
  const deliveries = mockTransport(t, db);
  const input = configurationInput();
  await queueEmailConfigurationTest(db.pool, input);
  const before = structuredClone(db.state());
  for (const patch of [
    { to: 'other@example.test' },
    { actor: 'another-owner' }
  ]) {
    await assert.rejects(
      queueEmailConfigurationTest(db.pool, { ...input, ...patch }),
      { code: 'EMAIL_TEST_CONFLICT', status: 409 }
    );
    assert.deepEqual(db.state(), before);
    assert.deepEqual(db.calls.slice(-2), ['ROLLBACK', 'release']);
  }
  assert.equal(deliveries.length, 1);
  assert.equal(db.calls.filter((call) => call === 'audit').length, 1);
});

const operations = [
  [
    'document resend',
    (pool) => queueAdminDocumentResend(pool, documentInput(), actor)
  ],
  [
    'configuration test',
    (pool) => queueEmailConfigurationTest(pool, configurationInput())
  ]
];

test('audit failures roll back queue entries and allow the same request to recover', async (t) => {
  for (const [name, operation] of operations) {
    await t.test(name, async (t) => {
      const failure = new Error('Synthetic audit outage');
      const failures = { audit: failure };
      const db = fixture({ failures });
      const deliveries = mockTransport(t, db);
      await assert.rejects(operation(db.pool), (error) => error === failure);
      assert.deepEqual(db.state(), { messages: [], audits: [] });
      assert.deepEqual(db.calls.slice(-2), ['ROLLBACK', 'release']);
      assert.deepEqual(deliveries, []);
      delete failures.audit;
      await operation(db.pool);
      assert.equal(db.state().messages.length, 1);
      assert.equal(db.state().audits.length, 1);
    });
  }
});

test('a document resend rejects missing audit storage and rolls back its queued message', async (t) => {
  const db = fixture({ auditAvailable: false });
  const deliveries = mockTransport(t, db);
  await assert.rejects(
    queueAdminDocumentResend(db.pool, documentInput(), actor),
    { message: 'Document resend audit could not be recorded.' }
  );
  assert.deepEqual(db.state(), { messages: [], audits: [] });
  assert.deepEqual(db.calls.slice(-2), ['ROLLBACK', 'release']);
  assert.deepEqual(deliveries, []);
});

test('connection, begin, enqueue, commit and release failures never start delivery', async (t) => {
  for (const [name, operation] of operations) {
    for (const phase of ['connect', 'BEGIN', 'queue', 'COMMIT', 'release']) {
      await t.test(`${name}: ${phase}`, async (t) => {
        const failure = new Error(`Synthetic ${phase} failure`);
        const db = fixture({ failures: { [phase]: failure } });
        const deliveries = mockTransport(t, db);
        await assert.rejects(operation(db.pool), (error) => error === failure);
        assert.deepEqual(deliveries, []);
        assert.equal(db.calls.includes('claim'), false);
        assert.equal(db.calls.includes('project'), false);
        assert.equal(
          db.calls.filter((call) => call === 'release').length,
          phase === 'connect' ? 0 : 1
        );
        if (phase !== 'connect' && phase !== 'release') {
          assert.deepEqual(db.calls.slice(-2), ['ROLLBACK', 'release']);
          assert.deepEqual(db.state(), { messages: [], audits: [] });
        }
        if (phase === 'release') {
          assert.deepEqual(db.calls.slice(-2), ['COMMIT', 'release']);
          assert.equal(db.state().messages.length, 1);
          assert.equal(db.state().audits.length, 1);
        }
      });
    }
  }
});

test('rollback and release failures retain their established precedence over the original operation failure', async (t) => {
  for (const [name, operation] of operations) {
    for (const phase of ['ROLLBACK', 'release']) {
      await t.test(`${name}: ${phase}`, async (t) => {
        const failure = new Error(`Synthetic ${phase} failure`);
        const db = fixture({
          failures: {
            audit: new Error('Synthetic audit failure'),
            ROLLBACK: new Error('Synthetic rollback failure'),
            [phase]: failure
          }
        });
        const deliveries = mockTransport(t, db);
        await assert.rejects(operation(db.pool), (error) => error === failure);
        assert.deepEqual(db.calls.slice(-2), ['ROLLBACK', 'release']);
        assert.equal(db.calls.filter((call) => call === 'ROLLBACK').length, 1);
        assert.deepEqual(db.state(), { messages: [], audits: [] });
        assert.deepEqual(deliveries, []);
      });
    }
  }
});
