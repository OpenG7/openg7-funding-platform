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

/** Everything the pure detectors need, already loaded from the repositories. */
export interface AttentionDataset {
  readonly now: Date;
  readonly sponsorships: readonly SponsorshipAttentionRecord[];
  readonly sponsorshipsTruncated: boolean;
  readonly drafts: readonly AdminPublicationDraftRecord[];
  readonly batches: readonly AdminPublicationBatchRecord[];
  readonly slots: readonly AdminPublicationSlotRecord[];
  readonly emailMessages: readonly AdminEmailQueueMessageRecord[];
  readonly financialTotals: FinancialTotalsInput;
}

export interface BuildAdminAssistantSummaryOptions {
  readonly now?: Date;
  readonly maxAttentionItems?: number;
}
