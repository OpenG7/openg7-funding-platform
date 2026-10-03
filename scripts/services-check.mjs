#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateServicesReadiness } from './lib/services-readiness.mjs';
import { formatServicesReadinessReport } from './lib/services-check-report.mjs';

const usage = `Usage: node scripts/services-check.mjs [--env <path>] [--env-only]

Checks whether the local configuration is ready to operate the funding services.
Checks token/OIDC settings and optional operations alerts without contacting providers.
This deployment check requires HTTPS. The report never prints secret values.

Options:
  --env <path>  Read configuration from this env file. Defaults to .env.
  --env-only   Ignore inherited shell environment variables.
  --help       Show this help message.
`;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(usage);
  process.exit(0);
}

const envPath = resolve(process.cwd(), args.envFile);
const fileEnv = existsSync(envPath) ? readEnvFile(envPath) : {};
const env = args.envOnly ? fileEnv : { ...fileEnv, ...process.env };
const envFileExists = existsSync(envPath);
const toolStatuses = Object.fromEntries(
  ['docker', 'stripe'].map((command) => [
    command,
    spawnSync(command, ['--version'], { encoding: 'utf8', stdio: 'pipe' })
      .status
  ])
);
const checks = evaluateServicesReadiness(env, {
  envFile: args.envFile,
  envFileExists,
  nodeVersion: process.versions.node,
  toolStatuses
});
process.stdout.write(formatServicesReadinessReport(checks, args.envFile));
process.exitCode = checks.some((check) => check.status === 'missing') ? 1 : 0;

function parseArgs(argv) {
  const parsed = {
    envFile: '.env',
    envOnly: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--env-only') {
      parsed.envOnly = true;
      continue;
    }

    if (arg === '--env') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--env requires a path');
      }
      parsed.envFile = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--env=')) {
      parsed.envFile = arg.slice('--env='.length);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return parsed;
}

function readEnvFile(path) {
  const values = {};
  const content = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    values[key] = normalizeEnvValue(rawValue);
  }

  return values;
}

function normalizeEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed.replace(/\s+#.*$/, '').trim();
}
