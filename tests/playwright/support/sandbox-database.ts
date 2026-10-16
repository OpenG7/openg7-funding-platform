import { execFile } from 'node:child_process';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** Read-only probes in the exact disposable sandbox; never a host connection string. */
export async function sandboxRead<T = Record<string, unknown>>(
  sql: string,
  values: readonly unknown[] = []
): Promise<T[]> {
  const project = process.env.COMPOSE_PROJECT_NAME;
  const envFile = process.env.OPENG7_E2E_ENV_FILE;
  const files = [
    resolve('docker-compose.acceptance.yml'),
    resolve('docker-compose.sandbox.yml')
  ];
  if (
    process.env.OPENG7_E2E_ISOLATED !== '1' ||
    !project ||
    !/^og7-acceptance-[a-f0-9-]+$/.test(project) ||
    !envFile ||
    !isAbsolute(envFile) ||
    process.env.COMPOSE_FILE !== files.join(delimiter)
  )
    throw new Error('Read-only probes require the disposable sandbox.');
  const compose = [
    'compose',
    '--project-name',
    project,
    '--env-file',
    envFile,
    '--file',
    files[0]!,
    '--file',
    files[1]!
  ];
  const options = { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 };
  const { stdout: found } = await execute(
    'docker',
    [...compose, 'ps', '-q', 'api'],
    options
  );
  const container = found.trim();
  if (!/^[a-f0-9]{12,64}$/.test(container))
    throw new Error('Missing isolated API container.');
  const { stdout: inspected } = await execute(
    'docker',
    ['inspect', '--format', '{{json .Config.Labels}}', container],
    options
  );
  const labels = JSON.parse(inspected) as Record<string, string>;
  if (
    labels['com.docker.compose.project'] !== project ||
    labels['org.openg7.admin-sandbox'] !== 'true'
  )
    throw new Error('The database probe target is outside this sandbox.');
  const { stdout } = await execute(
    'docker',
    [
      'exec',
      container,
      'node',
      '--input-type=module',
      '-e',
      `import pg from 'pg';
     const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
     const client = await pool.connect();
     try {
       await client.query('BEGIN READ ONLY');
       const {sql,values}=JSON.parse(process.argv[1]);
       const result=await client.query(sql,values);
       process.stdout.write(JSON.stringify(result.rows ?? []));
       await client.query('COMMIT');
     } finally { client.release(); await pool.end(); }`,
      JSON.stringify({ sql, values })
    ],
    options
  );
  return JSON.parse(stdout) as T[];
}
