import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  dockerUpPlan,
  parseDockerUpArgs,
  prepareDockerLocalIdentity,
  startDockerStack
} from '../scripts/lib/docker-up.mjs';
import { validateLocalIdentityCertificates } from '../scripts/lib/local-identity.mjs';
import { createLocalTlsFixture } from './support/local-tls-fixture.mjs';

const credentials = {
  FUNDING_ADMIN_OIDC_CLIENT_SECRET:
    'synthetic-auto-tls-client-' + 'c'.repeat(32),
  FUNDING_KEYCLOAK_DB_PASSWORD: 'synthetic-auto-tls-database-' + 'd'.repeat(32),
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
    'synthetic-auto-tls-bootstrap-' + 'b'.repeat(32)
};
const configuredEnvironment = () => ({
  ...credentials,
  FUNDING_PLATFORM_ENV: 'development',
  FUNDING_ADMIN_AUTH_MODE: 'token',
  FUNDING_KEYCLOAK_ENABLED: 'false',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.org',
  FUNDING_PUBLIC_BASE_URL: 'https://fund.example.org',
  FUNDING_PLATFORM_API_BASE_URL: 'https://fund.example.org/api',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://login.example.org/realms/external',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-auto-tls-client',
  FUNDING_ADMIN_OIDC_MFA_ACR: 'urn:fixture:external-mfa',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-existing-bootstrap',
  FUNDING_OPERATIONS_WATCHER_ENABLED: 'false',
  LETSENCRYPT_EMAIL: 'ops@example.org'
});
const localPlan = (environment = 'local', env = configuredEnvironment()) =>
  dockerUpPlan(
    parseDockerUpArgs([
      `--env=${environment}`,
      '--auth=keycloak',
      '--no-stripe-webhook'
    ]),
    { env, localTls: false }
  );
const noDocker = async (plan, dependencies, onDocker) => {
  await prepareDockerLocalIdentity(plan, dependencies);
  await startDockerStack(plan, {
    runDocker: onDocker,
    checkStripe: () => assert.fail('Stripe must be disabled'),
    listenStripe: () => assert.fail('Stripe must be disabled')
  });
};

test('local Keycloak aliases plan TLS preparation and its overlay even when certificates are absent', () => {
  for (const environment of ['local', 'dev', 'development']) {
    const env = Object.freeze(configuredEnvironment());
    const plan = localPlan(environment, env);
    assert.equal(plan.localIdentity, true);
    assert.equal(plan.authentication, 'keycloak');
    assert.equal(plan.commandEnv.FUNDING_PLATFORM_ENV, 'development');
    assert.ok(plan.commands[0].includes('docker-compose.local-tls.yml'));
    assert.ok(plan.commands[0].includes('docker-compose.identity.local.yml'));
    assert.deepEqual(env, configuredEnvironment());
  }
  const managed = localPlan().commandEnv;
  for (const authentication of [null, 'configured']) {
    const plan = dockerUpPlan(
      { environment: 'development', authentication, stripeWebhook: false },
      { env: managed, localTls: false }
    );
    assert.equal(plan.localIdentity, true);
  }
});

test('valid local certificates are retained and identity preparation is awaited before Docker', async () => {
  const plan = localPlan();
  const actions = [];
  await noDocker(
    plan,
    {
      checkCertificates: () => actions.push('check'),
      setupTls: () => assert.fail('Valid certificates must not be renewed'),
      prepareIdentity: async (env) => {
        assert.equal(env, plan.commandEnv);
        actions.push('prepare-start');
        await Promise.resolve();
        actions.push('prepare-finished');
      }
    },
    async () => actions.push('docker')
  );
  assert.deepEqual(actions, [
    'check',
    'prepare-start',
    'prepare-finished',
    'docker',
    'docker',
    'docker'
  ]);
});

