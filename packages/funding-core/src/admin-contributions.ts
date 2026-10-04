import type { ContributionType } from './contribution-contracts.js';
import type { SponsorFeedStatus } from './publication-contracts.js';
import type { SponsorshipReviewStatus } from './sponsorship-contracts.js';

export interface AdminContributionRecord {
  readonly id: string;
  readonly public_reference: string | null;
  readonly contribution_type: ContributionType;
  readonly amount: number;
  readonly currency: string;
  readonly payment_status: string;
  readonly paid_at: string | null;
  readonly public_name: string | null;
  readonly email_private: string | null;
  readonly public_display_consent: boolean;
  readonly display_amount_consent: boolean;
  readonly non_charity_acknowledged: boolean;
  readonly sponsor_company_name: string | null;
  readonly sponsor_contact_name: string | null;
  readonly sponsor_contact_email: string | null;
  readonly sponsor_review_status: SponsorshipReviewStatus | null;
  readonly sponsor_feed_status: SponsorFeedStatus | null;
  readonly stripe_session_id: string | null;
  readonly stripe_payment_intent_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AdminContributionsSummary {
  readonly total_count: number;
  readonly paid_count: number;
  readonly pending_count: number;
  readonly sponsorship_count: number;
  readonly public_display_count: number;
  readonly total_received: number;
  readonly total_refunded: number;
  readonly total_disputed: number;
  readonly currency: string;
}

export interface AdminContributionsResponse {
  readonly data_source: 'database';
  readonly summary: AdminContributionsSummary;
  readonly contributions: readonly AdminContributionRecord[];
  readonly last_updated_at: string;
}

/** Private export of the displayed selection, at most 250 distinct records. */
export interface AdminContributionsExportRequest {
  readonly confirmation: 'export_private_contributions';
  readonly contributions: readonly {
    readonly id: string;
    readonly expectedVersion: string;
  }[];
}

export interface AdminDashboardResponse {
  readonly data_source: 'database';
  /** False when PostgreSQL is not configured. Optional for older API versions. */
  readonly data_available?: boolean;
  readonly totals: {
    readonly total_received: number;
    readonly total_refunded: number;
    readonly total_disputed: number;
    readonly current_available_estimate: number;
    readonly currency: string;
    readonly contributions_count: number;
    readonly paid_contributions_count: number;
  };
  readonly sponsorship_review: {
    readonly total: number;
    readonly pending: number;
    readonly approved: number;
    readonly rejected: number;
  };
  readonly feed_publication: {
    readonly planned: number;
    readonly drafted: number;
    readonly published: number;
    readonly active: number;
  };
  readonly stripe_events: {
    readonly failed: number;
    readonly processing: number;
    readonly last_failed_at: string | null;
  };
  readonly recent_contributions: readonly AdminContributionRecord[];
  readonly last_updated_at: string;
}
