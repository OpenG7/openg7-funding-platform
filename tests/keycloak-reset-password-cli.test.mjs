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

const project = 'synthetic-reset-cli';
const containerId = 'c'.repeat(64);
const proxyId = 'a'.repeat(64);
const networkId = 'b'.repeat(64);
const imageId = 'sha256:' + 'd'.repeat(64);
const daemonId = 'synthetic-reset-daemon';
const endpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine';
const configuration = {
  COMPOSE_PROJECT_NAME: project,
  FUNDING_PLATFORM_ENV: 'development',
  FUNDING_KEYCLOAK_ENABLED: 'true',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.openg7.test',
  FUNDING_PUBLIC_BASE_URL: 'https://localhost:8443',
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.openg7.test/realms/openg7',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-reset-client',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-reset-client-' + 's'.repeat(32),
  FUNDING_KEYCLOAK_DB_PASSWORD: 'synthetic-reset-database-' + 'd'.repeat(32),
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-reset-admin',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
    'synthetic-reset-admin-private-canary-' + 'a'.repeat(32),
  FUNDING_KEYCLOAK_INITIAL_USER_USERNAME: 'synthetic-reset-owner',
  FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD:
    'synthetic-reset-owner-private-canary-' + 'p'.repeat(32)
};
const hostEnv = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'ComSpec']
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]])
);

// Replace every process launcher and the confirmation prompt before importing
// the CLI. No subprocess in this recipe can reach Docker or a real account.
const runner = String.raw`
import childProcess from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';

const configuration = JSON.parse(readFileSync('.fixture-configuration.json', 'utf8'));
const scenario = JSON.parse(readFileSync('.fixture-scenario.json', 'utf8'));
const privateNames = Object.keys(configuration).filter((name) => /_(PASSWORD|SECRET)$/.test(name));
const privateValues = privateNames.map((name) => configuration[name]);
const record = (value) => appendFileSync('.fixture-actions.jsonl', JSON.stringify(value) + '\n');
const success = (stdout = '') => ({ status: 0, stdout, stderr: '' });
const runtime = (env = {}) => ({
  projectPresent: Object.hasOwn(env, 'COMPOSE_PROJECT_NAME'),
  project: env.COMPOSE_PROJECT_NAME ?? null,
  publicOriginPresent: Object.hasOwn(env, 'FUNDING_PUBLIC_BASE_URL'),
  exportedPrivateNames: privateNames.filter((name) => Object.hasOwn(env, name)),
  dockerHost: env.DOCKER_HOST ?? null,
  dockerContext: env.DOCKER_CONTEXT ?? null
});
childProcess.spawnSync = (command, args, options = {}) => {
  if (command !== 'docker') throw new Error('Unexpected process in password-reset fixture.');
  if (privateValues.some((value) => args.some((arg) => arg.includes(value))))
    throw new Error('Private configuration reached a process argument.');
  if (options.input) {
    if (args.join(' ') !== 'compose -f - config --format json')
      throw new Error('Unexpected configuration probe.');
    record({ action: 'configurationProbe' });
    const model = JSON.parse(options.input);
    const values = { ...configuration, ...options.env };
    const rendered = {};
    for (const name of Object.keys(model.services.configuration.environment)) {
      const key = name.replace(/^__OPENG7_PRESENT_/, '');
      const present = Object.hasOwn(values, key);
      rendered[name] = name.startsWith('__OPENG7_PRESENT_')
        ? present ? '1' : ''
        : present ? values[key].replaceAll('$', '$$') : '';
    }
    return success(JSON.stringify({ services: { configuration: { environment: rendered } } }));
  }
  const pinned = args[0] === '--host' && args[1] === scenario.endpoint;
  const operation = pinned ? args.slice(2) : args;
  const action = ['context', 'network'].includes(operation[0])
    ? operation[0] + '-' + operation[1]
    : operation[0] === 'inspect' && operation[2].includes('"project":')
      ? 'inspectPeers'
      : operation[0];
  record({ action, args, runtime: runtime(options.env), stdio: options.stdio });
  if (action === 'context-show') return success('synthetic-desktop\n');
  if (action === 'context-inspect') return success(JSON.stringify(scenario.endpoint));
  if (!pinned || options.env?.DOCKER_HOST !== scenario.endpoint || options.env?.DOCKER_CONTEXT !== '')
    throw new Error('Daemon operation was not pinned to the local socket.');
  if (action === 'info') return success(JSON.stringify(scenario.daemonId));
  if (action === 'compose') {
    if (operation.slice(-3).join(' ') !== 'ps -q keycloak')
      throw new Error('Unexpected Compose mutation in password-reset fixture.');
    return success(scenario.containerId + '\n');
  }
  const networks = (aliases) => ({
    synthetic_edge: { NetworkID: scenario.networkId, Aliases: aliases }
  });
  if (action === 'network-inspect') return success(JSON.stringify({
    [scenario.containerId]: { Name: 'synthetic-keycloak' },
    [scenario.proxyId]: { Name: 'synthetic-traefik' }
  }));
  if (action === 'inspectPeers') return success([
    {
      id: scenario.containerId,
      project: scenario.project,
      service: 'keycloak',
      running: true,
      networks: networks(['keycloak'])
    },
    {
      id: scenario.proxyId,
      project: scenario.project,
      service: 'traefik',
      running: true,
      networks: networks(['auth.openg7.test'])
    }
  ].map((peer) => JSON.stringify(peer)).join('\n'));
  if (action === 'inspect') return success(JSON.stringify({
    id: scenario.containerId,
    image: scenario.imageId,
    running: true,
    labels: {
      'com.docker.compose.service': 'keycloak',
      'com.docker.compose.project': scenario.project
    },
    env: [
      'KC_HOSTNAME=https://auth.openg7.test',
      'FUNDING_PUBLIC_BASE_URL=' + configuration.FUNDING_PUBLIC_BASE_URL,
      'KC_BOOTSTRAP_ADMIN_PASSWORD=' + configuration.FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD
    ],
    networks: networks(['keycloak'])
  }));
  if (action === 'run') return success();
  throw new Error('Unexpected Docker operation in password-reset fixture.');
};
childProcess.spawn = () => { throw new Error('Unexpected asynchronous process in password-reset fixture.'); };
readline.createInterface = () => {
  record({ action: 'confirmationInterface' });
  return {
    question: async (prompt) => {
      record({ action: 'confirmationPrompt', prompt });
      return scenario.answer;
    },
    close: () => record({ action: 'confirmationClosed' })
  };
};
Object.defineProperty(process.stdin, 'isTTY', { value: scenario.tty, configurable: true });
Object.defineProperty(process.stdout, 'isTTY', { value: scenario.tty, configurable: true });
syncBuiltinESMExports();
process.argv = [process.execPath, join(process.cwd(), 'scripts/keycloak-reset-password.mjs'), ...process.argv.slice(1)];
await import(pathToFileURL(process.argv[1]).href);
`;

