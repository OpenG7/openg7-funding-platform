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
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  dockerCommandEnvironment,
  readDockerConfiguration
} from '../scripts/lib/docker-environment.mjs';
import {
  chooseDockerAuthentication,
  dockerUpPlan,
  normalizeDockerAuthentication,
  parseDockerUpArgs,
  startDockerStack
} from '../scripts/lib/docker-up.mjs';

const privateValues = {
  FUNDING_ADMIN_TOKEN: 'synthetic-token-canary-' + 'a'.repeat(32),
  FUNDING_ADMIN_SESSION_SECRET: 'synthetic-session-canary-' + 'b'.repeat(32),
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-oidc-$literal-' + 'c'.repeat(32),
  FUNDING_KEYCLOAK_DB_PASSWORD: 'synthetic-database-canary-' + 'd'.repeat(32),
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
    'synthetic-bootstrap-canary-' + 'e'.repeat(32)
};
const configuredEnvironment = () => ({
  ...privateValues,
  FUNDING_PLATFORM_ENV: 'development',
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_KEYCLOAK_ENABLED: 'false',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.configured.example.test',
  FUNDING_PUBLIC_BASE_URL: 'https://fund.configured.example.test',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://login.example.test/realms/external',
  FUNDING_ADMIN_OIDC_MFA_ACR: 'urn:fixture:external-mfa',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'existing-fixture-client',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'existing-bootstrap',
  FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: 'fixture-existing-owner',
  FUNDING_OPERATIONS_WATCHER_ENABLED: 'false'
});
const planFor = (
  authentication,
  env = configuredEnvironment(),
  localTls = true
) =>
  dockerUpPlan(
    parseDockerUpArgs([
      '--environment=local',
      `--auth=${authentication}`,
      '--no-stripe-webhook'
    ]),
    { env, localTls }
  );
const assertNoPrivateValues = (text) => {
  for (const value of Object.values(privateValues))
    assert.ok(
      !text.includes(value),
      'Diagnostics must not contain credentials'
    );
};
const hostEnv = Object.fromEntries(
  [
    'PATH',
    'Path',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'APPDATA'
  ]
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name]])
);
const composeVersion = spawnSync('docker', ['compose', 'version', '--short'], {
  cwd: tmpdir(),
  env: hostEnv,
  stdio: 'pipe',
  encoding: 'utf8',
  windowsHide: true,
  timeout: 10000
});
const version = composeVersion.stdout?.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
const composeAvailable = composeVersion.status === 0 && Boolean(version);
const supportsLocalOverlay =
  composeAvailable &&
  (Number(version[1]) > 2 ||
    (Number(version[1]) === 2 &&
      (Number(version[2]) > 24 ||
        (Number(version[2]) === 24 && Number(version[3]) >= 4))));
const temporaryFixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'og7-docker-authentication-'));
  t.after(() => {
    const absolute = resolve(root);
    assert.equal(dirname(absolute), resolve(tmpdir()));
    assert.ok(
      absolute.startsWith(join(tmpdir(), 'og7-docker-authentication-'))
    );
    rmSync(absolute, { recursive: true, force: true });
  });
  return root;
};
const writeEnvironment = (root, env) => {
  const content =
    Object.entries(env)
      .map(([name, value]) => `${name}='${value}'`)
      .join('\n') + '\n';
  writeFileSync(join(root, '.env'), content);
  return content;
};

test('authentication flags accept both forms and reject missing, unknown or conflicting choices', () => {
  for (const authentication of ['token', 'keycloak', 'oidc', 'configured']) {
    assert.equal(
      normalizeDockerAuthentication(` ${authentication.toUpperCase()} `),
      authentication
    );
    for (const flags of [
      ['--auth', authentication],
      [`--auth=${authentication}`],
      ['--auth', authentication, `--auth=${authentication}`]
    ]) {
      const args = Object.freeze(['--env=dev', ...flags]);
      assert.equal(parseDockerUpArgs(args).authentication, authentication);
      assert.deepEqual(args, ['--env=dev', ...flags]);
    }
  }
  for (const args of [
    ['--auth'],
    ['--auth='],
    ['--auth', '--database'],
    ['--auth=external'],
    ['--auth=toString'],
    ['--auth=token', '--auth=keycloak'],
    ['--auth=configured', '--auth', 'token'],
    ['--auth=oidc', '--auth=keycloak']
  ])
    assert.throws(() => parseDockerUpArgs(args), /invalide|seul/);
});

