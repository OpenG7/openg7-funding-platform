export interface FundingProjectConfig {
  readonly projectId: string;
  readonly projectName: string;
  readonly campaignTitle: string;
  readonly campaignDescription: string;
  readonly currency: 'CAD';
  readonly locale: 'fr-CA' | 'en-CA';
  readonly monthlyGoal: number;
  readonly contributionAmounts: readonly number[];
  readonly guardianAsset: string;
  readonly theme: 'dark-civic-tech';
  readonly transparencyEnabled: boolean;
  readonly publicContributorsEnabled: boolean;
  readonly economicFlowMapEnabled: boolean;
}

export interface FundingTotals {
  readonly confirmedContributions: number;
  readonly transactionFees: number;
  readonly availableFunds: number;
}

export interface FundingAllocation {
  readonly category: string;
  readonly amount: number;
}

export interface ContributorRecord {
  readonly id: string;
  readonly displayName: string;
  readonly amount: number;
  readonly isAnonymous: boolean;
}
