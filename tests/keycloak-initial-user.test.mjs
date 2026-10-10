import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  dockerCommandEnvironment,
  readDockerConfiguration
} from '../scripts/lib/docker-environment.mjs';
import {
  prepareLocalInitialUser,
  validateInitialUserConfig
} from '../scripts/lib/keycloak-initial-user.mjs';

const passwordCanary = 'synthetic-initial-password-canary-' + 'p'.repeat(20);
const configuration = () => ({
  FUNDING_PLATFORM_ENV: 'development',
  FUNDING_KEYCLOAK_ENABLED: 'true',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.openg7.test',
  FUNDING_PUBLIC_BASE_URL: 'https://localhost',
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.openg7.test/realms/openg7',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-client',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-client-' + 'c'.repeat(32),
  FUNDING_KEYCLOAK_DB_PASSWORD: 'synthetic-db-' + 'd'.repeat(32),
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-bootstrap',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
    'synthetic-bootstrap-' + 'b'.repeat(32),
  FUNDING_KEYCLOAK_INITIAL_USER_USERNAME: 'synthetic-initial-owner',
  FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD: passwordCanary,
  FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: ''
});

const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'og7-initial-user-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('og7-initial-user-'));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'docker', 'keycloak'), { recursive: true });
  writeFileSync(
    join(root, 'docker', 'keycloak', 'openg7-realm.json'),
    readFileSync('docker/keycloak/openg7-realm.json')
  );
  return root;
};

const dockerFixture = ({
  project = 'og7-initial-user-test',
  volume = `${project}_identity-postgres-data`,
  context = 'synthetic-desktop',
  daemonId = 'synthetic-daemon-a',
  contextFailure = false,
  daemonFailure = false,
  contextOutput = `${context}\n`,
  daemonOutput = JSON.stringify(daemonId),
  existingVolumes = [],
  configurationFailure = false,
  volumeFailure = false,
  transformConfiguration = (model) => model
} = {}) => {
  const calls = [];
  const runDocker = (command, args, options) => {
    assert.equal(command, 'docker');
    assert.equal(options.stdio, 'pipe');
    assert.equal(options.encoding, 'utf8');
    assert.ok(!args.join(' ').includes(passwordCanary));
    const selected = ['--context', '--host'].includes(args[0]);
    const operationArgs = selected ? args.slice(2) : args;
    calls.push({ args, operationArgs, env: { ...options.env } });
    if (operationArgs[0] === 'context') {
      assert.deepEqual(operationArgs, ['context', 'show']);
      return {
        status: contextFailure ? 1 : 0,
        stderr: contextFailure ? passwordCanary : '',
        stdout: contextOutput
      };
    }
    assert.ok(selected, 'Daemon operations must use a pinned target');
    if (args[0] === '--context')
      assert.equal(options.env.DOCKER_CONTEXT, args[1]);
    else {
      assert.equal(options.env.DOCKER_HOST, args[1]);
      assert.equal(options.env.DOCKER_CONTEXT, '');
    }
    if (operationArgs[0] === 'info') {
      assert.deepEqual(operationArgs, ['info', '--format', '{{json .ID}}']);
      return {
        status: daemonFailure ? 1 : 0,
        stderr: daemonFailure ? passwordCanary : '',
        stdout: daemonOutput
      };
    }
    if (operationArgs[0] === 'compose')
      return {
        status: configurationFailure ? 1 : 0,
        stderr: configurationFailure ? passwordCanary : '',
        stdout: JSON.stringify(
          transformConfiguration({
            name: project,
            services: {
              'identity-postgres': {
                volumes: [
                  {
                    type: 'volume',
                    source: 'identity-postgres-data',
                    target: '/var/lib/postgresql/data'
                  }
                ]
              }
            },
            volumes: { 'identity-postgres-data': { name: volume } }
          })
        )
      };
    assert.deepEqual(operationArgs.slice(0, 2), ['volume', 'ls']);
    return {
      status: volumeFailure ? 1 : 0,
      stderr: volumeFailure ? passwordCanary : '',
      stdout: existingVolumes.join('\n')
    };
  };
  return { project, volume, context, daemonId, calls, runDocker };
};

