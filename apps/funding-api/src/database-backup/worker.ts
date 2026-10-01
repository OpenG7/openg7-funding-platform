import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, open, stat, chmod, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import pg, { type Pool } from 'pg';

import { backupConfig, type BackupConfig } from './config.js';
import { BackupStorage, type BackupProof } from './storage.js';
import { captureDatabase } from './capture.js';
import {
  backupAudit,
  BackupError,
  finishBackup,
  isBackupId,
  scheduleDailyBackup
} from './service.js';

const targetDigest = (config: BackupConfig) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        config.endpoint,
        config.bucket,
        config.namespace,
        config.recipient
      ])
    )
    .digest('hex');

export async function claimBackup(pool: Pool): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (
      await client.query<{
        request_id: string;
      }>(`UPDATE database_backup_jobs SET status='running',started_at=NOW()
      WHERE request_id=(SELECT request_id FROM database_backup_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING request_id`)
    ).rows[0];
    if (row)
      await backupAudit(client, row.request_id, 'backup-worker', 'running');
    await client.query('COMMIT');
    return row?.request_id ?? null;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** A failed/unknown operation is never automatically claimed again. */
export async function executeBackup(
  pool: Pool,
  config: BackupConfig,
  id: string,
  storage: Pick<BackupStorage, 'check' | 'upload'>,
  signal: AbortSignal,
  capture: typeof captureDatabase = captureDatabase
) {
  let transferStarted = false;
  try {
    await storage.check(signal);
    const captured = await capture(config, id, signal);
    const proof: BackupProof = {
      bytes: captured.bytes,
      sha256: captured.sha256,
      retainUntil: new Date(
        (Math.ceil(Date.now() / 1000) + 30 * 86400) * 1000
      ).toISOString()
    };
    const receipt = await open(
      join(config.directory, id, 'receipt.json'),
      'wx',
      0o600
    );
    try {
      await receipt.writeFile(
        JSON.stringify({
          version: 1,
          requestId: id,
          target: targetDigest(config),
          ...proof
        }) + '\n'
      );
      await receipt.sync();
    } finally {
      await receipt.close();
    }
    transferStarted = true;
    await storage.upload(id, captured.file, proof, signal);
    await finishBackup(pool, id, 'succeeded', proof);
    await unlink(captured.file).catch(() => {});
  } catch {
    // This write may also fail after a DB outage. Startup reconciles orphaned running jobs.
    await finishBackup(pool, id, transferStarted ? 'unknown' : 'failed');
  }
}

export async function reconcileBackup(
  pool: Pool,
  config: BackupConfig,
  id: string,
  storage: Pick<BackupStorage, 'verify'>,
  signal: AbortSignal
) {
  if (!isBackupId(id)) throw new Error('Invalid backup identifier.');
  const row = (
    await pool.query(
      "SELECT status FROM database_backup_jobs WHERE request_id=$1 AND status='unknown'",
      [id]
    )
  ).rows[0];
  if (!row) throw new Error('Reconciliation requires an unknown receipt.');
  const receipt = JSON.parse(
    await readFile(join(config.directory, id, 'receipt.json'), 'utf8')
  ) as BackupProof & { version: number; requestId: string; target: string };
  if (
    receipt.version !== 1 ||
    receipt.requestId !== id ||
    receipt.target !== targetDigest(config) ||
    !Number.isInteger(receipt.bytes) ||
    receipt.bytes <= 0 ||
    receipt.bytes > 2147483648 ||
    !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
    !Number.isFinite(Date.parse(receipt.retainUntil))
  )
    throw new Error('Invalid backup receipt.');
  await storage.verify(id, receipt, signal);
  await finishBackup(pool, id, 'succeeded', receipt);
  await unlink(join(config.directory, id, 'database.sql.age')).catch(() => {});
}

