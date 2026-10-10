import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { createLocalTlsFixture } from './support/local-tls-fixture.mjs';

const project = 'og7-initial-user-cli';
const volume = `${project}_identity-postgres-data`;
const capturedContext = 'synthetic-default';
const daemonId = 'synthetic-daemon-a';
const initialPassword =
  'synthetic-cli-"password\\${FUNDING_PUBLIC_BASE_URL}\tcanary-' +
  'p'.repeat(20);
const encodedPassword = JSON.stringify(initialPassword)
  .slice(1, -1)
  .replaceAll('$', '\\u0024');
const configuration = {
  COMPOSE_PROJECT_NAME: project,
  FUNDING_PLATFORM_ENV: 'development',
  FUNDING_KEYCLOAK_ENABLED: 'true',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.openg7.test',
  FUNDING_PUBLIC_BASE_URL: 'https://localhost',
  FUNDING_PLATFORM_API_BASE_URL: 'https://localhost/api',
  FUNDING_ALLOWED_ORIGINS: 'https://localhost,https://127.0.0.1',
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.openg7.test/realms/openg7',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-cli-client',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-cli-client-' + 'c'.repeat(32),
  FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: '',
  FUNDING_ADMIN_OIDC_MFA_ACR: '',
  FUNDING_KEYCLOAK_DB_PASSWORD: 'synthetic-cli-db-' + 'd'.repeat(32),
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-cli-bootstrap',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
    'synthetic-cli-bootstrap-' + 'b'.repeat(32),
  FUNDING_KEYCLOAK_INITIAL_USER_USERNAME: 'synthetic-cli-owner',
  FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD: initialPassword
};
const privateNames = [
  'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
  'FUNDING_KEYCLOAK_DB_PASSWORD',
  'FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD',
  'FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD'
];
const hostEnv = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'ComSpec']
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]])
);

