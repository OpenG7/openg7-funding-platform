import { withPostgresTransaction } from '../postgres-transaction.js';

import {
  audit,
  publicDelivery,
  type DeliveryRow,
  type PublicationDeliveryWorkerContext
} from './context.js';
import { assert, feedConfig, PublicationAutomationError } from './policy.js';
import { ready } from './preflight.js';
import { DeliveryFailure, safeCode, sendDelivery } from './provider.js';
import type { Db } from './sources.js';

export async function complete(
  db: Db,
  row: DeliveryRow,
  postId: string,
  url: string | null,
  actor: string
): Promise<void> {
  await db.query(
    `UPDATE publication_deliveries SET status='published',external_post_id=$2,external_post_url=$3,published_at=NOW(),lease_until=NULL,error_code=NULL,version=version+1,updated_at=NOW() WHERE id=$1`,
    [row.id, postId, url]
  );
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

export class PublicationDeliveryWorker {
  private running = false;

  constructor(private readonly context: PublicationDeliveryWorkerContext) {}

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!(await this.context.workerSettings()).enabled) return;
      await this.context.guardEligibility();
      await withPostgresTransaction(this.context.pool, async (db) => {
        const stale = await db.query(
          `UPDATE publication_deliveries SET status='uncertain',error_code='LEASE_EXPIRED',version=version+1,updated_at=NOW() WHERE status='publishing' AND lease_until<$1 RETURNING id`,
          [now]
        );
        for (const r of stale.rows)
          await audit(db, 'publication-worker', 'uncertain', r.id, {
            code: 'LEASE_EXPIRED'
          });
      });
      const feeds = await this.context.feeds();
      for (const f of feeds.filter(
        (f) =>
          !f.paused &&
          f.configured &&
          (!f.checkedAt ||
            Date.parse(f.checkedAt) < now.getTime() - 6 * 3600000)
      )) {
        if (!(await this.context.workerSettings()).enabled) return;
        await this.context.command(
          { action: 'check', feedId: f.id },
          'publication-worker'
        );
      }
      for (const f of feeds.filter((f) => f.autoPrepare)) {
        if (!(await this.context.workerSettings()).enabled) return;
        // Private preparation continues while sending is paused or unconfigured.
        // The persisted claim also bounds concurrent planners/restarts.
        const claim = await this.context.pool.query(
          `UPDATE publication_feeds SET last_prepared_at=$2 WHERE id=$1 AND (last_prepared_at IS NULL OR last_prepared_at<$2::timestamptz-INTERVAL '5 minutes') RETURNING id`,
          [f.id, now]
        );
        if (claim.rowCount)
          await this.context.prepare(f.id, 'publication-worker', now);
      }
      for (let i = 0; i < 5; i++) {
        const row = await withPostgresTransaction(
          this.context.pool,
          async (db) => {
            // Serialize new claims with the global switch across server instances.
            if (!(await this.context.workerSettings(db, 'FOR SHARE')).enabled)
              return null;
            const r = (
              await db.query<DeliveryRow>(
                `SELECT d.* FROM publication_deliveries d JOIN publication_feeds f ON f.id=d.feed_id WHERE d.status='approved' AND f.paused=FALSE AND d.scheduled_at<=$1 AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=$1) ORDER BY d.scheduled_at LIMIT 1 FOR UPDATE OF d SKIP LOCKED`,
                [now]
              )
            ).rows[0];
            if (!r) return null;
            await db.query(
              `UPDATE publication_deliveries SET status='publishing',attempts=attempts+1,lease_until=NOW()+INTERVAL '5 minutes',updated_at=NOW() WHERE id=$1`,
              [r.id]
            );
            await audit(db, 'publication-worker', 'claim', r.id, {
              attempt: r.attempts + 1
            });
            return { ...r, attempts: r.attempts + 1 };
          }
        );
        if (!row) break;
        let sending = false;
        try {
          const media = await withPostgresTransaction(
            this.context.pool,
            async (db) => {
              // Pause is checked again immediately before dispatch. An in-flight provider request cannot be recalled.
              const f = (
                await db.query(
                  `SELECT paused FROM publication_feeds WHERE id=$1`,
                  [row.feed_id]
                )
              ).rows[0];
              assert(!f.paused, 'FEED_PAUSED');
              return ready(db, row, this.context.storage, this.context.feeds);
            }
          );
          if (now.getTime() - row.scheduled_at.getTime() > 86400000)
            throw new PublicationAutomationError('SCHEDULE_EXPIRED');
          assert(
            (await this.context.workerSettings()).enabled,
            'WORKER_DISABLED'
          );
          sending = true;
          const result = await sendDelivery(
            feedConfig(row.feed_id, this.context.env).config,
            publicDelivery(row),
            media,
            row.provider_media_id,
            async (id) => {
              await this.context.pool.query(
                'UPDATE publication_deliveries SET provider_media_id=$2 WHERE id=$1',
                [row.id, id]
              );
            }
          );
          // Persist the external result and audit in one transaction. Failure leaves an uncertain job; never resend blindly.
          await withPostgresTransaction(this.context.pool, async (db) => {
            await db.query(
              `SELECT id FROM publication_deliveries WHERE id=$1 FOR UPDATE`,
              [row.id]
            );
            await complete(
              db,
              row,
              result.externalPostId,
              result.externalPostUrl,
              'publication-worker'
            );
          });
        } catch (error) {
          if (
            !sending &&
            error instanceof PublicationAutomationError &&
            error.code === 'WORKER_DISABLED'
          ) {
            await withPostgresTransaction(this.context.pool, async (db) => {
              await db.query(
                `UPDATE publication_deliveries SET status='approved',attempts=attempts-1,lease_until=NULL,updated_at=NOW() WHERE id=$1 AND status='publishing'`,
                [row.id]
              );
              await audit(db, 'publication-worker', 'deferred', row.id, {
                code: 'WORKER_DISABLED'
              });
            });
            return;
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
          await withPostgresTransaction(this.context.pool, async (db) => {
            if (
              ['PROVIDER_HTTP_401', 'PROVIDER_HTTP_403'].includes(
                safeCode(error)
              )
            ) {
              await db.query(
                "UPDATE publication_feeds SET connection='error',checked_at=NOW() WHERE id=$1",
                [row.feed_id]
              );
            }
            await db.query(
              `UPDATE publication_deliveries SET status=$2,error_code=$3,next_attempt_at=CASE WHEN $2='approved' THEN NOW()+($4 * INTERVAL '1 minute') ELSE NULL END,lease_until=NULL,
               approved_at=CASE WHEN $3 IN ('SPONSOR_REVIEW_REQUIRED','MEDIA_CHANGED','MEDIA_NOT_APPROVED','MEDIA_UNAVAILABLE') THEN NULL ELSE approved_at END,
               approved_by=CASE WHEN $3 IN ('SPONSOR_REVIEW_REQUIRED','MEDIA_CHANGED','MEDIA_NOT_APPROVED','MEDIA_UNAVAILABLE') THEN NULL ELSE approved_by END,
               version=version+1,updated_at=NOW() WHERE id=$1 AND status='publishing'`,
              [row.id, status, safeCode(error), Math.min(60, 2 ** row.attempts)]
            );
            await audit(db, 'publication-worker', status, row.id, {
              code: safeCode(error)
            });
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}
