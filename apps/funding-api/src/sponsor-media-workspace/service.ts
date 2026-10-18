import type { Pool } from 'pg';
import type {
  SponsorMediaBatchExecuteRequest,
  SponsorMediaBatchPlanRequest,
  SponsorMediaBatchRequest,
  SponsorMediaRuleRequest
} from '@openg7/funding-core';

import type { SponsorMediaStorage } from '../sponsor-media-storage.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import { insertAdminAuditLog } from '../fund-admin-audit.repository.js';

import { ensure, validId, validatePlan } from './policy.js';
import { readWorkspace } from './read.js';
import { createBatch, setRules } from './rules.js';
import { executeBatch, planBatch } from './plans.js';
import { attestMediaSources } from './source-attestation.js';

export class SponsorMediaWorkspaceService {
  private busy = false;
  constructor(
    private readonly pool: Pool,
    private readonly storage: Pick<
      SponsorMediaStorage,
      'deletePrivateObject' | 'deletePublicObject' | 'readPrivateObject'
    >
  ) {}
  workspace(contributionId: string, writable = true) {
    ensure(validId(contributionId), 'INVALID_SPONSORSHIP_ID', 400);
    return withPostgresTransaction(
      this.pool,
      (db) => readWorkspace(db, contributionId, writable),
      { readOnlySnapshot: true }
    );
  }
  rules(input: SponsorMediaRuleRequest, actor: string) {
    return setRules(this.pool, input, actor);
  }
  batch(input: SponsorMediaBatchRequest, actor: string) {
    return createBatch(this.pool, input, actor);
  }
  async plan(input: SponsorMediaBatchPlanRequest, actor: string) {
    validatePlan(input);
    const attestations = ['approve', 'website_select'].includes(input.action)
      ? await attestMediaSources(
          this.pool,
          this.storage,
          input.contributionId,
          input.assets.map((a) => a.id)
        )
      : new Map();
    return planBatch(this.pool, input, actor, attestations);
  }
  async execute(input: SponsorMediaBatchExecuteRequest, actor: string) {
    ensure(
      input &&
        validId(input.requestId) &&
        validId(input.planId) &&
        input.confirmation === input.planId &&
        input.humanReviewed === true,
      'CONFIRMATION_REQUIRED',
      400
    );
    const row = (
      await this.pool.query(
        'SELECT actor,plan,contribution_id FROM sponsor_media_batch_plans WHERE id=$1',
        [input.planId]
      )
    ).rows[0];
    ensure(row, 'MEDIA_PLAN_NOT_FOUND', 404);
    ensure(row.actor === actor, 'MEDIA_PLAN_ACTOR_MISMATCH', 403);
    // A completed receipt remains authoritative after subsequent file removal.
    if ((await this.receipt(row.contribution_id, input.requestId, actor)).found)
      return executeBatch(this.pool, input, actor);
    const request = row.plan.request as SponsorMediaBatchPlanRequest;
    const attestations = ['approve', 'website_select'].includes(request.action)
      ? await attestMediaSources(
          this.pool,
          this.storage,
          request.contributionId,
          request.assets.map((a) => a.id)
        )
      : new Map();
    return executeBatch(this.pool, input, actor, attestations);
  }
  async receipt(
    contributionId: string,
    requestId: string,
    actor: string
  ): Promise<{ found: boolean; result?: unknown }> {
    ensure(
      validId(contributionId) && validId(requestId),
      'INVALID_MEDIA_RECEIPT',
      400
    );
    const row = (
      await this.pool.query(
        'SELECT actor,result FROM sponsor_media_workspace_commands WHERE contribution_id=$1 AND request_id=$2',
        [contributionId, requestId]
      )
    ).rows[0];
    if (!row) return { found: false };
    ensure(row.actor === actor, 'MEDIA_RECEIPT_ACTOR_MISMATCH', 403);
    return { found: true, result: row.result };
  }
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
