import { withPostgresTransaction } from '../postgres-transaction.js';
import { recordRemoteRemovalProviderResult } from '../moderation/governance.js';
import { assertPublicationObligations } from '../sponsorship-fulfilment.repository.js';

import {
  audit,
  type DeliveryRow,
  type PublicationDeliveryWorkerContext
} from './context.js';
import { assert } from './policy.js';
import { assertDeliveryModeration } from './moderation.js';
import { sourceIssues, type Db } from './sources.js';
import {
  canonicalAccountSql,
  claimAccountReservation,
  finishAccountClaim,
  markAccountDispatch,
  validAccountClaim
} from './account-reservations.js';

/** A claim's monotonically increasing delivery version fences every worker write. */
export const activeClaimSql = (version: '$2' | '$3' | '$4' | '$5') =>
  `status='publishing' AND version=${version} AND approved_at IS NOT NULL AND lease_until>clock_timestamp()
   AND EXISTS(SELECT 1 FROM publication_account_leases a WHERE a.delivery_id=publication_deliveries.id
     AND a.delivery_version=publication_deliveries.version AND a.lease_until>clock_timestamp() AND NOT a.uncertain)`;

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
  if (!current || !(await validAccountClaim(db, row)))
    throw new PublicationClaimLost();
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
    await finishAccountClaim(db, row, 'uncertain');
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
      `UPDATE publication_deliveries SET status='uncertain',error_code='LEASE_EXPIRED',version=version+1,updated_at=NOW() WHERE status='publishing' AND lease_until<$1 RETURNING *`,
      [now]
    );
    for (const r of stale.rows) {
      await finishAccountClaim(
        db,
        { ...r, version: r.version - 1 },
        'uncertain'
      );
      await audit(db, 'publication-worker', 'uncertain', r.id, {
        code: 'LEASE_EXPIRED'
      });
    }
  });
}

export async function claimNextDelivery(
  context: PublicationDeliveryWorkerContext,
  now: Date
): Promise<DeliveryRow | null> {
  return withPostgresTransaction(context.pool, async (db) => {
    // Serialize new claims with the global switch across server instances.
    if (!(await context.workerSettings(db, 'FOR SHARE')).enabled) return null;
    const skipped: string[] = [];
    for (let candidate = 0; candidate < 32; candidate++) {
      const r = (
        await db.query<DeliveryRow>(
          `SELECT d.* FROM publication_deliveries d JOIN publication_feeds f ON f.id=d.feed_id
         WHERE d.status='approved' AND f.paused=FALSE AND d.scheduled_at<=$1 AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=$1) AND NOT(d.id=ANY($2::uuid[]))
           AND NOT EXISTS(SELECT 1 FROM publication_account_leases a
             WHERE a.provider=split_part(d.feed_id,':',2) AND a.account_id=${canonicalAccountSql('d')} AND a.mode=d.mode
               AND (a.delivery_id IS NOT NULL OR a.uncertain OR a.next_dispatch_at>clock_timestamp()))
           AND NOT EXISTS(SELECT 1 FROM publication_deliveries other WHERE other.id<>d.id AND other.status IN ('publishing','uncertain')
             AND split_part(other.feed_id,':',2)=split_part(d.feed_id,':',2) AND other.mode=d.mode
             AND ${canonicalAccountSql('other')}=${canonicalAccountSql('d')})
         ORDER BY d.scheduled_at,d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`,
          [now, skipped]
        )
      ).rows[0];
      if (!r) return null;
      const accountFence = await claimAccountReservation(db, r, r.version + 1);
      if (accountFence === null) {
        skipped.push(r.id);
        continue;
      }
      const claimed = (
        await db.query<DeliveryRow>(
          `UPDATE publication_deliveries SET status='publishing',attempts=attempts+1,version=version+1,lease_until=clock_timestamp()+INTERVAL '5 minutes',updated_at=NOW() WHERE id=$1 RETURNING *`,
          [r.id]
        )
      ).rows[0];
      claimed.accountClaimVersion = accountFence;
      await audit(db, 'publication-worker', 'claim', r.id, {
        attempt: claimed.attempts,
        claimVersion: claimed.version
      });
      return claimed;
    }
    return null;
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
      await assertPublicationObligations(db, current);
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
    const withinWindow = (
      await db.query<{ within_window: boolean }>(
        "SELECT clock_timestamp()<=$1::timestamptz+INTERVAL '24 hours' AS within_window",
        [current.scheduled_at]
      )
    ).rows[0]?.within_window;
    assert(withinWindow === true, 'SCHEDULE_EXPIRED');
    if (!(await markAccountDispatch(db, row))) throw new PublicationClaimLost();
  });
}
