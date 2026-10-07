import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdminIdentityService,
  buildAdminIdentitySetupStatus
} from '../dist/apps/funding-api/src/admin-identity.js';

const issuer = 'https://identity.example.test/realms/synthetic';
const origin = 'https://funding.example.test';
const environment = (overrides = {}) => ({
  NODE_ENV: 'production',
  FUNDING_PUBLIC_BASE_URL: `${origin}/ignored-base-path`,
  FUNDING_ADMIN_OIDC_ISSUER: issuer,
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-private-client-id',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-private-client-secret',
  FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: 'synthetic-private-owner-subject',
  FUNDING_ADMIN_OIDC_MFA_ACR: 'synthetic-private-assurance-value',
  FUNDING_ADMIN_TOKEN: 'synthetic-private-root-token',
  FUNDING_ADMIN_SESSION_SECRET: 'synthetic-private-signing-secret',
  FUNDING_PRIVATE_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  ...overrides
});
const createIdentity = (env = environment()) =>
  new AdminIdentityService(
    {
      query() {
        assert.fail('Setup identity diagnostics must not query PostgreSQL.');
      }
    },
    env
  );

test('token diagnostics have no provider configuration and retain the validated encryption indicator', () => {
  for (const encrypted of [false, true]) {
    assert.deepEqual(buildAdminIdentitySetupStatus(null, encrypted), {
      mode: 'token',
      issuer: null,
      callback_url: null,
      client_id_configured: false,
      client_secret_configured: false,
      owner_bootstrap_configured: false,
      mfa_policy: 'amr',
      private_data_encryption_configured: encrypted
    });
  }
});

test('OIDC diagnostics expose only safe configuration indicators without provider or database calls', (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    assert.fail('Setup identity diagnostics must not contact the provider.');
  });
  const env = environment();
  const status = buildAdminIdentitySetupStatus(createIdentity(env), true);
  assert.deepEqual(status, {
    mode: 'oidc',
    issuer,
    callback_url: `${origin}/api/admin/auth/callback`,
    client_id_configured: true,
    client_secret_configured: true,
    owner_bootstrap_configured: true,
    mfa_policy: 'acr',
    private_data_encryption_configured: true
  });
  const serialized = JSON.stringify(status);
  for (const [key, value] of Object.entries(env)) {
    if (
      ![
        'NODE_ENV',
        'FUNDING_PUBLIC_BASE_URL',
        'FUNDING_ADMIN_OIDC_ISSUER'
      ].includes(key)
    ) {
      assert.equal(serialized.includes(value), false, key);
    }
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('OIDC bootstrap and ACR indicators ignore empty CSV entries and do not claim account or MFA readiness', () => {
  for (const [owners, bootstrap] of [
    [undefined, false],
    [' ,  , ', false],
    [' , synthetic-private-owner-subject , ', true]
  ]) {
    for (const [acr, policy] of [
      [undefined, 'amr'],
      [' ,  , ', 'amr'],
      [' , synthetic-private-assurance-value , ', 'acr']
    ]) {
      const identity = createIdentity(
        environment({
          FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: owners,
          FUNDING_ADMIN_OIDC_MFA_ACR: acr
        })
      );
      const status = identity.setupStatus(false);
      assert.equal(status.mode, 'oidc');
      assert.equal(status.owner_bootstrap_configured, bootstrap);
      assert.equal(status.mfa_policy, policy);
      assert.equal(status.private_data_encryption_configured, false);
      assert.equal('ready' in status, false);
      assert.equal('mfa_verified' in status, false);
      assert.equal('owner_exists' in status, false);
    }
  }
});

test('OIDC diagnostics withhold issuer URLs containing query or fragment data without changing accepted service configuration', () => {
  const privateQuery = 'synthetic-private-query-secret';
  const privateFragment = 'synthetic-private-fragment-secret';
  for (const suffix of [
    `?client_secret=${privateQuery}`,
    `#${privateFragment}`,
    `?client_secret=${privateQuery}#${privateFragment}`
  ]) {
    const identity = createIdentity(
      environment({ FUNDING_ADMIN_OIDC_ISSUER: `${issuer}${suffix}` })
    );
    const status = identity.setupStatus(true);
    assert.equal(status.issuer, null);
    assert.equal(status.callback_url, `${origin}/api/admin/auth/callback`);
    const serialized = JSON.stringify(status);
    assert.equal(serialized.includes(privateQuery), false);
    assert.equal(serialized.includes(privateFragment), false);
    assert.equal(serialized.includes(suffix), false);
  }
});

test('OIDC diagnostics follow the loaded service configuration and its existing live credential getters', () => {
  const env = environment();
  const identity = createIdentity(env);
  env.FUNDING_PUBLIC_BASE_URL = 'https://different.example.test';
  env.FUNDING_ADMIN_OIDC_ISSUER = 'https://different-identity.example.test';
  env.FUNDING_ADMIN_OIDC_CLIENT_ID = '';
  env.FUNDING_ADMIN_OIDC_CLIENT_SECRET = '';
  env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS = '';
  env.FUNDING_ADMIN_OIDC_MFA_ACR = '';
  assert.deepEqual(identity.setupStatus(false), {
    mode: 'oidc',
    issuer,
    callback_url: `${origin}/api/admin/auth/callback`,
    client_id_configured: false,
    client_secret_configured: false,
    owner_bootstrap_configured: false,
    mfa_policy: 'amr',
    private_data_encryption_configured: false
  });
});
