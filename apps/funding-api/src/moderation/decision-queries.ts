import {
  publicModerationDecision,
  type ModerationDecisionRecord,
  type ModerationSubject,
  type PublicModerationDecision
} from '../../../../packages/funding-core/src/index.js';

import type { ModerationDb } from './content.js';
import {
  decisionColumns,
  mapModerationDecision,
  type DecisionRow
} from './decision-records.js';
import { ModerationError } from './policy.js';

export async function getModerationDecision(
  db: ModerationDb,
  decisionId: string
): Promise<ModerationDecisionRecord | null> {
  const row = (
    await db.query<DecisionRow>(
      `SELECT ${decisionColumns} FROM moderation_decisions d LEFT JOIN moderation_independent_reviews r ON r.decision_id=d.id WHERE d.id=$1`,
      [decisionId]
    )
  ).rows[0];
  return row ? mapModerationDecision(row) : null;
}

export async function assertModerationApproved(
  db: ModerationDb,
  subject: ModerationSubject
): Promise<void> {
  // A worker owns its delivery lock. Never acquire sponsor/case write locks here:
  // sponsor restrictions acquire the sponsor before revoking delivery authorization.
  const row = (
    await db.query<{
      level: string;
      state: string;
      content_version: number;
      current_content_version: number;
      content_fingerprint: string;
      current_fingerprint: string | null;
      actual_fingerprint: string | null;
      editorial_status: string;
    }>(
      `SELECT d.level,c.state,d.content_version,c.current_content_version,d.content_fingerprint,c.current_fingerprint,p.editorial_status,
    encode(digest(moderation_snapshot($1,$2)::text,'sha256'),'hex') AS actual_fingerprint
    FROM moderation_cases c JOIN moderation_decisions d ON d.id=c.current_decision_id JOIN moderation_policies p ON p.version=d.policy_version WHERE c.subject_type=$1 AND c.subject_id=$2
    AND NOT EXISTS(SELECT 1 FROM moderation_appeals a JOIN moderation_decisions ad ON ad.id=a.decision_id WHERE ad.case_id=c.id AND a.state='open')`,
      [subject.type, subject.id]
    )
  ).rows[0];
  if (!row) throw new ModerationError('MODERATION_DECISION_REQUIRED');
  if (
    !row ||
    row.state !== 'approved' ||
    row.level !== 'N0' ||
    row.editorial_status !== 'approved'
  )
    throw new ModerationError('MODERATION_RESTRICTED');
  if (
    row.content_version !== row.current_content_version ||
    row.content_fingerprint !== row.current_fingerprint ||
    row.content_fingerprint !== row.actual_fingerprint
  )
    throw new ModerationError('MODERATION_DECISION_OBSOLETE');
}
export async function listPublicModerationDecisions(
  db: ModerationDb,
  contributionId: string
): Promise<readonly PublicModerationDecision[]> {
  // Do not select confidential columns in sponsor-facing queries.
  const rows = (
    await db.query<
      Omit<
        DecisionRow,
        | 'actor'
        | 'internal_reason'
        | 'editorial_provision'
        | 'request_fingerprint'
      >
    >(
      `SELECT d.id,d.case_id,d.subject_type,d.subject_id,d.contribution_id,d.content_version,d.content_fingerprint,d.policy_version,d.level,d.primary_reason,d.secondary_reasons,d.sponsor_explanation,d.created_at,d.previous_decision_id,d.requires_independent_review,r.reviewer AS independent_reviewer FROM moderation_decisions d LEFT JOIN moderation_independent_reviews r ON r.decision_id=d.id WHERE d.contribution_id=$1 ORDER BY d.created_at DESC,d.id DESC LIMIT 100`,
      [contributionId]
    )
  ).rows;
  return rows.map((row) =>
    publicModerationDecision(
      mapModerationDecision({
        ...row,
        actor: '',
        internal_reason: null,
        editorial_provision: null,
        request_fingerprint: ''
      })
    )
  );
}
