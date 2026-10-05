import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  completeConfig,
  oidcConfig,
  alertsConfig
} from './support/services-check-fixtures.mjs';

const runServicesCheck = (args, inherited = {}) =>
  spawnSync(process.execPath, ['scripts/services-check.mjs', ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...inherited },
    encoding: 'utf8'
  });

function checkConfig(t, overrides = {}, inherited = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'og7-services-'));
  const envPath = path.join(tempDir, '.env.ready');
  t.after(() => {
    fs.unlinkSync(envPath);
    fs.rmdirSync(tempDir);
  });
  const config = { ...completeConfig, ...overrides };
  fs.writeFileSync(
    envPath,
    Object.entries(config)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n')
  );
  const result = runServicesCheck(['--env', envPath, '--env-only'], inherited);
  return { ...result, output: result.stdout + result.stderr };
}

test('services readiness shortcut is registered', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(
    pkg.scripts['services:check'],
    'node scripts/services-check.mjs'
  );
});

test('production readiness refuses shared token administration and accepts configured OIDC', (t) => {
  const token = checkConfig(t, {
    FUNDING_PLATFORM_ENV: 'production',
    FUNDING_ADMIN_AUTH_MODE: 'token'
  });
  assert.notEqual(token.status, 0);
  assert.match(token.output, /production requires OIDC and verified MFA/);
  const oidc = checkConfig(t, {
    ...oidcConfig,
    FUNDING_PLATFORM_ENV: 'production'
  });
  assert.equal(oidc.status, 0, oidc.output);
});

test('token readiness rejects sessions configured above one hour', (t) => {
  const result = checkConfig(t, { FUNDING_ADMIN_SESSION_TTL_MINUTES: '61' });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /at most 60 minutes/);
});

test('readiness rejects ambiguous environment names and protects standalone NODE_ENV production', (t) => {
  for (const environment of ['', 'Production', 'unknown']) {
    const result = checkConfig(t, { FUNDING_PLATFORM_ENV: environment });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /must be development, test, or production/);
  }
  const result = checkConfig(t, {
    FUNDING_PLATFORM_ENV: undefined,
    NODE_ENV: 'production'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /production requires OIDC and verified MFA/);
});

test('media readiness rejects a size that exceeds the supported proxy envelope', (t) => {
  const { status, output } = checkConfig(t, {
    FUNDING_SPONSOR_MEDIA_MAX_BYTES: '8388609'
  });
  assert.notEqual(status, 0);
  assert.match(output, /FUNDING_SPONSOR_MEDIA_MAX_BYTES/);
});

test('services readiness check reports placeholders without leaking values', () => {
  const result = runServicesCheck(['--env', '.env.example', '--env-only']);
  const output = result.stdout + result.stderr;
  assert.notEqual(result.status, 0);
  for (const name of [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'SMTP_ENABLED',
    'DATABASE_URL',
    'OVH_S3_ACCESS_KEY_ID',
    'SOCIAL_PUBLICATION_MODE'
  ]) {
    assert.match(output, new RegExp(name));
  }
  for (const value of [
    'sk_live_replace_me',
    'whsec_your_webhook_secret_here',
    'replace_with_a_long_random_admin_token'
  ]) {
    assert.ok(!output.includes(value));
  }
});

test('complete token configuration defaults to token mode and reports disabled alerts', (t) => {
  const { status, output } = checkConfig(t);
  assert.equal(status, 0, output);
  assert.doesNotMatch(output, /\[MISSING\]/);
  assert.match(output, /\[OK\] Admin \/ FUNDING_ADMIN_AUTH_MODE: token/);
  assert.match(output, /\[WARN\] Operations alerts.*disabled/);
  assert.match(
    output,
    /MFA, alert delivery and running services have not been verified/
  );
});

