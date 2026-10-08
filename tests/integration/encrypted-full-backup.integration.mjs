import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';
import { createAgeFixture } from './support/age-fixture.mjs';

const exec = promisify(execFile);
test(
  'full encrypted backup restores a database with a separate runtime role, config and private media; wrong identity has no target effects',
  { timeout: 120000 },
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
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]])
    );
    const run = async (command, args, { input, ...options } = {}) => {
      const pending = exec(command, args, {
        env: clean,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 45000,
        maxBuffer: 4 * 1024 * 1024,
        ...options
      });
      pending.child.stdin.end(input || '');
      return (await pending).stdout;
    };
    const context = (await run('docker', ['context', 'show'])).trim();
    const endpoint = (
      await run('docker', [
        'context',
        'inspect',
        context,
        '--format',
        '{{.Endpoints.docker.Host}}'
      ])
    ).trim();
    assert.match(
      endpoint,
      /^(npipe|unix):\/\//,
      'Only a local disposable Docker target is permitted.'
    );
    const docker = (args, options) =>
      run('docker', ['--context', context, ...args], options);
    const root = await mkdtemp(join(tmpdir(), 'og7-encrypted-full-backup-'));
    const prefix = 'og7-cipher-' + randomBytes(6).toString('hex');
    const age = createAgeFixture(root);
    const env = {
      ...clean,
      DOCKER_CONTEXT: context,
      OPENG7_TEST_NODE: process.execPath.replaceAll('\\', '/'),
      FUNDING_BACKUP_AGE_BINARY: age.ageBinary.replaceAll('\\', '/')
    };
    const targets = [];
    const makeTarget = async (name) => {
      const directory = join(root, name),
        project = prefix + '-' + name;
      await mkdir(directory);
      const target = { directory, project };
      targets.push(target);
      for (const file of [
        'backup.sh',
        'restore-from-backup.sh',
        'backup-artifacts.mjs',
        'recovery-state.mjs',
        'load-env.sh',
        'lib/backup-encryption.mjs'
      ]) {
        const destination = join(directory, 'scripts', file);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(
          destination,
          (await readFile(join('scripts', file), 'utf8')).replaceAll(
            '\r\n',
            '\n'
          )
        );
      }
      await mkdir(join(directory, 'bin'));
      await writeFile(
        join(directory, 'bin', 'node'),
        '#!/usr/bin/env bash\nexec "$OPENG7_TEST_NODE" "$@"\n',
        { mode: 0o755 }
      );
      target.compose = (args, options) =>
        docker(
          [
            'compose',
            '--project-directory',
            directory,
            '--env-file',
            join(directory, '.env'),
            '-p',
            project,
            '-f',
            join(directory, 'docker-compose.yml'),
            '--profile',
            'database',
            ...args
          ],
          { env, ...options }
        );
      target.sql = (sql) =>
        target.compose(
          [
            'exec',
            '-T',
            'postgres',
            'sh',
            '-c',
            'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -h 127.0.0.1 "$@"',
            'fixture-sql',
            '-X',
            '-q',
            '-At',
            '-v',
            'ON_ERROR_STOP=1',
            '-U',
            'fixture_owner',
            '-d',
            'fixture_backup'
          ],
          { input: sql }
        );
      target.script = (script, args = []) =>
        run(
          process.platform === 'win32'
            ? 'C:/Program Files/Git/bin/bash.exe'
            : 'bash',
          [
            '-c',
            'export PATH="$PWD/bin:$PATH"\nbash "$@"',
            'fixture',
            'scripts/' + script,
            ...args.map((arg) =>
              process.platform === 'win32' && /^[a-z]:[\\/]/i.test(arg)
                ? '/' +
                  arg[0].toLowerCase() +
                  '/' +
                  arg.slice(3).replaceAll('\\', '/')
                : arg
            )
          ],
          { cwd: directory, env }
        );
      return target;
    };
    t.after(async () => {
      for (const target of targets.reverse()) {
        assert.ok(target.project.startsWith(prefix + '-'));
        const ids = (
          await docker([
            'ps',
            '-aq',
            '--filter',
            'label=com.docker.compose.project=' + target.project
          ])
        ).trim();
        if (ids) await docker(['rm', '--force', ...ids.split(/\s+/)]);
        for (const suffix of ['postgres-data', 'sponsor-logos'])
          await docker(['volume', 'rm', target.project + '-' + suffix]).catch(
            () => {}
          );
        for (const suffix of ['edge', 'data'])
          await docker(['network', 'rm', target.project + '-' + suffix]).catch(
            () => {}
          );
      }
      assert.ok(
        resolve(root).startsWith(resolve(tmpdir()) + sep) &&
          basename(root).startsWith('og7-encrypted-full-backup-')
      );
      await rm(root, { recursive: true, force: true });
    });
    const source = await makeTarget('source');
    const roleConfig = {
      role: 'fixture_runtime',
      database: 'fixture_backup',
      password: 'synthetic-runtime-password-at-least-32-characters'
    };
    const settings = {
      POSTGRES_DB: 'fixture_backup',
      POSTGRES_USER: 'fixture_owner',
      POSTGRES_PASSWORD: 'synthetic-owner-password-at-least-32-characters',
      FUNDING_DATABASE_RUNTIME_USER: roleConfig.role,
      FUNDING_DATABASE_RUNTIME_PASSWORD: roleConfig.password,
      DATABASE_URL: `postgres://${roleConfig.role}:${roleConfig.password}@postgres:5432/fixture_backup`,
      FUNDING_FULL_BACKUP_AGE_RECIPIENT: age.recipient,
      FUNDING_PLATFORM_ENV: 'test',
      SPONSOR_MEDIA_STORAGE_DRIVER: 'local',
      COMPOSE_PROJECT_NAME: source.project,
      POSTGRES_VOLUME_NAME: source.project + '-postgres-data',
      SPONSOR_LOGOS_VOLUME_NAME: source.project + '-sponsor-logos',
      OPENG7_EDGE_NETWORK_NAME: source.project + '-edge',
      OPENG7_DATA_NETWORK_NAME: source.project + '-data'
    };
    const compose = {
      services: {
        postgres: {
          image: 'postgres:16-alpine',
          profiles: ['database'],
          // Detect an import into the socket-only initialization server.
          entrypoint: [
            'sh',
            '-ec',
            [
              "cat > /docker-entrypoint-initdb.d/00-restore-readiness.sql <<'SQL'",
              'CREATE TEMP TABLE restore_initialization_guard (valid boolean NOT NULL CHECK (valid));',
              'SELECT pg_sleep(7);',
              "INSERT INTO restore_initialization_guard VALUES (to_regclass('public.fund_contributions') IS NULL);",
              'SQL',
              'exec /usr/local/bin/docker-entrypoint.sh "$$@"'
            ].join('\n'),
            'fixture-entrypoint'
          ],
          command: ['postgres'],
          environment: {
            POSTGRES_DB: '${POSTGRES_DB}',
            POSTGRES_USER: '${POSTGRES_USER}',
            POSTGRES_PASSWORD: '${POSTGRES_PASSWORD}'
          },
          volumes: ['postgres-data:/var/lib/postgresql/data'],
          networks: ['data']
        },
        api: {
          image: 'postgres:16-alpine',
          environment: {
            DATABASE_URL: '${DATABASE_URL}',
            SPONSOR_MEDIA_STORAGE_DRIVER: 'local'
          },
          volumes: ['sponsor-logos:/app/var/sponsor-logos'],
          networks: ['data']
        }
      },
      volumes: {
        'postgres-data': { name: '${POSTGRES_VOLUME_NAME}' },
        'sponsor-logos': { name: '${SPONSOR_LOGOS_VOLUME_NAME}' }
      },
      networks: {
        edge: { name: '${OPENG7_EDGE_NETWORK_NAME}' },
        data: { name: '${OPENG7_DATA_NETWORK_NAME}', internal: true }
      }
    };
    await writeFile(
      join(source.directory, 'docker-compose.yml'),
      JSON.stringify(compose)
    );
    await writeFile(
      join(source.directory, '.env'),
      Object.entries(settings)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n'
    );
    for (const file of [
      '.env.example',
      '.dockerignore',
      'apps/funding-api/Dockerfile',
      'apps/funding-web/Dockerfile',
      'apps/funding-web/nginx.conf',
      'traefik/fixture.yml',
      'docs/fixture.md'
    ]) {
      await mkdir(dirname(join(source.directory, file)), { recursive: true });
      await writeFile(
        join(source.directory, file),
        '# Synthetic full backup fixture\n'
      );
    }
    await source.compose(['up', '-d', 'postgres']);
    const deadline = Date.now() + 30000;
    while (true) {
      try {
        await source.sql('SELECT 1;');
        break;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await setTimeout(250);
      }
    }
    await source.sql(`CREATE TABLE fund_contributions(id integer PRIMARY KEY,amount_cents bigint,email_private text);
      CREATE TABLE admin_audit_log(id integer PRIMARY KEY,actor text);
      INSERT INTO fund_contributions VALUES(1,9007199254740993,'private-synthetic@example.test');
      INSERT INTO admin_audit_log VALUES(1,'synthetic-owner');
      ${buildRuntimeRoleSql(roleConfig, { create: true })}`);
    const before = (
      await source.sql(
        'SELECT amount_cents::text,email_private FROM fund_contributions;'
      )
    ).trim();
    const sourceMedia = source.project + '-sponsor-logos';
    await docker(['volume', 'create', sourceMedia]);
    const logo = join(source.directory, 'private-fixture.webp');
    await writeFile(logo, 'private-synthetic-media-content');
    await docker([
      'run',
      '--rm',
      '--network',
      'none',
      '--entrypoint',
      'sh',
      '--mount',
      `type=volume,src=${sourceMedia},dst=/volume`,
      '--mount',
      `type=bind,src=${logo},dst=/fixture,readonly`,
      'postgres:16-alpine',
      '-c',
      'mkdir -p /volume/private; cp /fixture /volume/private/logo.webp'
    ]);
    assert.match(await source.script('backup.sh'), /Backup set complete/);
    const backupDir = join(source.directory, 'backups');
    const names = await readdir(backupDir);
    const config = join(
      backupDir,
      names.find((name) => /^openg7-backup-.*\.tar\.gz\.age$/.test(name))
    );
    const manifest = JSON.parse(
      await readFile(config + '.manifest.json', 'utf8')
    );
    assert.equal(manifest.encryption, 'age');
    assert.ok(
      names.every(
        (name) => name.endsWith('.age') || name.endsWith('.manifest.json')
      ),
      'Capture leaves ciphertext artifacts only.'
    );
    const database = join(backupDir, manifest.artifacts.database.name),
      media = join(backupDir, manifest.artifacts.media.name);
    for (const artifact of [config, database, media]) {
      const bytes = await readFile(artifact);
      assert.ok(!bytes.includes(Buffer.from('private-synthetic')));
      assert.ok(!bytes.includes(Buffer.from(settings.POSTGRES_PASSWORD)));
    }
    const args = (target, identity) => [
      '--target-project',
      target.project,
      '--config-backup',
      config,
      '--database-dump',
      database,
      '--sponsor-logos-backup',
      media,
      ...(identity ? ['--identity', identity] : []),
      '--force'
    ];
    const wrong = await makeTarget('wrong');
    await mkdir(join(root, 'other-key'));
    const other = createAgeFixture(join(root, 'other-key'));
    await assert.rejects(
      wrong.script('restore-from-backup.sh', args(wrong, other.identity))
    );
    assert.ok(
      !(await readdir(wrong.directory)).some((name) =>
        name.startsWith('.restore-stage.')
      )
    );
    await assert.rejects(
      docker(['volume', 'inspect', wrong.project + '-postgres-data'])
    );
    const missing = await makeTarget('missing');
    await assert.rejects(
      missing.script('restore-from-backup.sh', args(missing))
    );
    await assert.rejects(
      docker(['volume', 'inspect', missing.project + '-postgres-data'])
    );
    const target = await makeTarget('restored');
    assert.match(
      await target.script('restore-from-backup.sh', args(target, age.identity)),
      /Restore completed/
    );
    assert.equal(
      (
        await target.sql(
          'SELECT amount_cents::text,email_private FROM fund_contributions;'
        )
      ).trim(),
      before
    );
    assert.equal(
      (
        await target.sql(
          "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fixture_runtime');"
        )
      ).trim(),
      'f',
      'Global roles/grants must not prevent restoration into a fresh cluster.'
    );
    assert.equal(
      (
        await target.compose(['ps', '--services', '--filter', 'status=running'])
      ).trim(),
      'postgres'
    );
    const recoveredMedia = (
      await docker([
        'run',
        '--rm',
        '--network',
        'none',
        '--entrypoint',
        'sh',
        '--mount',
        `type=volume,src=${target.project}-sponsor-logos,dst=/volume,readonly`,
        'postgres:16-alpine',
        '-c',
        'cat /volume/private/logo.webp'
      ])
    ).trim();
    assert.equal(recoveredMedia, 'private-synthetic-media-content');
    await target.sql(buildRuntimeRoleSql(roleConfig, { create: true }));
    assert.equal(
      (
        await target.sql(
          "SELECT has_table_privilege('fixture_runtime','fund_contributions','SELECT,INSERT,UPDATE'),has_table_privilege('fixture_runtime','fund_contributions','DELETE'),has_table_privilege('fixture_runtime','admin_audit_log','UPDATE');"
        )
      ).trim(),
      't|f|f'
    );
    const report = JSON.parse(
      await readFile(join(target.directory, 'recovery-report.json'), 'utf8')
    );
    assert.equal(report.state, 'restored-stopped');
    assert.equal(report.applicationChecks, 'pending');
    assert.ok(
      !(await readdir(target.directory)).some((name) =>
        name.startsWith('.restore-stage.')
      )
    );
  }
);
