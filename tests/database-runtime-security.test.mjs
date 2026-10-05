import assert from 'node:assert/strict';
import test from 'node:test';

import { assertProductionDatabasePrivileges } from '../dist/apps/funding-api/src/database-runtime-security.js';

const safe = {
  role_is_safe: true,
  no_role_memberships: true,
  no_ddl: true,
  no_destructive_dml: true,
  immutable_audit: true
};

test('Production refuses an unavailable or privileged database before startup', async () => {
  await assert.rejects(assertProductionDatabasePrivileges(null, true), {
    message: 'DATABASE_RUNTIME_REQUIRED'
  });
  for (const field of Object.keys(safe)) {
    await assert.rejects(
      assertProductionDatabasePrivileges(
        {
          query: async () => ({ rows: [{ ...safe, [field]: false }] })
        },
        true
      ),
      { message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE' },
      field
    );
  }
  await assert.rejects(
    assertProductionDatabasePrivileges(
      { query: async () => ({ rows: [] }) },
      true
    ),
    { message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE' }
  );
});

test('Safety checks fail closed without exposing PostgreSQL diagnostics', async () => {
  await assert.rejects(
    assertProductionDatabasePrivileges(
      {
        query: async () => {
          throw new Error('synthetic private credential');
        }
      },
      true
    ),
    { message: 'DATABASE_RUNTIME_PRIVILEGE_CHECK_FAILED' }
  );
});

test('A restricted production role passes and local fixtures need no elevated-role check', async () => {
  await assertProductionDatabasePrivileges(
    { query: async () => ({ rows: [safe] }) },
    true
  );
  await assertProductionDatabasePrivileges(
    {
      query: async () => {
        throw new Error('Must not query local fixtures');
      }
    },
    false
  );
  await assertProductionDatabasePrivileges(null, false);
});
