#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDotEnv } from './lib/load-dotenv.mjs';
import {
  buildMigrationSql,
  migrationFailure,
  migrationReport,
  parseMigrationArgs,
  readMigrations
} from './lib/database-migrations.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const usage = `Usage: node scripts/db-migrate.mjs [--plan]
       node scripts/db-migrate.mjs --baseline-through <NNN_name.sql> --confirm-database <database> --baseline-reference <review-id>

Default: apply pending migrations atomically with checksums and a database lock.
--plan: read-only inventory; does not start PostgreSQL or create a registry.
--baseline-through: record reviewed legacy history only; executes no application SQL.
Baseline requires a verified backup and schema review. Never infer history from table names.
Both runners use Node 22, Docker Compose, POSTGRES_DB/POSTGRES_USER and MIGRATIONS_DIR.
Configuration: OPENG7_E2E_ENV_FILE when set, otherwise .env; shell values take precedence.
`;

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};
const docker = (args, options = {}) =>
  spawnSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 360_000,
    maxBuffer: 16 * 1024 * 1024,
    ...options
  });
const compose = ['compose', '--profile', 'database'];

let options;
try {
  options = parseMigrationArgs(process.argv.slice(2));
} catch (error) {
  fail(error.message);
}
if (options.help) {
  console.log(usage);
  process.exit(0);
}
if (Number(process.versions.node.split('.')[0]) !== 22)
  fail('Use Node.js 22 for database migrations.');

loadDotEnv(process.env.OPENG7_E2E_ENV_FILE ?? '.env');
const database = process.env.POSTGRES_DB || 'openg7_funding';
const user = process.env.POSTGRES_USER || 'openg7_funding';
if (options.mode === 'baseline' && options.confirmDatabase !== database) {
  fail('Baseline confirmation does not match POSTGRES_DB.');
}

let sql;
try {
  const migrations = readMigrations(
    resolve(root, process.env.MIGRATIONS_DIR || 'apps/funding-api/migrations')
  );
  sql = buildMigrationSql(migrations, { ...options, database });
} catch {
  fail(
    'Invalid migration directory, filenames or baseline boundary. No database operation was attempted.'
  );
}
if (docker(['compose', 'version']).status !== 0)
  fail('Docker Compose is unavailable.');

if (options.mode === 'apply') {
  console.log('Starting PostgreSQL service.');
  if (docker([...compose, 'up', '-d', 'postgres']).status !== 0)
    fail('Failed to start PostgreSQL service.');
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (
      docker([
        ...compose,
        'exec',
        '-T',
        'postgres',
        'pg_isready',
        '-U',
        user,
        '-d',
        database
      ]).status === 0
    ) {
      ready = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 2000));
  }
  if (!ready) fail('PostgreSQL did not become ready.');
}

const result = docker(
  [
    ...compose,
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
    user,
    '-d',
    database
  ],
  { input: sql }
);
if (result.status !== 0) fail(migrationFailure(result.stderr));
// Notices emitted before a rollback are intentionally discarded on failure.
for (const line of migrationReport(result.stderr)) console.log(line);
console.log(
  options.mode === 'plan'
    ? 'Migration plan completed; no persistent changes.'
    : options.mode === 'baseline'
      ? 'Reviewed migration history recorded; pending SQL was not executed.'
      : 'Database migrations committed.'
);
