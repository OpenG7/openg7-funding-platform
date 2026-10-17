import type { Pool } from 'pg';

import { listAdminEmailQueue } from '../../email-notification.service.js';
import {
  listAdminPublicationBatches,
  listAdminPublicationDrafts,
  listAdminPublicationSlots
} from '../../fund-admin.repository.js';
import {
  getAdminDashboard,
  listSponsorshipsForAttention
} from '../../fund-contributions.repository.js';

import type { AttentionDataset } from './contracts.js';
import { loadPublicationSlotExecutions } from './publication-execution.js';

async function disputedTotals(
  pool: Pool | null
): Promise<NonNullable<AttentionDataset['disputedTotals']>> {
  if (!pool) return [];
  const result = await pool.query<{ currency: string; amount_minor: string }>(
    `SELECT upper(currency) AS currency,sum(amount_cents)::text AS amount_minor
     FROM fund_contributions WHERE status='disputed' GROUP BY upper(currency) ORDER BY upper(currency)`
  );
  return result.rows.map((row) => {
    const amountMinor = Number(row.amount_minor);
    if (
      !Number.isSafeInteger(amountMinor) ||
      amountMinor < 0 ||
      !/^[A-Z]{3}$/.test(row.currency)
    )
      throw new Error('Invalid disputed payment facts.');
    return { currency: row.currency, amountMinor };
  });
}

export interface AttentionDatasetReaders {
  readonly loadPublicationSlotExecutions?: typeof loadPublicationSlotExecutions;
  readonly listSponsorshipsForAttention: typeof listSponsorshipsForAttention;
  readonly listAdminPublicationDrafts: typeof listAdminPublicationDrafts;
  readonly listAdminPublicationBatches: typeof listAdminPublicationBatches;
  readonly listAdminPublicationSlots: typeof listAdminPublicationSlots;
  readonly listAdminEmailQueue: typeof listAdminEmailQueue;
  readonly getAdminDashboard: typeof getAdminDashboard;
}

/** The complete queue requests uncapped lists; repositories retain their own fallbacks. */
export const createAttentionDatasetLoader =
  (readers: AttentionDatasetReaders) =>
  async (
    pool: Pool | null,
    now: Date = new Date(),
    complete = false,
    includeFinancialSummary = true
  ): Promise<AttentionDataset> => {
    const [
      sponsorships,
      drafts,
      batches,
      slots,
      emailQueue,
      dashboard,
      disputes,
      publicationSlotExecutions
    ] = await Promise.all([
      readers.listSponsorshipsForAttention(pool, complete ? null : undefined),
      readers.listAdminPublicationDrafts(pool, { all: complete }),
      readers.listAdminPublicationBatches(pool, { all: complete }),
      readers.listAdminPublicationSlots(pool, { all: complete }),
      readers.listAdminEmailQueue(pool, { all: complete }),
      includeFinancialSummary ? readers.getAdminDashboard(pool) : null,
      includeFinancialSummary ? undefined : disputedTotals(pool),
      readers.loadPublicationSlotExecutions?.(pool)
    ]);

    return {
      now,
      sponsorships: sponsorships.items,
      sponsorshipsTruncated: sponsorships.truncated,
      drafts: drafts.drafts,
      batches: batches.batches,
      slots: slots.slots,
      ...(publicationSlotExecutions ? { publicationSlotExecutions } : {}),
      emailMessages: emailQueue.messages,
      financialTotals: dashboard
        ? {
            grossPaid: dashboard.totals.total_received,
            refunded: dashboard.totals.total_refunded,
            disputed: dashboard.totals.total_disputed,
            currency: dashboard.totals.currency
          }
        : null,
      ...(disputes ? { disputedTotals: disputes } : {})
    };
  };

export const loadAttentionDataset = createAttentionDatasetLoader({
  loadPublicationSlotExecutions,
  listSponsorshipsForAttention,
  listAdminPublicationDrafts,
  listAdminPublicationBatches,
  listAdminPublicationSlots,
  listAdminEmailQueue,
  getAdminDashboard
});
