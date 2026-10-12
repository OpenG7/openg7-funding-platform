import { isDeepStrictEqual } from 'node:util';

import type { Pool, PoolClient } from 'pg';
import type {
  ProgrammeIssue,
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationFeed,
  PublicationFeedId
} from '@openg7/funding-core';

import type { SponsorMediaStorage } from '../sponsor-media-storage.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import { isSocialPublicationChannelConfigured } from '../social-publication.service.js';
import { moderationApprovedSql } from '../moderation/policy.js';
import { preparePublicationImage } from '../publication-image.service.js';

import { assert, feedConfig, validId } from './policy.js';
import { type Db, sourceIssues } from './sources.js';
import { mediaOptions } from './media.js';
import { resolvePublicationVisual } from './visuals.js';
import {
  type DeliveryRow,
  type PublicationCommandsContext,
  type PublicationPlanningContext,
  type PublicationDeliveryWorkerContext,
  publicDelivery
} from './context.js';
import { command } from './commands.js';
import {
  prepare,
  repairPreview,
  repair,
  guardEligibility
} from './planning.js';
import { complete, PublicationDeliveryWorker } from './delivery-worker.js';
import { preparationQueue } from './preparation-queue.js';
import { publicationReliability } from './reliability.js';
import {
  publicationReliabilityIncidentPage,
  validateReliabilityIncidentFilter
} from './reliability-incidents.js';

export class PublicationAutomationService {
  async reliabilityIncidents(
    filter: import('@openg7/funding-core').PublicationReliabilityIncidentFilter = {}
  ): Promise<
    import('@openg7/funding-core').PublicationReliabilityIncidentPage
  > {
    validateReliabilityIncidentFilter(filter);
    return withPostgresTransaction(
      this.pool,
      (db) => publicationReliabilityIncidentPage(db, filter),
      { readOnlySnapshot: true }
    );
  }
  private readonly context: PublicationCommandsContext &
    PublicationPlanningContext &
    PublicationDeliveryWorkerContext;
  private readonly worker: PublicationDeliveryWorker;

