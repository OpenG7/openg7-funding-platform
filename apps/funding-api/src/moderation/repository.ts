import { createHash } from 'node:crypto';

import {
  moderationCaseState,
  publicModerationDecision,
  requiresIndependentModerationReview,
  validateModerationDecision,
  type ModerationDecisionInput,
  type ModerationDecisionRecord,
  type ModerationSubject,
  type PublicModerationDecision
} from '../../../../packages/funding-core/src/index.js';

import {
  getModerationContent,
  lockModerationDependencies,
  type ModerationDb
} from './content.js';
import { ModerationError } from './policy.js';
import { enqueueModerationNotification } from './notifications.js';
import { recordRemoteRemovalRequirement } from './governance.js';
export { getModerationContent } from './content.js';
export { lockModerationDependencies } from './content.js';

interface DecisionRow {
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
const decisionColumns = `d.*,r.reviewer AS independent_reviewer`;
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const stablePersonPattern =
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
async function audit(
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
/** Restriction never erases financial facts, remote results or recognition obligations. */
async function applyRestriction(
  db: ModerationDb,
  decision: ModerationDecisionRecord
): Promise<void> {
  const pending = decision.state === 'pending_independent_review';
  await db.query(
    `UPDATE moderation_cases SET current_decision_id=$1,state=$2,updated_at=NOW() WHERE subject_type=$3 AND subject_id=$4 AND current_content_version=$5 AND current_fingerprint=$6`,
    [
      decision.id,
      moderationCaseState(decision.level, pending),
      decision.subject.type,
      decision.subject.id,
      decision.contentVersion,
      decision.contentFingerprint
    ]
  );
  if (decision.level === 'N0') return;
  const subject = decision.subject;
  if (subject.type === 'sponsorship') {
    // Preserve pending/final distinctions; no refund or remote delete is implied.
    await db.query(
      `UPDATE fund_contributions SET sponsor_site_visibility_held=TRUE,
      sponsor_review_status=CASE WHEN $2 THEN 'rejected' ELSE sponsor_review_status END,updated_at=NOW() WHERE id=$1`,
      [subject.id, !pending && decision.level === 'N4']
    );
  } else if (
    subject.type === 'media' &&
    !pending &&
    ['N3', 'N5'].includes(decision.level)
  ) {
    await db.query(
      `UPDATE sponsor_media_assets SET review_status='rejected',public_url=NULL,reviewed_at=NOW(),reviewed_by=$2,updated_at=NOW() WHERE id=$1`,
      [subject.id, decision.actor]
    );
  } else if (
    subject.type === 'publication_draft' &&
    !pending &&
    ['N3', 'N5'].includes(decision.level)
  ) {
    // Revoke final authorization before the guarded legacy draft update.
    await revokeDependencies(db, subject);
    await db.query(
      `UPDATE sponsor_publication_drafts SET status='rejected',updated_at=NOW() WHERE id=$1`,
      [subject.id]
    );
  }
  await revokeDependencies(db, subject);
  await recordRemoteRemovalRequirement(db, decision);
}
async function revokeDependencies(
  db: ModerationDb,
  subject: ModerationSubject
): Promise<void> {
  const scope =
    subject.type === 'publication_delivery'
      ? 'p.id=$1'
      : subject.type === 'media'
        ? 'p.media_id=$1'
        : subject.type === 'publication_draft'
          ? 'p.batch_id IN (SELECT batch_id FROM sponsor_publication_drafts WHERE id=$1)'
          : 'p.batch_id IN (SELECT batch_id FROM sponsor_publication_drafts WHERE contribution_id=$1)';
  await db.query(
    `UPDATE publication_deliveries p SET status='blocked',approved_at=NULL,approved_by=NULL,error_code='MODERATION_RESTRICTED',auto_managed=FALSE,version=version+1,updated_at=NOW() WHERE ${scope} AND p.status IN ('draft','approved','blocked')`,
    [subject.id]
  );
  // A submitted call cannot be recalled. Keep its result and require incident review.
  await db.query(
    `UPDATE publication_deliveries p SET error_code='MODERATION_RESTRICTED',updated_at=NOW() WHERE ${scope} AND p.status IN ('publishing','uncertain','published')`,
    [subject.id]
  );
}
export async function recordModerationDecision(
  db: ModerationDb,
  input: {
    subject: ModerationSubject;
    decision: ModerationDecisionInput;
    actor: string;
    resolvingAppealId?: string;
  }
): Promise<ModerationDecisionRecord> {
  const error = validateModerationDecision(input.subject, input.decision);
  if (error) throw new ModerationError(error, 400);
  if (
    typeof input.actor !== 'string' ||
    input.actor.length < 1 ||
    input.actor.length > 200
  )
    throw new ModerationError('MODERATION_ACTOR_REQUIRED', 403);
  // Existing writes already hold the subject. Preserve their lock order and use
  // the subject/case locks plus the unique request constraint for idempotence.
  if (input.decision.level !== 'N0')
    await lockModerationDependencies(db, input.subject);
  const content = await getModerationContent(db, input.subject);
  const requestFingerprint = moderationRequestFingerprint(input);
  const prior = (
    await db.query<DecisionRow>(
      `SELECT ${decisionColumns} FROM moderation_decisions d LEFT JOIN moderation_independent_reviews r ON r.decision_id=d.id WHERE d.request_id=$1`,
      [input.decision.requestId]
    )
  ).rows[0];
  if (prior) {
    if (prior.request_fingerprint !== requestFingerprint)
      throw new ModerationError('MODERATION_REQUEST_CONFLICT');
    return mapModerationDecision(prior);
  }
  if (
    content.fingerprint !== input.decision.contentFingerprint ||
    content.contentVersion !== input.decision.contentVersion
  )
    throw new ModerationError('MODERATION_CONTENT_CHANGED');
  if (content.currentDecisionId !== (input.decision.expectedDecisionId ?? null))
    throw new ModerationError('MODERATION_DECISION_CONFLICT');
  const openAppeals = (
    await db.query<{ id: string }>(
      `SELECT a.id FROM moderation_appeals a JOIN moderation_decisions d ON d.id=a.decision_id WHERE d.subject_type=$1 AND d.subject_id=$2 AND a.state='open' ORDER BY a.id FOR UPDATE OF a`,
      [input.subject.type, input.subject.id]
    )
  ).rows;
  if (
    input.decision.level === 'N0' &&
    openAppeals.length &&
    (openAppeals.length !== 1 || openAppeals[0]!.id !== input.resolvingAppealId)
  )
    throw new ModerationError('MODERATION_RECONSIDERATION_OPEN');
  if (
    input.resolvingAppealId &&
    !openAppeals.some((appeal) => appeal.id === input.resolvingAppealId)
  )
    throw new ModerationError('MODERATION_RECONSIDERATION_UNAVAILABLE');
  if (['N0', 'N1'].includes(input.decision.level)) {
    // An intermediate hold or a content edit cannot erase a grave decision's
    // independent-review requirement when its author later attenuates it.
    const grave = (
      await db.query<{ actor: string }>(
        `SELECT actor FROM moderation_decisions WHERE subject_type=$1 AND subject_id=$2 AND requires_independent_review ORDER BY content_version DESC,created_at DESC,id DESC LIMIT 1`,
        [input.subject.type, input.subject.id]
      )
    ).rows[0];
    if (
      grave &&
      (!stablePersonPattern.test(input.actor) ||
        !stablePersonPattern.test(grave.actor) ||
        input.actor.toLowerCase() === grave.actor.toLowerCase())
    )
      throw new ModerationError('MODERATION_INDEPENDENT_REVIEW_REQUIRED', 403);
  }
  const policy = (
    await db.query(
      `SELECT version FROM moderation_policies WHERE version=$1 AND editorial_status='approved' FOR SHARE`,
      [input.decision.policyVersion]
    )
  ).rows[0];
  if (!policy) throw new ModerationError('MODERATION_POLICY_UNAVAILABLE');
  const pending = requiresIndependentModerationReview(input.decision);
  const inserted = (
    await db.query<DecisionRow>(
      `INSERT INTO moderation_decisions(case_id,request_id,request_fingerprint,subject_type,subject_id,contribution_id,content_version,content_fingerprint,policy_version,level,primary_reason,secondary_reasons,editorial_provision,internal_reason,sponsor_explanation,actor,requires_independent_review,previous_decision_id)
    SELECT id,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,current_decision_id FROM moderation_cases WHERE subject_type=$3 AND subject_id=$4 ON CONFLICT(request_id) DO NOTHING RETURNING *,NULL::text AS independent_reviewer`,
      [
        input.decision.requestId,
        requestFingerprint,
        input.subject.type,
        input.subject.id,
        content.contributionId,
        content.contentVersion,
        content.fingerprint,
        input.decision.policyVersion,
        input.decision.level,
        input.decision.primaryReason ?? null,
        input.decision.secondaryReasons ?? [],
        input.decision.editorialProvision ?? null,
        input.decision.internalReason?.trim() || null,
        input.decision.sponsorExplanation?.trim() || null,
        input.actor,
        pending
      ]
    )
  ).rows[0];
  if (!inserted) {
    const existing = (
      await db.query<DecisionRow>(
        `SELECT ${decisionColumns} FROM moderation_decisions d LEFT JOIN moderation_independent_reviews r ON r.decision_id=d.id WHERE d.request_id=$1`,
        [input.decision.requestId]
      )
    ).rows[0];
    if (!existing || existing.request_fingerprint !== requestFingerprint)
      throw new ModerationError('MODERATION_REQUEST_CONFLICT');
    return mapModerationDecision(existing);
  }
  const decision = mapModerationDecision(inserted);
  await applyRestriction(db, decision);
  await audit(db, decision, 'moderation.decision', input.actor);
  if (!pending && decision.level !== 'N0')
    await enqueueModerationNotification(db, decision);
  return decision;
}
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
/** Caller has verified operator/owner rights. Distinct stable people are required. */
export async function confirmModerationDecision(
  db: ModerationDb,
  input: {
    decisionId: string;
    actor: string;
    requestId: string;
    confirmation: string;
  }
): Promise<ModerationDecisionRecord> {
  if (
    input.confirmation !== input.decisionId ||
    !uuidPattern.test(input.decisionId) ||
    !uuidPattern.test(input.requestId)
  )
    throw new ModerationError('CONFIRMATION_REQUIRED', 400);
  const decision = await getModerationDecision(db, input.decisionId);
  if (!decision)
    throw new ModerationError('MODERATION_DECISION_NOT_FOUND', 404);
  if (
    !stablePersonPattern.test(input.actor) ||
    !stablePersonPattern.test(decision.actor)
  )
    throw new ModerationError('MODERATION_INDEPENDENT_IDENTITY_REQUIRED', 403);
  if (decision.actor.toLowerCase() === input.actor.toLowerCase())
    throw new ModerationError('MODERATION_INDEPENDENT_REVIEW_REQUIRED', 403);
  const priorConfirmation =
    async (): Promise<ModerationDecisionRecord | null> => {
      const rows = (
        await db.query<{
          decision_id: string;
          reviewer: string;
          request_id: string;
        }>(
          `SELECT decision_id,reviewer,request_id FROM moderation_independent_reviews WHERE decision_id=$1 OR request_id=$2`,
          [decision.id, input.requestId]
        )
      ).rows;
      if (!rows.length) return null;
      if (
        rows.length !== 1 ||
        rows[0]!.decision_id !== decision.id ||
        rows[0]!.reviewer !== input.actor ||
        rows[0]!.request_id !== input.requestId
      )
        throw new ModerationError('MODERATION_REQUEST_CONFLICT');
      return {
        ...decision,
        state: 'active',
        independentReviewer: rows[0]!.reviewer
      };
    };
  // A replay reports the immutable historical result and never reapplies it to
  // a later content version or restores a superseded case restriction.
  const replay = await priorConfirmation();
  if (replay) return replay;
  await lockModerationDependencies(db, decision.subject);
  const content = await getModerationContent(db, decision.subject);
  const concurrentReplay = await priorConfirmation();
  if (concurrentReplay) return concurrentReplay;
  if (
    content.currentDecisionId !== decision.id ||
    content.contentVersion !== decision.contentVersion ||
    content.fingerprint !== decision.contentFingerprint
  )
    throw new ModerationError('MODERATION_DECISION_OBSOLETE');
  if (decision.state !== 'pending_independent_review')
    throw new ModerationError('MODERATION_SECOND_REVIEW_UNAVAILABLE');
  if (
    !(
      await db.query(
        `SELECT version FROM moderation_policies WHERE version=$1 AND editorial_status='approved' FOR SHARE`,
        [decision.policyVersion]
      )
    ).rows[0]
  )
    throw new ModerationError('MODERATION_POLICY_UNAVAILABLE');
  const inserted = await db.query(
    `INSERT INTO moderation_independent_reviews(decision_id,reviewer,request_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING decision_id`,
    [decision.id, input.actor, input.requestId]
  );
  if (!inserted.rows[0]) {
    const concurrent = await priorConfirmation();
    if (concurrent) return concurrent;
    throw new ModerationError('MODERATION_REQUEST_CONFLICT');
  }
  const confirmed: ModerationDecisionRecord = {
    ...decision,
    state: 'active',
    independentReviewer: input.actor
  };
  await applyRestriction(db, confirmed);
  await db.query(
    `UPDATE moderation_appeals SET state='resolved',reviewer=$2,updated_at=NOW() WHERE resulting_decision_id=$1 AND state='open'`,
    [decision.id, input.actor]
  );
  await audit(db, confirmed, 'moderation.independent_review', input.actor);
  await enqueueModerationNotification(db, confirmed);
  return confirmed;
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
