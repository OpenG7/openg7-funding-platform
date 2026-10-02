import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import type {
  AdminBackupsResponse,
  AdminDatabaseBackup
} from '@openg7/funding-core';

import {
  BACKUP_RETENTION_DAYS,
  BACKUP_WORKER_FRESHNESS_SECONDS
} from './policy.js';

export class BackupError extends Error {
  constructor(
    readonly code: string,
    readonly status = 503
  ) {
    super(code);
  }
}

export const isBackupId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

const fields = `request_id AS "requestId", source, status, created_at AS "createdAt", started_at AS "startedAt",
  finished_at AS "finishedAt", bytes::float8 AS bytes, sha256, retain_until AS "retainUntil"`;
type Row = Omit<
  AdminDatabaseBackup,
  'createdAt' | 'startedAt' | 'finishedAt' | 'retainUntil'
> & {
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  retainUntil: Date | null;
};
const map = (row: Row): AdminDatabaseBackup => ({
  requestId: row.requestId,
  source: row.source,
  status: row.status,
  bytes: row.bytes,
  sha256: row.sha256,
  createdAt: row.createdAt.toISOString(),
  startedAt: row.startedAt?.toISOString() ?? null,
  finishedAt: row.finishedAt?.toISOString() ?? null,
  retainUntil: row.retainUntil?.toISOString() ?? null
});

export async function backupStatus(
  pool: Pool,
  requestId?: string
): Promise<AdminBackupsResponse> {
  const worker = (
    await pool.query<{ ready: boolean; checked_at: Date; fresh: boolean }>(
      `SELECT ready, checked_at, checked_at > NOW() - ($1::integer * INTERVAL '1 second') AS fresh FROM database_backup_worker WHERE singleton`,
      [BACKUP_WORKER_FRESHNESS_SECONDS]
    )
  ).rows[0];
  const jobs = (
    await pool.query<Row>(
      `SELECT ${fields} FROM database_backup_jobs ORDER BY created_at DESC LIMIT 20`
    )
  ).rows.map(map);
  const request = requestId
    ? (
        await pool.query<Row>(
          `SELECT ${fields} FROM database_backup_jobs WHERE request_id=$1`,
          [requestId]
        )
      ).rows[0]
    : undefined;
  return {
    scope: 'database',
    schedule: 'daily',
    retentionDays: BACKUP_RETENTION_DAYS,
    workerState: !worker
      ? 'not_configured'
      : worker.ready && worker.fresh
        ? 'ready'
        : 'unavailable',
    checkedAt: new Date().toISOString(),
    lastWorkerAt: worker?.checked_at.toISOString() ?? null,
    jobs,
    ...(requestId ? { request: request ? map(request) : null } : {})
  };
}

export async function backupAudit(
  client: PoolClient,
  id: string,
  actor: string,
  status: string
) {
  await client.query(
    `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata)
    VALUES($1,$2,'database_backup',$3,'Database backup operation.',$4::jsonb)`,
    [
      actor,
      `database_backup.${status}`,
      id,
      JSON.stringify({ requestId: id, result: status, scope: 'database' })
    ]
  );
}

/** Atomic acceptance and audit; this transaction never starts a dump or a transfer. */
export async function requestBackup(
  pool: Pool,
  requestId: string,
  actor: string,
  daily = false
): Promise<AdminDatabaseBackup | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('database-backup-accept',0))"
    );
    const existing = (
      await client.query<Row & { actor: string }>(
        `SELECT ${fields}, actor FROM database_backup_jobs WHERE request_id=$1`,
        [requestId]
      )
    ).rows[0];
    if (existing) {
      if (
        existing.actor !== actor ||
        existing.source !== (daily ? 'daily' : 'manual')
      )
        throw new BackupError('BACKUP_REQUEST_CONFLICT', 409);
      await client.query('COMMIT');
      return map(existing);
    }
    const ready = (
      await client.query(
        `SELECT 1 FROM database_backup_worker WHERE singleton AND ready AND checked_at > NOW() - ($1::integer * INTERVAL '1 second')`,
        [BACKUP_WORKER_FRESHNESS_SECONDS]
      )
    ).rowCount;
    if (!ready) throw new BackupError('BACKUP_UNAVAILABLE');
    if (
      daily &&
      (
        await client.query(
          `SELECT 1 FROM database_backup_jobs WHERE scheduled_day=(NOW() AT TIME ZONE 'UTC')::date`
        )
      ).rowCount
    ) {
      await client.query('COMMIT');
      return null;
    }
    if (
      (
        await client.query(
          "SELECT 1 FROM database_backup_jobs WHERE status IN ('queued','running','unknown')"
        )
      ).rowCount
    )
      throw new BackupError('BACKUP_ACTIVE', 409);
    if (
      (
        await client.query(
          "SELECT 1 FROM database_backup_jobs WHERE created_at > NOW() - INTERVAL '15 minutes'"
        )
      ).rowCount
    )
      throw new BackupError('BACKUP_RATE_LIMIT', 429);
    const row = (
      await client.query<Row>(
        `INSERT INTO database_backup_jobs(request_id,actor,source,scheduled_day,status)
      VALUES($1,$2,$3,CASE WHEN $4 THEN (NOW() AT TIME ZONE 'UTC')::date ELSE NULL END,'queued') RETURNING ${fields}`,
        [requestId.toLowerCase(), actor, daily ? 'daily' : 'manual', daily]
      )
    ).rows[0];
    await backupAudit(client, requestId.toLowerCase(), actor, 'queued');
    await client.query('COMMIT');
    return map(row);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export const scheduleDailyBackup = (pool: Pool) =>
  requestBackup(pool, randomUUID(), 'backup-scheduler', true);

export async function finishBackup(
  pool: Pool,
  requestId: string,
  status: 'succeeded' | 'failed' | 'unknown',
  proof?: { bytes: number; sha256: string; retainUntil: string }
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE database_backup_jobs SET status=$2, finished_at=NOW(), bytes=$3, sha256=$4, retain_until=$5
      WHERE request_id=$1 AND status IN ('running','unknown') RETURNING actor`,
      [
        requestId,
        status,
        proof?.bytes ?? null,
        proof?.sha256 ?? null,
        proof?.retainUntil ?? null
      ]
    );
    if (result.rowCount)
      await backupAudit(client, requestId, 'backup-worker', status);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
