import type {
  ModerationDecisionInput,
  ModerationSubject
} from '@openg7/funding-core';
import type { Pool, PoolClient } from 'pg';

import { ModerationError } from './moderation/policy.js';
import {
  assertModerationApproved,
  recordModerationDecision
} from './moderation/repository.js';
import { withPostgresTransaction } from './postgres-transaction.js';

/** Reuse the caller's transaction; a standalone legacy port owns one transaction. */
export const withModerationTransaction = <T>(
  db: Pool | PoolClient,
  operation: (client: PoolClient) => Promise<T>,
  shouldCommit?: (result: T) => boolean
): Promise<T> =>
  typeof (db as PoolClient).release === 'function'
    ? operation(db as PoolClient)
    : withPostgresTransaction(db as Pool, operation, { shouldCommit });

export async function auditModeratedMutation(
  db: Pick<PoolClient, 'query'>,
  subject: ModerationSubject,
  actor: string,
  action: string
): Promise<void> {
  if (!actor) throw new ModerationError('MODERATION_ACTOR_REQUIRED', 403);
  await db.query(
    `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata) VALUES($1,$2,$3,$4,'Reviewed content authorization changed.','{}'::jsonb)`,
    [actor, action, subject.type, subject.id]
  );
}

/** Editorial approval never replaces the caller's payment, consent or media checks. */
export async function approveModeratedSubject(
  db: Pick<PoolClient, 'query'>,
  subject: ModerationSubject,
  actor: string,
  decision?: ModerationDecisionInput
): Promise<void> {
  if (decision) {
    if (decision.level !== 'N0')
      throw new ModerationError('MODERATION_LEVEL_INVALID', 400);
    await recordModerationDecision(db, { subject, decision, actor });
  }
  await assertModerationApproved(db, subject);
}

/** A legacy adverse command must describe the reviewed content and its reason. */
export async function recordAdverseModeration(
  db: Pick<PoolClient, 'query'>,
  subject: ModerationSubject,
  actor: string,
  decision: ModerationDecisionInput | undefined,
  levels: readonly ModerationDecisionInput['level'][]
) {
  if (!decision) throw new ModerationError('MODERATION_DECISION_REQUIRED', 400);
  if (!levels.includes(decision.level))
    throw new ModerationError('MODERATION_LEVEL_INVALID', 400);
  return recordModerationDecision(db, { subject, decision, actor });
}