export async function runBackupWorker(
  config: BackupConfig,
  reconcileId?: string
) {
  if (!reconcileId) {
    const version = execFileSync('pg_dump', ['--version'], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (!/\b16\./.test(version))
      throw new Error('PostgreSQL 16 dump tools are required.');
    // Validate the actual recipient checksum and tool availability before reporting ready.
    execFileSync('age', ['--encrypt', '--recipient', config.recipient], {
      input: '',
      timeout: 10000,
      stdio: ['pipe', 'ignore', 'ignore']
    });
  }
  await mkdir(config.directory, { mode: 0o700, recursive: true });
  if (!(await stat(config.directory)).isDirectory())
    throw new Error('Backup directory unavailable.');
  await chmod(config.directory, 0o700);
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    application_name: 'openg7-database-backup',
    max: 4,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000
  });
  const storage = new BackupStorage(config);
  const abort = new AbortController();
  const stop = () => abort.abort();
  let controlFailed = false;
  const connectionLost = () => {
    controlFailed = true;
    stop();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  pool.on('error', connectionLost);
  const lock = await pool.connect().catch(async (error) => {
    storage.client.destroy();
    await pool.end();
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    throw error;
  });
  lock.on('error', connectionLost);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let ownsLock = false;
  try {
    ownsLock = (
      await lock.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended('database-backup-worker',0)) AS locked"
      )
    ).rows[0].locked;
    if (!ownsLock) throw new Error('A backup worker is already active.');
    const orphaned = (
      await pool.query<{ request_id: string }>(
        "SELECT request_id FROM database_backup_jobs WHERE status='running'"
      )
    ).rows;
    for (const row of orphaned)
      await finishBackup(pool, row.request_id, 'unknown');
    if (reconcileId) {
      await reconcileBackup(
        pool,
        config,
        reconcileId,
        storage,
        AbortSignal.any([abort.signal, AbortSignal.timeout(15 * 60000)])
      );
      return;
    }
    const pulse = async (ready: boolean) => {
      await lock.query('SELECT 1');
      await pool.query(
        `INSERT INTO database_backup_worker(singleton,ready,checked_at) VALUES(TRUE,$1,NOW())
        ON CONFLICT(singleton) DO UPDATE SET ready=$1,checked_at=NOW()`,
        [ready]
      );
    };
    let ready = false;
    // A heartbeat cannot turn an unverified storage destination into a ready service.
    heartbeat = setInterval(() => {
      void pulse(ready).catch(connectionLost);
    }, 20000);
    while (!abort.signal.aborted) {
      try {
        await storage.check(
          AbortSignal.any([abort.signal, AbortSignal.timeout(15000)])
        );
        ready = true;
      } catch {
        ready = false;
      }
      await pulse(ready);
      if (ready) {
        try {
          await scheduleDailyBackup(pool);
        } catch (error) {
          if (
            !(error instanceof BackupError) ||
            !['BACKUP_ACTIVE', 'BACKUP_RATE_LIMIT'].includes(error.code)
          )
            throw error;
        }
        const id = await claimBackup(pool);
        if (id)
          await executeBackup(
            pool,
            config,
            id,
            storage,
            AbortSignal.any([abort.signal, AbortSignal.timeout(15 * 60000)])
          );
      }
      await delay(30000, undefined, { signal: abort.signal }).catch(() => {});
    }
    if (controlFailed) throw new Error('BACKUP_CONTROL_UNAVAILABLE');
  } finally {
    clearInterval(heartbeat);
    if (ownsLock)
      await pool
        .query(
          'UPDATE database_backup_worker SET ready=FALSE,checked_at=NOW() WHERE singleton'
        )
        .catch(() => {});
    lock.release(true);
    storage.client.destroy();
    await pool.end();
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    if (
      args.length &&
      !(args.length === 2 && args[0] === '--reconcile' && isBackupId(args[1]))
    )
      throw new Error('Invalid backup worker command.');
    const config = backupConfig(process.env);
    if (config) await runBackupWorker(config, args[1]);
    else console.info('Database backups are disabled.');
  } catch {
    // Provider/process errors may contain passwords, object paths or donor data.
    console.error(
      'Database backup worker stopped. Review configuration and operation receipts.'
    );
    process.exitCode = 1;
  }
}
