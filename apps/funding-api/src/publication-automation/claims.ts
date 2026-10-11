import { withPostgresTransaction } from '../postgres-transaction.js';
import { recordRemoteRemovalProviderResult } from '../moderation/governance.js';

import {
  audit,
  type DeliveryRow,
  type PublicationDeliveryWorkerContext
} from './context.js';
import { assert } from './policy.js';
import { assertDeliveryModeration } from './moderation.js';
import { sourceIssues, type Db } from './sources.js';

/** A claim's monotonically increasing delivery version fences every worker write. */
export const activeClaimSql = (version: '$2' | '$3' | '$4' | '$5') =>
  `status='publishing' AND version=${version} AND approved_at IS NOT NULL AND lease_until>clock_timestamp()`;

export class PublicationClaimLost extends Error {
  constructor() {
    super('PUBLICATION_CLAIM_LOST');
  }
}

export async function lockClaim(
  db: Db,
  row: DeliveryRow
): Promise<DeliveryRow> {
  const current = (
    await db.query<DeliveryRow>(
      `SELECT * FROM publication_deliveries WHERE id=$1 AND ${activeClaimSql('$2')} FOR UPDATE`,
      [row.id, row.version]
    )
  ).rows[0];
  if (!current) throw new PublicationClaimLost();
  return current;
}

/** Preserve newer decisions; retain any observed external result for review. */
export async function abandonClaim(
  context: PublicationDeliveryWorkerContext,
  row: DeliveryRow,
  result: { externalPostId: string; externalPostUrl: string | null } | null
): Promise<void> {
  await withPostgresTransaction(context.pool, async (db) => {
    const expired = await db.query(
      `UPDATE publication_deliveries SET status='uncertain',error_code='LEASE_EXPIRED',lease_until=NULL,version=version+1,updated_at=NOW() WHERE id=$1 AND status='publishing' AND version=$2 RETURNING id`,
      [row.id, row.version]
    );
    if (expired.rowCount)
      await audit(db, 'publication-worker', 'uncertain', row.id, {
        code: 'LEASE_EXPIRED',
        claimVersion: row.version
      });
    if (result) {
      await audit(db, 'publication-worker', 'late_result', row.id, {
        claimVersion: row.version,
        mode: row.mode,
        feedId: row.feed_id,
        externalPostId: result.externalPostId,
        externalPostUrl: result.externalPostUrl
      });
      await recordRemoteRemovalProviderResult(db, {
        deliveryId: row.id,
        externalPostId: result.externalPostId
      });
    }
  });
}

export async function expireClaims(
  context: PublicationDeliveryWorkerContext,
  now: Date
): Promise<void> {
  await withPostgresTransaction(context.pool, async (db) => {
    const stale = await db.query(
      `UPDATE publication_deliveries SET status='uncertain',error_code='LEASE_EXPIRED',version=version+1,updated_at=NOW() WHERE status='publishing' AND lease_until<$1 RETURNING id`,
      [now]
    );
    for (const r of stale.rows)
      await audit(db, 'publication-worker', 'uncertain', r.id, {
        code: 'LEASE_EXPIRED'
      });
  });
}

export async function claimNextDelivery(
  context: PublicationDeliveryWorkerContext,
  now: Date
): Promise<DeliveryRow | null> {
  return withPostgresTransaction(context.pool, async (db) => {
    // Serialize new claims with the global switch across server instances.
    if (!(await context.workerSettings(db, 'FOR SHARE')).enabled) return null;
    const r = (
      await db.query<DeliveryRow>(
        `SELECT d.* FROM publication_deliveries d JOIN publication_feeds f ON f.id=d.feed_id WHERE d.status='approved' AND f.paused=FALSE AND d.scheduled_at<=$1 AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=$1) ORDER BY d.scheduled_at LIMIT 1 FOR UPDATE OF d SKIP LOCKED`,
        [now]
      )
    ).rows[0];
    if (!r) return null;
    const claimed = (
      await db.query<DeliveryRow>(
        `UPDATE publication_deliveries SET status='publishing',attempts=attempts+1,version=version+1,lease_until=clock_timestamp()+INTERVAL '5 minutes',updated_at=NOW() WHERE id=$1 RETURNING *`,
        [r.id]
      )
    ).rows[0];
    await audit(db, 'publication-worker', 'claim', r.id, {
      attempt: claimed.attempts,
      claimVersion: claimed.version
    });
    return claimed;
  });
}

export async function assertDispatchClaim(
  context: PublicationDeliveryWorkerContext,
  row: DeliveryRow
): Promise<void> {
  return withPostgresTransaction(context.pool, async (db) => {
    assert(
      (await context.workerSettings(db, 'FOR SHARE')).enabled,
      'WORKER_DISABLED'
    );
    const current = await lockClaim(db, row);
    assert(
      current.error_code !== 'MODERATION_RESTRICTED',
      'MODERATION_RESTRICTED'
    );
    const f = (
      await db.query(
        'SELECT paused FROM publication_feeds WHERE id=$1 FOR SHARE',
        [row.feed_id]
      )
    ).rows[0];
    assert(!f.paused, 'FEED_PAUSED');
    await assertDeliveryModeration(db, current);
    if (current.batch_id) {
      const issues = await sourceIssues(db, current.id);
      assert(
        issues.codes.length === 0,
        issues.codes[0] ?? 'SOURCE_NOT_ELIGIBLE'
      );
      const batch = (
        await db.query(
          'SELECT status,scheduled_at FROM sponsor_publication_batches WHERE id=$1',
          [current.batch_id]
        )
      ).rows[0];
      assert(
        batch?.status === 'scheduled' &&
          batch.scheduled_at?.getTime() === current.scheduled_at.getTime(),
        'SOURCE_CHANGED'
      );
    }
  });
}