const fixture = (
  t,
  {
    env = configuration,
    dotenv = false,
    tty = false,
    answer = '',
    ca = true
  } = {}
) => {
  const root = mkdtempSync(join(tmpdir(), 'og7-reset-password-cli-'));
  t.after(() => {
    const target = resolve(root);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('og7-reset-password-cli-'));
    rmSync(target, { recursive: true, force: true });
  });
  for (const file of [
    'scripts/keycloak-reset-password.mjs',
    'scripts/lib/keycloak-password-reset.mjs',
    'scripts/lib/docker-config.mjs',
    'scripts/lib/docker-environment.mjs',
    'scripts/lib/keycloak-config.mjs',
    'scripts/lib/local-identity.mjs'
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), readFileSync(file));
  }
  const content = dotenv
    ? Object.entries(env)
        .map(([name, value]) => `${name}='${value}'`)
        .join('\n') + '\n'
    : undefined;
  if (dotenv) writeFileSync(join(root, '.env'), content);
  writeFileSync(join(root, '.fixture-configuration.json'), JSON.stringify(env));
  writeFileSync(
    join(root, '.fixture-scenario.json'),
    JSON.stringify({
      tty,
      answer,
      endpoint,
      project,
      containerId,
      proxyId,
      networkId,
      imageId,
      daemonId
    })
  );
  if (ca) createLocalTlsFixture(root);
  return { root, env, dotenv, content };
};

const actionsFor = (root) =>
  existsSync(join(root, '.fixture-actions.jsonl'))
    ? readFileSync(join(root, '.fixture-actions.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
const runCli = ({ root, env, dotenv, content }, args = []) => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', runner, '--', ...args],
    {
      cwd: root,
      env: { ...hostEnv, ...(dotenv ? {} : env) },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000
    }
  );
  if (dotenv) assert.equal(readFileSync(join(root, '.env'), 'utf8'), content);
  const output = result.stdout + result.stderr;
  const calls = actionsFor(root);
  for (const [name, value] of Object.entries(env)) {
    if (!/_(PASSWORD|SECRET)$/.test(name)) continue;
    assert.ok(!output.includes(value), 'CLI output must not disclose secrets');
    assert.ok(
      !JSON.stringify(calls).includes(value),
      'Captured metadata must not disclose secrets'
    );
  }
  return { result, calls };
};
const snapshot = (root) =>
  Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.name !== '.fixture-actions.jsonl')
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [
          path,
          entry.isDirectory()
            ? 'directory'
            : readFileSync(path).toString('base64')
        ];
      })
  );
const auditPath = (root) =>
  join(root, 'var', 'keycloak-local', project, 'password-resets.jsonl');