const statePath = (root, project) =>
  join(root, 'var', 'keycloak-local', project, 'initial-user.json');
const assertNoPrivateFiles = (root) =>
  assert.equal(existsSync(join(root, 'var', 'keycloak-local')), false);
const assertSafeError = (error) => {
  assert.ok(error instanceof Error);
  assert.ok(!error.message.includes(passwordCanary));
  return true;
};

test('initial-user preparation is opt-in and refuses invalid or non-local configuration', () => {
  const disabled = configuration();
  delete disabled.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME;
  delete disabled.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD;
  assert.equal(validateInitialUserConfig(disabled), false);
  assert.equal(validateInitialUserConfig(configuration()), true);
  for (const change of [
    { FUNDING_KEYCLOAK_INITIAL_USER_USERNAME: '' },
    { FUNDING_KEYCLOAK_INITIAL_USER_USERNAME: 'unsafe user name' },
    { FUNDING_KEYCLOAK_INITIAL_USER_USERNAME: '../outside' },
    { FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD: '' },
    { FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD: 'short' },
    { FUNDING_PLATFORM_ENV: 'production' },
    { FUNDING_PLATFORM_ENV: 'test' },
    { FUNDING_KEYCLOAK_ENABLED: 'false' },
    { FUNDING_ADMIN_AUTH_MODE: 'token' },
    { COMPOSE_FILE: 'custom.yml' },
    {
      FUNDING_KEYCLOAK_HOSTNAME: 'auth.other.test',
      FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.other.test/realms/openg7'
    }
  ])
    assert.throws(
      () => validateInitialUserConfig({ ...configuration(), ...change }),
      assertSafeError
    );
  for (const name of [
    'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
    'FUNDING_KEYCLOAK_DB_PASSWORD',
    'FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD'
  ]) {
    const env = configuration();
    env.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD = env[name];
    assert.throws(() => validateInitialUserConfig(env), assertSafeError);
  }
});

test('disabled configuration prepares no files, contacts no daemon and changes no environment', async (t) => {
  const root = fixture(t);
  const env = configuration();
  delete env.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME;
  delete env.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD;
  const original = { ...env };
  assert.equal(
    await prepareLocalInitialUser({
      root,
      env,
      runDocker: () =>
        assert.fail('Disabled preparation must not contact Docker')
    }),
    null
  );
  assert.deepEqual(env, original);
  assertNoPrivateFiles(root);
});

test('fresh local preparation binds one owner to its project and keeps password and MFA enrollment private', async (t) => {
  const root = fixture(t);
  const env = configuration();
  const original = { ...env };
  const docker = dockerFixture();
  const canonicalPath = join(root, 'docker', 'keycloak', 'openg7-realm.json');
  const canonicalText = readFileSync(canonicalPath, 'utf8');
  const prepared = await prepareLocalInitialUser({ root, env, ...docker });
  assert.match(prepared.subject, /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i);
  assert.equal(env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, prepared.subject);
  assert.equal(
    env.FUNDING_KEYCLOAK_LOCAL_REALM_IMPORT_FILE,
    prepared.importFile
  );
  for (const [name, value] of Object.entries(original))
    if (name !== 'FUNDING_ADMIN_OIDC_OWNER_SUBJECTS')
      assert.equal(env[name], value);
  const privateStatePath = statePath(root, docker.project);
  const stateText = readFileSync(privateStatePath, 'utf8');
  const state = JSON.parse(stateText);
  assert.deepEqual(state, {
    version: 2,
    project: docker.project,
    volume: docker.volume,
    username: env.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME,
    daemonId: docker.daemonId,
    subject: prepared.subject
  });
  const importText = readFileSync(prepared.importFile, 'utf8');
  const realm = JSON.parse(importText);
  const canonical = JSON.parse(canonicalText);
  assert.deepEqual(realm.users, [
    {
      id: prepared.subject,
      username: env.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME,
      enabled: true,
      requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
      credentials: [
        {
          type: 'password',
          value: '${FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON}',
          temporary: true
        }
      ]
    }
  ]);
  delete realm.users;
  assert.deepEqual(realm, canonical);
  assert.equal(readFileSync(canonicalPath, 'utf8'), canonicalText);
  for (const text of [stateText, importText])
    assert.ok(!text.includes(passwordCanary));
  if (process.platform !== 'win32')
    assert.equal(statSync(privateStatePath).mode & 0o077, 0);
});

