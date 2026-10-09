import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { createLocalTlsFixture } from './support/local-tls-fixture.mjs';

test('local TLS setup is exposed as a safe package shortcut', () => {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const script = fs.readFileSync('scripts/setup-local-tls.mjs', 'utf8');

  assert.equal(
    packageJson.scripts['tls:local:setup'],
    'node scripts/setup-local-tls.mjs'
  );
  assert.equal(
    packageJson.scripts['tls:local:renew'],
    'node scripts/setup-local-tls.mjs --renew'
  );
  assert.ok(script.includes("'FiloSottile.mkcert'"));
  assert.ok(script.includes("entry.name.startsWith('FiloSottile.mkcert_')"));
  assert.ok(script.includes("run(mkcert, ['-install'])"));
  assert.ok(script.includes('...composeFiles'));

  const help = spawnSync(
    process.execPath,
    ['scripts/setup-local-tls.mjs', '--help'],
    { encoding: 'utf8' }
  );
  assert.equal(help.status, 0);
  assert.match(help.stdout, /yarn tls:local:setup/);
  assert.match(help.stdout, /--no-restart/);
});

test('local certificates are mounted only by the local TLS compose override', () => {
  const compose = fs.readFileSync('docker-compose.yml', 'utf8');
  const localCompose = fs.readFileSync('docker-compose.local-tls.yml', 'utf8');
  const staticConfig = fs.readFileSync('traefik/traefik.yml', 'utf8');
  const localTls = fs.readFileSync('traefik/local-tls.yml', 'utf8');
  const gitignore = fs.readFileSync('.gitignore', 'utf8');

  assert.ok(
    compose.includes('./traefik/dynamic.yml:/etc/traefik/dynamic/routes.yml:ro')
  );
  assert.equal(compose.includes('local-tls.yml'), false);
  assert.ok(staticConfig.includes('directory: /etc/traefik/dynamic'));
  assert.ok(
    localCompose.includes(
      './traefik/local-tls.yml:/etc/traefik/dynamic/local-tls.yml:ro'
    )
  );
  assert.ok(localCompose.includes('./traefik/certs:/certs:ro'));
  assert.ok(localTls.includes('certFile: /certs/localhost.pem'));
  assert.ok(localTls.includes('keyFile: /certs/localhost-key.pem'));
  assert.ok(gitignore.includes('traefik/certs/*'));
});

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

const tlsCliFixture = (t, { identity = true, hosts } = {}) => {
  const root = fs.mkdtempSync(join(tmpdir(), 'og7-local-tls-cli-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('og7-local-tls-cli-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const file of [
    'scripts/setup-local-tls.mjs',
    'scripts/lib/docker-config.mjs',
    'scripts/lib/docker-environment.mjs',
    'scripts/lib/keycloak-config.mjs',
    'scripts/lib/local-identity.mjs',
    'traefik/traefik.yml',
    'traefik/dynamic.yml',
    'traefik/keycloak.yml'
  ]) {
    fs.mkdirSync(dirname(join(root, file)), { recursive: true });
    fs.copyFileSync(file, join(root, file));
  }
  fs.writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'openg7-funding-platform', type: 'module' })
  );
  fs.writeFileSync(
    join(root, '.env'),
    Object.entries({
      FUNDING_PLATFORM_ENV: 'development',
      FUNDING_KEYCLOAK_ENABLED: String(identity),
      FUNDING_KEYCLOAK_HOSTNAME: 'auth.openg7.test',
      FUNDING_PUBLIC_BASE_URL: 'https://localhost',
      FUNDING_ADMIN_AUTH_MODE: identity ? 'oidc' : 'token',
      FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.openg7.test/realms/openg7',
      FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-local-tls-client',
      FUNDING_ADMIN_OIDC_CLIENT_SECRET:
        'private-canary-client-' + 'c'.repeat(32),
      FUNDING_KEYCLOAK_DB_PASSWORD: 'private-canary-db-' + 'd'.repeat(32),
      FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-bootstrap',
      FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
        'private-canary-bootstrap-' + 'b'.repeat(32),
      FUNDING_OPERATIONS_WATCHER_ENABLED: String(identity)
    })
      .map(([name, value]) => `${name}=${value}`)
      .join('\n') + '\n'
  );
  return { root, ...createLocalTlsFixture(root, { hosts }) };
};