// Each CLI runs in a separate Node process. Builtin process launchers are
// replaced before importing it, so this recipe cannot contact a Docker daemon.
const runner = String.raw`
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync, readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const configuration = JSON.parse(readFileSync('.fixture-configuration.json', 'utf8'));
const scenario = JSON.parse(readFileSync('.fixture-scenario.json', 'utf8'));
const capturedContext = 'synthetic-default';
let currentContext = capturedContext;
const privateNames = Object.keys(configuration).filter((name) => /_(PASSWORD|SECRET)$/.test(name));
const privateValues = privateNames.map((name) => configuration[name]);
const record = (call) => appendFileSync('.fixture-actions.jsonl', JSON.stringify(call) + '\n');
const success = (stdout = '') => ({ status: 0, stdout, stderr: '' });
const simulated = (command, args, options = {}) => {
  const encodedPassword = options.env?.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON;
  if ([...privateValues, ...(encodedPassword ? [encodedPassword] : [])].some((value) => args.join(' ').includes(value)))
    throw new Error('A private value reached a process argument.');
  if (options.input) {
    const model = JSON.parse(options.input);
    const rendered = {};
    for (const name of Object.keys(model.services.configuration.environment)) {
      const key = name.replace(/^__OPENG7_PRESENT_/, '');
      const values = { ...configuration, ...options.env };
      rendered[name] = name.startsWith('__OPENG7_PRESENT_')
        ? (Object.hasOwn(values, key) ? '1' : '')
        : (values[key] ?? '').replaceAll('$', '$$');
    }
    record({ action: 'probe' });
    return success(JSON.stringify({ services: { configuration: { environment: rendered } } }));
  }
  const words = args.join(' ');
  if (args[0] === 'scripts/docker-ready.mjs' && args.includes('--eval')) {
    record({ action: 'readiness' });
    return { ...success(), status: scenario.readinessFailure ? 1 : 0 };
  }
  if (/\bps --all --services\b/.test(words)) {
    if (options.env?.DOCKER_CONTEXT !== capturedContext)
      throw new Error('Update topology followed an unpinned Docker context.');
    record({ action: 'topology', context: options.env.DOCKER_CONTEXT });
    return success('identity-postgres\nkeycloak\napi\nweb\n');
  }
  if (command === 'docker' && args[0] === 'context' && args[1] === 'show') {
    record({ action: 'contextShow' });
    const selected = currentContext;
    if (scenario.changeDefaultAfterShow) currentContext = 'synthetic-later-default';
    return success(selected + '\n');
  }
  const pinned = command === 'docker' && args[0] === '--context' && args[1] === capturedContext;
  if (pinned) {
    if (options.env?.DOCKER_CONTEXT !== capturedContext)
      throw new Error('The inspected Docker context was not pinned in its environment.');
    args = args.slice(2);
  }
  if (command === 'docker' && args[0] === 'info') {
    if (!pinned || !args.includes('{{json .ID}}')) throw new Error('Daemon identity was inspected without the captured context.');
    record({ action: 'daemonInfo' });
    return success(JSON.stringify(scenario.daemonId));
  }
  if (command === 'docker' && args.includes('config') && args.includes('json')) {
    if (!pinned) throw new Error('Compose target was inspected without the captured context.');
    record({ action: 'target' });
    return success(JSON.stringify({
      name: configuration.COMPOSE_PROJECT_NAME,
      volumes: { 'identity-postgres-data': { name: configuration.COMPOSE_PROJECT_NAME + '_identity-postgres-data' } },
      services: { 'identity-postgres': { volumes: [{ type: 'volume', source: 'identity-postgres-data', target: '/var/lib/postgresql/data' }] } }
    }));
  }
  if (command === 'docker' && args[0] === 'volume' && args[1] === 'ls') {
    if (!pinned) throw new Error('Identity volume was inspected without the captured context.');
    record({ action: 'volumeLookup' });
    return success(scenario.existingVolume ? configuration.COMPOSE_PROJECT_NAME + '_identity-postgres-data\n' : '');
  }
  const dockerReady = args[0] === 'scripts/docker-ready.mjs';
  const directDocker = command === 'docker' || /\bdocker compose\b/.test(words);
  if (!dockerReady && !directDocker) throw new Error('Unexpected process invocation in CLI fixture.');
  if (options.env?.DOCKER_CONTEXT !== capturedContext)
    throw new Error('A Docker execution followed the changed default context.');
  let passwordRoundtripMatches = false;
  try {
    passwordRoundtripMatches = JSON.parse('"' + encodedPassword + '"') === configuration.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD;
  } catch {}
  record({
    action: 'execution',
    args,
    owner: options.env?.FUNDING_ADMIN_OIDC_OWNER_SUBJECTS ?? null,
    importFile: options.env?.FUNDING_KEYCLOAK_LOCAL_REALM_IMPORT_FILE ?? null,
    context: options.env?.DOCKER_CONTEXT ?? null,
    passwordEncoded: typeof encodedPassword === 'string',
    passwordRoundtripMatches,
    encodedHasDollar: encodedPassword?.includes('$') ?? true,
    exportedPrivateNames: privateNames.filter((name) => Object.hasOwn(options.env ?? {}, name)),
    privateArgument: privateValues.some((value) => words.includes(value))
  });
  return success();
};
childProcess.spawnSync = simulated;
childProcess.spawn = (command, args, options) => {
  const result = simulated(command, args, options);
  const child = new EventEmitter();
  queueMicrotask(() => child.emit('exit', result.status, null));
  return child;
};
syncBuiltinESMExports();
const [cli, ...args] = process.argv.slice(1);
process.argv = [process.execPath, join(process.cwd(), 'scripts', cli), ...args];
await import(pathToFileURL(process.argv[1]).href);
`;

const fixture = (
  t,
  { existingVolume = false, readinessFailure = false } = {}
) => {
  const root = mkdtempSync(join(tmpdir(), 'og7-initial-user-cli-'));
  t.after(() => {
    const absolute = resolve(root);
    assert.equal(dirname(absolute), resolve(tmpdir()));
    assert.ok(basename(absolute).startsWith('og7-initial-user-cli-'));
    rmSync(absolute, { recursive: true, force: true });
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
    'scripts/lib/keycloak-initial-user.mjs',
    'scripts/lib/local-identity.mjs',
    'scripts/lib/production-identity.mjs',
    'scripts/lib/services-check-context.mjs',
    'scripts/lib/services-check-identity.mjs',
    'traefik/traefik.yml',
    'traefik/dynamic.yml',
    'traefik/keycloak.yml',
    'docker/keycloak/openg7-realm.json'
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), readFileSync(file));
  }
  const content =
    Object.entries(configuration)
      .map(([name, value]) => `${name}='${value}'`)
      .join('\n') + '\n';
  writeFileSync(join(root, '.env'), content);
  writeFileSync(
    join(root, '.fixture-configuration.json'),
    JSON.stringify(configuration)
  );
  writeFileSync(
    join(root, '.fixture-scenario.json'),
    JSON.stringify({
      existingVolume,
      readinessFailure,
      daemonId,
      changeDefaultAfterShow: true
    })
  );
  createLocalTlsFixture(root);
  return { root, content };
};

