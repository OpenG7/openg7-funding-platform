import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dockerUpPlan,
  parseDockerUpArgs,
  startDockerStack
} from '../scripts/lib/docker-up.mjs';

const productionEnvironment = () => ({
  FUNDING_PLATFORM_ENV: 'production',
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_KEYCLOAK_ENABLED: 'false',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.org',
  FUNDING_PUBLIC_BASE_URL: 'https://openg7.org',
  FUNDING_PLATFORM_API_BASE_URL: 'https://openg7.org/api',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://login.example.org/realms/external',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-production-tls-client',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-client-' + 'c'.repeat(32),
  FUNDING_ADMIN_OIDC_MFA_ACR: 'urn:fixture:external-mfa',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-bootstrap',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
    'synthetic-bootstrap-' + 'b'.repeat(32),
  FUNDING_KEYCLOAK_DB_PASSWORD: 'synthetic-database-' + 'd'.repeat(32),
  FUNDING_OPERATIONS_WATCHER_ENABLED: 'false',
  LETSENCRYPT_EMAIL: 'ops@example.org'
});

const optionsFor = (extra = []) =>
  parseDockerUpArgs([
    '--env=prod',
    '--auth=keycloak',
    '--database',
    '--no-stripe-webhook',
    ...extra
  ]);
const planFor = (extra = [], env = productionEnvironment()) =>
  dockerUpPlan(optionsFor(extra), { env, localTls: true });
const composePrefix = (plan) => plan.commands[0].slice(0, -2);
const identityCommand = (plan) => [
  ...composePrefix(plan),
  'up',
  '-d',
  '--wait',
  '--wait-timeout',
  '180',
  'identity-postgres',
  'keycloak',
  'traefik'
];
const fullCommand = (plan) => [...composePrefix(plan), 'up', '-d', '--wait'];

// Every side effect is injected. No Docker, ACME file or provider is contacted.
const execution = (plan, { failureStage } = {}) => {
  const actions = [];
  const commands = [];
  const failure = new Error('Synthetic production readiness failure');
  const record = (stage) => {
    actions.push(stage);
    if (stage === failureStage) throw failure;
  };
  const dependencies = {
    runDocker: async (args, env) => {
      assert.equal(env, plan.commandEnv);
      commands.push([...args]);
      if (args.includes('config')) {
        assert.deepEqual(args, [...composePrefix(plan), 'config', '--quiet']);
        record('config');
      } else if (args.includes('build')) {
        record('build');
      } else if (args.includes('identity-postgres')) {
        assert.deepEqual(args, identityCommand(plan));
        record('identityUp');
      } else {
        assert.deepEqual(args, fullCommand(plan));
        record('fullUp');
      }
    },
    prepareProductionTls: async (env) => {
      assert.equal(env, plan.commandEnv);
      record('prepareTLS');
      await Promise.resolve();
      actions.push('prepareTLS-finished');
    },
    checkProductionIdentity: async (env) => {
      assert.equal(env, plan.commandEnv);
      record('checkHTTPS');
      await Promise.resolve();
      actions.push('checkHTTPS-finished');
    },
    checkStripe: () => assert.fail('This plan must not check Stripe'),
    listenStripe: () =>
      assert.fail('This plan must not start a Stripe listener')
  };
  return { actions, commands, failure, dependencies };
};

test('production identity plans retain the managed overlays and database profile without local TLS', () => {
  const configured = {
    ...productionEnvironment(),
    FUNDING_KEYCLOAK_ENABLED: 'true',
    FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.example.org/realms/openg7',
    FUNDING_ADMIN_OIDC_MFA_ACR: ''
  };
  for (const authentication of [null, 'configured', 'keycloak']) {
    const env = Object.freeze({ ...configured });
    const plan = dockerUpPlan(
      {
        environment: 'production',
        authentication,
        database: true,
        stripeWebhook: false
      },
      { env, localTls: true }
    );
    assert.equal(plan.productionIdentity, true);
    assert.equal(plan.localIdentity, false);
    assert.equal(plan.stripeWebhook, false);
    assert.deepEqual(composePrefix(plan), [
      'compose',
      '-f',
      'docker-compose.yml',
      '-f',
      'docker-compose.identity.yml',
      '--profile',
      'database'
    ]);
    assert.deepEqual(env, configured);
  }
});

test('production starts the application only after TLS preparation and public identity verification complete', async () => {
  const plan = planFor();
  const observed = execution(plan);
  await startDockerStack(plan, observed.dependencies);
  assert.deepEqual(observed.actions, [
    'config',
    'build',
    'prepareTLS',
    'prepareTLS-finished',
    'identityUp',
    'checkHTTPS',
    'checkHTTPS-finished',
    'fullUp'
  ]);
});

