import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const runServicesCheck = (args) =>
  spawnSync(process.execPath, ['scripts/services-check.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

test('services readiness shortcut is registered', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  assert.equal(
    pkg.scripts['services:check'],
    'node scripts/services-check.mjs'
  );
});

test('services readiness check reports placeholders without leaking values', () => {
  const result = runServicesCheck(['--env', '.env.example', '--env-only']);
  const output = result.stdout + result.stderr;

  assert.notEqual(result.status, 0);
  assert.match(output, /STRIPE_SECRET_KEY/);
  assert.match(output, /STRIPE_WEBHOOK_SECRET/);
  assert.match(output, /SMTP_ENABLED/);
  assert.match(output, /DATABASE_URL/);
  assert.match(output, /OVH_S3_ACCESS_KEY_ID/);
  assert.doesNotMatch(output, /sk_live_replace_me/);
  assert.doesNotMatch(output, /whsec_your_webhook_secret_here/);
  assert.doesNotMatch(output, /replace_with_a_long_random_admin_token/);
});

test('services readiness check accepts a complete configuration file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'og7-services-'));
  const envPath = path.join(tempDir, '.env.ready');

  fs.writeFileSync(
    envPath,
    [
      'APP_DOMAIN=openg7.org',
      'LETSENCRYPT_EMAIL=admin@openg7.org',
      'FUNDING_PLATFORM_ENV=production',
      'FUNDING_PLATFORM_API_BASE_URL=https://openg7.org/api',
      'FUNDING_PUBLIC_BASE_URL=https://openg7.org',
      'FUNDING_ALLOWED_ORIGINS=https://openg7.org,https://www.openg7.org',
      `FUNDING_ADMIN_TOKEN=${'a'.repeat(40)}`,
      `FUNDING_ADMIN_SESSION_SECRET=${'b'.repeat(40)}`,
      'FUNDING_ADMIN_SESSION_TTL_MINUTES=60',
      `STRIPE_SECRET_KEY=sk_live_${'c'.repeat(32)}`,
      `STRIPE_WEBHOOK_SECRET=whsec_${'d'.repeat(32)}`,
      'SMTP_ENABLED=true',
      'SMTP_HOST=mail.papamail.net',
      'SMTP_PORT=465',
      'SMTP_SECURE=true',
      'SMTP_USER=notify@openg7.org',
      `SMTP_PASSWORD=${'e'.repeat(32)}`,
      'MAIL_FROM_ADDRESS=notify@openg7.org',
      'MAIL_REPLY_TO_ADDRESS=contact@openg7.org',
      'FUNDING_ADMIN_NOTIFICATION_EMAIL=admin@openg7.org',
      `DATABASE_URL=postgres://openg7_funding:${'f'.repeat(32)}@postgres:5432/openg7_funding`,
      'SPONSOR_MEDIA_STORAGE_DRIVER=ovh-s3',
      'SPONSOR_MEDIA_REGION=bhs',
      'SPONSOR_MEDIA_ENDPOINT=https://s3.bhs.io.cloud.ovh.net',
      'SPONSOR_MEDIA_PUBLIC_BUCKET=openg7-funding-sponsor-media-public-prod',
      'SPONSOR_MEDIA_PUBLIC_BASE_URL=https://openg7-funding-sponsor-media-public-prod.s3.bhs.io.cloud.ovh.net',
      'SPONSOR_MEDIA_PRIVATE_BUCKET=openg7-funding-sponsor-media-private-prod',
      'SPONSOR_MEDIA_PRIVATE_BASE_URL=https://openg7-funding-sponsor-media-private-prod.s3.bhs.io.cloud.ovh.net',
      `OVH_S3_ACCESS_KEY_ID=${'g'.repeat(24)}`,
      `OVH_S3_SECRET_ACCESS_KEY=${'h'.repeat(40)}`
    ].join('\n')
  );

  try {
    const result = runServicesCheck(['--env', envPath, '--env-only']);
    const output = result.stdout + result.stderr;

    assert.equal(result.status, 0, output);
    assert.doesNotMatch(output, /\[MISSING\]/);
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});
