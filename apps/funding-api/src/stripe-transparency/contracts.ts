export interface StripeTransparencyOptions {
  readonly projectId: string;
}

export interface StripeContribution {
  readonly amount: number;
  readonly fee: number;
  readonly feePending: boolean;
  readonly net: number;
  readonly refunded: number;
  readonly currency: string;
  readonly created: number;
}

export interface StripePayoutRecord {
  readonly amount: number;
  readonly currency: string;
  readonly created: number;
}

export type StripeTransparencyFact =
  | { readonly kind: 'contribution'; readonly contribution: StripeContribution }
  | { readonly kind: 'payout'; readonly payout: StripePayoutRecord };