const actionsFor = (root) =>
  existsSync(join(root, '.fixture-actions.jsonl'))
    ? readFileSync(join(root, '.fixture-actions.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
const runCli = ({ root, content }, cli, args) => {
  const before = actionsFor(root).length;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', runner, cli, ...args],
    {
      cwd: root,
      env: hostEnv,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000
    }
  );
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), content);
  for (const name of privateNames)
    assert.ok(
      !(result.stdout + result.stderr).includes(configuration[name]),
      'CLI output must not disclose private configuration'
    );
  assert.ok(
    !(result.stdout + result.stderr).includes(encodedPassword),
    'CLI output must not disclose the encoded password'
  );
  return { result, calls: actionsFor(root).slice(before) };
};
const snapshot = (directory) =>
  Object.fromEntries(
    readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.name !== '.fixture-actions.jsonl')
      .map((entry) => {
        const file = join(entry.parentPath, entry.name);
        return [
          file,
          entry.isDirectory()
            ? 'directory'
            : readFileSync(file).toString('base64')
        ];
      })
  );
const upArguments = ['--env=dev', '--auth=keycloak', '--no-stripe-webhook'];
const updateArguments = [
  '--development',
  '--database',
  '--no-build-app',
  '--no-prune-images',
  '--no-stripe-webhook'
];

test('managed startup, update and recreation preserve the first owner and private import across processes', (t) => {
  const prepared = fixture(t);
  let subject;
  let importFile;
  let savedState;
  for (const [index, [cli, args]] of [
    ['docker-up.mjs', upArguments],
    ['docker-update.mjs', updateArguments],
    ['docker-recreate.mjs', []]
  ].entries()) {
    const { result, calls } = runCli(prepared, cli, args);
    assert.equal(result.status, 0, result.stderr);
    const statePath = join(
      prepared.root,
      'var/keycloak-local',
      project,
      'initial-user.json'
    );
    const stateText = readFileSync(statePath, 'utf8');
    const state = JSON.parse(stateText);
    subject ??= state.subject;
    importFile ??= join(dirname(statePath), 'openg7-realm.json');
    savedState ??= stateText;
    assert.match(subject, /^[0-9a-f-]{36}$/);
    assert.equal(stateText, savedState);
    assert.equal(state.volume, volume);
    assert.equal(state.version, 2);
    assert.equal(state.daemonId, daemonId);
    assert.equal(
      calls.filter((call) => call.action === 'contextShow').length,
      1
    );
    assert.equal(
      calls.filter((call) => call.action === 'daemonInfo').length,
      1
    );
    assert.equal(
      calls.filter((call) => call.action === 'volumeLookup').length,
      index === 0 ? 1 : 0
    );
    if (index === 0) {
      const readiness = calls.findIndex((call) => call.action === 'readiness');
      const lookup = calls.findIndex((call) => call.action === 'volumeLookup');
      assert.ok(readiness >= 0 && readiness < lookup);
    }
    if (cli !== 'docker-update.mjs') {
      const readiness = calls.findIndex((call) => call.action === 'readiness');
      const daemon = calls.findIndex((call) => call.action === 'daemonInfo');
      assert.ok(readiness >= 0 && readiness < daemon);
    }
    const executions = calls.filter((call) => call.action === 'execution');
    assert.ok(
      executions.length >= 2,
      'The CLI must execute its complete Docker plan.'
    );
    for (const call of executions) {
      assert.equal(call.owner, subject);
      assert.equal(call.importFile, importFile);
      assert.equal(call.context, capturedContext);
      assert.equal(call.passwordEncoded, true);
      assert.equal(call.passwordRoundtripMatches, true);
      assert.equal(call.encodedHasDollar, false);
      assert.deepEqual(call.exportedPrivateNames, []);
      assert.equal(call.privateArgument, false);
    }
    const realm = JSON.parse(readFileSync(importFile, 'utf8'));
    assert.equal(realm.users[0].id, subject);
    assert.equal(
      realm.users[0].credentials[0].value,
      '${FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON}'
    );
    assert.ok(!stateText.includes(initialPassword));
    assert.ok(!readFileSync(importFile, 'utf8').includes(initialPassword));
    for (const artifact of [
      statePath,
      importFile,
      join(prepared.root, '.fixture-actions.jsonl')
    ])
      assert.ok(
        !readFileSync(artifact, 'utf8').includes(encodedPassword),
        'Generated artifacts must not contain the encoded password.'
      );
    if (cli === 'docker-update.mjs') {
      assert.equal(
        calls.filter((call) => call.action === 'topology').length,
        1
      );
      assert.ok(
        calls.findIndex((call) => call.action === 'daemonInfo') <
          calls.findIndex((call) => call.action === 'topology')
      );
      assert.equal(
        calls.find((call) => call.action === 'topology').context,
        capturedContext
      );
    }
  }
});

