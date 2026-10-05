import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  buildRuntimeRoleSql,
  runtimeRoleConfig
} from '../scripts/lib/database-runtime-role.mjs';

const settings = {
  POSTGRES_DB: 'synthetic_database',
  POSTGRES_USER: 'synthetic_owner',
  FUNDING_DATABASE_RUNTIME_USER: 'synthetic_runtime',
  FUNDING_DATABASE_RUNTIME_PASSWORD:
    "synthetic-long-password-$og7_runtime_role$'; CREATE ROLE hacked SUPERUSER;--"
};
test('runtime provisioning rejects privilege aliasing and treats a hostile password as data', () => {
  const config = runtimeRoleConfig(settings, { requirePassword: true });
  const sql = buildRuntimeRoleSql(config, { create: true });
  assert.ok(!sql.includes(settings.FUNDING_DATABASE_RUNTIME_PASSWORD));
  assert.ok(
    sql.includes(
      Buffer.from(settings.FUNDING_DATABASE_RUNTIME_PASSWORD).toString('base64')
    )
  );
  assert.throws(() =>
    runtimeRoleConfig({
      ...settings,
      FUNDING_DATABASE_RUNTIME_USER: settings.POSTGRES_USER
    })
  );
  assert.throws(() =>
    runtimeRoleConfig({
      ...settings,
      FUNDING_DATABASE_RUNTIME_USER: 'bad;DROP TABLE'
    })
  );
  assert.throws(() =>
    runtimeRoleConfig(
      { ...settings, FUNDING_DATABASE_RUNTIME_PASSWORD: 'short' },
      { requirePassword: true }
    )
  );
});
test('runtime role plan never connects and apply refuses target mismatches without printing credentials', () => {
  const run = (args) =>
    spawnSync(process.execPath, ['scripts/db-runtime-role.mjs', ...args], {
      env: {
        ...process.env,
        ...settings,
        OPENG7_E2E_ENV_FILE: 'nonexistent-synthetic-role.env'
      },
      encoding: 'utf8',
      windowsHide: true
    });
  const planned = run(['--plan']);
  assert.equal(planned.status, 0, planned.stderr);
  assert.match(planned.stdout, /No connection or changes/);
  const refused = run([
    '--apply',
    '--confirm-database',
    'wrong',
    '--confirm-role',
    'synthetic_runtime'
  ]);
  assert.notEqual(refused.status, 0);
  assert.ok(
    !(planned.stdout + refused.stderr).includes(
      settings.FUNDING_DATABASE_RUNTIME_PASSWORD
    )
  );
});
