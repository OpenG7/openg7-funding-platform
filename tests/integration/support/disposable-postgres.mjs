import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

import pg from 'pg';

const execFileAsync = promisify(execFile);
const image = 'postgres:16-alpine';
const migrationsDirectory = new URL(
  '../../../apps/funding-api/migrations/',
  import.meta.url
);

// This helper never consumes DATABASE_URL or .env. Every invocation owns a
// fresh container and an in-memory data directory, with only a loopback port.
export const startDisposablePostgres = async () => {
  const runDocker = async (args, env = process.env) => {
    const { stdout } = await execFileAsync('docker', args, {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
      env
    });
    return stdout.trim();
  };
  const context = await runDocker(['context', 'show']);
  const endpoint = await runDocker([
    'context',
    'inspect',
    context,
    '--format',
    '{{.Endpoints.docker.Host}}'
  ]);
  if (!endpoint.startsWith('npipe://') && !endpoint.startsWith('unix://')) {
    throw new Error(
      'PostgreSQL integration tests require a local Docker socket.'
    );
  }
  const docker = (args, env) => runDocker(['--context', context, ...args], env);
  if ((await docker(['info', '--format', '{{.OSType}}'])) !== 'linux') {
    throw new Error('PostgreSQL integration tests require Linux containers.');
  }
  try {
    await docker(['image', 'inspect', image, '--format', '{{.Id}}']);
  } catch {
    throw new Error(
      `The test image is missing. Run docker pull ${image} first.`
    );
  }

  const suffix = `${process.pid}_${randomBytes(6).toString('hex')}`;
  const database = `og7_test_${suffix}`;
  const password = randomBytes(24).toString('hex');
  const containerId = await docker(
    [
      'run',
      '--detach',
      '--pull',
      'never',
      '--name',
      `og7-payment-test-${suffix}`,
      '--label',
      'org.openg7.disposable-test=true',
      '--mount',
      'type=tmpfs,destination=/var/lib/postgresql/data',
      '--publish',
      '127.0.0.1::5432',
      '--env',
      'POSTGRES_PASSWORD',
      '--env',
      'POSTGRES_USER=og7_test',
      '--env',
      `POSTGRES_DB=${database}`,
      image
    ],
    { ...process.env, POSTGRES_PASSWORD: password }
  );

  let pool;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      if (pool) await pool.end();
    } finally {
      // Only remove the unique container created above; there are no volumes.
      await docker(['rm', '--force', containerId]);
    }
  };

  try {
    const binding = await docker(['port', containerId, '5432/tcp']);
    const match = /^127\.0\.0\.1:(\d+)$/.exec(binding);
    if (!match)
      throw new Error('The test database must bind only to loopback.');
    pool = new pg.Pool({
      host: '127.0.0.1',
      port: Number(match[1]),
      database,
      user: 'og7_test',
      password,
      ssl: false,
      options: '',
      application_name: 'og7-disposable-payment-tests',
      connectionTimeoutMillis: 1_000,
      max: 8
    });
    const readyBy = Date.now() + 25_000;
    while (true) {
      try {
        await pool.query('SELECT 1');
        break;
      } catch {
        if (Date.now() >= readyBy) {
          throw new Error(
            'The disposable PostgreSQL database did not become ready.'
          );
        }
        await setTimeout(200);
      }
    }
    const migrations = (await readdir(migrationsDirectory))
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort();
    for (const migration of migrations) {
      await pool.query(
        await readFile(new URL(migration, migrationsDirectory), 'utf8')
      );
    }
    return { pool, stop };
  } catch (error) {
    await stop();
    throw error;
  }
};
