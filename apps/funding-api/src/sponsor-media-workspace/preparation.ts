import type { PoolClient } from 'pg';

import {
  publicationFormatCapability,
  type SponsorMediaTransformation,
  type SponsorMediaPreparationAssignment,
  type SponsorMediaPreparationObligation,
  type SponsorMediaWorkspaceAsset
} from '../../../../packages/funding-core/src/index.js';

import { ensure, MediaWorkspaceError } from './policy.js';

const targetFingerprint = `encode(digest((jsonb_build_array(ob.id,ob.version,ob.channel,ob.target,
  ob.publication_format,ob.state,m.version,m.state,m.offer_id,c.status,c.sponsorship_refund_status,
  c.public_display_consent,c.sponsor_review_status) || COALESCE(
    (SELECT jsonb_build_array(id) FROM admin_sponsorship_consent_records
      WHERE contribution_id=c.id ORDER BY recorded_at DESC,id DESC LIMIT 1),'[]'::jsonb))::text,'sha256'),'hex')`;

interface PreparationTarget extends SponsorMediaPreparationObligation {
  readonly fingerprint: string;
  readonly eligible: boolean;
}
type TargetRow = Omit<PreparationTarget, 'acceptsMedia'>;

const targetSelect = `SELECT ob.id,ob.version,ob.channel,ob.target,ob.ordinal,
  ob.publication_format AS format,ob.state,${targetFingerprint} AS fingerprint,
  (m.state='active' AND c.status='paid' AND c.sponsorship_refund_status='not_requested'
    AND c.public_display_consent AND c.sponsor_review_status<>'rejected') AS eligible
  FROM sponsorship_obligations ob JOIN sponsorship_commitments m ON m.id=ob.commitment_id
  JOIN fund_contributions c ON c.id=ob.contribution_id`;

function target(row: TargetRow): PreparationTarget {
  return {
    ...row,
    acceptsMedia:
      ['pending', 'blocked'].includes(row.state) &&
      (row.channel === 'website'
        ? row.target === 'openg7'
        : !!row.format &&
          publicationFormatCapability(row.channel, row.format).available &&
          publicationFormatCapability(row.channel, row.format).requiresImage)
  };
}

/** Exact owner/version is checked in addition to the workspace's media revision. */
export async function readPreparationTarget(
  db: Pick<PoolClient, 'query'>,
  contributionId: string,
  obligationId: string,
  expectedVersion: number,
  lock = false
): Promise<PreparationTarget> {
  const result = await db.query<TargetRow>(
    `${targetSelect} WHERE ob.contribution_id=$1::uuid AND ob.id=$2::uuid${lock ? ' FOR SHARE OF ob,m' : ''}`,
    [contributionId, obligationId]
  );
  ensure(result.rows[0], 'MEDIA_PREPARATION_SCOPE_MISMATCH', 400);
  ensure(
    result.rows[0].version === expectedVersion,
    'MEDIA_PREPARATION_VERSION_CONFLICT'
  );
  return target(result.rows[0]);
}

export function preparationTargetSummary(
  value: PreparationTarget
): SponsorMediaPreparationObligation {
  return {
    id: value.id,
    version: value.version,
    channel: value.channel,
    target: value.target,
    ordinal: value.ordinal,
    format: value.format,
    state: value.state,
    acceptsMedia: value.acceptsMedia
  };
}

