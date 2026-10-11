import { createHash } from 'node:crypto';

import type {
  ModerationDecisionRecord,
  ModerationSubject
} from '@openg7/funding-core';

import type { ModerationDb } from './content.js';

export interface DecisionRow {
  id: string;
  case_id: string;
  subject_type: ModerationSubject['type'];
  subject_id: string;
  contribution_id: string | null;
  content_version: number;
  content_fingerprint: string;
  policy_version: string;
  level: ModerationDecisionRecord['level'];
  primary_reason: ModerationDecisionRecord['primaryReason'];
  secondary_reasons: ModerationDecisionRecord['secondaryReasons'];
  editorial_provision: string | null;
  internal_reason: string | null;
  sponsor_explanation: string | null;
  actor: string;
  created_at: Date;
  previous_decision_id: string | null;
  requires_independent_review: boolean;
  independent_reviewer: string | null;
  request_fingerprint: string;
}
export const decisionColumns = `d.*,r.reviewer AS independent_reviewer`;
export const stablePersonPattern =
  /^admin:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const mapModerationDecision = (
  row: DecisionRow
): ModerationDecisionRecord => ({
  id: row.id,
  subject: { type: row.subject_type, id: row.subject_id },
  contributionId: row.contribution_id,
  contentVersion: row.content_version,
  contentFingerprint: row.content_fingerprint,
  policyVersion: row.policy_version,
  level: row.level,
  primaryReason: row.primary_reason,
  secondaryReasons: row.secondary_reasons,
  editorialProvision: row.editorial_provision,
  internalReason: row.internal_reason,
  sponsorExplanation: row.sponsor_explanation,
  actor: row.actor,
  createdAt: row.created_at.toISOString(),
  previousDecisionId: row.previous_decision_id,
  state:
    row.requires_independent_review && !row.independent_reviewer
      ? 'pending_independent_review'
      : 'active',
  independentReviewer: row.independent_reviewer
});
export function moderationRequestFingerprint(value: unknown): string {
  const canonical = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(canonical)
      : input && typeof input === 'object'
        ? Object.fromEntries(
            Object.entries(input)
              .filter(([, v]) => v !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, v]) => [key, canonical(v)])
          )
        : input;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export async function audit(
  db: ModerationDb,
  decision: ModerationDecisionRecord,
  action: string,
  actor: string
): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata) VALUES($1,$2,'moderation_decision',$3,$2,$4::jsonb)`,
    [
      actor,
      action,
      decision.id,
      JSON.stringify({
        subjectType: decision.subject.type,
        subjectId: decision.subject.id,
        level: decision.level,
        reasonCode: decision.primaryReason,
        policyVersion: decision.policyVersion,
        contentVersion: decision.contentVersion,
        state: decision.state
      })
    ]
  );
}
