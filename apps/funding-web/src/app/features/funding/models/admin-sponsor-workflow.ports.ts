import type {
  AdminSponsorshipRecord,
  AdminSponsorshipProgress,
  AdminSponsorshipRejectionRefundHandling,
  AdminSponsorshipRefundWorkflowStatus,
  AdminSponsorshipStripeRefundReason,
  SponsorMediaAsset,
  SponsorMediaReviewStatus,
  SponsorFeedChannel,
  SponsorFeedStatus,
  SponsorFeedTarget,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

import type { FundingAdminService } from '../services/funding-admin.service.js';

export interface AdminSponsorTranslation {
  t(key: string, params?: Record<string, unknown>): string;
}

/** Page-owned authorization, action lock, refresh and central error handling. */
export interface AdminSponsorActionPorts extends AdminSponsorTranslation {
  adminToken(): string;
  canActOn(sponsorship: AdminSponsorshipRecord): boolean;
  actionPending(): boolean;
  setActionState(action: string | null): void;
  reloadSponsorships(): Promise<void>;
  messageFromError(error: unknown, fallback: string): string;
}

/** Selection/lifetime checks remain page-owned, including leave-and-return races. */
export interface AdminSponsorSelectionPorts extends AdminSponsorActionPorts {
  selectionRevision(): number;
  isCurrentSelection(id: string): boolean;
}

export interface AdminSponsorReviewPorts extends AdminSponsorSelectionPorts {
  admin: Pick<FundingAdminService, 'reviewSponsorship'>;
  confirm(message: string, detail?: string): Promise<boolean>;
  canManage(): boolean;
  paymentEligibilityMessage(sponsorship: AdminSponsorshipRecord): string;
  openRejectionPanel(sponsorship: AdminSponsorshipRecord): void;
  beginApprovalFeedback(id: string | null): SponsorshipApprovalFeedback | null;
  finishApprovalFeedback(
    attempt: SponsorshipApprovalFeedback,
    phase: 'success' | 'error'
  ): void;
  pulseSelection(id: string): void;
  refundWorkflowStatusLabel(
    status: AdminSponsorshipRefundWorkflowStatus
  ): string;
}

export interface AdminSponsorPublicationPorts extends AdminSponsorSelectionPorts {
  admin: Pick<
    FundingAdminService,
    'updateSponsorshipPublication' | 'setSponsorshipWebsiteVisibility'
  >;
  confirm(message: string, detail?: string): Promise<boolean>;
  sponsorships(): readonly AdminSponsorshipRecord[];
  progress(): AdminSponsorshipProgress | null;
  paymentEligibilityMessage(sponsorship: AdminSponsorshipRecord): string;
}

export interface SponsorshipApprovalFeedback {
  readonly id: string;
  readonly phase: 'pending' | 'success' | 'error';
}

export interface SponsorRejectionDraft {
  readonly notifySponsor: boolean;
  readonly recipientEmail: string;
  readonly sponsorMessage: string;
  readonly refundHandling: AdminSponsorshipRejectionRefundHandling;
  readonly refundNote: string;
}

export interface SponsorshipPublicationDraft {
  readonly publicSlug: string;
  readonly publicSummary: string;
  readonly feedTarget: '' | SponsorFeedTarget;
  readonly facebook: boolean;
  readonly linkedin: boolean;
  readonly feedStatus: SponsorFeedStatus;
  readonly feedPublicUrl: string;
  readonly feedNotes: string;
}

export type SponsorshipPublicationTextField = Exclude<
  keyof SponsorshipPublicationDraft,
  'facebook' | 'linkedin'
>;
export type SponsorshipPublicationChannel = Extract<
  SponsorFeedChannel,
  'facebook' | 'linkedin'
>;

/** Pure projection dependencies, with existing history/media formatters as owners. */
export interface AdminSponsorPresentation extends AdminSponsorHistoryPresentation {
  currentLanguage(): string;
  history: {
    hasRefundWorkflow(sponsorship: AdminSponsorshipRecord): boolean;
    refundWorkflowStatusClass(
      status: AdminSponsorshipRefundWorkflowStatus
    ): string;
    refundWorkflowStatusLabel(
      status: AdminSponsorshipRefundWorkflowStatus
    ): string;
    refundWorkflowTimelineLabel(sponsorship: AdminSponsorshipRecord): string;
  };
  media: {
    sponsorMediaStatusLabel(status: SponsorMediaReviewStatus): string;
    formatMediaSize(bytes: number): string;
  };
}

export interface AdminSponsorOverviewState {
  readonly copyMessage: string;
  readonly reviewNote: string;
  readonly reviewNoteDirty: boolean;
  readonly reviewNoteStateLabel: string;
  readonly reviewNoteSaving: boolean;
}

export interface AdminSponsorIdentityState {
  readonly disabled: boolean;
  readonly logoPreviewSource: string | null;
  readonly logoMessage: string;
  readonly mediaAssets: readonly SponsorMediaAsset[];
  readonly mediaPreviewUrls: Readonly<Record<string, string>>;
  readonly mediaMessage: string | undefined;
}

export interface AdminSponsorRefundPorts extends AdminSponsorActionPorts {
  admin: Pick<FundingAdminService, 'refundSponsorship'>;
  canUseOwnerActions(): boolean;
  setReviewMessage(id: string, message: string, autoHide?: boolean): void;
  pulseSelection(id: string): void;
  formatAmount(amount: number, currency: string): string;
  formatMoney(sponsorship: AdminSponsorshipRecord): string;
  refundWorkflowStatusLabel(
    status: AdminSponsorshipRefundWorkflowStatus
  ): string;
  stripeRefundReasonLabel(reason: AdminSponsorshipStripeRefundReason): string;
}

export interface AdminSponsorMediaPorts extends AdminSponsorActionPorts {
  admin: Pick<
    FundingAdminService,
    | 'uploadSponsorLogo'
    | 'deleteSponsorLogo'
    | 'getSponsorLogoPreview'
    | 'getSponsorMedia'
    | 'getSponsorMediaPreview'
    | 'reviewSponsorMedia'
    | 'deleteSponsorMedia'
  >;
  confirm(message: string): Promise<boolean>;
  isBrowser(): boolean;
  mediaLoaded(): void;
}

/** Pure formatting callbacks; no service, HTTP, storage or page instance. */
export interface AdminSponsorHistoryPresentation extends AdminSponsorTranslation {
  formatAmount(amount: number, currency: string): string;
  dateOnlyLabel(value: string | null): string;
  paymentStatusLabel(status: string): string;
  reviewStatusLabel(status: SponsorshipReviewStatus): string;
  feedStatusLabel(status: SponsorFeedStatus): string;
}

export interface SponsorRefundDraft {
  readonly confirmationText: string;
  readonly refundAmount: string;
  readonly refundReason: AdminSponsorshipStripeRefundReason;
  readonly notifySponsor: boolean;
  readonly recipientEmail: string;
  readonly sponsorMessage: string;
  readonly refundNote: string;
}

export interface SponsorAuditEntry {
  readonly id: string;
  readonly date: string;
  readonly label: string;
  readonly detail?: string;
}

export interface SponsorRefundHistoryEntry extends SponsorAuditEntry {
  readonly tone: AdminSponsorshipRefundWorkflowStatus;
}
