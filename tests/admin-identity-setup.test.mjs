import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
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

test('the managed provider flag labels health without changing OIDC configuration diagnostics', (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => {
    assert.fail('Configuration diagnostics must not contact the provider.');
  });
  for (const [value, provider] of [
    [undefined, 'OIDC'],
    ['false', 'OIDC'],
    ['true', 'Keycloak']
  ]) {
    const identity = createIdentity(
      environment({ FUNDING_KEYCLOAK_ENABLED: value })
    );
    assert.equal(identity.providerHealth.provider, provider);
    assert.equal(identity.providerHealth.evidence, 'oidc_discovery');
    assert.equal(identity.setupStatus(true).mode, 'oidc');
  }
  for (const value of ['', 'yes', 'synthetic-private-invalid-flag'])
    assert.throws(
      () => createIdentity(environment({ FUNDING_KEYCLOAK_ENABLED: value })),
      (error) => {
        assert.equal(
          error.message,
          'FUNDING_KEYCLOAK_ENABLED must be true or false.'
        );
        return true;
      }
    );
  assert.equal(fetch.mock.callCount(), 0);
});

test('managed readiness is private, validated at startup and separate from configuration indicators', () => {
  const privateUrl = 'http://keycloak:9000/health/ready';
  const identity = createIdentity(
    environment({
      FUNDING_KEYCLOAK_ENABLED: 'true',
      FUNDING_KEYCLOAK_HEALTH_URL: privateUrl
    })
  );
  assert.equal(identity.providerHealth.provider, 'Keycloak');
  assert.equal(identity.providerHealth.evidence, 'keycloak_readiness');
  assert.ok(!JSON.stringify(identity.setupStatus(true)).includes(privateUrl));
  assert.ok(!JSON.stringify(identity.providerHealth).includes(privateUrl));
  assert.equal(createIdentity().providerHealth.evidence, 'oidc_discovery');
  assert.throws(
    () =>
      createIdentity(environment({ FUNDING_KEYCLOAK_HEALTH_URL: privateUrl })),
    /requires managed Keycloak/
  );
  for (const value of [
    'http://other-service:9000/health/ready',
    'http://keycloak:9000/private',
    'https://user:synthetic-private-password@keycloak.example.test/health/ready'
  ])
    assert.throws(
      () =>
        createIdentity(
          environment({
            FUNDING_KEYCLOAK_ENABLED: 'true',
            FUNDING_KEYCLOAK_HEALTH_URL: value
          })
        ),
      (error) => {
        assert.ok(!error.message.includes(value));
        assert.ok(!error.message.includes('synthetic-private-password'));
        return true;
      }
    );
});

test('the identity health port uses discovery, signing keys and managed database readiness without credentials', async (t) => {
  const env = environment({
    FUNDING_KEYCLOAK_ENABLED: 'true',
    FUNDING_KEYCLOAK_HEALTH_URL: 'http://keycloak:9000/health/ready'
  });
  const signingKey = generateKeyPairSync('rsa', {
    modulusLength: 2048
  }).publicKey.export({ format: 'jwk' });
  const requests = [];
  const responses = [
    {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`
    },
    { keys: [{ ...signingKey, alg: 'RS256', use: 'sig' }] },
    {
      status: 'UP',
      checks: [
        {
          name: 'Keycloak database connections async health check',
          status: 'UP'
        }
      ]
    }
  ];
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify(responses[requests.length - 1]), {
      headers: { 'Content-Type': 'application/json' }
    });
  });
  const controller = new AbortController();
  await createIdentity(env).providerHealth.read(controller.signal);
  assert.equal(fetch.mock.callCount(), 3);
  assert.deepEqual(
    requests.map((request) => request.url),
    [
      `${issuer}/.well-known/openid-configuration`,
      `${issuer}/jwks`,
      env.FUNDING_KEYCLOAK_HEALTH_URL
    ]
  );
  for (const request of requests) {
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.signal, controller.signal);
    assert.equal(request.options.credentials, 'omit');
    assert.equal(request.options.body, undefined);
    assert.equal(request.options.headers.Authorization, undefined);
    assert.equal(request.options.headers.Cookie, undefined);
  }
  const serialized = JSON.stringify(requests);
  assert.ok(!serialized.includes(env.FUNDING_ADMIN_OIDC_CLIENT_SECRET));
  assert.ok(!serialized.includes(env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS));
});

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
