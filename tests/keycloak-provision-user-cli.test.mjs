import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
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
import { readDockerConfiguration } from '../scripts/lib/docker-environment.mjs';

const hostEnv = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]])
);
const configuration = {
  FUNDING_PLATFORM_ENV: 'production',
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_KEYCLOAK_ENABLED: 'true',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.org',
  FUNDING_PUBLIC_BASE_URL: 'https://funding.example.org',
  FUNDING_PLATFORM_API_BASE_URL: 'https://funding.example.org/api',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.example.org/realms/openg7',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-cli-client',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'private-canary-client-' + 'c'.repeat(32),
  FUNDING_KEYCLOAK_DB_PASSWORD: 'private-canary-database-' + 'd'.repeat(32),
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-cli-bootstrap',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
    'private-canary-bootstrap-' + 'b'.repeat(32),
  FUNDING_KEYCLOAK_INITIAL_USER_USERNAME: 'synthetic-cli-person',
  FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD:
    'private-canary-user-"quoted"-$literal-${opaque}-\\suffix',
  FUNDING_KEYCLOAK_PROVISION_USER: 'true',
  FUNDING_KEYCLOAK_PROVISION_CLIENT_ID: 'synthetic-cli-provision-client',
  FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET:
    'private-canary-provision-$literal-${opaque}-' + 'p'.repeat(32),
  FUNDING_OPERATIONS_WATCHER_ENABLED: 'false'
};

const fixture = (t, { dotenv = false, changes = {} } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'og7-provision-user-cli-'));
  t.after(() => {
    const absolute = resolve(root);
    assert.equal(dirname(absolute), resolve(tmpdir()));
    assert.ok(basename(absolute).startsWith('og7-provision-user-cli-'));
    rmSync(absolute, { recursive: true, force: true });
  });
  for (const file of [
    'scripts/keycloak-provision-user.mjs',
    'scripts/lib/keycloak-provision-user.mjs',
    'scripts/lib/keycloak-config.mjs',
    'scripts/lib/local-identity.mjs',
    'scripts/lib/docker-environment.mjs',
    'docker-compose.yml',
    'docker-compose.identity.yml'
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(file, join(root, file));
  }
  const values = { ...configuration, ...changes };
  if (dotenv) {
    writeFileSync(
      join(root, '.env'),
      Object.entries(values)
        .filter(([, value]) => value !== undefined)
        .map(([name, value]) => `${name}='${value}'`)
        .join('\n') + '\n'
    );
    writeFileSync(join(root, '.fixture-values.json'), JSON.stringify(values));
  }
  return { root, dotenv, values };
};

const snapshot = (root) =>
  Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true }).map((entry) => {
      const file = join(entry.parentPath, entry.name);
      return [
        file,
        entry.isDirectory()
          ? 'directory'
          : createHash('sha256').update(readFileSync(file)).digest('hex')
      ];
    })
  );

const cli = (prepared, args = [], overrides = {}) => {
  const before = snapshot(prepared.root);
  const runner = `
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const counters = { composeProbes: 0, network: 0, writes: 0, daemon: 0, requestedNames: [] };
const originalRead = fs.readFileSync;
const originalOpen = fs.openSync;
const values = fs.existsSync('.fixture-values.json')
  ? JSON.parse(originalRead('.fixture-values.json', 'utf8')) : {};
const deny = (kind) => () => {
  counters[kind]++;
  throw new Error('Unexpected synthetic ' + kind + ' side effect');
};
http.request = deny('network');
https.request = deny('network');
globalThis.fetch = deny('network');
for (const name of ['mkdirSync', 'writeFileSync', 'renameSync', 'unlinkSync'])
  fs[name] = deny('writes');
fs.openSync = (file, flags, ...rest) => {
  const writing = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT |
    fs.constants.O_TRUNC | fs.constants.O_APPEND;
  if (flags === 'r' || flags === 'rs' ||
      (typeof flags === 'number' && !(flags & writing)))
    return originalOpen(file, flags, ...rest);
  return deny('writes')();
};
childProcess.spawn = deny('daemon');
childProcess.spawnSync = (command, args, options) => {
  if (command !== 'docker' || args.join(' ') !== 'compose -f - config --format json')
    return deny('daemon')();
  counters.composeProbes++;
  assert.equal(options.cwd, ${JSON.stringify(prepared.root)});
  assert.equal(options.stdio, 'pipe');
  const requested = JSON.parse(options.input).services.configuration.environment;
  counters.requestedNames = Object.keys(requested).filter(name => !name.startsWith('__OPENG7_PRESENT_'));
  const resolved = { ...values, ...options.env };
  const environment = Object.fromEntries(Object.keys(requested).map(name => {
    if (name.startsWith('__OPENG7_PRESENT_'))
      return [name, Object.hasOwn(resolved, name.slice('__OPENG7_PRESENT_'.length)) ? '1' : ''];
    return [name, String(resolved[name] ?? '').replaceAll('$', '$$$$')];
  }));
  return { status: 0, stdout: JSON.stringify({ services: { configuration: { environment } } }) };
};
syncBuiltinESMExports();
process.on('exit', () => console.error('CLI_TEST_REPORT=' + JSON.stringify(counters)));
process.argv = [process.execPath, 'scripts/keycloak-provision-user.mjs', ...${JSON.stringify(args)}];
await import('./scripts/keycloak-provision-user.mjs');
`;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', runner],
    {
      cwd: prepared.root,
      env: {
        ...hostEnv,
        ...(prepared.dotenv ? {} : prepared.values),
        ...overrides
      },
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true
    }
  );
  assert.equal(result.error, undefined);
  assert.doesNotMatch(result.stdout + result.stderr, /private-canary/);
  assert.deepEqual(snapshot(prepared.root), before);
  const lines = result.stderr.split(/\r?\n/);
  const report = lines.find((line) => line.startsWith('CLI_TEST_REPORT='));
  assert.ok(report, result.stderr);
  const counters = JSON.parse(report.slice('CLI_TEST_REPORT='.length));
  assert.equal(counters.network, 0);
  assert.equal(counters.writes, 0);
  assert.equal(counters.daemon, 0);
  return {
    ...result,
    stderr: lines
      .filter((line) => !line.startsWith('CLI_TEST_REPORT='))
      .join('\n'),
    counters
  };
};

