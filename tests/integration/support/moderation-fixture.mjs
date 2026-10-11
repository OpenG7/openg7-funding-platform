import { randomUUID } from 'node:crypto';
import { withPostgresTransaction } from '../../../dist/apps/funding-api/src/postgres-transaction.js';
import {
  getModerationContent,
  recordModerationDecision
} from '../../../dist/apps/funding-api/src/moderation/repository.js';

export const fixtureModerationActor =
  'admin:00000000-0000-4000-8000-000000000004';

/** Prepare a real, explicit decision for one synthetic subject in a disposable DB. */
export async function fixtureModerationDecision(
  pool,
  subject,
  level = 'N0',
  extra = {}
) {
  const content = await withPostgresTransaction(pool, (db) =>
    getModerationContent(db, subject)
  );
  return {
    requestId: randomUUID(),
    policyVersion: '1.0',
    contentVersion: content.contentVersion,
    contentFingerprint: content.fingerprint,
    expectedDecisionId: content.currentDecisionId,
    confirmation: subject.id,
    level,
    ...(level === 'N0'
      ? {}
      : {
          primaryReason: 'MISLEADING_CLAIM',
          internalReason: 'Synthetic evidence',
          sponsorExplanation: 'Please document the claim.'
        }),
    ...extra
  };
}

export async function approveFixtureSubject(
  pool,
  subject,
  actor = fixtureModerationActor
) {
  const decision = await fixtureModerationDecision(pool, subject);
  return withPostgresTransaction(pool, (db) =>
    recordModerationDecision(db, {
      subject,
      decision,
      actor
    })
  );
}
