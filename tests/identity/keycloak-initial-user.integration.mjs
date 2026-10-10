import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

import { prepareLocalInitialUser } from '../../scripts/lib/keycloak-initial-user.mjs';
import { createLocalTlsFixture } from '../support/local-tls-fixture.mjs';

const execute = promisify(execFile);
const image = 'openg7-keycloak:26.8.0';
const postgresImage = 'postgres:16-alpine';
const repository = new URL('../../', import.meta.url);
const enabled = process.env.FUNDING_KEYCLOAK_INITIAL_USER_TEST === '1';

// Explicit opt-in only. No checkout .env, persistent volume, host port, account
// from an existing service, or remote Docker daemon is accepted by this fixture.
test(
  'Keycloak preserves literal special-character initial passwords and imports the user once',
  { skip: !enabled, timeout: 300_000 },
  async (t) => {
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
        .filter((name) => process.env[name] !== undefined)
        .map((name) => [name, process.env[name]])
    );
    const run = async (args, { input, env = {}, expectedFailure } = {}) => {
      try {
        const pending = execute('docker', args, {
          env: { ...clean, ...env },
          windowsHide: true,
          timeout: 45_000,
          maxBuffer: 1024 * 1024,
          encoding: 'utf8'
        });
        pending.child.stdin.end(input || '');
        const result = await pending;
        if (expectedFailure)
          throw new Error('Expected a refused credential grant.');
        return result.stdout.trim();
      } catch (error) {
        if (
          expectedFailure &&
          Number.isInteger(error.code) &&
          expectedFailure.test(`${error.stdout || ''}\n${error.stderr || ''}`)
        )
          return '';
        throw new Error(
          'Disposable initial-user Docker command failed; command output is withheld.'
        );
      }
    };
    const context = await run(['context', 'show']);
    const endpoint = await run([
      'context',
      'inspect',
      context,
      '--format',
      '{{.Endpoints.docker.Host}}'
    ]);
    assert.match(
      endpoint,
      /^(?:npipe|unix):\/\//,
      'A local Docker socket is required.'
    );
    const docker = (args, options) =>
      run(['--context', context, ...args], options);
    assert.equal(await docker(['info', '--format', '{{.OSType}}']), 'linux');
    for (const fixtureImage of [image, postgresImage])
      await docker(['image', 'inspect', fixtureImage, '--format', '{{.Id}}']);

    const suffix = randomUUID();
    const project = `og7-keycloak-initial-user-${suffix}`;
    const network = `${project}-data`;
    const label = `org.openg7.disposable-initial-user=${suffix}`;
    const root = await mkdtemp(join(tmpdir(), 'og7-keycloak-initial-user-'));
    const nestedPasswordExpression = '${FUNDING_ADMIN_OIDC_CLIENT_SECRET}';
    const environment = {
      FUNDING_PLATFORM_ENV: 'development',
      FUNDING_KEYCLOAK_ENABLED: 'true',
      FUNDING_KEYCLOAK_HOSTNAME: 'auth.openg7.test',
      FUNDING_PUBLIC_BASE_URL: 'https://localhost',
      FUNDING_ADMIN_AUTH_MODE: 'oidc',
      FUNDING_ADMIN_OIDC_ISSUER: 'https://auth.openg7.test/realms/openg7',
      FUNDING_ADMIN_OIDC_CLIENT_ID: 'synthetic-initial-user-client',
      FUNDING_ADMIN_OIDC_CLIENT_SECRET: randomBytes(32).toString('hex'),
      FUNDING_KEYCLOAK_DB_PASSWORD: randomBytes(32).toString('hex'),
      FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME: 'synthetic-bootstrap',
      FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD:
        randomBytes(32).toString('hex'),
      FUNDING_KEYCLOAK_INITIAL_USER_USERNAME: 'synthetic-initial-owner',
      FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD:
        randomBytes(32).toString('hex') + '"\\$:' + nestedPasswordExpression,
      COMPOSE_PROJECT_NAME: project
    };
    const composeConfig = {
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
      volumes: {
        'identity-postgres-data': { name: `${project}_identity-postgres-data` }
      }
    };
    // Model a fresh managed volume without ever creating or inspecting one;
    // the actual import below uses only this fixture's newly created tmpfs DB.
    const runDocker = (_command, args) => {
      if (args.includes('context') && args.includes('show'))
        return { status: 0, stdout: context, stderr: '' };
      if (args.includes('info'))
        return {
          status: 0,
          stdout: JSON.stringify('d'.repeat(64)),
          stderr: ''
        };
      if (args.includes('config'))
        return { status: 0, stdout: JSON.stringify(composeConfig), stderr: '' };
      if (args.includes('volume') && args.includes('ls'))
        return { status: 0, stdout: '', stderr: '' };
      throw new Error(
        'Unexpected Docker operation in initial-user preparation.'
      );
    };
    let databaseId;
    let keycloakId;
    let networkCreated = false;
    t.after(async () => {
      for (const id of [keycloakId, databaseId].filter(Boolean)) {
        assert.match(id, /^[a-f0-9]{64}$/);
        assert.equal(
          await docker([
            'inspect',
            id,
            '--format',
            '{{index .Config.Labels "org.openg7.disposable-initial-user"}}'
          ]),
          suffix,
          'Only containers from this disposable fixture may be removed.'
        );
        await docker(['rm', '--force', id]);
      }
      if (networkCreated) {
        assert.equal(
          await docker([
            'network',
            'inspect',
            network,
            '--format',
            '{{index .Labels "org.openg7.disposable-initial-user"}}'
          ]),
          suffix
        );
        await docker(['network', 'rm', network]);
      }
      const target = resolve(root);
      assert.equal(dirname(target), resolve(tmpdir()));
      assert.ok(basename(target).startsWith('og7-keycloak-initial-user-'));
      await rm(target, { recursive: true, force: true });
    });

    await mkdir(join(root, 'docker/keycloak'), { recursive: true });
    await copyFile(
      new URL('docker/keycloak/openg7-realm.json', repository),
      join(root, 'docker/keycloak/openg7-realm.json')
    );
    const prepared = prepareLocalInitialUser({
      root,
      env: environment,
      runDocker,
      allowCreate: true
    });
    assert.match(prepared.subject, /^[a-f0-9-]{36}$/);
    const realm = JSON.parse(await readFile(prepared.importFile, 'utf8'));
    assert.equal(realm.sslRequired, 'all');
    assert.equal(realm.users.length, 1);
    assert.equal(
      realm.users[0].credentials[0].value,
      '${FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON}'
    );
    assert.ok(
      !JSON.stringify(realm).includes(
        environment.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD
      ),
      'The generated import must keep the temporary password in an environment placeholder.'
    );
    const importDirectory = join(root, 'fixture-import');
    await mkdir(importDirectory, { mode: 0o755 });
    const importFile = join(importDirectory, 'openg7-realm.json');
    await writeFile(importFile, JSON.stringify(realm), { mode: 0o644 });
    const certificates = createLocalTlsFixture(root);
    const tlsDirectory = join(root, 'fixture-tls');
    await mkdir(tlsDirectory, { mode: 0o755 });
    for (const [source, destination] of [
      [certificates.certificatePath, 'certificate.pem'],
      [certificates.keyPath, 'key.pem'],
      [certificates.caPath, 'ca.pem']
    ])
      await writeFile(join(tlsDirectory, destination), await readFile(source), {
        mode: 0o644
      });

    await docker([
      'network',
      'create',
      '--internal',
      '--label',
      label,
      network
    ]);
    networkCreated = true;
    databaseId = await docker(
      [
        'run',
        '--detach',
        '--pull',
        'never',
        '--name',
        `${project}-db`,
        '--label',
        label,
        '--network',
        network,
        '--network-alias',
        'identity-db',
        '--mount',
        'type=tmpfs,destination=/var/lib/postgresql/data',
        '--env',
        'POSTGRES_DB=keycloak',
        '--env',
        'POSTGRES_USER=keycloak',
        '--env',
        'POSTGRES_PASSWORD',
        postgresImage
      ],
      { env: { POSTGRES_PASSWORD: environment.FUNDING_KEYCLOAK_DB_PASSWORD } }
    );
    const eventually = async (operation, message, timeout = 180_000) => {
      const deadline = Date.now() + timeout;
      while (true) {
        try {
          return await operation();
        } catch {
          if (Date.now() >= deadline) throw new Error(message);
          await setTimeout(500);
        }
      }
    };
    await eventually(
      () =>
        docker([
          'exec',
          databaseId,
          'pg_isready',
          '-U',
          'keycloak',
          '-d',
          'keycloak'
        ]),
      'Disposable PostgreSQL did not become ready.',
      30_000
    );
    keycloakId = await docker(
      [
        'run',
        '--detach',
        '--pull',
        'never',
        '--name',
        `${project}-server`,
        '--label',
        label,
        '--network',
        network,
        '--memory',
        '1536m',
        '--mount',
        `type=bind,source=${importDirectory},destination=/opt/keycloak/data/import,readonly`,
        '--mount',
        `type=bind,source=${tlsDirectory},destination=/synthetic-tls,readonly`,
        '--env',
        'KC_DB_URL=jdbc:postgresql://identity-db:5432/keycloak',
        '--env',
        'KC_DB_USERNAME=keycloak',
        '--env',
        'KC_DB_PASSWORD',
        '--env',
        'KC_HTTP_ENABLED=true',
        '--env',
        'KC_HTTP_MANAGEMENT_SCHEME=http',
        '--env',
        'KC_HTTPS_CERTIFICATE_FILE=/synthetic-tls/certificate.pem',
        '--env',
        'KC_HTTPS_CERTIFICATE_KEY_FILE=/synthetic-tls/key.pem',
        '--env',
        'KC_HOSTNAME_STRICT=false',
        ...[
          'FUNDING_PUBLIC_BASE_URL',
          'FUNDING_ADMIN_OIDC_CLIENT_ID',
          'FUNDING_ADMIN_OIDC_CLIENT_SECRET',
          'FUNDING_KEYCLOAK_INITIAL_USER_USERNAME',
          'FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON'
        ].flatMap((name) => ['--env', name]),
        image,
        'start',
        '--optimized',
        '--import-realm'
      ],
      {
        env: {
          ...environment,
          KC_DB_PASSWORD: environment.FUNDING_KEYCLOAK_DB_PASSWORD
        }
      }
    );
    const ready = () =>
      docker([
        'exec',
        keycloakId,
        '/bin/bash',
        '/opt/keycloak/bin/container-healthcheck.sh'
      ]);
    await eventually(ready, 'Disposable Keycloak did not become ready.');
    for (const id of [databaseId, keycloakId]) {
      const [container] = JSON.parse(await docker(['inspect', id]));
      assert.ok(
        Object.values(container.NetworkSettings.Ports || {}).every(
          (bindings) => !bindings?.length
        ),
        'The disposable services must publish no host ports.'
      );
      assert.equal(Object.keys(container.NetworkSettings.Networks).length, 1);
      if (id === keycloakId)
        assert.ok(
          !container.Config.Env.some((entry) =>
            entry.startsWith('FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD=')
          ),
          'Only the JSON-encoded initial password may enter the Keycloak startup environment.'
        );
    }
    assert.equal(
      await docker([
        'network',
        'inspect',
        network,
        '--format',
        '{{.Internal}}'
      ]),
      'true'
    );
    const sql = (statement) =>
      docker(
        [
          'exec',
          '-i',
          databaseId,
          'psql',
          '-X',
          '-q',
          '-At',
          '-v',
          'ON_ERROR_STOP=1',
          '-U',
          'keycloak',
          '-d',
          'keycloak'
        ],
        { input: statement }
      );
    const userSnapshot = () =>
      sql(`
      SELECT json_build_object(
        'id', u.id, 'username', u.username, 'enabled', u.enabled,
        'actions', (SELECT coalesce(json_agg(a.required_action ORDER BY a.required_action), '[]'::json)
          FROM user_required_action a WHERE a.user_id = u.id),
        'roles', (SELECT coalesce(json_agg(r.name ORDER BY r.name), '[]'::json)
          FROM user_role_mapping m JOIN keycloak_role r ON r.id = m.role_id WHERE m.user_id = u.id),
        'credentials', (SELECT coalesce(json_agg(json_build_object('type', c.type,
          'secretData', c.secret_data, 'credentialData', c.credential_data) ORDER BY c.id), '[]'::json)
          FROM credential c WHERE c.user_id = u.id)
      ) FROM user_entity u JOIN realm r ON r.id = u.realm_id WHERE r.name = 'openg7';
    `);
    const before = await userSnapshot();
    const imported = JSON.parse(before);
    assert.equal(imported.id, prepared.subject);
    assert.equal(
      imported.username,
      environment.FUNDING_KEYCLOAK_INITIAL_USER_USERNAME
    );
    assert.equal(imported.enabled, true);
    assert.deepEqual(imported.actions, ['CONFIGURE_TOTP', 'UPDATE_PASSWORD']);
    assert.equal(imported.credentials.length, 1);
    assert.equal(imported.credentials[0].type, 'password');
    assert.ok(JSON.parse(imported.credentials[0].secretData).value);
    assert.ok(JSON.parse(imported.credentials[0].credentialData).algorithm);
    assert.ok(
      !before.includes(environment.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD)
    );
    assert.ok(
      !before.includes('${FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD_JSON}')
    );
    assert.ok(imported.roles.every((role) => role !== 'admin'));

    await docker([
      'exec',
      keycloakId,
      'keytool',
      '-importcert',
      '-noprompt',
      '-alias',
      'synthetic-ca',
      '-file',
      '/synthetic-tls/ca.pem',
      '-keystore',
      '/tmp/synthetic-truststore.jks',
      '-storetype',
      'JKS',
      '-storepass',
      'synthetic-fixture-trustpass'
    ]);
    await docker([
      'exec',
      keycloakId,
      '/opt/keycloak/bin/kcadm.sh',
      'config',
      'truststore',
      '--config',
      '/tmp/synthetic-kcadm.config',
      '--trustpass',
      'synthetic-fixture-trustpass',
      '/tmp/synthetic-truststore.jks'
    ]);
    const probeCredentials = (passwordVariable, expectedFailure, env = {}) =>
      docker(
        [
          'exec',
          ...Object.keys(env).flatMap((name) => ['--env', name]),
          keycloakId,
          '/bin/bash',
          '-c',
          `/opt/keycloak/bin/kcadm.sh config credentials --config /tmp/synthetic-kcadm.config --server https://localhost:8443 --realm openg7 --client admin-cli --user "$FUNDING_KEYCLOAK_INITIAL_USER_USERNAME" --password "$${passwordVariable}"`
        ],
        { env, expectedFailure }
      );
    await probeCredentials(
      'OPENG7_TEST_INITIAL_PASSWORD',
      /Account is not fully set up/,
      {
        OPENG7_TEST_INITIAL_PASSWORD:
          environment.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD
      }
    );
    await probeCredentials(
      'OPENG7_TEST_EXPANDED_PASSWORD',
      /Invalid user credentials/,
      {
        OPENG7_TEST_EXPANDED_PASSWORD:
          environment.FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD.replaceAll(
            nestedPasswordExpression,
            environment.FUNDING_ADMIN_OIDC_CLIENT_SECRET
          )
      }
    );

    // A changed preparation must not replace the real credential or the enrolment
    // requirements once the realm has been initialized in the existing database.
    realm.users[0].username = 'synthetic-unwanted-replacement';
    realm.users[0].requiredActions = [];
    realm.users[0].credentials[0].temporary = false;
    realm.users[0].credentials[0].value = '${FUNDING_ADMIN_OIDC_CLIENT_SECRET}';
    realm.roles = {
      ...realm.roles,
      realm: [{ name: 'synthetic-unwanted-role' }]
    };
    await writeFile(importFile, JSON.stringify(realm), { mode: 0o644 });
    await docker(['restart', '--time', '15', keycloakId]);
    await eventually(
      ready,
      'Restarted disposable Keycloak did not become ready.'
    );
    assert.ok(
      before === (await userSnapshot()),
      'Existing user credentials, actions and roles must survive a later startup import.'
    );
    assert.equal(
      await sql(
        "SELECT count(*) FROM keycloak_role WHERE name = 'synthetic-unwanted-role';"
      ),
      '0'
    );
  }
);
