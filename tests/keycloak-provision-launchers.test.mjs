import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { dockerUpPlan, startDockerStack } from '../scripts/lib/docker-up.mjs';

const subject = '7bbebd07-2ae6-4a7d-aa22-36fa9111cda8';
const configuration = (environment = 'development', provision = 'true') => {
  const local = environment === 'development';
  const hostname = local ? 'auth.openg7.test' : 'auth.example.org';
  const origin = local ? 'https://localhost' : 'https://openg7.org';
  return {
    FUNDING_PLATFORM_ENV: environment,
    FUNDING_ADMIN_AUTH_MODE: 'oidc',
    FUNDING_KEYCLOAK_ENABLED: 'true',
    FUNDING_KEYCLOAK_HOSTNAME: hostname,
    FUNDING_PUBLIC_BASE_URL: origin,
    FUNDING_PLATFORM_API_BASE_URL: origin + '/api',
    FUNDING_ADMIN_OIDC_ISSUER: `https://${hostname}/realms/openg7`,
    FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-launcher-client',
    FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'private-canary-client-' + 'c'.repeat(32),
    FUNDING_KEYCLOAK_DB_PASSWORD: 'private-canary-db-' + 'd'.repeat(32),
    FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-bootstrap',
    FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
      'private-canary-bootstrap-' + 'b'.repeat(32),
    FUNDING_KEYCLOAK_INITIAL_USER_USERNAME: 'synthetic-person',
    FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD: 'private-canary-person-password',
    FUNDING_KEYCLOAK_PROVISION_USER: provision,
    FUNDING_KEYCLOAK_PROVISION_CLIENT_ID: 'synthetic-provision-client',
    FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET:
      'private-canary-provision-' + 'p'.repeat(32),
    FUNDING_OPERATIONS_WATCHER_ENABLED: 'false',
    LETSENCRYPT_EMAIL: 'ops@example.org'
  };
};

const planFor = (environment, provision = 'true', extra = {}) =>
  dockerUpPlan(
    { environment, stripeWebhook: false, database: true, ...extra },
    { env: configuration(environment, provision), localTls: true }
  );

for (const environment of ['development', 'production']) {
  test(`${environment} prepares the verified owner after identity readiness and before application startup`, async () => {
    const plan = planFor(environment);
    const stages = [];
    await startDockerStack(plan, {
      prepareProductionTls: async () => stages.push('tls'),
      checkProductionIdentity: async () => stages.push('https'),
      prepareKeycloakUser: async (env) => {
        assert.equal(env, plan.commandEnv);
        stages.push('provision-start');
        await Promise.resolve();
        env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS = subject;
        stages.push('provision-complete');
      },
      runDocker: async (args, env) => {
        if (args === plan.identityUp) {
          assert.deepEqual(args.slice(-8), [
            'up',
            '-d',
            '--wait',
            '--wait-timeout',
            '180',
            'identity-postgres',
            'keycloak',
            'traefik'
          ]);
          stages.push('identity');
        } else if (args.includes('up')) {
          assert.equal(env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, subject);
          stages.push('application');
        } else stages.push(args.includes('config') ? 'config' : 'build');
      }
    });
    assert.deepEqual(stages, [
      'config',
      'build',
      ...(environment === 'production' ? ['tls'] : []),
      'identity',
      ...(environment === 'production' ? ['https'] : []),
      'provision-start',
      'provision-complete',
      'application'
    ]);
  });

  test(`${environment} refuses a missing provisioning hook before executing Docker`, async () => {
    const stages = [];
    await assert.rejects(
      startDockerStack(planFor(environment), {
        prepareProductionTls: async () => stages.push('tls'),
        checkProductionIdentity: async () => stages.push('https'),
        runDocker: async () => stages.push('docker')
      }),
      /requires a preparation hook/
    );
    assert.deepEqual(stages, []);
  });

  test(`${environment} provisioning failure prevents application startup`, async () => {
    const plan = planFor(environment);
    const commands = [];
    const failure = new Error('Synthetic provisioning failure');
    await assert.rejects(
      startDockerStack(plan, {
        prepareProductionTls: async () => {},
        checkProductionIdentity: async () => {},
        prepareKeycloakUser: async () => {
          throw failure;
        },
        runDocker: async (args) => commands.push(args)
      }),
      (error) => error === failure
    );
    assert.equal(commands.at(-1), plan.identityUp);
    assert.equal(commands.length, 3);
  });
}

test('disabled provisioning preserves local startup without starting identity separately', async () => {
  const plan = planFor('development', 'false');
  assert.equal(plan.identityUp, null);
  let calls = 0;
  await startDockerStack(plan, {
    runDocker: async () => calls++,
    prepareProductionTls: () =>
      assert.fail('Local startup cannot prepare ACME'),
    checkProductionIdentity: () => assert.fail('No public HTTPS check locally'),
    prepareKeycloakUser: () => assert.fail('Provisioning is opt-in')
  });
  assert.equal(calls, 3);
});

