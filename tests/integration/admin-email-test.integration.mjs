import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  getEmailConfigurationTest,
  queueEmailConfigurationTest
} from '../../dist/apps/funding-api/src/email-notification.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'configuration tests bind request, recipient and actor atomically with their audit before attempting delivery',
  { timeout: 60000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const previous = process.env.SMTP_ENABLED;
    process.env.SMTP_ENABLED = 'false';
    t.after(() => {
      if (previous === undefined) delete process.env.SMTP_ENABLED;
      else process.env.SMTP_ENABLED = previous;
    });
    const input = {
      requestId: randomUUID(),
      to: 'synthetic@example.test',
      actor: 'owner-fixture'
    };
    const count = async (table) =>
      (await db.pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
    await db.pool
      .query(`CREATE FUNCTION fail_setup_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='email.test.queued' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_setup_test_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION fail_setup_test_audit()`);
    await assert.rejects(queueEmailConfigurationTest(db.pool, input));
    assert.equal(await count('email_messages'), 0);
    assert.equal(await count('admin_audit_log'), 0);
    await db.pool.query(
      'DROP TRIGGER reject_setup_test_audit ON admin_audit_log; DROP FUNCTION fail_setup_test_audit()'
    );

    const first = await queueEmailConfigurationTest(db.pool, input);
    assert.equal(first.status, 'failed');
    assert.equal(first.sent, false);
    const before = (await db.pool.query('SELECT * FROM email_messages')).rows;
    const replay = await queueEmailConfigurationTest(db.pool, {
      ...input,
      requestId: input.requestId.toUpperCase()
    });
    assert.equal(replay.messageId, first.messageId);
    assert.equal(replay.status, first.status);
    assert.deepEqual(
      (await db.pool.query('SELECT * FROM email_messages')).rows,
      before
    );
    for (const patch of [
      { to: 'changed@example.test' },
      { actor: 'another-owner' }
    ]) {
      await assert.rejects(
        queueEmailConfigurationTest(db.pool, { ...input, ...patch }),
        { code: 'EMAIL_TEST_CONFLICT', status: 409 }
      );
    }
    await assert.rejects(
      getEmailConfigurationTest(db.pool, input.requestId, 'another-owner'),
      { code: 'EMAIL_TEST_NOT_FOUND', status: 404 }
    );
    assert.equal(await count('email_messages'), 1);
    assert.equal(await count('admin_audit_log'), 1);
    const audit = (
      await db.pool.query(
        'SELECT actor,entity_id,metadata FROM admin_audit_log'
      )
    ).rows[0];
    assert.equal(audit.actor, input.actor);
    assert.equal(audit.entity_id, first.messageId);
    assert.deepEqual(audit.metadata, {
      requestId: input.requestId,
      result: 'queued'
    });
    assert.ok(!JSON.stringify(audit).includes(input.to));
  }
);
