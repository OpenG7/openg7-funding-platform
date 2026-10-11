import type { ModerationDecisionRecord } from '@openg7/funding-core';

import type { ModerationDb } from './content.js';

/** Aggregates contain neither content, actor, recipient nor a small-case breakdown. */
export async function moderationMetrics(db: ModerationDb) {
  const row = (
    await db.query<{
      open_cases: number;
      pending_independent_reviews: number;
      open_reconsiderations: number;
      oldest_open_at: Date | null;
      oldest_open_age_seconds: number | null;
      corrections_received: number;
      reconsiderations_resolved: number;
      reconsiderations_overturned: number;
      average_review_seconds: number | null;
      average_reconsideration_seconds: number | null;
      removals_not_supported: number;
      removals_requested: number;
      removals_confirmed: number;
      removals_uncertain: number;
    }>(
      `SELECT COUNT(*) FILTER(WHERE state IN ('unreviewed','correction_requested','on_hold','pending_independent_review'))::int AS open_cases,
      COUNT(*) FILTER(WHERE state='pending_independent_review')::int AS pending_independent_reviews,
      (SELECT COUNT(*)::int FROM moderation_appeals WHERE state='open') AS open_reconsiderations,
      MIN(created_at) FILTER(WHERE state IN ('unreviewed','correction_requested','on_hold','pending_independent_review')) AS oldest_open_at,
      EXTRACT(EPOCH FROM (NOW()-MIN(created_at) FILTER(WHERE state IN ('unreviewed','correction_requested','on_hold','pending_independent_review'))))::double precision AS oldest_open_age_seconds,
      (SELECT COUNT(*)::int FROM moderation_corrections) AS corrections_received,
      (SELECT COUNT(*)::int FROM moderation_appeals WHERE state='resolved') AS reconsiderations_resolved,
      (SELECT COUNT(*)::int FROM moderation_appeals a JOIN moderation_decisions d ON d.id=a.resulting_decision_id WHERE a.state='resolved' AND d.level='N0') AS reconsiderations_overturned,
      (SELECT AVG(GREATEST(0,EXTRACT(EPOCH FROM (d.created_at-v.created_at))))::double precision FROM moderation_decisions d JOIN moderation_content_versions v ON (v.subject_type,v.subject_id,v.content_version)=(d.subject_type,d.subject_id,d.content_version)) AS average_review_seconds,
      (SELECT AVG(GREATEST(0,EXTRACT(EPOCH FROM (updated_at-created_at))))::double precision FROM moderation_appeals WHERE state='resolved') AS average_reconsideration_seconds,
      (SELECT COUNT(*)::int FROM moderation_remote_removals WHERE status='not_supported') AS removals_not_supported,
      (SELECT COUNT(*)::int FROM moderation_remote_removals WHERE status='requested') AS removals_requested,
      (SELECT COUNT(*)::int FROM moderation_remote_removals WHERE status='confirmed') AS removals_confirmed,
      (SELECT COUNT(*)::int FROM moderation_remote_removals WHERE status='uncertain') AS removals_uncertain
      FROM moderation_cases`
    )
  ).rows[0]!;
  return {
    openCases: row.open_cases,
    pendingIndependentReviews: row.pending_independent_reviews,
    openReconsiderations: row.open_reconsiderations,
    oldestOpenAt: row.oldest_open_at?.toISOString() ?? null,
    oldestOpenAgeSeconds: row.oldest_open_age_seconds,
    correctionsReceived: row.corrections_received,
    reconsiderationsResolved: row.reconsiderations_resolved,
    reconsiderationsOverturned: row.reconsiderations_overturned,
    averageReviewSeconds: row.average_review_seconds,
    averageReconsiderationSeconds: row.average_reconsideration_seconds,
    remoteRemovals: {
      notSupported: row.removals_not_supported,
      requested: row.removals_requested,
      confirmed: row.removals_confirmed,
      uncertain: row.removals_uncertain
    },
    serviceTargets: 'internal_proposed'
  };
}
/** Read-only adoption inventory: no fabricated editorial decisions or acceptances. */
export async function moderationAdoptionPreview(db: ModerationDb) {
  const sponsors = (
    await db.query<{
      historical_approved: number;
      historical_rejected: number;
      pending_review: number;
    }>(
      `SELECT COUNT(*) FILTER(WHERE c.sponsor_review_status='approved')::int AS historical_approved,
      COUNT(*) FILTER(WHERE c.sponsor_review_status='rejected')::int AS historical_rejected,
      COUNT(*) FILTER(WHERE COALESCE(c.sponsor_review_status,'pending_review')='pending_review')::int AS pending_review
      FROM fund_contributions c WHERE c.contribution_type='sponsorship_interest' AND NOT EXISTS
      (SELECT 1 FROM moderation_decisions d WHERE d.subject_type='sponsorship' AND d.subject_id=c.id)`
    )
  ).rows[0]!;
  const deliveries = (
    await db.query<{
      awaiting_review: number;
      published_unversioned: number;
      uncertain: number;
    }>(
      `SELECT COUNT(*) FILTER(WHERE p.status IN ('draft','approved','blocked'))::int AS awaiting_review,
      COUNT(*) FILTER(WHERE p.status='published')::int AS published_unversioned,
      COUNT(*) FILTER(WHERE p.status='uncertain')::int AS uncertain FROM publication_deliveries p WHERE NOT EXISTS
      (SELECT 1 FROM moderation_decisions d WHERE d.subject_type='publication_delivery' AND d.subject_id=p.id)`
    )
  ).rows[0]!;
  const legacyEmails = (
    await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM email_messages WHERE template_key='sponsorship_rejection' AND status IN ('queued','failed','sending','uncertain')`
    )
  ).rows[0]!;
  return {
    sponsors,
    deliveries,
    legacyRejectionNotificationsToReview: legacyEmails.count,
    action: 'explicit_human_review_required',
    readOnly: true
  };
}
/** A local restriction never proves removal of a provider's own copy. */
export async function recordRemoteRemovalRequirement(
  db: ModerationDb,
  decision: ModerationDecisionRecord
): Promise<void> {
  if (decision.level !== 'N5' || decision.state !== 'active') return;
  const scope =
    decision.subject.type === 'publication_delivery'
      ? 'p.id=$1'
      : decision.subject.type === 'media'
        ? 'p.media_id=$1'
        : decision.subject.type === 'publication_draft'
          ? 'p.batch_id IN(SELECT batch_id FROM sponsor_publication_drafts WHERE id=$1)'
          : 'p.batch_id IN(SELECT batch_id FROM sponsor_publication_drafts WHERE contribution_id=$1)';
  await db.query(
    `INSERT INTO moderation_remote_removals(decision_id,delivery_id,feed_id,external_post_id,mode,status)
    SELECT $2,p.id,p.feed_id,p.external_post_id,p.mode,'not_supported' FROM publication_deliveries p
    WHERE ${scope} AND (p.external_post_id IS NOT NULL OR p.status IN ('publishing','uncertain')) ON CONFLICT(decision_id,delivery_id) DO NOTHING`,
    [decision.subject.id, decision.id]
  );
}

/** Attach a provider acknowledgement without claiming a remote removal was verified. */
export async function recordRemoteRemovalProviderResult(
  db: ModerationDb,
  input: { deliveryId: string; externalPostId: string }
): Promise<void> {
  await db.query(
    `UPDATE moderation_remote_removals SET external_post_id=$2 WHERE delivery_id=$1 AND external_post_id IS NULL`,
    [input.deliveryId, input.externalPostId]
  );
}
export async function moderationRetentionPreview(db: ModerationDb) {
  const row = (
    await db.query<{
      versions: number;
      decisions: number;
      oldest_evidence_at: Date | null;
      holds: number;
    }>(
      `SELECT (SELECT COUNT(*)::int FROM moderation_content_versions) AS versions,
      COUNT(*)::int AS decisions,MIN(created_at) AS oldest_evidence_at,
      (SELECT COUNT(*)::int FROM moderation_retention_holds WHERE released_at IS NULL) AS holds FROM moderation_decisions`
    )
  ).rows[0]!;
  return {
    versions: row.versions,
    decisions: row.decisions,
    oldestEvidenceAt: row.oldest_evidence_at?.toISOString() ?? null,
    activeHolds: row.holds,
    purgeAvailable: false,
    reason: 'RETENTION_POLICY_VALIDATION_REQUIRED'
  };
}
