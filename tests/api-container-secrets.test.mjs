import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Compose propagates API settings without bootstrap, recovery, SSH or unrelated host secrets', () => {
  const clean = Object.fromEntries(
    [
      'PATH',
      'Path',
      'SystemRoot',
      'WINDIR',
      'TEMP',
      'TMP',
      'USERPROFILE',
      'HOME',
      'DOCKER_CONTEXT',
      'DOCKER_CONFIG'
    ]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]])
  );
  const values = {
    POSTGRES_PASSWORD: 'synthetic-bootstrap-private-secret',
    FUNDING_DATABASE_RUNTIME_PASSWORD: 'synthetic-runtime-provisioning-secret',
    FUNDING_BACKUP_S3_SECRET_ACCESS_KEY: 'synthetic-recovery-storage-secret',
    VPS_SSH_KEY: 'synthetic-ssh-private-key',
    UNRELATED_HOST_SECRET: 'synthetic-unrelated-host-secret',
    FUNDING_PRIVATE_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString(
      'base64'
    ),
    FUNDING_EMAIL_WORKER_ENABLED: 'false',
    FUNDING_ADMIN_AUTH_MODE: 'oidc',
    FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-api-identity-secret',
    FUNDING_SPONSORSHIP_INVOICE_PREFIX: 'SYNTHETIC-INVOICE',
    FUNDING_PUBLIC_WRITE_RATE_LIMIT_MAX: '41'
  };
  const result = spawnSync(
    'docker',
    ['compose', '--env-file', '.env.example', 'config', '--format', 'json'],
    {
      env: { ...clean, ...values },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000
    }
  );
  assert.equal(
    result.status,
    0,
    'Compose must resolve using example and synthetic environment only.'
  );
  const api = JSON.parse(result.stdout).services.api;
  for (const key of [
    'POSTGRES_PASSWORD',
    'FUNDING_DATABASE_RUNTIME_PASSWORD',
    'FUNDING_BACKUP_S3_SECRET_ACCESS_KEY',
    'VPS_SSH_KEY',
    'UNRELATED_HOST_SECRET'
  ]) {
    assert.ok(
      !Object.hasOwn(api.environment, key),
      key + ' must never enter the API container'
    );
  }
  for (const key of [
    'FUNDING_PRIVATE_DATA_ENCRYPTION_KEY',
    'FUNDING_EMAIL_WORKER_ENABLED',
    'FUNDING_ADMIN_AUTH_MODE',
    'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
    'FUNDING_SPONSORSHIP_INVOICE_PREFIX',
    'FUNDING_PUBLIC_WRITE_RATE_LIMIT_MAX'
  ]) {
    assert.equal(api.environment[key], values[key]);
  }
  const source = readFileSync('docker-compose.yml', 'utf8')
    .split('\n  api:')[1]
    .split('\n  postgres:')[0];
  assert.ok(
    !source.includes('env_file:'),
    'The API must not inherit the host environment file.'
  );
});
