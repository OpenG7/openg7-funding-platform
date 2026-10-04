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

export interface AttentionDatasetReaders {
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
    complete = false
  ): Promise<AttentionDataset> => {
    const [sponsorships, drafts, batches, slots, emailQueue, dashboard] =
      await Promise.all([
        readers.listSponsorshipsForAttention(pool, complete ? null : undefined),
        readers.listAdminPublicationDrafts(pool, { all: complete }),
        readers.listAdminPublicationBatches(pool, { all: complete }),
        readers.listAdminPublicationSlots(pool, { all: complete }),
        readers.listAdminEmailQueue(pool, { all: complete }),
        readers.getAdminDashboard(pool)
      ]);

    return {
      now,
      sponsorships: sponsorships.items,
      sponsorshipsTruncated: sponsorships.truncated,
      drafts: drafts.drafts,
      batches: batches.batches,
      slots: slots.slots,
      emailMessages: emailQueue.messages,
      financialTotals: {
        grossPaid: dashboard.totals.total_received,
        refunded: dashboard.totals.total_refunded,
        disputed: dashboard.totals.total_disputed,
        currency: dashboard.totals.currency
      }
    };
  };

export const loadAttentionDataset = createAttentionDatasetLoader({
  listSponsorshipsForAttention,
  listAdminPublicationDrafts,
  listAdminPublicationBatches,
  listAdminPublicationSlots,
  listAdminEmailQueue,
  getAdminDashboard
});
