#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(rootDir, '.env');
const rawArgs = process.argv.slice(2);

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32' && /\.cmd$/i.test(command)
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const unquoteEnvValue = (value) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const readEnvFileValue = (key) => {
  if (!existsSync(envPath)) {
    return '';
  }

  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const equalsIndex = normalized.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const name = normalized.slice(0, equalsIndex).trim();
    if (name !== key) {
      continue;
    }

    return unquoteEnvValue(normalized.slice(equalsIndex + 1));
  }

  return '';
};

const getDatabaseUrlHost = (databaseUrl) => {
  if (!databaseUrl) {
    return '';
  }

  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return '';
  }
};

const databaseUrl =
  process.env.DATABASE_URL || readEnvFileValue('DATABASE_URL');
const databaseHost = getDatabaseUrlHost(databaseUrl);
const yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';

if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  run(yarnCommand, [
    'workspace',
    '@openg7/funding-api',
    'stripe:backfill',
    ...rawArgs
  ]);
  process.exit(0);
}

if (databaseHost === 'postgres') {
  console.log(
    'DATABASE_URL uses the private Docker host `postgres`; routing Stripe backfill through Docker Compose.'
  );
  run(process.execPath, [
    resolve(rootDir, 'scripts/stripe-backfill-docker.mjs'),
    ...rawArgs
  ]);
} else {
  run(yarnCommand, [
    'workspace',
    '@openg7/funding-api',
    'stripe:backfill',
    ...rawArgs
  ]);
}