test('absent or invalid certificates receive one setup and a successful recheck before preparation', async () => {
  for (const failure of ['missing certificate', 'invalid certificate']) {
    const plan = localPlan();
    const actions = [];
    let ready = false;
    await noDocker(
      plan,
      {
        checkCertificates: () => {
          actions.push('check');
          if (!ready) throw new Error(failure);
        },
        setupTls: async (env) => {
          assert.equal(env, plan.commandEnv);
          actions.push('setup');
          await Promise.resolve();
          ready = true;
        },
        prepareIdentity: async (env) => {
          assert.equal(env, plan.commandEnv);
          actions.push('prepare');
        }
      },
      async () => actions.push('docker')
    );
    assert.deepEqual(actions, [
      'check',
      'setup',
      'check',
      'prepare',
      'docker',
      'docker',
      'docker'
    ]);
  }
});

test('failed TLS setup stops before identity preparation or Docker', async () => {
  const actions = [];
  await assert.rejects(
    noDocker(
      localPlan(),
      {
        checkCertificates: () => {
          actions.push('check');
          throw new Error('missing certificate');
        },
        setupTls: async () => {
          actions.push('setup');
          throw new Error('synthetic TLS setup failed');
        },
        prepareIdentity: () =>
          assert.fail('Failed setup must not prepare identity')
      },
      () => assert.fail('Failed setup must not run Docker')
    ),
    /synthetic TLS setup failed/
  );
  assert.deepEqual(actions, ['check', 'setup']);
});

test('failed certificate recheck stops after one setup without retrying or running Docker', async () => {
  const actions = [];
  await assert.rejects(
    noDocker(
      localPlan(),
      {
        checkCertificates: () => {
          actions.push('check');
          throw new Error('certificate still invalid');
        },
        setupTls: async () => actions.push('setup'),
        prepareIdentity: () =>
          assert.fail('Invalid certificates must not prepare identity')
      },
      () => assert.fail('Invalid certificates must not run Docker')
    ),
    /certificate still invalid/
  );
  assert.deepEqual(actions, ['check', 'setup', 'check']);
});

test('identity preparation failure also prevents all Docker commands', async () => {
  await assert.rejects(
    noDocker(
      localPlan(),
      {
        checkCertificates: () => {},
        setupTls: () => assert.fail('Valid certificates must be retained'),
        prepareIdentity: async () => {
          throw new Error('synthetic identity preparation failed');
        }
      },
      () => assert.fail('Unprepared identity must not run Docker')
    ),
    /synthetic identity preparation failed/
  );
});

test('TLS preparation is a no-op for token, external OIDC and production providers', async () => {
  const env = { ...configuredEnvironment(), FUNDING_ADMIN_AUTH_MODE: 'oidc' };
  const cases = [
    { environment: 'development', authentication: 'token' },
    { environment: 'development', authentication: 'oidc' },
    { environment: 'production', authentication: 'oidc' },
    { environment: 'production', authentication: 'keycloak' },
    { environment: 'other', authentication: null }
  ];
  for (const options of cases) {
    const plan = dockerUpPlan(options, { env, localTls: false });
    assert.equal(plan.localIdentity, false);
    await prepareDockerLocalIdentity(plan, {
      checkCertificates: () =>
        assert.fail('Unrelated profiles must not inspect local TLS'),
      setupTls: () =>
        assert.fail('Unrelated profiles must not install local TLS'),
      prepareIdentity: () =>
        assert.fail('Unrelated profiles must not prepare local identity')
    });
  }
});

test('a local-identity marker cannot trigger TLS preparation outside development', async () => {
  for (const environment of ['production', 'other'])
    await prepareDockerLocalIdentity(
      { ...localPlan(), environment, localIdentity: true },
      {
        checkCertificates: () =>
          assert.fail('The environment guard must precede TLS inspection'),
        setupTls: () =>
          assert.fail('The environment guard must prevent TLS setup'),
        prepareIdentity: () =>
          assert.fail('The environment guard must prevent local preparation')
      }
    );
});

