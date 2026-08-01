import type {
  SponsorMediaReviewStatus,
  SponsorFeedStatus,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

export type AdminSponsorsListState = 'idle' | 'loading' | 'ready' | 'error';
export type SponsorshipReviewFilter = 'all' | SponsorshipReviewStatus;
export type SponsorFeedStatusFilter = 'all' | SponsorFeedStatus;
export type SponsorPaymentStatusFilter =
  'all' | 'paid' | 'refunded' | 'disputed';
export type SponsorDetailsTab =
  'overview' | 'identity' | 'publication' | 'refund' | 'audit';

export interface AdminSponsorFeedStatusOption {
  readonly value: SponsorFeedStatus;
  readonly label: string;
}

export interface AdminSponsorDetailHeaderView {
  readonly initials: string;
  readonly companyName: string;
  readonly amountLabel: string;
  readonly tierLabel: string;
  readonly reviewStatusClass: string;
  readonly reviewStatusLabel: string;
  readonly visibilityClass: string;
  readonly visibilityLabel: string;
  readonly paymentStatusClass: string;
  readonly paymentStatusLabel: string;
  readonly refundWorkflowStatusClass: string | null;
  readonly refundWorkflowStatusLabel: string | null;
  readonly publicReferenceLabel: string;
  readonly submittedAtLabel: string;
  readonly reviewedAtLabel: string;
}

export interface AdminSponsorDetailOverviewView {
  readonly companyName: string;
  readonly publicNameLabel: string;
  readonly contactName: string;
  readonly contactEmail: string | null;
  readonly websiteUrl: string | null;
  readonly publicReference: string | null;
  readonly copyMessage: string;
  readonly amountLabel: string;
  readonly tierClass: string;
  readonly tierLabel: string;
  readonly benefitsLabel: string;
  readonly paymentStatusClass: string;
  readonly paymentStatusLabel: string;
  readonly refundStatusClass: string;
  readonly refundStatusLabel: string;
  readonly hasRefundWorkflow: boolean;
  readonly refundWorkflowTimelineLabel: string;
  readonly refundId: string | null;
  readonly paidAtLabel: string;
  readonly sponsorMessage: string | null;
  readonly reviewNote: string;
  readonly reviewNoteDirty: boolean;
  readonly reviewNoteStateLabel: string;
  readonly reviewNoteSaving: boolean;
}

export interface AdminSponsorDetailIdentityView {
  readonly companyName: string;
  readonly logoPreviewSource: string | null;
  readonly logoUrl: string | null;
  readonly publicNameLabel: string;
  readonly websiteUrl: string | null;
  readonly logoActionLabel: string;
  readonly uploadDisabled: boolean;
  readonly deleteDisabled: boolean;
  readonly statusMessage: string;
  readonly mediaAssets: readonly AdminSponsorMediaAssetView[];
  readonly mediaMessage: string;
  readonly mediaBusy: boolean;
}

export interface AdminSponsorMediaAssetView {
  readonly id: string;
  readonly version: string;
  readonly kindLabel: string;
  readonly reviewStatus: SponsorMediaReviewStatus;
  readonly reviewStatusLabel: string;
  readonly previewSource: string | null;
  readonly altText: string;
  readonly dimensionsLabel: string;
  readonly sizeLabel: string;
}

export interface AdminSponsorMediaReviewEvent {
  readonly assetId: string;
  readonly expectedVersion: string;
  readonly reviewStatus: Exclude<SponsorMediaReviewStatus, 'pending_review'>;
  readonly altText: string;
}

export interface AdminSponsorMediaDeleteEvent {
  readonly assetId: string;
  readonly expectedVersion: string;
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
