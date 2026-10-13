import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { insertAdminAuditLog } from '../fund-admin.repository.js';

import { sponsorshipObligationTimingProjectionSql } from './read.js';
import type { SponsorshipVisibilityConfig } from './visibility-config.js';
import {
  createPublicObservationGet,
  type PublicObservationGet
} from './visibility-http.js';
import {
  observePublicPresence,
  type PublicPresenceResult
} from './visibility-reader.js';

interface Candidate {
  readonly id: string;
  readonly contribution_id: string;
  readonly version: number;
  readonly start_id: string;
  readonly content_fingerprint: string;
  readonly source_snapshot: unknown;
  readonly media_snapshot: unknown;
  readonly next_directory_page: number;
  readonly cursor_obligation_id: string | null;
}

/** Single cross-process reader, no transaction during HTTP, persistent round-robin progress. */
export class SponsorshipPublicVisibilityWorker {
  private running = false;
  private readonly get: PublicObservationGet | null;
  constructor(
    private readonly pool: Pool,
    private readonly config: SponsorshipVisibilityConfig,
    get?: PublicObservationGet
  ) {
    this.get =
      config.enabled && config.origin
        ? (get ?? createPublicObservationGet(config.origin))
        : null;
  }

  async tick(): Promise<{ checked: number; incidents: number }> {
    if (!this.get || this.running) return { checked: 0, incidents: 0 };
    this.running = true;
    let db: PoolClient | undefined;
    let locked = false;
    let discard = false;
    let previousTimeout: string | undefined;
    let activeObservation: string | undefined;
    const summary = { checked: 0, incidents: 0 };
    try {
      db = await this.pool.connect();
      locked =
        (
          await db.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock(hashtextextended('sponsorship-public-visibility',0)) AS locked"
          )
        ).rows[0]?.locked === true;
      if (!locked) return summary;
      previousTimeout = (
        await db.query<{ timeout: string }>(
          "SELECT current_setting('statement_timeout') AS timeout"
        )
      ).rows[0]!.timeout;
      await db.query("SELECT set_config('statement_timeout','5000',false)");
      const candidates = (
        await db.query<Candidate>(
          `SELECT ob.id,ob.contribution_id,ob.version,v.id AS start_id,
          v.content_fingerprint,v.source_snapshot,v.media_snapshot,COALESCE(last.next_directory_page,1) AS next_directory_page,
          worker.cursor_obligation_id
        FROM sponsorship_obligations ob JOIN sponsorship_obligation_timing t ON t.obligation_id=ob.id
        JOIN sponsorship_public_visibility_worker worker ON worker.id=TRUE
        JOIN LATERAL (SELECT * FROM sponsorship_website_exposure_observations WHERE obligation_id=ob.id
          ORDER BY observed_at DESC,id DESC LIMIT 1) v ON TRUE
        LEFT JOIN LATERAL (SELECT checked_at,next_directory_page FROM sponsorship_public_visibility_observations
          WHERE obligation_id=ob.id AND start_observation_id=v.id ORDER BY checked_at DESC,id DESC LIMIT 1) last ON TRUE
        WHERE ob.state IN ('pending','blocked') AND ob.channel='website' AND ob.target='openg7' AND t.duration_days IS NOT NULL
          AND (${sponsorshipObligationTimingProjectionSql('ob')}->>'durationState')<>'restart_required'
          AND (last.checked_at IS NULL OR last.checked_at<=clock_timestamp()-$1::int*INTERVAL '1 millisecond')
        ORDER BY CASE WHEN worker.cursor_obligation_id IS NULL OR ob.id>worker.cursor_obligation_id THEN 0 ELSE 1 END,ob.id LIMIT $2`,
          [this.config.intervalMs, this.config.batchSize]
        )
      ).rows;
      if (!candidates.length) return summary;
      let previousCursor = candidates[0]!.cursor_obligation_id;
      const budget = {
        deadline: Date.now() + 45000,
        remainingRequests: 48,
        remainingBytes: 16 * 1024 * 1024
      };
      for (const candidate of candidates) {
        if (
          budget.deadline <= Date.now() ||
          budget.remainingRequests <= 0 ||
          budget.remainingBytes <= 0
        )
          break;
        // A human duration attestation tries this same key without waiting.
        // This is a session lock, not an open database transaction during HTTP.
        const canObserve =
          (
            await db.query<{ locked: boolean }>(
              "SELECT pg_try_advisory_lock(hashtextextended('sponsorship-public-observation:'||$1::text,0)) AS locked",
              [candidate.id]
            )
          ).rows[0]?.locked === true;
        if (!canObserve) continue;
        activeObservation = candidate.id;
        // Only a candidate that can start spends the durable cursor. Budget-skipped
        // followers stay unobserved and lead the next run; a crashed candidate is skipped.
        await db.query(
          'UPDATE sponsorship_public_visibility_worker SET cursor_obligation_id=$1::uuid,last_claimed_at=clock_timestamp() WHERE id=TRUE',
          [candidate.id]
        );
        const startedAt = new Date().toISOString();
        const observation = await observePublicPresence(
          {
            contributionId: candidate.contribution_id,
            sourceSnapshot: candidate.source_snapshot,
            mediaSnapshot: candidate.media_snapshot,
            nextDirectoryPage: candidate.next_directory_page
          },
          this.get,
          budget
        );
        if (
          observation.requestCount === 0 &&
          observation.reason === 'CHECK_BUDGET_EXHAUSTED'
        ) {
          // The checkpoint itself may outlive the deadline. Preserve this unstarted
          // dossier's priority and never manufacture a dated HTTP observation.
          await db.query(
            'UPDATE sponsorship_public_visibility_worker SET cursor_obligation_id=$1::uuid WHERE id=TRUE',
            [previousCursor]
          );
          break;
        }
        previousCursor = candidate.id;
        const saved = await this.record(db, candidate, startedAt, observation);
        summary.checked++;
        if (saved.status !== 'visible') summary.incidents++;
        await db.query(
          "SELECT pg_advisory_unlock(hashtextextended('sponsorship-public-observation:'||$1::text,0))",
          [activeObservation]
        );
        activeObservation = undefined;
      }
      return summary;
    } finally {
      if (activeObservation && db) {
        try {
          await db.query(
            "SELECT pg_advisory_unlock(hashtextextended('sponsorship-public-observation:'||$1::text,0))",
            [activeObservation]
          );
        } catch {
          discard = true;
        }
      }
      if (previousTimeout !== undefined && db) {
        try {
          await db.query("SELECT set_config('statement_timeout',$1,false)", [
            previousTimeout
          ]);
        } catch {
          discard = true;
        }
      }
      if (locked && db) {
        try {
          await db.query(
            "SELECT pg_advisory_unlock(hashtextextended('sponsorship-public-visibility',0))"
          );
        } catch {
          discard = true;
        }
      }
      db?.release(discard);
      this.running = false;
    }
  }

  private async record(
    db: PoolClient,
    candidate: Candidate,
    startedAt: string,
    observation: PublicPresenceResult
  ) {
    await db.query('BEGIN');
    try {
      // Same domain lock order as human timing commands. HTTP has already finished.
      await db.query(
        'SELECT id FROM fund_contributions WHERE id=$1::uuid FOR UPDATE',
        [candidate.contribution_id]
      );
      await db.query(
        'SELECT id FROM sponsorship_commitments WHERE contribution_id=$1::uuid FOR UPDATE',
        [candidate.contribution_id]
      );
      const current =
        (
          await db.query<{ current: boolean }>(
            `SELECT ob.version=$2 AND ob.state IN ('pending','blocked')
          AND v.id=$3::uuid AND v.content_fingerprint=$4
          AND (${sponsorshipObligationTimingProjectionSql('ob')}->>'durationState')<>'restart_required' AS current
         FROM sponsorship_obligations ob JOIN sponsorship_obligation_timing t ON t.obligation_id=ob.id
         JOIN LATERAL (SELECT id,content_fingerprint FROM sponsorship_website_exposure_observations WHERE obligation_id=ob.id
           ORDER BY observed_at DESC,id DESC LIMIT 1) v ON TRUE
         WHERE ob.id=$1::uuid FOR UPDATE OF ob,t`,
            [
              candidate.id,
              candidate.version,
              candidate.start_id,
              candidate.content_fingerprint
            ]
          )
        ).rows[0]?.current === true;
      const saved = current
        ? observation
        : {
            ...observation,
            status: 'unknown' as const,
            reason: 'SOURCE_CHANGED' as const
          };
      const requestId = randomUUID();
      await db.query(
        `INSERT INTO sponsorship_public_visibility_observations(request_id,obligation_id,contribution_id,start_observation_id,
          obligation_version,content_fingerprint,started_at,checked_at,status,reason,http_status,request_count,next_directory_page)
         VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10,$11,$12,$13)`,
        [
          requestId,
          candidate.id,
          candidate.contribution_id,
          candidate.start_id,
          candidate.version,
          candidate.content_fingerprint,
          startedAt,
          saved.checkedAt,
          saved.status,
          saved.reason,
          saved.httpStatus,
          saved.requestCount,
          saved.nextDirectoryPage
        ]
      );
      if (current)
        await db.query(
          'UPDATE sponsorship_obligation_timing SET version=version+1 WHERE obligation_id=$1::uuid',
          [candidate.id]
        );
      if (
        !(await insertAdminAuditLog(db, {
          actor: 'system:sponsorship-public-visibility',
          action: 'sponsorship_timing.public_observed',
          entityType: 'sponsorship',
          entityId: candidate.contribution_id,
          summary:
            'Controlled public visibility sampled; human continuity review remains required.',
          metadata: {
            requestId,
            obligationId: candidate.id,
            status: saved.status,
            reason: saved.reason
          }
        }))
      )
        throw new Error('PUBLIC_OBSERVATION_AUDIT_UNAVAILABLE');
      await db.query('COMMIT');
      return saved;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }
}
