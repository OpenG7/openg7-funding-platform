import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { dockerComposeFileArgs } from '../scripts/lib/docker-config.mjs';
import { dockerUpPlan } from '../scripts/lib/docker-up.mjs';
import { dockerUpdatePlan } from '../scripts/lib/docker-update.mjs';
import {
  copyPublicLocalCa,
  localTraefikConfiguration,
  prepareLocalIdentity,
  validateLocalIdentityConfig
} from '../scripts/lib/local-identity.mjs';
import { createLocalTlsFixture } from './support/local-tls-fixture.mjs';

const hostEnv = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name]])
);
const composeAvailable =
  spawnSync('docker', ['compose', 'version'], {
    env: hostEnv,
    stdio: 'ignore',
    windowsHide: true
  }).status === 0;

const configuration = {
  FUNDING_PLATFORM_ENV: 'development',
  FUNDING_KEYCLOAK_ENABLED: 'true',
  FUNDING_KEYCLOAK_HOSTNAME: 'auth.openg7.test',
  FUNDING_PUBLIC_BASE_URL: 'https://localhost',
  FUNDING_ADMIN_AUTH_MODE: 'oidc',
  FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.openg7.test/realms/openg7',
  FUNDING_ADMIN_OIDC_CLIENT_ID: 'openg7-funding-admin',
  FUNDING_ADMIN_OIDC_CLIENT_SECRET: 'synthetic-client-' + 'c'.repeat(32),
  FUNDING_KEYCLOAK_DB_PASSWORD: 'synthetic-db-' + 'd'.repeat(32),
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-bootstrap',
  FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
    'synthetic-bootstrap-' + 'b'.repeat(32)
};
const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'og7-local-identity-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('og7-local-identity-'));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'traefik'));
  for (const name of ['traefik.yml', 'dynamic.yml', 'keycloak.yml'])
    writeFileSync(
      join(root, 'traefik', name),
      readFileSync(join('traefik', name))
    );
  return root;
};

test('local identity keeps production validation and requires explicit development HTTPS origins', () => {
  assert.equal(validateLocalIdentityConfig(configuration), true);
  assert.equal(
    validateLocalIdentityConfig({
      ...configuration,
      FUNDING_PUBLIC_BASE_URL: 'https://localhost:8443'
    }),
    true
  );
  for (const change of [
    { FUNDING_PLATFORM_ENV: 'production' },
    { FUNDING_PLATFORM_ENV: 'test' },
    { FUNDING_KEYCLOAK_ENABLED: 'false' },
    {
      FUNDING_KEYCLOAK_HOSTNAME: 'auth.other.test',
      FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.other.test/realms/openg7'
    },
    { FUNDING_PUBLIC_BASE_URL: 'https://public.example.test' },
    { FUNDING_PUBLIC_BASE_URL: 'http://localhost' },
    { FUNDING_PUBLIC_BASE_URL: 'https://localhost/path' },
    { FUNDING_ADMIN_AUTH_MODE: 'token' },
    { FUNDING_ADMIN_OIDC_CLIENT_SECRET: '' },
    { FUNDING_ADMIN_OIDC_MFA_ACR: '1' },
    { COMPOSE_FILE: 'custom.yml' }
  ])
    assert.throws(() =>
      validateLocalIdentityConfig({ ...configuration, ...change })
    );
});

test('local startup and update retain every overlay and refuse a production or missing TLS fallback', () => {
  const env = { ...configuration, FUNDING_OPERATIONS_WATCHER_ENABLED: 'true' };
  const files = [
    'docker-compose.yml',
    'docker-compose.local-tls.yml',
    'docker-compose.operations.yml',
    'docker-compose.identity.yml',
    'docker-compose.identity.local.yml'
  ];
  const up = dockerUpPlan(
    { environment: 'development', database: true, stripeWebhook: false },
    { env, localTls: true }
  );
  const update = dockerUpdatePlan(
    {
      targetEnvironment: 'development',
      useDatabase: true,
      buildAppFirst: false,
      pruneImages: false,
      startStripeWebhook: false
    },
    { env, localTls: true }
  );
  for (const args of [
    ...up.commands,
    ...update.commands
      .filter(({ command }) => command === 'docker')
      .map(({ args }) => args)
  ]) {
    assert.deepEqual(
      args.filter((arg) => files.includes(arg)),
      files
    );
    assert.ok(args.includes('database'));
  }
  assert.throws(() => dockerComposeFileArgs(env), /tls:local:setup/);
  assert.throws(
    () => dockerUpPlan({ environment: 'production' }, { env, localTls: true }),
    /development/
  );
  assert.throws(
    () =>
      dockerUpdatePlan(
        { targetEnvironment: 'production' },
        { env, localTls: true }
      ),
    /development/
  );
  const external = {
    ...configuration,
    FUNDING_PLATFORM_ENV: 'production',
    FUNDING_KEYCLOAK_HOSTNAME: 'auth.example.test',
    FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.example.test/realms/openg7'
  };
  assert.deepEqual(dockerComposeFileArgs(external), [
    '-f',
    'docker-compose.yml',
    '-f',
    'docker-compose.identity.yml'
  ]);
  assert.deepEqual(
    dockerComposeFileArgs({ FUNDING_KEYCLOAK_ENABLED: 'false' }),
    []
  );
});

