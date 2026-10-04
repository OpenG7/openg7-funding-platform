import type {
  ContributorRecord,
  FundingAllocation,
  FundingTotals
} from '@openg7/funding-models';

import type { ContributionType } from './contribution-contracts.js';

export interface FundingSnapshot {
  readonly totals: FundingTotals;
  readonly allocation: readonly FundingAllocation[];
  readonly contributors: readonly ContributorRecord[];
}

export interface PublicMonthlySummary {
  readonly month: string;
  readonly total_received: number;
  readonly total_fees: number;
  readonly total_net: number;
  readonly total_refunded: number;
  readonly total_payouts: number;
  readonly contributions_count: number;
  /** Missing processor fee facts; null/absent means completeness is unknown. */
  readonly pending_fee_count?: number | null;
  readonly currency: string;
}

export interface PublicFundAllocation {
  readonly project_name: string;
  readonly public_description: string;
  readonly expected_outcome: string;
  readonly progress_status: 'planned' | 'in_progress' | 'delivered';
  readonly proof_url: string | null;
  readonly proof_source: string | null;
  readonly proof_published_at: string | null;
  readonly amount_allocated: number;
  readonly currency: string;
  readonly status: string;
  readonly published_at: string | null;
}

export interface PublicBuilderProfile {
  readonly public_id?: string;
  readonly display_name: string;
  readonly contribution_type: ContributionType;
  readonly amount: number | null;
  readonly currency: string;
  readonly paid_at: string | null;
}

export interface PublicBuildersResponse {
  readonly data_source: 'database' | 'empty';
  readonly builders: readonly PublicBuilderProfile[];
  readonly last_updated_at: string;
  readonly pagination: {
    readonly page: number;
    readonly page_size: number;
    /** Public contribution records, not distinct people. */
    readonly total_count: number;
  };
}

export interface PublicFundingRuntimeConfig {
  readonly business_sponsorship_enabled: boolean;
  /** Optional during rolling upgrades; amounts use the existing Checkout major-unit contract. */
  readonly allowed_contribution_amounts?: readonly number[];
  readonly last_updated_at: string;
}

export interface FundTransparencyPublicResponse {
  readonly data_source: 'database' | 'stripe_direct' | 'empty';
  readonly total_received: number;
  readonly total_fees: number;
  readonly total_net: number;
  readonly total_refunded: number;
  readonly total_payouts: number;
  readonly current_available_estimate: number;
  readonly contributions_count: number;
  readonly pending_fee_count?: number | null;
  readonly currency: string;
  readonly monthly_summary: readonly PublicMonthlySummary[];
  readonly latest_public_allocations: readonly PublicFundAllocation[];
  readonly public_builders: readonly PublicBuilderProfile[];
  readonly last_updated_at: string;
  /** Start of this projection read, preserved when serving a cached result. */
  readonly generated_at?: string;
}
