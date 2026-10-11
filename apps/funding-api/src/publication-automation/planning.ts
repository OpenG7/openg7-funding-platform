import type { ProgrammeIssue, PublicationFeedId } from '@openg7/funding-core';

import { selectPublicationRecognitionSources } from '../../../../packages/funding-core/src/index.js';
import { withPostgresTransaction } from '../postgres-transaction.js';

import {
  audit,
  type DeliveryRow,
  type PublicationPlanningContext
} from './context.js';
import { composeSponsorshipContent } from './content.js';
import { mediaRecord, mediaSnapshotIssue } from './media.js';
import {
  PREPARATION_SCAN_LIMIT,
  preparationCandidates,
  preparationModerationSql,
  preparationModerationSubjectSql,
  recognitionSource,
  recordBlockedSource,
  type PreparationSource
} from './preparation-sources.js';
import {
  assert,
  digest,
  feedConfig,
  PublicationAutomationError,
  recurrenceTimes,
  validateContent
} from './policy.js';
import {
  type Db,
  type Source,
  eligibleDestination,
  sourceEqual,
  sourceIssues,
  repairSources,
  sources as loadSources
} from './sources.js';

async function blockPreparationProposal(
  db: Db,
  id: string,
  code: string,
  actor: string
): Promise<void> {
  await db.query(
    `UPDATE publication_deliveries SET status='blocked',error_code=$2,version=version+1,updated_at=NOW() WHERE id=$1`,
    [id, code]
  );
  await audit(db, actor, 'blocked', id, { code });
}

export async function prepare(
  context: PublicationPlanningContext,
  feedId: PublicationFeedId,
  actor: string,
  now = new Date()
): Promise<void> {
  const proposals: string[] = [];
  await withPostgresTransaction(context.pool, async (db) => {
    let pendingCandidates: PreparationSource[] | null = null;
    await db.query(
      `SELECT id FROM publication_feeds WHERE id=$1 FOR NO KEY UPDATE`,
      [feedId]
    );
    const feed = (await context.feeds(db)).find((f) => f.id === feedId)!;
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
        await db.query<
          DeliveryRow & { preparation_moderation_allowed: boolean }
        >(
          `SELECT *,${preparationModerationSubjectSql('publication_delivery', 'publication_deliveries.id')} AS preparation_moderation_allowed FROM publication_deliveries WHERE batch_id=$1 AND status<>'cancelled' FOR UPDATE`,
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
      if (job) {
        // A stale editorial decision cannot suppress existing financial guards.
        try {
          await loadSources(db, batch.id, feedId, true);
        } catch (error) {
          if (!(error instanceof PublicationAutomationError)) throw error;
          await blockPreparationProposal(db, job.id, error.code, actor);
          continue;
        }
        if (!job.preparation_moderation_allowed) continue;
      }
      const memberFacts = (
        await db.query<
          Source & {
            name: string | null;
            preparation_moderation_allowed: boolean;
          }
        >(
          `SELECT d.*,c.sponsor_company_name AS name,(${preparationModerationSql()}) AS preparation_moderation_allowed FROM sponsor_publication_drafts d JOIN fund_contributions c ON c.id=d.contribution_id WHERE d.batch_id=$1 ORDER BY d.id`,
          [batch.id]
        )
      ).rows;
      // Existing membership and dates survive a hold or an obsolete decision.
      if (memberFacts.some((member) => !member.preparation_moderation_allowed))
        continue;
      const members: (Source & { name: string | null })[] = memberFacts;
      // Scan once per preparation. Deferred valid sources keep their FIFO order
      // in memory for the following recurrence; they do not consume a second scan.
      pendingCandidates ??= await preparationCandidates(
        db,
        target!,
        channel!,
        PREPARATION_SCAN_LIMIT
      );
      const selection = selectPublicationRecognitionSources({
        existingSources: members.map(recognitionSource),
        candidates: pendingCandidates.map(recognitionSource),
        capacity: batch.capacity
      });
      const byId: Map<string, PreparationSource> = new Map(
        pendingCandidates.map((source) => [source.id, source])
      );
      for (const correction of selection.needsCorrection) {
        await recordBlockedSource(
          db,
          actor,
          byId.get(correction.source.id)!,
          correction.codeUnits,
          correction.reason
        );
      }
      const existingIds = new Set(members.map((member) => member.id));
      for (const retained of selection.retained) {
        if (existingIds.has(retained.id)) continue;
        const candidate = byId.get(retained.id)!;
        await db.query(
          `UPDATE sponsor_publication_drafts SET batch_id=$2,scheduled_at=$3,updated_at=NOW() WHERE id=$1`,
          [candidate.id, batch.id, date]
        );
        members.push(candidate);
      }
      pendingCandidates = selection.deferred.map((source): PreparationSource =>
        byId.get(source.id)!
      );
      if (!members.length) continue;
      if (job) {
        try {
          const sources = await loadSources(db, batch.id, feedId, true);
          const message = await composeSponsorshipContent(db, feedId, sources);
          validateContent(message, date);
          const c = feedConfig(feedId, context.env);
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
          await blockPreparationProposal(db, job.id, error.code, actor);
        }
      } else proposals.push(batch.id);
    }
    await audit(db, actor, 'prepare', feedId, {
      proposedBatches: proposals.length
    });
  });
  for (const batchId of proposals) {
    try {
      await context.command(
        { action: 'compose', feedId, kind: 'sponsorship', batchId },
        actor,
        true
      );
    } catch (error) {
      if (!(error instanceof PublicationAutomationError)) throw error;
      await audit(context.pool, actor, 'preparation_blocked', batchId, {
        code: error.code
      });
    }
  }
}