test('repeat preparation retains the identity and tolerates an existing volume without resetting credentials', async (t) => {
  const root = fixture(t);
  const docker = dockerFixture();
  const first = await prepareLocalInitialUser({
    root,
    env: configuration(),
    ...docker
  });
  const previousState = readFileSync(statePath(root, docker.project), 'utf8');
  const previousImport = readFileSync(first.importFile, 'utf8');
  const env = {
    ...configuration(),
    FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD:
      'changed-synthetic-temporary-password'
  };
  const repeated = await prepareLocalInitialUser({
    root,
    env,
    ...dockerFixture({ existingVolumes: [docker.volume] }),
    allowCreate: false
  });
  assert.deepEqual(repeated, first);
  assert.equal(env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, first.subject);
  assert.equal(
    readFileSync(statePath(root, docker.project), 'utf8'),
    previousState
  );
  assert.equal(readFileSync(first.importFile, 'utf8'), previousImport);
});

test('an explicit owner list remains authoritative and unchanged', async (t) => {
  const root = fixture(t);
  const owners = `${randomUUID()},${randomUUID()}`;
  const env = { ...configuration(), FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: owners };
  await prepareLocalInitialUser({ root, env, ...dockerFixture() });
  assert.equal(env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, owners);
});

test('an existing volume cannot acquire an automatic owner when bootstrap state is missing', async (t) => {
  const root = fixture(t);
  const env = configuration();
  const original = { ...env };
  const docker = dockerFixture();
  await assert.rejects(
    async () =>
      prepareLocalInitialUser({
        root,
        env,
        ...dockerFixture({ existingVolumes: [docker.volume] })
      }),
    assertSafeError
  );
  assert.deepEqual(env, original);
  assertNoPrivateFiles(root);
});

test('recreation recovers existing state but cannot create an initial identity', async (t) => {
  const root = fixture(t);
  const env = configuration();
  await assert.rejects(
    async () =>
      prepareLocalInitialUser({
        root,
        env,
        ...dockerFixture(),
        allowCreate: false
      }),
    assertSafeError
  );
  assertNoPrivateFiles(root);
  assert.equal(env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, '');
});

test('failed configuration or volume inspection fails closed without copying private diagnostics', async (t) => {
  for (const failure of [
    { contextFailure: true },
    { daemonFailure: true },
    { configurationFailure: true },
    { volumeFailure: true }
  ]) {
    const root = fixture(t);
    const env = configuration();
    const original = { ...env };
    await assert.rejects(
      async () =>
        prepareLocalInitialUser({ root, env, ...dockerFixture(failure) }),
      assertSafeError
    );
    assert.deepEqual(env, original);
    assertNoPrivateFiles(root);
  }
});

