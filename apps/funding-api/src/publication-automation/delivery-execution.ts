import { withPostgresTransaction } from '../postgres-transaction.js';

import {
  activeClaimSql,
  assertDispatchClaim,
  lockClaim,
  PublicationClaimLost
} from './claims.js';
import {
  publicDelivery,
  type DeliveryRow,
  type PublicationDeliveryWorkerContext
} from './context.js';
import {
  complete,
  handleDeliveryFailure,
  observeProviderResult
} from './delivery-outcomes.js';
import { assert, feedConfig, PublicationAutomationError } from './policy.js';
import { ready } from './preflight.js';
import { sendDelivery } from './provider.js';

/** Dispatch one reservation and persist its outcome without extending its authority. */
export async function executeDelivery(
  context: PublicationDeliveryWorkerContext,
  row: DeliveryRow,
  now: Date
): Promise<'continue' | 'stop'> {
  let sending = false;
  let result: Awaited<ReturnType<typeof sendDelivery>> | null = null;
  try {
    const media = await withPostgresTransaction(context.pool, async (db) => {
      const current = await lockClaim(db, row);
      // Pause is checked again immediately before dispatch. An in-flight provider request cannot be recalled.
      const f = (
        await db.query(`SELECT paused FROM publication_feeds WHERE id=$1`, [
          row.feed_id
        ])
      ).rows[0];
      assert(!f.paused, 'FEED_PAUSED');
      // Restrictions and metadata edits lock deliveries before their sources.
      // Read sources without locks and check authorization again at dispatch.
      const media = await ready(
        db,
        current,
        context.storage,
        context.feeds,
        false
      );
      // Storage reads/transformation may outlive the reservation.
      await lockClaim(db, row);
      return media;
    });
    if (now.getTime() - row.scheduled_at.getTime() > 86400000)
      throw new PublicationAutomationError('SCHEDULE_EXPIRED');
    assert((await context.workerSettings()).enabled, 'WORKER_DISABLED');
    sending = true;
    result = await sendDelivery(
      feedConfig(row.feed_id, context.env).config,
      publicDelivery(row),
      media,
      row.provider_media_id,
      async (id) => {
        const saved = await context.pool.query(
          `UPDATE publication_deliveries SET provider_media_id=$2 WHERE id=$1 AND ${activeClaimSql('$3')} RETURNING id`,
          [row.id, id, row.version]
        );
        if (!saved.rowCount) throw new PublicationClaimLost();
      },
      () => assertDispatchClaim(context, row)
    );
    const published = result;
    // This observation commits independently of completion and grants no
    // published status. A later failure still requires reconciliation.
    await observeProviderResult(context, row, published);
    // Persist the external result and audit in one transaction. Failure leaves an uncertain job; never resend blindly.
    await withPostgresTransaction(context.pool, async (db) => {
      await complete(
        db,
        row,
        published.externalPostId,
        published.externalPostUrl,
        'publication-worker',
        row.version
      );
    });
  } catch (error) {
    return handleDeliveryFailure(context, row, error, sending, result);
  }
  return 'continue';
}
