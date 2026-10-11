import type { ModerationDecisionRecord } from '@openg7/funding-core';

import {
  getModerationContent,
  lockModerationDependencies,
  type ModerationDb
} from './content.js';
import { getModerationDecision } from './decision-queries.js';
import { audit, stablePersonPattern } from './decision-records.js';
import { applyRestriction } from './decision-restrictions.js';
import { enqueueModerationNotification } from './notifications.js';
import { ModerationError } from './policy.js';

const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

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
