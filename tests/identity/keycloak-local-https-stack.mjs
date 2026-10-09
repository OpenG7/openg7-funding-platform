import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildMigrationSql,
  readMigrations
} from '../../scripts/lib/database-migrations.mjs';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';
import { prepareLocalIdentity } from '../../scripts/lib/local-identity.mjs';
import { createLocalHttpsExchange } from './local-https-exchange.mjs';

const execute = promisify(execFile);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hostname = 'auth.openg7.test';
const composeFiles = [
  'docker-compose.yml',
  'docker-compose.local-tls.yml',
  'docker-compose.identity.yml',
  'docker-compose.identity.local.yml'
];
const images = {
  api:
    process.env.OPENG7_TEST_KEYCLOAK_API_IMAGE ||
    'openg7-keycloak-local-validation-api:test',
  web:
    process.env.OPENG7_TEST_KEYCLOAK_WEB_IMAGE ||
    'openg7-keycloak-local-validation-web:test',
  keycloak: 'openg7-keycloak:26.8.0-local',
  postgres: 'postgres:16-alpine',
  traefik: 'traefik:v3.7.13'
};

/** Metadata only: mkcert must never create a new host CA for this rehearsal. */
export async function assertExistingMkcertCa(caRoot) {
  try {
    if (!caRoot) throw new Error();
    const files = await Promise.all(
      ['rootCA.pem', 'rootCA-key.pem'].map((file) => stat(join(caRoot, file)))
    );
    if (files.some((file) => !file.isFile())) throw new Error();
  } catch {
    throw new Error(
      'An existing mkcert CA certificate and private key are required; this rehearsal never creates a CA.'
    );
  }
}

export const eventually = async (operation, description, timeout = 120_000) => {
  const deadline = Date.now() + timeout;
  while (true) {
    try {
      return await operation();
    } catch {
      if (Date.now() >= deadline) throw new Error(description);
      await setTimeout(250);
    }
  }
};

