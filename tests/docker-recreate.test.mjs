import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
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

const hostEnv = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]])
);
const composeAvailable =
  spawnSync('docker', ['compose', 'version'], {
    env: hostEnv,
    stdio: 'ignore',
    windowsHide: true
  }).status === 0;
const localConfiguration = {
  FUNDING_PLATFORM_ENV: 'development',
  FUNDING_KEYCLOAK_ENABLED: 'true',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.openg7.test',
  FUNDING_PUBLIC_BASE_URL: 'https://localhost',
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.openg7.test/realms/openg7',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-recreate-client',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'private-canary-client-' + 'c'.repeat(32),
  FUNDING_KEYCLOAK_DB_PASSWORD: 'private-canary-db-' + 'd'.repeat(32),
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-bootstrap',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
    'private-canary-bootstrap-' + 'b'.repeat(32),
  FUNDING_OPERATIONS_WATCHER_ENABLED: 'false',
  COMPOSE_PROFILES: 'database,metrics',
  POSTGRES_PASSWORD: 'private-canary-postgres',
  DATABASE_URL: 'postgresql://fixture:${POSTGRES_PASSWORD}@postgres/fixture'
};

const fixture = (t, changes = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'og7-docker-recreate-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('og7-docker-recreate-'));
    rmSync(root, { recursive: true, force: true });
  });
  for (const file of [
    'scripts/docker-recreate.mjs',
    'scripts/lib/docker-config.mjs',
    'scripts/lib/docker-environment.mjs',
    'scripts/lib/keycloak-config.mjs',
    'scripts/lib/local-identity.mjs',
    'scripts/lib/keycloak-initial-user.mjs',
    'docker-compose.yml',
    'docker-compose.local-tls.yml',
    'docker-compose.identity.yml',
    'docker-compose.identity.local.yml',
    'traefik/traefik.yml',
    'traefik/dynamic.yml',
    'traefik/keycloak.yml',
    'traefik/local-tls.yml'
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(file, join(root, file));
  }
  writeFileSync(
    join(root, '.env'),
    Object.entries({ ...localConfiguration, ...changes })
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n') + '\n'
  );
  return root;
};

