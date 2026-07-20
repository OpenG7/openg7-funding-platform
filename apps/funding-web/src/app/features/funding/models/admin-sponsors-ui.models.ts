import type {
  SponsorFeedStatus,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

export type AdminSponsorsListState = 'idle' | 'loading' | 'ready' | 'error';
export type SponsorshipReviewFilter = 'all' | SponsorshipReviewStatus;
export type SponsorFeedStatusFilter = 'all' | SponsorFeedStatus;
export type SponsorPaymentStatusFilter =
  'all' | 'paid' | 'refunded' | 'disputed';

export interface AdminSponsorFeedStatusOption {
  readonly value: SponsorFeedStatus;
  readonly label: string;
}

export interface AdminSponsorListRow {
  readonly id: string;
  readonly rowStateClass: string;
  readonly processingLabel: string;
  readonly initials: string;
  readonly companyName: string;
  readonly contactEmail: string;
  readonly amountLabel: string;
  readonly tierClass: string;
  readonly tierLabel: string;
  readonly reviewStatusClass: string;
  readonly reviewStatusLabel: string;
  readonly visibilityClass: string;
  readonly visibilityLabel: string;
  readonly feedStatusClass: string;
  readonly feedStatusLabel: string;
  readonly feedTargetLabel: string;
  readonly feedChannelsLabel: string;
  readonly paymentStatusClass: string;
  readonly paymentStatusLabel: string;
  readonly refundWorkflowStatusClass: string | null;
  readonly refundWorkflowStatusLabel: string | null;
  readonly paidAtLabel: string;
  readonly submittedAtLabel: string;
}
