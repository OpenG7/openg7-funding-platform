import type { PoolClient } from 'pg';
import type {
  PublicationAutomationCommand,
  PublicationFeed
} from '@openg7/funding-core';

import { withPostgresTransaction } from '../postgres-transaction.js';

import {
  audit,
  publicDelivery,
  type DeliveryRow,
  type PublicationCommandsContext
} from './context.js';
import { editorialMessage } from './editorial-profiles.js';
import { assertMediaScope, resolveMedia } from './media.js';
import {
  assert,
  feedConfig,
  isFeed,
  PublicationAutomationError,
  validateContent,
  validateSettings,
  validId
} from './policy.js';
import { ready } from './preflight.js';
import { checkConnection, DeliveryFailure, verifyRemote } from './provider.js';
import {
  sourceEqual,
  sourceMessage,
  sources as loadSources
} from './sources.js';

export async function command(
  context: PublicationCommandsContext,
  input: PublicationAutomationCommand,
  actor: string,
  automatic = false,
  client?: PoolClient
): Promise<{ id?: string }> {
  const run = <T>(fn: (db: PoolClient) => Promise<T>) =>
    client ? fn(client) : withPostgresTransaction(context.pool, fn);
  assert(input && typeof input === 'object', 'INVALID_COMMAND', 400);
  if (input.action === 'worker') {
    assert(
      typeof input.enabled === 'boolean' &&
        Number.isSafeInteger(input.version) &&
        input.version > 0,
      'INVALID_COMMAND',
      400
    );
    assert(
      input.confirmation ===
        (input.enabled ? 'enable-worker' : 'disable-worker'),
      'CONFIRMATION_REQUIRED',
      400
    );
    await run(async (db) => {
      const current = await context.workerSettings(db, 'FOR UPDATE');
      // An immediate replay has no second effect or audit. Older decisions conflict.
      if (
        current.version === input.version + 1 &&
        current.enabled === input.enabled
      )
        return;
      assert(current.version === input.version, 'WORKER_VERSION_CONFLICT');
      await db.query(
        'UPDATE publication_worker_settings SET enabled=$1,version=version+1,updated_at=NOW() WHERE id=TRUE',
        [input.enabled]
      );
      await audit(
        db,
        actor,
        'worker_settings',
        'worker',
        {
          previousEnabled: current.enabled,
          enabled: input.enabled,
          previousVersion: current.version,
          version: current.version + 1
        },
        'publication_worker'
      );
    });
    return {};
  }
  if (input.action === 'settings') {
    validateSettings(input.settings);
    const s = input.settings;
    await run(async (db) => {
      await db.query(
        `UPDATE publication_feeds SET paused=$2,auto_prepare=$3,timezone=$4,weekdays=$5,local_time=$6,capacity=$7,horizon_days=$8,updated_at=NOW() WHERE id=$1`,
        [
          s.id,
          s.paused,
          s.autoPrepare,
          s.timezone,
          s.weekdays,
          s.localTime,
          s.capacity,
          s.horizonDays
        ]
      );
      await audit(db, actor, 'settings', s.id);
    });
    return {};
  }
  if (input.action === 'pause-all') {
    await run(async (db) => {
      await db.query(
        `UPDATE publication_feeds SET paused=TRUE,updated_at=NOW()`
      );
      await audit(db, actor, 'pause_all', 'all');
    });
    return {};
  }
  if (input.action === 'check') {
    assert(isFeed(input.feedId), 'INVALID_FEED', 400);
    const c = feedConfig(input.feedId, context.env);
    const feed = (await context.feeds()).find((f) => f.id === input.feedId)!;
    let connection: PublicationFeed['connection'] = 'ready';
    try {
      assert(feed.configured, 'CONNECTION_REQUIRED');
      assert(feed.connection !== 'expired', 'TOKEN_EXPIRED');
      await checkConnection(c.config, input.feedId.split(':')[1]!, c.accountId);
    } catch {
      connection = feed.connection === 'expired' ? 'expired' : 'error';
    }
    await run(async (db) => {
      await db.query(
        `UPDATE publication_feeds SET connection=$2,checked_at=NOW(),account_fingerprint=$3 WHERE id=$1`,
        [input.feedId, connection, c.fingerprint]
      );
      await audit(db, actor, 'connection_check', input.feedId, {
        connection
      });
    });
    return {};
  }
  if (input.action === 'prepare') {
    assert(isFeed(input.feedId), 'INVALID_FEED', 400);
    await context.prepare(input.feedId, actor);
    return {};
  }
  if (input.action === 'compose') {
    assert(
      isFeed(input.feedId) &&
        ['sponsorship', 'news', 'achievement', 'campaign'].includes(input.kind),
      'INVALID_COMPOSITION',
      400
    );
    return run(async (db) => {
      // Serialize reservations for a batch, including simultaneous compose requests.
      if (input.batchId) {
        assert(validId(input.batchId), 'INVALID_BATCH', 400);
        await db.query(
          `SELECT id FROM sponsor_publication_batches WHERE id=$1 FOR UPDATE`,
          [input.batchId]
        );
      }
      const existing = input.batchId
        ? (
            await db.query(
              `SELECT id,mode,status,feed_id FROM publication_deliveries WHERE batch_id=$1 AND status<>'cancelled'`,
              [input.batchId]
            )
          ).rows[0]
        : null;
      assert(
        !existing || existing.feed_id === input.feedId,
        'DESTINATION_CHANGED'
      );
      if (
        existing &&
        !(
          existing.mode === 'mock' &&
          existing.status === 'published' &&
          feedConfig(input.feedId, context.env).config.mode === 'live'
        )
      )
        return { id: existing.id as string };
      assert(
        (input.kind === 'sponsorship') === Boolean(input.batchId),
        'INVALID_BATCH',
        400
      );
      const sources = input.batchId
        ? await loadSources(db, input.batchId, input.feedId, true)
        : [];
      const message =
        input.message ??
        (await editorialMessage(
          db,
          input.feedId,
          sourceMessage(sources),
          sources.map((s) => s.contribution_id)
        ));
      const date =
        input.scheduledAt ??
        (input.batchId
          ? (
              await db.query(
                `SELECT scheduled_at FROM sponsor_publication_batches WHERE id=$1`,
                [input.batchId]
              )
            ).rows[0]?.scheduled_at?.toISOString()
          : null) ??
        new Date(Date.now() + 86400000).toISOString();
      validateContent(message, date);
      const c = feedConfig(input.feedId, context.env);
      const media = await resolveMedia(
        db,
        context.storage,
        input.mediaId ?? null,
        input.batchId ?? null
      );
      if (existing) {
        await db.query(
          "UPDATE publication_deliveries SET status='cancelled',version=version+1 WHERE id=$1",
          [existing.id]
        );
        await audit(db, actor, 'archive_simulation', existing.id);
      }
      const r = await db.query(
        `INSERT INTO publication_deliveries(feed_id,kind,batch_id,message,scheduled_at,source_snapshot,media_id,media_snapshot,account_id,mode,auto_managed) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11) RETURNING id`,
        [
          input.feedId,
          input.kind,
          input.batchId ?? null,
          message,
          date,
          JSON.stringify(sources),
          media?.id ?? null,
          media ? JSON.stringify(media) : null,
          c.accountId,
          c.config.mode,
          automatic
        ]
      );
      await audit(db, actor, 'compose', r.rows[0].id, {
        feedId: input.feedId,
        kind: input.kind
      });
      return { id: r.rows[0].id as string };
    });
  }
  assert(
    [
      'edit',
      'approve',
      'reject',
      'cancel',
      'reconcile',
      'confirm-absent'
    ].includes(input.action) &&
      validId(input.id) &&
      Number.isInteger(input.version),
    'INVALID_COMMAND',
    400
  );
  return run(async (db) => {
    const row = (
      await db.query<DeliveryRow>(
        `SELECT * FROM publication_deliveries WHERE id=$1 FOR UPDATE`,
        [input.id]
      )
    ).rows[0];
    assert(row && row.version === input.version, 'VERSION_CONFLICT');
    if (input.action === 'edit') {
      assert(
        ['draft', 'approved', 'blocked'].includes(row.status),
        'DELIVERY_LOCKED'
      );
      validateContent(input.message, input.scheduledAt);
      const sources = row.batch_id
        ? await loadSources(db, row.batch_id, row.feed_id, true)
        : [];
      const media = await resolveMedia(
        db,
        context.storage,
        input.mediaId,
        row.batch_id
      );
      const c = feedConfig(row.feed_id, context.env);
      await db.query(
        `UPDATE publication_deliveries SET message=$2,scheduled_at=$3,media_id=$4,media_snapshot=$5::jsonb,source_snapshot=$6::jsonb,account_id=$7,mode=$8,status='draft',auto_managed=FALSE,approved_at=NULL,approved_by=NULL,error_code=NULL,next_attempt_at=NULL,provider_media_id=NULL,version=version+1,updated_at=NOW() WHERE id=$1`,
        [
          row.id,
          input.message,
          input.scheduledAt,
          media?.id ?? null,
          media ? JSON.stringify(media) : null,
          JSON.stringify(sources),
          c.accountId,
          c.config.mode
        ]
      );
    } else {
      assert(input.confirmation === row.id, 'CONFIRMATION_REQUIRED', 400);
      if (input.action === 'approve') {
        assert(
          row.status === 'draft' && row.scheduled_at.getTime() > Date.now(),
          'APPROVAL_UNAVAILABLE'
        );
        if (row.batch_id) {
          // All decisions share the delivery transaction: any failed check
          // rolls back sponsor approvals as well as the sending authorization.
          const sources = await loadSources(
            db,
            row.batch_id,
            row.feed_id,
            true
          );
          assert(sourceEqual(sources, row.source_snapshot), 'SOURCE_CHANGED');
          await assertMediaScope(db, row.media_id, row.batch_id);
          const pending = (
            await db.query<{
              id: string;
              version: string;
              presentation_approved: boolean;
            }>(
              `SELECT c.id,c.updated_at::text AS version,EXISTS(SELECT 1 FROM sponsor_media_assets m WHERE m.contribution_id=c.id AND m.kind='supporting_image' AND m.review_status='approved' AND m.deleted_at IS NULL) AS presentation_approved FROM fund_contributions c WHERE c.id=ANY($1::uuid[]) AND c.sponsor_review_status='pending_review' ORDER BY c.id`,
              [sources.map((s) => s.contribution_id)]
            )
          ).rows;
          const confirmed = input.approveSponsors ?? [];
          assert(
            Array.isArray(confirmed) &&
              confirmed.every(
                (s) => s && validId(s.id) && typeof s.version === 'string'
              ),
            'SPONSOR_APPROVAL_REQUIRED',
            400
          );
          // Previously approved sponsors may still be included after another
          // reviewer approved a different channel for the same sponsor.
          assert(
            pending.every((s) => confirmed.some((c) => c.id === s.id)) &&
              confirmed.every((c) =>
                sources.some((s) => s.contribution_id === c.id)
              ),
            'SPONSOR_APPROVAL_REQUIRED'
          );
          assert(
            pending.every((s) =>
              confirmed.some((c) => c.id === s.id && c.version === s.version)
            ),
            'VERSION_CONFLICT'
          );
          assert(
            pending.every((s) => s.presentation_approved),
            'SPONSOR_MEDIA_REQUIRED'
          );
          for (const sponsor of pending) {
            await db.query(
              `UPDATE fund_contributions SET sponsor_review_status='approved',sponsor_reviewed_at=NOW(),sponsor_site_visibility_held=TRUE,updated_at=NOW() WHERE id=$1`,
              [sponsor.id]
            );
            await audit(db, actor, 'approve_sponsor', row.id, {
              contributionId: sponsor.id,
              siteVisibility: 'unchanged_private'
            });
          }
        }
        await ready(db, row, context.storage, context.feeds);
        await db.query(
          `UPDATE publication_deliveries SET status='approved',approved_at=NOW(),approved_by=$2,version=version+1,updated_at=NOW() WHERE id=$1`,
          [row.id, actor]
        );
        if (row.batch_id) {
          await db.query(
            `UPDATE sponsor_publication_batches SET status='scheduled',scheduled_at=$2,updated_at=NOW() WHERE id=$1`,
            [row.batch_id, row.scheduled_at]
          );
          await db.query(
            `UPDATE sponsor_publication_drafts SET status='scheduled',approved_at=COALESCE(approved_at,NOW()),scheduled_at=$2,updated_at=NOW() WHERE batch_id=$1`,
            [row.batch_id, row.scheduled_at]
          );
        }
      } else if (input.action === 'reject' || input.action === 'cancel') {
        assert(
          ['draft', 'approved', 'blocked'].includes(row.status),
          'DELIVERY_LOCKED'
        );
        await db.query(
          `UPDATE publication_deliveries SET status=$2,auto_managed=FALSE,approved_at=NULL,approved_by=NULL,version=version+1,updated_at=NOW() WHERE id=$1`,
          [row.id, input.action === 'reject' ? 'rejected' : 'cancelled']
        );
      } else if (input.action === 'confirm-absent') {
        assert(
          row.status === 'uncertain' &&
            typeof input.reason === 'string' &&
            input.reason.trim().length >= 20 &&
            input.reason.length <= 500,
          'ABSENCE_REVIEW_REQUIRED',
          400
        );
        await db.query(
          "UPDATE publication_deliveries SET status='blocked',approved_at=NULL,approved_by=NULL,error_code='ABSENCE_CONFIRMED',version=version+1,updated_at=NOW() WHERE id=$1",
          [row.id]
        );
        await audit(db, actor, 'absence_review', row.id, {
          reason: input.reason
        });
      } else if (input.action === 'reconcile') {
        assert(
          row.status === 'uncertain' &&
            typeof input.externalPostId === 'string',
          'RECONCILIATION_UNAVAILABLE'
        );
        const c = feedConfig(row.feed_id, context.env);
        assert(c.accountId === row.account_id, 'DESTINATION_CHANGED');
        const result = await verifyRemote(
          c.config,
          publicDelivery(row),
          input.externalPostId
        ).catch((error: unknown) => {
          if (error instanceof DeliveryFailure)
            throw new PublicationAutomationError('REMOTE_POST_UNVERIFIED', 503);
          throw error;
        });
        await context.complete(
          db,
          row,
          result.externalPostId,
          result.externalPostUrl,
          actor
        );
      }
    }
    await audit(db, actor, input.action, row.id, {
      version: row.version,
      feedId: row.feed_id,
      mode: row.mode
    });
    return { id: row.id };
  });
}
