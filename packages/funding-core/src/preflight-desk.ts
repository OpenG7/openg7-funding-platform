import type { AdminCampaignItem } from './admin-campaigns.js';
import type { AdminPagination } from './admin-pagination.js';

export type PreflightDeskStage =
  'to_prepare' | 'to_review' | 'to_deliver' | 'delivered';
export interface PreflightDeskQuery {
  readonly page: number;
  readonly pageSize: 10 | 20 | 50;
  readonly stage: 'all' | PreflightDeskStage;
  readonly search?: string;
}

/** One recorded promised passage, with Funding's existing proof and workflow. */
export interface PreflightDeskService extends AdminCampaignItem {
  readonly stage: PreflightDeskStage;
  readonly blocked: boolean;
  readonly blockers: readonly string[];
  readonly preparationOrigin: 'funding';
  readonly preflightLink: 'unverified';
  readonly reviewUrl: string;
}

/** A commercial group is the existing Funding contribution, not a new order entity. */
export interface PreflightDeskOrder {
  readonly contributionId: string;
  readonly reference: string;
  readonly companyName: string | null;
  readonly amountMinor: string;
  readonly currency: string;
  readonly commitmentId: string;
  readonly commitmentVersion: number;
  readonly paidAt: string;
  readonly services: readonly PreflightDeskService[];
  readonly delivered: number;
  readonly total: number;
  readonly adminUrl: string;
}

export interface PreflightDeskResponse {
  readonly generatedAt: string;
  /** Search defines this universe; stage filters only the displayed groups. */
  readonly summary: {
    readonly total: number;
    readonly toPrepare: number;
    readonly toReview: number;
    readonly toDeliver: number;
    readonly delivered: number;
    readonly excludedAdjusted: number;
    readonly orders: number;
    readonly scope: 'recorded_promised_services';
    readonly preflightLink: 'unverified';
  };
  /** A matching group includes all its active services, even with a stage filter. */
  readonly orders: readonly PreflightDeskOrder[];
  readonly pagination: AdminPagination;
}
