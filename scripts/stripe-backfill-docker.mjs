#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const runStatus = (command, args) =>
  spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'ignore',
    shell: false
  }).status ?? 1;

console.log('Starting private PostgreSQL service...');
run('docker', ['compose', '--profile', 'database', 'up', '-d', 'postgres']);

console.log('Waiting for private PostgreSQL to become ready...');
for (let attempt = 1; attempt <= 60; attempt += 1) {
  const status = runStatus('docker', [
    'compose',
    '--profile',
    'database',
    'exec',
    '-T',
    'postgres',
    'sh',
    '-c',
    'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  ]);

  if (status === 0) {
    break;
  }

  if (attempt === 60) {
    console.error('PostgreSQL did not become ready.');
    process.exit(1);
  }

  await new Promise((resolveWait) => {
    setTimeout(resolveWait, 2000);
  });
}

console.log('Building API image with the current backfill code...');
run('docker', ['compose', '--profile', 'database', 'build', 'api']);

console.log(
  'Running Stripe backfill inside the Docker Compose data network...'
);
run('docker', [
  'compose',
  '--profile',
  'database',
  'run',
  '--rm',
  '--no-deps',
  'api',
  'node',
  'dist/apps/funding-api/src/stripe-backfill.cli.js',
  ...rawArgs
]);
