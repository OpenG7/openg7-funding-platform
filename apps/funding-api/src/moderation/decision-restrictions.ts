import type {
  ModerationDecisionRecord,
  ModerationSubject
} from '@openg7/funding-core';

import { moderationCaseState } from '../../../../packages/funding-core/src/index.js';

import type { ModerationDb } from './content.js';
import { recordRemoteRemovalRequirement } from './governance.js';

/** Restriction never erases financial facts, remote results or recognition obligations. */
export async function applyRestriction(
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