test('invalid admin mode and token settings block readiness', async (t) => {
  const cases = [
    [
      'unknown mode',
      { FUNDING_ADMIN_AUTH_MODE: 'invalid-private-canary' },
      'FUNDING_ADMIN_AUTH_MODE'
    ],
    ['empty mode', { FUNDING_ADMIN_AUTH_MODE: '' }, 'FUNDING_ADMIN_AUTH_MODE'],
    [
      'missing root token',
      { FUNDING_ADMIN_TOKEN: undefined },
      'FUNDING_ADMIN_TOKEN'
    ],
    [
      'short root token',
      { FUNDING_ADMIN_TOKEN: 'short' },
      'FUNDING_ADMIN_TOKEN'
    ],
    [
      'missing session secret',
      { FUNDING_ADMIN_SESSION_SECRET: undefined },
      'FUNDING_ADMIN_SESSION_SECRET'
    ],
    [
      'shared secret',
      { FUNDING_ADMIN_SESSION_SECRET: completeConfig.FUNDING_ADMIN_TOKEN },
      'FUNDING_ADMIN_SESSION_SECRET'
    ],
    [
      'invalid duration',
      { FUNDING_ADMIN_SESSION_TTL_MINUTES: '0' },
      'FUNDING_ADMIN_SESSION_TTL_MINUTES'
    ]
  ];
  for (const [name, overrides, field] of cases) {
    await t.test(name, (t) => {
      const { status, output } = checkConfig(t, overrides);
      assert.equal(status, 1, output);
      assert.match(output, new RegExp(`\\[MISSING\\] Admin / ${field}:`));
      assert.ok(!output.includes('invalid-private-canary'));
    });
  }
});

test('explicit token mode ignores unused OIDC settings', (t) => {
  const { status, output } = checkConfig(t, {
    FUNDING_ADMIN_AUTH_MODE: 'token',
    FUNDING_ADMIN_OIDC_ISSUER: 'unused-invalid-issuer',
    FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'replace_me',
    FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: ', ,',
    FUNDING_ADMIN_OIDC_MFA_ACR: ', ,'
  });
  assert.equal(status, 0, output);
  assert.doesNotMatch(output, /FUNDING_ADMIN_OIDC_/);
});

test('OIDC configuration needs no token settings and does not claim MFA verification', (t) => {
  const { status, output } = checkConfig(t, {
    ...oidcConfig,
    FUNDING_ADMIN_SESSION_TTL_MINUTES: 'invalid-unused'
  });
  assert.equal(status, 0, output);
  assert.doesNotMatch(
    output,
    /FUNDING_ADMIN_TOKEN|FUNDING_ADMIN_SESSION_SECRET|FUNDING_ADMIN_SESSION_TTL_MINUTES/
  );
  assert.match(output, /signed amr must contain mfa; verify with the provider/);
  assert.match(output, /configuration only; verify migration 020/);
  for (const value of Object.values(oidcConfig).filter((value) =>
    value?.startsWith('synthetic-')
  )) {
    assert.ok(!output.includes(value), value);
  }
});

test('incomplete or unsafe OIDC configuration blocks readiness', async (t) => {
  const cases = [
    ['missing issuer', 'FUNDING_ADMIN_OIDC_ISSUER', undefined],
    ['malformed issuer', 'FUNDING_ADMIN_OIDC_ISSUER', 'private-issuer-canary'],
    [
      'HTTP issuer',
      'FUNDING_ADMIN_OIDC_ISSUER',
      'http://identity.funding.test'
    ],
    [
      'loopback HTTP deployment issuer',
      'FUNDING_ADMIN_OIDC_ISSUER',
      'http://127.0.0.1:5555'
    ],
    [
      'issuer credentials',
      'FUNDING_ADMIN_OIDC_ISSUER',
      'https://user:private-password@identity.funding.test'
    ],
    ['missing client ID', 'FUNDING_ADMIN_OIDC_CLIENT_ID', undefined],
    ['missing client secret', 'FUNDING_ADMIN_OIDC_CLIENT_SECRET', undefined],
    [
      'placeholder secret',
      'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
      'replace_with_a_private_secret'
    ],
    ['missing database', 'DATABASE_URL', undefined],
    ['missing public origin', 'FUNDING_PUBLIC_BASE_URL', undefined],
    [
      'public origin credentials',
      'FUNDING_PUBLIC_BASE_URL',
      'https://user:private-password@funding.test'
    ],
    [
      'different API origin',
      'FUNDING_PLATFORM_API_BASE_URL',
      'https://api.funding.test/api'
    ],
    [
      'API origin credentials',
      'FUNDING_PLATFORM_API_BASE_URL',
      'https://user:private-password@funding.test/api'
    ],
    ['empty owner list', 'FUNDING_ADMIN_OIDC_OWNER_SUBJECTS', ', ,'],
    ['placeholder owner', 'FUNDING_ADMIN_OIDC_OWNER_SUBJECTS', 'your_subject'],
    ['empty ACR list', 'FUNDING_ADMIN_OIDC_MFA_ACR', ', ,'],
    ['placeholder ACR', 'FUNDING_ADMIN_OIDC_MFA_ACR', 'your_mfa_acr']
  ];
  for (const [name, field, value] of cases) {
    await t.test(name, (t) => {
      const { status, output } = checkConfig(t, {
        ...oidcConfig,
        [field]: value
      });
      assert.equal(status, 1, output);
      assert.match(output, new RegExp(`\\[MISSING\\] [^\\n]+ / ${field}:`));
      if (value && value !== ', ,') assert.ok(!output.includes(value));
    });
  }
});