  constructor(
    private readonly pool: Pool,
    private readonly storage: SponsorMediaStorage,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {
    this.context = {
      pool: this.pool,
      storage: this.storage,
      env: this.env,
      feeds: (db) => this.feeds(db),
      workerSettings: (db, lock) => this.workerSettings(db, lock),
      command: (input, actor, automatic, client) =>
        this.command(input, actor, automatic, client),
      prepare: (feedId, actor, now) => this.prepare(feedId, actor, now),
      guardEligibility: () => this.guardEligibility(),
      complete: (db, row, postId, url, actor, provenance) =>
        complete(db, row, postId, url, actor, undefined, provenance)
    };
    this.worker = new PublicationDeliveryWorker(this.context);
  }
  private async workerSettings(
    db: Db = this.pool,
    lock: '' | 'FOR SHARE' | 'FOR UPDATE' = ''
  ): Promise<{ enabled: boolean; version: number }> {
    const result = await db.query<{ enabled: boolean | null; version: number }>(
      `SELECT enabled,version FROM publication_worker_settings WHERE id=TRUE ${lock}`
    );
    const settings = result.rows[0];
    assert(settings, 'WORKER_UNAVAILABLE', 503);
    return {
      enabled:
        settings.enabled ??
        this.env.SOCIAL_PUBLICATION_WORKER_ENABLED === 'true',
      version: settings.version
    };
  }
  async feeds(db: Db = this.pool): Promise<PublicationFeed[]> {
    const result = await db.query(
      `SELECT id,paused,auto_prepare AS "autoPrepare",timezone,weekdays,to_char(local_time,'HH24:MI') AS "localTime",capacity,horizon_days AS "horizonDays",connection,checked_at AS "checkedAt",account_fingerprint FROM publication_feeds ORDER BY id`
    );
    return result.rows.map((r) => {
      const credentials = feedConfig(r.id, this.env);
      const expired =
        credentials.expiresAt !== null &&
        (!Number.isFinite(Date.parse(credentials.expiresAt)) ||
          Date.parse(credentials.expiresAt) <= Date.now());
      return {
        id: r.id,
        paused: r.paused,
        autoPrepare: r.autoPrepare,
        timezone: r.timezone,
        weekdays: r.weekdays,
        localTime: r.localTime,
        capacity: r.capacity,
        horizonDays: r.horizonDays,
        mode: credentials.config.mode,
        accountId: credentials.accountId || null,
        configured: isSocialPublicationChannelConfigured(
          credentials.config,
          r.id.split(':')[1]
        ),
        expiresAt:
          credentials.expiresAt &&
          Number.isFinite(Date.parse(credentials.expiresAt))
            ? credentials.expiresAt
            : null,
        connection: expired
          ? 'expired'
          : r.account_fingerprint === credentials.fingerprint
            ? r.connection
            : 'unchecked',
        checkedAt: r.checkedAt?.toISOString() ?? null
      } as PublicationFeed;
    });
  }
  async state(
    db: Db = this.pool,
    filter: import('@openg7/funding-core').PublicationAutomationFilter = {}
  ): Promise<PublicationAutomationState> {
    for (const id of [filter.sponsorshipId, filter.deliveryId])
      assert(id === undefined || validId(id), 'INVALID_FILTER', 400);
    assert(
      filter.queueOffset === undefined ||
        (Number.isSafeInteger(filter.queueOffset) && filter.queueOffset >= 0),
      'INVALID_FILTER',
      400
    );
    // Every Pool, including a caller-supplied read port, must borrow one client.
    // Transaction cursors cannot span the separate connections of Pool.query.
    if (db === this.pool || !('release' in db))
      return withPostgresTransaction(
        db as Pool,
        (client) => this.state(client, filter),
        { readOnlySnapshot: true }
      );
    const worker = await this.workerSettings(db);
    const feeds = await this.feeds(db);
    const jobs = await db.query<DeliveryRow>(
      `SELECT d.*,EXISTS(SELECT 1 FROM publication_account_leases a WHERE a.delivery_id=d.id AND a.uncertain) AS account_recovery_required,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.sponsor_company_name,'version',c.updated_at::text,'reviewStatus',c.sponsor_review_status,'paymentStatus',c.status,'presentationApproved',EXISTS(SELECT 1 FROM sponsor_media_assets m WHERE m.contribution_id=c.id AND m.kind='supporting_image' AND m.review_status='approved' AND ${moderationApprovedSql('media', 'm.id')} AND m.deleted_at IS NULL)) ORDER BY c.id) FROM fund_contributions c WHERE c.id IN (SELECT s.contribution_id FROM sponsor_publication_drafts s WHERE s.batch_id=d.batch_id)),'[]'::jsonb) AS sponsors FROM publication_deliveries d
      WHERE ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM sponsor_publication_drafts s WHERE s.batch_id=d.batch_id AND s.contribution_id=$1::uuid))
        AND ($2::uuid IS NULL OR d.id=$2::uuid)
      ORDER BY CASE WHEN status IN ('blocked','uncertain') THEN 0 WHEN status IN ('draft','approved','publishing') THEN 1 ELSE 2 END,scheduled_at DESC LIMIT 200`,
      [filter.sponsorshipId ?? null, filter.deliveryId ?? null]
    );
    const counts = await db.query(
      `SELECT count(*) FILTER(WHERE status='draft')::int AS "awaitingApproval",count(*) FILTER(WHERE status IN ('approved','publishing'))::int AS scheduled,count(*) FILTER(WHERE status IN ('blocked','uncertain'))::int AS exceptions,count(*) FILTER(WHERE published_at >= NOW()-INTERVAL '24 hours')::int AS "publishedToday" FROM publication_deliveries`
    );
    return {
      workerEnabled: worker.enabled,
      workerVersion: worker.version,
      feeds,
      deliveries: jobs.rows.map(publicDelivery),
      queue: await preparationQueue(db, feeds, filter),
      reliability: await publicationReliability(db),
      summary: counts.rows[0]
    };
  }
  /** Current source facts, also used by preflight before an authorized send is due. */
  async sourceIssues(
    id: string,
    db: Db = this.pool
  ): Promise<{ codes: string[]; excludedSponsorIds: string[] }> {
    return sourceIssues(db, id);
  }

  async repairPreview(
    id: string,
    db: Db = this.pool
  ): Promise<ProgrammeIssue['repair']> {
    return repairPreview(this.context, id, db);
  }

  async repair(id: string, version: string, actor: string): Promise<void> {
    return repair(this.context, id, version, actor);
  }

  async guardEligibility(): Promise<void> {
    return guardEligibility(this.context);
  }

  async mediaOptions(
    deliveryId?: string
  ): Promise<{ id: string; url: string; alt: string; company: string }[]> {
    assert(
      deliveryId === undefined || validId(deliveryId),
      'INVALID_FILTER',
      400
    );
    let batchId: string | null = null;
    if (deliveryId !== undefined) {
      const delivery = (
        await this.pool.query<{
          batch_id: string | null;
          feed_id: PublicationFeedId;
        }>('SELECT batch_id,feed_id FROM publication_deliveries WHERE id=$1', [
          deliveryId
        ])
      ).rows[0];
      assert(delivery, 'DELIVERY_NOT_FOUND', 404);
      batchId = delivery.batch_id;
      return mediaOptions(this.pool, batchId, delivery.feed_id);
    }
    return mediaOptions(this.pool, batchId);
  }

  /** Private preparation can be reviewed before a combined sponsor approval; it authorizes no send. */
  async imagePreview(
    id: string,
    version: number,
    imageIndex = 0
  ): Promise<Awaited<ReturnType<typeof preparePublicationImage>>> {
    assert(
      validId(id) &&
        Number.isSafeInteger(version) &&
        version > 0 &&
        Number.isSafeInteger(imageIndex) &&
        imageIndex >= 0 &&
        imageIndex < 10,
      'INVALID_FILTER',
      400
    );
    return withPostgresTransaction(this.pool, async (db) => {
      const row = (
        await db.query<DeliveryRow>(
          'SELECT * FROM publication_deliveries WHERE id=$1 FOR SHARE',
          [id]
        )
      ).rows[0];
      assert(row, 'DELIVERY_NOT_FOUND', 404);
      assert(row.version === version, 'VERSION_CONFLICT');
      const visual = await resolvePublicationVisual(
        db,
        this.storage,
        row,
        false,
        true
      );
      assert(visual.snapshot && visual.prepared, 'MEDIA_NOT_FOUND', 404);
      assert(
        isDeepStrictEqual(visual.snapshot, row.media_snapshot),
        'MEDIA_CHANGED'
      );
      if ('kind' in visual.prepared) {
        const image = visual.prepared.images[imageIndex];
        assert(image, 'MEDIA_NOT_FOUND', 404);
        return image;
      }
      assert(imageIndex === 0, 'MEDIA_NOT_FOUND', 404);
      return visual.prepared;
    });
  }

  async command(
    input: PublicationAutomationCommand,
    actor: string,
    automatic = false,
    client?: PoolClient
  ): Promise<{ id?: string }> {
    return command(this.context, input, actor, automatic, client);
  }

  async prepare(
    feedId: PublicationFeedId,
    actor: string,
    now = new Date()
  ): Promise<void> {
    return prepare(this.context, feedId, actor, now);
  }

  async tick(now = new Date()): Promise<void> {
    return this.worker.tick(now);
  }
}