test('invalid project, volume or ambiguous database mounts cannot create bootstrap state', async (t) => {
  for (const transformConfiguration of [
    (model) => ({ ...model, name: '../outside' }),
    (model) => ({ ...model, volumes: {} }),
    (model) => ({
      ...model,
      volumes: { 'identity-postgres-data': { name: passwordCanary } }
    }),
    (model) => ({ ...model, services: {} }),
    (model) => ({
      ...model,
      services: {
        'identity-postgres': {
          volumes: [
            {
              type: 'bind',
              source: '/synthetic',
              target: '/var/lib/postgresql/data'
            }
          ]
        }
      }
    }),
    (model) => ({
      ...model,
      services: {
        'identity-postgres': {
          volumes: [
            ...model.services['identity-postgres'].volumes,
            {
              type: 'bind',
              source: '/synthetic',
              target: '/var/lib/postgresql/data'
            }
          ]
        }
      }
    })
  ]) {
    const root = fixture(t);
    const env = configuration();
    const original = { ...env };
    const docker = dockerFixture({ transformConfiguration });
    await assert.rejects(
      async () => prepareLocalInitialUser({ root, env, ...docker }),
      assertSafeError
    );
    assert.deepEqual(env, original);
    assertNoPrivateFiles(root);
    assert.ok(
      docker.calls.every(({ operationArgs }) => operationArgs[0] !== 'volume')
    );
  }
});

test('the same project cannot silently reuse state for a different identity volume', async (t) => {
  const root = fixture(t);
  const docker = dockerFixture();
  const first = await prepareLocalInitialUser({
    root,
    env: configuration(),
    ...docker
  });
  const file = statePath(root, docker.project);
  const state = readFileSync(file, 'utf8');
  await assert.rejects(
    async () =>
      prepareLocalInitialUser({
        root,
        env: configuration(),
        ...dockerFixture({ volume: 'other-synthetic-identity-volume' })
      }),
    assertSafeError
  );
  assert.equal(readFileSync(file, 'utf8'), state);
  assert.equal(
    JSON.parse(readFileSync(first.importFile, 'utf8')).users[0].id,
    first.subject
  );
});

test('invalid canonical realm input cannot expose diagnostics or persist initial-user state', async (t) => {
  for (const text of [
    '{invalid-' + passwordCanary,
    JSON.stringify({ realm: 'other-realm', privateCanary: passwordCanary }),
    JSON.stringify({
      realm: 'openg7',
      users: [{ privateCanary: passwordCanary }]
    })
  ]) {
    const root = fixture(t);
    const env = configuration();
    const original = { ...env };
    writeFileSync(join(root, 'docker', 'keycloak', 'openg7-realm.json'), text);
    await assert.rejects(
      async () => prepareLocalInitialUser({ root, env, ...dockerFixture() }),
      assertSafeError
    );
    assert.deepEqual(env, original);
    assertNoPrivateFiles(root);
  }
});

test('state is isolated between Compose projects in the same checkout', async (t) => {
  const root = fixture(t);
  const firstProject = 'og7-initial-project-one';
  const secondProject = 'og7-initial-project-two';
  const first = await prepareLocalInitialUser({
    root,
    env: configuration(),
    ...dockerFixture({ project: firstProject })
  });
  const second = await prepareLocalInitialUser({
    root,
    env: configuration(),
    ...dockerFixture({ project: secondProject })
  });
  assert.notEqual(first.subject, second.subject);
  assert.notEqual(first.importFile, second.importFile);
  assert.deepEqual(readdirSync(join(root, 'var', 'keycloak-local')).sort(), [
    firstProject,
    secondProject
  ]);
});

test('malformed or differently bound state is refused without overwriting it', async (t) => {
  for (const change of [
    null,
    { version: 3 },
    { project: 'other-project' },
    { volume: 'other-volume' },
    { username: 'other-initial-user' },
    { daemonId: 'other-synthetic-daemon' },
    { subject: 'not-a-uuid' },
    { unexpected: passwordCanary }
  ]) {
    const root = fixture(t);
    const docker = dockerFixture();
    const prepared = await prepareLocalInitialUser({
      root,
      env: configuration(),
      ...docker
    });
    const file = statePath(root, docker.project);
    const state = JSON.parse(readFileSync(file, 'utf8'));
    const text = change
      ? JSON.stringify({ ...state, ...change })
      : '{invalid-json';
    writeFileSync(file, text);
    const oldImport = readFileSync(prepared.importFile, 'utf8');
    const env = configuration();
    await assert.rejects(
      async () => prepareLocalInitialUser({ root, env, ...docker }),
      assertSafeError
    );
    assert.equal(readFileSync(file, 'utf8'), text);
    assert.equal(readFileSync(prepared.importFile, 'utf8'), oldImport);
    assert.equal(env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, '');
  }
});

