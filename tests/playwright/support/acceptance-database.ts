import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export function acceptanceComposeArgs(): string[] {
  const project = process.env.COMPOSE_PROJECT_NAME;
  if (
    process.env.OPENG7_E2E_ISOLATED !== '1' ||
    !project ||
    !/^og7-acceptance-[a-f0-9-]+$/.test(project) ||
    process.env.COMPOSE_FILE !== resolve('docker-compose.acceptance.yml')
  ) {
    throw new Error('This operation requires the disposable acceptance stack.');
  }
  return ['compose', '--project-name', project];
}

// SQL runs inside this recipe's API container, against its private disposable DB.
// Values are parameters; no shell, host DATABASE_URL or production credential.
export async function acceptanceSql<T = Record<string, unknown>>(
  sql: string,
  values: readonly unknown[] = []
): Promise<T[]> {
  const { stdout } = await execute(
    'docker',
    [
      ...acceptanceComposeArgs(),
      'exec',
      '-T',
      'api',
      'node',
      '--input-type=module',
      '-e',
      `import pg from 'pg';
     const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
     try {
       const {sql,values}=JSON.parse(process.argv[1]);
       const result=await pool.query(sql,values);
       process.stdout.write(JSON.stringify(result.rows ?? []));
     } finally { await pool.end(); }`,
      JSON.stringify({ sql, values })
    ],
    { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 }
  );
  return JSON.parse(stdout) as T[];
}

export async function restartAcceptanceApi(): Promise<void> {
  await execute('docker', [...acceptanceComposeArgs(), 'restart', 'api'], {
    windowsHide: true,
    timeout: 60000
  });
}
