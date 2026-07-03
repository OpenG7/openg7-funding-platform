import {
  ContributorRecord,
  FundingAllocation,
  FundingTotals
} from '@openg7/funding-models';

export interface CheckoutRequest {
  readonly amount: number;
  readonly currency: 'CAD';
  readonly projectId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface MockCheckoutResult {
  readonly checkoutId: string;
  readonly redirectUrl: string;
  readonly status: 'mocked';
}

export interface RedirectCheckoutResult {
  readonly checkoutId: string;
  readonly redirectUrl: string;
  readonly status: 'redirected';
}

export type CheckoutResult = MockCheckoutResult | RedirectCheckoutResult;

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
  readonly currency: string;
}

export interface PublicFundAllocation {
  readonly project_name: string;
  readonly public_description: string;
  readonly amount_allocated: number;
  readonly currency: string;
  readonly status: string;
  readonly published_at: string | null;
}

export interface FundTransparencyPublicResponse {
  readonly total_received: number;
  readonly total_fees: number;
  readonly total_net: number;
  readonly total_refunded: number;
  readonly total_payouts: number;
  readonly current_available_estimate: number;
  readonly contributions_count: number;
  readonly currency: string;
  readonly monthly_summary: readonly PublicMonthlySummary[];
  readonly latest_public_allocations: readonly PublicFundAllocation[];
  readonly last_updated_at: string;
}

export const createMockCheckoutResult = (
  request: CheckoutRequest
): MockCheckoutResult => ({
  checkoutId: `mock-${request.projectId}-${request.amount}`,
  redirectUrl: 'https://example.org/mock-checkout',
  status: 'mocked'
});
