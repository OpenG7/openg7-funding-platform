import { withPostgresTransaction } from '../postgres-transaction.js';
import type { SocialPublicationProviderResult } from '../social-publication.service.js';

import {
  abandonClaim,
  activeClaimSql,
  PublicationClaimLost
} from './claims.js';
import {
  audit,
  type DeliveryRow,
  type PublicationDeliveryWorkerContext
} from './context.js';
import { PublicationAutomationError } from './policy.js';
import { DeliveryFailure, safeCode } from './provider.js';
import type { Db } from './sources.js';

export async function complete(
  db: Db,
  row: DeliveryRow,
  postId: string,
  url: string | null,
  actor: string,
  claimVersion?: number
): Promise<void> {
  const result = await db.query(
    `UPDATE publication_deliveries SET status='published',external_post_id=$2,external_post_url=$3,published_at=NOW(),lease_until=NULL,error_code=NULL,version=version+1,updated_at=NOW() WHERE id=$1${claimVersion === undefined ? '' : ` AND ${activeClaimSql('$4')}`} RETURNING id`,
    claimVersion === undefined
      ? [row.id, postId, url]
      : [row.id, postId, url, claimVersion]
  );
  if (!result.rowCount) throw new PublicationClaimLost();
  if (row.batch_id && row.mode === 'live') {
    await db.query(
      `UPDATE sponsor_publication_batches SET status='published',published_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [row.batch_id]
    );
    await db.query(
      `UPDATE sponsor_publication_drafts SET status='published',public_url=$2,published_at=NOW(),updated_at=NOW() WHERE id=ANY($1::uuid[])`,
      [row.source_snapshot.map((s) => s.id), url]
    );
    await db.query(
      `UPDATE publication_slots SET status='published',updated_at=NOW() WHERE id=(SELECT slot_id FROM sponsor_publication_batches WHERE id=$1) AND NOT EXISTS(SELECT 1 FROM sponsor_publication_batches b WHERE b.slot_id=publication_slots.id AND b.status NOT IN ('published','cancelled')) AND NOT EXISTS(SELECT 1 FROM sponsor_publication_drafts d WHERE d.slot_id=publication_slots.id AND d.status<>'published')`,
      [row.batch_id]
    );
  }
  await audit(db, actor, 'published', row.id, {
    mode: row.mode,
    feedId: row.feed_id,
    externalPostId: postId
  });
}

export async function handleDeliveryFailure(
  context: PublicationDeliveryWorkerContext,
  row: DeliveryRow,
  error: unknown,
  sending: boolean,
  result: SocialPublicationProviderResult | null
): Promise<'continue' | 'stop'> {
  if (error instanceof PublicationClaimLost) {
    await abandonClaim(context, row, result);
    return 'continue';
  }
  if (
    error instanceof PublicationAutomationError &&
    error.code === 'WORKER_DISABLED'
  ) {
    const deferred = await withPostgresTransaction(context.pool, async (db) => {
      const released = await db.query(
        `UPDATE publication_deliveries SET status='approved',attempts=attempts-1,lease_until=NULL,updated_at=NOW() WHERE id=$1 AND ${activeClaimSql('$2')} RETURNING id`,
        [row.id, row.version]
      );
      if (!released.rowCount) return false;
      await audit(db, 'publication-worker', 'deferred', row.id, {
        code: 'WORKER_DISABLED'
      });
      return true;
    });
    if (!deferred) await abandonClaim(context, row, result);
    return 'stop';
  }
  const outcome =
    error instanceof DeliveryFailure
      ? error.outcome
      : sending && !(error instanceof PublicationAutomationError)
        ? 'uncertain'
        : 'rejected';
  const status =
    outcome === 'uncertain'
      ? 'uncertain'
      : outcome === 'retry' && row.attempts < 4
        ? 'approved'
        : 'blocked';
  const changed = await withPostgresTransaction(context.pool, async (db) => {
    const failed = await db.query(
      `UPDATE publication_deliveries SET status=$2,error_code=$3,next_attempt_at=CASE WHEN $2='approved' THEN NOW()+($4 * INTERVAL '1 minute') ELSE NULL END,lease_until=NULL,
       approved_at=CASE WHEN $3 IN ('SPONSOR_REVIEW_REQUIRED','MEDIA_CHANGED','MEDIA_NOT_APPROVED','MEDIA_UNAVAILABLE') THEN NULL ELSE approved_at END,
       approved_by=CASE WHEN $3 IN ('SPONSOR_REVIEW_REQUIRED','MEDIA_CHANGED','MEDIA_NOT_APPROVED','MEDIA_UNAVAILABLE') THEN NULL ELSE approved_by END,
       version=version+1,updated_at=NOW() WHERE id=$1 AND ${activeClaimSql('$5')} RETURNING id`,
      [
        row.id,
        status,
        safeCode(error),
        Math.min(60, 2 ** row.attempts),
        row.version
      ]
    );
    if (!failed.rowCount) return false;
    if (['PROVIDER_HTTP_401', 'PROVIDER_HTTP_403'].includes(safeCode(error))) {
      await db.query(
        "UPDATE publication_feeds SET connection='error',checked_at=NOW() WHERE id=$1",
        [row.feed_id]
      );
    }
    await audit(db, 'publication-worker', status, row.id, {
      code: safeCode(error)
    });
    return true;
  });
  if (!changed) await abandonClaim(context, row, result);
  return 'continue';
}
