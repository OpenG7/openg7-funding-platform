import {
  ContributorRecord,
  FundingAllocation,
  FundingTotals
} from '@openg7/funding-models';

export interface CheckoutRequest {
  readonly amount: number;
  readonly currency: 'CAD';
  readonly projectId: string;
}

export interface CheckoutResult {
  readonly checkoutId: string;
  readonly redirectUrl: string;
  readonly status: 'mocked';
}

export interface FundingSnapshot {
  readonly totals: FundingTotals;
  readonly allocation: readonly FundingAllocation[];
  readonly contributors: readonly ContributorRecord[];
}

export const createMockCheckoutResult = (
  request: CheckoutRequest
): CheckoutResult => ({
  checkoutId: `mock-${request.projectId}-${request.amount}`,
  redirectUrl: 'https://example.org/mock-checkout',
  status: 'mocked'
});