test('provisioning CLI help and malformed options stop before reading dotenv or making side effects', (t) => {
  const prepared = fixture(t, { dotenv: true });
  const help = cli(prepared, ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /FUNDING_KEYCLOAK_PROVISION_USER=true/);
  assert.equal(help.counters.composeProbes, 0);
  for (const args of [
    ['--unknown-private-canary-option'],
    ['--dry-run', '--subjects-only'],
    ['--help', '--dry-run'],
    ['--dry-run', '--dry-run']
  ]) {
    const result = cli(prepared, args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
    assert.equal(result.stdout, '');
    assert.equal(result.counters.composeProbes, 0);
  }
});

test('provisioning CLI dry-run validates enabled shell configuration without provider, files or Docker', (t) => {
  const result = cli(fixture(t), ['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /configuration is valid/);
  assert.equal(result.counters.composeProbes, 0);
});

test('provisioning CLI preserves disabled operation and refuses machine output while disabled', (t) => {
  const prepared = fixture(t, {
    changes: { FUNDING_KEYCLOAK_PROVISION_USER: 'false' }
  });
  for (const args of [[], ['--dry-run']]) {
    const result = cli(prepared, args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /provisioning is disabled/);
    assert.equal(result.counters.composeProbes, 0);
  }
  for (const option of ['--subjects-only', '--restore-subjects-only']) {
    const machine = cli(prepared, [option]);
    assert.equal(machine.status, 1);
    assert.match(machine.stderr, /Machine provisioning output requires/);
    assert.equal(machine.stdout, '');
    assert.equal(machine.counters.composeProbes, 0);
  }
});

const verifiedSubject = '7bbebd07-2ae6-4a7d-aa22-36fa9111cda8';
const writePrivateState = (prepared, changes = {}) => {
  const issuer = prepared.values.FUNDING_ADMIN_OIDC_ISSUER;
  const username =
    prepared.values.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME.toLowerCase();
  const directory = join(
    prepared.root,
    'var',
    'keycloak-provisioning',
    createHash('sha256')
      .update(issuer + '\n' + username)
      .digest('hex')
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(directory, 'user.json'),
    JSON.stringify({
      version: 1,
      issuer,
      username,
      realmId: 'synthetic-cli-realm-id',
      phase: 'verified',
      subject: verifiedSubject,
      ...changes
    }),
    { mode: 0o600 }
  );
};

test('rollback CLI restores the verified private owner without network, daemon or filesystem changes', (t) => {
  const prepared = fixture(t, {
    dotenv: true,
    changes: { FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: '' }
  });
  writePrivateState(prepared);
  const result = cli(prepared, ['--restore-subjects-only']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, verifiedSubject + '\n');
  assert.equal(result.stderr, '');
  assert.equal(result.counters.composeProbes, 1);
});

test('rollback CLI keeps explicit owners without requiring private state or modifying files', (t) => {
  const otherSubject = 'cc1d3627-d9d0-4761-995a-4b011877035b';
  const prepared = fixture(t, {
    changes: {
      FUNDING_ADMIN_OIDC_OWNER_SUBJECTS:
        ' ' + otherSubject + ' , ' + verifiedSubject + ' '
    }
  });
  const result = cli(prepared, ['--restore-subjects-only']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, otherSubject + ',' + verifiedSubject + '\n');
  assert.equal(result.stderr, '');
  assert.equal(result.counters.composeProbes, 0);
});

test('rollback CLI fails closed on missing or unverified private owner state without side effects', (t) => {
  const absent = cli(fixture(t), ['--restore-subjects-only']);
  assert.equal(absent.status, 1);
  assert.equal(absent.stdout, '');
  for (const changes of [
    { phase: 'pending', subject: null },
    { phase: 'pending' },
    { phase: 'rejected', subject: null },
    { issuer: 'https://other.example.org/realms/openg7' },
    { username: 'different-person' },
    { subject: 'not-a-subject' },
    { version: 42 }
  ]) {
    const prepared = fixture(t);
    writePrivateState(prepared, changes);
    const result = cli(prepared, ['--restore-subjects-only']);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
});

test('provisioning CLI reads dotenv flag and separate service client through captured Compose probes', (t) => {
  const prepared = fixture(t, { dotenv: true });
  const result = cli(prepared, ['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /configuration is valid/);
  assert.equal(result.counters.composeProbes, 1);
  for (const name of [
    'FUNDING_KEYCLOAK_PROVISION_USER',
    'FUNDING_KEYCLOAK_PROVISION_CLIENT_ID',
    'FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET',
    'FUNDING_KEYCLOAK_INITIAL_USER_USERNAME',
    'FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD'
  ])
    assert.ok(result.counters.requestedNames.includes(name));
  const disabled = cli(prepared, ['--dry-run'], {
    FUNDING_KEYCLOAK_PROVISION_USER: 'false'
  });
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.match(disabled.stdout, /provisioning is disabled/);
  const invalid = cli(prepared, ['--dry-run'], {
    FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET: 'short'
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /separate client ID and secret/);
  assert.equal(invalid.stdout, '');
});

const composeAvailable =
  spawnSync('docker', ['compose', 'version'], {
    env: hostEnv,
    stdio: 'ignore',
    windowsHide: true,
    timeout: 5000
  }).status === 0;

test(
  'real Compose resolves private provisioning settings without forwarding them into services',
  { skip: !composeAvailable },
  (t) => {
    const prepared = fixture(t, { dotenv: true });
    const before = snapshot(prepared.root);
    const resolved = readDockerConfiguration({
      cwd: prepared.root,
      env: hostEnv
    });
    for (const name of [
      'FUNDING_KEYCLOAK_PROVISION_USER',
      'FUNDING_KEYCLOAK_PROVISION_CLIENT_ID',
      'FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET',
      'FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD'
    ])
      assert.ok(
        resolved[name] === configuration[name],
        'The protected setting must resolve exactly'
      );
    const compose = [
      'compose',
      '--env-file',
      '.env',
      '-f',
      'docker-compose.yml',
      '-f',
      'docker-compose.identity.yml',
      'config'
    ];
    const quiet = spawnSync('docker', [...compose, '--quiet'], {
      cwd: prepared.root,
      env: hostEnv,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000
    });
    assert.equal(
      quiet.status,
      0,
      'Synthetic managed Compose configuration must validate'
    );
    assert.equal(quiet.stdout, '');
    assert.doesNotMatch(quiet.stderr, /private-canary/);
    const rendered = spawnSync('docker', [...compose, '--format', 'json'], {
      cwd: prepared.root,
      env: hostEnv,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000
    });
    assert.equal(
      rendered.status,
      0,
      'Synthetic Compose rendering must succeed'
    );
    const model = JSON.parse(rendered.stdout);
    for (const service of Object.values(model.services)) {
      const environment = service.environment ?? {};
      for (const name of [
        'FUNDING_KEYCLOAK_PROVISION_USER',
        'FUNDING_KEYCLOAK_PROVISION_CLIENT_ID',
        'FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET',
        'FUNDING_KEYCLOAK_INITIAL_USER_USERNAME',
        'FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD'
      ])
        assert.ok(
          !Object.hasOwn(environment, name),
          'Provisioning settings must stay on the deployment host'
        );
      const text = JSON.stringify(environment);
      assert.doesNotMatch(
        text,
        /private-canary-provision-|private-canary-user-/
      );
      assert.ok(
        !text.includes(configuration.FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET)
      );
      assert.ok(
        !text.includes(configuration.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD)
      );
    }
    assert.deepEqual(snapshot(prepared.root), before);
  }
);