test('existing OIDC owners and custom MFA policy require operational verification', (t) => {
  const { status, output } = checkConfig(t, {
    ...oidcConfig,
    FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: undefined,
    FUNDING_ADMIN_OIDC_MFA_ACR: 'urn:synthetic:mfa, urn:synthetic:strong'
  });
  assert.equal(status, 0, output);
  assert.match(output, /verify an active owner already exists in PostgreSQL/);
  assert.match(
    output,
    /provider guarantees MFA for every configured ACR value/
  );
  assert.doesNotMatch(output, /urn:synthetic/);
});

test('complete alerts configuration remains a static check without leaking webhook credentials', (t) => {
  const { status, output } = checkConfig(t, { ...oidcConfig, ...alertsConfig });
  assert.equal(status, 0, output);
  assert.match(
    output,
    /\[OK\] Operations alerts \/ FUNDING_OPERATIONS_WEBHOOK_URL: present/
  );
  assert.match(
    output,
    /configuration only; verify migration 021, a running watcher, receiver signature checks and event deduplication/
  );
  for (const value of Object.values(alertsConfig))
    assert.ok(!output.includes(value));
  assert.doesNotMatch(output, /private-canary/);
});

test('partial or unsafe alert configuration blocks readiness', async (t) => {
  const cases = [
    ['missing URL', 'FUNDING_OPERATIONS_WEBHOOK_URL', undefined],
    [
      'malformed URL',
      'FUNDING_OPERATIONS_WEBHOOK_URL',
      'private-webhook-canary'
    ],
    [
      'placeholder URL',
      'FUNDING_OPERATIONS_WEBHOOK_URL',
      'https://example.com/hooks/private-canary'
    ],
    [
      'HTTP URL',
      'FUNDING_OPERATIONS_WEBHOOK_URL',
      'http://alerts.funding.test'
    ],
    [
      'URL credentials',
      'FUNDING_OPERATIONS_WEBHOOK_URL',
      'https://user:private-password@alerts.funding.test'
    ],
    ['missing secret', 'FUNDING_OPERATIONS_WEBHOOK_SECRET', undefined],
    ['short secret', 'FUNDING_OPERATIONS_WEBHOOK_SECRET', 'k'.repeat(31)],
    [
      'placeholder secret',
      'FUNDING_OPERATIONS_WEBHOOK_SECRET',
      'replace_with_a_long_private_alert_secret'
    ],
    ['missing database', 'DATABASE_URL', undefined],
    [
      'public origin credentials',
      'FUNDING_PUBLIC_BASE_URL',
      'https://user:private-password@funding.test'
    ]
  ];
  for (const [name, field, value] of cases) {
    await t.test(name, (t) => {
      const { status, output } = checkConfig(t, {
        ...alertsConfig,
        [field]: value
      });
      assert.equal(status, 1, output);
      assert.match(output, new RegExp(`\\[MISSING\\] [^\\n]+ / ${field}:`));
      if (value) assert.ok(!output.includes(value));
    });
  }
});

test('env-only does not let inherited values fill in missing identity or alert configuration', (t) => {
  const { status, output } = checkConfig(
    t,
    {
      ...oidcConfig,
      ...alertsConfig,
      FUNDING_ADMIN_OIDC_CLIENT_SECRET: undefined,
      FUNDING_OPERATIONS_WEBHOOK_SECRET: undefined
    },
    {
      FUNDING_ADMIN_AUTH_MODE: 'token',
      FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'inherited-oidc-canary',
      FUNDING_OPERATIONS_WEBHOOK_SECRET: 'inherited-alert-canary-signing-secret'
    }
  );
  assert.equal(status, 1, output);
  assert.match(output, /\[OK\] Admin \/ FUNDING_ADMIN_AUTH_MODE: oidc/);
  assert.match(output, /\[MISSING\] Admin \/ FUNDING_ADMIN_OIDC_CLIENT_SECRET/);
  assert.match(
    output,
    /\[MISSING\] Operations alerts \/ FUNDING_OPERATIONS_WEBHOOK_SECRET/
  );
  assert.doesNotMatch(output, /inherited-.*canary/);
});