export async function repairPreview(
  context: PublicationPlanningContext,
  id: string,
  db: Db = context.pool
): Promise<ProgrammeIssue['repair']> {
  const row = (
    await db.query<DeliveryRow>(
      'SELECT * FROM publication_deliveries WHERE id=$1',
      [id]
    )
  ).rows[0];
  if (!row?.batch_id || !['draft', 'approved', 'blocked'].includes(row.status))
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
  const issues = await sourceIssues(db, id);
  if (!issues.excludedSponsorIds.length) return null;
  const candidates = await repairSources(db, row);
  if (!candidates.length) return null;
  const feed = (await context.feeds(db)).find((f) => f.id === row.feed_id)!;
  const scheduledAt =
    row.scheduled_at.getTime() > Date.now()
      ? row.scheduled_at.toISOString()
      : recurrenceTimes(feed, new Date())[0];
  if (!scheduledAt) return null;
  const message = await composeSponsorshipContent(db, row.feed_id, candidates);
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

export async function repair(
  context: PublicationPlanningContext,
  id: string,
  version: string,
  actor: string
): Promise<void> {
  await withPostgresTransaction(context.pool, async (db) => {
    const feed = (
      await db.query('SELECT feed_id FROM publication_deliveries WHERE id=$1', [
        id
      ])
    ).rows[0]?.feed_id;
    assert(feed, 'VERSION_CONFLICT');
    await db.query('SELECT id FROM publication_feeds WHERE id=$1 FOR UPDATE', [
      feed
    ]);
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
    const proposal = await repairPreview(context, id, db);
    assert(proposal && proposal.version === version, 'VERSION_CONFLICT');
    const candidates = await repairSources(db, row);
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
    await context.command(
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

export async function guardEligibility(
  context: PublicationPlanningContext
): Promise<void> {
  await withPostgresTransaction(context.pool, async (db) => {
    const rows = (
      await db.query<DeliveryRow>(
        "SELECT * FROM publication_deliveries WHERE status IN ('draft','approved') AND (batch_id IS NOT NULL OR media_id IS NOT NULL) ORDER BY id FOR UPDATE SKIP LOCKED"
      )
    ).rows;
    for (const row of rows) {
      const issues = await sourceIssues(db, row.id);
      if (issues.codes.length) {
        await db.query(
          "UPDATE publication_deliveries SET status='blocked',approved_at=NULL,approved_by=NULL,error_code=$2,version=version+1,updated_at=NOW() WHERE id=$1",
          [
            row.id,
            issues.codes.length === 1 &&
            issues.codes[0] === 'SPONSOR_REVIEW_REQUIRED'
              ? 'SPONSOR_REVIEW_REQUIRED'
              : 'SOURCE_NOT_ELIGIBLE'
          ]
        );
        await audit(db, 'publication-worker', 'source_invalidated', row.id, {
          codes: issues.codes,
          affected: issues.excludedSponsorIds
        });
        continue;
      }
      // Metadata is cheap to check before the due date. Bytes are still
      // re-read and hashed immediately before dispatch.
      const media = row.media_id
        ? await mediaRecord(db, row.media_id, row.batch_id)
        : null;
      const mediaCode = mediaSnapshotIssue(
        row.media_id,
        row.media_snapshot,
        media
      );
      if (mediaCode) {
        await db.query(
          "UPDATE publication_deliveries SET status='blocked',approved_at=NULL,approved_by=NULL,error_code=$2,version=version+1,updated_at=NOW() WHERE id=$1",
          [row.id, mediaCode]
        );
        await audit(db, 'publication-worker', 'media_invalidated', row.id, {
          code: mediaCode,
          mediaId: row.media_id
        });
        continue;
      }
    }
  });
}