test('identity-only production can prepare the owner without launching the application', async () => {
  const plan = planFor('production', 'true', { identityOnly: true });
  let prepared = false;
  const commands = [];
  await startDockerStack(plan, {
    prepareProductionTls: async () => {},
    checkProductionIdentity: async () => {},
    prepareKeycloakUser: async () => {
      prepared = true;
    },
    runDocker: async (args) => commands.push(args)
  });
  assert.equal(prepared, true);
  assert.equal(commands.at(-1), plan.identityUp);
});

test('production HTTPS failure prevents account preparation and application startup', async () => {
  const plan = planFor('production');
  const stages = [];
  await assert.rejects(
    startDockerStack(plan, {
      prepareProductionTls: async () => {},
      checkProductionIdentity: async () => {
        throw new Error('Synthetic HTTPS failure');
      },
      prepareKeycloakUser: async () => stages.push('provision'),
      runDocker: async (args) => stages.push(args)
    }),
    /Synthetic HTTPS failure/
  );
  assert.equal(stages.at(-1), plan.identityUp);
  assert.equal(stages.length, 3);
});

const hostEnv = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'ComSpec']
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]])
);

const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'og7-provision-launchers-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('og7-provision-launchers-'));
    rmSync(root, { recursive: true, force: true });
  });
  for (const file of [
    'scripts/docker-up.mjs',
    'scripts/docker-update.mjs',
    'scripts/docker-recreate.mjs',
    'scripts/lib/docker-up.mjs',
    'scripts/lib/docker-update.mjs',
    'scripts/lib/docker-config.mjs',
    'scripts/lib/docker-environment.mjs',
    'scripts/lib/keycloak-config.mjs',
    'scripts/lib/services-check-context.mjs',
    'scripts/lib/services-check-identity.mjs',
    'scripts/lib/production-identity.mjs'
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(file, join(root, file));
  }
  // The fixture never reaches a real certificate, identity or Docker service.
  writeFileSync(
    join(root, 'scripts/lib/local-identity.mjs'),
    `
export const localIdentityHostname = 'auth.openg7.test';
export const validateLocalIdentityConfig = () => true;
export const validateLocalIdentityCertificates = () => {};
export const prepareLocalIdentity = () => {};
`
  );
  writeFileSync(
    join(root, 'scripts/lib/keycloak-initial-user.mjs'),
    `
export const prepareLocalInitialUser = () => null;
`
  );
  writeFileSync(
    join(root, 'scripts/lib/keycloak-provision-user.mjs'),
    `
export async function provisionKeycloakUser({ root, env, requireEnrollment }) {
  globalThis.launcherCalls.push({ stage: 'provision', root, requireEnrollment });
  await Promise.resolve();
  if (process.env.TEST_PROVISION_FAILURE === 'true')
    throw new Error('Synthetic account preparation failure');
  env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS = '${subject}';
  return { subject: '${subject}', created: false };
}
`
  );
  mkdirSync(join(root, 'traefik/certs'), { recursive: true });
  for (const file of ['localhost.pem', 'localhost-key.pem'])
    writeFileSync(
      join(root, 'traefik/certs', file),
      'synthetic-existence-marker'
    );
  return root;
};

const cli = (root, script, args, changes = {}) => {
  const scriptSource = `
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
if (process.env.TEST_TARGET_PLATFORM)
  Object.defineProperty(process, 'platform', { value: process.env.TEST_TARGET_PLATFORM });
globalThis.launcherCalls = [];
process.on('exit', () => {
  console.log('LAUNCHER_RESULT=' + JSON.stringify(globalThis.launcherCalls));
});
const record = (command, args, options) => {
  assert.ok(!args.includes('keycloak-provision-user.mjs'), 'Use the injected helper directly');
  globalThis.launcherCalls.push({
    stage: 'command', command, args,
    owner: options.env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS ?? null
  });
};
childProcess.spawn = (command, args, options) => {
  record(command, args, options);
  const child = new EventEmitter();
  process.nextTick(() => child.emit('exit', 0, null));
  return child;
};
childProcess.spawnSync = (command, args, options) => {
  record(command, args, options);
  return { status: 0, stdout: 'identity-postgres\\nkeycloak\\n' };
};
syncBuiltinESMExports();
process.argv = [process.execPath, 'scripts/${script}', ...${JSON.stringify(args)}];
await import('./scripts/${script}');
`;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', scriptSource],
    {
      cwd: root,
      env: { ...hostEnv, ...configuration(), ...changes },
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true
    }
  );
  assert.equal(result.error, undefined);
  assert.doesNotMatch(result.stdout + result.stderr, /private-canary/);
  const report = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('LAUNCHER_RESULT='));
  assert.ok(report, result.stderr);
  return {
    ...result,
    calls: JSON.parse(report.slice('LAUNCHER_RESULT='.length))
  };
};

const launchers = [
  ['docker-up.mjs', ['--env=local', '--auth=keycloak', '--no-stripe-webhook']],
  [
    'docker-update.mjs',
    [
      '--development',
      '--database',
      '--no-build-app',
      '--no-prune-images',
      '--no-stripe-webhook'
    ]
  ],
  ['docker-recreate.mjs', []]
];

