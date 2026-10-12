import type {
  PublicationFeedId,
  SponsorshipPublicationFormat
} from '@openg7/funding-core';

import { selectPublicationRecognitionSources } from '../../../../packages/funding-core/src/index.js';
import { withPostgresTransaction } from '../postgres-transaction.js';
import { lockPublicationBatchCapacity } from '../fund-publication-capacity.persistence.js';
import { publicationMembershipFits } from '../fund-publication-rendering.persistence.js';
import {
  publicationSourceUncertainSql,
  retireObsoletePublicationDrafts
} from '../fund-publication-draft-retirement.persistence.js';
import { revokeCommitmentDeliveries } from '../sponsorship-fulfilment.repository.js';

import { canonicalPublicationAccount } from './account-reservations.js';
import {
  audit,
  type DeliveryRow,
  type PublicationPlanningContext
} from './context.js';
import { composeSponsorshipContent } from './content.js';
import { lockPublicationPlanningFeed } from './planning-lock.js';
import {
  PREPARATION_SCAN_LIMIT,
  eligibleDestination,
  preparationCandidates,
  preparationFormatSql,
  preparationModerationSql,
  preparationModerationSubjectSql,
  recognitionSource,
  recordBlockedSource,
  type PreparationSource
} from './preparation-sources.js';
import {
  assert,
  feedConfig,
  PublicationAutomationError,
  recurrenceTimes,
  validateContent
} from './policy.js';
import {
  type Db,
  type Source,
  sourceEqual,
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
  const proposals: { id: string; format: SponsorshipPublicationFormat }[] = [];
  const [target, channel] = feedId.split(':');
  await retireObsoletePublicationDrafts(
    context.pool,
    {
      target: target!,
      channel: channel!
    },
    actor,
    revokeCommitmentDeliveries
  );
  await withPostgresTransaction(context.pool, async (db) => {
    await lockPublicationPlanningFeed(db, feedId);
    let pendingCandidates: PreparationSource[] | null = null;
    await db.query(
      `SELECT id FROM publication_feeds WHERE id=$1 FOR NO KEY UPDATE`,
      [feedId]
    );
    const feed = (await context.feeds(db)).find((f) => f.id === feedId)!;
    assert(feed, 'INVALID_FEED', 400);
    const candidateScope = `c.contribution_type='sponsorship_interest' AND c.status='paid'
      AND c.public_display_consent IS TRUE AND c.sponsor_review_status IN ('pending_review','approved')
      AND NULLIF(btrim(c.sponsor_company_name),'') IS NOT NULL AND c.sponsor_feed_status<>'hidden'`;
    // Lock delivery authority before source contributions, like term adjustments.
    // Creation then uses only this locked set and rereads current terms after a wait.
    await db.query(
      `SELECT delivery.id FROM publication_deliveries delivery WHERE delivery.feed_id=$3
       OR delivery.batch_id IN(SELECT source.batch_id FROM sponsor_publication_drafts source
         JOIN fund_contributions c ON c.id=source.contribution_id
         WHERE ${candidateScope} AND ${eligibleDestination('c', '$1', '$2')})
       ORDER BY delivery.id FOR UPDATE OF delivery`,
      [target, channel, feedId]
    );
    const lockedContributions = await db.query<{ id: string }>(
      `SELECT c.id FROM fund_contributions c WHERE ${candidateScope}
       AND ${eligibleDestination('c', '$1', '$2')} ORDER BY c.id FOR UPDATE OF c`,
      [target, channel]
    );
    // Only confirmed payments and public consent enter private preparation.
    // Sponsor review belongs to the final human decision, never to this worker.
    await db.query(
      `INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,obligation_id,created_at)
        SELECT c.id,$1,$2,CASE WHEN $2='linkedin' THEN 'Un partenaire engagé : ' ELSE 'Merci à ' END || c.sponsor_company_name,COALESCE(NULLIF(btrim(c.sponsor_public_summary),''),'Merci de soutenir le Fonds des Bâtisseurs OpenG7.'),'Commandite rémunérée.',passage.id,
          CASE WHEN passage.ordinal=1 THEN GREATEST(c.created_at,COALESCE(c.paid_at,c.created_at),passage.created_at) ELSE clock_timestamp() END FROM fund_contributions c
        JOIN LATERAL(SELECT o.id,o.ordinal,o.created_at FROM sponsorship_obligations o JOIN sponsorship_commitments a ON a.id=o.commitment_id
          WHERE a.state='active' AND o.contribution_id=c.id AND o.channel=$2 AND o.target=$1 AND o.state IN ('pending','blocked')
          ORDER BY o.ordinal,o.id LIMIT 1) passage ON TRUE
        WHERE ${candidateScope} AND c.id=ANY($3::uuid[])
          AND NOT ${publicationSourceUncertainSql('c.id', '$2')}
          AND NOT EXISTS(SELECT 1 FROM sponsor_publication_drafts existing WHERE existing.contribution_id=c.id AND existing.feed_target=$1 AND existing.channel=$2 AND existing.status NOT IN ('published','cancelled','rejected'))
          AND NOT EXISTS(SELECT 1 FROM sponsor_publication_drafts refusal WHERE refusal.contribution_id=c.id AND refusal.feed_target=$1 AND refusal.channel=$2
            AND refusal.status='rejected' AND (refusal.obligation_id IS NULL OR refusal.obligation_id=passage.id))
        ORDER BY c.created_at,c.id
        ON CONFLICT(obligation_id) WHERE obligation_id IS NOT NULL AND status NOT IN ('published','cancelled','rejected') DO NOTHING`,
      [target, channel, lockedContributions.rows.map((row) => row.id)]
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
      // Match approval's lock order: delivery -> shared slot -> batch -> drafts.
      const job = (
        await db.query<
          DeliveryRow & { preparation_moderation_allowed: boolean }
        >(
          `SELECT *,${preparationModerationSubjectSql('publication_delivery', 'publication_deliveries.id')} AS preparation_moderation_allowed FROM publication_deliveries WHERE batch_id=$1 AND status<>'cancelled' FOR UPDATE`,
          [batch.id]
        )
      ).rows[0];
      if (!(await lockPublicationBatchCapacity(db, batch.id))) continue;
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
            publication_format: SponsorshipPublicationFormat;
          }
        >(
          `SELECT d.*,c.sponsor_company_name AS name,(${preparationModerationSql()}) AS preparation_moderation_allowed,${preparationFormatSql()} AS publication_format FROM sponsor_publication_drafts d JOIN fund_contributions c ON c.id=d.contribution_id WHERE d.batch_id=$1 ORDER BY d.id`,
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
      const format: SponsorshipPublicationFormat =
        job?.publication_format ??
        batch.publication_format ??
        memberFacts[0]?.publication_format ??
        pendingCandidates[0]?.publication_format ??
        'collective_text';
      if (memberFacts.some((member) => member.publication_format !== format))
        continue;
      const participantIds = new Set(
        members.map((member) => member.contribution_id)
      );
      const formatCandidates = pendingCandidates.filter(
        (candidate) =>
          candidate.publication_format === format &&
          !participantIds.has(candidate.contribution_id)
      );
      const selection = selectPublicationRecognitionSources({
        existingSources: members.map(recognitionSource),
        candidates: formatCandidates.map(recognitionSource),
        capacity: format === 'individual_portrait' ? 1 : batch.capacity
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
      const consumed = new Set<string>();
      for (const retained of selection.retained) {
        if (existingIds.has(retained.id)) continue;
        const candidate = byId.get(retained.id)!;
        if (
          !(await publicationMembershipFits(db, {
            batchId: batch.id,
            draftIds: [candidate.id]
          })) ||
          (batch.slot_id &&
            !(await publicationMembershipFits(db, {
              slotId: batch.slot_id,
              draftIds: [candidate.id]
            })))
        ) {
          continue;
        }
        await db.query(
          `UPDATE sponsor_publication_drafts SET batch_id=$2,scheduled_at=$3,updated_at=NOW() WHERE id=$1`,
          [candidate.id, batch.id, date]
        );
        members.push(candidate);
        consumed.add(candidate.id);
      }
      const invalidIds = new Set(
        selection.needsCorrection.map((correction) => correction.source.id)
      );
      pendingCandidates = pendingCandidates.filter(
        (source) => !consumed.has(source.id) && !invalidIds.has(source.id)
      );
      if (!members.length) continue;
      await db.query(
        'UPDATE sponsor_publication_batches SET publication_format=$2 WHERE id=$1',
        [batch.id, format]
      );
      if (job) {
        try {
          const sources = await loadSources(db, batch.id, feedId, true);
          const message = await composeSponsorshipContent(db, feedId, sources);
          validateContent(message, date);
          const c = feedConfig(feedId, context.env);
          if (
            !sourceEqual(sources, job.source_snapshot) ||
            message !== job.message ||
            canonicalPublicationAccount(job).accountId !==
              canonicalPublicationAccount({
                ...job,
                account_id: c.accountId ?? ''
              }).accountId ||
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
      } else proposals.push({ id: batch.id, format });
    }
    await audit(db, actor, 'prepare', feedId, {
      proposedBatches: proposals.length
    });
  });
  for (const proposal of proposals) {
    try {
      await context.command(
        {
          action: 'compose',
          feedId,
          kind: 'sponsorship',
          batchId: proposal.id,
          publicationFormat: proposal.format
        },
        actor,
        true
      );
    } catch (error) {
      if (!(error instanceof PublicationAutomationError)) throw error;
      await audit(context.pool, actor, 'preparation_blocked', proposal.id, {
        code: error.code
      });
    }
  }
}
