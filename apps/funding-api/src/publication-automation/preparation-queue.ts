import type {
  PublicationAutomationFilter,
  PublicationDeliveryStatus,
  PublicationFeed,
  PublicationFeedId,
  PublicationPreparationEntry,
  PublicationPreparationQueue,
  PublicationRecognitionSource
} from '@openg7/funding-core';

import {
  composePublicationRecognition,
  isValidPublicationMessage,
  missingPublicationRecognitionSources,
  PUBLICATION_MESSAGE_MAX_CODE_UNITS,
  selectPublicationRecognitionSources
} from '../../../../packages/funding-core/src/index.js';

import { recurrenceTimes } from './policy.js';
import {
  eligibleDestination,
  preparationEligibilitySql,
  recognitionSource
} from './preparation-sources.js';
import type { Db, Source } from './sources.js';

export const PREPARATION_QUEUE_PAGE_SIZE = 200;

interface QueueRow extends Source {
  name: string;
  created_at: Date;
  created_at_key: string;
  scheduled_at: Date | null;
  batch_id: string | null;
  slot_id: string | null;
  status: string;
  delivery_id: string | null;
  delivery_status: PublicationDeliveryStatus | null;
  delivery_message: string | null;
  batch_capacity: number | null;
  batch_sources: PublicationRecognitionSource[];
  batch_all_eligible: boolean;
  preparation_failed: boolean;
  prepared_current: boolean;
}

interface AvailableBatch {
  feed_id: PublicationFeedId;
  starts_at: Date;
  capacity: number;
  sources: PublicationRecognitionSource[];
}

const batchSourcesSql = (batch: string) =>
  `COALESCE((SELECT jsonb_agg(jsonb_build_object('id',member.id,'contributionId',member.contribution_id,'name',COALESCE(identity.sponsor_company_name,''),'title',member.title,'body',member.body,'disclosureText',member.disclosure_text) ORDER BY member.id)
    FROM sponsor_publication_drafts member JOIN fund_contributions identity ON identity.id=member.contribution_id
    WHERE member.batch_id=${batch}),'[]'::jsonb)`;

const batchEligibilitySql = (batch: string, target: string, channel: string) =>
  `NOT EXISTS(SELECT 1 FROM sponsor_publication_drafts member
    JOIN fund_contributions identity ON identity.id=member.contribution_id
    WHERE member.batch_id=${batch} AND (${preparationEligibilitySql('member', 'identity', target, channel)}) IS NOT TRUE)`;

/** Classify current facts only. This does not prepare, authorize or record audit. */
function queueEntry(
  row: QueueRow,
  available: readonly AvailableBatch[]
): PublicationPreparationEntry {
  const source = recognitionSource(row);
  const message = composePublicationRecognition([source]);
  let status: PublicationPreparationEntry['status'] = 'deferred';
  let reason: PublicationPreparationEntry['reason'] = 'AWAITING_PREPARATION';
  if (message.length > PUBLICATION_MESSAGE_MAX_CODE_UNITS) {
    status = 'needs_correction';
    reason = 'INDIVIDUAL_TEXT_TOO_LONG';
  } else if (missingPublicationRecognitionSources(message, [source]).length) {
    status = 'needs_correction';
    reason = 'INVALID_SOURCE_CONTENT';
  } else if (row.delivery_id) {
    if (
      !isValidPublicationMessage(row.delivery_message) ||
      !row.batch_all_eligible ||
      row.batch_sources.length > (row.batch_capacity ?? 0) ||
      missingPublicationRecognitionSources(
        row.delivery_message!,
        row.batch_sources
      ).length
    ) {
      reason = 'EXISTING_BATCH_INVALID';
    } else if (row.delivery_status === 'draft') {
      status = 'retained';
      reason = 'AWAITING_APPROVAL';
    } else reason = 'PREPARATION_FAILED';
  } else if (row.batch_id) {
    reason = row.preparation_failed
      ? 'PREPARATION_FAILED'
      : 'AWAITING_PREPARATION';
  } else if (row.slot_id || (row.status === 'scheduled' && row.scheduled_at))
    reason = 'MANUAL_RESERVATION';
  else if (
    row.prepared_current &&
    !available.some((batch) => {
      if (batch.feed_id !== `${row.feed_target}:${row.channel}`) return false;
      const selection = selectPublicationRecognitionSources({
        existingSources: batch.sources,
        candidates: [source],
        capacity: batch.capacity
      });
      return selection.retained.some((retained) => retained.id === row.id);
    })
  )
    reason = 'NO_SLOT_IN_HORIZON';
  return {
    draftId: row.id,
    sponsorshipId: row.contribution_id,
    name: row.name,
    feedId: `${row.feed_target}:${row.channel}` as PublicationFeedId,
    status,
    reason,
    renderedLength: message.length,
    budget: PUBLICATION_MESSAGE_MAX_CODE_UNITS,
    createdAt: row.created_at.toISOString(),
    scheduledAt: row.scheduled_at?.toISOString() ?? null,
    batchId: row.batch_id,
    deliveryId: row.delivery_id,
    deliveryStatus: row.delivery_status
  };
}

