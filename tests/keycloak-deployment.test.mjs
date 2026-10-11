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
import path from 'node:path';
import test from 'node:test';
import { dockerComposeFileArgs } from '../scripts/lib/docker-config.mjs';

const bash =
  process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const hostEnv = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]])
);

const fixture = (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'og7-keycloak-deployment-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('og7-keycloak-deployment-'));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(path.join(root, 'scripts'));
  for (const name of [
    'deploy.sh',
    'rollback.sh',
    'deployment-compose.sh',
    'deployment-image-revision.sh',
    'load-env.sh'
  ]) {
    writeFileSync(
      path.join(root, 'scripts', name),
      readFileSync('scripts/' + name, 'utf8').replaceAll('\r\n', '\n')
    );
  }
  writeFileSync(
    path.join(root, 'scripts/check.sh'),
    `echo health >> calls
if [[ "\${TEST_FAIL_HEALTH_ONCE:-false}" == true && ! -f first-check-failed ]]; then
  touch first-check-failed
  exit 1
fi
`
  );
  writeFileSync(
    path.join(root, 'scripts/db-migrate.sh'),
    'echo migrate >> calls\n'
  );
  const wrapper = `set -euo pipefail
node() {
  printf 'node' >> calls; printf '\\t%s' "$@" >> calls; printf '\\n' >> calls
  if [[ "$1 $2" == 'scripts/keycloak-provision-user.mjs --subjects-only' ]]; then
    printf '%s\\n' "$TEST_PROVISION_SUBJECTS"
    return "$TEST_PROVISION_STATUS"
  fi
  if [[ "$1 $2" == 'scripts/keycloak-provision-user.mjs --restore-subjects-only' ]]; then
    printf '%s\\n' "\${FUNDING_ADMIN_OIDC_OWNER_SUBJECTS:-$TEST_RESTORE_SUBJECTS}"
    return "$TEST_RESTORE_STATUS"
  fi
  [[ "$1 $2" == 'scripts/keycloak-config.mjs --check' ]] || return 92
  return "$TEST_PREFLIGHT_STATUS"
}
docker() {
  printf 'docker' >> calls; printf '\\t%s' "$@" >> calls; printf '\\n' >> calls
  if [[ "\${FUNDING_KEYCLOAK_PROVISION_USER:-false}" == true && "$*" == *'up -d'* ]]; then
    printf 'owners\\t%s\\n' "\${FUNDING_ADMIN_OIDC_OWNER_SUBJECTS:-}" >> calls
  fi
  case "$*" in
    *'images -q web') echo synthetic-web-image ;;
    *'images -q api') echo synthetic-api-image ;;
    *'images -q operations') echo synthetic-operations-image ;;
    *'ps --services --filter status=running')
      if [[ "$TEST_OPERATIONS" == true ]]; then echo operations; fi ;;
  esac
  return 0
}
export -f node docker
if [[ "$1" == helper ]]; then
  source scripts/load-env.sh .env
  source scripts/deployment-compose.sh
  compose config --quiet
  application_services
  compose pull "\${APPLICATION_SERVICES[@]}"
  compose build --pull "\${APPLICATION_SERVICES[@]}"
  compose up -d --no-build "\${APPLICATION_SERVICES[@]}"
else
  bash scripts/"$1" "\${@:2}"
fi`;
  const calls = () =>
    readFileSync(path.join(root, 'calls'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'));
  const run = (
    script,
    {
      enabled,
      operations = false,
      runningOperations = operations,
      database = false,
      credentials = false,
      composeFile,
      preflightStatus = 0,
      provisionUser = false,
      provisionSubjects = '7bbebd07-2ae6-4a7d-aa22-36fa9111cda8',
      provisionStatus = 0,
      restoreSubjects = provisionSubjects,
      restoreStatus = 0,
      explicitOwners = '',
      failHealthOnce = false
    } = {},
    args = []
  ) => {
    const env = {
      APP_DOMAIN: 'funding.example.test',
      FUNDING_OPERATIONS_WATCHER_ENABLED: String(operations),
      FUNDING_KEYCLOAK_PROVISION_USER: String(provisionUser),
      FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: explicitOwners,
      ...(enabled === undefined ? {} : { FUNDING_KEYCLOAK_ENABLED: enabled }),
      ...(composeFile === undefined ? {} : { COMPOSE_FILE: composeFile }),
      ...(database ? { DATABASE_URL: 'synthetic-database' } : {}),
      ...(operations
        ? {
            FUNDING_OPERATIONS_WEBHOOK_URL:
              'https://receiver.example.test/hook',
            FUNDING_OPERATIONS_WEBHOOK_SECRET:
              'synthetic-operations-signature-at-least-32-characters'
          }
        : {}),
      ...(credentials
        ? {
            FUNDING_KEYCLOAK_DB_PASSWORD:
              'synthetic-identity-database-password-at-least-32-characters',
            FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
              'synthetic-identity-bootstrap-password-at-least-32-characters'
          }
        : {})
    };
    writeFileSync(
      path.join(root, '.env'),
      Object.entries(env)
        .map(([key, value]) => `${key}=${value}\n`)
        .join('')
    );
    writeFileSync(path.join(root, 'calls'), '');
    return spawnSync(
      bash,
      ['--noprofile', '--norc', '-c', wrapper, 'synthetic', script, ...args],
      {
        cwd: root,
        env: {
          ...hostEnv,
          TEST_PREFLIGHT_STATUS: String(preflightStatus),
          TEST_OPERATIONS: String(runningOperations),
          TEST_PROVISION_SUBJECTS: provisionSubjects,
          TEST_PROVISION_STATUS: String(provisionStatus),
          TEST_RESTORE_SUBJECTS: restoreSubjects,
          TEST_RESTORE_STATUS: String(restoreStatus),
          TEST_FAIL_HEALTH_ONCE: String(failHealthOnce)
        },
        encoding: 'utf8',
        timeout: 15000,
        windowsHide: true
      }
    );
  };
  return { run, calls };
};

test('identity deployment stays disabled by default and credentials do not enable it', (t) => {
  const f = fixture(t);
  for (const enabled of [undefined, 'false']) {
    const result = f.run('helper', { enabled, credentials: true });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.calls()[0], ['docker', 'compose', 'config', '--quiet']);
    assert.ok(f.calls().every((call) => call[0] !== 'node'));
    assert.ok(
      f.calls().every((call) => !call.includes('docker-compose.identity.yml'))
    );
  }
});

test('identity deployment rejects invalid switches, custom Compose files and failed preflight before Docker', (t) => {
  const f = fixture(t);
  for (const enabled of ['1', 'TRUE', 'yes', '']) {
    const result = f.run('helper', { enabled });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid FUNDING_KEYCLOAK_ENABLED/);
    assert.deepEqual(f.calls(), []);
  }
  for (const operations of ['1', 'TRUE', 'yes']) {
    const result = f.run('helper', { enabled: 'false', operations });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid FUNDING_OPERATIONS_WATCHER_ENABLED/);
    assert.deepEqual(f.calls(), []);
    assert.throws(
      () =>
        dockerComposeFileArgs({
          FUNDING_OPERATIONS_WATCHER_ENABLED: operations
        }),
      /FUNDING_OPERATIONS_WATCHER_ENABLED/
    );
  }
  const customCompose = f.run('helper', {
    enabled: 'true',
    composeFile: 'custom.yml'
  });
  assert.notEqual(customCompose.status, 0);
  assert.match(customCompose.stderr, /COMPOSE_FILE/);
  assert.deepEqual(f.calls(), []);
  const rejected = f.run('helper', { enabled: 'true', preflightStatus: 1 });
  assert.notEqual(rejected.status, 0);
  assert.deepEqual(f.calls(), [
    ['node', 'scripts/keycloak-config.mjs', '--check']
  ]);
});

