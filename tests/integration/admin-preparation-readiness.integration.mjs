import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { promisify } from 'node:util';

import pg from 'pg';

import { assertPreparationReadiness } from '../../dist/apps/funding-api/src/admin-preparation-readiness.js';
import { AdminPreparationService } from '../../dist/apps/funding-api/src/admin-preparation.service.js';
import {
  buildMigrationSql,
  readMigrations
} from '../../scripts/lib/database-migrations.mjs';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const schemaError = { code: 'PREPARATION_SCHEMA_INCOMPATIBLE', status: 503 };
const accessError = { code: 'PREPARATION_DATABASE_ACCESS_DENIED', status: 503 };
const table = 'public.admin_preparation_approvals';
const execFileAsync = promisify(execFile);

async function inspectApiStartup(pool) {
  const config = pool?.options;
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        import http from 'node:http';
        http.Server.prototype.listen = function() { throw new Error('TEST_LISTENER_REACHED'); };
        try {
          await import('./dist/apps/funding-api/src/main.js');
          console.log(JSON.stringify({ code: 'TEST_STARTUP_RETURNED' }));
        } catch (error) {
          console.log(JSON.stringify({ code: error.code ?? error.message, status: error.status }));
        } finally {
          const { dbPool } = await import('./dist/apps/funding-api/src/database.js');
          await dbPool?.end().catch(() => undefined);
        }
      `
    ],
    {
      timeout: 15000,
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        FUNDING_API_PORT: '0',
        FUNDING_PLATFORM_ENV: 'development',
        FUNDING_ADMIN_AUTH_MODE: 'token',
        FUNDING_ADMIN_TOKEN: randomUUID(),
        FUNDING_ADMIN_SESSION_SECRET: randomUUID(),
        FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'false',
        FUNDING_EMAIL_WORKER_ENABLED: 'false',
        SOCIAL_PUBLICATION_WORKER_ENABLED: 'false',
        ...(config
          ? {
              DATABASE_URL: `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@127.0.0.1:${config.port}/${config.database}`
            }
          : {})
      }
    }
  );
  return JSON.parse(stdout.trim());
}

test(
  'Preparation readiness detects pending migrations, partial schema and effective runtime-role privilege drift without writing records',
  { timeout: 180000 },
  async (t) => {
    const database = await startDisposablePostgres({ migrate: false });
    let runtime;
    t.after(async () => {
      await runtime?.end();
      await database.stop();
    });
    const { pool } = database;
    const name = (await pool.query('SELECT current_database() AS name')).rows[0]
      .name;
    const migrations = readMigrations('apps/funding-api/migrations');
    await pool.query(
      buildMigrationSql(
        migrations.filter((migration) => migration.version <= 55),
        { database: name }
      )
    );
    await assert.rejects(assertPreparationReadiness(pool), schemaError);
    await assert.rejects(
      assertPreparationReadiness(pool, 'approve'),
      schemaError
    );
    assert.deepEqual(await inspectApiStartup(pool), schemaError);

    await pool.query(
      buildMigrationSql(
        migrations.filter((migration) => migration.version <= 56),
        { database: name }
      )
    );
    await assert.rejects(assertPreparationReadiness(pool), schemaError);
    assert.deepEqual(await inspectApiStartup(pool), schemaError);
    await pool.query(buildMigrationSql(migrations, { database: name }));
    await assertPreparationReadiness(pool, 'approve');
    assert.deepEqual(await inspectApiStartup(pool), {
      code: 'TEST_LISTENER_REACHED'
    });
    assert.deepEqual(await inspectApiStartup(null), {
      code: 'TEST_LISTENER_REACHED'
    });

    await t.test(
      'column types, required defaults, nullable dossier scope and generation uniqueness are checked',
      async () => {
        const owner = await pool.connect();
        try {
          for (const drift of [
            `ALTER TABLE ${table} DROP COLUMN approval_generation`,
            `ALTER TABLE ${table} ALTER COLUMN run_id SET NOT NULL`,
            `ALTER TABLE ${table} ALTER COLUMN actor TYPE varchar(200)`,
            `ALTER TABLE ${table} ALTER COLUMN id DROP DEFAULT`,
            `ALTER TABLE ${table} ADD COLUMN unexpected_required text NOT NULL`,
            'DROP INDEX admin_preparation_approvals_current_identity'
          ]) {
            await owner.query('BEGIN');
            try {
              await owner.query(drift);
              await assert.rejects(
                assertPreparationReadiness(owner, 'approve'),
                schemaError,
                drift
              );
            } finally {
              await owner.query('ROLLBACK');
            }
          }
        } finally {
          owner.release();
        }
        await assertPreparationReadiness(pool, 'approve');
      }
    );

    const role = 'og7_preparation_readiness';
    const password = randomBytes(32).toString('hex');
    const config = { role, database: name, password };
    await pool.query(buildRuntimeRoleSql(config, { create: true }));
    runtime = new pg.Pool({ ...pool.options, user: role, password });
    await assertPreparationReadiness(runtime, 'approve');
    const contributionId = (
      await pool.query(
        "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at) VALUES('personal_support',2500,'CAD','paid',NOW()) RETURNING id"
      )
    ).rows[0].id;
    let transactions = 0;
    const service = new AdminPreparationService({
      query: (...args) => runtime.query(...args),
      connect: async () => {
        transactions += 1;
        return runtime.connect();
      }
    });
    const receipt = await service.dossierPreparation(contributionId);
    const command = {
      contributionId,
      expectedVersion: receipt.version,
      requestId: randomUUID(),
      confirmed: true
    };
    transactions = 0;

    await t.test(
      'a revoked read rejects navigation and approval before starting a transaction',
      async () => {
        await pool.query(`REVOKE SELECT ON ${table} FROM ${role}`);
        await assert.rejects(
          service.dossierPreparation(contributionId),
          accessError
        );
        await assert.rejects(
          service.approveDossierPreparation(
            command,
            'synthetic-readiness-operator'
          ),
          accessError
        );
        assert.equal(transactions, 0);
        await pool.query(`GRANT SELECT ON ${table} TO PUBLIC`);
        await assertPreparationReadiness(runtime, 'approve');
        await pool.query(`REVOKE SELECT ON ${table} FROM PUBLIC`);
        await pool.query(`GRANT SELECT ON ${table} TO ${role}`);
      }
    );

    await t.test(
      'an INSERT revocation still allows reading but blocks approval before audit or preparation writes',
      async () => {
        await pool.query(`REVOKE INSERT ON ${table} FROM ${role}`);
        await assertPreparationReadiness(runtime);
        await assert.rejects(
          service.approveDossierPreparation(
            command,
            'synthetic-readiness-operator'
          ),
          accessError
        );
        assert.equal(transactions, 0);
        await pool.query(`GRANT INSERT ON ${table} TO ${role}`);
        await assertPreparationReadiness(runtime, 'approve');
      }
    );

    await t.test(
      'column grants are sufficient only when every used column is allowed',
      async () => {
        const selected =
          'id,run_id,contribution_id,preparation_version,actor,request_id,request_hash,audit_reference,snapshot,approved_at,approval_generation';
        const inserted =
          'run_id,contribution_id,preparation_version,actor,request_id,request_hash,audit_reference,snapshot,approval_generation';
        await pool.query(`REVOKE SELECT,INSERT ON ${table} FROM ${role}`);
        await pool.query(
          `GRANT SELECT (${selected}), INSERT (${inserted}) ON ${table} TO ${role}`
        );
        await assertPreparationReadiness(runtime, 'approve');
        await pool.query(`REVOKE SELECT (actor) ON ${table} FROM ${role}`);
        await assert.rejects(assertPreparationReadiness(runtime), accessError);
        await pool.query(`GRANT SELECT (actor) ON ${table} TO ${role}`);
        await pool.query(
          `REVOKE INSERT (approval_generation) ON ${table} FROM ${role}`
        );
        await assertPreparationReadiness(runtime);
        await assert.rejects(
          assertPreparationReadiness(runtime, 'approve'),
          accessError
        );
        await pool.query(
          `GRANT INSERT (approval_generation) ON ${table} TO ${role}`
        );
        await assertPreparationReadiness(runtime, 'approve');
      }
    );

    await t.test(
      'schema usage is required even when table grants remain present',
      async () => {
        await pool.query('REVOKE USAGE ON SCHEMA public FROM PUBLIC');
        await pool.query(`REVOKE USAGE ON SCHEMA public FROM ${role}`);
        await assert.rejects(assertPreparationReadiness(runtime), accessError);
        await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
        await assertPreparationReadiness(runtime, 'approve');
      }
    );

    for (const relation of ['admin_preparation_approvals', 'admin_audit_log'])
      assert.equal(
        (await pool.query(`SELECT count(*) AS n FROM ${relation}`)).rows[0].n,
        '0'
      );
    assert.equal(
      (
        await pool.query(
          'SELECT amount_cents FROM fund_contributions WHERE id=$1',
          [contributionId]
        )
      ).rows[0].amount_cents,
      2500
    );
  }
);
