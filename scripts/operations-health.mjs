import { writeFile, rm, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const file = '/tmp/openg7-operations-heartbeat.json';
export async function startHeartbeat() {
  const update = () =>
    writeFile(file, JSON.stringify({ pid: process.pid, at: Date.now() }), {
      mode: 0o600
    });
  await update();
  const timer = setInterval(() => {
    update().catch(() => {});
  }, 10000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await rm(file, { force: true });
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000
  });
  pool.on('error', () => {});
  try {
    const heartbeat = JSON.parse(await readFile(file, 'utf8'));
    if (
      !Number.isInteger(heartbeat.pid) ||
      heartbeat.pid < 1 ||
      !Number.isFinite(heartbeat.at) ||
      Date.now() - heartbeat.at > 45000 ||
      heartbeat.at > Date.now()
    )
      throw new Error();
    process.kill(heartbeat.pid, 0);
    await pool.query('SELECT 1 FROM operations_alerts LIMIT 0');
  } catch {
    console.error('Operations watcher is not ready.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