test('Node and Bash select the same managed overlays while application actions exclude identity services', (t) => {
  const f = fixture(t);
  for (const identity of [false, true]) {
    for (const operations of [false, true, '']) {
      for (const database of [false, true]) {
        const result = f.run('helper', {
          enabled: String(identity),
          operations,
          database
        });
        assert.equal(result.status, 0, result.stderr);
        const prefix = [
          'docker',
          'compose',
          ...(identity || operations ? ['-f', 'docker-compose.yml'] : []),
          ...(operations ? ['-f', 'docker-compose.operations.yml'] : []),
          ...(identity ? ['-f', 'docker-compose.identity.yml'] : []),
          ...(database ? ['--profile', 'database'] : [])
        ];
        assert.deepEqual(prefix, [
          'docker',
          'compose',
          ...dockerComposeFileArgs({
            FUNDING_KEYCLOAK_ENABLED: String(identity),
            FUNDING_OPERATIONS_WATCHER_ENABLED: String(operations),
            FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.test',
            FUNDING_PUBLIC_BASE_URL: 'https://fund.example.test',
            FUNDING_ADMIN_OIDC_ISSUER:
              'https://auth.example.test/realms/openg7',
            FUNDING_ADMIN_OIDC_CLIENT_ID: 'openg7-funding-admin',
            FUNDING_ADMIN_OIDC_CLIENT_SECRET:
              'synthetic-client-' + 'c'.repeat(32),
            FUNDING_KEYCLOAK_DB_PASSWORD:
              'synthetic-database-' + 'd'.repeat(32),
            FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'bootstrap-admin',
            FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
              'synthetic-bootstrap-' + 'b'.repeat(32)
          }),
          ...(database ? ['--profile', 'database'] : [])
        ]);
        const services = [
          'traefik',
          'api',
          'web',
          'cadvisor',
          ...(database ? ['postgres'] : []),
          ...(operations ? ['operations'] : [])
        ];
        assert.deepEqual(f.calls(), [
          ...(identity
            ? [['node', 'scripts/keycloak-config.mjs', '--check']]
            : []),
          [...prefix, 'config', '--quiet'],
          [...prefix, 'pull', ...services],
          [...prefix, 'build', '--pull', ...services],
          [...prefix, 'up', '-d', '--no-build', ...services]
        ]);
      }
    }
  }
});

