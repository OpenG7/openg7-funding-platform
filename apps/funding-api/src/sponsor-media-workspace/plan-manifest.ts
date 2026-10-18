import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import {
  MODERATION_POLICY_VERSION,
  classifySponsorMedia,
  validateModerationDecision,
  type ModerationDecisionInput,
  type SponsorMediaBatchPlanRequest,
  type SponsorMediaBatchPlan,
  type SponsorMediaWorkspace,
  type SponsorMediaWorkspaceAsset
} from '../../../../packages/funding-core/src/index.js';
import { getModerationContent } from '../moderation/repository.js';

import { ensure } from './policy.js';
import type { MediaSourceAttestation } from './source-attestation.js';

export interface ManifestItem {
  id: string;
  version: string;
  fingerprint: string;
  candidateFingerprint: string;
  decisionRequestId: string;
  currentDecisionId: string | null;
  sourceChecksum?: string;
}
export interface StoredPlan {
  request: SponsorMediaBatchPlanRequest;
  manifest: ManifestItem[];
  response: SponsorMediaBatchPlan;
}

/** Build the exact reviewed candidates without changing any media state. */
export async function preparePlanManifest(
  db: PoolClient,
  input: SponsorMediaBatchPlanRequest,
  workspace: SponsorMediaWorkspace,
  attestations: ReadonlyMap<string, MediaSourceAttestation>
): Promise<
  Pick<StoredPlan, 'manifest'> &
    Pick<SponsorMediaBatchPlan, 'assets' | 'blocked'>
> {
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
  return { assets: selected, manifest, blocked };
}