test('identity-only builds Keycloak and verifies HTTPS without starting the application', async () => {
  const plan = planFor(['--identity-only']);
  const observed = execution(plan);
  await startDockerStack(plan, observed.dependencies);
  assert.deepEqual(observed.actions, [
    'config',
    'build',
    'prepareTLS',
    'prepareTLS-finished',
    'identityUp',
    'checkHTTPS',
    'checkHTTPS-finished'
  ]);
  const build = observed.commands.find((args) => args.includes('build'));
  assert.ok(build.includes('keycloak'));
  assert.ok(!build.includes('api'));
  assert.ok(!build.includes('web'));
  assert.deepEqual(observed.commands.at(-1), identityCommand(plan));
});

const completeActions = [
  'config',
  'build',
  'prepareTLS',
  'prepareTLS-finished',
  'identityUp',
  'checkHTTPS',
  'checkHTTPS-finished',
  'fullUp'
];
for (const stage of [
  'config',
  'build',
  'prepareTLS',
  'identityUp',
  'checkHTTPS'
])
  test(`production failure at ${stage} prevents every later stage and application startup`, async () => {
    const plan = planFor();
    const observed = execution(plan, { failureStage: stage });
    await assert.rejects(
      startDockerStack(plan, observed.dependencies),
      (error) => error === observed.failure
    );
    assert.deepEqual(
      observed.actions,
      completeActions.slice(0, completeActions.indexOf(stage) + 1)
    );
    assert.ok(!observed.actions.includes('fullUp'));
  });

test('identity-only still fails when public HTTPS verification fails', async () => {
  const plan = planFor(['--identity-only']);
  const observed = execution(plan, { failureStage: 'checkHTTPS' });
  await assert.rejects(
    startDockerStack(plan, observed.dependencies),
    (error) => error === observed.failure
  );
  assert.deepEqual(observed.actions, [
    'config',
    'build',
    'prepareTLS',
    'prepareTLS-finished',
    'identityUp',
    'checkHTTPS'
  ]);
});

for (const missingHook of ['prepareProductionTls', 'checkProductionIdentity'])
  test(`production refuses a missing ${missingHook} hook before Docker execution`, async () => {
    const plan = planFor();
    const observed = execution(plan);
    delete observed.dependencies[missingHook];
    await assert.rejects(
      startDockerStack(plan, observed.dependencies),
      /ACME and HTTPS checks/
    );
    assert.deepEqual(observed.actions, []);
    assert.deepEqual(observed.commands, []);
  });

for (const [environment, authentication] of [
  ['production', 'oidc'],
  ['production', 'configured'],
  ['local', 'keycloak'],
  ['local', 'token']
])
  test(`${environment} ${authentication} keeps the existing Docker flow without production TLS effects`, async () => {
    const plan = dockerUpPlan(
      parseDockerUpArgs([
        `--env=${environment}`,
        `--auth=${authentication}`,
        '--no-stripe-webhook'
      ]),
      { env: productionEnvironment(), localTls: true }
    );
    assert.equal(plan.productionIdentity, false);
    const calls = [];
    await startDockerStack(plan, {
      runDocker: async (args, env) => {
        assert.equal(env, plan.commandEnv);
        calls.push([...args]);
      },
      prepareProductionTls: () =>
        assert.fail('This plan must not prepare production TLS'),
      checkProductionIdentity: () =>
        assert.fail('This plan must not contact a production provider'),
      checkStripe: () => assert.fail('Stripe was explicitly disabled'),
      listenStripe: () => assert.fail('Stripe was explicitly disabled')
    });
    assert.deepEqual(calls, plan.commands);
    assert.equal(calls.length, 3);
  });

test('identity-only is refused outside production managed Keycloak', () => {
  for (const [environment, authentication] of [
    ['local', 'keycloak'],
    ['local', 'token'],
    ['production', 'oidc'],
    ['production', 'configured'],
    ['other', null]
  ])
    assert.throws(
      () =>
        dockerUpPlan(
          parseDockerUpArgs([
            `--env=${environment}`,
            ...(authentication ? [`--auth=${authentication}`] : []),
            '--identity-only',
            '--no-stripe-webhook'
          ]),
          { env: productionEnvironment(), localTls: true }
        ),
      /identity-only/
    );
});

for (const [description, email] of [
  ['missing', undefined],
  ['empty', ''],
  ['invalid', 'not-an-email'],
  ['placeholder', 'admin@example.com']
])
  test(`production identity refuses ${description} ACME email before execution`, () => {
    assert.throws(
      () =>
        planFor([], {
          ...productionEnvironment(),
          LETSENCRYPT_EMAIL: email
        }),
      /LETSENCRYPT_EMAIL/
    );
  });
