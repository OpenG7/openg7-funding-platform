export interface AdminStripeBackfillScope {
  readonly from: string;
  readonly to: string;
  readonly limit: number;
}

export interface AdminStripeBackfillCounts {
  readonly scanned: number;
  readonly matched: number;
  readonly payments: number;
  readonly refunds: number;
  readonly disputes: number;
  readonly missingFees: number;
}

export interface AdminStripeBackfillRun {
  readonly id: string;
  readonly status:
    'preview' | 'running' | 'completed' | 'failed' | 'interrupted';
  readonly mode: 'test' | 'live';
  readonly accountId: string;
  readonly projectId: string;
  readonly scope: AdminStripeBackfillScope;
  readonly expiresAt: string;
  readonly counts: AdminStripeBackfillCounts;
}

export type AdminStripeBackfillRequest =
  | { readonly action: 'preview'; readonly scope: AdminStripeBackfillScope }
  | {
      readonly action: 'execute';
      readonly id: string;
      readonly confirmation: string;
    };
