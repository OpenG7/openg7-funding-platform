import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import {
  processQueuedEmailMessages,
  retryAdminEmailQueueMessage
} from '../../dist/apps/funding-api/src/email-notification.service.js';
import { createSmtpGate } from '../stripe-stub/smtp-gate.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { startDisposableProvider } from './support/disposable-provider.mjs';

const eventually = async (check) => {
  const deadline = Date.now() + 15000;
  while (true) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await setTimeout(50);
    }
  }
};

test(
  'failed SMTP recovery claims atomically against two admins and the worker, without resending accepted messages',
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
    const env = {
      SMTP_ENABLED: 'true',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(gate.server.address().port),
      SMTP_SECURE: 'false',
      SMTP_USER: 'sender@example.test',
      SMTP_PASSWORD: 'synthetic-fixture',
      MAIL_FROM_ADDRESS: 'sender@example.test'
    };
    const previous = Object.fromEntries(
      Object.keys(env).map((k) => [k, process.env[k]])
    );
    Object.assign(process.env, env);
    t.after(() => {
      for (const [key, value] of Object.entries(previous))
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    });
    const mailUrl = `http://127.0.0.1:${mail.ports[8025]}`;
    await eventually(async () =>
      assert.equal((await fetch(mailUrl + '/api/v1/messages')).status, 200)
    );
    const {
      rows: [message]
    } = await db.pool.query(`INSERT INTO email_messages
    (template_key, recipient_email, from_email, subject, text_body, html_body)
    VALUES ('sponsorship_access_recovery','recipient@example.test','sender@example.test',
      'Synthetic recovery', 'Private synthetic access', '<p>Private synthetic access</p>') RETURNING id`);
    const snapshot = async () =>
      (
        await db.pool.query(
          'SELECT status, attempts, next_attempt_at, last_error FROM email_messages WHERE id=$1',
          [message.id]
        )
      ).rows[0];
    gate.setMode('reject');
    assert.equal((await processQueuedEmailMessages(db.pool)).failed, 1);
    const failed = await snapshot();
    assert.equal(failed.status, 'failed');
    assert.equal(failed.attempts, 1);
    assert.ok(failed.next_attempt_at.getTime() > Date.now());
    assert.match(failed.last_error, /^EMAIL_/);
    assert.equal((await processQueuedEmailMessages(db.pool)).attempted, 0);

    // Hold before the SMTP greeting: the first claimant is in flight while both
    // kinds of competing consumer run. The provider has received no MIME yet.
    gate.setMode('hold');
    const sending = retryAdminEmailQueueMessage(db.pool, message.id);
    try {
      await eventually(() => assert.equal(gate.snapshot().held, 1));
      const competitors = await Promise.all([
        retryAdminEmailQueueMessage(db.pool, message.id),
        retryAdminEmailQueueMessage(db.pool, message.id),
        processQueuedEmailMessages(db.pool)
      ]);
      assert.ok(competitors.every((result) => result.attempted === 0));
      assert.equal((await snapshot()).attempts, 2);
      assert.equal(gate.snapshot().connections, 2);
    } finally {
      gate.setMode('allow');
    }
    assert.equal((await sending).sent, 1);
    assert.equal((await snapshot()).status, 'sent');
    assert.equal(
      (await retryAdminEmailQueueMessage(db.pool, message.id)).attempted,
      0
    );
    assert.equal((await processQueuedEmailMessages(db.pool)).attempted, 0);
    const received = await (await fetch(mailUrl + '/api/v1/messages')).json();
    assert.equal(received.messages.length, 1);
    const payload = await (
      await fetch(mailUrl + '/api/v1/message/' + received.messages[0].ID)
    ).json();
    assert.match(payload.Text, /Private synthetic access/);

    // Preserve the existing explicit retry of exhausted failures and recovery of
    // stale claims. These fixture-only SQL transitions model persisted incidents.
    await db.pool.query(
      `UPDATE email_messages SET status='failed', attempts=max_attempts WHERE id=$1`,
      [message.id]
    );
    gate.setMode('reject');
    assert.equal(
      (await retryAdminEmailQueueMessage(db.pool, message.id)).failed,
      1
    );
    assert.equal((await snapshot()).attempts, 5);
    await db.pool.query(
      `UPDATE email_messages SET status='sending', attempts=1,
    updated_at=NOW()-INTERVAL '16 minutes' WHERE id=$1`,
      [message.id]
    );
    assert.equal(
      (await retryAdminEmailQueueMessage(db.pool, message.id)).failed,
      1
    );
    assert.equal((await snapshot()).attempts, 2);
    assert.equal((await processQueuedEmailMessages(db.pool)).attempted, 0);
    assert.equal(
      (await (await fetch(mailUrl + '/api/v1/messages')).json()).messages
        .length,
      1
    );
  }
);