test('the captured default Docker context pins inspection, preparation and runtime children', async (t) => {
  const root = fixture(t);
  const env = configuration();
  const original = { ...env };
  const docker = dockerFixture({ context: 'synthetic-default-context' });
  await prepareLocalInitialUser({ root, env, ...docker });
  assert.deepEqual(docker.calls[0].args, ['context', 'show']);
  assert.ok(docker.calls.length >= 4);
  for (const call of docker.calls.slice(1)) {
    assert.deepEqual(call.args.slice(0, 2), ['--context', docker.context]);
    assert.equal(call.env.DOCKER_CONTEXT, docker.context);
  }
  assert.equal(env.DOCKER_CONTEXT, docker.context);
  const runtime = dockerCommandEnvironment(env, original, {});
  assert.equal(runtime.DOCKER_CONTEXT, docker.context);
  assert.equal(
    runtime.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON,
    env.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON
  );
  assert.equal(
    Object.hasOwn(runtime, 'FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD'),
    false
  );
});

test('an explicit Docker context overrides a Docker host without consulting the default context', async (t) => {
  const root = fixture(t);
  const env = {
    ...configuration(),
    DOCKER_CONTEXT: 'synthetic-explicit-context',
    DOCKER_HOST: 'tcp://synthetic-other-host:2376'
  };
  const docker = dockerFixture();
  await prepareLocalInitialUser({ root, env, ...docker });
  for (const call of docker.calls) {
    assert.deepEqual(call.args.slice(0, 2), ['--context', env.DOCKER_CONTEXT]);
    assert.equal(call.env.DOCKER_CONTEXT, env.DOCKER_CONTEXT);
    assert.notEqual(call.operationArgs[0], 'context');
  }
});

test('a Docker host override remains effective with its TLS settings in runtime children', async (t) => {
  const root = fixture(t);
  const env = {
    ...configuration(),
    DOCKER_HOST: 'tcp://synthetic-explicit-host:2376',
    DOCKER_TLS_VERIFY: '1',
    DOCKER_CERT_PATH: '/synthetic/tls'
  };
  const original = { ...env };
  const docker = dockerFixture();
  await prepareLocalInitialUser({ root, env, ...docker });
  for (const call of docker.calls) {
    assert.deepEqual(call.args.slice(0, 2), ['--host', env.DOCKER_HOST]);
    assert.equal(call.env.DOCKER_CONTEXT, '');
    assert.equal(call.env.DOCKER_TLS_VERIFY, original.DOCKER_TLS_VERIFY);
    assert.equal(call.env.DOCKER_CERT_PATH, original.DOCKER_CERT_PATH);
    assert.notEqual(call.operationArgs[0], 'context');
  }
  assert.equal(env.DOCKER_CONTEXT, '');
  const runtime = dockerCommandEnvironment(env, original, original);
  assert.equal(runtime.DOCKER_HOST, original.DOCKER_HOST);
  assert.equal(runtime.DOCKER_CONTEXT, '');
  assert.equal(runtime.DOCKER_TLS_VERIFY, original.DOCKER_TLS_VERIFY);
  assert.equal(runtime.DOCKER_CERT_PATH, original.DOCKER_CERT_PATH);
});