test('automatic TLS receives the selected identity configuration and preserves credentials and inputs', async () => {
  const input = Object.freeze({
    ...configuredEnvironment(),
    FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: ' existing-bootstrap ',
    FUNDING_ADMIN_OIDC_CLIENT_ID: ' existing-client ',
    COMPOSE_PROFILES: 'database,fixture-extra'
  });
  const original = { ...input };
  const plan = localPlan('dev', input);
  const selected = Object.freeze({ ...plan.commandEnv });
  let checks = 0;
  const received = [];
  await prepareDockerLocalIdentity(
    { ...plan, commandEnv: selected },
    {
      checkCertificates: () => {
        if (checks++ === 0) throw new Error('missing certificate');
      },
      setupTls: async (env) => received.push(env),
      prepareIdentity: async (env) => received.push(env)
    }
  );
  assert.equal(received.length, 2);
  for (const env of received) {
    assert.equal(env, selected);
    assert.equal(env.FUNDING_KEYCLOAK_HOSTNAME, 'auth.openg7.test');
    assert.equal(env.FUNDING_PUBLIC_BASE_URL, 'https://localhost');
    assert.equal(
      env.FUNDING_ADMIN_OIDC_ISSUER,
      'https://auth.openg7.test/realms/openg7'
    );
    assert.equal(env.FUNDING_ADMIN_OIDC_MFA_ACR, '');
    for (const name of [
      'FUNDING_ADMIN_OIDC_CLIENT_ID',
      'FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME',
      'COMPOSE_PROFILES',
      ...Object.keys(credentials)
    ])
      assert.equal(env[name], input[name]);
  }
  assert.deepEqual(input, original);
});

const hostEnv = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name]])
);
const composeAvailable =
  spawnSync('docker', ['compose', 'version'], {
    env: hostEnv,
    stdio: 'ignore',
    windowsHide: true,
    timeout: 10000
  }).status === 0;
const cliFixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'og7-docker-auto-tls-'));
  t.after(() => {
    const absolute = resolve(root);
    assert.equal(dirname(absolute), resolve(tmpdir()));
    assert.ok(basename(absolute).startsWith('og7-docker-auto-tls-'));
    rmSync(absolute, { recursive: true, force: true });
  });
  for (const file of [
    'scripts/docker-up.mjs',
    'scripts/lib/docker-up.mjs',
    'scripts/lib/docker-config.mjs',
    'scripts/lib/docker-environment.mjs',
    'scripts/lib/keycloak-config.mjs',
    'scripts/lib/production-identity.mjs',
    'scripts/lib/local-identity.mjs',
    'scripts/lib/services-check-context.mjs',
    'scripts/lib/services-check-identity.mjs',
    'tests/support/local-tls-fixture.mjs',
    'traefik/traefik.yml',
    'traefik/dynamic.yml',
    'traefik/keycloak.yml'
  ]) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(file));
  }
  const content =
    Object.entries(configuredEnvironment())
      .map(([name, value]) => `${name}='${value}'`)
      .join('\n') + '\n';
  writeFileSync(join(root, '.env'), content);
  writeFileSync(
    join(root, 'scripts/setup-local-tls.mjs'),
    `
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDockerConfiguration } from './lib/docker-environment.mjs';
import { createLocalTlsFixture } from '../tests/support/local-tls-fixture.mjs';
assert.deepEqual(process.argv.slice(2), ['--renew', '--no-restart']);
const configuration = readDockerConfiguration();
const expected = ${JSON.stringify(credentials)};
for (const [name, value] of Object.entries(expected)) assert.equal(configuration[name], value);
assert.equal(configuration.FUNDING_ADMIN_AUTH_MODE, 'oidc');
assert.equal(configuration.FUNDING_KEYCLOAK_ENABLED, 'true');
assert.equal(configuration.FUNDING_KEYCLOAK_HOSTNAME, 'auth.openg7.test');
assert.equal(configuration.FUNDING_ADMIN_OIDC_MFA_ACR, '');
appendFileSync('actions.jsonl', JSON.stringify({ action: 'setup' }) + '\\n');
const scenario = JSON.parse(readFileSync('scenario.json', 'utf8'));
if (scenario.setupFails) throw new Error('synthetic TLS setup failed');
if (scenario.setupInvalid) {
  mkdirSync('traefik/certs', { recursive: true });
  writeFileSync(join('traefik/certs', 'localhost.pem'), 'synthetic invalid certificate');
} else if (scenario.sameCa) {
  const openssl = ['openssl', ...(process.platform === 'win32' ? ['C:/Program Files/Git/usr/bin/openssl.exe'] : [])].find(
    (command) => spawnSync(command, ['version'], { stdio: 'ignore', windowsHide: true }).status === 0
  );
  assert.ok(openssl, 'OpenSSL is required for synthetic TLS renewal');
  writeFileSync('synthetic-ca/leaf.ext', 'basicConstraints=CA:FALSE\\nsubjectAltName=DNS:localhost,DNS:auth.openg7.test,IP:127.0.0.1,IP:::1\\n');
  const result = spawnSync(openssl, [
    'x509', '-req', '-days', '2', '-in', 'synthetic-ca/leaf.csr',
    '-CA', 'synthetic-ca/rootCA.pem', '-CAkey', 'synthetic-ca/synthetic-ca-key.pem',
    '-CAcreateserial', '-extfile', 'synthetic-ca/leaf.ext', '-out', 'traefik/certs/localhost.pem'
  ], { stdio: 'ignore', windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 0, 'Synthetic certificate renewal must succeed');
} else createLocalTlsFixture(process.cwd());
`
  );
  writeFileSync(
    join(root, 'scripts/docker-ready.mjs'),
    `
import assert from 'node:assert/strict';
import { appendFileSync, existsSync } from 'node:fs';
import { validateLocalIdentityCertificates } from './lib/local-identity.mjs';
assert.deepEqual(process.argv.slice(2, 4), ['--', 'docker']);
validateLocalIdentityCertificates(process.cwd());
assert.ok(existsSync('traefik/local/traefik.yml'));
assert.ok(existsSync('traefik/local/dynamic.yml'));
assert.ok(existsSync('traefik/local/keycloak.yml'));
appendFileSync('actions.jsonl', JSON.stringify({ action: 'docker', args: process.argv.slice(4) }) + '\\n');
`
  );
  return { root, content };
};
const runCli = (root, { dryRun = false } = {}) =>
  spawnSync(
    process.execPath,
    [
      join(root, 'scripts/docker-up.mjs'),
      '--env=dev',
      '--auth=keycloak',
      '--no-stripe-webhook',
      ...(dryRun ? ['--dry-run'] : [])
    ],
    {
      cwd: root,
      env: hostEnv,
      stdio: 'pipe',
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000
    }
  );
const actionsFor = (root) =>
  existsSync(join(root, 'actions.jsonl'))
    ? readFileSync(join(root, 'actions.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
const assertPrivateFilesPreserved = ({ root, content }, result) => {
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), content);
  for (const value of Object.values(credentials))
    assert.ok(
      !(result.stdout + result.stderr).includes(value),
      'CLI diagnostics must not disclose credentials'
    );
};

