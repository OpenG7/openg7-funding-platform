import type { PoolClient } from 'pg';
import type { PublicationFeedId } from '@openg7/funding-core';

// Acquire before business row locks in both planning and composition transactions.
// Preparation composes after its planning commit, so its feed row lock is insufficient.
export async function lockPublicationPlanningFeed(
  db: Pick<PoolClient, 'query'>,
  feedId: PublicationFeedId
): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    `publication-planning:${feedId}`
  ]);
}
