#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDotEnv } from './lib/load-dotenv.mjs';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT_DIR);

loadDotEnv('.env');

const POSTGRES_DB = process.env.POSTGRES_DB || 'openg7_funding';
const POSTGRES_USER = process.env.POSTGRES_USER || 'openg7_funding';
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR || 'apps/funding-api/migrations';

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};

const run = (args, options = {}) => {
  const result = spawnSync('docker', args, {
    stdio: options.stdio ?? 'inherit',
    input: options.input
  });

  if (result.error) {
    fail(result.error.message);
  }

  return result.status ?? 1;
};

const dockerOk = (args) =>
  spawnSync('docker', args, { stdio: 'ignore' }).status === 0;

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const migrationsPath = resolve(ROOT_DIR, MIGRATIONS_DIR);

if (!dockerOk(['compose', 'version'])) {
  fail('docker compose plugin is not installed.');
}

if (!existsSync(migrationsPath)) {
  fail(`Migrations directory not found: ${MIGRATIONS_DIR}`);
}

console.log('Starting PostgreSQL service.');
if (run(['compose', '--profile', 'database', 'up', '-d', 'postgres']) !== 0) {
  fail('Failed to start PostgreSQL service.');
}

console.log('Waiting for PostgreSQL to become ready.');
let ready = false;

for (let attempt = 0; attempt < 60; attempt += 1) {
  if (
    dockerOk([
      'compose',
      '--profile',
      'database',
      'exec',
      '-T',
      'postgres',
      'pg_isready',
      '-U',
      POSTGRES_USER,
      '-d',
      POSTGRES_DB
    ])
  ) {
    ready = true;
    break;
  }

  await sleep(2000);
}

if (!ready) {
  fail('PostgreSQL did not become ready.');
}

const migrations = readdirSync(migrationsPath)
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort();

if (migrations.length === 0) {
  fail(`No SQL migrations found in ${MIGRATIONS_DIR}.`);
}

for (const migration of migrations) {
  const relativePath = join(MIGRATIONS_DIR, migration).replace(/\\/g, '/');
  const migrationPath = join(migrationsPath, migration);

  console.log(`Applying ${relativePath}`);
  const status = run(
    [
      'compose',
      '--profile',
      'database',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      POSTGRES_USER,
      '-d',
      POSTGRES_DB
    ],
    {
      input: readFileSync(migrationPath),
      stdio: ['pipe', 'inherit', 'inherit']
    }
  );

  if (status !== 0) {
    fail(`Failed to apply ${relativePath}.`);
  }
}

console.log('Database migrations completed.');