for (const [script, args] of launchers) {
  test(`${script} injects the owner before application up and keeps provisioning output private`, (t) => {
    const root = fixture(t);
    const result = cli(root, script, args);
    assert.equal(result.status, 0, result.stderr);
    const provisionIndex = result.calls.findIndex(
      (call) => call.stage === 'provision'
    );
    assert.notEqual(provisionIndex, -1);
    assert.equal(result.calls[provisionIndex].root, root);
    assert.equal(result.calls[provisionIndex].requireEnrollment, false);
    const applicationUp = result.calls.find(
      (call) =>
        call.stage === 'command' &&
        call.args.some((arg) => arg === 'up' || / up /.test(arg)) &&
        !call.args.includes('identity-postgres')
    );
    assert.ok(applicationUp);
    assert.ok(result.calls.indexOf(applicationUp) > provisionIndex);
    assert.equal(applicationUp.owner, subject);
    if (script !== 'docker-up.mjs') {
      const commandText = applicationUp.args.join(' ');
      assert.match(commandText, /--no-deps/);
      assert.doesNotMatch(
        commandText,
        /(?:^| )keycloak(?: |$)|identity-postgres/
      );
    }
  });

  test(`${script} blocks application startup when account preparation fails`, (t) => {
    const result = cli(fixture(t), script, args, {
      TEST_PROVISION_FAILURE: 'true'
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Synthetic account preparation failure/);
    const index = result.calls.findIndex((call) => call.stage === 'provision');
    assert.notEqual(index, -1);
    assert.equal(result.calls[index].requireEnrollment, false);
    assert.equal(result.calls.slice(index + 1).length, 0);
  });

  test(`${script} does not load the provisioning helper when disabled`, (t) => {
    const root = fixture(t);
    writeFileSync(
      join(root, 'scripts/lib/keycloak-provision-user.mjs'),
      "throw new Error('Disabled helper must not be loaded');\n"
    );
    const result = cli(root, script, args, {
      FUNDING_KEYCLOAK_PROVISION_USER: 'false'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.calls.every((call) => call.stage !== 'provision'));
  });
}

for (const script of ['docker-update.mjs', 'docker-recreate.mjs']) {
  test(`${script} uses an already-running production provider without local TLS or provider startup`, (t) => {
    const args =
      script === 'docker-update.mjs'
        ? ['--production', '--database', '--no-build-app', '--no-prune-images']
        : [];
    const result = cli(fixture(t), script, args, configuration('production'));
    assert.equal(result.status, 0, result.stderr);
    const index = result.calls.findIndex((call) => call.stage === 'provision');
    assert.notEqual(index, -1);
    assert.equal(result.calls[index].requireEnrollment, true);
    const commands = result.calls.filter((call) => call.stage === 'command');
    for (const call of commands) {
      const commandText = call.args.join(' ');
      assert.doesNotMatch(
        commandText,
        /docker-compose.local-tls|docker-compose.identity.local|(?:^| )keycloak(?: |$)|identity-postgres/
      );
      if (/ up /.test(commandText)) {
        assert.ok(result.calls.indexOf(call) > index);
        assert.equal(call.owner, subject);
        assert.match(commandText, /--no-deps/);
      }
    }
  });
}

for (const identityOnly of [false, true]) {
  test(`production docker-up passes enrollment requirement ${!identityOnly} for identity-only=${identityOnly}`, (t) => {
    const root = fixture(t);
    // Stub production TLS effects; this fixture cannot reach an ACME store or provider.
    writeFileSync(
      join(root, 'scripts/lib/production-identity.mjs'),
      `
export const validateProductionTlsSettings = () => {};
export const prepareProductionAcme = () => {};
export const inspectProductionAcmeWithDocker = () => {};
export const waitForProductionIdentity = () => {};
`
    );
    const result = cli(
      root,
      'docker-up.mjs',
      [
        '--env=prod',
        '--auth=keycloak',
        '--no-stripe-webhook',
        ...(identityOnly ? ['--identity-only'] : [])
      ],
      {
        ...configuration('production'),
        TEST_TARGET_PLATFORM: 'linux'
      }
    );
    assert.equal(result.status, 0, result.stderr);
    const prepared = result.calls.find((call) => call.stage === 'provision');
    assert.equal(prepared.requireEnrollment, !identityOnly);
    const applicationUp = result.calls.find(
      (call) =>
        call.stage === 'command' &&
        call.args.includes('up') &&
        !call.args.includes('identity-postgres')
    );
    assert.equal(Boolean(applicationUp), !identityOnly);
    if (applicationUp) assert.equal(applicationUp.owner, subject);
  });
}

for (const [script, args] of launchers.filter(
  ([script]) => script !== 'docker-update.mjs'
)) {
  test(`${script} dry-run describes account preparation without invoking services or helper`, (t) => {
    const root = fixture(t);
    writeFileSync(
      join(root, 'scripts/lib/keycloak-provision-user.mjs'),
      "throw new Error('Dry-run helper must not be loaded');\n"
    );
    const result = cli(root, script, [...args, '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Preparation du compte Keycloak/);
    assert.deepEqual(result.calls, []);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /ACME|Verification HTTPS publique/
    );
  });
}
