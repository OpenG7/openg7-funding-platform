import type { ModerationAssignmentRequest } from '@openg7/funding-core';

import { isModerationSubject } from '../../../../packages/funding-core/src/index.js';

import { getModerationContent, type ModerationDb } from './content.js';
import { ModerationError } from './policy.js';

const stablePerson =
  /^admin:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Caller verifies owner permissions and owns the transaction. Assignment grants no approval. */
export async function assignModerationCase(
  db: ModerationDb,
  input: ModerationAssignmentRequest,
  actor: string
) {
  if (!isModerationSubject(input.subject))
    throw new ModerationError('INVALID_MODERATION_SUBJECT', 400);
  if (input.confirmation !== input.subject.id)
    throw new ModerationError('CONFIRMATION_REQUIRED', 400);
  if (
    [input.assignedTo, input.expectedAssignedTo].some(
      (value) =>
        value !== null &&
        (typeof value !== 'string' || !stablePerson.test(value))
    )
  )
    throw new ModerationError('INVALID_MODERATION_ASSIGNEE', 400);
  const assignedTo = input.assignedTo?.toLowerCase() ?? null;
  const expectedAssignedTo = input.expectedAssignedTo?.toLowerCase() ?? null;
  if (
    assignedTo &&
    !(
      await db.query(
        `SELECT id FROM admin_accounts WHERE id=$1 AND disabled=FALSE AND role IN ('operator','owner') FOR SHARE`,
        [assignedTo.slice(6)]
      )
    ).rows.length
  )
    throw new ModerationError('MODERATION_ASSIGNEE_UNAVAILABLE', 403);
  await getModerationContent(db, input.subject);
  const current = (
    await db.query<{ id: string; assigned_to: string | null }>(
      `SELECT id,assigned_to FROM moderation_cases WHERE subject_type=$1 AND subject_id=$2 FOR UPDATE`,
      [input.subject.type, input.subject.id]
    )
  ).rows[0]!;
  if (current.assigned_to === assignedTo) return { assignedTo };
  if (current.assigned_to !== expectedAssignedTo)
    throw new ModerationError('MODERATION_ASSIGNMENT_CONFLICT', 409);
  await db.query(
    `UPDATE moderation_cases SET assigned_to=$2,updated_at=NOW() WHERE id=$1`,
    [current.id, assignedTo]
  );
  await db.query(
    `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata) VALUES($1,'moderation.assigned','moderation_case',$2,'Moderation assignment changed.',$3::jsonb)`,
    [
      actor,
      current.id,
      JSON.stringify({
        subjectType: input.subject.type,
        subjectId: input.subject.id,
        assignedTo,
        previousAssignedTo: current.assigned_to
      })
    ]
  );
  return { assignedTo };
}
