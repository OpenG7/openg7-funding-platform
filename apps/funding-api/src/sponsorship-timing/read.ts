import type { Pool, PoolClient } from 'pg';
import type { SponsorshipObligationTiming } from '@openg7/funding-core';

import { moderationApprovedSql } from '../moderation/policy.js';
import { confirmedMediaUsageSql } from '../sponsor-media/usage-policy.js';
import {
  SPONSOR_WEBSITE_ELIGIBLE_SQL,
  SPONSOR_WEBSITE_VISIBLE_SQL
} from '../sponsorship-website-eligibility.js';

type Db = Pick<Pool | PoolClient, 'query'>;

/** Known metadata/version restrictions only. A GET neither reads files nor attests exposure. */
function durationRestartRequiredSql(alias: string): string {
  const eligibleMedia = `exposure_media.contribution_id=${alias}.contribution_id AND exposure_media.deleted_at IS NULL
    AND exposure_media.review_status='approved' AND exposure_media.public_url IS NOT NULL
    AND ${confirmedMediaUsageSql('exposure_media', 'website', 'openg7')}
    AND ${moderationApprovedSql('media', 'exposure_media.id')}`;
  const firstMedia = (
    kind: string
  ) => `(SELECT exposure_media.id::text FROM sponsor_media_assets exposure_media WHERE ${eligibleMedia} AND exposure_media.kind='${kind}'
    ORDER BY exposure_media.sort_order,exposure_media.created_at,exposure_media.id LIMIT 1)`;
  const mediaSnapshot = `CASE WHEN jsonb_typeof(v.media_snapshot)='array' THEN v.media_snapshot ELSE '[]'::jsonb END`;
  return `(v.obligation_version IS DISTINCT FROM ${alias}.version OR
    EXISTS(SELECT 1 FROM fund_contributions WHERE id=${alias}.contribution_id AND (
      NOT ((${SPONSOR_WEBSITE_ELIGIBLE_SQL}) AND (${SPONSOR_WEBSITE_VISIBLE_SQL})) OR status<>'paid' OR sponsorship_refund_status<>'not_requested'
      OR updated_at IS DISTINCT FROM (v.source_snapshot->0->>'version')::timestamptz
      OR (v.source_snapshot->0->'approvals') IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('subjectType',mc.subject_type,'subjectId',mc.subject_id,'decisionId',mc.current_decision_id)
        ORDER BY mc.subject_type,mc.subject_id) FROM moderation_cases mc WHERE (mc.subject_type='sponsorship' AND mc.subject_id=fund_contributions.id)
          OR (mc.subject_type='media' AND mc.subject_id IN (SELECT id FROM sponsor_media_assets WHERE contribution_id=fund_contributions.id)))))
    OR ${firstMedia('supporting_image')} IS DISTINCT FROM (SELECT image->>'id' FROM jsonb_array_elements(${mediaSnapshot}) image WHERE image->>'kind'='supporting_image' LIMIT 1)
    OR ${firstMedia('logo')} IS DISTINCT FROM (SELECT image->>'id' FROM jsonb_array_elements(${mediaSnapshot}) image WHERE image->>'kind'='logo' LIMIT 1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(${mediaSnapshot}) image LEFT JOIN sponsor_media_assets exposure_media ON exposure_media.id::text=image->>'id'
      AND exposure_media.contribution_id=${alias}.contribution_id WHERE exposure_media.id IS NULL
      OR exposure_media.updated_at IS DISTINCT FROM (image->>'version')::timestamptz
      OR exposure_media.checksum_sha256 IS DISTINCT FROM image->>'sourceHash'
      OR exposure_media.usage_rights IS DISTINCT FROM image->'usage'
      OR exposure_media.usage_restrictions_reviewed IS DISTINCT FROM (image->>'restrictionsReviewed')::boolean))`;
}

