import {
  DEFAULT_SPONSORSHIP_PRICING_CONFIG,
  PUBLICATION_MESSAGE_MAX_CODE_UNITS,
  PUBLICATION_RECOGNITION_POLICY_VERSION,
  type PublicationRecognitionSource
} from '../../../../packages/funding-core/src/index.js';
import { moderationApprovedSql } from '../moderation/policy.js';

import { audit } from './context.js';
import { digest } from './policy.js';
import type { Db, Source } from './sources.js';

// Explicit routing wins. Otherwise use the existing promised CAD benefits.
export const eligibleDestination = (
  alias: string,
  target: string,
  channel: string
) =>
  `COALESCE(${alias}.sponsor_feed_target,'openg7')=${target} AND (
    ${alias}.sponsor_feed_channels ? ${channel} OR (
      ${alias}.sponsor_feed_channels='[]'::jsonb AND lower(${alias}.currency)='cad'
      AND ${alias}.amount_cents >= CASE WHEN ${channel}='facebook' THEN ${DEFAULT_SPONSORSHIP_PRICING_CONFIG.benefits.facebookBatch.minimumAmount * 100} ELSE ${DEFAULT_SPONSORSHIP_PRICING_CONFIG.benefits.linkedinBatch.minimumAmount * 100} END))`;

/** Bound work per preparation, independently of the number of recurrences. */
export const PREPARATION_SCAN_LIMIT = 400;

export interface PreparationSource extends Source {
  name: string | null;
  source_fingerprint_material: string;
}

export const recognitionSource = (
  source: Source & { name: string | null }
): PublicationRecognitionSource => ({
  id: source.id,
  contributionId: source.contribution_id,
  name: source.name ?? '',
  title: source.title,
  body: source.body,
  disclosureText: source.disclosure_text
});

/**
 * PostgreSQL supplies the exact UTF-8 hash material used by Node. JSON preserves
 * nulls, field boundaries and raw Unicode; any authoritative text correction
 * invalidates a prior negative result, even when its normalized rendering agrees.
 * Aliases are internal constants, never request input.
 */
export const preparationFingerprintSql = (draft = 'd', contribution = 'c') =>
  `jsonb_build_array('${PUBLICATION_RECOGNITION_POLICY_VERSION}',${PUBLICATION_MESSAGE_MAX_CODE_UNITS},${draft}.id::text,${draft}.contribution_id::text,${contribution}.sponsor_company_name,${draft}.title,${draft}.body,${draft}.disclosure_text,${draft}.feed_target,${draft}.channel)::text`;

export const preparationEligibilitySql = (
  draft = 'd',
  contribution = 'c',
  target = '$1',
  channel = '$2'
) =>
  `${draft}.feed_target=${target} AND ${draft}.channel=${channel}
   AND ${draft}.status IN ('draft','approved','scheduled')
   AND ${contribution}.status='paid' AND ${contribution}.public_display_consent IS TRUE
   AND ${contribution}.sponsor_review_status IN ('pending_review','approved')
   AND ${eligibleDestination(contribution, target, channel)}
   AND ${contribution}.sponsor_feed_status NOT IN ('hidden','published')`;

/** Private preparation accepts never-reviewed content, without granting N0. */
export const preparationModerationSubjectSql = (
  subjectType: 'sponsorship' | 'publication_draft' | 'publication_delivery',
  subjectId: string
) =>
  `(NOT EXISTS(SELECT 1 FROM moderation_cases preparation_review
      WHERE preparation_review.subject_type='${subjectType}'
        AND preparation_review.subject_id=${subjectId}
        AND preparation_review.current_decision_id IS NOT NULL)
    OR ${moderationApprovedSql(subjectType, subjectId)})`;

export const preparationModerationSql = (draft = 'd', contribution = 'c') =>
  `${preparationModerationSubjectSql('sponsorship', `${contribution}.id`)}
   AND ${preparationModerationSubjectSql('publication_draft', `${draft}.id`)}`;

export const currentBlockedSourceSql = (draft = 'd', contribution = 'c') =>
  `EXISTS (SELECT 1 FROM admin_audit_log diagnostic
    WHERE diagnostic.entity_type='sponsor_publication_draft'
      AND diagnostic.entity_id=${draft}.id::text
      AND diagnostic.action='publication_automation.source_render_blocked'
      AND diagnostic.metadata->>'reason' IN ('SOURCE_TEXT_TOO_LONG','SOURCE_CONTENT_MISSING')
      AND diagnostic.metadata->>'fingerprint'=encode(digest(${preparationFingerprintSql(draft, contribution)},'sha256'),'hex'))`;

/** Only new recruits share this scope; existing members keep their own guards. */
export const preparationCandidateSql = (
  draft = 'd',
  contribution = 'c',
  target = '$1',
  channel = '$2'
) =>
  `${draft}.batch_id IS NULL AND ${draft}.slot_id IS NULL
   AND ${draft}.status IN ('draft','approved')
   AND ${preparationEligibilitySql(draft, contribution, target, channel)}
   AND ${preparationModerationSql(draft, contribution)}
   AND NOT ${currentBlockedSourceSql(draft, contribution)}`;

export async function preparationCandidates(
  db: Db,
  target: string,
  channel: string,
  limit: number
): Promise<PreparationSource[]> {
  if (limit <= 0) return [];
  return (
    await db.query<PreparationSource>(
      `SELECT d.*,c.sponsor_company_name AS name,${preparationFingerprintSql()} AS source_fingerprint_material
       FROM sponsor_publication_drafts d JOIN fund_contributions c ON c.id=d.contribution_id
       WHERE ${preparationCandidateSql()}
       ORDER BY d.created_at,d.id LIMIT $3 FOR UPDATE OF d SKIP LOCKED`,
      [target, channel, limit]
    )
  ).rows;
}

/** Transactional, append-only diagnosis. Never records collective or date limits. */
export async function recordBlockedSource(
  db: Db,
  actor: string,
  source: PreparationSource,
  renderedLength: number,
  reason: 'SOURCE_TEXT_TOO_LONG' | 'SOURCE_CONTENT_MISSING'
): Promise<void> {
  await audit(
    db,
    actor,
    'source_render_blocked',
    source.id,
    {
      fingerprint: digest(source.source_fingerprint_material),
      policyVersion: PUBLICATION_RECOGNITION_POLICY_VERSION,
      budget: PUBLICATION_MESSAGE_MAX_CODE_UNITS,
      renderedLength,
      reason
    },
    'sponsor_publication_draft'
  );
}
