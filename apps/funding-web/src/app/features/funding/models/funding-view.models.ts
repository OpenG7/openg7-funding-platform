import { ContributorRecord, FundingAllocation } from '@openg7/funding-models';

export interface FundingTransparencyView {
  readonly confirmedContributions: number;
  readonly transactionFees: number;
  readonly availableFunds: number;
}

export interface FundingDashboardView {
  readonly allocation: readonly FundingAllocation[];
  readonly contributors: readonly ContributorRecord[];
}
