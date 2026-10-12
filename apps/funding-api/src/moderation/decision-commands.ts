import {
  requiresIndependentModerationReview,
  validateModerationDecision,
  type ModerationDecisionInput,
  type ModerationDecisionRecord,
  type ModerationSubject
} from '../../../../packages/funding-core/src/index.js';

import {
  getModerationContent,
  lockModerationDependencies,
  type ModerationDb
} from './content.js';
import {
  audit,
  decisionColumns,
  mapModerationDecision,
  moderationRequestFingerprint,
  stablePersonPattern,
  type DecisionRow
} from './decision-records.js';
import { applyRestriction } from './decision-restrictions.js';
import { enqueueModerationNotification } from './notifications.js';
import { ModerationError } from './policy.js';

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
