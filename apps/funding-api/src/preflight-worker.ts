import { pathToFileURL } from 'node:url';

import pg from 'pg';

import { assertProductionDatabasePrivileges } from './database-runtime-security.js';
import { PreflightClient } from './preflight/client.js';
import {
  assertPreflightProducerActivation,
  loadPreflightConfig
} from './preflight/config.js';
import { producerSettingsFromEnv } from './preflight/source.js';
import { createPreflightConnectorWorker } from './preflight/worker.js';
import { assertPreflightSchema } from './preflight/repository.js';

export async function runPreflightWorker(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  assertPreflightProducerActivation(env);
  const config = loadPreflightConfig(env);
  if (!config.enabled) {
    console.info(JSON.stringify({ event: 'preflight.worker_disabled' }));
    return;
  }
  if (!env.DATABASE_URL) throw new Error('PREFLIGHT_DATABASE_REQUIRED');
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 15000
  });
  pool.on('error', () =>
    console.error(JSON.stringify({ event: 'preflight.database_pool_error' }))
  );
  const worker = createPreflightConnectorWorker({
    pool,
    settings: producerSettingsFromEnv(env),
    client: new PreflightClient(config),
    requestTimeoutMs: config.requestTimeoutMs,
    log: (record) => console.info(JSON.stringify(record))
  });
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await assertProductionDatabasePrivileges(
      pool,
      (env.FUNDING_PLATFORM_ENV ?? env.NODE_ENV) === 'production'
    );
    await assertPreflightSchema(pool);
    console.info(JSON.stringify({ event: 'preflight.worker_started' }));
    while (!stopping) {
      await worker.tick();
      if (!stopping) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await worker.stop();
    await pool.end();
  }
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  void runPreflightWorker().catch(() => {
    console.error(JSON.stringify({ event: 'preflight.worker_failed' }));
    process.exitCode = 1;
  });
}
