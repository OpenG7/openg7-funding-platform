import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import { PreflightClientError } from './client.js';
import type {
  PreflightMission,
  PreflightSourceUpdate,
  RemoteMissionDetail
} from './contracts.js';
import { parseValidatedPreparation } from './result-import.js';
import {
  persistPreflightPreparation,
  preflightTransaction,
  reconcileTrackedSources,
  type TrackedMission
} from './repository.js';
import type { ProducerSettings } from './source.js';

export interface PreflightTransport {
  submit(
    mission: PreflightMission
  ): Promise<{ mission: { id: string; status: string }; duplicate: boolean }>;
  notifySourceUpdate(
    event: PreflightSourceUpdate
  ): Promise<{ duplicate: boolean; invalidated: number }>;
  getMission(id: string): Promise<RemoteMissionDetail>;
}
interface OutboxRow {
  id: string;
  tenant_id: string;
  commitment_id: string;
  source_version: number;
  mission_id: string | null;
  event_type: 'mission.submitted' | 'source.updated';
  payload: PreflightMission | PreflightSourceUpdate;
  attempts: number;
  claim_token: string;
}
export interface ConnectorWorkerOptions {
  pool: Pool;
  settings: ProducerSettings;
  client: PreflightTransport;
  workerId?: string;
  maxAttempts?: number;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  batchSize?: number;
  log?: (record: Record<string, unknown>) => void;
}
function failure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof PreflightClientError)
    return { code: error.code, retryable: error.retryable };
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^preflight_[a-z_]{1,80}$/.test(error.code)
  )
    return { code: error.code, retryable: false };
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^(?:08[A-Z0-9]{3}|40001|40P01|53[A-Z0-9]{3}|57P0[123])$/.test(error.code)
  )
    return { code: 'preflight_database_unavailable', retryable: true };
  return { code: 'preflight_connector_failed', retryable: false };
}

