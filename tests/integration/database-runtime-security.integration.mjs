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

test(
  'Production rejects column grants that allow audit or migration-history writes and references',
  { timeout: 120000 },
  async (t) => {
    const database = await startDisposablePostgres({ migrate: false });
    let runtime;
    t.after(async () => {
      await runtime?.end();
      await database.stop();
    });
    await database.pool.query(`
      CREATE TABLE admin_audit_log(actor text);
      CREATE TABLE openg7_schema_migrations(name text);
      CREATE TABLE fund_contributions(id integer);
      INSERT INTO admin_audit_log VALUES ('synthetic');
      INSERT INTO openg7_schema_migrations VALUES ('synthetic');
    `);
    const role = 'og7_runtime_column_test';
    const password = randomBytes(32).toString('hex');
    const name = (
      await database.pool.query('SELECT current_database() AS name')
    ).rows[0].name;
    const config = { role, database: name, password };
    await database.pool.query(buildRuntimeRoleSql(config, { create: true }));
    runtime = new pg.Pool({ ...database.pool.options, user: role, password });
    await assertProductionDatabasePrivileges(runtime, true);

    for (const [table, column, privilege, grantee, mutation] of [
      [
        'admin_audit_log',
        'actor',
        'UPDATE',
        role,
        "UPDATE admin_audit_log SET actor='modified-synthetic'"
      ],
      [
        'openg7_schema_migrations',
        'name',
        'INSERT',
        'PUBLIC',
        "INSERT INTO openg7_schema_migrations(name) VALUES ('modified-synthetic')"
      ],
      [
        'openg7_schema_migrations',
        'name',
        'UPDATE',
        role,
        "UPDATE openg7_schema_migrations SET name='modified-synthetic'"
      ],
      ['fund_contributions', 'id', 'REFERENCES', role, null]
    ]) {
      await database.pool.query(
        `GRANT ${privilege} (${column}) ON ${table} TO ${grantee}`
      );
      const privileges = (
        await runtime.query(
          `SELECT has_table_privilege(current_user, $1, $2) AS table_grant,
            has_any_column_privilege(current_user, $1, $2) AS column_grant`,
          [table, privilege]
        )
      ).rows[0];
      assert.deepEqual(privileges, { table_grant: false, column_grant: true });
      if (mutation) assert.ok((await runtime.query(mutation)).rowCount > 0);
      await assert.rejects(assertProductionDatabasePrivileges(runtime, true), {
        message: 'DATABASE_RUNTIME_PRIVILEGES_UNSAFE'
      });
      await database.pool.query(buildRuntimeRoleSql(config));
      await assertProductionDatabasePrivileges(runtime, true);
      if (mutation)
        await assert.rejects(runtime.query(mutation), { code: '42501' });
    }
  }
);
