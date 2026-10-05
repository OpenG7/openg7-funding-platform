import assert from 'node:assert/strict';
import test from 'node:test';
import { dockerComposeFileArgs } from '../scripts/lib/docker-config.mjs';
import { dockerUpPlan, startDockerStack } from '../scripts/lib/docker-up.mjs';
import {
  assertDockerUpdateTopology,
  dockerUpdatePlan,
  executeDockerUpdate
} from '../scripts/lib/docker-update.mjs';

const identityEnvironment = {
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.test',
  FUNDING_PUBLIC_BASE_URL: 'https://fund.example.test',
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.example.test/realms/openg7',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'openg7-funding-admin',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-client-' + 'c'.repeat(32),
  FUNDING_KEYCLOAK_DB_PASSWORD: 'synthetic-database-' + 'd'.repeat(32),
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'bootstrap-admin',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
    'synthetic-bootstrap-' + 'b'.repeat(32)
};
const environment = (identity, operations) => ({
  ...identityEnvironment,
  FUNDING_KEYCLOAK_ENABLED: String(identity),
  FUNDING_OPERATIONS_WATCHER_ENABLED: String(operations)
});
const updateOptions = {
  targetEnvironment: 'production',
  useDatabase: true,
  buildAppFirst: false,
  pruneImages: false,
  startStripeWebhook: false
};

test('Compose selection preserves every combination of managed overlays', () => {
  const base = 'docker-compose.yml';
  const tls = 'docker-compose.local-tls.yml';
  const operations = 'docker-compose.operations.yml';
  const identity = 'docker-compose.identity.yml';
  const cases = [
    [false, false, false, []],
    [false, false, true, [base, tls]],
    [false, true, false, [base, operations]],
    [false, true, true, [base, tls, operations]],
    [true, false, false, [base, identity]],
    [true, false, true, [base, tls, identity]],
    [true, true, false, [base, operations, identity]],
    [true, true, true, [base, tls, operations, identity]]
  ];
  for (const [hasIdentity, hasOperations, localTls, files] of cases) {
    assert.deepEqual(
      dockerComposeFileArgs(environment(hasIdentity, hasOperations), {
        localTls
      }),
      files.flatMap((file) => ['-f', file])
    );
  }
});

test('custom Compose files retain precedence and managed switches reject invalid values', () => {
  for (const operations of [false, true]) {
    assert.deepEqual(
      dockerComposeFileArgs(
        { ...environment(false, operations), COMPOSE_FILE: 'custom.yml' },
        { localTls: true }
      ),
      []
    );
    assert.throws(
      () =>
        dockerComposeFileArgs({
          ...environment(true, operations),
          COMPOSE_FILE: 'custom.yml'
        }),
      /COMPOSE_FILE/
    );
  }
  assert.deepEqual(
    dockerComposeFileArgs({ FUNDING_OPERATIONS_WATCHER_ENABLED: '' }),
    []
  );
  for (const name of [
    'FUNDING_KEYCLOAK_ENABLED',
    'FUNDING_OPERATIONS_WATCHER_ENABLED'
  ]) {
    for (const value of [
      ...(name === 'FUNDING_KEYCLOAK_ENABLED' ? [''] : []),
      'TRUE',
      'yes',
      '1',
      'private-canary'
    ]) {
      const env = { ...environment(false, false), [name]: value };
      for (const plan of [
        () => dockerComposeFileArgs(env),
        () =>
          dockerUpPlan(
            { environment: 'production', stripeWebhook: false },
            { env }
          ),
        () => dockerUpdatePlan(updateOptions, { env })
      ]) {
        assert.throws(plan, (error) => {
          assert.ok(error.message.includes(name));
          assert.doesNotMatch(error.message, /private-canary/);
          return true;
        });
      }
    }
  }
});

test('startup and update pass the combined overlays to every Docker command', async () => {
  const env = environment(true, true);
  const up = dockerUpPlan(
    { environment: 'development', database: true, stripeWebhook: false },
    { env, localTls: true }
  );
  const update = dockerUpdatePlan(updateOptions, { env });
  const invocations = [];
  await startDockerStack(up, {
    runDocker: async (args, commandEnv) =>
      invocations.push({ phase: 'up', args, commandEnv }),
    checkStripe: () => assert.fail('Stripe is disabled'),
    listenStripe: () => assert.fail('Stripe is disabled')
  });
  await assertDockerUpdateTopology(update, {
    readComposeServices: () =>
      assert.fail('Both managed overlays retain their containers')
  });
  await executeDockerUpdate(update, {
    runCommand: async (command, args, commandEnv) => {
      assert.equal(command, 'docker');
      invocations.push({ phase: 'update', args, commandEnv });
    }
  });
  assert.equal(invocations.length, 6);
  for (const { phase, args, commandEnv } of invocations) {
    assert.ok(args.includes('docker-compose.operations.yml'));
    assert.ok(args.includes('docker-compose.identity.yml'));
    assert.ok(args.includes('database'));
    assert.equal(args.includes('docker-compose.local-tls.yml'), phase === 'up');
    assert.equal(commandEnv.FUNDING_OPERATIONS_WATCHER_ENABLED, 'true');
    assert.ok(!args.some((arg) => arg.includes('synthetic-')));
  }
});

test('update refuses to remove an omitted operations worker before any mutation', async () => {
  for (const identity of [false, true]) {
    const plan = dockerUpdatePlan(updateOptions, {
      env: environment(identity, false)
    });
    const mutations = [];
    await assert.rejects(async () => {
      await assertDockerUpdateTopology(plan, {
        readComposeServices: async (args) => {
          assert.deepEqual(args.slice(-4), [
            'ps',
            '--all',
            '--services',
            '--orphans=true'
          ]);
          return 'api\nweb\noperations\n';
        }
      });
      await executeDockerUpdate(plan, {
        runCommand: async (...args) => mutations.push(args)
      });
    }, /Operations containers exist/);
    assert.deepEqual(mutations, []);
  }
});

test('custom Compose configurations protect included workers without a managed opt-in', async () => {
  for (const enabled of [false, true]) {
    const env = { ...environment(false, enabled), COMPOSE_FILE: 'custom.yml' };
    const plan = dockerUpdatePlan(updateOptions, { env });
    for (const configured of ['api\nweb\noperations\n', 'api\nweb\n']) {
      const queries = [];
      const check = () =>
        assertDockerUpdateTopology(plan, {
          readComposeServices: async (args, commandEnv) => {
            queries.push(args);
            assert.equal(commandEnv.COMPOSE_FILE, 'custom.yml');
            assert.ok(!args.includes('-f'));
            if (args.includes('ps')) return 'operations\n';
            assert.deepEqual(args.slice(-2), ['config', '--services']);
            return configured;
          }
        });
      if (configured.includes('operations')) await check();
      else await assert.rejects(check, /Operations containers exist/);
      assert.equal(queries.length, 2);
    }
  }
});
