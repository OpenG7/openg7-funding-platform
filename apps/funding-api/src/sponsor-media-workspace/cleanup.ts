import type { Pool } from 'pg';

import { insertAdminAuditLog } from '../fund-admin-audit.repository.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import type { SponsorMediaStorage } from '../sponsor-media-storage.js';

import { ensure } from './policy.js';

/** Durable cleanup owns provider calls and retry leases, independently of review commands. */
export class SponsorMediaCleanupWorker {
  private busy = false;

  constructor(
    private readonly pool: Pool,
    private readonly storage: Pick<
      SponsorMediaStorage,
      'deletePrivateObject' | 'deletePublicObject'
    >
  ) {}

  /** Leased durable deletion: provider calls occur after the claim transaction commits. */
  async tick(limit = 10): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const jobs = await withPostgresTransaction(
        this.pool,
        async (db) =>
          (
            await db.query(
              `WITH claimed AS (
        SELECT id FROM sponsor_media_cleanup_jobs WHERE state='pending' AND next_attempt_at<=clock_timestamp()
          AND (locked_until IS NULL OR locked_until<clock_timestamp()) ORDER BY updated_at,id LIMIT $1 FOR UPDATE SKIP LOCKED)
        UPDATE sponsor_media_cleanup_jobs j SET locked_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1
        FROM claimed WHERE j.id=claimed.id RETURNING j.*`,
              [Math.min(100, Math.max(1, limit))]
            )
          ).rows
      );
      for (const job of jobs) {
        try {
          await this.storage.deletePrivateObject(job.original_storage_key);
          await this.storage.deletePrivateObject(job.processed_storage_key);
          if (job.public_storage_key)
            await this.storage.deletePublicObject(job.public_storage_key);
          await withPostgresTransaction(this.pool, async (db) => {
            const current = (
              await db.query(
                'SELECT state FROM sponsor_media_cleanup_jobs WHERE id=$1 FOR UPDATE',
                [job.id]
              )
            ).rows[0];
            if (current?.state === 'complete') return;
            const plan = (
              await db.query(
                'SELECT actor,request_id FROM sponsor_media_batch_plans WHERE id=$1',
                [job.plan_id]
              )
            ).rows[0];
            await db.query(
              `UPDATE sponsor_media_cleanup_jobs SET state='complete',locked_until=NULL,last_error=NULL,updated_at=clock_timestamp() WHERE id=$1`,
              [job.id]
            );
            ensure(
              await insertAdminAuditLog(db, {
                actor: plan.actor,
                action: 'sponsorship.media.cleanup.completed',
                entityType: 'sponsor_media_asset',
                entityId: job.asset_id,
                summary: 'Authorized media storage cleanup completed.',
                metadata: { planId: job.plan_id, requestId: job.request_id }
              }),
              'MEDIA_AUDIT_UNAVAILABLE',
              503
            );
          });
        } catch {
          await this.pool.query(
            `UPDATE sponsor_media_cleanup_jobs SET locked_until=NULL,last_error='MEDIA_CLEANUP_UNAVAILABLE',
            next_attempt_at=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp() WHERE id=$1`,
            [job.id]
          );
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