test('invalid daemon identifiers fail closed before preparing files or environment overrides', async (t) => {
  for (const daemonOutput of [
    '',
    'invalid-json-' + passwordCanary,
    JSON.stringify(''),
    JSON.stringify(null),
    JSON.stringify({ privateCanary: passwordCanary }),
    JSON.stringify('unsafe daemon id'),
    JSON.stringify('../outside'),
    JSON.stringify('d'.repeat(257))
  ]) {
    const root = fixture(t);
    const env = configuration();
    const original = { ...env };
    const docker = dockerFixture({ daemonOutput });
    await assert.rejects(
      async () => prepareLocalInitialUser({ root, env, ...docker }),
      assertSafeError
    );
    assert.deepEqual(env, original);
    assertNoPrivateFiles(root);
    assert.ok(
      docker.calls.every(
        ({ operationArgs }) => !['compose', 'volume'].includes(operationArgs[0])
      )
    );
  }
});

test('Docker errors, termination and unexpected captured output cannot prepare a first state', async (t) => {
  for (const result of [
    undefined,
    {
      status: 0,
      error: new Error(passwordCanary),
      stdout: '"synthetic-daemon"'
    },
    { status: 0, signal: 'SIGTERM', stdout: '"synthetic-daemon"' },
    { status: 0, stdout: null },
    { status: null, stdout: '"synthetic-daemon"' },
    'throw-private-diagnostic'
  ]) {
    const root = fixture(t);
    const env = { ...configuration(), DOCKER_CONTEXT: 'synthetic-explicit' };
    const original = { ...env };
    await assert.rejects(
      async () =>
        prepareLocalInitialUser({
          root,
          env,
          runDocker: (_command, args) => {
            assert.equal(args[2], 'info');
            if (result === 'throw-private-diagnostic')
              throw new Error(passwordCanary);
            return result;
          }
        }),
      assertSafeError
    );
    assert.deepEqual(env, original);
    assertNoPrivateFiles(root);
  }
});

test('an empty or unstable default context cannot reach a daemon or prepare private state', async (t) => {
  for (const contextOutput of [
    '',
    '  ',
    'first\nsecond',
    '\0' + passwordCanary,
    'c'.repeat(257)
  ]) {
    const root = fixture(t);
    const env = configuration();
    const original = { ...env };
    const docker = dockerFixture({ contextOutput });
    await assert.rejects(
      async () => prepareLocalInitialUser({ root, env, ...docker }),
      assertSafeError
    );
    assert.deepEqual(env, original);
    assertNoPrivateFiles(root);
    assert.deepEqual(
      docker.calls.map(({ args }) => args),
      [['context', 'show']]
    );
  }
});

test('a changed daemon cannot reuse saved identity state or alter access and import settings', async (t) => {
  const root = fixture(t);
  const docker = dockerFixture();
  const first = await prepareLocalInitialUser({
    root,
    env: configuration(),
    ...docker
  });
  const file = statePath(root, docker.project);
  const previousState = readFileSync(file, 'utf8');
  const previousImport = readFileSync(first.importFile, 'utf8');
  const env = {
    ...configuration(),
    DOCKER_CONTEXT: 'synthetic-other-context',
    FUNDING_KEYCLOAK_LOCAL_REALM_IMPORT_FILE: '/synthetic/other-import.json',
    FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON:
      'synthetic-other-encoded-password'
  };
  const original = { ...env };
  const changed = dockerFixture({
    daemonId: 'synthetic-daemon-b',
    existingVolumes: [docker.volume]
  });
  await assert.rejects(
    async () => prepareLocalInitialUser({ root, env, ...changed }),
    assertSafeError
  );
  assert.deepEqual(env, original);
  assert.equal(readFileSync(file, 'utf8'), previousState);
  assert.equal(readFileSync(first.importFile, 'utf8'), previousImport);
  assert.ok(
    changed.calls.every(({ operationArgs }) => operationArgs[0] !== 'volume')
  );
  const compose = changed.calls.find(
    ({ operationArgs }) => operationArgs[0] === 'compose'
  );
  assert.equal(
    compose.env.FUNDING_KEYCLOAK_LOCAL_REALM_IMPORT_FILE,
    './docker/keycloak/openg7-realm.json'
  );
});