test('password-reset help needs no environment, certificate, prompt or Docker', (t) => {
  const context = fixture(t, { env: {}, ca: false });
  const before = snapshot(context.root);
  const { result, calls } = runCli(context, ['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: yarn keycloak:reset-password/);
  assert.deepEqual(calls, []);
  assert.deepEqual(snapshot(context.root), before);
});

test('password-reset dry-run validates dotenv configuration and public CA without inspecting Docker or writing audit', (t) => {
  const context = fixture(t, { dotenv: true });
  const before = snapshot(context.root);
  const { result, calls } = runCli(context, ['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Plan vérifié/);
  assert.match(result.stdout, /synthetic-reset-owner/);
  assert.deepEqual(
    calls.map((call) => call.action),
    ['configurationProbe']
  );
  assert.deepEqual(snapshot(context.root), before);
  assert.equal(existsSync(auditPath(context.root)), false);
});

test('password-reset execution refuses a noninteractive terminal before target inspection', (t) => {
  const context = fixture(t, { dotenv: true });
  const { result, calls } = runCli(context);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /terminal interactif/);
  assert.deepEqual(
    calls.map((call) => call.action),
    ['configurationProbe']
  );
  assert.equal(existsSync(auditPath(context.root)), false);
});

test('cancelling the exact-username confirmation performs no reset or audit', (t) => {
  const context = fixture(t, { tty: true, answer: '' });
  const { result, calls } = runCli(context);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Réinitialisation annulée/);
  assert.equal(
    calls.filter((call) => call.action === 'confirmationPrompt').length,
    1
  );
  assert.equal(
    calls.filter((call) => call.action === 'confirmationClosed').length,
    1
  );
  assert.equal(calls.filter((call) => call.action === 'run').length, 0);
  assert.equal(
    calls.filter((call) => call.action === 'configurationProbe').length,
    0
  );
  assert.equal(existsSync(auditPath(context.root)), false);
});

test('confirmed reset preserves the dotenv public origin in its plan while exporting only the selected project', (t) => {
  const username = 'confirmed.owner';
  const adminUser = 'confirmed.admin';
  const context = fixture(t, { dotenv: true, tty: true, answer: username });
  const { result, calls } = runCli(context, [
    '--username',
    username,
    '--admin-user',
    adminUser
  ]);
  assert.equal(result.status, 0, result.stderr);
  const runs = calls.filter((call) => call.action === 'run');
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].args.slice(-2), [adminUser, username]);
  assert.equal(runs[0].stdio, 'inherit');
  assert.equal(runs[0].runtime.publicOriginPresent, false);
  assert.deepEqual(runs[0].runtime.exportedPrivateNames, []);
  assert.equal(runs[0].runtime.project, project);
  assert.equal(runs[0].runtime.dockerHost, endpoint);
  assert.equal(runs[0].runtime.dockerContext, '');
  assert.equal(calls.filter((call) => call.action === 'info').length, 2);
  assert.equal(calls.filter((call) => call.action === 'inspect').length, 2);
  assert.equal(
    calls.filter((call) => call.action === 'network-inspect').length,
    2
  );
  assert.equal(
    calls.filter((call) => call.action === 'inspectPeers').length,
    2
  );
  const promptIndex = calls.findIndex(
    (call) => call.action === 'confirmationPrompt'
  );
  const closedIndex = calls.findIndex(
    (call) => call.action === 'confirmationClosed'
  );
  const networkIndexes = calls
    .map((call, index) => (call.action === 'inspectPeers' ? index : -1))
    .filter((index) => index >= 0);
  assert.ok(networkIndexes[0] < promptIndex);
  assert.ok(closedIndex < networkIndexes[1]);
  assert.ok(
    networkIndexes[1] < calls.findIndex((call) => call.action === 'run')
  );
  assert.ok(calls[promptIndex].prompt.includes('"' + username + '"'));
  const auditText = readFileSync(auditPath(context.root), 'utf8');
  const audit = auditText
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    audit.map((entry) => entry.result),
    ['started', 'succeeded']
  );
  for (const entry of audit) {
    assert.equal(entry.actor, adminUser);
    assert.equal(entry.target, username);
    assert.equal(entry.action, 'keycloak.password.reset');
    assert.equal(entry.realm, 'openg7');
    assert.equal(entry.project, project);
    assert.equal(entry.daemonId, daemonId);
    assert.ok(Number.isFinite(Date.parse(entry.date)));
    assert.match(entry.correlation, /^[0-9a-f-]{36}$/);
  }
  assert.equal(audit[0].correlation, audit[1].correlation);
  for (const [name, value] of Object.entries(context.env))
    if (/_(PASSWORD|SECRET)$/.test(name))
      assert.ok(!auditText.includes(value), 'Audit must not disclose secrets');
});

test('dotenv without COMPOSE_PROJECT_NAME leaves that runtime variable absent instead of exporting undefined', (t) => {
  const env = { ...configuration };
  delete env.COMPOSE_PROJECT_NAME;
  const context = fixture(t, {
    env,
    dotenv: true,
    tty: true,
    answer: env.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME
  });
  const { result, calls } = runCli(context);
  assert.equal(result.status, 0, result.stderr);
  const daemonCalls = calls.filter((call) => call.runtime);
  assert.ok(daemonCalls.length > 0);
  assert.ok(daemonCalls.every((call) => !call.runtime.projectPresent));
  assert.ok(daemonCalls.every((call) => call.runtime.project === null));
  assert.equal(calls.filter((call) => call.action === 'run').length, 1);
});
