import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { validateKeycloakConfig } from '../scripts/lib/keycloak-config.mjs';
import { dockerComposeFileArgs } from '../scripts/lib/docker-config.mjs';
import { dockerUpPlan } from '../scripts/lib/docker-up.mjs';
import {
  assertDockerUpdateTopology,
  dockerUpdatePlan
} from '../scripts/lib/docker-update.mjs';

const configured = {
  FUNDING_KEYCLOAK_ENABLED: 'true',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.test',
  FUNDING_PUBLIC_BASE_URL: 'https://fund.example.test',
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.example.test/realms/openg7',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'openg7-funding-admin',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-client-secret-' + 'c'.repeat(32),
  FUNDING_KEYCLOAK_DB_PASSWORD: 'synthetic-db-password-' + 'd'.repeat(32),
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'bootstrap-admin',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
    'synthetic-bootstrap-' + 'b'.repeat(32)
};
const processEnvironment = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  ComSpec: process.env.ComSpec
};

const fixtureDirectory = (t, purpose) => {
  const root = mkdtempSync(join(tmpdir(), `og7-keycloak-${purpose}-`));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith(`og7-keycloak-${purpose}-`));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
};

test('identity requires explicit activation; credentials alone never enable it', () => {
  assert.equal(validateKeycloakConfig({}), false);
  assert.equal(
    validateKeycloakConfig({
      ...configured,
      FUNDING_KEYCLOAK_ENABLED: 'false'
    }),
    false
  );
  assert.deepEqual(dockerComposeFileArgs({}), []);
  for (const value of ['', 'yes', 'TRUE', '1', 'private-canary']) {
    assert.throws(
      () => validateKeycloakConfig({ FUNDING_KEYCLOAK_ENABLED: value }),
      (error) => {
        assert.match(error.message, /FUNDING_KEYCLOAK_ENABLED/);
        assert.doesNotMatch(error.message, /private-canary/);
        return true;
      }
    );
  }
});