test('different context aliases of the same daemon recover the original identity', async (t) => {
  const root = fixture(t);
  const docker = dockerFixture();
  const first = await prepareLocalInitialUser({
    root,
    env: configuration(),
    ...docker
  });
  const file = statePath(root, docker.project);
  const previousState = readFileSync(file, 'utf8');
  const env = { ...configuration(), DOCKER_CONTEXT: 'synthetic-daemon-alias' };
  const alias = dockerFixture({ existingVolumes: [docker.volume] });
  const repeated = await prepareLocalInitialUser({
    root,
    env,
    ...alias,
    allowCreate: false
  });
  assert.deepEqual(repeated, first);
  assert.equal(readFileSync(file, 'utf8'), previousState);
  assert.equal(env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, first.subject);
  assert.equal(env.DOCKER_CONTEXT, 'synthetic-daemon-alias');
  assert.ok(
    alias.calls.every(({ operationArgs }) => operationArgs[0] !== 'volume')
  );
});

test('legacy state without a daemon binding is refused and preserved for manual reconciliation', async (t) => {
  const root = fixture(t);
  const docker = dockerFixture();
  const first = await prepareLocalInitialUser({
    root,
    env: configuration(),
    ...docker
  });
  const file = statePath(root, docker.project);
  const legacyState = JSON.parse(readFileSync(file, 'utf8'));
  legacyState.version = 1;
  delete legacyState.daemonId;
  const legacyText = JSON.stringify(legacyState, null, 2) + '\n';
  writeFileSync(file, legacyText);
  const previousImport = readFileSync(first.importFile, 'utf8');
  const env = configuration();
  const original = { ...env };
  const repeated = dockerFixture({ existingVolumes: [docker.volume] });
  await assert.rejects(
    async () =>
      prepareLocalInitialUser({ root, env, ...repeated, allowCreate: false }),
    assertSafeError
  );
  assert.deepEqual(env, original);
  assert.equal(readFileSync(file, 'utf8'), legacyText);
  assert.equal(readFileSync(first.importFile, 'utf8'), previousImport);
  assert.ok(
    repeated.calls.every(({ operationArgs }) => operationArgs[0] !== 'volume')
  );
});

test('overlapping first preparations recover the state created by the same daemon', async (t) => {
  const root = fixture(t);
  const docker = dockerFixture();
  const env = configuration();
  let winner;
  const prepared = await prepareLocalInitialUser({
    root,
    env,
    runDocker: (command, args, options) => {
      const result = docker.runDocker(command, args, options);
      if (args.includes('volume') && !winner)
        winner = prepareLocalInitialUser({
          root,
          env: configuration(),
          ...dockerFixture()
        });
      return result;
    }
  });
  assert.deepEqual(prepared, winner);
  assert.equal(env.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS, winner.subject);
  assert.equal(
    JSON.parse(readFileSync(statePath(root, docker.project), 'utf8')).subject,
    winner.subject
  );
  assert.deepEqual(readdirSync(dirname(winner.importFile)).sort(), [
    'initial-user.json',
    'openg7-realm.json'
  ]);
});

test('overlapping preparation on another daemon cannot replace the winning private state', async (t) => {
  const root = fixture(t);
  const docker = dockerFixture();
  const env = configuration();
  const original = { ...env };
  let winner;
  let winnerState;
  let winnerImport;
  await assert.rejects(
    async () =>
      prepareLocalInitialUser({
        root,
        env,
        runDocker: (command, args, options) => {
          const result = docker.runDocker(command, args, options);
          if (args.includes('volume') && !winner) {
            winner = prepareLocalInitialUser({
              root,
              env: configuration(),
              ...dockerFixture({ daemonId: 'synthetic-winning-daemon-b' })
            });
            winnerState = readFileSync(statePath(root, docker.project), 'utf8');
            winnerImport = readFileSync(winner.importFile, 'utf8');
          }
          return result;
        }
      }),
    assertSafeError
  );
  assert.deepEqual(env, original);
  assert.equal(
    readFileSync(statePath(root, docker.project), 'utf8'),
    winnerState
  );
  assert.equal(readFileSync(winner.importFile, 'utf8'), winnerImport);
});

