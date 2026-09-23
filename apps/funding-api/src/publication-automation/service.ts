import { isDeepStrictEqual } from 'node:util';

import type { Pool, PoolClient } from 'pg';
import sharp from 'sharp';
import type {
  PublicationAutomationCommand,
  PublicationAutomationState,
  PublicationDelivery,
  PublicationFeed,
  PublicationFeedId
} from '@openg7/funding-core';
import type { ProgrammeIssue } from '@openg7/funding-core';

import { DEFAULT_SPONSORSHIP_PRICING_CONFIG } from '../../../../packages/funding-core/src/index.js';
import type { SponsorMediaStorage } from '../sponsor-media-storage.js';
import { isSocialPublicationChannelConfigured } from '../social-publication.service.js';

import { editorialMessage } from './editorial-profiles.js';
import {
  assert,
  digest,
  feedConfig,
  isFeed,
  PublicationAutomationError,
  recurrenceTimes,
  validateContent,
  validateSettings,
  validId
} from './policy.js';
import {
  checkConnection,
  DeliveryFailure,
  safeCode,
  sendDelivery,
  verifyRemote
} from './provider.js';

type Db = Pool | PoolClient;
interface Source {
  id: string;
  contribution_id: string;
  title: string;
  body: string;
  disclosure_text: string;
  feed_target: string;
  channel: string;
}
interface Media {
  id: string;
  url: string;
  alt: string;
  key: string;
  hash: string;
  version: string;
}
interface DeliveryRow {
  id: string;
  feed_id: PublicationFeedId;
  kind: PublicationDelivery['kind'];
  batch_id: string | null;
  message: string;
  scheduled_at: Date;
  media_id: string | null;
  media_snapshot: Media | null;
  source_snapshot: Source[];
  account_id: string;
  mode: PublicationDelivery['mode'];
  auto_managed: boolean;
  sponsors?: PublicationDelivery['sponsors'];
  version: number;
  status: PublicationDelivery['status'];
  attempts: number;
  next_attempt_at: Date | null;
  external_post_id: string | null;
  external_post_url: string | null;
  provider_media_id: string | null;
  error_code: string | null;
  approved_at: Date | null;
  published_at: Date | null;
}
const publicDelivery = (r: DeliveryRow): PublicationDelivery => ({
  id: r.id,
  feedId: r.feed_id,
  kind: r.kind,
  batchId: r.batch_id,
  message: r.message,
  scheduledAt: r.scheduled_at.toISOString(),
  mediaId: r.media_id,
  mediaUrl: r.media_snapshot?.url ?? null,
  mediaAlt: r.media_snapshot?.alt ?? null,
  accountId: r.account_id,
  mode: r.mode,
  autoManaged: r.auto_managed,
  sponsors: r.sponsors ?? [],
  version: r.version,
  status: r.status,
  attempts: r.attempts,
  nextAttemptAt: r.next_attempt_at?.toISOString() ?? null,
  externalPostId: r.external_post_id,
  externalPostUrl: r.external_post_url,
  errorCode: r.error_code,
  approvedAt: r.approved_at?.toISOString() ?? null,
  publishedAt: r.published_at?.toISOString() ?? null
});
async function audit(
  db: Db,
  actor: string,
  action: string,
  id: string,
  metadata: object = {},
  entityType = 'publication_delivery'
): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_log(actor,action,entity_type,entity_id,summary,metadata) VALUES($1,$2,$5,$3,$2,$4::jsonb)`,
    [
      actor,
      `publication_automation.${action}`,
      id,
      JSON.stringify(metadata),
      entityType
    ]
  );
}
async function transaction<T>(
  pool: Pool,
  fn: (db: PoolClient) => Promise<T>
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
const sourceEqual = (a: Source[], b: Source[]) => isDeepStrictEqual(a, b);
const sourceMessage = (sources: Source[]) =>
  sources
    .map((s) =>
      [s.title, s.body, s.disclosure_text].filter(Boolean).join('\n\n')
    )
    .join('\n\n');
// Explicit destinations take precedence. Unassigned CAD orders use the existing
// promised benefits, routed to OpenG7; preparation does not publish the profile.
const eligibleDestination = (alias: string, target: string, channel: string) =>
  `COALESCE(${alias}.sponsor_feed_target,'openg7')=${target} AND (
    ${alias}.sponsor_feed_channels ? ${channel} OR (
      ${alias}.sponsor_feed_channels='[]'::jsonb AND lower(${alias}.currency)='cad'
      AND ${alias}.amount_cents >= CASE WHEN ${channel}='facebook' THEN ${DEFAULT_SPONSORSHIP_PRICING_CONFIG.benefits.facebookBatch.minimumAmount * 100} ELSE ${DEFAULT_SPONSORSHIP_PRICING_CONFIG.benefits.linkedinBatch.minimumAmount * 100} END))`;

export class PublicationAutomationService {
  private running = false;
  constructor(
    private readonly pool: Pool,
    private readonly storage: SponsorMediaStorage,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}
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
  async state(db: Db = this.pool): Promise<PublicationAutomationState> {
    const worker = await this.workerSettings(db);
    const feeds = await this.feeds(db);
    const jobs = await db.query<DeliveryRow>(
      `SELECT d.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.sponsor_company_name,'version',c.updated_at::text,'reviewStatus',c.sponsor_review_status,'paymentStatus',c.status,'presentationApproved',EXISTS(SELECT 1 FROM sponsor_media_assets m WHERE m.contribution_id=c.id AND m.kind='supporting_image' AND m.review_status='approved' AND m.deleted_at IS NULL)) ORDER BY c.id) FROM fund_contributions c WHERE c.id IN (SELECT s.contribution_id FROM sponsor_publication_drafts s WHERE s.batch_id=d.batch_id)),'[]'::jsonb) AS sponsors FROM publication_deliveries d ORDER BY CASE WHEN status IN ('blocked','uncertain') THEN 0 WHEN status IN ('draft','approved','publishing') THEN 1 ELSE 2 END,scheduled_at DESC LIMIT 200`
    );
    const counts = await db.query(
      `SELECT count(*) FILTER(WHERE status='draft')::int AS "awaitingApproval",count(*) FILTER(WHERE status IN ('approved','publishing'))::int AS scheduled,count(*) FILTER(WHERE status IN ('blocked','uncertain'))::int AS exceptions,count(*) FILTER(WHERE published_at >= NOW()-INTERVAL '24 hours')::int AS "publishedToday" FROM publication_deliveries`
    );
    return {
      workerEnabled: worker.enabled,
      workerVersion: worker.version,
      feeds,
      deliveries: jobs.rows.map(publicDelivery),
      summary: counts.rows[0]
    };
  }
  /** Current source facts, also used by preflight before an authorized send is due. */
  async sourceIssues(
    id: string,
    db: Db = this.pool
  ): Promise<{ codes: string[]; excludedSponsorIds: string[] }> {
    const rows = (
      await db.query(
        `SELECT c.id,c.status,c.public_display_consent,c.sponsor_review_status,c.sponsor_feed_status,(${eligibleDestination('c', 's.feed_target', 's.channel')}) destination_eligible FROM publication_deliveries d JOIN sponsor_publication_drafts s ON s.batch_id=d.batch_id JOIN fund_contributions c ON c.id=s.contribution_id WHERE d.id=$1`,
        [id]
      )
    ).rows;
    const codes = new Set<string>();
    const excludedSponsorIds: string[] = [];
    for (const r of rows) {
      const invalid =
        r.status !== 'paid' ||
        !r.public_display_consent ||
        r.sponsor_review_status === 'rejected' ||
        r.sponsor_feed_status === 'hidden' ||
        !r.destination_eligible;
      if (!invalid) continue;
      excludedSponsorIds.push(r.id);
      if (r.status !== 'paid') codes.add('PAYMENT_REQUIRED');
      if (!r.public_display_consent) codes.add('CONSENT_WITHDRAWN');
      if (
        r.sponsor_review_status === 'rejected' ||
        r.sponsor_feed_status === 'hidden'
      )
        codes.add('SOURCE_NOT_ELIGIBLE');
      if (!r.destination_eligible) codes.add('DESTINATION_CHANGED');
    }
    return {
      codes: [...codes].sort(),
      excludedSponsorIds: excludedSponsorIds.sort()
    };
  }

  private async repairSources(row: DeliveryRow, db: Db) {
    const batch = (
      await db.query(
        'SELECT capacity FROM sponsor_publication_batches WHERE id=$1',
        [row.batch_id]
      )
    ).rows[0];
    if (!batch) return [];
    const [target, channel] = row.feed_id.split(':');
    const rows = (
      await db.query(
        `SELECT d.id,d.contribution_id,d.title,d.body,d.disclosure_text,d.feed_target,d.channel,c.sponsor_company_name AS name FROM sponsor_publication_drafts d JOIN fund_contributions c ON c.id=d.contribution_id WHERE (d.batch_id=$1 OR (d.batch_id IS NULL AND d.slot_id IS NULL)) AND d.feed_target=$2 AND d.channel=$3 AND d.status IN ('draft','approved','scheduled') AND c.status='paid' AND c.public_display_consent IS TRUE AND c.sponsor_review_status IN ('pending_review','approved') AND c.sponsor_feed_status NOT IN ('hidden','published') AND ${eligibleDestination('c', '$2', '$3')} ORDER BY (d.batch_id=$1) DESC NULLS LAST,d.created_at,d.id LIMIT $4`,
        [row.batch_id, target, channel, batch.capacity]
      )
    ).rows as (Source & { name: string })[];
    const result: typeof rows = [];
    for (const r of rows) {
      if (sourceMessage([...result, r]).length > 2900) break;
      result.push(r);
    }
    return result;
  }

  async repairPreview(
    id: string,
    db: Db = this.pool
  ): Promise<ProgrammeIssue['repair']> {
    const row = (
      await db.query<DeliveryRow>(
        'SELECT * FROM publication_deliveries WHERE id=$1',
        [id]
      )
    ).rows[0];
    if (
      !row?.batch_id ||
      !['draft', 'approved', 'blocked'].includes(row.status)
    )
      return null;
    // Legacy or ambiguous external deliveries always stay in the investigation path.
    if (
      (
        await db.query(
          "SELECT 1 FROM social_publication_jobs WHERE batch_id=$1 AND status IN ('publishing','published','failed')",
          [row.batch_id]
        )
      ).rowCount
    )
      return null;
    const issues = await this.sourceIssues(id, db);
    if (!issues.excludedSponsorIds.length) return null;
    const candidates = await this.repairSources(row, db);
    if (!candidates.length) return null;
    const feed = (await this.feeds(db)).find((f) => f.id === row.feed_id)!;
    const scheduledAt =
      row.scheduled_at.getTime() > Date.now()
        ? row.scheduled_at.toISOString()
        : recurrenceTimes(feed, new Date())[0];
    if (!scheduledAt) return null;
    const message = await editorialMessage(
      db,
      row.feed_id,
      sourceMessage(candidates),
      candidates.map((s) => s.contribution_id)
    );
    const original = (
      await db.query(
        'SELECT contribution_id FROM sponsor_publication_drafts WHERE batch_id=$1',
        [row.batch_id]
      )
    ).rows.map((r) => r.contribution_id as string);
    const sponsors = candidates.map((c) => ({
      id: c.contribution_id,
      name: c.name
    }));
    return {
      version: digest(
        JSON.stringify({
          v: row.version,
          candidates,
          message,
          scheduledAt,
          issues
        })
      ),
      message,
      scheduledAt,
      sponsors,
      removed: original.filter((id) => !sponsors.some((s) => s.id === id)),
      added: sponsors.filter((s) => !original.includes(s.id)).map((s) => s.id)
    };
  }

  async repair(id: string, version: string, actor: string): Promise<void> {
    await transaction(this.pool, async (db) => {
      const feed = (
        await db.query(
          'SELECT feed_id FROM publication_deliveries WHERE id=$1',
          [id]
        )
      ).rows[0]?.feed_id;
      assert(feed, 'VERSION_CONFLICT');
      await db.query(
        'SELECT id FROM publication_feeds WHERE id=$1 FOR UPDATE',
        [feed]
      );
      const row = (
        await db.query<DeliveryRow>(
          'SELECT * FROM publication_deliveries WHERE id=$1 FOR UPDATE',
          [id]
        )
      ).rows[0]!;
      await db.query(
        'SELECT id FROM sponsor_publication_batches WHERE id=$1 FOR UPDATE',
        [row.batch_id]
      );
      // Lock eligible and excluded contribution facts before recalculating the proposal.
      await db.query(
        `SELECT c.id FROM fund_contributions c JOIN sponsor_publication_drafts d ON d.contribution_id=c.id WHERE d.batch_id=$1 OR (d.batch_id IS NULL AND d.feed_target=$2 AND d.channel=$3) ORDER BY c.id,d.id FOR UPDATE OF d,c`,
        [row.batch_id, ...row.feed_id.split(':')]
      );
      const proposal = await this.repairPreview(id, db);
      assert(proposal && proposal.version === version, 'VERSION_CONFLICT');
      const candidates = await this.repairSources(row, db);
      await db.query(
        "UPDATE sponsor_publication_drafts SET batch_id=NULL,slot_id=NULL,scheduled_at=NULL,status='draft',approved_at=NULL,updated_at=NOW() WHERE batch_id=$1",
        [row.batch_id]
      );
      for (const c of candidates)
        await db.query(
          "UPDATE sponsor_publication_drafts SET batch_id=$2,scheduled_at=$3,status='draft',approved_at=NULL,updated_at=NOW() WHERE id=$1",
          [c.id, row.batch_id, proposal.scheduledAt]
        );
      await db.query(
        "UPDATE sponsor_publication_batches SET status='open',scheduled_at=$2,updated_at=NOW() WHERE id=$1",
        [row.batch_id, proposal.scheduledAt]
      );
      // Recompose from retained source facts; a media from an excluded sponsor is removed.
      const keepMedia =
        row.media_id &&
        (
          await db.query(
            "SELECT 1 FROM sponsor_media_assets WHERE id=$1 AND contribution_id=ANY($2::uuid[]) AND deleted_at IS NULL AND review_status='approved'",
            [row.media_id, proposal.sponsors.map((s) => s.id)]
          )
        ).rowCount;
      await this.command(
        {
          action: 'edit',
          id,
          version: row.version,
          message: proposal.message,
          scheduledAt: proposal.scheduledAt,
          mediaId: keepMedia ? row.media_id : null
        },
        actor,
        false,
        db
      );
      await audit(db, actor, 'repair_proposed', id, {
        removed: proposal.removed,
        added: proposal.added,
        approval: 'required'
      });
    });
  }

  async guardEligibility(): Promise<void> {
    await transaction(this.pool, async (db) => {
      const rows = (
        await db.query<DeliveryRow>(
          "SELECT * FROM publication_deliveries WHERE status IN ('draft','approved') AND batch_id IS NOT NULL ORDER BY id FOR UPDATE SKIP LOCKED"
        )
      ).rows;
      for (const row of rows) {
        const issues = await this.sourceIssues(row.id, db);
        if (!issues.codes.length) continue;
        await db.query(
          "UPDATE publication_deliveries SET status='blocked',approved_at=NULL,approved_by=NULL,error_code='SOURCE_NOT_ELIGIBLE',version=version+1,updated_at=NOW() WHERE id=$1",
          [row.id]
        );
        await audit(db, 'publication-worker', 'source_invalidated', row.id, {
          codes: issues.codes,
          affected: issues.excludedSponsorIds
        });
      }
    });
  }

  async mediaOptions(): Promise<
    { id: string; url: string; alt: string; company: string }[]
  > {
    const result = await this.pool.query(
      `SELECT m.id,m.public_url AS url,m.alt_text AS alt,c.sponsor_company_name AS company FROM sponsor_media_assets m JOIN fund_contributions c ON c.id=m.contribution_id WHERE m.deleted_at IS NULL AND m.review_status='approved' AND c.public_display_consent IS TRUE AND c.sponsor_review_status='approved' AND c.status='paid' AND m.public_url IS NOT NULL ORDER BY m.created_at DESC LIMIT 200`
    );
    return result.rows;
  }
  private async media(db: Db, id: string | null): Promise<Media | null> {
    if (!id) return null;
    assert(validId(id), 'INVALID_MEDIA', 400);
    const r = (
      await db.query(
        `SELECT m.id,m.public_url AS url,m.alt_text AS alt,m.processed_storage_key AS key,m.updated_at::text AS version FROM sponsor_media_assets m JOIN fund_contributions c ON c.id=m.contribution_id WHERE m.id=$1 AND m.deleted_at IS NULL AND m.review_status='approved' AND c.public_display_consent IS TRUE AND c.sponsor_review_status='approved' AND c.status='paid'`,
        [id]
      )
    ).rows[0];
    assert(r && r.url && r.alt?.trim(), 'MEDIA_NOT_APPROVED');
    const bytes = await this.storage.readPrivateObject(r.key);
    assert(bytes, 'MEDIA_UNAVAILABLE');
    return { ...r, hash: digest(bytes) } as Media;
  }
  private async sources(
    db: Db,
    batchId: string,
    feedId: PublicationFeedId,
    allowPending = false
  ): Promise<Source[]> {
    const batch = (
      await db.query(
        `SELECT * FROM sponsor_publication_batches WHERE id=$1 FOR UPDATE`,
        [batchId]
      )
    ).rows[0];
    assert(
      batch && ['open', 'scheduled'].includes(batch.status),
      'BATCH_UNAVAILABLE'
    );
    assert(
      !(
        await db.query(
          `SELECT 1 FROM social_publication_jobs WHERE batch_id=$1 AND status IN ('publishing','published','failed')`,
          [batchId]
        )
      ).rowCount,
      'LEGACY_DELIVERY_EXISTS'
    );
    const all = (
      await db.query(
        `SELECT d.id,d.contribution_id,d.title,d.body,d.disclosure_text,d.feed_target,d.channel,d.status,c.sponsor_feed_status,c.public_display_consent,c.sponsor_review_status,c.status AS payment_status,(${eligibleDestination('c', 'd.feed_target', 'd.channel')}) AS destination_eligible FROM sponsor_publication_drafts d JOIN fund_contributions c ON c.id=d.contribution_id WHERE d.batch_id=$1 ORDER BY d.id FOR UPDATE OF d,c`,
        [batchId]
      )
    ).rows;
    assert(all.length > 0 && all.length <= batch.capacity, 'EMPTY_BATCH');
    assert(
      all.every(
        (d) =>
          `${d.feed_target}:${d.channel}` === feedId &&
          ['draft', 'approved', 'scheduled'].includes(d.status) &&
          d.public_display_consent &&
          (d.sponsor_review_status === 'approved' ||
            (allowPending && d.sponsor_review_status === 'pending_review')) &&
          d.destination_eligible &&
          d.payment_status === 'paid' &&
          d.sponsor_feed_status !== 'hidden'
      ),
      'SOURCE_NOT_ELIGIBLE'
    );
    return all.map(
      ({
        id,
        contribution_id,
        title,
        body,
        disclosure_text,
        feed_target,
        channel
      }) => ({
        id,
        contribution_id,
        title,
        body,
        disclosure_text,
        feed_target,
        channel
      })
    );
  }
  private async ready(db: Db, row: DeliveryRow): Promise<Buffer | null> {
    const feed = (await this.feeds(db)).find((f) => f.id === row.feed_id)!;
    assert(
      feed.configured && feed.connection === 'ready',
      'CONNECTION_REQUIRED'
    );
    assert(
      feed.accountId === row.account_id && feed.mode === row.mode,
      'DESTINATION_CHANGED'
    );
    if (row.batch_id)
      assert(
        sourceEqual(
          await this.sources(db, row.batch_id, row.feed_id),
          row.source_snapshot
        ),
        'SOURCE_CHANGED'
      );
    if (row.batch_id && row.approved_at) {
      const batch = (
        await db.query(
          'SELECT status,scheduled_at FROM sponsor_publication_batches WHERE id=$1',
          [row.batch_id]
        )
      ).rows[0];
      assert(
        batch?.status === 'scheduled' &&
          batch.scheduled_at?.getTime() === row.scheduled_at.getTime(),
        'SOURCE_CHANGED'
      );
    }
    const media = await this.media(db, row.media_id);
    assert(isDeepStrictEqual(media, row.media_snapshot), 'MEDIA_CHANGED');
    if (!media) return null;
    const bytes = await this.storage.readPrivateObject(media.key);
    assert(bytes && digest(bytes) === media.hash, 'MEDIA_CHANGED');
    return sharp(bytes).rotate().jpeg({ quality: 90 }).toBuffer();
  }
  async command(
    input: PublicationAutomationCommand,
    actor: string,
    automatic = false,
    client?: PoolClient
  ): Promise<{ id?: string }> {
    const run = <T>(fn: (db: PoolClient) => Promise<T>) =>
      client ? fn(client) : transaction(this.pool, fn);
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
        const current = await this.workerSettings(db, 'FOR UPDATE');
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
      const c = feedConfig(input.feedId, this.env);
      const feed = (await this.feeds()).find((f) => f.id === input.feedId)!;
      let connection: PublicationFeed['connection'] = 'ready';
      try {
        assert(feed.configured, 'CONNECTION_REQUIRED');
        assert(feed.connection !== 'expired', 'TOKEN_EXPIRED');
        await checkConnection(
          c.config,
          input.feedId.split(':')[1]!,
          c.accountId
        );
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
      await this.prepare(input.feedId, actor);
      return {};
    }
    if (input.action === 'compose') {
      assert(
        isFeed(input.feedId) &&
          ['sponsorship', 'news', 'achievement', 'campaign'].includes(
            input.kind
          ),
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
            feedConfig(input.feedId, this.env).config.mode === 'live'
          )
        )
          return { id: existing.id as string };
        if (existing) {
          await db.query(
            "UPDATE publication_deliveries SET status='cancelled',version=version+1 WHERE id=$1",
            [existing.id]
          );
          await audit(db, actor, 'archive_simulation', existing.id);
        }
        assert(
          (input.kind === 'sponsorship') === Boolean(input.batchId),
          'INVALID_BATCH',
          400
        );
        const sources = input.batchId
          ? await this.sources(db, input.batchId, input.feedId, true)
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
        const c = feedConfig(input.feedId, this.env);
        const media = await this.media(db, input.mediaId ?? null);
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
        const media = await this.media(db, input.mediaId);
        const sources = row.batch_id
          ? await this.sources(db, row.batch_id, row.feed_id, true)
          : [];
        const c = feedConfig(row.feed_id, this.env);
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
            const sources = await this.sources(
              db,
              row.batch_id,
              row.feed_id,
              true
            );
            assert(sourceEqual(sources, row.source_snapshot), 'SOURCE_CHANGED');
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
          await this.ready(db, row);
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
          const c = feedConfig(row.feed_id, this.env);
          assert(c.accountId === row.account_id, 'DESTINATION_CHANGED');
          const result = await verifyRemote(
            c.config,
            publicDelivery(row),
            input.externalPostId
          );
          await this.complete(
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
  async prepare(
    feedId: PublicationFeedId,
    actor: string,
    now = new Date()
  ): Promise<void> {
    const proposals: string[] = [];
    await transaction(this.pool, async (db) => {
      await db.query(
        `SELECT id FROM publication_feeds WHERE id=$1 FOR NO KEY UPDATE`,
        [feedId]
      );
      const feed = (await this.feeds(db)).find((f) => f.id === feedId)!;
      assert(feed, 'INVALID_FEED', 400);
      const [target, channel] = feedId.split(':');
      // Only confirmed payments and public consent enter private preparation.
      // Sponsor review belongs to the final human decision, never to this worker.
      await db.query(
        `INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text)
        SELECT c.id,$1,$2,CASE WHEN $2='linkedin' THEN 'Un partenaire engagé : ' ELSE 'Merci à ' END || c.sponsor_company_name,left(COALESCE(NULLIF(btrim(c.sponsor_public_summary),''),'Merci de soutenir le Fonds des Bâtisseurs OpenG7.'),300),'Commandite rémunérée.' FROM fund_contributions c
        WHERE c.contribution_type='sponsorship_interest' AND c.status='paid' AND c.public_display_consent IS TRUE AND c.sponsor_review_status IN ('pending_review','approved') AND ${eligibleDestination('c', '$1', '$2')} AND NULLIF(btrim(c.sponsor_company_name),'') IS NOT NULL AND c.sponsor_feed_status NOT IN ('hidden','published')
        ON CONFLICT (contribution_id,feed_target,channel) DO NOTHING`,
        [target, channel]
      );
      // An untouched, overdue proposal is repacked into the next recurrence.
      // Human edits and authorized/uncertain/rejected deliveries are never moved.
      const overdue = (
        await db.query<DeliveryRow>(
          `SELECT * FROM publication_deliveries WHERE feed_id=$1 AND status='draft' AND auto_managed AND scheduled_at<=$2 ORDER BY id FOR UPDATE`,
          [feedId, now]
        )
      ).rows;
      for (const job of overdue) {
        await db.query(
          `UPDATE publication_deliveries SET status='cancelled',version=version+1,updated_at=NOW() WHERE id=$1`,
          [job.id]
        );
        await db.query(
          `UPDATE sponsor_publication_batches SET status='cancelled',updated_at=NOW() WHERE id=$1`,
          [job.batch_id]
        );
        await db.query(
          `UPDATE sponsor_publication_drafts SET batch_id=NULL,scheduled_at=NULL,updated_at=NOW() WHERE batch_id=$1`,
          [job.batch_id]
        );
        await audit(db, actor, 'reschedule_proposal', job.id);
      }
      for (const date of recurrenceTimes(feed, now)) {
        let batch = (
          await db.query(
            `SELECT b.* FROM publication_recurrences r JOIN sponsor_publication_batches b ON b.id=r.batch_id WHERE r.feed_id=$1 AND r.starts_at=$2`,
            [feedId, date]
          )
        ).rows[0];
        if (!batch) {
          const slot = (
            await db.query(
              `INSERT INTO publication_slots(feed_target,channel,starts_at,timezone,capacity,status) VALUES($1,$2,$3,$4,$5,'open') RETURNING id`,
              [target, channel, date, feed.timezone, feed.capacity]
            )
          ).rows[0];
          batch = (
            await db.query(
              `INSERT INTO sponsor_publication_batches(channel,capacity,status,scheduled_at,slot_id) VALUES($1,$2,'open',$3,$4) RETURNING *`,
              [channel, feed.capacity, date, slot.id]
            )
          ).rows[0];
          await db.query(
            `INSERT INTO publication_recurrences(feed_id,starts_at,batch_id) VALUES($1,$2,$3)`,
            [feedId, date, batch.id]
          );
        }
        // Match approval's lock order (delivery, then batch).
        const job = (
          await db.query<DeliveryRow>(
            `SELECT * FROM publication_deliveries WHERE batch_id=$1 AND status<>'cancelled' FOR UPDATE`,
            [batch.id]
          )
        ).rows[0];
        batch = (
          await db.query(
            `SELECT * FROM sponsor_publication_batches WHERE id=$1 FOR UPDATE`,
            [batch.id]
          )
        ).rows[0];
        if (
          batch.status !== 'open' ||
          (job && !(job.status === 'draft' && job.auto_managed))
        )
          continue;
        const members = (
          await db.query<Source>(
            `SELECT * FROM sponsor_publication_drafts WHERE batch_id=$1 ORDER BY id`,
            [batch.id]
          )
        ).rows;
        const remaining = Math.max(0, batch.capacity - members.length);
        const candidates = (
          await db.query<Source>(
            `SELECT d.* FROM sponsor_publication_drafts d JOIN fund_contributions c ON c.id=d.contribution_id WHERE d.batch_id IS NULL AND d.slot_id IS NULL AND d.feed_target=$1 AND d.channel=$2 AND d.status IN ('draft','approved') AND c.status='paid' AND c.public_display_consent IS TRUE AND c.sponsor_review_status IN ('pending_review','approved') AND ${eligibleDestination('c', '$1', '$2')} AND c.sponsor_feed_status NOT IN ('hidden','published') ORDER BY d.created_at,d.id LIMIT $3 FOR UPDATE OF d SKIP LOCKED`,
            [target, channel, remaining]
          )
        ).rows;
        for (const candidate of candidates) {
          // Capacity is a maximum, and provider text limits also bound a batch.
          if (sourceMessage([...members, candidate]).length > 2900) break;
          await db.query(
            `UPDATE sponsor_publication_drafts SET batch_id=$2,scheduled_at=$3,updated_at=NOW() WHERE id=$1`,
            [candidate.id, batch.id, date]
          );
          members.push(candidate);
        }
        if (!members.length) continue;
        if (job) {
          try {
            const sources = await this.sources(db, batch.id, feedId, true);
            const message = await editorialMessage(
              db,
              feedId,
              sourceMessage(sources),
              sources.map((s) => s.contribution_id)
            );
            validateContent(message, date);
            const c = feedConfig(feedId, this.env);
            if (
              !sourceEqual(sources, job.source_snapshot) ||
              message !== job.message ||
              job.account_id !== c.accountId ||
              job.mode !== c.config.mode
            ) {
              await db.query(
                `UPDATE publication_deliveries SET message=$2,source_snapshot=$3::jsonb,account_id=$4,mode=$5,version=version+1,updated_at=NOW() WHERE id=$1`,
                [
                  job.id,
                  message,
                  JSON.stringify(sources),
                  c.accountId,
                  c.config.mode
                ]
              );
              await audit(db, actor, 'refresh_proposal', job.id);
            }
          } catch (error) {
            if (!(error instanceof PublicationAutomationError)) throw error;
            await db.query(
              `UPDATE publication_deliveries SET status='blocked',error_code=$2,version=version+1,updated_at=NOW() WHERE id=$1`,
              [job.id, error.code]
            );
            await audit(db, actor, 'blocked', job.id, { code: error.code });
          }
        } else proposals.push(batch.id);
      }
      await audit(db, actor, 'prepare', feedId, {
        proposedBatches: proposals.length
      });
    });
    for (const batchId of proposals) {
      try {
        await this.command(
          { action: 'compose', feedId, kind: 'sponsorship', batchId },
          actor,
          true
        );
      } catch (error) {
        if (!(error instanceof PublicationAutomationError)) throw error;
        await audit(this.pool, actor, 'preparation_blocked', batchId, {
          code: error.code
        });
      }
    }
  }
  private async complete(
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
  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!(await this.workerSettings()).enabled) return;
      await this.guardEligibility();
      await transaction(this.pool, async (db) => {
        const stale = await db.query(
          `UPDATE publication_deliveries SET status='uncertain',error_code='LEASE_EXPIRED',version=version+1,updated_at=NOW() WHERE status='publishing' AND lease_until<$1 RETURNING id`,
          [now]
        );
        for (const r of stale.rows)
          await audit(db, 'publication-worker', 'uncertain', r.id, {
            code: 'LEASE_EXPIRED'
          });
      });
      const feeds = await this.feeds();
      for (const f of feeds.filter(
        (f) =>
          !f.paused &&
          f.configured &&
          (!f.checkedAt ||
            Date.parse(f.checkedAt) < now.getTime() - 6 * 3600000)
      )) {
        if (!(await this.workerSettings()).enabled) return;
        await this.command(
          { action: 'check', feedId: f.id },
          'publication-worker'
        );
      }
      for (const f of feeds.filter((f) => f.autoPrepare)) {
        if (!(await this.workerSettings()).enabled) return;
        // Private preparation continues while sending is paused or unconfigured.
        // The persisted claim also bounds concurrent planners/restarts.
        const claim = await this.pool.query(
          `UPDATE publication_feeds SET last_prepared_at=$2 WHERE id=$1 AND (last_prepared_at IS NULL OR last_prepared_at<$2::timestamptz-INTERVAL '5 minutes') RETURNING id`,
          [f.id, now]
        );
        if (claim.rowCount) await this.prepare(f.id, 'publication-worker', now);
      }
      for (let i = 0; i < 5; i++) {
        const row = await transaction(this.pool, async (db) => {
          // Serialize new claims with the global switch across server instances.
          if (!(await this.workerSettings(db, 'FOR SHARE')).enabled)
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
        });
        if (!row) break;
        let sending = false;
        try {
          const media = await transaction(this.pool, async (db) => {
            // Pause is checked again immediately before dispatch. An in-flight provider request cannot be recalled.
            const f = (
              await db.query(
                `SELECT paused FROM publication_feeds WHERE id=$1`,
                [row.feed_id]
              )
            ).rows[0];
            assert(!f.paused, 'FEED_PAUSED');
            return this.ready(db, row);
          });
          if (now.getTime() - row.scheduled_at.getTime() > 86400000)
            throw new PublicationAutomationError('SCHEDULE_EXPIRED');
          assert((await this.workerSettings()).enabled, 'WORKER_DISABLED');
          sending = true;
          const result = await sendDelivery(
            feedConfig(row.feed_id, this.env).config,
            publicDelivery(row),
            media,
            row.provider_media_id,
            async (id) => {
              await this.pool.query(
                'UPDATE publication_deliveries SET provider_media_id=$2 WHERE id=$1',
                [row.id, id]
              );
            }
          );
          // Persist the external result and audit in one transaction. Failure leaves an uncertain job; never resend blindly.
          await transaction(this.pool, async (db) => {
            await db.query(
              `SELECT id FROM publication_deliveries WHERE id=$1 FOR UPDATE`,
              [row.id]
            );
            await this.complete(
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
            await transaction(this.pool, async (db) => {
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
          await transaction(this.pool, async (db) => {
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
              `UPDATE publication_deliveries SET status=$2,error_code=$3,next_attempt_at=NOW()+($4 * INTERVAL '1 minute'),lease_until=NULL,version=version+1,updated_at=NOW() WHERE id=$1 AND status='publishing'`,
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