test('identity refuses absent secrets, reused credentials and unsafe or mismatched endpoints', () => {
  assert.equal(validateKeycloakConfig(configured), true);
  for (const name of [
    'FUNDING_KEYCLOAK_HOSTNAME',
    'FUNDING_PUBLIC_BASE_URL',
    'FUNDING_ADMIN_OIDC_ISSUER',
    'FUNDING_ADMIN_OIDC_CLIENT_ID',
    'FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME',
    'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
    'FUNDING_KEYCLOAK_DB_PASSWORD',
    'FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD'
  ]) {
    assert.throws(() => validateKeycloakConfig({ ...configured, [name]: '' }));
  }
  for (const override of [
    { FUNDING_KEYCLOAK_HOSTNAME: 'https://auth.example.test' },
    { FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.test/realm' },
    { FUNDING_KEYCLOAK_HOSTNAME: '*.example.test' },
    { FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.test` || Host(`evil.test' },
    { FUNDING_PUBLIC_BASE_URL: 'http://fund.example.test' },
    { FUNDING_PUBLIC_BASE_URL: 'https://fund.example.test/' },
    { FUNDING_PUBLIC_BASE_URL: 'https://fund.example.test/path' },
    { FUNDING_PUBLIC_BASE_URL: 'https://fund.example.test?private-canary' },
    { FUNDING_PUBLIC_BASE_URL: 'https://private-canary@fund.example.test' },
    { FUNDING_PUBLIC_BASE_URL: 'https://auth.example.test' },
    { FUNDING_ADMIN_OIDC_ISSUER: 'https://other.example.test/realms/openg7' },
    { FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.example.test/realms/master' },
    { FUNDING_ADMIN_AUTH_MODE: 'token' },
    { FUNDING_ADMIN_OIDC_MFA_ACR: '0' },
    { FUNDING_ADMIN_OIDC_MFA_ACR: '1' },
    { FUNDING_KEYCLOAK_DB_PASSWORD: 'private-canary' },
    {
      FUNDING_KEYCLOAK_DB_PASSWORD: configured.FUNDING_ADMIN_OIDC_CLIENT_SECRET
    }
  ]) {
    assert.throws(
      () => validateKeycloakConfig({ ...configured, ...override }),
      (error) => {
        assert.doesNotMatch(
          error.message,
          /private-canary|synthetic-client-secret/
        );
        return true;
      }
    );
  }
});

test('startup and update preserve identity topology through every Compose stage', () => {
  const production = {
    ...configured,
    FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.org',
    FUNDING_PUBLIC_BASE_URL: 'https://openg7.org',
    FUNDING_PLATFORM_API_BASE_URL: 'https://openg7.org/api',
    FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.example.org/realms/openg7',
    LETSENCRYPT_EMAIL: 'ops@example.org'
  };
  const up = dockerUpPlan(
    { environment: 'production', database: true, stripeWebhook: false },
    { env: production, localTls: false }
  );
  const update = dockerUpdatePlan(
    {
      targetEnvironment: 'production',
      useDatabase: true,
      buildAppFirst: false,
      pruneImages: false,
      startStripeWebhook: false
    },
    { env: production }
  );
  for (const args of [
    ...up.commands,
    ...update.commands.map((command) => command.args)
  ]) {
    assert.ok(args.includes('docker-compose.identity.yml'));
    assert.ok(args.includes('database'));
    assert.ok(!args.some((arg) => arg.includes('synthetic-')));
  }
  assert.deepEqual(dockerComposeFileArgs(configured, { localTls: true }), [
    '-f',
    'docker-compose.yml',
    '-f',
    'docker-compose.local-tls.yml',
    '-f',
    'docker-compose.identity.yml'
  ]);
  assert.throws(
    () => dockerComposeFileArgs({ ...configured, COMPOSE_FILE: 'custom.yml' }),
    /COMPOSE_FILE/
  );
  assert.deepEqual(
    dockerComposeFileArgs({ COMPOSE_FILE: 'custom.yml' }, { localTls: true }),
    []
  );
});

test('update refuses to orphan identity containers in any state before any mutation', async () => {
  const options = {
    targetEnvironment: 'production',
    useDatabase: false,
    buildAppFirst: true,
    pruneImages: false,
    startStripeWebhook: false
  };
  const plan = dockerUpdatePlan(options, {
    env: { FUNDING_KEYCLOAK_ENABLED: 'false' }
  });
  for (const services of ['keycloak\n', 'api\nidentity-postgres\n']) {
    await assert.rejects(
      assertDockerUpdateTopology(plan, {
        readComposeServices: async (args) => {
          assert.deepEqual(args.slice(-4), [
            'ps',
            '--all',
            '--services',
            '--orphans=true'
          ]);
          assert.ok(!args.includes('up'));
          return services;
        }
      }),
      /Identity containers exist/
    );
  }
  await assertDockerUpdateTopology(plan, {
    readComposeServices: async () => 'api\nweb\n'
  });
  await assert.rejects(
    assertDockerUpdateTopology(plan, {
      readComposeServices: async () => {
        throw new Error('read failed');
      }
    }),
    /read failed/
  );
  await assertDockerUpdateTopology(
    dockerUpdatePlan(options, {
      env: { ...configured, FUNDING_OPERATIONS_WATCHER_ENABLED: 'true' }
    }),
    {
      readComposeServices: () =>
        assert.fail(
          'Managed overlays already retain identity and operations services'
        )
    }
  );
});

test('configuration CLI loads an isolated env, respects shell overrides and never prints secrets', (t) => {
  const root = fixtureDirectory(t, 'check');
  mkdirSync(join(root, 'scripts/lib'), { recursive: true });
  for (const name of [
    'keycloak-config.mjs',
    'lib/keycloak-config.mjs',
    'lib/docker-environment.mjs'
  ]) {
    writeFileSync(
      join(root, 'scripts', name),
      readFileSync(join('scripts', name))
    );
  }
  writeFileSync(
    join(root, '.env'),
    Object.entries(configured)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n')
  );
  const run = (env = {}, args = ['--check']) =>
    spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      childProcess.spawnSync = (_command, commandArgs, options) => {
        if (commandArgs.join(' ') !== 'compose -f - config --format json') return { status: 9 };
        const requested = JSON.parse(options.input).services.configuration.environment;
        const values = { ...${JSON.stringify(configured)}, ...options.env };
        return { status: 0, stdout: JSON.stringify({ services: { configuration: { environment:
          Object.fromEntries(Object.keys(requested).map((name) => {
            if (name.startsWith('__OPENG7_PRESENT_')) return [name, Object.hasOwn(values, name.slice('__OPENG7_PRESENT_'.length)) ? '1' : ''];
            return [name, values[name] ?? ''];
          }))
        } } }) };
      };
      syncBuiltinESMExports();
      process.argv = [process.execPath, 'scripts/keycloak-config.mjs', ...${JSON.stringify(args)}];
      await import('./scripts/keycloak-config.mjs');
    `
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...processEnvironment, ...env }
      }
    );
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /configuration is valid/);
  const disabled = run({ FUNDING_KEYCLOAK_ENABLED: 'false' });
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.match(disabled.stdout, /disabled/);
  const invalid = run({ FUNDING_KEYCLOAK_DB_PASSWORD: 'private-canary' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /FUNDING_KEYCLOAK_DB_PASSWORD/);
  for (const result of [valid, disabled, invalid, run({}, ['--unknown'])])
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /synthetic-|private-canary/
    );
});

test('update CLI loads identity activation from its isolated .env before selecting Compose files', (t) => {
  const root = fixtureDirectory(t, 'update');
  mkdirSync(join(root, 'scripts/lib'), { recursive: true });
  for (const name of [
    'docker-update.mjs',
    'lib/docker-update.mjs',
    'lib/docker-config.mjs',
    'lib/keycloak-config.mjs',
    'lib/local-identity.mjs',
    'lib/docker-environment.mjs'
  ])
    writeFileSync(
      join(root, 'scripts', name),
      readFileSync(join('scripts', name))
    );
  writeFileSync(
    join(root, '.env'),
    Object.entries(configured)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n')
  );
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    childProcess.spawnSync = (_command, args, options) => {
      if (args.join(' ').includes('ps --all --services')) return { status: 0, stdout: '' };
      if (args.join(' ').includes('config --format json')) {
        const requested = JSON.parse(options.input).services.configuration.environment;
        const values = { ...${JSON.stringify(configured)}, ...options.env };
        return { status: 0, stdout: JSON.stringify({ services: { configuration: { environment:
          Object.fromEntries(Object.keys(requested).map((name) => {
            if (name.startsWith('__OPENG7_PRESENT_')) return [name, Object.hasOwn(values, name.slice('__OPENG7_PRESENT_'.length)) ? '1' : ''];
            return [name, values[name] ?? ''];
          }))
        } } }) };
      }
      if (!args.join(' ').includes('docker-compose.identity.yml')) return { status: 9 };
      console.log('identity-overlay-selected');
      return { status: 0 };
    };
    syncBuiltinESMExports();
    process.argv = [process.execPath, 'scripts/docker-update.mjs', '--production', '--no-database', '--no-build-app', '--no-prune-images'];
    await import('./scripts/docker-update.mjs');
  `
    ],
    { cwd: root, encoding: 'utf8', env: processEnvironment, windowsHide: true }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    (result.stdout.match(/identity-overlay-selected/g) ?? []).length,
    3
  );
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-/);
});