/** Alias is API-owned. One projection serves direct dossier reads, lists and command receipts. */
export function sponsorshipObligationTimingProjectionSql(
  alias: string
): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias))
    throw new Error('Invalid sponsorship timing scope.');
  const iso = (expression: string) =>
    `to_char((${expression}) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  return `(SELECT jsonb_build_object('version',t.version,'deadlineDays',t.deadline_days,'durationDays',t.duration_days,
    'originAt',${iso('t.origin_at')},'originProvenance',t.origin_provenance,'dueAt',${iso('t.due_at')},
    'overdue',COALESCE(t.due_at<transaction_timestamp() AND ${alias}.state IN ('pending','blocked'),FALSE),
    'durationState',CASE WHEN t.duration_days IS NULL THEN 'not_required'
      WHEN EXISTS(SELECT 1 FROM sponsorship_obligation_duration_attestations a WHERE a.obligation_id=${alias}.id AND a.fulfilment_evidence_id=${alias}.fulfilment_evidence_id) THEN 'attested'
      WHEN ${alias}.channel<>'website' OR ${alias}.target<>'openg7' THEN 'unsupported'
      WHEN v.id IS NOT NULL AND ${durationRestartRequiredSql(alias)} THEN 'restart_required'
      WHEN v.id IS NOT NULL THEN 'awaiting_review' ELSE 'awaiting_observation' END,
    'startObservation',CASE WHEN t.duration_days IS NOT NULL AND v.id IS NOT NULL THEN jsonb_build_object('id',v.id,'observedAt',${iso('v.observed_at')},
      'earliestCompletionAt',${iso("v.observed_at+t.duration_days*INTERVAL '24 hours'")}) ELSE NULL END)
    FROM sponsorship_obligation_timing t LEFT JOIN LATERAL (SELECT id,observed_at,obligation_version,source_snapshot,media_snapshot FROM sponsorship_website_exposure_observations
      WHERE obligation_id=${alias}.id AND ${alias}.state IN ('pending','blocked')
      AND ${alias}.channel='website' AND ${alias}.target='openg7' ORDER BY observed_at DESC,id DESC LIMIT 1) v ON TRUE
    WHERE t.obligation_id=${alias}.id)`;
}

/** A deadline without a documented contractual anchor stays unknown; activation never supplies one. */
export async function initializeSponsorshipObligationTiming(
  db: Db,
  commitmentId: string
): Promise<void> {
  await db.query(
    `INSERT INTO sponsorship_obligation_timing(obligation_id,deadline_days,duration_days)
    SELECT ob.id,(b->>'deadlineDays')::integer,(b->>'durationDays')::integer
    FROM sponsorship_obligations ob JOIN sponsorship_commitments m ON m.id=ob.commitment_id
    JOIN sponsorship_offers o ON o.id=m.offer_id CROSS JOIN LATERAL jsonb_array_elements(o.snapshot->'benefits') b
    WHERE m.id=$1::uuid AND b->>'id'=ob.benefit_id
    ON CONFLICT(obligation_id) DO NOTHING`,
    [commitmentId]
  );
}

export async function loadSponsorshipObligationTimings(
  db: Db,
  obligationIds: readonly string[]
): Promise<ReadonlyMap<string, SponsorshipObligationTiming>> {
  if (!obligationIds.length) return new Map();
  const result = await db.query<{
    id: string;
    timing: SponsorshipObligationTiming | null;
  }>(
    `SELECT ob.id,${sponsorshipObligationTimingProjectionSql('ob')} AS timing
    FROM sponsorship_obligations ob WHERE ob.id=ANY($1::uuid[])`,
    [obligationIds]
  );
  return new Map(
    result.rows.flatMap((row) =>
      row.timing ? [[row.id, row.timing] as const] : []
    )
  );
}

/** Full counts, independent of the reliability page and filters. No recipient data or proof references. */
export async function loadSponsorshipTimingSummary(db: Db): Promise<{
  overdueCount: number;
  missingOriginCount: number;
  awaitingDurationCount: number;
}> {
  const result = await db.query<{
    overdueCount: number;
    missingOriginCount: number;
    awaitingDurationCount: number;
  }>(`SELECT
    count(*) FILTER (WHERE t.due_at < transaction_timestamp())::int AS "overdueCount",
    count(*) FILTER (WHERE t.deadline_days IS NOT NULL AND t.origin_at IS NULL)::int AS "missingOriginCount",
    count(*) FILTER (WHERE t.duration_days IS NOT NULL AND ob.channel='website' AND ob.target='openg7')::int AS "awaitingDurationCount"
    FROM sponsorship_obligations ob JOIN sponsorship_obligation_timing t ON t.obligation_id=ob.id
    WHERE ob.state IN ('pending','blocked')`);
  return (
    result.rows[0] ?? {
      overdueCount: 0,
      missingOriginCount: 0,
      awaitingDurationCount: 0
    }
  );
}
