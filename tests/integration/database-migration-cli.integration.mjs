import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  unlink,
  rmdir
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, delimiter } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);

test(
  'Node and Bash migration commands share a real disposable Compose database and safe diagnostics',
  { timeout: 90_000 },
  async (t) => {
    const context = (await exec('docker', ['context', 'show'])).stdout.trim();
    const endpoint = (
      await exec('docker', [
        'context',
        'inspect',
        context,
        '--format',
        '{{.Endpoints.docker.Host}}'
      ])
    ).stdout.trim();
    assert.match(
      endpoint,
      /^(npipe|unix):\/\//,
      'local Docker socket required'
    );
    const root = await mkdtemp(join(tmpdir(), 'og7-migration-cli-'));
    const directory = join(root, 'migrations');
    await mkdir(directory);
    const composeFile = join(root, 'compose.json');
    const envFile = join(root, 'empty.env');
    const nodeShim = join(root, 'node');
    const project = `og7-migration-cli-${randomBytes(6).toString('hex')}`;
    const env = {
      ...process.env,
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
      OPENG7_TEST_NODE: process.execPath.replaceAll('\\', '/'),
      OPENG7_TEST_NODE_DIR: root
        .replaceAll('\\', '/')
        .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`),
      DOCKER_CONTEXT: context,
      COMPOSE_FILE: composeFile,
      COMPOSE_PROJECT_NAME: project,
      COMPOSE_ENV_FILES: envFile,
      COMPOSE_DISABLE_ENV_FILE: '1',
      POSTGRES_USER: 'og7_test',
      POSTGRES_DB: 'og7_migration_cli',
      MIGRATIONS_DIR: directory,
      OPENG7_E2E_ENV_FILE: envFile
    };
    const docker = (args) =>
      exec('docker', args, { env, windowsHide: true, timeout: 30_000 });
    t.after(async () => {
      await docker(['compose', 'down', '--volumes']);
      for (const file of await readdir(directory))
        await unlink(join(directory, file));
      await rmdir(directory);
      await unlink(composeFile);
      await unlink(envFile);
      await unlink(nodeShim);
      await rmdir(root);
    });
    await writeFile(envFile, '');
    await writeFile(
      nodeShim,
      '#!/usr/bin/env bash\nexec "$OPENG7_TEST_NODE" "$@"\n',
      { mode: 0o755 }
    );
    await writeFile(
      composeFile,
      JSON.stringify({
        services: {
          postgres: {
            image: 'postgres:16-alpine',
            pull_policy: 'never',
            environment: {
              POSTGRES_USER: 'og7_test',
              POSTGRES_DB: 'og7_migration_cli',
              POSTGRES_PASSWORD: 'synthetic-disposable-password'
            },
            tmpfs: ['/var/lib/postgresql/data'],
            networks: ['data'],
            labels: { 'org.openg7.disposable-test': 'true' }
          }
        },
        networks: { data: { internal: true } }
      })
    );
    await writeFile(
      join(directory, '001_probe.sql'),
      'CREATE TABLE cli_probe(id integer PRIMARY KEY); INSERT INTO cli_probe VALUES (1);'
    );
    const run = async (args, bash = false) => {
      const shell = bash
        ? (await readFile('scripts/db-migrate.sh', 'utf8'))
            .replaceAll('\r\n', '\n')
            .replace('"${BASH_SOURCE[0]}"', 'scripts/db-migrate.sh')
        : null;
      const command = bash
        ? process.platform === 'win32'
          ? 'C:/Program Files/Git/bin/bash.exe'
          : 'bash'
        : process.execPath;
      const commandArgs = bash
        ? [
            '-c',
            'export PATH="$OPENG7_TEST_NODE_DIR:$PATH"\n' + shell,
            'migration-test',
            ...args
          ]
        : ['scripts/db-migrate.mjs', ...args];
      try {
        const result = await exec(command, commandArgs, {
          env,
          windowsHide: true,
          timeout: 45_000
        });
        return { status: 0, output: result.stdout + result.stderr };
      } catch (error) {
        return {
          status: error.code,
          output: `${error.stdout ?? ''}${error.stderr ?? ''}`
        };
      }
    };
    const stoppedPlan = await run(['--plan']);
    assert.notEqual(stoppedPlan.status, 0);
    assert.equal(
      (await docker(['compose', 'ps', '-q', 'postgres'])).stdout.trim(),
      ''
    );
    const applied = await run([]);
    assert.equal(applied.status, 0, applied.output);
    assert.match(applied.output, /applied 001_probe.sql/);
    const plan = await run(['--plan'], true);
    assert.equal(plan.status, 0, plan.output);
    assert.match(plan.output, /skipped 001_probe.sql/);
    assert.match(plan.output, /no persistent changes/);
    const repeated = await run([], true);
    assert.equal(repeated.status, 0, repeated.output);
    assert.match(repeated.output, /skipped 001_probe.sql/);
    await writeFile(
      join(directory, '002_failure.sql'),
      "INSERT INTO cli_probe VALUES (2); DO $$ BEGIN RAISE EXCEPTION 'private-error-canary'; END $$;"
    );
    const failed = await run([]);
    assert.equal(failed.status, 1, failed.output);
    assert.match(failed.output, /reconcile with --plan/);
    assert.doesNotMatch(
      failed.output,
      /private-error-canary|INSERT INTO|applied 002|migrations committed/
    );
    const rows = await docker([
      'compose',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-X',
      '-At',
      '-U',
      'og7_test',
      '-d',
      'og7_migration_cli',
      '-c',
      'SELECT count(*) FROM cli_probe; SELECT count(*) FROM openg7_schema_migrations;'
    ]);
    assert.equal(rows.stdout.trim().replaceAll('\r\n', '\n'), '1\n1');
  }
);