/**
 * Scan the confirmed scope in bounded chunks to count pure rendering outcomes.
 * Only the requested page is retained in memory. The caller supplies one read-only
 * repeatable-read transaction; separate page requests are current, unfrozen facts.
 */
export async function preparationQueue(
  db: Db,
  feeds: readonly PublicationFeed[],
  filter: PublicationAutomationFilter,
  now = new Date()
): Promise<PublicationPreparationQueue> {
  const dates = new Map(
    feeds.map((feed) => [feed.id, new Set(recurrenceTimes(feed, now))])
  );
  const available = (
    await db.query<AvailableBatch>(
      `SELECT r.feed_id,r.starts_at,b.capacity,${batchSourcesSql('b.id')} AS sources
       FROM publication_recurrences r JOIN sponsor_publication_batches b ON b.id=r.batch_id
       LEFT JOIN publication_deliveries delivery ON delivery.batch_id=b.id AND delivery.status<>'cancelled'
       WHERE b.status='open' AND r.starts_at>$1 AND r.starts_at<=$1+interval '29 days'
         AND (delivery.id IS NULL OR (delivery.status='draft' AND delivery.auto_managed))
         AND ${batchEligibilitySql('b.id', "split_part(r.feed_id,':',1)", "split_part(r.feed_id,':',2)")}`,
      [now]
    )
  ).rows.filter((batch) =>
    dates.get(batch.feed_id)?.has(batch.starts_at.toISOString())
  );
  const offset = filter.queueOffset ?? 0;
  const result: PublicationPreparationQueue = {
    entries: [],
    summary: { retained: 0, deferred: 0, needsCorrection: 0 },
    total: 0,
    offset,
    limit: PREPARATION_QUEUE_PAGE_SIZE,
    hasMore: false,
    scope: filter.sponsorshipId || filter.deliveryId ? 'filtered' : 'global',
    evaluatedAt: now.toISOString()
  };
  let cursor: { createdAt: string; id: string } | null = null;
  for (;;) {
    const rows: QueueRow[] = (
      await db.query<QueueRow>(
        `SELECT d.id,d.contribution_id,d.title,d.body,d.disclosure_text,d.feed_target,d.channel,
           COALESCE(c.sponsor_company_name,'') AS name,d.created_at,d.created_at::text AS created_at_key,d.scheduled_at,d.batch_id,d.slot_id,d.status,
           delivery.id AS delivery_id,delivery.status AS delivery_status,delivery.message AS delivery_message,
           b.capacity AS batch_capacity,${batchSourcesSql('d.batch_id')} AS batch_sources,
           ${batchEligibilitySql('d.batch_id', 'd.feed_target', 'd.channel')} AS batch_all_eligible,
           EXISTS(SELECT 1 FROM admin_audit_log failed WHERE failed.action='publication_automation.preparation_blocked' AND failed.entity_id=d.batch_id::text AND failed.created_at>=b.updated_at) AS preparation_failed,
           EXISTS(SELECT 1 FROM admin_audit_log prepared WHERE prepared.action='publication_automation.prepare' AND prepared.entity_id=d.feed_target||':'||d.channel AND prepared.created_at>=greatest(d.updated_at,c.updated_at,feed.updated_at)) AS prepared_current
         FROM sponsor_publication_drafts d JOIN fund_contributions c ON c.id=d.contribution_id
         JOIN publication_feeds feed ON feed.id=d.feed_target||':'||d.channel
         LEFT JOIN sponsor_publication_batches b ON b.id=d.batch_id
         LEFT JOIN publication_deliveries delivery ON delivery.batch_id=d.batch_id AND delivery.status<>'cancelled'
         WHERE d.status IN ('draft','approved','scheduled') AND c.status='paid' AND c.public_display_consent IS TRUE
           AND c.sponsor_review_status IN ('pending_review','approved') AND c.sponsor_feed_status NOT IN ('hidden','published')
           AND ${eligibleDestination('c', 'd.feed_target', 'd.channel')}
           AND (d.batch_id IS NULL OR b.status IN ('open','scheduled'))
           AND (delivery.id IS NULL OR delivery.status IN ('draft','blocked'))
           AND ($1::uuid IS NULL OR d.contribution_id=$1)
           AND ($2::uuid IS NULL OR delivery.id=$2)
           AND ($3::timestamptz IS NULL OR (d.created_at,d.id)>($3::timestamptz,$4::uuid))
         ORDER BY d.created_at,d.id LIMIT $5`,
        [
          filter.sponsorshipId ?? null,
          filter.deliveryId ?? null,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          PREPARATION_QUEUE_PAGE_SIZE
        ]
      )
    ).rows;
    for (const row of rows) {
      const entry = queueEntry(row, available);
      if (entry.status === 'needs_correction') result.summary.needsCorrection++;
      else result.summary[entry.status]++;
      if (
        result.total >= offset &&
        result.entries.length < PREPARATION_QUEUE_PAGE_SIZE
      )
        result.entries.push(entry);
      result.total++;
    }
    if (rows.length < PREPARATION_QUEUE_PAGE_SIZE) break;
    const last = rows.at(-1)!;
    cursor = { createdAt: last.created_at_key, id: last.id };
  }
  result.hasMore = offset + result.entries.length < result.total;
  return result;
}
