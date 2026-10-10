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
  parseDockerUpArgs,
  startDockerStack
} from '../scripts/lib/docker-up.mjs';

const privateValues = {
  FUNDING_ADMIN_OIDC_CLIENT_SECRET:
    'production-oidc-$literal-' + 'a'.repeat(32),
  FUNDING_KEYCLOAK_DB_PASSWORD: 'production-database-canary-' + 'b'.repeat(32),
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
    'production-bootstrap-canary-' + 'c'.repeat(32)
};
const productionEnvironment = () => ({
  ...privateValues,
  FUNDING_PLATFORM_ENV: 'production',
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_KEYCLOAK_ENABLED: 'false',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.org',
  FUNDING_PUBLIC_BASE_URL: 'https://fund.example.org',
  FUNDING_PLATFORM_API_BASE_URL: 'https://fund.example.org/api',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://login.example.org/realms/external',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'fixture-production-client',
  FUNDING_ADMIN_OIDC_MFA_ACR: 'urn:fixture:external-mfa',
  FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: 'fixture-existing-production-owner',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'fixture-production-bootstrap',
  FUNDING_OPERATIONS_WATCHER_ENABLED: 'false',
  LETSENCRYPT_EMAIL: 'ops@example.org'
});
const productionOptions = (authentication) =>
  parseDockerUpArgs([
    '--env=prod',
    '--database',
    ...(authentication ? [`--auth=${authentication}`] : []),
    '--no-stripe-webhook'
  ]);
const planFor = (authentication, env = productionEnvironment()) =>
  dockerUpPlan(productionOptions(authentication), { env, localTls: true });