test('Enter preserves configured external OIDC rather than selecting a local provider', async () => {
  const env = Object.freeze(configuredEnvironment());
  const options = Object.freeze(parseDockerUpArgs(['--env=local']));
  const questions = [];
  const authentication = await chooseDockerAuthentication(options, {
    env,
    interactive: true,
    ask: async (question) => {
      questions.push(question);
      return '   ';
    }
  });
  assert.equal(authentication, 'configured');
  assert.equal(questions.length, 1);
  assert.match(questions[0], /conserver OIDC/);
  assertNoPrivateValues(questions[0]);
  const plan = dockerUpPlan(
    { ...options, authentication },
    { env, localTls: true }
  );
  assert.equal(plan.authentication, 'oidc');
  for (const name of Object.keys(env).filter((name) =>
    /AUTH|OIDC|KEYCLOAK/.test(name)
  ))
    assert.equal(plan.commandEnv[name], env[name]);
  assert.equal(
    plan.commandEnv.FUNDING_PUBLIC_BASE_URL,
    env.FUNDING_PUBLIC_BASE_URL
  );
  assert.ok(!plan.commands[0].includes('docker-compose.identity.yml'));
  assert.deepEqual(env, configuredEnvironment());
  assert.equal(options.authentication, null);
});

test('authentication prompts retry invalid input without echoing it or credentials', async () => {
  const invalidInput = privateValues.FUNDING_ADMIN_TOKEN;
  const answers = [invalidInput, ' KEYCLOAK '];
  const questions = [];
  assert.equal(
    await chooseDockerAuthentication(
      { environment: 'development' },
      {
        env: configuredEnvironment(),
        interactive: true,
        ask: async (question) => {
          questions.push(question);
          return answers.shift();
        }
      }
    ),
    'keycloak'
  );
  assert.equal(questions.length, 2);
  assertNoPrivateValues(questions.join('\n'));
  assert.throws(
    () => parseDockerUpArgs(['--auth', invalidInput]),
    (error) => {
      assertNoPrivateValues(error.message);
      return /invalide/.test(error.message);
    }
  );
});

test('explicit choices, dry runs and unattended runs never ask for authentication', async () => {
  for (const options of [
    ...['token', 'keycloak', 'oidc', 'configured'].map((authentication) => ({
      environment: 'development',
      authentication
    })),
    { environment: 'development', dryRun: true },
    { environment: 'production', dryRun: true },
    { environment: 'other' }
  ])
    assert.equal(
      await chooseDockerAuthentication(options, {
        env: configuredEnvironment(),
        interactive: true,
        ask: () => assert.fail('This invocation must not prompt')
      }),
      options.authentication ?? null
    );
  assert.equal(
    await chooseDockerAuthentication(
      { environment: 'development' },
      {
        env: configuredEnvironment(),
        interactive: false,
        ask: () => assert.fail('Unattended invocation must not prompt')
      }
    ),
    null
  );
});

test('token selection disables managed Keycloak without changing credentials or its input', () => {
  const env = Object.freeze(planFor('keycloak').commandEnv);
  const original = { ...env };
  const plan = planFor('token', env);
  assert.equal(plan.authentication, 'token');
  assert.equal(plan.commandEnv.FUNDING_ADMIN_AUTH_MODE, 'token');
  assert.equal(plan.commandEnv.FUNDING_KEYCLOAK_ENABLED, 'false');
  for (const file of [
    'docker-compose.identity.yml',
    'docker-compose.identity.local.yml'
  ])
    assert.ok(!plan.commands[0].includes(file));
  for (const [name, value] of Object.entries(privateValues))
    assert.equal(plan.commandEnv[name], value);
  assert.deepEqual(env, original);
  assertNoPrivateValues(plan.commands.map((args) => args.join(' ')).join('\n'));
});

