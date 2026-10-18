import type { Pool } from 'pg';
import type {
  SponsorMediaBatchExecuteRequest,
  SponsorMediaBatchPlanRequest,
  SponsorMediaBatchRequest,
  SponsorMediaRuleRequest
} from '@openg7/funding-core';

import type { SponsorMediaStorage } from '../sponsor-media-storage.js';
import { withPostgresTransaction } from '../postgres-transaction.js';

import { SponsorMediaCleanupWorker } from './cleanup.js';
import { ensure, validId, validatePlan } from './policy.js';
import { readWorkspace } from './read.js';
import { createBatch, setRules } from './rules.js';
import { executeBatch, planBatch } from './plans.js';
import { attestMediaSources } from './source-attestation.js';

export class SponsorMediaWorkspaceService {
  private readonly cleanup: SponsorMediaCleanupWorker;
  constructor(
    private readonly pool: Pool,
    private readonly storage: Pick<
      SponsorMediaStorage,
      'deletePrivateObject' | 'deletePublicObject' | 'readPrivateObject'
    >
  ) {
    this.cleanup = new SponsorMediaCleanupWorker(pool, storage);
  }
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
  tick(limit = 10): Promise<void> {
    return this.cleanup.tick(limit);
  }
}
