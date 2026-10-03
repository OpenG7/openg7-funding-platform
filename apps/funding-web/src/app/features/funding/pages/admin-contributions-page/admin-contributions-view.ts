import type { ContributionType } from '@openg7/funding-core';

export type ContributionTypeFilter = 'all' | ContributionType;
export type PublicDisplayFilter = 'all' | 'public' | 'private';

/** Labels prepared by the page; local presentation components have no session or HTTP state. */
export interface ContributionRowView {
  readonly id: string;
  readonly reference: string | null;
  readonly name: string;
  readonly typeLabel: string;
  readonly emailLabel: string;
  readonly paymentStatus: string;
  readonly publicDisplayLabel: string;
  readonly sponsorStatusLabel: string;
  readonly amountLabel: string;
  readonly dateLabel: string;
}