test('password import round-trips JSON characters and literal placeholders without persisting them', async (t) => {
  for (const password of [
    passwordCanary + '"quoted"',
    passwordCanary + '\\path\\n\\t',
    passwordCanary + '\tbackspace\bformfeed\f',
    '${FUNDING_ADMIN_OIDC_CLIENT_SECRET}',
    passwordCanary + '${FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON}',
    passwordCanary + '$single$$double${literal}',
    passwordCanary + 'é漢字🔐'
  ]) {
    const root = fixture(t);
    const env = {
      ...configuration(),
      FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD: password,
      FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON: 'ignored-synthetic-override'
    };
    const docker = dockerFixture();
    const prepared = await prepareLocalInitialUser({ root, env, ...docker });
    const encoded = env.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON;
    assert.equal(typeof encoded, 'string');
    assert.ok(
      !encoded.includes('$'),
      'Encoded substitutions must not trigger recursive expansion'
    );
    const importText = readFileSync(prepared.importFile, 'utf8');
    const substituted = importText.replace(
      '${FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON}',
      () => encoded
    );
    const importedPassword =
      JSON.parse(substituted).users[0].credentials[0].value;
    assert.equal(importedPassword, password);
    assert.notEqual(importedPassword, env.FUNDING_ADMIN_OIDC_CLIENT_SECRET);
    const stateText = readFileSync(statePath(root, docker.project), 'utf8');
    for (const text of [importText, stateText]) {
      assert.ok(!text.includes(passwordCanary));
      assert.ok(!text.includes(encoded));
    }
  }
});

test('Compose resolves initial-user and owner settings without embedding or exporting private dotenv values', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, '.env'), 'SYNTHETIC_FIXTURE=true\n');
  const owners = randomUUID();
  const values = {
    ...configuration(),
    COMPOSE_PROJECT_NAME: 'og7-initial-env-test',
    FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: owners,
    FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD:
      passwordCanary + '$single$$double${literal}'
  };
  const shellEnv = { SYNTHETIC_SHELL_SETTING: 'kept' };
  const resolved = readDockerConfiguration({
    cwd: root,
    env: shellEnv,
    runCompose: (_command, _args, options) => {
      assert.ok(!options.input.includes(passwordCanary));
      assert.ok(
        !options.input.includes(values.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME)
      );
      const requested = JSON.parse(options.input).services.configuration
        .environment;
      for (const name of [
        'COMPOSE_PROJECT_NAME',
        'FUNDING_ADMIN_OIDC_OWNER_SUBJECTS',
        'FUNDING_KEYCLOAK_INITIAL_USER_USERNAME',
        'FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD'
      ])
        assert.ok(Object.hasOwn(requested, name));
      return {
        status: 0,
        stdout: JSON.stringify({
          services: {
            configuration: {
              environment: Object.fromEntries(
                Object.keys(requested).map((name) => {
                  if (name.startsWith('__OPENG7_PRESENT_'))
                    return [
                      name,
                      Object.hasOwn(
                        values,
                        name.slice('__OPENG7_PRESENT_'.length)
                      )
                        ? '1'
                        : ''
                    ];
                  return [
                    name,
                    (values[name] ?? '').replaceAll('$', () => '$$')
                  ];
                })
              )
            }
          }
        })
      };
    }
  });
  for (const [name, value] of Object.entries(values))
    assert.equal(resolved[name], value);
  const runtime = dockerCommandEnvironment(
    {
      ...resolved,
      FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: 'synthetic-owner-override'
    },
    resolved,
    shellEnv
  );
  assert.deepEqual(runtime, {
    ...shellEnv,
    FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: 'synthetic-owner-override'
  });
});
