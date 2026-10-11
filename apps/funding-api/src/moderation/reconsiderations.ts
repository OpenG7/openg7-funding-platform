import type {
  ModerationDecisionInput,
  ModerationSubject
} from '@openg7/funding-core';
import type { PoolClient } from 'pg';

import { validateModerationDecision } from '../../../../packages/funding-core/src/index.js';
import { insertAdminAuditLog } from '../fund-admin.repository.js';

import { getModerationContent, lockModerationDependencies } from './content.js';
import { ModerationError } from './policy.js';
import { recordModerationDecision } from './repository.js';

export async function listAdminModerationReconsiderations(
  db: PoolClient,
  subject: ModerationSubject | null
) {
  const result = await db.query(
    `SELECT a.id,a.decision_id AS "decisionId",a.contribution_id AS "contributionId",a.message,a.state,
       a.reviewer,a.resulting_decision_id AS "resultingDecisionId",a.created_at::text AS "createdAt",
       d.subject_type AS "subjectType",d.subject_id AS "subjectId"
     FROM moderation_appeals a JOIN moderation_decisions d ON d.id=a.decision_id
     ${subject ? 'WHERE d.subject_type=$1 AND d.subject_id=$2' : ''}
     ORDER BY a.created_at DESC,a.id LIMIT 200`,
    subject ? [subject.type, subject.id] : []
  );
  return { items: result.rows };
}

/** Resolving a request creates a new decision; financial facts are untouched. */
export async function resolveModerationReconsideration(
  db: PoolClient,
  input: {
    appealId: string;
    subject: ModerationSubject;
    decision: ModerationDecisionInput;
    actor: string;
  }
) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.appealId
    )
  )
    throw new ModerationError('INVALID_MODERATION_REQUEST', 400);
  const validation = validateModerationDecision(input.subject, input.decision);
  if (validation) throw new ModerationError(validation, 400);
  if (!input.decision.sponsorExplanation?.trim())
    throw new ModerationError('MODERATION_EXPLANATION_REQUIRED', 400);
  // Restrictive decisions take dependent delivery locks before the subject/case.
  if (input.decision.level !== 'N0')
    await lockModerationDependencies(db, input.subject);
  await getModerationContent(db, input.subject);
  const appeal = (
    await db.query<{
      id: string;
      decision_id: string;
      resulting_decision_id: string | null;
      state: string;
      subject_type: string;
      subject_id: string;
      current_decision_id: string;
    }>(
      `SELECT a.id,a.decision_id,a.resulting_decision_id,a.state,d.subject_type,d.subject_id,c.current_decision_id
     FROM moderation_appeals a JOIN moderation_decisions d ON d.id=a.decision_id JOIN moderation_cases c ON c.id=d.case_id
     WHERE a.id=$1 FOR UPDATE OF a`,
      [input.appealId]
    )
  ).rows[0];
  if (
    !appeal ||
    appeal.subject_type !== input.subject.type ||
    appeal.subject_id !== input.subject.id
  )
    throw new ModerationError('MODERATION_RECONSIDERATION_NOT_FOUND', 404);
  if (appeal.state !== 'open' && !appeal.resulting_decision_id)
    throw new ModerationError('MODERATION_RECONSIDERATION_UNAVAILABLE', 409);
  const decision = await recordModerationDecision(db, {
    ...input,
    resolvingAppealId: input.appealId
  });
  if (appeal.state === 'resolved') {
    if (appeal.resulting_decision_id !== decision.id)
      throw new ModerationError('MODERATION_REQUEST_CONFLICT', 409);
    return decision;
  }
  if (appeal.resulting_decision_id === decision.id) return decision;
  await db.query(
    `UPDATE moderation_appeals SET reviewer=$2,resulting_decision_id=$3,state=$4,updated_at=NOW() WHERE id=$1`,
    [
      input.appealId,
      input.actor,
      decision.id,
      decision.state === 'active' ? 'resolved' : 'open'
    ]
  );
  if (
    !(await insertAdminAuditLog(db, {
      actor: input.actor,
      action: 'moderation.reconsideration_reviewed',
      entityType: 'moderation_decision',
      entityId: decision.id,
      summary: 'Human reconsideration recorded.',
      metadata: {
        appealId: input.appealId,
        previousDecisionId: appeal.decision_id,
        state: decision.state
      }
    }))
  )
    throw new ModerationError('MODERATION_AUDIT_UNAVAILABLE', 503);
  return decision;
}