const composeAvailable =
  spawnSync('docker', ['compose', 'version'], {
    env: processEnvironment,
    encoding: 'utf8',
    windowsHide: true
  }).status === 0;

test(
  'rendered Compose isolates databases and secrets and never publishes identity ports',
  { skip: !composeAvailable },
  (t) => {
    const root = fixtureDirectory(t, 'compose');
    const envFile = join(root, '.env');
    writeFileSync(envFile, '');
    const args = [
      'compose',
      '--env-file',
      envFile,
      '-f',
      'docker-compose.yml',
      '-f',
      'docker-compose.operations.yml',
      '-f',
      'docker-compose.identity.yml',
      '--profile',
      'database'
    ];
    const env = { ...processEnvironment, ...configured };
    const quiet = spawnSync('docker', [...args, 'config', '--quiet'], {
      encoding: 'utf8',
      env,
      windowsHide: true
    });
    assert.equal(quiet.status, 0, quiet.stderr);
    assert.equal(quiet.stdout, '');
    // Fully synthetic settings only. Capture the rendered object; never log it.
    const rendered = spawnSync(
      'docker',
      [...args, 'config', '--format', 'json'],
      { encoding: 'utf8', env, windowsHide: true }
    );
    assert.equal(rendered.status, 0, rendered.stderr);
    const model = JSON.parse(rendered.stdout);
    const identity = model.services['identity-postgres'];
    const keycloak = model.services.keycloak;
    assert.deepEqual(Object.keys(identity.networks), ['identity-data']);
    assert.deepEqual(Object.keys(keycloak.networks).sort(), [
      'edge',
      'identity-data'
    ]);
    assert.equal(model.networks['identity-data'].internal, true);
    assert.equal(identity.ports, undefined);
    assert.equal(keycloak.ports, undefined);
    assert.equal(model.services.operations.ports, undefined);
    assert.deepEqual(Object.keys(model.services.operations.networks).sort(), [
      'data',
      'edge'
    ]);
    assert.equal(identity.volumes[0].source, 'identity-postgres-data');
    assert.notEqual(
      identity.volumes[0].source,
      model.services.postgres.volumes[0].source
    );
    assert.equal(
      identity.environment.POSTGRES_PASSWORD,
      keycloak.environment.KC_DB_PASSWORD
    );
    assert.equal(keycloak.environment.KC_HOSTNAME, 'https://auth.example.test');
    assert.equal(
      keycloak.depends_on['identity-postgres'].condition,
      'service_healthy'
    );
    assert.ok(!model.services.api.depends_on?.keycloak);
    assert.equal(Number(keycloak.mem_limit), 2 * 1024 ** 3);
    assert.equal(Number(identity.mem_limit), 512 * 1024 ** 2);
    for (const service of ['api', 'web', 'traefik', 'operations']) {
      assert.ok(
        !Object.keys(model.services[service].environment ?? {}).some((name) =>
          /KEYCLOAK_(DB_PASSWORD|BOOTSTRAP_ADMIN)/.test(name)
        )
      );
    }
    assert.equal(
      model.services.traefik.environment.FUNDING_KEYCLOAK_HOSTNAME,
      configured.FUNDING_KEYCLOAK_HOSTNAME
    );
    assert.ok(
      model.services.traefik.volumes.some(
        (volume) =>
          volume.target === '/etc/traefik/dynamic/keycloak.yml' &&
          volume.read_only
      )
    );
    const absent = spawnSync('docker', [...args, 'config', '--quiet'], {
      encoding: 'utf8',
      env: { ...env, FUNDING_KEYCLOAK_DB_PASSWORD: '' },
      windowsHide: true
    });
    assert.notEqual(absent.status, 0);
    assert.doesNotMatch(absent.stdout + absent.stderr, /synthetic-/);
  }
);
