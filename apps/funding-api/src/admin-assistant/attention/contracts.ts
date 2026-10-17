import type {
  AdminEmailQueueMessageRecord,
  AdminPublicationBatchRecord,
  AdminPublicationDraftRecord,
  AdminPublicationSlotRecord
} from '@openg7/funding-core';

import type { SponsorshipAttentionRecord } from '../../fund-contributions.repository.js';

export interface FinancialTotalsInput {
  readonly grossPaid: number;
  readonly refunded: number;
  readonly disputed: number;
  readonly currency: string;
}

/** Minimal execution facts; no source content, account identifier or credentials. */
export interface PublicationSlotExecution {
  readonly slotId: string;
  readonly deliveryId: string;
  readonly status: 'approved' | 'publishing' | 'uncertain';
}

/** Everything the pure detectors need, already loaded from the repositories. */
export interface AttentionDataset {
  readonly now: Date;
  readonly sponsorships: readonly SponsorshipAttentionRecord[];
  readonly sponsorshipsTruncated: boolean;
  readonly drafts: readonly AdminPublicationDraftRecord[];
  readonly batches: readonly AdminPublicationBatchRecord[];
  readonly slots: readonly AdminPublicationSlotRecord[];
  readonly publicationSlotExecutions?: readonly PublicationSlotExecution[];
  readonly emailMessages: readonly AdminEmailQueueMessageRecord[];
  /** Operational queues do not require a scalar monetary summary. */
  readonly financialTotals: FinancialTotalsInput | null;
  readonly disputedTotals?: readonly {
    readonly amountMinor: number;
    readonly currency: string;
  }[];
}

export interface BuildAdminAssistantSummaryOptions {
  readonly now?: Date;
  readonly maxAttentionItems?: number;
}