test('external OIDC selection retains provider settings and disables the managed local provider', () => {
  const env = Object.freeze({
    ...configuredEnvironment(),
    FUNDING_KEYCLOAK_ENABLED: 'true'
  });
  const original = { ...env };
  const plan = planFor('oidc', env, false);
  assert.equal(plan.authentication, 'oidc');
  assert.equal(plan.commandEnv.FUNDING_ADMIN_AUTH_MODE, 'oidc');
  assert.equal(plan.commandEnv.FUNDING_KEYCLOAK_ENABLED, 'false');
  for (const name of [
    'FUNDING_ADMIN_OIDC_ISSUER',
    'FUNDING_ADMIN_OIDC_CLIENT_ID',
    'FUNDING_ADMIN_OIDC_MFA_ACR',
    'FUNDING_PUBLIC_BASE_URL',
    'FUNDING_KEYCLOAK_HOSTNAME',
    ...Object.keys(privateValues)
  ])
    assert.equal(plan.commandEnv[name], env[name]);
  assert.ok(!plan.commands[0].includes('docker-compose.identity.yml'));
  assert.ok(!plan.commands[0].includes('docker-compose.identity.local.yml'));
  assert.deepEqual(env, original);
});

test('Keycloak selection overrides only its local routing and retains existing identity credentials', () => {
  const env = Object.freeze(configuredEnvironment());
  const plan = planFor('keycloak', env);
  assert.equal(plan.authentication, 'keycloak');
  assert.equal(plan.commandEnv.FUNDING_PLATFORM_ENV, 'development');
  assert.equal(plan.commandEnv.FUNDING_ADMIN_AUTH_MODE, 'oidc');
  assert.equal(plan.commandEnv.FUNDING_KEYCLOAK_ENABLED, 'true');
  assert.equal(plan.commandEnv.FUNDING_KEYCLOAK_HOSTNAME, 'auth.openg7.test');
  assert.equal(plan.commandEnv.FUNDING_PUBLIC_BASE_URL, 'https://localhost');
  assert.equal(
    plan.commandEnv.FUNDING_ADMIN_OIDC_ISSUER,
    'https://auth.openg7.test/realms/openg7'
  );
  assert.equal(plan.commandEnv.FUNDING_ADMIN_OIDC_MFA_ACR, '');
  for (const name of [
    'FUNDING_ADMIN_OIDC_CLIENT_ID',
    'FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME',
    'FUNDING_ADMIN_OIDC_OWNER_SUBJECTS',
    ...Object.keys(privateValues)
  ])
    assert.equal(plan.commandEnv[name], env[name]);
  assert.ok(plan.commands[0].includes('docker-compose.identity.local.yml'));
  assert.deepEqual(env, configuredEnvironment());
  assertNoPrivateValues(plan.commands.map((args) => args.join(' ')).join('\n'));
  const defaults = planFor('keycloak', {
    ...env,
    FUNDING_ADMIN_OIDC_CLIENT_ID: ' ',
    FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: ''
  });
  assert.equal(
    defaults.commandEnv.FUNDING_ADMIN_OIDC_CLIENT_ID,
    'openg7-funding-admin'
  );
  assert.equal(
    defaults.commandEnv.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME,
    'keycloak-local-bootstrap'
  );
  const existingNames = {
    ...env,
    FUNDING_ADMIN_OIDC_CLIENT_ID: ' existing-fixture-client ',
    FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: ' existing-bootstrap '
  };
  const existing = planFor('keycloak', existingNames);
  for (const name of [
    'FUNDING_ADMIN_OIDC_CLIENT_ID',
    'FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME'
  ])
    assert.equal(existing.commandEnv[name], existingNames[name]);
});

test('other environments reject every explicit authentication choice', () => {
  for (const environment of ['autre', 'other'])
    for (const authentication of ['token', 'keycloak', 'oidc', 'configured'])
      assert.throws(
        () =>
          dockerUpPlan(
            parseDockerUpArgs([
              `--env=${environment}`,
              `--auth=${authentication}`
            ]),
            { env: configuredEnvironment(), localTls: true }
          ),
        /local\/dev/
      );
});

