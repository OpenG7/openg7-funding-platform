import type {
  PublicationFeed,
  PublicationPreparationEntry,
  PublicationPreparationOpportunity,
  PublicationRecognitionSource
} from '@openg7/funding-core';

import {
  publicationFormatCapability,
  selectPublicationRecognitionSources
} from '../../../../packages/funding-core/src/index.js';

import {
  preparationCalendar,
  type PreparationCalendarBatch
} from './preparation-calendar.js';
import { recurrenceTimes } from './policy.js';
import type { Db } from './sources.js';

export const PREPARATION_OPPORTUNITY_SEARCH_DAYS = 366;
export type PreparationOpportunityPlanner = Awaited<
  ReturnType<typeof createPreparationOpportunityPlanner>
>;
type OpportunityFacts = Pick<
  PublicationPreparationEntry,
  'feedId' | 'status' | 'reason' | 'publicationFormat'
> &
  Partial<
    Pick<PublicationPreparationEntry, 'deliveryId' | 'batchId' | 'scheduledAt'>
  >;

/** One read-only global snapshot. Projections are independent possibilities, not FIFO assignments. */
export async function createPreparationOpportunityPlanner(
  db: Db,
  feeds: readonly PublicationFeed[],
  now: Date
) {
  const until = new Date(
    now.getTime() + PREPARATION_OPPORTUNITY_SEARCH_DAYS * 86400000
  );
  const calendar = await preparationCalendar(db, feeds, now, until);
  const dates = new Map(
    feeds.map((feed) => [
      feed.id,
      {
        current: new Set(recurrenceTimes(feed, now)),
        future: recurrenceTimes(
          { ...feed, horizonDays: PREPARATION_OPPORTUNITY_SEARCH_DAYS },
          now
        )
      }
    ])
  );
  const batchDates = new Map<string, PreparationCalendarBatch[]>();
  for (const batch of calendar.batches) {
    const key = `${batch.feed_id}:${batch.starts_at.toISOString()}`;
    const members = batchDates.get(key) ?? [];
    members.push(batch);
    batchDates.set(key, members);
  }
  const openings = new Map(
    feeds.map((feed) => [
      feed.id,
      dates.get(feed.id)!.future.flatMap((date) => {
        const batches = batchDates.get(`${feed.id}:${date}`);
        return (batches?.length ? batches : [null])
          .filter(
            (batch) =>
              (!batch || batch.mutable) &&
              calendar.compatible(feed, date, batch?.batch_id ?? null)
          )
          .map((batch) => ({ date, batch }));
      })
    ])
  );
  const result = (
    reason: PublicationPreparationOpportunity['reason'],
    action: PublicationPreparationOpportunity['action'],
    proposedAt: string | null = null,
    withinHorizon = false
  ): PublicationPreparationOpportunity => ({
    reason,
    action,
    proposedAt,
    withinHorizon,
    evaluatedAt: now.toISOString(),
    searchUntil: until.toISOString()
  });
  return {
    project(
      entry: OpportunityFacts,
      source: PublicationRecognitionSource
    ): PublicationPreparationOpportunity {
      if (entry.reason === 'MODERATION_REVIEW_REQUIRED')
        return result('MODERATION_REVIEW_REQUIRED', 'REVIEW_MODERATION');
      if (entry.status === 'needs_correction')
        return result('SOURCE_CORRECTION_REQUIRED', 'CORRECT_SOURCE');
      if (entry.reason === 'MANUAL_RESERVATION')
        return result('MANUAL_RESERVATION', 'REVIEW_CALENDAR');
      if (
        entry.reason === 'EXISTING_BATCH_INVALID' ||
        entry.reason === 'PREPARATION_FAILED'
      )
        return result('PROPOSAL_REPAIR_REQUIRED', 'REPAIR_PROPOSAL');
      const feed = feeds.find((candidate) => candidate.id === entry.feedId);
      if (
        !feed ||
        !feed.configured ||
        !feed.accountId ||
        feed.mode === 'disabled' ||
        feed.connection === 'expired' ||
        feed.connection === 'error'
      )
        return result('ACCOUNT_CONNECTION_REQUIRED', 'CONFIGURE_ACCOUNT');
      if (calendar.unresolved(feed))
        return result('ACCOUNT_RECONCILIATION_REQUIRED', 'RECONCILE_ACCOUNT');
      if (entry.deliveryId || entry.batchId) {
        if (
          entry.scheduledAt &&
          Date.parse(entry.scheduledAt) > until.getTime()
        )
          return result('EXISTING_DATE_OUTSIDE_SEARCH', 'REVIEW_CALENDAR');
        if (
          entry.scheduledAt &&
          Date.parse(entry.scheduledAt) > now.getTime() &&
          calendar.compatible(
            feed,
            entry.scheduledAt,
            entry.batchId,
            entry.deliveryId
          )
        )
          return result(
            'EXISTING_PROPOSAL',
            'REVIEW_PROPOSAL',
            entry.scheduledAt,
            dates.get(feed.id)!.current.has(entry.scheduledAt)
          );
        return result('PROPOSAL_REPAIR_REQUIRED', 'REPAIR_PROPOSAL');
      }
      if (feed.paused) return result('FEED_PAUSED', 'REVIEW_FEED');
      const format = entry.publicationFormat ?? 'collective_text';
      const capability = publicationFormatCapability(
        feed.id.split(':')[1]!,
        format
      );
      if (!capability.available)
        return result('FORMAT_UNAVAILABLE', 'REVIEW_FORMAT');
      if (capability.multiImage && feed.capacity < 2)
        return result('CAPACITY_INSUFFICIENT', 'REVIEW_CALENDAR');
      const individual = selectPublicationRecognitionSources({
        existingSources: [],
        candidates: [source],
        capacity: 1
      });
      if (individual.needsCorrection.length)
        return result('SOURCE_CORRECTION_REQUIRED', 'CORRECT_SOURCE');
      for (const { date, batch } of openings.get(feed.id)!) {
        if (batch?.publication_format && batch.publication_format !== format)
          continue;
        const selection = selectPublicationRecognitionSources({
          existingSources: batch?.sources ?? [],
          candidates: [source],
          capacity: capability.requiresSingleSponsor
            ? 1
            : (batch?.capacity ?? feed.capacity)
        });
        if (
          selection.existingIssue ||
          !selection.retained.some((s) => s.id === source.id) ||
          (capability.multiImage && selection.retained.length < 2)
        )
          continue;
        const withinHorizon = dates.get(feed.id)!.current.has(date);
        return result(
          withinHorizon ? 'AVAILABLE_IN_HORIZON' : 'AVAILABLE_AFTER_HORIZON',
          withinHorizon ? 'PREPARE_FEED' : 'REVIEW_HORIZON',
          date,
          withinHorizon
        );
      }
      // A solitary collection source is not a sendable proposal; preparation may
      // pair it with another compatible source, but this projection reserves none.
      return capability.multiImage
        ? result('GROUP_PARTICIPANTS_REQUIRED', 'WAIT_FOR_GROUP')
        : result('NO_COMPATIBLE_RECURRENCE', 'REVIEW_CALENDAR');
    }
  };
}