test('application delivery and rollback preserve the identity stack lifecycle', (t) => {
  const f = fixture(t);
  const options = { enabled: 'true', database: true };
  const deployed = f.run('deploy.sh', options, ['--no-build']);
  assert.equal(deployed.status, 0, deployed.stderr);
  const delivery = f.calls();
  assert.ok(delivery.some((call) => call[0] === 'migrate'));
  assert.ok(delivery.some((call) => call[0] === 'health'));
  const restored = f.run('rollback.sh', options);
  assert.equal(restored.status, 0, restored.stderr);
  const rollback = f.calls();
  for (const calls of [delivery, rollback]) {
    const up = calls.find((call) => call.includes('up'));
    assert.ok(up.includes('docker-compose.identity.yml'));
    assert.deepEqual(up.slice(up.indexOf('up')), [
      'up',
      '-d',
      '--no-build',
      'traefik',
      'api',
      'web',
      'cadvisor',
      'postgres'
    ]);
    assert.ok(calls.every((call) => !call.includes('keycloak')));
    assert.ok(calls.every((call) => !call.includes('identity-postgres')));
  }
  assert.ok(rollback.some((call) => call[0] === 'health'));
});

test('application delivery captures verified owner subjects before migrations and never starts identity services', (t) => {
  const f = fixture(t);
  const subjects =
    '7bbebd07-2ae6-4a7d-aa22-36fa9111cda8,cc1d3627-d9d0-4761-995a-4b011877035b';
  const result = f.run(
    'deploy.sh',
    {
      enabled: 'true',
      database: true,
      provisionUser: true,
      provisionSubjects: subjects
    },
    ['--no-build']
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /7bbebd07|cc1d3627/);
  const calls = f.calls();
  const prepared = calls.findIndex(
    (call) =>
      call[0] === 'node' && call[1] === 'scripts/keycloak-provision-user.mjs'
  );
  assert.notEqual(prepared, -1);
  assert.deepEqual(calls[prepared], [
    'node',
    'scripts/keycloak-provision-user.mjs',
    '--subjects-only'
  ]);
  assert.ok(prepared < calls.findIndex((call) => call[0] === 'migrate'));
  assert.deepEqual(
    calls.find((call) => call[0] === 'owners'),
    ['owners', subjects]
  );
  assert.ok(calls.every((call) => !call.includes('keycloak')));
  assert.ok(calls.every((call) => !call.includes('identity-postgres')));
});

test('application delivery stops before Docker mutations and migrations on failed or malformed subject preparation', (t) => {
  const f = fixture(t);
  for (const changes of [
    { provisionStatus: 17 },
    { provisionSubjects: '' },
    { provisionSubjects: 'not-a-subject' },
    { provisionSubjects: '7bbebd07-2ae6-4a7d-aa22-36fa9111cda8,not-a-subject' },
    {
      provisionSubjects:
        '7bbebd07-2ae6-4a7d-aa22-36fa9111cda8\nprivate-canary-output'
    }
  ]) {
    const result = f.run(
      'deploy.sh',
      {
        enabled: 'true',
        database: true,
        provisionUser: true,
        ...changes
      },
      ['--no-build']
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Keycloak user preparation/);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /private-canary|7bbebd07/
    );
    assert.ok(
      f
        .calls()
        .every(
          (call) =>
            call[0] === 'node' ||
            (call[0] === 'docker' &&
              (call.includes('images') || call.includes('ps')))
        )
    );
  }
});

test('application delivery detects a running orphaned watcher before preparing a Keycloak account', (t) => {
  const f = fixture(t);
  const result = f.run(
    'deploy.sh',
    {
      enabled: 'true',
      provisionUser: true,
      operations: false,
      runningOperations: true
    },
    ['--no-build']
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /An operations container is running/);
  const calls = f.calls();
  assert.ok(
    calls.every((call) => !call.includes('scripts/keycloak-provision-user.mjs'))
  );
  assert.ok(
    calls.every(
      (call) =>
        call[0] === 'node' ||
        (call[0] === 'docker' &&
          (call.includes('images') || call.includes('ps')))
    )
  );
});

