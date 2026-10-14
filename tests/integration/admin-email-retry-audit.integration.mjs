import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { retryAdminEmailWithAudit } from '../../dist/apps/funding-api/src/admin-email-retry.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { startDisposableProvider } from './support/disposable-provider.mjs';
import { createSmtpGate } from '../stripe-stub/smtp-gate.mjs';

test(
  'email retry commits its intent before SMTP and preserves a replayable outcome through audit and finalization outages',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const mail = await startDisposableProvider('mail');
    t.after(mail.stop);
    const gate = createSmtpGate({ host: '127.0.0.1', port: mail.ports[1025] });
    gate.server.listen(0, '127.0.0.1');
    await once(gate.server, 'listening');
    t.after(() => gate.close());
    const dependencies = {
      env: {
        SMTP_ENABLED: 'true',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(gate.server.address().port),
        SMTP_SECURE: 'false',
        SMTP_USER: 'sender@example.test',
        SMTP_PASSWORD: 'synthetic-fixture',
        MAIL_FROM_ADDRESS: 'sender@example.test'
      }
    };
    const received = async () =>
      (
        await (
          await fetch(`http://127.0.0.1:${mail.ports[8025]}/api/v1/messages`)
        ).json()
      ).messages;
    const create = async () =>
      (
        await db.pool.query(`INSERT INTO email_messages
    (template_key,recipient_email,from_email,subject,text_body,html_body,status,attempts,max_attempts)
    VALUES('synthetic_retry','recipient@example.test','sender@example.test','Synthetic retry',
      'PRIVATE SYNTHETIC BODY','<p>PRIVATE SYNTHETIC BODY</p>','failed',1,1) RETURNING id`)
      ).rows[0].id;
    const state = async (id) =>
      (
        await db.pool.query(
          'SELECT status,attempts,delivery_attempt_id FROM email_messages WHERE id=$1',
          [id]
        )
      ).rows[0];
    const retry = (input, actor = 'synthetic-owner') =>
      retryAdminEmailWithAudit(db.pool, input, actor, dependencies);
    const messageId = await create();
    const input = { messageId, requestId: randomUUID() };
    await db.pool
      .query(`CREATE FUNCTION fail_retry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='email_queue.retry' THEN RAISE EXCEPTION 'synthetic intent failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_retry_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION fail_retry_audit()`);
    await assert.rejects(retry(input));
    assert.equal((await state(messageId)).status, 'failed');
    assert.equal((await state(messageId)).attempts, 1);
    assert.equal(gate.snapshot().connections, 0);
    assert.equal((await received()).length, 0);
    await db.pool
      .query(`CREATE OR REPLACE FUNCTION fail_retry_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='email_queue.retry' THEN RETURN NULL; END IF; RETURN NEW; END $$`);
    await assert.rejects(retry(input), {
      status: 503,
      code: 'EMAIL_RETRY_AUDIT_REQUIRED'
    });
    assert.equal((await state(messageId)).status, 'failed');
    assert.equal((await state(messageId)).attempts, 1);
    assert.equal(gate.snapshot().connections, 0);
    assert.equal((await received()).length, 0);
    await db.pool.query(
      'DROP TRIGGER fail_retry_audit ON admin_audit_log; DROP FUNCTION fail_retry_audit()'
    );

    gate.setMode('hold');
    const first = retry(input);
    const deadline = Date.now() + 10000;
    while (gate.snapshot().held !== 1) {
      if (Date.now() >= deadline)
        throw new Error('Synthetic SMTP claim did not start');
      await setTimeout(25);
    }
    assert.equal((await state(messageId)).status, 'sending');
    assert.equal(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM admin_audit_log WHERE action='email_queue.retry' AND entity_id=$1",
          [messageId]
        )
      ).rows[0].n,
      1
    );
    const concurrent = await retry({
      ...input,
      requestId: input.requestId.toUpperCase()
    });
    assert.equal(concurrent.replayed, true);
    assert.equal(gate.snapshot().connections, 1);
    gate.setMode('allow');
    const completed = await first;
    assert.equal(completed.sent, 1);
    assert.deepEqual(await retry(input), { ...completed, replayed: true });
    assert.equal((await received()).length, 1);
    await assert.rejects(retry(input, 'another-owner'), {
      code: 'EMAIL_RETRY_REQUEST_CONFLICT'
    });
    await assert.rejects(retry({ ...input, messageId: await create() }), {
      code: 'EMAIL_RETRY_REQUEST_CONFLICT'
    });

    await db.pool
      .query(`CREATE FUNCTION fail_retry_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='email_queue.retry.result' THEN RAISE EXCEPTION 'synthetic result failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_retry_result BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION fail_retry_result()`);
    const lostResult = { messageId: await create(), requestId: randomUUID() };
    await assert.rejects(retry(lostResult), {
      code: 'EMAIL_RETRY_RESULT_UNAVAILABLE'
    });
    assert.equal((await state(lostResult.messageId)).status, 'sent');
    assert.equal((await retry(lostResult)).sent, 1);
    assert.equal((await received()).length, 2);
    await db.pool
      .query(`CREATE OR REPLACE FUNCTION fail_retry_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='email_queue.retry.result' THEN RETURN NULL; END IF; RETURN NEW; END $$`);
    const omittedResult = {
      messageId: await create(),
      requestId: randomUUID()
    };
    await assert.rejects(retry(omittedResult), {
      status: 503,
      code: 'EMAIL_RETRY_RESULT_UNAVAILABLE'
    });
    assert.equal((await state(omittedResult.messageId)).status, 'sent');
    assert.equal((await retry(omittedResult)).sent, 1);
    assert.equal((await received()).length, 3);
    await db.pool.query(
      'DROP TRIGGER fail_retry_result ON admin_audit_log; DROP FUNCTION fail_retry_result()'
    );

    await db.pool
      .query(`CREATE FUNCTION fail_retry_finalization() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.status='sent' THEN RAISE EXCEPTION 'synthetic finalization failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_retry_finalization BEFORE UPDATE ON email_messages FOR EACH ROW EXECUTE FUNCTION fail_retry_finalization()`);
    const uncertain = { messageId: await create(), requestId: randomUUID() };
    await assert.rejects(retry(uncertain), {
      code: 'EMAIL_RETRY_RESULT_UNAVAILABLE'
    });
    assert.equal((await state(uncertain.messageId)).status, 'uncertain');
    assert.equal((await retry(uncertain)).replayed, true);
    await assert.rejects(retry({ ...uncertain, requestId: randomUUID() }), {
      code: 'EMAIL_DELIVERY_RECONCILIATION_REQUIRED'
    });
    assert.equal((await received()).length, 4);
    assert.equal(gate.snapshot().connections, 4);
    const audit = JSON.stringify(
      (
        await db.pool.query(
          "SELECT metadata FROM admin_audit_log WHERE action LIKE 'email_queue.retry%'"
        )
      ).rows
    );
    for (const privateValue of [
      'recipient@example.test',
      'PRIVATE SYNTHETIC BODY',
      'synthetic-fixture'
    ])
      assert.equal(audit.includes(privateValue), false);
  }
);
