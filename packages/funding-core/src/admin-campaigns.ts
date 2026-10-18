import type { AdminPagination } from './admin-pagination.js';
import type { AdminPreparationReceiptData } from './admin-preparation.js';
import type { SponsorshipObligation } from './sponsorship-commitments.js';
import type { SponsorshipFulfilmentEvidence } from './sponsorship-fulfilment.js';
import type { SponsorshipPublicationWorkflowObligation } from './sponsorship-progress.js';

export type AdminCampaignSort = 'preparation' | 'paid_at' | 'due_at';

export interface AdminCampaignsQuery {
  readonly page: number;
  readonly pageSize: 25 | 50 | 100;
  readonly channel?: SponsorshipObligation['channel'];
  readonly target?: SponsorshipObligation['target'];
  readonly state?: SponsorshipPublicationWorkflowObligation['state'];
  readonly search?: string;
  readonly sort: AdminCampaignSort;
  readonly direction: 'asc' | 'desc';
}

/** One recorded promised passage; preparation never grants publication authority. */
export interface AdminCampaignItem {
  readonly id: string;
  readonly contributionId: string;
  readonly reference: string;
  readonly companyName: string | null;
  readonly paidAt: string;
  readonly channel: SponsorshipObligation['channel'];
  readonly target: SponsorshipObligation['target'];
  readonly ordinal: number;
  readonly quantity: number;
  readonly format: NonNullable<SponsorshipObligation['format']> | null;
  readonly obligationState: SponsorshipObligation['state'];
  readonly timing: NonNullable<SponsorshipObligation['timing']> | null;
  readonly preparation: {
    readonly status: AdminPreparationReceiptData['status'];
    readonly version: string;
    readonly approvedAt: string | null;
    readonly blockers: readonly string[];
  };
  readonly workflow: SponsorshipPublicationWorkflowObligation;
  readonly content: {
    readonly title: string;
    readonly body: string;
  } | null;
  /** Only qualified evidence for this exact obligation is exposed as proof. */
  readonly proof: SponsorshipFulfilmentEvidence | null;
  readonly adminUrl: string;
}

export interface AdminCampaignsResponse {
  readonly generatedAt: string;
  readonly items: readonly AdminCampaignItem[];
  readonly pagination: AdminPagination;
}
