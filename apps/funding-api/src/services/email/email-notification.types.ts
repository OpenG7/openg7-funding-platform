import type { AdminSponsorshipRejectionRefundHandling } from '@openg7/funding-core';

import type {
  SponsorshipCreditNoteRecord,
  SponsorshipInvoiceRecord
} from '../../sponsorship-invoices.repository.js';
import type { ContributionReferenceRecoveryRecord } from '../../fund-contributions.repository.js';

export type EmailTemplateKey =
  | 'admin_contribution_received'
  | 'sponsorship_access_recovery'
  | 'contribution_reference_recovery'
  | 'sponsorship_information_request'
  | 'sponsorship_followup'
  | 'sponsorship_confirmation'
  | 'sponsorship_rejection'
  | 'sponsorship_refund'
  | 'sponsorship_invoice'
  | 'sponsorship_credit_note'
  | 'sponsorship_review_reminder'
  | 'publication_batch_full'
  | 'email_configuration_test';

export interface SponsorshipFollowupEmailInput {
  readonly to: string;
  readonly publicReference: string | null;
  readonly followupUrl: string;
  readonly idempotencyKey?: string;
  readonly deferDelivery?: boolean;
}

export interface ContributionReferenceRecoveryEmailInput {
  readonly to: string;
  readonly references: readonly ContributionReferenceRecoveryRecord[];
  readonly idempotencyKey?: string;
}

export interface SponsorshipConfirmationEmailInput {
  readonly to: string;
  readonly publicReference: string | null;
  readonly amount: number;
  readonly currency: string;
  readonly paidAtIso: string | null;
  readonly followupUrl: string;
  readonly stripeSessionId: string;
  readonly stripePaymentIntentId: string | null;
  readonly idempotencyKey?: string;
}

export interface SponsorshipInvoiceEmailInput {
  readonly to: string;
  readonly invoice: SponsorshipInvoiceRecord;
  readonly followupUrl?: string;
  readonly idempotencyKey?: string;
  readonly deferDelivery?: boolean;
}

export interface SponsorshipCreditNoteEmailInput {
  readonly to: string;
  readonly creditNote: SponsorshipCreditNoteRecord;
  readonly sponsorMessage?: string;
  readonly idempotencyKey?: string;
}

export interface SponsorshipRejectionEmailInput {
  readonly to: string;
  readonly contributionId: string;
  readonly publicReference: string | null;
  readonly sponsorName: string;
  readonly amount: number;
  readonly currency: string;
  readonly reviewReason: string;
  readonly sponsorMessage: string;
  readonly refundHandling: AdminSponsorshipRejectionRefundHandling;
  readonly refundNote?: string;
  readonly idempotencyKey?: string;
}

export interface SponsorshipRefundEmailInput {
  readonly to: string;
  readonly contributionId: string;
  readonly publicReference: string | null;
  readonly sponsorName: string;
  readonly amount: number;
  readonly currency: string;
  readonly refundId: string;
  readonly refundStatus: string | null;
  readonly sponsorMessage: string;
  readonly refundNote?: string;
  readonly idempotencyKey?: string;
}

export interface PublicationBatchFullEmailInput {
  readonly channel: string;
  readonly capacity: number;
  readonly batchId?: string;
  readonly idempotencyKey?: string;
}

export interface SponsorshipReviewReminderEmailItem {
  readonly reference: string;
  readonly amount: number;
  readonly currency: string;
  readonly detailsSubmittedAt: string | null;
  readonly daysWaiting: number | null;
}

export interface SponsorshipReviewReminderEmailInput {
  readonly totalCount: number;
  readonly urgentCount: number;
  readonly oldestDaysWaiting: number | null;
  readonly adminUrl: string;
  readonly items: readonly SponsorshipReviewReminderEmailItem[];
  readonly idempotencyKey?: string;
}

export interface EmailConfigurationTestInput {
  readonly to: string;
  readonly idempotencyKey?: string;
}

export interface RenderedEmail {
  readonly templateKey: EmailTemplateKey;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly metadata: Record<string, unknown>;
}

export interface SponsorshipAccessEmailInput {
  to: string;
  url: string;
  reference: string | null;
  locale: 'fr-CA' | 'en';
  idempotencyKey: string;
}

export interface AdminContributionReceivedEmailInput {
  activityId: string;
  contributionId: string;
  to: string;
  reference: string;
  amountMinor: number;
  currency: string;
  adminUrl: string;
}

export interface SponsorshipInformationRequestEmailInput {
  contributionId: string;
  recipient: string;
  subject: string;
  body: string;
  idempotencyKey: string;
}
