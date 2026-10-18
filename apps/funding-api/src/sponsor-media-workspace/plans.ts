import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import {
  type SponsorMediaBatchPlanRequest,
  type SponsorMediaBatchPlan,
  type SponsorMediaBatchExecuteRequest,
  type SponsorMediaBatchReceipt
} from '../../../../packages/funding-core/src/index.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import { assertModerationApproved } from '../moderation/repository.js';

import {
  ensure,
  fingerprint,
  lockWorkspace,
  record,
  replay,
  validId,
  validatePlan
} from './policy.js';
import { preparePlanManifest, type StoredPlan } from './plan-manifest.js';
import { applyPlanMutations } from './plan-mutations.js';
import { readWorkspace } from './read.js';
import type { MediaSourceAttestation } from './source-attestation.js';

export async function planBatch(
  pool: Pool,
  input: SponsorMediaBatchPlanRequest,
  actor: string,
  attestations: ReadonlyMap<string, MediaSourceAttestation> = new Map()
): Promise<SponsorMediaBatchPlan> {
  validatePlan(input);
  const hash = fingerprint(input);
  return withPostgresTransaction(pool, async (db) => {
    const revision = await lockWorkspace(db, input.contributionId);
    const prior = (
      await db.query(
        'SELECT payload_fingerprint,actor,plan FROM sponsor_media_batch_plans WHERE contribution_id=$1 AND request_id=$2',
        [input.contributionId, input.requestId]
      )
    ).rows[0];
    if (prior) {
      ensure(
        prior.payload_fingerprint === hash && prior.actor === actor,
        'IDEMPOTENCY_CONFLICT'
      );
      return prior.plan.response;
    }
    ensure(revision === input.expectedRevision, 'WORKSPACE_VERSION_CONFLICT');
    const workspace = await readWorkspace(db, input.contributionId);
    const {
      assets: selected,
      manifest,
      blocked
    } = await preparePlanManifest(db, input, workspace, attestations);
    const id = randomUUID();
    const response: SponsorMediaBatchPlan = {
      id,
      contributionId: input.contributionId,
      action: input.action,
      revision,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      assets: selected,
      blocked,
      effects:
        input.action === 'approve'
          ? [
              'ACCEPT_MEDIA_ONLY',
              'NO_SOCIAL_PUBLICATION',
              'WEBSITE_SELECTION_SEPARATE'
            ]
          : input.action === 'delete'
            ? ['REVOKE_MEDIA', 'DURABLE_STORAGE_CLEANUP']
            : input.action === 'website_select'
              ? ['SELECT_FOR_ELIGIBLE_PUBLIC_WEBSITE']
              : ['INVALIDATE_AFFECTED_APPROVALS']
    };
    const stored: StoredPlan = { request: input, manifest, response };
    await db.query(
      `INSERT INTO sponsor_media_batch_plans(id,contribution_id,request_id,payload_fingerprint,actor,workspace_revision,plan,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [
        id,
        input.contributionId,
        input.requestId,
        hash,
        actor,
        Number(revision),
        JSON.stringify(stored),
        response.expiresAt
      ]
    );
    return response;
  });
}

export async function executeBatch(
  pool: Pool,
  input: SponsorMediaBatchExecuteRequest,
  actor: string,
  attestations: ReadonlyMap<string, MediaSourceAttestation> = new Map()
): Promise<SponsorMediaBatchReceipt> {
  ensure(
    input &&
      validId(input.requestId) &&
      validId(input.planId) &&
      input.confirmation === input.planId &&
      input.humanReviewed === true,
    'CONFIRMATION_REQUIRED',
    400
  );
  const hash = fingerprint({ action: 'execute', input });
  return withPostgresTransaction(pool, async (db) => {
    const row = (
      await db.query(
        'SELECT contribution_id,actor,plan,expires_at FROM sponsor_media_batch_plans WHERE id=$1',
        [input.planId]
      )
    ).rows[0];
    ensure(row, 'MEDIA_PLAN_NOT_FOUND', 404);
    ensure(row.actor === actor, 'MEDIA_PLAN_ACTOR_MISMATCH', 403);
    const revision = await lockWorkspace(db, row.contribution_id);
    const previous = await replay(
      db,
      row.contribution_id,
      input.requestId,
      hash,
      actor
    );
    if (previous) return previous as SponsorMediaBatchReceipt;
    const plan = row.plan as StoredPlan;
    ensure(
      new Date(row.expires_at).getTime() > Date.now(),
      'MEDIA_PLAN_EXPIRED'
    );
    ensure(revision === plan.response.revision, 'WORKSPACE_VERSION_CONFLICT');
    ensure(plan.response.blocked.length === 0, 'MEDIA_PLAN_BLOCKED');
    await db.query(
      "SELECT set_config('openg7.media_actor',$1,true),set_config('openg7.media_request_id',$2,true)",
      [actor, input.requestId]
    );
    // Revalidate every member before the first business mutation. Any failure rolls back all members.
    const workspace = await readWorkspace(db, row.contribution_id);
    for (const member of plan.manifest) {
      if (['approve', 'website_select'].includes(plan.request.action)) {
        const attestation = attestations.get(member.id);
        ensure(
          attestation?.valid &&
            attestation.version === member.version &&
            attestation.checksum === member.sourceChecksum,
          'MEDIA_CONTENT_UNAVAILABLE'
        );
      }
      const asset = workspace.assets.find((a) => a.id === member.id);
      ensure(
        asset &&
          asset.version === member.version &&
          asset.moderation.fingerprint === member.fingerprint &&
          asset.moderation.currentDecisionId === member.currentDecisionId,
        'MEDIA_PLAN_STALE'
      );
      if (plan.request.action === 'website_select')
        await assertModerationApproved(db, { type: 'media', id: member.id });
    }
    const items = await applyPlanMutations(db, plan, input, actor, workspace);
    const result: SponsorMediaBatchReceipt = {
      requestId: input.requestId,
      planId: input.planId,
      status: 'completed',
      action: plan.request.action,
      items
    };
    await record(
      db,
      row.contribution_id,
      input.requestId,
      hash,
      actor,
      plan.request.action,
      result
    );
    return result;
  });
}
