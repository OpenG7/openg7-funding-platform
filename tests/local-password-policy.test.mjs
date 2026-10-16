import assert from 'node:assert/strict';
import test from 'node:test';

import { validateLocalPasswordOnly } from '../scripts/lib/local-password-policy.mjs';
import { checkAdminIdentity } from '../scripts/lib/services-check-identity.mjs';
import { createServicesCheckContext } from '../scripts/lib/services-check-context.mjs';
import { dockerUpPlan, startDockerStack } from '../scripts/lib/docker-up.mjs';

const local = (overrides = {}) => ({
  NODE_ENV: 'production',
  FUNDING_PLATFORM_ENV: 'development',
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_KEYCLOAK_ENABLED: 'true',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.openg7.test',
  FUNDING_PUBLIC_BASE_URL: 'https://localhost',
  FUNDING_PLATFORM_API_BASE_URL: 'https://localhost/api',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.openg7.test/realms/openg7',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-local-client',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'c'.repeat(40),
  FUNDING_KEYCLOAK_DB_PASSWORD: 'd'.repeat(40),
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-bootstrap',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD: 'b'.repeat(40),
  FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY: 'true',
  ...overrides
});

test('password-only is opt-in and requires exact managed localhost development configuration', () => {
  assert.equal(validateLocalPasswordOnly({}), false);
  assert.equal(
    validateLocalPasswordOnly({
      FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY: 'false'
    }),
    false
  );
  assert.equal(validateLocalPasswordOnly(local()), true);
  assert.equal(
    validateLocalPasswordOnly(
      local({ FUNDING_PUBLIC_BASE_URL: 'https://localhost:8443' })
    ),
    true
  );
  for (const override of [
    { FUNDING_PLATFORM_ENV: undefined },
    { FUNDING_PLATFORM_ENV: 'test' },
    { FUNDING_PLATFORM_ENV: 'production' },
    { FUNDING_ADMIN_AUTH_MODE: 'token' },
    { FUNDING_KEYCLOAK_ENABLED: 'false' },
    { FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.org' },
    { FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.example.org/realms/openg7' },
    { FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.openg7.test/realms/openg7/' },
    { FUNDING_PUBLIC_BASE_URL: 'http://localhost' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost:0' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost/' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost.evil.test' },
    { FUNDING_PUBLIC_BASE_URL: 'https://127.0.0.1' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost#fragment' },
    { FUNDING_PUBLIC_BASE_URL: 'https://private-canary@localhost' },
    { FUNDING_PUBLIC_BASE_URL: 'https://private-canary@[' },
    { FUNDING_ADMIN_OIDC_MFA_ACR: 'pwd' },
    { COMPOSE_FILE: 'custom.yml' },
    ...['', 'TRUE', '1', 'yes', 'private-canary'].map((value) => ({
      FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY: value
    }))
  ])
    assert.throws(
      () => validateLocalPasswordOnly(local(override)),
      (error) => {
        assert.doesNotMatch(String(error.stack), /private-canary/);
        return true;
      }
    );
});

test('diagnostics report the local exception honestly and reject public targets', () => {
  const env = local();
  const context = createServicesCheckContext(env);
  checkAdminIdentity(context, env);
  const check = context.checks.find(
    (entry) => entry.label === 'FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY'
  );
  assert.equal(check.status, 'warn');
  assert.match(check.detail, /MFA is disabled/);
  const invalidEnv = local({ FUNDING_PLATFORM_ENV: 'production' });
  const invalid = createServicesCheckContext(invalidEnv);
  checkAdminIdentity(invalid, invalidEnv);
  assert.equal(invalid.checks[0].status, 'missing');
});

for (const value of ['true', 'false']) {
  test(`launcher reconciles explicit local password-only=${value} after identity and before application`, async () => {
    const plan = dockerUpPlan(
      {
        environment: 'local',
        authentication: 'keycloak',
        stripeWebhook: false
      },
      {
        env: local({ FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY: value }),
        localTls: true
      }
    );
    assert.equal(plan.localMfaConfigured, true);
    assert.ok(plan.identityUp.includes('keycloak'));
    const events = [];
    const run = (configureLocalMfa) =>
      startDockerStack(plan, {
        runDocker: async (args) =>
          events.push(
            args === plan.identityUp
              ? 'identity'
              : args.includes('up')
                ? 'application'
                : 'check/build'
          ),
        configureLocalMfa
      });
    await assert.rejects(run(undefined), /preparation hook/);
    assert.deepEqual(events, []);
    await run(async (env) => {
      assert.equal(env.FUNDING_ADMIN_OIDC_LOCAL_PASSWORD_ONLY, value);
      events.push('policy');
    });
    assert.deepEqual(events.slice(-3), ['identity', 'policy', 'application']);
    events.length = 0;
    await assert.rejects(
      run(async () => {
        throw new Error('synthetic policy failure');
      }),
      /synthetic policy failure/
    );
    assert.equal(events.includes('application'), false);
  });
}

test('launcher refuses the local exception in production and after selecting token', () => {
  for (const [environment, authentication] of [
    ['prod', 'keycloak'],
    ['local', 'token']
  ])
    assert.throws(() =>
      dockerUpPlan(
        { environment, authentication },
        { env: local(), localTls: true }
      )
    );
});