test('automatic rollback restores the verified owner after dotenv clears the deployment export', (t) => {
  const f = fixture(t);
  const subjects = '7bbebd07-2ae6-4a7d-aa22-36fa9111cda8';
  const result = f.run(
    'deploy.sh',
    {
      enabled: 'true',
      provisionUser: true,
      provisionSubjects: subjects,
      explicitOwners: '',
      failHealthOnce: true
    },
    ['--no-build']
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /Deployment failed\. Attempting rollback/);
  assert.match(result.stdout, /Rollback succeeded/);
  assert.doesNotMatch(result.stdout + result.stderr, /7bbebd07/);
  const calls = f.calls();
  assert.deepEqual(
    calls.filter((call) => call[0] === 'owners'),
    [
      ['owners', subjects],
      ['owners', subjects]
    ]
  );
  const preparation = calls.filter(
    (call) => call[1] === 'scripts/keycloak-provision-user.mjs'
  );
  assert.deepEqual(preparation, [
    ['node', 'scripts/keycloak-provision-user.mjs', '--subjects-only'],
    ['node', 'scripts/keycloak-provision-user.mjs', '--restore-subjects-only']
  ]);
  const restored = calls.findIndex((call) =>
    call.includes('--restore-subjects-only')
  );
  assert.ok(restored > calls.findIndex((call) => call[0] === 'health'));
  assert.ok(calls.slice(restored + 1).some((call) => call.includes('up')));
  assert.ok(calls.every((call) => !call.includes('keycloak')));
  assert.ok(calls.every((call) => !call.includes('identity-postgres')));
});

test('standalone rollback privately restores the first owner with an empty dotenv list', (t) => {
  const f = fixture(t);
  const subjects = '7bbebd07-2ae6-4a7d-aa22-36fa9111cda8';
  const result = f.run('rollback.sh', {
    enabled: 'true',
    provisionUser: true,
    explicitOwners: '',
    restoreSubjects: subjects
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /7bbebd07/);
  const calls = f.calls();
  assert.deepEqual(calls.slice(0, 2), [
    ['node', 'scripts/keycloak-config.mjs', '--check'],
    ['node', 'scripts/keycloak-provision-user.mjs', '--restore-subjects-only']
  ]);
  assert.deepEqual(
    calls.find((call) => call[0] === 'owners'),
    ['owners', subjects]
  );
  assert.ok(calls.every((call) => !call.includes('--subjects-only')));
  assert.ok(calls.every((call) => !call.includes('keycloak')));
  assert.ok(calls.every((call) => !call.includes('identity-postgres')));
});

test('rollback stops before Docker when private owner restoration fails or returns malformed subjects', (t) => {
  const f = fixture(t);
  for (const changes of [
    { restoreStatus: 17 },
    { restoreSubjects: '' },
    { restoreSubjects: 'not-a-subject' },
    { restoreSubjects: '7bbebd07-2ae6-4a7d-aa22-36fa9111cda8,not-a-subject' },
    {
      restoreSubjects:
        '7bbebd07-2ae6-4a7d-aa22-36fa9111cda8\nprivate-canary-output'
    }
  ]) {
    const result = f.run('rollback.sh', {
      enabled: 'true',
      provisionUser: true,
      explicitOwners: '',
      ...changes
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Keycloak owner subjects/);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /private-canary|7bbebd07/
    );
    assert.ok(f.calls().every((call) => call[0] === 'node'));
  }
});

test('rollback preserves an explicit owner list instead of the prepared person', (t) => {
  const f = fixture(t);
  const subjects =
    'cc1d3627-d9d0-4761-995a-4b011877035b,7bbebd07-2ae6-4a7d-aa22-36fa9111cda8';
  const result = f.run('rollback.sh', {
    enabled: 'true',
    provisionUser: true,
    explicitOwners: subjects,
    restoreSubjects: 'ec8b40c1-d2b5-442b-a132-cf64b0b25b41'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    f.calls().find((call) => call[0] === 'owners'),
    ['owners', subjects]
  );
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /cc1d3627|7bbebd07|ec8b40c1/
  );
});

test('rollback leaves disabled provisioning untouched without loading the restore helper', (t) => {
  const f = fixture(t);
  const result = f.run('rollback.sh', {
    enabled: 'true',
    provisionUser: false,
    restoreStatus: 17
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    f
      .calls()
      .every((call) => !call.includes('scripts/keycloak-provision-user.mjs'))
  );
});
