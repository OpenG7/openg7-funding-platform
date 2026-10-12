import { withPostgresTransaction } from '../postgres-transaction.js';
import { recordRemoteRemovalProviderResult } from '../moderation/governance.js';
import { lockPublicationBatchCapacity } from '../fund-publication-capacity.persistence.js';
import type { SocialPublicationProviderResult } from '../social-publication.service.js';

import {
  abandonClaim,
  activeClaimSql,
  lockClaim,
  PublicationClaimLost
} from './claims.js';
import {
  audit,
  type DeliveryRow,
  type PublicationDeliveryWorkerContext
} from './context.js';
import { assertSponsorshipContent } from './content.js';
import { assert, PublicationAutomationError } from './policy.js';
import { DeliveryFailure, safeCode } from './provider.js';
import type { Db } from './sources.js';

const observedResultMetadata = (
  row: DeliveryRow,
  result: SocialPublicationProviderResult
) => ({
  claimVersion: row.version,
  mode: row.mode,
  feedId: row.feed_id,
  externalPostId: result.externalPostId,
  externalPostUrl: result.externalPostUrl
});

/** Retain the provider acknowledgement before any completion writes can roll back. */
export async function observeProviderResult(
  context: PublicationDeliveryWorkerContext,
  row: DeliveryRow,
  result: SocialPublicationProviderResult
): Promise<void> {
  await withPostgresTransaction(context.pool, async (db) => {
    // The delivery lock serializes observations of the same claim. A stale
    // worker must use the existing late-result path instead of observing anew.
    await lockClaim(db, row);
    const previous = (
      await db.query<{ metadata: ReturnType<typeof observedResultMetadata> }>(
        `SELECT metadata FROM admin_audit_log WHERE entity_type='publication_delivery' AND entity_id=$1 AND action='publication_automation.provider_result_observed' AND metadata->>'claimVersion'=$2 ORDER BY created_at,id LIMIT 1`,
        [row.id, String(row.version)]
      )
    ).rows[0]?.metadata;
    const metadata = observedResultMetadata(row, result);
    if (previous) {
      assert(
        previous.mode === metadata.mode &&
          previous.feedId === metadata.feedId &&
          previous.externalPostId === metadata.externalPostId &&
          previous.externalPostUrl === metadata.externalPostUrl,
        'PROVIDER_RESULT_CONFLICT'
      );
      await recordRemoteRemovalProviderResult(db, {
        deliveryId: row.id,
        externalPostId: result.externalPostId
      });
      return;
    }
    await audit(
      db,
      'publication-worker',
      'provider_result_observed',
      row.id,
      metadata
    );
    await recordRemoteRemovalProviderResult(db, {
      deliveryId: row.id,
      externalPostId: result.externalPostId
    });
  });
}

/** The caller supplies an open transaction, including reconciliation commands. */
export async function complete(
  db: Db,
  row: DeliveryRow,
  postId: string,
  url: string | null,
  actor: string,
  claimVersion?: number
): Promise<void> {
  if (row.batch_id && row.mode === 'live') {
    // Keep delivery -> slot -> batch -> drafts ordering. Reconciliation already
    // holds its delivery lock; an active worker must acquire its claim lock first.
    if (claimVersion !== undefined) {
      await lockClaim(db, { ...row, version: claimVersion });
    }
    assert(
      await lockPublicationBatchCapacity(db, row.batch_id),
      'SOURCE_CHANGED'
    );
  }
  await assertSponsorshipContent(db, row);
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
    error.code === 'WORKER_DISABLED' &&
    !result
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
  const outcome = result
    ? 'uncertain'
    : error instanceof DeliveryFailure
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
       approved_at=CASE WHEN $3 LIKE 'MODERATION_%' OR $3 IN ('SPONSOR_REVIEW_REQUIRED','MEDIA_CHANGED','MEDIA_NOT_APPROVED','MEDIA_UNAVAILABLE','SOURCE_CONTENT_MISSING','INVALID_MESSAGE') THEN NULL ELSE approved_at END,
       approved_by=CASE WHEN $3 LIKE 'MODERATION_%' OR $3 IN ('SPONSOR_REVIEW_REQUIRED','MEDIA_CHANGED','MEDIA_NOT_APPROVED','MEDIA_UNAVAILABLE','SOURCE_CONTENT_MISSING','INVALID_MESSAGE') THEN NULL ELSE approved_by END,
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
      code: safeCode(error),
      ...(result ? observedResultMetadata(row, result) : {})
    });
    return true;
  });
  if (!changed) await abandonClaim(context, row, result);
  return 'continue';
}