/** Preparation may precede N0, but cannot invent rights, formats or destinations. */
export function mediaPreparationIssues(
  asset: SponsorMediaWorkspaceAsset,
  value: PreparationTarget
): readonly string[] {
  const issues: string[] = [];
  if (!value.eligible) issues.push('MEDIA_PREPARATION_DOSSIER_INELIGIBLE');
  if (!value.acceptsMedia) issues.push('MEDIA_PREPARATION_FORMAT_UNSUPPORTED');
  if (value.channel !== 'website' && asset.kind !== 'supporting_image')
    issues.push('MEDIA_PREPARATION_KIND_UNSUPPORTED');
  if (
    asset.reviewStatus === 'rejected' ||
    [
      'correction_requested',
      'on_hold',
      'pending_independent_review',
      'rejected',
      'removed'
    ].includes(asset.moderation.state ?? '') ||
    asset.readiness.reasons.includes('MODERATION_RECONSIDERATION_OPEN')
  )
    issues.push('MEDIA_PREPARATION_REVIEW_RESTRICTED');
  const usage = asset.usage;
  if (usage?.state !== 'confirmed')
    issues.push(
      usage?.state === 'withdrawn'
        ? 'MEDIA_USAGE_WITHDRAWN'
        : 'MEDIA_USAGE_CONFIRMATION_REQUIRED'
    );
  else {
    if (!usage.channels.includes(value.channel))
      issues.push('MEDIA_CHANNEL_NOT_AUTHORIZED');
    if (!usage.targets.includes(value.target))
      issues.push('MEDIA_TARGET_NOT_AUTHORIZED');
    const transforms: SponsorMediaTransformation[] = ['technical'];
    if (value.format === 'individual_portrait') transforms.push('portrait');
    if (value.format === 'collective_composite') transforms.push('composite');
    if (transforms.some((item) => !usage.transformations.includes(item)))
      issues.push('MEDIA_TRANSFORMATION_NOT_AUTHORIZED');
    if (usage.restrictions && !asset.usageRestrictionsReviewed)
      issues.push('MEDIA_RESTRICTIONS_REVIEW_REQUIRED');
  }
  return issues;
}

/** Reusable read projection for the gallery and Examiner; absence is never invented as an empty set. */
export async function readMediaPreparation(
  db: Pick<PoolClient, 'query'>,
  contributionId: string
): Promise<{
  preparationObligations: readonly SponsorMediaPreparationObligation[];
  preparationAssignments: readonly SponsorMediaPreparationAssignment[];
}> {
  try {
    const obligations = await db.query<TargetRow>(
      `${targetSelect} WHERE ob.contribution_id=$1::uuid ORDER BY ob.channel,ob.target,ob.ordinal,ob.id`,
      [contributionId]
    );
    const assignments = await db.query<SponsorMediaPreparationAssignment>(
      `SELECT a.id,a.obligation_id AS "obligationId",a.obligation_version AS "obligationVersion",
        a.asset_id AS "assetId",a.asset_version AS "assetVersion",a.actor,a.created_at::text AS "createdAt",
        (a.obligation_version<>ob.version OR a.obligation_fingerprint<>${targetFingerprint}
          OR a.asset_version<>media.updated_at::text OR media.deleted_at IS NOT NULL
          OR a.media_fingerprint<>encode(digest(moderation_snapshot('media',media.id)::text,'sha256'),'hex')
          OR a.moderation_decision_id IS DISTINCT FROM mc.current_decision_id
          OR COALESCE(mc.state IN ('correction_requested','on_hold','pending_independent_review','rejected','removed'),FALSE)
          OR EXISTS(SELECT 1 FROM moderation_appeals ap JOIN moderation_decisions ad ON ad.id=ap.decision_id
            WHERE ad.case_id=mc.id AND ap.state='open')
          OR ob.state NOT IN ('pending','blocked')) AS stale
      FROM sponsor_media_preparation_assignments a
      JOIN sponsor_media_assets media ON media.id=a.asset_id AND media.contribution_id=a.contribution_id
      JOIN sponsorship_obligations ob ON ob.id=a.obligation_id AND ob.contribution_id=a.contribution_id
      JOIN sponsorship_commitments m ON m.id=ob.commitment_id JOIN fund_contributions c ON c.id=a.contribution_id
      LEFT JOIN moderation_cases mc ON mc.subject_type='media' AND mc.subject_id=media.id
      WHERE a.contribution_id=$1::uuid AND a.active ORDER BY a.obligation_id,a.created_at,a.id`,
      [contributionId]
    );
    return {
      preparationObligations: obligations.rows.map((row) =>
        preparationTargetSummary(target(row))
      ),
      preparationAssignments: assignments.rows
    };
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      ['42P01', '42703', '42501'].includes(String(error.code))
    )
      throw new MediaWorkspaceError('MEDIA_PREPARATION_SCHEMA_REQUIRED', 503);
    throw error;
  }
}
