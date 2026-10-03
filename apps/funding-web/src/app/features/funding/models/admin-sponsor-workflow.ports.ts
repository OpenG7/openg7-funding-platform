import type {
  AdminSponsorshipRecord,
  AdminSponsorshipRefundWorkflowStatus,
  AdminSponsorshipStripeRefundReason,
  SponsorFeedStatus,
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
