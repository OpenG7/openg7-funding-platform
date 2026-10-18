import type { PoolClient } from 'pg';

import {
  MODERATION_POLICY_VERSION,
  type ModerationDecisionInput,
  type SponsorMediaBatchExecuteRequest,
  type SponsorMediaBatchReceipt,
  type SponsorMediaWorkspace
} from '../../../../packages/funding-core/src/index.js';
import {
  getModerationContent,
  recordModerationDecision
} from '../moderation/repository.js';
import { sponsorMediaPublicUrl } from '../sponsor-media/public-url.js';

import type { StoredPlan } from './plan-manifest.js';
import { ensure } from './policy.js';

/** Apply only a fully revalidated manifest, on the caller's locked transaction. */
export async function applyPlanMutations(
  db: PoolClient,
  plan: StoredPlan,
  input: SponsorMediaBatchExecuteRequest,
  actor: string,
  workspace: SponsorMediaWorkspace
): Promise<SponsorMediaBatchReceipt['items']> {
  const invalidateIds: string[] = [];
  for (const member of plan.manifest) {
    const selected = plan.request.assets.find((a) => a.id === member.id)!;
    if (plan.request.action === 'approve' || plan.request.action === 'reject') {
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
                plan.request.internalReason ?? plan.request.sponsorExplanation,
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
  return items;
}