/** A source outbox relay, not a second workflow scheduler. HTTP occurs outside DB transactions. */
export function createPreflightConnectorWorker(
  options: ConnectorWorkerOptions
) {
  const { pool, settings, client } = options;
  const workerId = options.workerId ?? randomUUID();
  const maxAttempts = options.maxAttempts ?? 5,
    requestTimeout = options.requestTimeoutMs ?? 10000,
    pollInterval = options.pollIntervalMs ?? 5000,
    batchSize = options.batchSize ?? 20;
  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 10 ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 100 ||
    !Number.isInteger(requestTimeout) ||
    requestTimeout < 1 ||
    requestTimeout > 60000 ||
    !Number.isInteger(pollInterval) ||
    pollInterval < 1 ||
    pollInterval > 300000
  )
    throw new Error('PREFLIGHT_WORKER_CONFIGURATION_INVALID');
  // A 401 may require token + API + token refresh + API; cover that bounded chain.
  const leaseMs = Math.max(requestTimeout * 5 + 5000, 30000);
  let ticking: Promise<{ delivered: number; polled: number }> | undefined;
  const log = options.log ?? (() => undefined);
  const heartbeat = () =>
    pool.query(
      'INSERT INTO preflight_worker_heartbeats(worker_id,tenant_id) VALUES($1,$2) ON CONFLICT(worker_id) DO UPDATE SET seen_at=NOW()',
      [workerId, settings.tenantId]
    );

  const claim = () =>
    preflightTransaction(pool, async (db) => {
      const row = (
        await db.query<OutboxRow>(
          `SELECT * FROM preflight_outbox WHERE tenant_id=$1 AND
      ((status='pending' AND next_attempt_at<=NOW()) OR (status='running' AND lease_until<=NOW()))
      ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [settings.tenantId]
        )
      ).rows[0];
      if (!row) return null;
      if (row.attempts >= maxAttempts) {
        await db.query(
          "UPDATE preflight_outbox SET status='quarantined',error_code='preflight_attempts_exhausted',lease_until=NULL,claim_token=NULL WHERE id=$1",
          [row.id]
        );
        return null;
      }
      const token = randomUUID();
      await db.query(
        "UPDATE preflight_outbox SET status='running',attempts=attempts+1,claim_token=$2,lease_until=NOW()+$3::int*interval '1 millisecond' WHERE id=$1",
        [row.id, token, leaseMs]
      );
      return { ...row, attempts: row.attempts + 1, claim_token: token };
    });
  const deliver = async (row: OutboxRow): Promise<boolean> => {
    try {
      let remoteStatus: string | undefined;
      if (row.event_type === 'mission.submitted')
        remoteStatus = (await client.submit(row.payload as PreflightMission))
          .mission.status;
      else
        await client.notifySourceUpdate(row.payload as PreflightSourceUpdate);
      const acknowledged = await preflightTransaction(pool, async (db) => {
        const updated = await db.query(
          "UPDATE preflight_outbox SET status='delivered',delivered_at=NOW(),error_code=NULL,claim_token=NULL,lease_until=NULL WHERE id=$1 AND tenant_id=$2 AND claim_token=$3 AND status='running' RETURNING id",
          [row.id, settings.tenantId, row.claim_token]
        );
        if (updated.rowCount && row.mission_id)
          await db.query(
            'UPDATE preflight_missions SET remote_status=$3,poll_after=NOW(),error_code=NULL,updated_at=NOW() WHERE mission_id=$1 AND tenant_id=$2',
            [row.mission_id, settings.tenantId, remoteStatus]
          );
        return Boolean(updated.rowCount);
      });
      log({
        event: acknowledged
          ? 'preflight.delivered'
          : 'preflight.stale_delivery_ignored',
        eventId: row.id,
        missionId: row.mission_id,
        sourceVersion: row.source_version,
        attempt: row.attempts
      });
      return acknowledged;
    } catch (error) {
      const detail = failure(error),
        quarantine = !detail.retryable || row.attempts >= maxAttempts;
      const backoff = Math.min(300000, 1000 * 2 ** (row.attempts - 1));
      await pool.query(
        `UPDATE preflight_outbox SET status=$4,error_code=$5,lease_until=NULL,claim_token=NULL,
        next_attempt_at=NOW()+$6::int*interval '1 millisecond' WHERE id=$1 AND tenant_id=$2 AND claim_token=$3 AND status='running'`,
        [
          row.id,
          settings.tenantId,
          row.claim_token,
          quarantine ? 'quarantined' : 'pending',
          detail.code,
          backoff
        ]
      );
      log({
        event: 'preflight.delivery_failed',
        eventId: row.id,
        missionId: row.mission_id,
        attempt: row.attempts,
        code: detail.code,
        quarantined: quarantine
      });
      return false;
    }
  };
  const poll = async () => {
    const rows = await preflightTransaction(pool, async (db) => {
      const selected = (
        await db.query<TrackedMission>(
          `SELECT m.* FROM preflight_missions m WHERE m.tenant_id=$1 AND m.current AND m.poll_after<=NOW()
        AND EXISTS(SELECT 1 FROM preflight_outbox o WHERE o.mission_id=m.mission_id AND o.status='delivered' AND o.event_type='mission.submitted')
        ORDER BY m.poll_after,m.mission_id LIMIT $2 FOR UPDATE OF m SKIP LOCKED`,
          [settings.tenantId, batchSize]
        )
      ).rows;
      for (const row of selected)
        await db.query(
          "UPDATE preflight_missions SET poll_after=NOW()+$2::int*interval '1 millisecond' WHERE mission_id=$1",
          [row.mission_id, leaseMs]
        );
      return selected;
    });
    for (const row of rows) {
      try {
        const detail = await client.getMission(row.mission_id);
        const preparation = parseValidatedPreparation(detail, {
          tenantId: settings.tenantId,
          subjectId: row.commitment_id,
          sourceVersion: row.source_version,
          sourceHash: row.source_hash
        });
        if (preparation) {
          const imported = await persistPreflightPreparation(
            pool,
            preparation,
            {
              tenantId: settings.tenantId,
              commitmentId: row.commitment_id,
              sourceVersion: row.source_version,
              sourceHash: row.source_hash
            }
          );
          if (!imported)
            await pool.query(
              "UPDATE preflight_missions SET error_code='preflight_source_obsolete',poll_after='infinity',updated_at=NOW() WHERE mission_id=$1 AND tenant_id=$2",
              [row.mission_id, settings.tenantId]
            );
          log({
            event: imported
              ? 'preflight.preparation_imported'
              : 'preflight.preparation_obsolete',
            missionId: row.mission_id,
            sourceVersion: row.source_version
          });
        } else {
          const terminal = [
            'completed',
            'failed',
            'cancelled',
            'superseded'
          ].includes(detail.mission.status);
          await pool.query(
            `UPDATE preflight_missions SET remote_status=$3,poll_attempts=0,error_code=$4,
            poll_after=CASE WHEN $5::boolean THEN 'infinity'::timestamptz ELSE NOW()+$6::int*interval '1 millisecond' END,updated_at=NOW()
            WHERE mission_id=$1 AND tenant_id=$2 AND current`,
            [
              row.mission_id,
              settings.tenantId,
              detail.mission.status,
              detail.mission.status === 'failed'
                ? 'preflight_remote_failed'
                : null,
              terminal,
              pollInterval
            ]
          );
        }
      } catch (error) {
        const detail = failure(error),
          attempt = row.poll_attempts + 1,
          quarantine = !detail.retryable || attempt >= maxAttempts;
        await pool.query(
          `UPDATE preflight_missions SET poll_attempts=$3,error_code=$4,
          poll_after=CASE WHEN $5::boolean THEN 'infinity'::timestamptz ELSE NOW()+$6::int*interval '1 millisecond' END,updated_at=NOW()
          WHERE mission_id=$1 AND tenant_id=$2 AND current`,
          [
            row.mission_id,
            settings.tenantId,
            attempt,
            detail.code,
            quarantine,
            Math.min(300000, 1000 * 2 ** (attempt - 1))
          ]
        );
        log({
          event: 'preflight.poll_failed',
          missionId: row.mission_id,
          code: detail.code,
          attempt,
          quarantined: quarantine
        });
      }
      await heartbeat();
    }
    return rows.length;
  };
  const run = async () => {
    if (!settings.enabled) return { delivered: 0, polled: 0 };
    await heartbeat();
    await reconcileTrackedSources(pool, settings, batchSize);
    let delivered = 0;
    for (let index = 0; index < batchSize; index++) {
      const row = await claim();
      if (!row) break;
      if (await deliver(row)) delivered++;
      await heartbeat();
    }
    return { delivered, polled: await poll() };
  };
  return {
    workerId,
    tick(): Promise<{ delivered: number; polled: number }> {
      if (!ticking)
        ticking = run().finally(() => {
          ticking = undefined;
        });
      return ticking;
    },
    async stop(): Promise<void> {
      await ticking;
    }
  };
}