test('preparation derives only ACME changes and preserves canonical middleware, HTTPS and TLS policies', (t) => {
  const root = fixture(t);
  createLocalTlsFixture(root);
  const canonical = Object.fromEntries(
    ['traefik.yml', 'dynamic.yml', 'keycloak.yml'].map((name) => [
      name,
      readFileSync(join(root, 'traefik', name), 'utf8')
    ])
  );
  const files = prepareLocalIdentity({ root, env: configuration });
  assert.equal(files.length, 3);
  const outputs = files.map((file) => readFileSync(file, 'utf8'));
  assert.match(outputs[0], /scheme: https/);
  assert.match(outputs[0], /options: modern@file/);
  assert.match(outputs[1], /minVersion: VersionTLS12/);
  assert.match(outputs[1], /contentSecurityPolicy:/);
  assert.match(
    outputs[2],
    /middlewares: \[keycloak-headers, keycloak-in-flight, keycloak-rate-limit\]/
  );
  for (let i = 0; i < files.length; i++) {
    assert.doesNotMatch(
      outputs[i],
      /certResolver:|certificatesResolvers:|acme:/
    );
    const name = ['traefik.yml', 'dynamic.yml', 'keycloak.yml'][i];
    assert.equal(
      readFileSync(join(root, 'traefik', name), 'utf8'),
      canonical[name]
    );
  }
  prepareLocalIdentity({ root, env: configuration });
  assert.deepEqual(
    files.map((file) => readFileSync(file, 'utf8')),
    outputs
  );
  assert.deepEqual(readdirSync(join(root, 'traefik', 'certs')).sort(), [
    'localhost-key.pem',
    'localhost.pem',
    'rootCA.pem'
  ]);
  assert.throws(
    () => localTraefikConfiguration('http:\n  routers:\n    missing-tls: {}\n'),
    /canonical/
  );
  assert.throws(
    () =>
      localTraefikConfiguration(
        canonical['traefik.yml'].replace('    acme:', '    unexpected:'),
        { staticConfig: true }
      ),
    /canonical/
  );
});

test('preparation refuses absent, wrong-domain, mismatched and private CA files before generating anything', (t) => {
  const root = fixture(t);
  const absent = () =>
    assert.throws(
      () => prepareLocalIdentity({ root, env: configuration }),
      /tls:local:setup/
    );
  absent();
  assert.throws(() => readdirSync(join(root, 'traefik', 'local')));
  const tls = createLocalTlsFixture(root, { hosts: ['localhost'] });
  absent();
  createLocalTlsFixture(root);
  const key = readFileSync(tls.keyPath);
  writeFileSync(tls.keyPath, 'private-canary');
  absent();
  writeFileSync(tls.keyPath, key);
  writeFileSync(
    join(tls.certificateDirectory, 'rootCA.pem'),
    '-----BEGIN PRIVATE KEY-----\nprivate-canary'
  );
  assert.throws(
    () => prepareLocalIdentity({ root, env: configuration }),
    (error) => !error.message.includes('private-canary')
  );
  assert.throws(() => readdirSync(join(root, 'traefik', 'local')));
});

test('CA export copies the public certificate and refuses a private-key payload', (t) => {
  const root = fixture(t);
  const tls = createLocalTlsFixture(root);
  const destination = join(root, 'exported');
  copyPublicLocalCa(tls.caRoot, destination);
  assert.deepEqual(readdirSync(destination), ['rootCA.pem']);
  assert.equal(
    readFileSync(join(destination, 'rootCA.pem'), 'utf8'),
    readFileSync(tls.caPath, 'utf8')
  );
  writeFileSync(tls.caPath, '-----BEGIN PRIVATE KEY-----\nprivate-canary');
  assert.throws(
    () => copyPublicLocalCa(tls.caRoot, destination),
    (error) => !error.message.includes('private-canary')
  );
});

