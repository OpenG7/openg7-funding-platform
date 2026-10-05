#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './lib/load-dotenv.mjs';
import {
  buildRuntimeRoleSql,
  runtimeRoleConfig
} from './lib/database-runtime-role.mjs';

const usage = `Usage: node scripts/db-runtime-role.mjs --plan
       node scripts/db-runtime-role.mjs --apply --confirm-database <POSTGRES_DB> --confirm-role <FUNDING_DATABASE_RUNTIME_USER>
Default/--plan: validate and describe configuration without connecting or changing anything.
--apply: separately authorized creation/grants on the running private Compose PostgreSQL.
Existing privileged/owning/member roles are refused. Existing passwords are never changed.
Prepare a backup and an isolated rehearsal before applying to an existing environment.
`;
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    process.exit(0);
  }
  const apply = args[0] === '--apply';
  if (!(
    args.length === 0 ||
    (args.length === 1 && args[0] === '--plan') ||
    (apply &&
      args.length === 5 &&
      args[1] === '--confirm-database' &&
      args[3] === '--confirm-role')
  ))
    throw new Error('Invalid arguments.');
  loadDotEnv(process.env.OPENG7_E2E_ENV_FILE ?? '.env');
  const config = runtimeRoleConfig(process.env, { requirePassword: apply });
  if (!config) throw new Error('Configure a dedicated runtime role.');
  if (apply && (args[2] !== config.database || args[4] !== config.role))
    throw new Error('Confirmation mismatch.');
  if (!apply) {
    console.log(
      `Runtime role plan: ${config.role} on ${config.database}; migration owner ${config.owner}.`
    );
    console.log(
      'No admin/ownership/membership, CREATE, TRUNCATE or business DELETE; audit append only, migration registry read only. No connection or changes.'
    );
    process.exit(0);
  }
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--profile',
      'database',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=terse',
      '-U',
      config.owner,
      '-d',
      config.database
    ],
    {
      input: `BEGIN;\nSET LOCAL lock_timeout='30s';\nSET LOCAL statement_timeout='60s';\n${buildRuntimeRoleSql(config, { create: true })}\nCOMMIT;\n`,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 90000,
      maxBuffer: 1024 * 1024
    }
  );
  if (result.status !== 0) throw new Error('Role provisioning failed.');
  console.log(
    'Dedicated runtime role and grants committed. Password of any existing role preserved.'
  );
} catch {
  console.error(
    'FAIL: Runtime role provisioning refused or uncertain. Verify configuration/confirmations and reconcile the role before retrying. Private SQL diagnostics suppressed.'
  );
  process.exitCode = 1;
}
