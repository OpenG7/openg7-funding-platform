#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

if (!process.versions.node.startsWith('22.')) {
  console.error(
    `Playwright Docker E2E requires Node.js 22.x. Current Node.js: ${process.version}.`
  );
  process.exit(1);
}

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
  FUNDING_ADMIN_TOKEN:
    process.env.FUNDING_ADMIN_TOKEN || 'local-playwright-admin-token',
  FUNDING_ADMIN_SESSION_SECRET:
    process.env.FUNDING_ADMIN_SESSION_SECRET ||
    'local-playwright-session-secret-not-sensitive',
  SMTP_ENABLED: 'false',
  SMTP_PASSWORD: '',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  DATABASE_URL: '',
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