for (const [cli, args] of [
  ['docker-up.mjs', [...upArguments, '--dry-run']],
  ['docker-recreate.mjs', ['--dry-run']]
])
  test(`${cli} dry run with initial credentials prepares no files and contacts no daemon`, (t) => {
    const prepared = fixture(t);
    const before = snapshot(prepared.root);
    const { result, calls } = runCli(prepared, cli, args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(snapshot(prepared.root), before);
    assert.ok(calls.length > 0);
    assert.ok(calls.every((call) => call.action === 'probe'));
  });

test('recreation cannot create missing first-user state or invoke a Docker mutation', (t) => {
  const prepared = fixture(t);
  const { result, calls } = runCli(prepared, 'docker-recreate.mjs', []);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Initial-user state is missing/);
  assert.equal(existsSync(join(prepared.root, 'var/keycloak-local')), false);
  assert.equal(calls.filter((call) => call.action === 'readiness').length, 1);
  assert.equal(
    calls.filter((call) => call.action === 'volumeLookup').length,
    0
  );
  assert.equal(calls.filter((call) => call.action === 'execution').length, 0);
});

test('startup refuses an existing identity volume before any Docker mutation or first-user state', (t) => {
  const prepared = fixture(t, { existingVolume: true });
  const { result, calls } = runCli(prepared, 'docker-up.mjs', upArguments);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /identity database volume already exists/);
  assert.equal(existsSync(join(prepared.root, 'var/keycloak-local')), false);
  assert.equal(
    calls.filter((call) => call.action === 'volumeLookup').length,
    1
  );
  assert.equal(calls.filter((call) => call.action === 'execution').length, 0);
});

test('failed daemon readiness stops before volume lookup, first-user state and Docker mutations', (t) => {
  const prepared = fixture(t, { readinessFailure: true });
  const { result, calls } = runCli(prepared, 'docker-up.mjs', upArguments);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Commande en echec/);
  assert.equal(existsSync(join(prepared.root, 'var/keycloak-local')), false);
  assert.equal(calls.filter((call) => call.action === 'readiness').length, 1);
  assert.equal(calls.filter((call) => call.action === 'target').length, 0);
  assert.equal(
    calls.filter((call) => call.action === 'volumeLookup').length,
    0
  );
  assert.equal(calls.filter((call) => call.action === 'execution').length, 0);
});

test('failed recreation readiness stops before daemon inspection, owner state and Docker mutations', (t) => {
  const prepared = fixture(t, { readinessFailure: true });
  const { result, calls } = runCli(prepared, 'docker-recreate.mjs', []);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.trim().length > 0);
  assert.equal(existsSync(join(prepared.root, 'var/keycloak-local')), false);
  assert.equal(calls.filter((call) => call.action === 'readiness').length, 1);
  assert.equal(calls.filter((call) => call.action === 'contextShow').length, 0);
  assert.equal(calls.filter((call) => call.action === 'daemonInfo').length, 0);
  assert.equal(calls.filter((call) => call.action === 'target').length, 0);
  assert.equal(
    calls.filter((call) => call.action === 'volumeLookup').length,
    0
  );
  assert.equal(calls.filter((call) => call.action === 'execution').length, 0);
});

test('a changed Docker daemon cannot reuse owner state through startup, update or recreation', (t) => {
  const prepared = fixture(t);
  const started = runCli(prepared, 'docker-up.mjs', upArguments);
  assert.equal(started.result.status, 0, started.result.stderr);
  const statePath = join(
    prepared.root,
    'var/keycloak-local',
    project,
    'initial-user.json'
  );
  const importFile = join(dirname(statePath), 'openg7-realm.json');
  const stateBefore = readFileSync(statePath, 'utf8');
  const importBefore = readFileSync(importFile, 'utf8');
  writeFileSync(
    join(prepared.root, '.fixture-scenario.json'),
    JSON.stringify({
      daemonId: 'synthetic-daemon-b',
      changeDefaultAfterShow: true
    })
  );
  for (const [cli, args] of [
    ['docker-up.mjs', upArguments],
    ['docker-update.mjs', updateArguments],
    ['docker-recreate.mjs', []]
  ]) {
    const { result, calls } = runCli(prepared, cli, args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Docker daemon binding/);
    assert.equal(readFileSync(statePath, 'utf8'), stateBefore);
    assert.equal(readFileSync(importFile, 'utf8'), importBefore);
    assert.equal(
      calls.filter((call) => call.action === 'volumeLookup').length,
      0
    );
    assert.equal(calls.filter((call) => call.action === 'execution').length, 0);
    assert.equal(calls.filter((call) => call.action === 'topology').length, 0);
  }
});