test('missing credentials and custom Compose prevent execution before any effect', async () => {
  const failures = [
    ...[
      'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
      'FUNDING_KEYCLOAK_DB_PASSWORD',
      'FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD'
    ].map((name) => ({
      env: { ...configuredEnvironment(), [name]: '' },
      localTls: true,
      authentication: 'keycloak',
      expected: /at least 32/
    })),
    ...['token', 'keycloak', 'oidc'].map((authentication) => ({
      env: { ...configuredEnvironment(), COMPOSE_FILE: 'fixed-auth.yml' },
      localTls: true,
      authentication,
      expected: /COMPOSE_FILE/
    }))
  ];
  for (const failure of failures) {
    let effects = 0;
    const effect = async () => {
      effects++;
    };
    await assert.rejects(
      async () => {
        const plan = planFor(
          failure.authentication,
          failure.env,
          failure.localTls
        );
        await startDockerStack(plan, {
          runDocker: effect,
          checkStripe: effect,
          listenStripe: effect
        });
      },
      (error) => {
        assert.match(error.message, failure.expected);
        assertNoPrivateValues(error.message);
        return true;
      }
    );
    assert.equal(effects, 0);
  }
  const custom = planFor('configured', {
    ...configuredEnvironment(),
    COMPOSE_FILE: 'fixed-auth.yml'
  });
  assert.equal(custom.commandEnv.COMPOSE_FILE, 'fixed-auth.yml');
  assert.equal(custom.authentication, 'oidc');
  assert.ok(!custom.commands[0].includes('-f'));
});

test('runtime child overrides replace conflicting shell auth and explicitly clear external MFA', () => {
  const shell = Object.freeze({
    ...hostEnv,
    ...configuredEnvironment(),
    FUNDING_PLATFORM_ENV: 'production',
    FUNDING_ADMIN_AUTH_MODE: 'token',
    UNRELATED_SETTING: 'keep-shell-setting'
  });
  const configuration = Object.freeze({ ...shell });
  const plan = planFor('keycloak', configuration);
  const command = dockerCommandEnvironment(
    plan.commandEnv,
    configuration,
    shell
  );
  for (const name of [
    'FUNDING_PLATFORM_ENV',
    'FUNDING_ADMIN_AUTH_MODE',
    'FUNDING_KEYCLOAK_ENABLED',
    'FUNDING_KEYCLOAK_HOSTNAME',
    'FUNDING_PUBLIC_BASE_URL',
    'FUNDING_ADMIN_OIDC_ISSUER',
    'FUNDING_ADMIN_OIDC_MFA_ACR'
  ])
    assert.equal(command[name], plan.commandEnv[name]);
  assert.ok(Object.hasOwn(command, 'FUNDING_ADMIN_OIDC_MFA_ACR'));
  assert.equal(command.FUNDING_ADMIN_OIDC_MFA_ACR, '');
  assert.equal(command.UNRELATED_SETTING, 'keep-shell-setting');
  for (const [name, value] of Object.entries(privateValues))
    assert.equal(command[name], value);
  assert.equal(shell.FUNDING_ADMIN_AUTH_MODE, 'token');
  assert.equal(
    configuration.FUNDING_ADMIN_OIDC_MFA_ACR,
    'urn:fixture:external-mfa'
  );
  const tokenPlan = planFor('token', plan.commandEnv);
  const tokenChild = dockerCommandEnvironment(
    tokenPlan.commandEnv,
    plan.commandEnv,
    { ...plan.commandEnv }
  );
  assert.equal(tokenChild.FUNDING_ADMIN_AUTH_MODE, 'token');
  assert.equal(tokenChild.FUNDING_KEYCLOAK_ENABLED, 'false');
});

