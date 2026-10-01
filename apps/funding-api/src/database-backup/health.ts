import pg from 'pg';

import { backupConfig } from './config.js';

let pool: pg.Pool | undefined;
try {
  const config = backupConfig(process.env);
  if (!config) throw new Error();
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 3000
  });
  const result = await pool.query(
    "SELECT 1 FROM database_backup_worker WHERE singleton AND ready AND checked_at > NOW()-INTERVAL '90 seconds'"
  );
  if (!result.rowCount) throw new Error();
} catch {
  console.error('Database backup worker is not ready.');
  process.exitCode = 1;
} finally {
  await pool?.end();
}
