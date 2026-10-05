import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import pg from 'pg';

import { assertProductionDatabasePrivileges } from '../../dist/apps/funding-api/src/database-runtime-security.js';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'The runtime role can persist application facts but cannot delete finance, alter schema or rewrite audit',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres();
    let runtime;
    t.after(async () => {
      await runtime?.end();
      await database.stop();
    });
    const role = 'og7_runtime_security_test';
    const password = randomBytes(32).toString('hex');
    const name = (
      await database.pool.query('SELECT current_database() AS name')
    ).rows[0].name;
    const config = { role, database: name, password };
    await database.pool.query(buildRuntimeRoleSql(config, { create: true }));
    await database.pool.query(buildRuntimeRoleSql(config)); // Safe, repeatable provisioning.
    runtime = new pg.Pool({ ...database.pool.options, user: role, password });

    await assertProductionDatabasePrivileges(runtime, true);
    await assert.rejects(
      assertProductionDatabasePrivileges(database.pool, true),
      {
        message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
      }
    );
    const privilegedConnection = await database.pool.connect();
    try {
      await privilegedConnection.query(`SET ROLE ${role}`);
      await assert.rejects(
        assertProductionDatabasePrivileges(privilegedConnection, true),
        { message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE' }
      );
    } finally {
      await privilegedConnection.query('RESET ROLE');
      privilegedConnection.release();
    }
    await runtime.query(
      "INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status) VALUES ('individual', 2500, 'cad', 'pending')"
    );
    await runtime.query(
      "UPDATE fund_contributions SET updated_at=now() WHERE status='pending'"
    );
    await runtime.query(
      "INSERT INTO admin_audit_log (actor, action, entity_type, entity_id, metadata) VALUES ('synthetic', 'security_test', 'test', 'synthetic', '{}'::jsonb)"
    );

    for (const sql of [
      'DELETE FROM fund_contributions',
      'TRUNCATE fund_contributions',
      'DROP TABLE fund_contributions',
      'ALTER TABLE fund_contributions ADD COLUMN compromised text',
      'CREATE TABLE security_unapproved_table (id integer)',
      'CREATE TEMP TABLE security_unapproved_temp (id integer)',
      "UPDATE admin_audit_log SET actor='modified'",
      'DELETE FROM admin_audit_log'
    ]) {
      await assert.rejects(runtime.query(sql), { code: '42501' });
    }
    await runtime.query(
      'DELETE FROM admin_login_challenges WHERE expires_at < now()'
    );

    // Effective PUBLIC grants and later privilege drift must also block startup.
    await database.pool.query(`GRANT DELETE ON fund_contributions TO ${role}`);
    await assert.rejects(assertProductionDatabasePrivileges(runtime, true), {
      message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
    });
    await database.pool.query(buildRuntimeRoleSql(config));
    await database.pool.query(`GRANT CREATE ON SCHEMA public TO ${role}`);
    await assert.rejects(assertProductionDatabasePrivileges(runtime, true), {
      message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
    });
    await database.pool.query(buildRuntimeRoleSql(config));
    await assertProductionDatabasePrivileges(runtime, true);

    await database.pool.query(`GRANT TEMP ON DATABASE ${name} TO PUBLIC`);
    await assert.rejects(assertProductionDatabasePrivileges(runtime, true), {
      message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
    });
    await database.pool.query(buildRuntimeRoleSql(config));
    await database.pool.query('CREATE ROLE og7_runtime_elevated NOLOGIN');
    await database.pool.query(`GRANT og7_runtime_elevated TO ${role}`);
    await assert.rejects(assertProductionDatabasePrivileges(runtime, true), {
      message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
    });
    await database.pool.query(`REVOKE og7_runtime_elevated FROM ${role}`);
    await assertProductionDatabasePrivileges(runtime, true);

    // An executable SECURITY DEFINER routine could bypass all table ACLs.
    await database.pool.query(
      "CREATE FUNCTION public.security_test_definer() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'"
    );
    await assert.rejects(assertProductionDatabasePrivileges(runtime, true), {
      message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
    });
    await database.pool.query('DROP FUNCTION public.security_test_definer()');
    await assertProductionDatabasePrivileges(runtime, true);
  }
);