test(
  'canonical Compose resolves chosen authentication and preserves dotenv credentials without a daemon',
  { skip: !supportsLocalOverlay },
  (t) => {
    const root = temporaryFixture(t);
    for (const file of [
      'docker-compose.yml',
      'docker-compose.local-tls.yml',
      'docker-compose.identity.yml',
      'docker-compose.identity.local.yml'
    ])
      writeFileSync(join(root, file), readFileSync(file));
    const content = writeEnvironment(root, configuredEnvironment());
    const shell = {
      ...hostEnv,
      COMPOSE_PROJECT_NAME: 'og7-docker-authentication-test',
      FUNDING_ADMIN_AUTH_MODE: 'token',
      FUNDING_ADMIN_OIDC_MFA_ACR: 'urn:fixture:shell-mfa'
    };
    const configuration = readDockerConfiguration({ env: shell, cwd: root });
    for (const authentication of ['token', 'keycloak', 'oidc']) {
      const plan = planFor(authentication, configuration);
      const result = spawnSync(
        'docker',
        [...plan.commands[0].slice(0, -1), '--format', 'json'],
        {
          cwd: root,
          env: dockerCommandEnvironment(plan.commandEnv, configuration, shell),
          stdio: 'pipe',
          encoding: 'utf8',
          windowsHide: true,
          timeout: 15000
        }
      );
      assert.equal(
        result.status,
        0,
        'Synthetic Compose model must resolve without starting services'
      );
      const services = JSON.parse(result.stdout).services;
      assert.equal(
        services.api.environment.FUNDING_ADMIN_AUTH_MODE,
        authentication === 'token' ? 'token' : 'oidc'
      );
      assert.equal(
        services.api.environment.FUNDING_ADMIN_OIDC_CLIENT_SECRET.replaceAll(
          '$$',
          '$'
        ),
        privateValues.FUNDING_ADMIN_OIDC_CLIENT_SECRET
      );
      assert.equal(Boolean(services.keycloak), authentication === 'keycloak');
      if (authentication === 'keycloak') {
        assert.equal(services.api.environment.FUNDING_ADMIN_OIDC_MFA_ACR, '');
        assert.equal(
          services.api.environment.FUNDING_ADMIN_OIDC_ISSUER,
          'https://auth.openg7.test/realms/openg7'
        );
        assert.equal(
          services.keycloak.environment.KC_DB_PASSWORD,
          privateValues.FUNDING_KEYCLOAK_DB_PASSWORD
        );
        assert.equal(
          services.keycloak.environment.KC_BOOTSTRAP_ADMIN_PASSWORD,
          privateValues.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD
        );
        assert.equal(
          services['identity-postgres'].environment.POSTGRES_PASSWORD,
          privateValues.FUNDING_KEYCLOAK_DB_PASSWORD
        );
      }
      assert.equal(readFileSync(join(root, '.env'), 'utf8'), content);
    }
  }
);

test(
  'CLI dry runs print only the selected plan and preserve synthetic environment and TLS files',
  { skip: !composeAvailable },
  (t) => {
    const root = temporaryFixture(t);
    for (const file of [
      'docker-up.mjs',
      'lib/docker-up.mjs',
      'lib/docker-config.mjs',
      'lib/docker-environment.mjs',
      'lib/keycloak-config.mjs',
      'lib/production-identity.mjs',
      'lib/local-identity.mjs',
      'lib/keycloak-initial-user.mjs',
      'lib/services-check-context.mjs',
      'lib/services-check-identity.mjs'
    ]) {
      const target = join(root, 'scripts', file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(join('scripts', file)));
    }
    mkdirSync(join(root, 'traefik/certs'), { recursive: true });
    for (const file of ['localhost.pem', 'localhost-key.pem'])
      writeFileSync(
        join(root, 'traefik/certs', file),
        'synthetic-existing-tls-file\n'
      );
    const content = writeEnvironment(root, configuredEnvironment());
    for (const authentication of ['token', 'keycloak', 'oidc']) {
      const result = spawnSync(
        process.execPath,
        [
          join(root, 'scripts/docker-up.mjs'),
          '--env=local',
          `--auth=${authentication}`,
          '--dry-run',
          '--no-stripe-webhook'
        ],
        {
          cwd: root,
          env: hostEnv,
          stdio: 'pipe',
          encoding: 'utf8',
          windowsHide: true,
          timeout: 15000
        }
      );
      assert.equal(
        result.status,
        0,
        'Authentication dry run must not require a Docker daemon'
      );
      assert.match(
        result.stdout,
        new RegExp(`Authentification : ${authentication}\\.`)
      );
      assertNoPrivateValues(result.stdout + result.stderr);
      assert.equal(readFileSync(join(root, '.env'), 'utf8'), content);
      assert.equal(
        readFileSync(join(root, 'traefik/certs/localhost-key.pem'), 'utf8'),
        'synthetic-existing-tls-file\n'
      );
      assert.ok(!existsSync(join(root, 'traefik/local')));
    }
  }
);
