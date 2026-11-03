import { pathToFileURL } from 'node:url';

import pg from 'pg';

import { loadPreflightConfig } from './preflight/config.js';

export async function checkPreflightWorkerHealth(
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const config = loadPreflightConfig(env);
  if (!config.enabled) return true;
  if (!env.DATABASE_URL) return false;
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000
  });
  pool.on('error', () => undefined);
  try {
    const result = await pool.query<{ healthy: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM preflight_worker_heartbeats WHERE tenant_id=$1 AND seen_at>NOW()-INTERVAL '45 seconds') AS healthy",
      [config.tenantId]
    );
    return result.rows[0]?.healthy === true;
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  void checkPreflightWorkerHealth()
    .then((healthy) => {
      process.exitCode = healthy ? 0 : 1;
    })
    .catch(() => {
      process.stderr.write('{"event":"preflight.health_failed"}\n');
      process.exitCode = 1;
    });
}