for (const scenario of ['valid', 'missing', 'invalid', 'sameCA'])
  test(
    `CLI ${scenario} certificates are preserved or prepared before the simulated Docker plan`,
    { skip: !composeAvailable },
    (t) => {
      const fixture = cliFixture(t);
      const { root } = fixture;
      writeFileSync(
        join(root, 'scenario.json'),
        JSON.stringify({ sameCa: scenario === 'sameCA' })
      );
      if (scenario !== 'missing')
        createLocalTlsFixture(
          root,
          scenario === 'valid' ? {} : { hosts: ['localhost'] }
        );
      const unchangedCa =
        scenario === 'sameCA'
          ? readFileSync(join(root, 'traefik/certs/rootCA.pem'), 'utf8')
          : null;
      const before =
        scenario === 'valid'
          ? ['localhost.pem', 'localhost-key.pem', 'rootCA.pem'].map((file) =>
              readFileSync(join(root, 'traefik/certs', file), 'utf8')
            )
          : null;
      const result = runCli(root);
      assert.equal(
        result.status,
        0,
        'The copied CLI must succeed without running real Docker or mkcert'
      );
      const actions = actionsFor(root);
      assert.deepEqual(
        actions.map(({ action }) => action),
        scenario === 'valid'
          ? ['docker', 'docker', 'docker']
          : scenario === 'sameCA'
            ? ['setup', 'docker', 'docker', 'docker']
            : ['setup', 'docker', 'docker', 'docker', 'docker']
      );
      const commands = actions
        .filter(({ action }) => action === 'docker')
        .map(({ args }) => args);
      assert.deepEqual(
        commands.map((args) =>
          args.includes('config')
            ? 'config'
            : args.includes('build')
              ? 'build'
              : args.includes('stop')
                ? 'stop'
                : 'up'
        ),
        scenario === 'valid' || scenario === 'sameCA'
          ? ['config', 'build', 'up']
          : ['config', 'build', 'stop', 'up']
      );
      const prefix = commands[0].slice(0, commands[0].indexOf('config'));
      for (const args of commands) {
        assert.ok(args.includes('docker-compose.local-tls.yml'));
        assert.ok(args.includes('docker-compose.identity.local.yml'));
        assert.ok(args.includes('--profile'));
        assert.ok(args.includes('database'));
        const actionIndex = args.findIndex((arg) =>
          ['config', 'build', 'stop', 'up'].includes(arg)
        );
        assert.deepEqual(args.slice(0, actionIndex), prefix);
        if (args.includes('stop'))
          assert.deepEqual(args.slice(actionIndex), ['stop', 'api']);
      }
      validateLocalIdentityCertificates(root);
      if (unchangedCa !== null)
        assert.equal(
          readFileSync(join(root, 'traefik/certs/rootCA.pem'), 'utf8'),
          unchangedCa
        );
      if (before)
        assert.deepEqual(
          ['localhost.pem', 'localhost-key.pem', 'rootCA.pem'].map((file) =>
            readFileSync(join(root, 'traefik/certs', file), 'utf8')
          ),
          before
        );
      assertPrivateFilesPreserved(fixture, result);
    }
  );

for (const scenario of ['setupFails', 'setupInvalid'])
  test(
    `CLI ${scenario} stops without identity files or a simulated Docker invocation`,
    { skip: !composeAvailable },
    (t) => {
      const fixture = cliFixture(t);
      writeFileSync(
        join(fixture.root, 'scenario.json'),
        JSON.stringify({ [scenario]: true })
      );
      const result = runCli(fixture.root);
      assert.equal(result.status, 1);
      assert.deepEqual(actionsFor(fixture.root), [{ action: 'setup' }]);
      assert.ok(!existsSync(join(fixture.root, 'traefik/local')));
      assertPrivateFilesPreserved(fixture, result);
    }
  );

test(
  'CLI dry run with missing certificates describes the local plan without preparing TLS or identity',
  { skip: !composeAvailable },
  (t) => {
    const fixture = cliFixture(t);
    const result = runCli(fixture.root, { dryRun: true });
    assert.equal(result.status, 0);
    assert.deepEqual(actionsFor(fixture.root), []);
    assert.ok(!existsSync(join(fixture.root, 'traefik/certs')));
    assert.ok(!existsSync(join(fixture.root, 'traefik/local')));
    assert.match(result.stdout, /setup-local-tls\.mjs --renew --no-restart/);
    assert.match(result.stdout, /prepare-local-identity\.mjs/);
    assert.match(result.stdout, /docker-compose\.local-tls\.yml/);
    assert.match(result.stdout, /docker-compose\.identity\.local\.yml/);
    assertPrivateFilesPreserved(fixture, result);
  }
);
