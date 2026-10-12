import type { ModerationSubject } from '@openg7/funding-core';
import type { PoolClient } from 'pg';

const subjectFilter = (subject: ModerationSubject | null) => ({
  sql: subject ? ' WHERE subject_type=$1 AND subject_id=$2' : '',
  values: subject ? [subject.type, subject.id] : []
});

export async function listAdminModerationCases(
  db: PoolClient,
  subject: ModerationSubject | null
) {
  const filter = subjectFilter(subject);
  const result = await db.query(
    `SELECT id,subject_type AS "subjectType",subject_id AS "subjectId",contribution_id AS "contributionId",
      current_content_version AS "contentVersion",current_fingerprint AS "contentFingerprint",
      current_decision_id AS "currentDecisionId",state,assigned_to AS "assignedTo",updated_at::text AS "updatedAt"
      FROM moderation_cases${filter.sql} ORDER BY updated_at DESC,id LIMIT 200`,
    filter.values
  );
  return { items: result.rows };
}

export async function listAdminModerationDecisions(
  db: PoolClient,
  subject: ModerationSubject | null
) {
  const filter = subjectFilter(subject);
  const result = await db.query(
    `SELECT id,subject_type AS "subjectType",subject_id AS "subjectId",contribution_id AS "contributionId",
      content_version AS "contentVersion",content_fingerprint AS "contentFingerprint",policy_version AS "policyVersion",level,
      primary_reason AS "primaryReason",secondary_reasons AS "secondaryReasons",editorial_provision AS "editorialProvision",
      internal_reason AS "internalReason",sponsor_explanation AS "sponsorExplanation",actor,created_at::text AS "createdAt",
      previous_decision_id AS "previousDecisionId",CASE WHEN requires_independent_review AND NOT EXISTS
        (SELECT 1 FROM moderation_independent_reviews r WHERE r.decision_id=moderation_decisions.id)
        THEN 'pending_independent_review' ELSE 'active' END AS state
      FROM moderation_decisions${filter.sql} ORDER BY created_at DESC,id LIMIT 200`,
    filter.values
  );
  return { items: result.rows };
}

export async function listAdminModerationRemoteRemovals(db: PoolClient) {
  const result = await db.query(
    `SELECT id,decision_id AS "decisionId",delivery_id AS "deliveryId",feed_id AS "feedId",mode,status,
      created_at::text AS "createdAt",evidence_url AS "evidenceUrl",verified_at::text AS "verifiedAt"
     FROM moderation_remote_removals ORDER BY created_at DESC,id LIMIT 200`
  );
  return { items: result.rows };
}