// Compose configuration probes run normally against the synthetic .env. Only
// calls to docker-ready are simulated; unexpected commands cannot mutate Docker.
const cli = (root, args = [], { failure = false, env = {} } = {}) => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const nativeSpawnSync = childProcess.spawnSync;
const originalEnv = { ...process.env };
let probes = 0;
const calls = [];
childProcess.spawnSync = (command, args, options) => {
  if (command === process.execPath && args[0] === 'scripts/docker-ready.mjs') {
    const privateNames = [
      'FUNDING_ADMIN_OIDC_CLIENT_SECRET', 'FUNDING_KEYCLOAK_DB_PASSWORD',
      'FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD', 'POSTGRES_PASSWORD', 'DATABASE_URL'
    ];
    calls.push({
      args,
      cwd: options.cwd,
      preservesShell: Object.entries(originalEnv).every(([name,value]) => options.env[name] === value),
      exportedPrivateNames: privateNames.filter(name => Object.hasOwn(options.env,name)),
      platform: options.env.FUNDING_PLATFORM_ENV ?? null,
      profiles: options.env.COMPOSE_PROFILES ?? null,
      marker: options.env.RECREATE_SHELL_MARKER
    });
    return { status: ${failure ? '17' : '0'} };
  }
  assert.equal(command, 'docker');
  assert.equal(args[0], 'compose');
  assert.ok(args.includes('config'), 'Only read-only Compose probes may execute.');
  probes++;
  return nativeSpawnSync(command, args, options);
};
syncBuiltinESMExports();
process.argv = [process.execPath, 'scripts/docker-recreate.mjs', ...${JSON.stringify(args)}];
await import('./scripts/docker-recreate.mjs');
console.log('RECREATE_RESULT=' + JSON.stringify({ calls, probes }));
`
    ],
    {
      cwd: root,
      env: { ...hostEnv, RECREATE_SHELL_MARKER: 'synthetic-shell', ...env },
      encoding: 'utf8',
      timeout: 20_000,
      windowsHide: true
    }
  );
  assert.equal(result.error, undefined);
  assert.doesNotMatch(result.stdout + result.stderr, /private-canary/);
  const report = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('RECREATE_RESULT='));
  assert.ok(report, 'The isolated CLI must return its captured invocations.');
  return { ...result, ...JSON.parse(report.slice('RECREATE_RESULT='.length)) };
};

const render = (root, readyArgs, env = {}) => {
  assert.deepEqual(readyArgs.slice(0, 3), [
    'scripts/docker-ready.mjs',
    '--',
    'docker'
  ]);
  assert.deepEqual(readyArgs.slice(-2), ['config', '--quiet']);
  const result = spawnSync(
    'docker',
    [...readyArgs.slice(3, -1), '--format', 'json'],
    {
      cwd: root,
      env: { ...hostEnv, ...env },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000
    }
  );
  assert.equal(result.status, 0, 'The synthetic Compose model must resolve.');
  return JSON.parse(result.stdout);
};

test(
  'recreate keeps real local CA, alias and loopback configuration without exporting dotenv secrets',
  { skip: !composeAvailable },
  (t) => {
    const root = fixture(t);
    createLocalTlsFixture(root);
    const result = cli(root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.probes, 1);
    assert.equal(result.calls.length, 2);
    for (const call of result.calls) {
      assert.equal(call.cwd, root);
      assert.equal(call.preservesShell, true);
      assert.deepEqual(call.exportedPrivateNames, []);
      assert.equal(call.platform, null);
      assert.equal(call.profiles, null);
      assert.equal(call.marker, 'synthetic-shell');
      assert.deepEqual(
        call.args.filter((arg) => arg.endsWith('.yml')),
        [
          'docker-compose.yml',
          'docker-compose.local-tls.yml',
          'docker-compose.identity.yml',
          'docker-compose.identity.local.yml'
        ]
      );
      assert.ok(
        !call.args.some((arg) =>
          ['build', 'pull', 'prune', 'down', '--remove-orphans'].includes(arg)
        )
      );
    }
    assert.deepEqual(result.calls[1].args.slice(-5), [
      'up',
      '-d',
      '--force-recreate',
      'api',
      'web'
    ]);
    assert.deepEqual(readdirSync(join(root, 'traefik/local')).sort(), [
      'dynamic.yml',
      'keycloak.yml',
      'traefik.yml'
    ]);
    const model = render(root, result.calls[0].args);
    assert.equal(
      model.services.api.environment.NODE_EXTRA_CA_CERTS,
      '/certs/rootCA.pem'
    );
    const caMount = model.services.api.volumes.find(
      ({ target }) => target === '/certs/rootCA.pem'
    );
    assert.ok(caMount);
    assert.equal(caMount.read_only, true);
    assert.equal(
      caMount.source.replaceAll('\\', '/'),
      join(root, 'traefik/certs/rootCA.pem').replaceAll('\\', '/')
    );
    assert.ok(
      model.services.traefik.networks.edge.aliases.includes('auth.openg7.test')
    );
    assert.ok(
      model.services.traefik.ports.every(
        ({ host_ip }) => host_ip === '127.0.0.1'
      )
    );
    assert.deepEqual(model.services.traefik.command, [
      '--configFile=/etc/traefik/traefik.yml'
    ]);
    assert.ok(
      model.services.postgres,
      'The inherited database profile must remain active.'
    );
  }
);

test(
  'recreate refuses a missing public CA before any Docker-ready call',
  { skip: !composeAvailable },
  (t) => {
    const root = fixture(t);
    createLocalTlsFixture(root);
    rmSync(join(root, 'traefik/certs/rootCA.pem'));
    const result = cli(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /tls:local:setup/);
    assert.deepEqual(result.calls, []);
    assert.equal(existsSync(join(root, 'traefik/local')), false);
  }
);

test(
  'a failed Compose preflight prevents application recreation',
  { skip: !composeAvailable },
  (t) => {
    const root = fixture(t, {
      FUNDING_KEYCLOAK_ENABLED: 'false',
      FUNDING_PLATFORM_ENV: 'production'
    });
    const result = cli(root, [], { failure: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Docker recreation failed/);
    assert.equal(result.calls.length, 1);
    assert.deepEqual(result.calls[0].args.slice(-2), ['config', '--quiet']);
  }
);

test(
  'dry-run resolves local overlays without preparing files or calling Docker-ready',
  { skip: !composeAvailable },
  (t) => {
    const root = fixture(t);
    createLocalTlsFixture(root);
    const result = cli(root, ['--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.probes, 1);
    assert.deepEqual(result.calls, []);
    assert.match(result.stdout, /docker-compose.identity.local.yml/);
    assert.match(result.stdout, /up -d --force-recreate api web/);
    assert.equal(existsSync(join(root, 'traefik/local')), false);
  }
);

test(
  'production and default recreation preserve existing images and volumes despite local certificate files',
  { skip: !composeAvailable },
  (t) => {
    for (const platform of ['production', undefined]) {
      const root = fixture(t, {
        FUNDING_KEYCLOAK_ENABLED: 'false',
        FUNDING_PLATFORM_ENV: platform
      });
      createLocalTlsFixture(root);
      const result = cli(root);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.calls.length, 2);
      assert.deepEqual(result.calls[1].args, [
        'scripts/docker-ready.mjs',
        '--',
        'docker',
        'compose',
        'up',
        '-d',
        '--force-recreate',
        'api',
        'web'
      ]);
      assert.equal(existsSync(join(root, 'traefik/local')), false);
      const model = render(root, result.calls[0].args);
      assert.equal(
        model.services.api.environment.NODE_EXTRA_CA_CERTS,
        undefined
      );
      assert.equal(model.services.api.image, 'openg7-funding-api:local');
      assert.deepEqual(
        model.services.api.volumes.map(({ source }) => source),
        ['sponsor-logos']
      );
      assert.equal(model.volumes['sponsor-logos'].name, 'openg7-sponsor-logos');
    }
  }
);

test(
  'custom Compose files without managed identity retain shell precedence and inherited profiles',
  { skip: !composeAvailable },
  (t) => {
    const root = fixture(t, {
      FUNDING_KEYCLOAK_ENABLED: 'false',
      COMPOSE_FILE: 'custom/compose.yml'
    });
    createLocalTlsFixture(root);
    mkdirSync(join(root, 'custom'));
    writeFileSync(
      join(root, 'custom/.env'),
      'FUNDING_PLATFORM_ENV=production\n'
    );
    writeFileSync(
      join(root, 'custom/compose.yml'),
      'services:\n  api:\n    image: fixture-api\n  web:\n    image: fixture-web\n  metric:\n    image: fixture-metric\n    profiles: [metrics]\n'
    );
    const env = { COMPOSE_PROFILES: 'metrics' };
    const result = cli(root, [], { env });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(
      result.probes > 1,
      'Compose must resolve the nested custom project.'
    );
    assert.equal(result.calls.length, 2);
    for (const call of result.calls) {
      assert.equal(call.profiles, 'metrics');
      assert.equal(call.preservesShell, true);
      assert.deepEqual(call.exportedPrivateNames, []);
      assert.ok(!call.args.includes('-f'));
    }
    assert.equal(existsSync(join(root, 'traefik/local')), false);
    const model = render(root, result.calls[0].args, env);
    assert.equal(model.services.api.image, 'fixture-api');
    assert.equal(model.services.web.image, 'fixture-web');
    assert.ok(model.services.metric);
  }
);

test('recreate shortcut and help cannot execute Docker-ready or resolve environment files', (t) => {
  assert.equal(
    JSON.parse(readFileSync('package.json', 'utf8')).scripts['docker:recreate'],
    'node scripts/docker-recreate.mjs'
  );
  const root = fixture(t);
  for (const args of [['--help'], ['--unknown']]) {
    const result = cli(root, args);
    assert.equal(result.status, args[0] === '--help' ? 0 : 1);
    assert.equal(result.probes, 0);
    assert.deepEqual(result.calls, []);
    assert.equal(existsSync(join(root, 'traefik/local')), false);
  }
});
