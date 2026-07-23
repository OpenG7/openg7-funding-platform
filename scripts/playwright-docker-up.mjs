#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

import { ADMIN_TOKEN } from '../tests/playwright/fixtures/e2e-fixtures.mjs';
import { loadDotEnv } from './lib/load-dotenv.mjs';

const nodeMajor = Number.parseInt(
  process.versions.node.split('.')[0] ?? '',
  10
);

if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
  console.error(
    `Playwright Docker E2E requires Node.js 22 or newer. Current Node.js: ${process.version}.`
  );
  process.exit(1);
}

// The postgres data volume, if it already exists, was initialized with
// whatever POSTGRES_PASSWORD was in .env at the time. Reuse it so this
// script does not lock the api container out of an already-initialized
// database with a mismatched password.
loadDotEnv('.env');

const POSTGRES_DB = process.env.POSTGRES_DB || 'openg7_funding';
const POSTGRES_USER = process.env.POSTGRES_USER || 'openg7_funding';
const POSTGRES_PASSWORD =
  process.env.POSTGRES_PASSWORD || 'local-playwright-postgres-password';

const localOnlyEnv = {
  ...process.env,
  APP_DOMAIN: 'localhost',
  WEB_BIND: process.env.WEB_BIND || '127.0.0.1:8080',
  FUNDING_PLATFORM_ENV: 'development',
  FUNDING_PLATFORM_API_BASE_URL: 'http://127.0.0.1:8080/api',
  FUNDING_PUBLIC_BASE_URL: 'http://127.0.0.1:8080',
  FUNDING_ALLOWED_ORIGINS: 'http://127.0.0.1:8080,http://localhost:8080',
  FUNDING_BUSINESS_SPONSORSHIP_ENABLED:
    process.env.FUNDING_BUSINESS_SPONSORSHIP_ENABLED || 'true',
  FUNDING_ADMIN_TOKEN: ADMIN_TOKEN,
  FUNDING_ADMIN_SESSION_SECRET:
    process.env.FUNDING_ADMIN_SESSION_SECRET ||
    'local-playwright-session-secret-not-sensitive',
  FUNDING_ADMIN_RATE_LIMIT_MAX: '0',
  SMTP_ENABLED: 'false',
  SMTP_PASSWORD: '',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  POSTGRES_DB,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  DATABASE_URL:
    process.env.DATABASE_URL ||
    `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}`,
  SPONSOR_MEDIA_STORAGE_DRIVER: 'local'
};

const result = spawnSync(
  'docker',
  ['compose', '--profile', 'database', 'up', '-d', '--build'],
  {
    env: localOnlyEnv,
    stdio: 'inherit'
  }
);

process.exit(result.status ?? 1);
