import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import {
  operationsAlertConfig,
  syncOperationsIncidents,
  deliverOperationsAlerts,
  sendOperationsAlert
} from '../dist/apps/funding-api/src/operations-alerts.js';

// Configuration is deliberately explicit. No implicit .env load, no SMTP dependency.
const config = operationsAlertConfig(process.env);
if (!config || !process.env.DATABASE_URL)
  throw new Error(
    'Configure DATABASE_URL and the operations webhook before starting the watcher.'
  );
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  query_timeout: 15000
});
pool.on('error', () =>
  console.error('Operations database connection unavailable.')
);
let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});
let unavailable = null;
try {
  do {
    try {
      await syncOperationsIncidents(pool);
      const delivered = await deliverOperationsAlerts(pool, config);
      unavailable = null;
      console.info(
        JSON.stringify({
          status: 'checked',
          delivered,
          at: new Date().toISOString()
        })
      );
    } catch {
      unavailable ??= {
        id: randomUUID(),
        type: 'operations_database_unavailable',
        createdAt: new Date().toISOString(),
        sent: false
      };
      if (!unavailable.sent) {
        try {
          await sendOperationsAlert(config, unavailable);
          unavailable.sent = true;
        } catch {
          /* Retry next poll; never print provider errors or credentials. */
        }
      }
      console.error('Operations check unavailable.');
      if (process.argv.includes('--once')) process.exitCode = 1;
    }
    if (!stopped && !process.argv.includes('--once')) await setTimeout(30000);
  } while (!stopped && !process.argv.includes('--once'));
} finally {
  await pool.end();
}