// All Docker calls name this fixture's project; inherited application credentials
// and the checkout's .env are never consulted. Command errors omit sensitive output.
export async function startLocalKeycloakHttpsStack() {
  if (Number(process.versions.node.split('.')[0]) < 22)
    throw new Error(
      'Local Keycloak HTTPS acceptance requires Node 22 or newer.'
    );
  const clean = Object.fromEntries(
    [
      'PATH',
      'Path',
      'SystemRoot',
      'WINDIR',
      'TEMP',
      'TMP',
      'USERPROFILE',
      'HOME',
      'LOCALAPPDATA',
      'APPDATA'
    ]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]])
  );
  const run = async (command, args, { input, ...options } = {}) => {
    try {
      const pending = execute(command, args, {
        env: clean,
        windowsHide: true,
        timeout: 180_000,
        maxBuffer: 16 * 1024 * 1024,
        encoding: 'utf8',
        ...options
      });
      pending.child.stdin.end(input || '');
      return (await pending).stdout.trim();
    } catch {
      throw new Error(
        'Disposable Keycloak HTTPS command failed; command output is withheld.'
      );
    }
  };
  const context = await run('docker', ['context', 'show']);
  const endpoint = await run('docker', [
    'context',
    'inspect',
    context,
    '--format',
    '{{.Endpoints.docker.Host}}'
  ]);
  assert.ok(
    /^(?:npipe|unix):\/\//.test(endpoint),
    'A local Docker socket is required.'
  );
  const docker = (args, options) =>
    run('docker', ['--context', context, ...args], options);
  assert.equal(await docker(['info', '--format', '{{.OSType}}']), 'linux');
  for (const image of Object.values(images))
    await docker(['image', 'inspect', image, '--format', '{{.Id}}']);

  const root = await mkdtemp(join(tmpdir(), 'og7-keycloak-https-'));
  const project = 'og7-keycloak-https-' + randomUUID().slice(0, 12);
  const ownerSubject = randomUUID();
  const password = randomBytes(24).toString('hex');
  const runtime = {
    role: 'fixture_runtime',
    database: 'fixture_funding',
    password: randomBytes(32).toString('hex')
  };
  const env = {
    API_IMAGE: images.api,
    WEB_IMAGE: images.web,
    FUNDING_PLATFORM_ENV: 'development',
    FUNDING_KEYCLOAK_ENABLED: 'true',
    FUNDING_KEYCLOAK_HOSTNAME: hostname,
    FUNDING_KEYCLOAK_DB_PASSWORD: randomBytes(32).toString('hex'),
    FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-bootstrap',
    FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD: randomBytes(32).toString('hex'),
    FUNDING_PUBLIC_BASE_URL: 'https://localhost',
    FUNDING_ALLOWED_ORIGINS: 'https://localhost',
    FUNDING_ADMIN_AUTH_MODE: 'oidc',
    FUNDING_ADMIN_OIDC_ISSUER: `https://${hostname}/realms/openg7`,
    FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-local-funding',
    FUNDING_ADMIN_OIDC_CLIENT_SECRET: randomBytes(32).toString('hex'),
    FUNDING_ADMIN_OIDC_OWNER_SUBJECTS: ownerSubject,
    FUNDING_ADMIN_OIDC_MFA_ACR: '',
    FUNDING_PRIVATE_DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    FUNDING_ADMIN_RATE_LIMIT_MAX: '0',
    FUNDING_ADMIN_REVIEW_REMINDER_ENABLED: 'false',
    FUNDING_EMAIL_WORKER_ENABLED: 'false',
    FUNDING_CONTRIBUTION_EMAIL_ENABLED: 'false',
    FUNDING_CONTRIBUTION_SMS_MODE: 'disabled',
    SMTP_ENABLED: 'false',
    SOCIAL_PUBLICATION_WORKER_ENABLED: 'false',
    SOCIAL_PUBLICATION_MODE: 'disabled',
    POSTGRES_DB: runtime.database,
    POSTGRES_USER: 'fixture_owner',
    POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
    DATABASE_URL: `postgresql://${runtime.role}:${runtime.password}@postgres:5432/${runtime.database}`,
    COMPOSE_PROJECT_NAME: project,
    POSTGRES_VOLUME_NAME: project + '-postgres-data',
    SPONSOR_LOGOS_VOLUME_NAME: project + '-sponsor-logos',
    OPENG7_EDGE_NETWORK_NAME: project + '-edge',
    OPENG7_DATA_NETWORK_NAME: project + '-data'
  };
  const envFile = join(root, 'fixture.env');
  const compose = (args, options) =>
    docker(
      [
        'compose',
        '--project-directory',
        root,
        '--env-file',
        envFile,
        '-p',
        project,
        ...[...composeFiles, 'docker-compose.rehearsal.yml'].flatMap((file) => [
          '-f',
          join(root, file)
        ]),
        '--profile',
        'database',
        ...args
      ],
      options
    );
  let initialized = false;
  const stop = async () => {
    if (initialized)
      await compose([
        'down',
        '--volumes',
        '--remove-orphans',
        '--timeout',
        '15'
      ]);
    const target = resolve(root);
    assert.ok(
      target.startsWith(resolve(tmpdir()) + sep + 'og7-keycloak-https-')
    );
    await rm(target, { recursive: true, force: true });
  };
  try {
    for (const file of [
      ...composeFiles,
      'traefik/traefik.yml',
      'traefik/dynamic.yml',
      'traefik/keycloak.yml',
      'traefik/local-tls.yml'
    ]) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await copyFile(join(repository, file), join(root, file));
    }
    const certs = join(root, 'traefik/certs');
    await mkdir(certs, { recursive: true });
    if (process.env.OPENG7_TEST_TLS_DIRECTORY) {
      // The invoking disposable Linux validator trusts this CA before launching.
      for (const file of ['localhost.pem', 'localhost-key.pem', 'rootCA.pem'])
        await copyFile(
          join(process.env.OPENG7_TEST_TLS_DIRECTORY, file),
          join(certs, file)
        );
    } else {
      const mkcert =
        process.env.OPENG7_TEST_MKCERT ||
        (process.platform === 'win32'
          ? join(
              process.env.LOCALAPPDATA || '',
              'Microsoft/WinGet/Packages/FiloSottile.mkcert_Microsoft.Winget.Source_8wekyb3d8bbwe/mkcert.exe'
            )
          : 'mkcert');
      const caRoot = await run(mkcert, ['-CAROOT']);
      await assertExistingMkcertCa(caRoot);
      await run(mkcert, [
        '-cert-file',
        join(certs, 'localhost.pem'),
        '-key-file',
        join(certs, 'localhost-key.pem'),
        'localhost',
        '127.0.0.1',
        '::1',
        hostname
      ]);
      await copyFile(join(caRoot, 'rootCA.pem'), join(certs, 'rootCA.pem'));
    }
    const realm = JSON.parse(
      await readFile(
        join(repository, 'docker/keycloak/openg7-realm.json'),
        'utf8'
      )
    );
    assert.equal(realm.sslRequired, 'all');
    realm.users = [
      {
        id: ownerSubject,
        username: 'synthetic-local-owner',
        enabled: true,
        email: 'synthetic-local-owner@example.test',
        emailVerified: true,
        firstName: 'Synthetic',
        lastName: 'Administrator',
        credentials: [{ type: 'password', value: password, temporary: false }]
      }
    ];
    await mkdir(join(root, 'docker/keycloak'), { recursive: true });
    await writeFile(
      join(root, 'docker/keycloak/openg7-realm.json'),
      JSON.stringify(realm),
      // Keycloak runs as UID 1000; the enclosing fixture directory stays private.
      { mode: 0o644 }
    );
    await writeFile(
      join(root, 'docker-compose.rehearsal.yml'),
      `services:
  traefik:
    ports: !override ['127.0.0.1::443']
    restart: 'no'
    healthcheck: { interval: 2s, start_period: 1s }
  postgres:
    volumes: !override []
    tmpfs: [/var/lib/postgresql/data]
    restart: 'no'
    healthcheck: { test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'], interval: 2s, start_period: 1s }
  identity-postgres:
    volumes: !override []
    tmpfs: [/var/lib/postgresql/data]
    restart: 'no'
    healthcheck: { test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'], interval: 2s, start_period: 1s }
  keycloak:
    image: ${images.keycloak}
    volumes:
      - ./docker/keycloak/openg7-realm.json:/opt/keycloak/data/import/openg7-realm.json:ro
    restart: 'no'
    healthcheck: { interval: 2s }
  api:
    restart: 'no'
    healthcheck: { interval: 2s, start_period: 1s }
  web:
    ports: !override []
    restart: 'no'
    healthcheck: { interval: 2s, start_period: 1s }
`,
      { mode: 0o600 }
    );
    const configure = async () => {
      await writeFile(
        envFile,
        Object.entries(env)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n') + '\n',
        { mode: 0o600 }
      );
      prepareLocalIdentity({ root, env });
      await compose(['config', '--quiet']);
    };
    await configure();
    initialized = true;
    await compose(['up', '-d', '--no-build', '--pull', 'never', 'traefik']);
    const match = /^127\.0\.0\.1:(\d+)$/.exec(
      await compose(['port', 'traefik', '443'])
    );
    assert.ok(match, 'Only an ephemeral loopback HTTPS port may be published.');
    const port = Number(match[1]);
    const origin = `https://localhost:${port}`;
    env.FUNDING_PUBLIC_BASE_URL = origin;
    env.FUNDING_ALLOWED_ORIGINS = origin;
    await configure();
    await compose([
      'up',
      '-d',
      '--no-build',
      '--pull',
      'never',
      'postgres',
      'identity-postgres'
    ]);
    const sql = async (statement) =>
      compose(
        [
          'exec',
          '-T',
          'postgres',
          'sh',
          '-c',
          'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -h 127.0.0.1 -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
        ],
        { input: statement }
      );
    await eventually(
      () => sql('SELECT 1;'),
      'Disposable funding PostgreSQL did not become ready.',
      60_000
    );
    await sql(
      'BEGIN;\n' + buildRuntimeRoleSql(runtime, { create: true }) + '\nCOMMIT;'
    );
    const migrations = readMigrations(
      join(repository, 'apps/funding-api/migrations')
    );
    await sql(
      buildMigrationSql(migrations, { database: runtime.database }).replace(
        /COMMIT;\s*$/,
        buildRuntimeRoleSql(runtime) + '\nCOMMIT;\n'
      )
    );
    assert.equal(
      await sql('SELECT count(*) FROM openg7_schema_migrations;'),
      String(migrations.length)
    );
    assert.equal(
      await sql(
        "SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname='fixture_runtime';"
      ),
      'f'
    );
    await compose([
      'up',
      '-d',
      '--no-build',
      '--pull',
      'never',
      'keycloak',
      'api',
      'web'
    ]);
    for (const service of ['keycloak', 'api', 'web'])
      await eventually(async () => {
        const id = await compose(['ps', '-q', service]);
        assert.equal(
          await docker(['inspect', id, '--format', '{{.State.Health.Status}}']),
          'healthy'
        );
      }, `Disposable ${service} did not become healthy.`);
    const ca = await readFile(join(certs, 'rootCA.pem'));
    const exchange = createLocalHttpsExchange({
      port,
      origin,
      issuer: env.FUNDING_ADMIN_OIDC_ISSUER,
      ca
    });
    for (const service of ['postgres', 'identity-postgres']) {
      const id = await compose(['ps', '-q', service]);
      const [container] = JSON.parse(await docker(['inspect', id]));
      assert.ok(
        Object.values(container.NetworkSettings.Ports || {}).every(
          (bindings) => !bindings?.length
        ),
        'PostgreSQL must have no host ports.'
      );
      assert.ok(
        Object.hasOwn(
          container.HostConfig.Tmpfs || {},
          '/var/lib/postgresql/data'
        ),
        'The fixture database must be ephemeral.'
      );
      assert.ok(
        !container.Mounts.some(
          (mount) =>
            mount.Destination === '/var/lib/postgresql/data' &&
            mount.Type !== 'tmpfs'
        ),
        'A persistent database mount must not shadow the fixture tmpfs.'
      );
      for (const network of Object.values(container.NetworkSettings.Networks))
        assert.equal(
          await docker([
            'network',
            'inspect',
            network.NetworkID,
            '--format',
            '{{.Internal}}'
          ]),
          'true'
        );
    }
    const discovery = await exchange(
      '/realms/openg7/.well-known/openid-configuration',
      { provider: true }
    );
    assert.equal(discovery.status, 200);
    assert.equal(
      JSON.parse(discovery.body).issuer,
      env.FUNDING_ADMIN_OIDC_ISSUER
    );
    return {
      root,
      project,
      origin,
      port,
      password,
      ownerSubject,
      sql,
      exchange,
      async restartApi() {
        await compose(['restart', 'api']);
        await eventually(
          () =>
            compose([
              'exec',
              '-T',
              'api',
              'node',
              '-e',
              "fetch('http://127.0.0.1:3333/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
            ]),
          'The restarted fixture API did not become ready.'
        );
      },
      stop
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