const assertNoPrivateValues = (output) => {
  for (const value of Object.values(privateValues))
    assert.ok(
      !output.includes(value),
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
const composeAvailable = composeVersion.status === 0;
const temporaryFixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'og7-docker-production-auth-'));
  t.after(() => {
    const absolute = resolve(root);
    assert.equal(dirname(absolute), resolve(tmpdir()));
    assert.ok(
      absolute.startsWith(join(tmpdir(), 'og7-docker-production-auth-'))
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
const assertRejectedBeforeEffects = async (authentication, env, expected) => {
  let effects = 0;
  const effect = async () => {
    effects++;
  };
  await assert.rejects(
    async () => {
      const plan = planFor(authentication, env);
      await startDockerStack(plan, {
        runDocker: effect,
        checkStripe: effect,
        listenStripe: effect
      });
    },
    (error) => {
      assert.match(error.message, expected);
      assertNoPrivateValues(error.message);
      return true;
    }
  );
  assert.equal(effects, 0);
};

test('production prompts offer managed or external OIDC and Enter retains configured identity', async () => {
  const env = Object.freeze(productionEnvironment());
  const options = Object.freeze(productionOptions());
  for (const answer of ['keycloak', 'oidc', 'configured', '   ']) {
    const questions = [];
    const chosen = await chooseDockerAuthentication(options, {
      env,
      interactive: true,
      ask: async (question) => {
        questions.push(question);
        return answer;
      }
    });
    assert.equal(chosen, answer.trim() || 'configured');
    assert.equal(questions.length, 1);
    assert.match(questions[0], /production \[keycloak, oidc, configured\]/);
    assert.match(questions[0], /conserver OIDC/);
    assertNoPrivateValues(questions[0]);
  }
  assert.deepEqual(env, productionEnvironment());
  assert.equal(options.authentication, null);
});

test('production prompt refuses token and never echoes rejected terminal input', async () => {
  const answers = [
    'token',
    privateValues.FUNDING_KEYCLOAK_DB_PASSWORD,
    ' OIDC '
  ];
  const questions = [];
  assert.equal(
    await chooseDockerAuthentication(productionOptions(), {
      env: productionEnvironment(),
      interactive: true,
      ask: async (question) => {
        questions.push(question);
        return answers.shift();
      }
    }),
    'oidc'
  );
  assert.equal(questions.length, 3);
  assertNoPrivateValues(questions.join('\n'));
});

test('production explicit choices, dry runs and unattended invocations do not prompt', async () => {
  for (const options of [
    ...['keycloak', 'oidc', 'configured'].map(productionOptions),
    { ...productionOptions(), dryRun: true }
  ])
    assert.equal(
      await chooseDockerAuthentication(options, {
        env: productionEnvironment(),
        interactive: true,
        ask: () => assert.fail('Explicit or dry-run invocation must not prompt')
      }),
      options.authentication ?? null
    );
  assert.equal(
    await chooseDockerAuthentication(productionOptions(), {
      env: productionEnvironment(),
      interactive: false,
      ask: () => assert.fail('Unattended invocation must not prompt')
    }),
    null
  );
});

test('managed production Keycloak retains prepared domains, accounts and credentials without local defaults', () => {
  const env = Object.freeze(productionEnvironment());
  const options = Object.freeze(productionOptions('keycloak'));
  const plan = dockerUpPlan(options, { env, localTls: true });
  assert.equal(plan.environment, 'production');
  assert.equal(plan.authentication, 'keycloak');
  assert.equal(plan.stripeWebhook, false);
  assert.equal(plan.commandEnv.FUNDING_ADMIN_AUTH_MODE, 'oidc');
  assert.equal(plan.commandEnv.FUNDING_KEYCLOAK_ENABLED, 'true');
  assert.equal(
    plan.commandEnv.FUNDING_ADMIN_OIDC_ISSUER,
    'https://auth.example.org/realms/openg7'
  );
  assert.equal(plan.commandEnv.FUNDING_ADMIN_OIDC_MFA_ACR, '');
  for (const name of [
    'FUNDING_KEYCLOAK_HOSTNAME',
    'FUNDING_PUBLIC_BASE_URL',
    'FUNDING_PLATFORM_API_BASE_URL',
    'FUNDING_ADMIN_OIDC_CLIENT_ID',
    'FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME',
    'FUNDING_ADMIN_OIDC_OWNER_SUBJECTS',
    ...Object.keys(privateValues)
  ])
    assert.equal(plan.commandEnv[name], env[name]);
  assert.ok(plan.commands[0].includes('docker-compose.identity.yml'));
  assert.ok(plan.commands[0].includes('database'));
  for (const file of [
    'docker-compose.local-tls.yml',
    'docker-compose.identity.local.yml'
  ])
    assert.ok(!plan.commands[0].includes(file));
  assert.ok(plan.commands[1].includes('ANGULAR_CONFIGURATION=production'));
  assert.deepEqual(env, productionEnvironment());
  assert.equal(options.authentication, 'keycloak');
  assertNoPrivateValues(plan.commands.map((args) => args.join(' ')).join('\n'));
});

test('production external OIDC disables managed Keycloak and keeps provider configuration', () => {
  const env = Object.freeze({
    ...productionEnvironment(),
    FUNDING_ADMIN_AUTH_MODE: 'token',
    FUNDING_KEYCLOAK_ENABLED: 'true'
  });
  const original = { ...env };
  const plan = planFor('oidc', env);
  assert.equal(plan.authentication, 'oidc');
  assert.equal(plan.commandEnv.FUNDING_ADMIN_AUTH_MODE, 'oidc');
  assert.equal(plan.commandEnv.FUNDING_KEYCLOAK_ENABLED, 'false');
  for (const name of Object.keys(env).filter(
    (name) => !/AUTH_MODE|KEYCLOAK_ENABLED/.test(name)
  ))
    assert.equal(plan.commandEnv[name], env[name]);
  assert.ok(!plan.commands[0].includes('docker-compose.identity.yml'));
  assert.deepEqual(env, original);
});

test('production rejects explicit or configured token authentication before any effect', async () => {
  await assertRejectedBeforeEffects(
    'token',
    productionEnvironment(),
    /production exige OIDC/i
  );
  for (const authentication of [null, 'configured'])
    await assertRejectedBeforeEffects(
      authentication,
      { ...productionEnvironment(), FUNDING_ADMIN_AUTH_MODE: 'token' },
      /production exige FUNDING_ADMIN_AUTH_MODE=oidc/i
    );
});

test('explicit production selectors reject custom Compose while configured preserves its existing model', async () => {
  const env = Object.freeze({
    ...productionEnvironment(),
    COMPOSE_FILE: 'prepared-oidc.yml'
  });
  for (const authentication of ['keycloak', 'oidc'])
    await assertRejectedBeforeEffects(authentication, env, /COMPOSE_FILE/);
  for (const authentication of [null, 'configured']) {
    const plan = planFor(authentication, env);
    assert.equal(plan.commandEnv.COMPOSE_FILE, 'prepared-oidc.yml');
    assert.ok(!plan.commands[0].includes('-f'));
    assert.equal(plan.authentication, 'oidc');
    assert.equal(
      plan.commandEnv.FUNDING_ADMIN_OIDC_ISSUER,
      env.FUNDING_ADMIN_OIDC_ISSUER
    );
  }
});

test('managed production Keycloak rejects absent prepared values and reused secrets before execution', async () => {
  for (const name of [
    'FUNDING_KEYCLOAK_HOSTNAME',
    'FUNDING_PUBLIC_BASE_URL',
    'FUNDING_PLATFORM_API_BASE_URL',
    'FUNDING_ADMIN_OIDC_CLIENT_ID',
    'FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME',
    ...Object.keys(privateValues)
  ])
    await assertRejectedBeforeEffects(
      'keycloak',
      { ...productionEnvironment(), [name]: '' },
      /FUNDING_/
    );
  await assertRejectedBeforeEffects(
    'keycloak',
    {
      ...productionEnvironment(),
      FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
        privateValues.FUNDING_KEYCLOAK_DB_PASSWORD
    },
    /distinct/
  );
});

test('explicit production OIDC requires a prepared HTTPS identity and same-origin API', async () => {
  for (const name of [
    'FUNDING_ADMIN_OIDC_CLIENT_ID',
    'FUNDING_ADMIN_OIDC_CLIENT_SECRET'
  ])
    for (const value of ['', 'change-me'])
      await assertRejectedBeforeEffects(
        'oidc',
        { ...productionEnvironment(), [name]: value },
        new RegExp(name)
      );
  await assertRejectedBeforeEffects(
    'oidc',
    {
      ...productionEnvironment(),
      FUNDING_PLATFORM_API_BASE_URL: 'https://api.example.org/api'
    },
    /same origin/
  );
  const external = planFor('oidc', {
    ...productionEnvironment(),
    FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'fixture-provider-secret',
    FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: '',
    FUNDING_ADMIN_OIDC_MFA_ACR: ''
  });
  assert.equal(
    external.commandEnv.FUNDING_ADMIN_OIDC_CLIENT_SECRET,
    'fixture-provider-secret'
  );
  assert.equal(external.commandEnv.FUNDING_ADMIN_OIDC_MFA_ACR, '');
});

test('production selectors reject local addresses, credential-bearing URLs and ambiguous public origins', async () => {
  for (const authentication of ['keycloak', 'oidc']) {
    for (const publicOrigin of [
      'http://fund.example.org',
      `https://operator:${privateValues.FUNDING_ADMIN_OIDC_CLIENT_SECRET}@fund.example.org`,
      'https://fund.example.org?fixture=1',
      'https://fund.example.org#fixture',
      'https://fund.example.org/',
      'https://fund.example.org/path',
      ...[
        'localhost',
        'child.localhost',
        '127.0.0.1',
        '127.42.0.1',
        '0.0.0.0',
        '[::1]',
        '[::]',
        '[::ffff:127.0.0.1]',
        'auth.openg7.test',
        'fund.example.test'
      ].map((hostname) => `https://${hostname}`)
    ])
      await assertRejectedBeforeEffects(
        authentication,
        {
          ...productionEnvironment(),
          FUNDING_PUBLIC_BASE_URL: publicOrigin,
          FUNDING_PLATFORM_API_BASE_URL: publicOrigin
        },
        /FUNDING_PUBLIC_BASE_URL|FUNDING_PLATFORM_API_BASE_URL/
      );
  }
  for (const name of [
    'FUNDING_ADMIN_OIDC_ISSUER',
    'FUNDING_PLATFORM_API_BASE_URL'
  ])
    for (const invalid of [
      'http://fund.example.org/api',
      `https://operator:${privateValues.FUNDING_ADMIN_OIDC_CLIENT_SECRET}@fund.example.org/api`,
      'https://fund.example.org/api?fixture=1',
      'https://fund.example.org/api#fixture',
      'https://127.0.0.1/api',
      'https://auth.openg7.test/api'
    ])
      await assertRejectedBeforeEffects(
        'oidc',
        { ...productionEnvironment(), [name]: invalid },
        new RegExp(name)
      );
});

test('strict production selector preflight does not replace configured deployment validation', () => {
  const env = Object.freeze({
    ...productionEnvironment(),
    FUNDING_ADMIN_OIDC_ISSUER: '',
    FUNDING_PLATFORM_API_BASE_URL: '',
    FUNDING_ADMIN_OIDC_CLIENT_SECRET: ''
  });
  for (const authentication of [null, 'configured']) {
    const plan = planFor(authentication, env);
    assert.equal(plan.commandEnv.FUNDING_ADMIN_OIDC_ISSUER, '');
    assert.equal(plan.commandEnv.FUNDING_PLATFORM_API_BASE_URL, '');
    assert.equal(plan.commandEnv.FUNDING_ADMIN_OIDC_CLIENT_SECRET, '');
  }
});

test('production child overrides clear managed MFA and replace conflicting shell authentication', () => {
  const shell = Object.freeze({
    ...productionEnvironment(),
    FUNDING_PLATFORM_ENV: 'development',
    FUNDING_ADMIN_AUTH_MODE: 'token',
    UNRELATED_SETTING: 'fixture-shell-setting'
  });
  const configuration = Object.freeze({ ...shell });
  const plan = planFor('keycloak', configuration);
  const child = dockerCommandEnvironment(plan.commandEnv, configuration, shell);
  assert.equal(child.FUNDING_PLATFORM_ENV, 'production');
  assert.equal(child.FUNDING_ADMIN_AUTH_MODE, 'oidc');
  assert.equal(child.FUNDING_KEYCLOAK_ENABLED, 'true');
  assert.equal(
    child.FUNDING_ADMIN_OIDC_ISSUER,
    'https://auth.example.org/realms/openg7'
  );
  assert.ok(Object.hasOwn(child, 'FUNDING_ADMIN_OIDC_MFA_ACR'));
  assert.equal(child.FUNDING_ADMIN_OIDC_MFA_ACR, '');
  assert.equal(child.UNRELATED_SETTING, 'fixture-shell-setting');
  for (const [name, value] of Object.entries(privateValues))
    assert.equal(child[name], value);
  assert.equal(shell.FUNDING_ADMIN_AUTH_MODE, 'token');
  assert.equal(configuration.FUNDING_PLATFORM_ENV, 'development');
});

test(
  'canonical production Compose resolves the prepared identity and dotenv secrets without a daemon',
  { skip: !composeAvailable },
  (t) => {
    const root = temporaryFixture(t);
    for (const file of ['docker-compose.yml', 'docker-compose.identity.yml'])
      writeFileSync(join(root, file), readFileSync(file));
    const content = writeEnvironment(root, productionEnvironment());
    const shell = {
      ...hostEnv,
      COMPOSE_PROJECT_NAME: 'og7-production-authentication-test',
      FUNDING_ADMIN_AUTH_MODE: 'token',
      FUNDING_ADMIN_OIDC_MFA_ACR: 'urn:fixture:shell-mfa'
    };
    const configuration = readDockerConfiguration({ env: shell, cwd: root });
    assert.equal(
      configuration.FUNDING_PLATFORM_API_BASE_URL,
      'https://fund.example.org/api'
    );
    for (const authentication of ['keycloak', 'oidc']) {
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
        'Synthetic production Compose must resolve without starting services'
      );
      const services = JSON.parse(result.stdout).services;
      assert.equal(services.api.environment.FUNDING_PLATFORM_ENV, 'production');
      assert.equal(services.api.environment.FUNDING_ADMIN_AUTH_MODE, 'oidc');
      assert.equal(
        services.api.environment.FUNDING_PUBLIC_BASE_URL,
        'https://fund.example.org'
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
          'https://auth.example.org/realms/openg7'
        );
        assert.equal(
          services.keycloak.environment.KC_HOSTNAME,
          'https://auth.example.org'
        );
        assert.equal(
          services.keycloak.environment.KC_BOOTSTRAP_ADMIN_USERNAME,
          'fixture-production-bootstrap'
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
      } else {
        assert.equal(
          services.api.environment.FUNDING_ADMIN_OIDC_ISSUER,
          productionEnvironment().FUNDING_ADMIN_OIDC_ISSUER
        );
        assert.equal(
          services.api.environment.FUNDING_ADMIN_OIDC_MFA_ACR,
          shell.FUNDING_ADMIN_OIDC_MFA_ACR
        );
      }
      assert.equal(readFileSync(join(root, '.env'), 'utf8'), content);
    }
  }
);

test(
  'production CLI dry runs preserve synthetic dotenv and TLS without preparing or starting anything',
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
      'lib/services-check-context.mjs',
      'lib/services-check-identity.mjs'
    ]) {
      const target = join(root, 'scripts', file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(join('scripts', file)));
    }
    mkdirSync(join(root, 'traefik/certs'), { recursive: true });
    const tls = 'synthetic-existing-tls-file\n';
    for (const file of ['localhost.pem', 'localhost-key.pem'])
      writeFileSync(join(root, 'traefik/certs', file), tls);
    const content = writeEnvironment(root, productionEnvironment());
    for (const [authentication, identityOnly] of [
      ['keycloak', false],
      ['keycloak', true],
      ['oidc', false],
      ['configured', false]
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          join(root, 'scripts/docker-up.mjs'),
          '--env=prod',
          '--database',
          `--auth=${authentication}`,
          ...(identityOnly ? ['--identity-only'] : []),
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
        'Production dry run must not require a Docker daemon'
      );
      assert.match(
        result.stdout,
        new RegExp(
          `Authentification : ${authentication === 'configured' ? 'oidc' : authentication}\\.`
        )
      );
      assert.match(result.stdout, /ANGULAR_CONFIGURATION=production/);
      if (authentication === 'keycloak') {
        assert.match(result.stdout, /Preparation du stockage ACME/);
        assert.match(result.stdout, /Verification HTTPS publique et OIDC/);
        assert.match(
          result.stdout,
          /--wait-timeout 180 identity-postgres keycloak traefik/
        );
      }
      if (identityOnly) {
        assert.match(result.stdout, /build [^\r\n]* keycloak\r?$/m);
        assert.doesNotMatch(result.stdout, / up -d --wait\r?$/m);
      }
      assert.doesNotMatch(
        result.stdout,
        /docker-compose\.identity\.local|docker-compose\.local-tls/
      );
      assertNoPrivateValues(result.stdout + result.stderr);
      assert.equal(readFileSync(join(root, '.env'), 'utf8'), content);
      assert.equal(
        readFileSync(join(root, 'traefik/certs/localhost-key.pem'), 'utf8'),
        tls
      );
      assert.ok(!existsSync(join(root, 'traefik/local')));
      assert.ok(!existsSync(join(root, 'traefik/acme')));
    }
    if (process.platform === 'win32') {
      const unsupported = spawnSync(
        process.execPath,
        [
          join(root, 'scripts/docker-up.mjs'),
          '--env=prod',
          '--auth=keycloak',
          '--identity-only'
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
      assert.equal(unsupported.status, 1);
      assert.match(unsupported.stderr, /exige un hote POSIX/);
      assert.equal(unsupported.stdout, '');
      assertNoPrivateValues(unsupported.stderr);
      assert.ok(!existsSync(join(root, 'traefik/acme')));
      assert.equal(readFileSync(join(root, '.env'), 'utf8'), content);
    }
    const rejected = spawnSync(
      process.execPath,
      [
        join(root, 'scripts/docker-up.mjs'),
        '--env=prod',
        '--auth=token',
        '--dry-run'
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
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /production exige OIDC/i);
    assert.doesNotMatch(rejected.stdout, /docker compose .*\b(?:build|up)\b/);
    assertNoPrivateValues(rejected.stdout + rejected.stderr);
    assert.equal(readFileSync(join(root, '.env'), 'utf8'), content);
  }
);