// mkcert and Docker-ready are simulated before importing the copied CLI. Only
// real read-only Compose probes may start; no host CA or service can be changed.
const tlsCli = ({ root, caRoot }, args = []) => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, join } from 'node:path';
const nativeSpawnSync = childProcess.spawnSync;
const actions = [];
const restarts = [];
let probes = 0;
childProcess.spawnSync = (command, args, options) => {
  if (/^mkcert(?:\\.exe)?$/.test(basename(command))) {
    assert.equal(args.length, 1);
    assert.ok(['-version', '-install', '-CAROOT'].includes(args[0]), 'Existing leaf certificates must be preserved.');
    actions.push(args[0]);
    return { status: 0, stdout: args[0] === '-CAROOT' ? ${JSON.stringify(caRoot)} : '' };
  }
  if (command === process.execPath && basename(args[0]) === 'docker-ready.mjs') {
    actions.push('restart');
    restarts.push({
      args: args.slice(1),
      cwd: options.cwd,
      preparedBeforeRestart: ['traefik.yml', 'dynamic.yml', 'keycloak.yml'].every(name => fs.existsSync(join(process.cwd(), 'traefik/local', name)))
    });
    return { status: 0 };
  }
  assert.equal(command, 'docker');
  assert.equal(args[0], 'compose');
  assert.ok(args.includes('config'), 'Only read-only Compose probes may execute.');
  probes++;
  return nativeSpawnSync(command, args, options);
};
syncBuiltinESMExports();
process.argv = [process.execPath, 'scripts/setup-local-tls.mjs', ...${JSON.stringify(args)}];
try { await import('./scripts/setup-local-tls.mjs'); }
catch (error) { console.error(error.message); process.exitCode = 1; }
console.log('TLS_CLI_RESULT=' + JSON.stringify({ actions, restarts, probes }));
`
    ],
    {
      cwd: root,
      env: hostEnv,
      encoding: 'utf8',
      timeout: 20_000,
      windowsHide: true
    }
  );
  assert.equal(result.error, undefined);
  assert.doesNotMatch(result.stdout + result.stderr, /private-canary/);
  const report = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('TLS_CLI_RESULT='));
  assert.ok(
    report,
    'The isolated TLS CLI must report its simulated operations.'
  );
  return { ...result, ...JSON.parse(report.slice('TLS_CLI_RESULT='.length)) };
};

test(
  'TLS setup validates and prepares the existing identity certificate before restarting with every overlay',
  { skip: !composeAvailable },
  (t) => {
    const fixture = tlsCliFixture(t);
    const certificate = fs.readFileSync(fixture.certificatePath);
    const result = tlsCli(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.probes, 1);
    assert.deepEqual(result.actions, [
      '-version',
      '-install',
      '-CAROOT',
      'restart'
    ]);
    assert.equal(result.restarts.length, 1);
    const restart = result.restarts[0];
    assert.equal(restart.cwd, fixture.root);
    assert.equal(restart.preparedBeforeRestart, true);
    assert.deepEqual(restart.args.slice(-4), [
      'up',
      '-d',
      '--force-recreate',
      'traefik'
    ]);
    assert.deepEqual(
      restart.args.filter((arg) => arg.endsWith('.yml')),
      [
        'docker-compose.yml',
        'docker-compose.local-tls.yml',
        'docker-compose.operations.yml',
        'docker-compose.identity.yml',
        'docker-compose.identity.local.yml'
      ]
    );
    assert.deepEqual(fs.readFileSync(fixture.certificatePath), certificate);
    assert.deepEqual(
      fs.readFileSync(join(fixture.certificateDirectory, 'rootCA.pem')),
      fs.readFileSync(fixture.caPath)
    );
    assert.deepEqual(fs.readdirSync(fixture.certificateDirectory).sort(), [
      'localhost-key.pem',
      'localhost.pem',
      'rootCA.pem'
    ]);
    for (const name of ['traefik.yml', 'dynamic.yml', 'keycloak.yml'])
      assert.doesNotMatch(
        fs.readFileSync(join(fixture.root, 'traefik/local', name), 'utf8'),
        /certResolver:|certificatesResolvers:|acme:/
      );
  }
);

test(
  'TLS setup delegates missing identity SAN rejection to the shared validator before any restart',
  { skip: !composeAvailable },
  (t) => {
    const fixture = tlsCliFixture(t, { hosts: ['localhost'] });
    const result = tlsCli(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /localhost\/auth\.openg7\.test/);
    assert.match(result.stderr, /tls:local:setup --renew --no-restart/);
    assert.deepEqual(result.restarts, []);
    assert.equal(fs.existsSync(join(fixture.root, 'traefik/local')), false);
    assert.doesNotMatch(result.stdout, /HTTPS local configure/);
  }
);

test(
  'token TLS setup preserves the legacy localhost certificate without requiring identity SAN',
  { skip: !composeAvailable },
  (t) => {
    const fixture = tlsCliFixture(t, { identity: false, hosts: ['localhost'] });
    const certificate = fs.readFileSync(fixture.certificatePath);
    const result = tlsCli(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.restarts.length, 1);
    assert.equal(result.restarts[0].preparedBeforeRestart, false);
    assert.deepEqual(
      result.restarts[0].args.filter((arg) => arg.endsWith('.yml')),
      ['docker-compose.yml', 'docker-compose.local-tls.yml']
    );
    assert.deepEqual(fs.readFileSync(fixture.certificatePath), certificate);
    assert.match(
      result.stdout,
      /certificat HTTPS local existe deja; il est conserve/
    );
    assert.equal(fs.existsSync(join(fixture.root, 'traefik/local')), false);
  }
);

test(
  'TLS setup with no-restart still prepares and validates the local identity files',
  { skip: !composeAvailable },
  (t) => {
    const fixture = tlsCliFixture(t);
    const result = tlsCli(fixture, ['--no-restart']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.restarts, []);
    assert.equal(fs.readdirSync(join(fixture.root, 'traefik/local')).length, 3);
  }
);
