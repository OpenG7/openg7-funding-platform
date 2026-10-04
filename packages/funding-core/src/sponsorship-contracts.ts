import type { AdminAuditLogEntry } from './admin-audit.js';
import type { AdminPagination } from './admin-pagination.js';
import type {
  SponsorFeedChannel,
  SponsorFeedStatus,
  SponsorFeedTarget
} from './publication-contracts.js';
import type { PublicSponsorMediaAsset } from './sponsor-media.js';
import type { AdminSponsorshipCreditNoteRecord } from './sponsorship-documents.js';

export interface PublicSponsorshipProfile {
  /** Stable public directory key, unrelated to access or payment references. */
  readonly public_id?: string;
  readonly public_slug: string | null;
  readonly company_name: string;
  readonly website_url: string | null;
  readonly logo_url: string | null;
  readonly media: readonly PublicSponsorMediaAsset[];
  /** @deprecated Always null on current servers; use the admin's public_summary. */
  readonly message: string | null;
  readonly public_summary: string | null;
  readonly amount: number | null;
  readonly currency: string;
  readonly paid_at: string | null;
  readonly feed_target: SponsorFeedTarget | null;
  readonly feed_channels: readonly SponsorFeedChannel[];
  readonly feed_status: SponsorFeedStatus;
  readonly feed_public_url: string | null;
  readonly visibility_updated_at: string | null;
}

export interface PublicSponsorshipsResponse {
  readonly data_source: 'database' | 'empty';
  readonly sponsorships: readonly PublicSponsorshipProfile[];
  readonly last_updated_at: string;
  /** Counts of public sponsorship dossiers, not distinct companies or posts. */
  readonly pagination?: {
    readonly page: number;
    readonly page_size: number;
    readonly total_count: number;
    readonly published_count: number;
  };
}

export type SponsorshipReviewStatus =
  'pending_review' | 'approved' | 'rejected';

export type AdminSponsorshipRefundWorkflowStatus =
  'not_requested' | 'requested' | 'processing' | 'completed' | 'failed';

export type AdminSponsorshipStripeRefundReason =
  'requested_by_customer' | 'duplicate' | 'fraudulent';

export interface AdminSponsorshipRecord {
  readonly id: string;
  readonly version: string;
  readonly public_reference: string | null;
  readonly contribution_type: 'sponsorship_interest';
  readonly amount: number;
  readonly currency: string;
  readonly payment_status: string;
  readonly paid_at: string | null;
  readonly public_name: string | null;
  readonly public_display_consent: boolean;
  readonly display_amount_consent: boolean;
  readonly sponsor_company_name: string | null;
  readonly sponsor_contact_name: string | null;
  readonly sponsor_contact_email: string | null;
  readonly sponsor_website_url: string | null;
  readonly sponsor_logo_url: string | null;
  readonly sponsor_message: string | null;
  readonly sponsor_details_submitted_at: string | null;
  readonly sponsor_review_status: SponsorshipReviewStatus;
  readonly sponsor_review_note: string | null;
  readonly sponsor_reviewed_at: string | null;
  readonly sponsor_public_slug: string | null;
  readonly sponsor_public_summary: string | null;
  readonly sponsor_feed_target: SponsorFeedTarget | null;
  readonly sponsor_feed_channels: readonly SponsorFeedChannel[];
  readonly sponsor_feed_status: SponsorFeedStatus;
  readonly sponsor_feed_public_url: string | null;
  readonly sponsor_feed_notes: string | null;
  readonly sponsor_visibility_updated_at: string | null;
  readonly sponsorship_refund_status: AdminSponsorshipRefundWorkflowStatus;
  readonly sponsorship_refund_requested_at: string | null;
  readonly sponsorship_refund_processed_at: string | null;
  readonly sponsorship_refund_completed_at: string | null;
  readonly sponsorship_refund_id: string | null;
  readonly sponsorship_refund_amount: number | null;
  readonly sponsorship_refund_reason: AdminSponsorshipStripeRefundReason | null;
  readonly sponsorship_refund_note: string | null;
  readonly sponsorship_refund_error: string | null;
  readonly admin_audit_entries: readonly AdminAuditLogEntry[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AdminSponsorshipsResponse {
  readonly data_source: 'database';
  readonly items: readonly AdminSponsorshipRecord[];
  readonly sponsorships: readonly AdminSponsorshipRecord[];
  readonly pagination: AdminPagination;
  readonly last_updated_at: string;
}

export interface AdminSponsorshipReviewRequest {
  readonly contributionId: string;
  readonly reviewStatus: SponsorshipReviewStatus;
  readonly reviewNote?: string;
  readonly expectedVersion: string;
  readonly notifySponsor?: boolean;
  readonly notificationEmail?: string;
  readonly sponsorMessage?: string;
  readonly refundHandling?: AdminSponsorshipRejectionRefundHandling;
  readonly refundNote?: string;
}

export type AdminSponsorshipRejectionRefundHandling =
  'none' | 'manual_required' | 'manual_completed';

export interface AdminSponsorshipReviewResult {
  readonly updated: boolean;
  readonly reviewStatus: SponsorshipReviewStatus;
  readonly refundHandling?: AdminSponsorshipRejectionRefundHandling;
  readonly refundWorkflowStatus?: AdminSponsorshipRefundWorkflowStatus;
  readonly notification?: {
    readonly queued: boolean;
    readonly attempted: boolean;
    readonly sent: boolean;
    readonly messageId: string | null;
    readonly error: string | null;
  };
}

export interface AdminSponsorshipRefundRequest {
  readonly contributionId: string;
  readonly expectedVersion: string;
  readonly confirmationText: string;
  readonly amount?: number;
  readonly refundReason?: AdminSponsorshipStripeRefundReason;
  readonly refundNote?: string;
  readonly notifySponsor?: boolean;
  readonly notificationEmail?: string;
  readonly sponsorMessage?: string;
}

export interface AdminSponsorshipRefundResult {
  readonly refunded: boolean;
  readonly refundId: string;
  readonly refundStatus: string | null;
  readonly refundWorkflowStatus: AdminSponsorshipRefundWorkflowStatus;
  readonly refundReason: AdminSponsorshipStripeRefundReason;
  readonly fullRefund: boolean;
  readonly amount: number;
  readonly currency: string;
  readonly contributionId: string;
  readonly paymentStatusUpdated: boolean;
  readonly sponsorship: AdminSponsorshipRecord | null;
  readonly creditNote: AdminSponsorshipCreditNoteRecord | null;
  readonly notification?: {
    readonly queued: boolean;
    readonly attempted: boolean;
    readonly sent: boolean;
    readonly messageId: string | null;
    readonly error: string | null;
  };
}

export interface AdminSponsorshipPublicationRequest {
  readonly contributionId: string;
  readonly expectedVersion: string;
  readonly publicSlug?: string;
  readonly publicSummary?: string;
  readonly feedTarget?: SponsorFeedTarget | null;
  readonly feedChannels: readonly SponsorFeedChannel[];
  readonly feedStatus: SponsorFeedStatus;
  readonly feedPublicUrl?: string;
  readonly feedNotes?: string;
}

export interface AdminSponsorshipPublicationResult {
  readonly updated: boolean;
  readonly feedStatus: SponsorFeedStatus;
}
