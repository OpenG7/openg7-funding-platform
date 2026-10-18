import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import {
  MODERATION_POLICY_VERSION,
  classifySponsorMedia,
  validateModerationDecision,
  type ModerationDecisionInput,
  type SponsorMediaBatchPlanRequest,
  type SponsorMediaBatchPlan,
  type SponsorMediaBatchExecuteRequest,
  type SponsorMediaBatchReceipt,
  type SponsorMediaWorkspaceAsset
} from '../../../../packages/funding-core/src/index.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import {
  getModerationContent,
  assertModerationApproved,
  recordModerationDecision
} from '../moderation/repository.js';
import { sponsorMediaPublicUrl } from '../sponsor-media/public-url.js';

import {
  ensure,
  fingerprint,
  lockWorkspace,
  record,
  replay,
  validId,
  validatePlan
} from './policy.js';
import { readWorkspace } from './read.js';
import type { MediaSourceAttestation } from './source-attestation.js';

interface ManifestItem {
  id: string;
  version: string;
  fingerprint: string;
  candidateFingerprint: string;
  decisionRequestId: string;
  currentDecisionId: string | null;
  sourceChecksum?: string;
}
interface StoredPlan {
  request: SponsorMediaBatchPlanRequest;
  manifest: ManifestItem[];
  response: SponsorMediaBatchPlan;
}

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
    if (input.action === 'move' && input.targetBatchId)
      ensure(
        workspace.batches.some((b) => b.id === input.targetBatchId),
        'MEDIA_SCOPE_MISMATCH',
        400
      );
    const rule =
      input.action === 'rules' && input.ruleId
        ? workspace.rules.find((r) => r.id === input.ruleId)
        : null;
    if (input.action === 'rules' && input.ruleId)
      ensure(rule, 'MEDIA_RULE_NOT_FOUND', 404);
    const coveredByRule = rule
      ? new Set(
          (
            await db.query(
              `SELECT a.id FROM sponsor_media_assets a
      JOIN sponsor_media_rule_versions r ON r.id=$1 WHERE a.contribution_id=$2 AND a.deleted_at IS NULL
      AND (a.id=ANY(r.covered_asset_ids) OR (r.authorization_scope='scope' AND a.created_at>=r.created_at))`,
              [rule.id, input.contributionId]
            )
          ).rows.map((row) => row.id as string)
        )
      : null;
    const selected: SponsorMediaWorkspaceAsset[] = [];
    const manifest: ManifestItem[] = [];
    const blocked: { id: string; reasons: readonly string[] }[] = [];
    for (const requested of [...input.assets].sort((a, b) =>
      a.id.localeCompare(b.id)
    )) {
      const asset = workspace.assets.find((a) => a.id === requested.id);
      ensure(asset, 'MEDIA_SCOPE_MISMATCH', 400);
      ensure(asset.version === requested.version, 'MEDIA_VERSION_CONFLICT');
      const content = await getModerationContent(db, {
        type: 'media',
        id: asset.id
      });
      const candidate = {
        ...asset,
        altText:
          requested.altText === undefined
            ? asset.altText
            : requested.altText?.trim() || null
      };
      const candidateSnapshot = {
        ...content.snapshot,
        altText: candidate.altText
      };
      const candidateFingerprint = (
        await db.query(
          "SELECT encode(digest($1::jsonb::text,'sha256'),'hex') AS hash",
          [JSON.stringify(candidateSnapshot)]
        )
      ).rows[0].hash as string;
      const reasons: string[] = [];
      const attestation = attestations.get(asset.id);
      if (
        ['approve', 'website_select'].includes(input.action) &&
        (!attestation?.valid || attestation.version !== asset.version)
      )
        reasons.push('MEDIA_CONTENT_UNAVAILABLE');
      if (input.action === 'approve') {
        if (
          asset.reviewStatus === 'approved' &&
          candidate.altText === asset.altText
        )
          reasons.push('MEDIA_ALREADY_APPROVED');
        const readiness = classifySponsorMedia({
          usage: asset.usage,
          reviewStatus: asset.reviewStatus,
          altText: candidate.altText,
          moderationState: asset.moderation.state,
          moderationLevel: asset.moderation.level,
          technicalValid:
            asset.width > 0 && asset.height > 0 && asset.processedSizeBytes > 0,
          restrictionsReviewed:
            asset.usageRestrictionsReviewed ||
            requested.usageRestrictionsConfirmed === true,
          humanReviewed: true
        });
        candidate.readiness = readiness;
        candidate.usageRestrictionsReviewed =
          asset.usageRestrictionsReviewed ||
          requested.usageRestrictionsConfirmed === true;
        if (readiness.state === 'blocked') reasons.push(...readiness.reasons);
        if (!candidate.altText) reasons.push('MEDIA_ALT_TEXT_REQUIRED');
        if (
          asset.usage?.restrictions &&
          !asset.usageRestrictionsReviewed &&
          !requested.usageRestrictionsConfirmed
        )
          reasons.push('MEDIA_RESTRICTIONS_REVIEW_REQUIRED');
        if (asset.readiness.reasons.includes('MODERATION_RECONSIDERATION_OPEN'))
          reasons.push('MODERATION_RECONSIDERATION_OPEN');
      }
      if (
        input.action === 'website_select' &&
        (asset.reviewStatus !== 'approved' ||
          asset.moderation.state !== 'approved' ||
          asset.usage?.state !== 'confirmed' ||
          !asset.usage.channels.includes('website') ||
          !asset.usage.targets.includes('openg7') ||
          (asset.usage.restrictions && !asset.usageRestrictionsReviewed))
      )
        reasons.push('MEDIA_NOT_APPROVED_FOR_WEBSITE');
      if (
        ['rules', 'move'].includes(input.action) &&
        asset.usage?.state === 'withdrawn'
      )
        reasons.push('MEDIA_USAGE_WITHDRAWN');
      if (
        rule &&
        (!coveredByRule?.has(asset.id) ||
          (rule.scope === 'media' && rule.scopeId !== asset.id) ||
          (rule.scope === 'batch' && rule.scopeId !== asset.batchId))
      )
        reasons.push('MEDIA_RULE_SCOPE_MISMATCH');
      const decisionRequestId = randomUUID();
      if (input.action === 'reject') {
        const decision: ModerationDecisionInput = {
          requestId: decisionRequestId,
          policyVersion: MODERATION_POLICY_VERSION,
          contentVersion: content.contentVersion,
          contentFingerprint: content.fingerprint,
          expectedDecisionId: content.currentDecisionId,
          confirmation: asset.id,
          level: 'N3',
          primaryReason: input.reason,
          internalReason: input.internalReason ?? input.sponsorExplanation,
          sponsorExplanation: input.sponsorExplanation
        };
        const error = validateModerationDecision(
          { type: 'media', id: asset.id },
          decision
        );
        if (error) reasons.push(error);
      }
      if (reasons.length) {
        blocked.push({ id: asset.id, reasons });
        candidate.readiness = { state: 'blocked', reasons };
      }
      selected.push(candidate);
      manifest.push({
        id: asset.id,
        version: asset.version,
        fingerprint: content.fingerprint,
        candidateFingerprint,
        decisionRequestId,
        currentDecisionId: content.currentDecisionId,
        ...(attestation ? { sourceChecksum: attestation.checksum } : {})
      });
    }
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
    const invalidateIds: string[] = [];
    for (const member of plan.manifest) {
      const selected = plan.request.assets.find((a) => a.id === member.id)!;
      if (
        plan.request.action === 'approve' ||
        plan.request.action === 'reject'
      ) {
        if (plan.request.action === 'approve' && selected.altText !== undefined)
          await db.query(
            'UPDATE sponsor_media_assets SET alt_text=$2,updated_at=clock_timestamp() WHERE id=$1 AND alt_text IS DISTINCT FROM $2',
            [member.id, selected.altText?.trim() || null]
          );
        const content = await getModerationContent(db, {
          type: 'media',
          id: member.id
        });
        ensure(
          content.fingerprint ===
            (plan.request.action === 'approve'
              ? member.candidateFingerprint
              : member.fingerprint),
          'MEDIA_PLAN_STALE'
        );
        const decision: ModerationDecisionInput = {
          requestId: member.decisionRequestId,
          policyVersion: MODERATION_POLICY_VERSION,
          contentVersion: content.contentVersion,
          contentFingerprint: content.fingerprint,
          expectedDecisionId: content.currentDecisionId,
          confirmation: member.id,
          level: plan.request.action === 'approve' ? 'N0' : 'N3',
          ...(plan.request.action === 'reject'
            ? {
                primaryReason: plan.request.reason,
                internalReason:
                  plan.request.internalReason ??
                  plan.request.sponsorExplanation,
                sponsorExplanation: plan.request.sponsorExplanation
              }
            : {})
        };
        await recordModerationDecision(db, {
          subject: { type: 'media', id: member.id },
          decision,
          actor
        });
        if (plan.request.action === 'approve')
          await db.query(
            `UPDATE sponsor_media_assets SET review_status='approved',reviewed_at=clock_timestamp(),reviewed_by=$2,
          public_url=$3,website_selected=FALSE,usage_restrictions_reviewed=usage_restrictions_reviewed OR $4,updated_at=clock_timestamp() WHERE id=$1`,
            [
              member.id,
              actor,
              sponsorMediaPublicUrl(member.id),
              selected.usageRestrictionsConfirmed === true
            ]
          );
      } else if (plan.request.action === 'delete') {
        await db.query(
          `INSERT INTO sponsor_media_cleanup_jobs(asset_id,plan_id,request_id,original_storage_key,processed_storage_key,public_storage_key)
          SELECT id,$2,$3,original_storage_key,processed_storage_key,public_storage_key FROM sponsor_media_assets WHERE id=$1`,
          [member.id, input.planId, input.requestId]
        );
        await db.query(
          "UPDATE sponsor_media_assets SET deleted_at=clock_timestamp(),review_status='pending_review',website_selected=FALSE,public_url=NULL,updated_at=clock_timestamp() WHERE id=$1",
          [member.id]
        );
        invalidateIds.push(member.id);
      } else if (
        plan.request.action === 'website_select' ||
        plan.request.action === 'website_deselect'
      ) {
        await db.query(
          'UPDATE sponsor_media_assets SET website_selected=$2,updated_at=clock_timestamp() WHERE id=$1',
          [member.id, plan.request.action === 'website_select']
        );
      } else {
        if (plan.request.action === 'move')
          await db.query(
            `UPDATE sponsor_media_assets SET media_batch_id=$2,updated_at=clock_timestamp() WHERE id=$1`,
            [member.id, plan.request.targetBatchId ?? null]
          );
        else {
          const rule = plan.request.ruleId
            ? workspace.rules.find((r) => r.id === plan.request.ruleId)
            : null;
          await db.query(
            'UPDATE sponsor_media_assets SET usage_inheritance=$2,updated_at=clock_timestamp() WHERE id=$1',
            [member.id, rule?.scope === 'media' ? 'override' : 'inherit']
          );
          if (rule)
            ensure(
              (
                await db.query(
                  "SELECT sponsor_media_effective_rule($1)->>'id' AS id",
                  [member.id]
                )
              ).rows[0].id === rule.id,
              'MEDIA_RULE_SCOPE_MISMATCH'
            );
        }
        invalidateIds.push(member.id);
      }
    }
    if (invalidateIds.length)
      await db.query('SELECT sponsor_media_invalidate_assets($1::uuid[])', [
        invalidateIds
      ]);
    const versions = (
      await db.query(
        'SELECT id,updated_at::text AS version FROM sponsor_media_assets WHERE id=ANY($1::uuid[])',
        [plan.manifest.map((member) => member.id)]
      )
    ).rows;
    const items = plan.manifest.map((member) => ({
      id: member.id,
      version: versions.find((row) => row.id === member.id).version as string,
      result: plan.request.action
    }));
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
