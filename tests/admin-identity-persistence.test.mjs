import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdminIdentityPersistence } from '../dist/apps/funding-api/src/admin-identity/persistence.js';

const issueInput = {
  subject: 'fixture-owner',
  displayName: 'Fixture Owner',
  bootstrapOwner: true,
  tokenHash: 'a'.repeat(64)
};

const fixture = ({
  auditError,
  rollbackError,
  missingAccount = false
} = {}) => {
  const events = [];
  const client = {
    async query(sql) {
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
        events.push(sql);
        if (sql === 'ROLLBACK' && rollbackError) throw rollbackError;
      } else if (sql.includes('INSERT INTO admin_audit_log')) {
        events.push('audit');
        if (auditError) throw auditError;
      } else if (sql.includes('INSERT INTO admin_identity_sessions')) {
        events.push('session');
      }
      return {
        rows:
          missingAccount && sql.startsWith('SELECT * FROM admin_accounts')
            ? []
            : [{ id: 'fixture-id' }],
        rowCount: 1
      };
    },
    release() {
      events.push('release');
    }
  };
  const pool = {
    async connect() {
      return client;
    }
  };
  return {
    events,
    persistence: createAdminIdentityPersistence(
      pool,
      'https://identity.example.test/'
    )
  };
};

test('session issuance commits and releases its connection after the audit succeeds', async () => {
  const { persistence, events } = fixture();
  await persistence.issueSession(issueInput);
  assert.deepEqual(events, ['BEGIN', 'session', 'audit', 'COMMIT', 'release']);
});

test('session issuance rolls back and releases its connection when its audit fails', async () => {
  const auditError = new Error('Synthetic audit failure');
  const { persistence, events } = fixture({ auditError });
  await assert.rejects(persistence.issueSession(issueInput), (error) => {
    assert.equal(error, auditError);
    return true;
  });
  assert.deepEqual(events, [
    'BEGIN',
    'session',
    'audit',
    'ROLLBACK',
    'release'
  ]);
});

test('session issuance releases its connection even when rollback fails', async () => {
  const rollbackError = new Error('Synthetic rollback failure');
  const { persistence, events } = fixture({
    auditError: new Error('Synthetic audit failure'),
    rollbackError
  });
  await assert.rejects(persistence.issueSession(issueInput), (error) => {
    assert.equal(error, rollbackError);
    return true;
  });
  assert.equal(events.at(-1), 'release');
  assert.ok(!events.includes('COMMIT'));
});

test('an unpermitted account never receives a session or a session-created audit', async () => {
  const { persistence, events } = fixture({ missingAccount: true });
  await assert.rejects(persistence.issueSession(issueInput), {
    message: 'Account not permitted'
  });
  assert.deepEqual(events, ['BEGIN', 'ROLLBACK', 'release']);
});

test('a denied sign-in audit stays best effort without opening a transaction', async () => {
  let calls = 0;
  const persistence = createAdminIdentityPersistence(
    {
      async query() {
        calls++;
        throw new Error('Synthetic audit failure');
      },
      async connect() {
        assert.fail('Denied sign-in must not open a transaction');
      }
    },
    'https://identity.example.test/'
  );
  await persistence.auditSignInDenied();
  assert.equal(calls, 1);
});