test('local overlay trusts only the public CA and preserves the canonical identity network isolation', () => {
  const local = readFileSync('docker-compose.identity.local.yml', 'utf8');
  const identity = readFileSync('docker-compose.identity.yml', 'utf8');
  assert.match(local, /aliases: \[auth\.openg7\.test\]/);
  assert.match(local, /NODE_EXTRA_CA_CERTS: \/certs\/rootCA\.pem/);
  assert.match(local, /rootCA\.pem:\/certs\/rootCA\.pem:ro/);
  assert.doesNotMatch(
    local,
    /rootCA-key|NODE_TLS_REJECT_UNAUTHORIZED|insecureSkipVerify/
  );
  assert.match(local, /ports: !override/);
  const ports = local.match(/127\.0\.0\.1:[0-9]+:[0-9]+(?:\/udp)?/g);
  assert.deepEqual(ports, [
    '127.0.0.1:80:80',
    '127.0.0.1:443:443',
    '127.0.0.1:443:443/udp',
    '127.0.0.1:8081:8080'
  ]);
  assert.match(identity, /internal: true/);
  assert.match(
    identity,
    /command: \['start', '--optimized', '--import-realm'\]/
  );
});

test(
  'the resolved local Compose model publishes only loopback proxy ports and keeps both databases private',
  { skip: !composeAvailable },
  (t) => {
    const root = fixture(t);
    createLocalTlsFixture(root);
    prepareLocalIdentity({ root, env: configuration });
    const names = [
      'docker-compose.yml',
      'docker-compose.local-tls.yml',
      'docker-compose.identity.yml',
      'docker-compose.identity.local.yml'
    ];
    for (const name of names)
      writeFileSync(join(root, name), readFileSync(name));
    const render = (files) => {
      const result = spawnSync(
        'docker',
        [
          'compose',
          '--project-directory',
          root,
          '-p',
          'og7-local-identity-model',
          ...files.flatMap((name) => ['-f', join(root, name)]),
          '--profile',
          'database',
          'config',
          '--format',
          'json'
        ],
        {
          env: { ...hostEnv, ...configuration },
          encoding: 'utf8',
          stdio: 'pipe',
          windowsHide: true,
          timeout: 15000
        }
      );
      assert.equal(
        result.status,
        0,
        'The synthetic Compose model must resolve without Docker daemon access.'
      );
      return JSON.parse(result.stdout);
    };
    const local = render(names);
    assert.equal(local.services.traefik.ports.length, 4);
    assert.ok(
      local.services.traefik.ports.every((port) => port.host_ip === '127.0.0.1')
    );
    assert.deepEqual(local.services.traefik.command, [
      '--configFile=/etc/traefik/traefik.yml'
    ]);
    assert.ok(
      local.services.traefik.networks.edge.aliases.includes('auth.openg7.test')
    );
    assert.equal(
      local.services.api.environment.NODE_EXTRA_CA_CERTS,
      '/certs/rootCA.pem'
    );
    const mount = local.services.api.volumes.find(
      ({ target }) => target === '/certs/rootCA.pem'
    );
    assert.equal(mount.read_only, true);
    assert.equal(
      mount.source.replaceAll('\\', '/'),
      join(root, 'traefik', 'certs', 'rootCA.pem').replaceAll('\\', '/')
    );
    for (const name of ['postgres', 'identity-postgres', 'keycloak'])
      assert.equal(local.services[name].ports, undefined);
    assert.deepEqual(
      Object.keys(local.services['identity-postgres'].networks),
      ['identity-data']
    );
    assert.equal(local.networks['identity-data'].internal, true);
    assert.equal(local.networks.data.internal, true);
    const canonical = render([
      'docker-compose.yml',
      'docker-compose.identity.yml'
    ]);
    assert.equal(
      canonical.services.api.environment.NODE_EXTRA_CA_CERTS,
      undefined
    );
    assert.equal(canonical.services.traefik.networks.edge?.aliases, undefined);
    assert.ok(
      canonical.services.traefik.command.some((arg) =>
        arg.includes('certificatesResolvers')
      )
    );
  }
);
