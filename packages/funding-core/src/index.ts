import {
  ContributorRecord,
  FundingAllocation,
  FundingTotals,
  SponsorshipPricingConfig
} from '@openg7/funding-models';

export type ContributionType = 'personal_support' | 'sponsorship_interest';

export type SponsorshipBenefitId =
  'website_mention' | 'facebook_batch' | 'linkedin_batch';

export type SponsorshipTierId =
  'website_only' | 'website_facebook' | 'website_facebook_linkedin';

export interface SponsorshipBenefitStatus {
  readonly id: SponsorshipBenefitId;
  readonly minimumAmount: number;
}

export interface SponsorshipBenefitsResult {
  readonly tier: SponsorshipTierId | null;
  readonly achievedBenefits: readonly SponsorshipBenefitId[];
  readonly upcomingBenefits: readonly SponsorshipBenefitStatus[];
}

/**
 * MVP pricing for the business sponsorship flow (5 $ to 50 $ range).
 * Larger professional/partnership offers are out of scope for this config.
 */
export const DEFAULT_SPONSORSHIP_PRICING_CONFIG: SponsorshipPricingConfig = {
  presetAmounts: [5, 10, 25, 50],
  minimumAmount: 5,
  benefits: {
    websiteMention: { minimumAmount: 5 },
    facebookBatch: { minimumAmount: 25 },
    linkedinBatch: { minimumAmount: 50 }
  }
};

const sponsorshipTierByAchievedCount: readonly (SponsorshipTierId | null)[] = [
  null,
  'website_only',
  'website_facebook',
  'website_facebook_linkedin'
];

export const isValidSponsorshipAmount = (
  amount: number,
  pricing: SponsorshipPricingConfig = DEFAULT_SPONSORSHIP_PRICING_CONFIG
): boolean => Number.isFinite(amount) && amount >= pricing.minimumAmount;

/**
 * Pure amount -> tier/benefits resolution. Both the web app and the API
 * import this so the sponsorship benefits a company sees are always derived
 * from the paid amount, never trusted from client-submitted data.
 */
export const resolveSponsorshipBenefits = (
  amount: number,
  pricing: SponsorshipPricingConfig = DEFAULT_SPONSORSHIP_PRICING_CONFIG
): SponsorshipBenefitsResult => {
  const benefitThresholds: readonly SponsorshipBenefitStatus[] = [
    {
      id: 'website_mention',
      minimumAmount: pricing.benefits.websiteMention.minimumAmount
    },
    {
      id: 'facebook_batch',
      minimumAmount: pricing.benefits.facebookBatch.minimumAmount
    },
    {
      id: 'linkedin_batch',
      minimumAmount: pricing.benefits.linkedinBatch.minimumAmount
    }
  ];

  const achievedBenefits = benefitThresholds
    .filter((benefit) => amount >= benefit.minimumAmount)
    .map((benefit) => benefit.id);

  const upcomingBenefits = benefitThresholds.filter(
    (benefit) => amount < benefit.minimumAmount
  );

  return {
    tier: sponsorshipTierByAchievedCount[achievedBenefits.length] ?? null,
    achievedBenefits,
    upcomingBenefits
  };
};

export type SponsorFeedTarget = 'openg7' | 'openg20';

export type SponsorFeedChannel = 'facebook' | 'linkedin';

export type SponsorFeedStatus =
  'not_planned' | 'planned' | 'drafted' | 'published';

export type PublicationDraftStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'rejected'
  | 'cancelled';

export type AdminExpenseStatus =
  'draft' | 'published' | 'active' | 'private' | 'archived';

export interface CheckoutConsentPayload {
  readonly contributionType: ContributionType;
  readonly publicDisplayConsent: boolean;
  readonly publicDisplayName?: string;
  readonly displayAmountConsent: boolean;
  readonly nonCharityAcknowledged: boolean;
}

export interface CheckoutRequest {
  readonly amount: number;
  readonly currency: 'CAD';
  readonly projectId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly contributionType: ContributionType;
  readonly publicDisplayConsent: boolean;
  readonly publicDisplayName?: string;
  readonly displayAmountConsent: boolean;
  readonly nonCharityAcknowledged: boolean;
}

export interface MockCheckoutResult {
  readonly checkoutId: string;
  readonly redirectUrl: string;
  readonly status: 'mocked';
}

export interface RedirectCheckoutResult {
  readonly checkoutId: string;
  readonly redirectUrl: string;
  readonly status: 'redirected';
}

export type CheckoutResult = MockCheckoutResult | RedirectCheckoutResult;

export interface FundingSnapshot {
  readonly totals: FundingTotals;
  readonly allocation: readonly FundingAllocation[];
  readonly contributors: readonly ContributorRecord[];
}

export interface PublicMonthlySummary {
  readonly month: string;
  readonly total_received: number;
  readonly total_fees: number;
  readonly total_net: number;
  readonly total_refunded: number;
  readonly total_payouts: number;
  readonly contributions_count: number;
  readonly currency: string;
}

export interface PublicFundAllocation {
  readonly project_name: string;
  readonly public_description: string;
  readonly amount_allocated: number;
  readonly currency: string;
  readonly status: string;
  readonly published_at: string | null;
}

export interface PublicBuilderProfile {
  readonly display_name: string;
  readonly contribution_type: ContributionType;
  readonly amount: number | null;
  readonly currency: string;
  readonly paid_at: string | null;
}

export interface PublicSponsorshipProfile {
  readonly public_slug: string | null;
  readonly company_name: string;
  readonly website_url: string | null;
  readonly logo_url: string | null;
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
}

export interface PublicFundingRuntimeConfig {
  readonly business_sponsorship_enabled: boolean;
  readonly last_updated_at: string;
}

/**
 * Indicative next collective-post date per channel, derived from the
 * earliest scheduled (not open, not published) publication batch. No
 * sponsor-identifying data: just a date, or null if none is scheduled yet.
 */
export interface PublicSponsorshipBatchAvailability {
  readonly channel: SponsorFeedChannel;
  readonly nextAvailableAt: string | null;
}

export interface PublicSponsorshipBatchAvailabilityResponse {
  readonly data_source: 'database' | 'empty';
  readonly availability: readonly PublicSponsorshipBatchAvailability[];
}

export interface FundTransparencyPublicResponse {
  readonly data_source: 'database' | 'stripe_direct' | 'empty';
  readonly total_received: number;
  readonly total_fees: number;
  readonly total_net: number;
  readonly total_refunded: number;
  readonly total_payouts: number;
  readonly current_available_estimate: number;
  readonly contributions_count: number;
  readonly currency: string;
  readonly monthly_summary: readonly PublicMonthlySummary[];
  readonly latest_public_allocations: readonly PublicFundAllocation[];
  readonly public_builders: readonly PublicBuilderProfile[];
  readonly last_updated_at: string;
}

export const createMockCheckoutResult = (
  request: CheckoutRequest
): MockCheckoutResult => ({
  checkoutId: `mock-${request.projectId}-${request.amount}`,
  redirectUrl: 'https://example.org/mock-checkout',
  status: 'mocked'
});

export interface SponsorshipDetailsRequest {
  readonly sessionId: string;
  readonly companyName: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly websiteUrl?: string;
  readonly logoUrl?: string;
  readonly message?: string;
}

export interface SponsorshipDetailsResult {
  readonly received: true;
  readonly recorded: boolean;
}

export interface SponsorshipFollowupResponse {
  readonly found: true;
  readonly publicReference: string | null;
  readonly paymentStatus: string;
  readonly reviewStatus: SponsorshipReviewStatus;
  readonly amount: number;
  readonly currency: string;
  readonly paidAt: string | null;
  readonly sponsorshipTier: SponsorshipTierId | null;
  readonly sponsorshipBenefits: readonly SponsorshipBenefitId[];
  readonly detailsSubmitted: boolean;
  readonly companyName: string | null;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly websiteUrl: string | null;
  readonly logoUrl: string | null;
  readonly message: string | null;
  readonly reviewedAt: string | null;
}

export interface SponsorshipFollowupDetailsRequest {
  readonly token: string;
  readonly companyName: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly websiteUrl?: string;
  readonly logoUrl?: string;
  readonly message?: string;
}

export type SponsorshipReviewStatus =
  'pending_review' | 'approved' | 'rejected';

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
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AdminPagination {
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
  readonly hasPreviousPage: boolean;
  readonly hasNextPage: boolean;
}

export interface AdminSponsorshipsResponse {
  readonly data_source: 'database';
  readonly items: readonly AdminSponsorshipRecord[];
  readonly sponsorships: readonly AdminSponsorshipRecord[];
  readonly pagination: AdminPagination;
  readonly last_updated_at: string;
}

export interface AdminSponsorLogoUploadResult {
  readonly updated: boolean;
  readonly contributionId: string;
  readonly logoUrl: string;
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly sizeBytes: number;
}

export interface AdminSponsorLogoDeleteRequest {
  readonly contributionId: string;
  readonly expectedVersion: string;
}

export interface AdminSponsorLogoDeleteResult {
  readonly updated: boolean;
  readonly contributionId: string;
  readonly deletedLogoUrl: string | null;
}

export interface AdminContributionRecord {
  readonly id: string;
  readonly public_reference: string | null;
  readonly contribution_type: ContributionType;
  readonly amount: number;
  readonly currency: string;
  readonly payment_status: string;
  readonly paid_at: string | null;
  readonly public_name: string | null;
  readonly email_private: string | null;
  readonly public_display_consent: boolean;
  readonly display_amount_consent: boolean;
  readonly non_charity_acknowledged: boolean;
  readonly sponsor_company_name: string | null;
  readonly sponsor_contact_name: string | null;
  readonly sponsor_contact_email: string | null;
  readonly sponsor_review_status: SponsorshipReviewStatus | null;
  readonly sponsor_feed_status: SponsorFeedStatus | null;
  readonly stripe_session_id: string | null;
  readonly stripe_payment_intent_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AdminContributionsSummary {
  readonly total_count: number;
  readonly paid_count: number;
  readonly pending_count: number;
  readonly sponsorship_count: number;
  readonly public_display_count: number;
  readonly total_received: number;
  readonly total_refunded: number;
  readonly total_disputed: number;
  readonly currency: string;
}

export interface AdminContributionsResponse {
  readonly data_source: 'database';
  readonly summary: AdminContributionsSummary;
  readonly contributions: readonly AdminContributionRecord[];
  readonly last_updated_at: string;
}

export interface AdminDashboardResponse {
  readonly data_source: 'database';
  readonly totals: {
    readonly total_received: number;
    readonly total_refunded: number;
    readonly total_disputed: number;
    readonly current_available_estimate: number;
    readonly currency: string;
    readonly contributions_count: number;
    readonly paid_contributions_count: number;
  };
  readonly sponsorship_review: {
    readonly total: number;
    readonly pending: number;
    readonly approved: number;
    readonly rejected: number;
  };
  readonly feed_publication: {
    readonly planned: number;
    readonly drafted: number;
    readonly published: number;
    readonly active: number;
  };
  readonly stripe_events: {
    readonly failed: number;
    readonly processing: number;
    readonly last_failed_at: string | null;
  };
  readonly recent_contributions: readonly AdminContributionRecord[];
  readonly last_updated_at: string;
}

export interface AdminSetupStatusResponse {
  readonly data_source: 'database' | 'stripe_direct' | 'empty';
  readonly environment: string;
  readonly public_base_url: string | null;
  readonly allowed_origins: readonly string[];
  readonly stripe: {
    readonly secret_key_configured: boolean;
    readonly webhook_secret_configured: boolean;
    readonly business_sponsorship_enabled: boolean;
    readonly dashboard_url: string;
    readonly webhook_endpoint: string;
  };
  readonly email: {
    readonly resend_api_key_configured: boolean;
    readonly from: string | null;
    readonly reply_to: string | null;
    readonly admin_notification_email: string | null;
    readonly queue_available: boolean;
    readonly queue_poll_interval_ms: number;
    readonly queue_batch_size: number;
    readonly queued_count: number;
    readonly sending_count: number;
    readonly sent_count: number;
    readonly failed_count: number;
    readonly last_failed_at: string | null;
    readonly last_error: string | null;
  };
  readonly invoice: {
    readonly prefix: string;
    readonly issuer_name: string | null;
    readonly issuer_email: string | null;
    readonly issuer_address_configured: boolean;
    readonly issuer_tax_id_configured: boolean;
    readonly tax_label: string;
    readonly ready: boolean;
  };
  readonly database: {
    readonly configured: boolean;
    readonly reachable: boolean;
  };
  readonly last_updated_at: string;
}

export interface AdminEmailTestRequest {
  readonly to?: string;
}

export interface AdminEmailTestResult {
  readonly queued: boolean;
  readonly attempted: boolean;
  readonly sent: boolean;
  readonly messageId: string | null;
  readonly error: string | null;
}

export interface AdminSponsorshipInvoiceLineItem {
  readonly description: string;
  readonly quantity: number;
  readonly unit_amount: number;
  readonly total: number;
}

export interface AdminSponsorshipInvoiceRecord {
  readonly id: string;
  readonly contribution_id: string;
  readonly invoice_number: string;
  readonly public_reference: string | null;
  readonly stripe_session_id: string;
  readonly stripe_payment_intent_id: string | null;
  readonly issued_at: string;
  readonly paid_at: string | null;
  readonly currency: string;
  readonly subtotal: number;
  readonly tax: number;
  readonly total: number;
  readonly tax_label: string;
  readonly issuer_name: string;
  readonly issuer_email: string | null;
  readonly issuer_address: string | null;
  readonly issuer_tax_id: string | null;
  readonly sponsor_name: string;
  readonly sponsor_contact_name: string | null;
  readonly sponsor_contact_email: string | null;
  readonly sponsor_website_url: string | null;
  readonly line_items: readonly AdminSponsorshipInvoiceLineItem[];
  readonly notes: string | null;
  readonly last_email_status: string | null;
  readonly last_email_recipient: string | null;
  readonly last_email_sent_at: string | null;
  readonly last_email_error: string | null;
}

export interface AdminSponsorshipInvoicesSummary {
  readonly total_count: number;
  readonly total_amount: number;
  readonly failed_email_count: number;
  readonly currency: string;
}

export interface AdminSponsorshipInvoicesResponse {
  readonly data_source: 'database';
  readonly invoices: readonly AdminSponsorshipInvoiceRecord[];
  readonly summary: AdminSponsorshipInvoicesSummary;
  readonly last_updated_at: string;
}

export interface AdminSponsorshipInvoiceResendRequest {
  readonly invoiceId: string;
  readonly to?: string;
}

export interface AdminSponsorshipInvoiceResendResult {
  readonly queued: boolean;
  readonly attempted: boolean;
  readonly sent: boolean;
  readonly messageId: string | null;
  readonly error: string | null;
  readonly invoice: AdminSponsorshipInvoiceRecord | null;
}

export interface AdminSessionCreateRequest {
  readonly token: string;
}

export interface AdminSessionResponse {
  readonly actor: string;
  readonly expiresAt: string;
  readonly sessionToken: string;
  readonly ttlSeconds: number;
}

export interface AdminPublicationDraftRecord {
  readonly id: string;
  readonly contribution_id: string;
  readonly sponsor_company_name: string;
  readonly sponsor_website_url: string | null;
  readonly sponsor_logo_url: string | null;
  readonly sponsor_public_summary: string | null;
  readonly feed_target: SponsorFeedTarget;
  readonly channel: SponsorFeedChannel;
  readonly title: string;
  readonly body: string;
  readonly disclosure_text: string;
  readonly status: PublicationDraftStatus;
  readonly public_url: string | null;
  readonly scheduled_at: string | null;
  readonly approved_at: string | null;
  readonly published_at: string | null;
  readonly review_note: string | null;
  readonly batch_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AdminPublicationDraftsResponse {
  readonly data_source: 'database';
  readonly drafts: readonly AdminPublicationDraftRecord[];
  readonly last_updated_at: string;
}

export interface AdminPublicationDraftCreateRequest {
  readonly contributionId: string;
  readonly feedTarget: SponsorFeedTarget;
  readonly channel: SponsorFeedChannel;
}

export interface AdminPublicationDraftUpdateRequest {
  readonly draftId: string;
  readonly title?: string;
  readonly body?: string;
  readonly disclosureText?: string;
  readonly status?: PublicationDraftStatus;
  readonly publicUrl?: string;
  readonly scheduledAt?: string | null;
  readonly reviewNote?: string;
}

export interface AdminPublicationDraftMutationResult {
  readonly updated: boolean;
  readonly draft: AdminPublicationDraftRecord | null;
}

/**
 * A "lot": a capacity-bounded group of approved sponsorship drafts that go
 * out together as a single collective Facebook/LinkedIn post. Scheduling or
 * publishing a batch cascades to every draft assigned to it; publishing is
 * always an explicit admin action, never automatic on payment or approval.
 */
export type PublicationBatchStatus =
  'open' | 'scheduled' | 'published' | 'cancelled';

export interface AdminPublicationBatchRecord {
  readonly id: string;
  readonly channel: SponsorFeedChannel;
  readonly capacity: number;
  readonly status: PublicationBatchStatus;
  readonly scheduledAt: string | null;
  readonly publishedAt: string | null;
  readonly notes: string | null;
  readonly assignedDraftIds: readonly string[];
  readonly capacityUsed: number;
  readonly capacityAvailable: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminPublicationBatchesResponse {
  readonly data_source: 'database';
  readonly batches: readonly AdminPublicationBatchRecord[];
  readonly last_updated_at: string;
}

export interface AdminPublicationBatchCreateRequest {
  readonly channel: SponsorFeedChannel;
  readonly capacity: number;
  readonly notes?: string;
}

export interface AdminPublicationBatchAssignRequest {
  readonly batchId: string;
  readonly draftId: string;
}

export interface AdminPublicationBatchUnassignRequest {
  readonly draftId: string;
}

export interface AdminPublicationBatchScheduleRequest {
  readonly batchId: string;
  readonly scheduledAt: string;
}

export interface AdminPublicationBatchLifecycleRequest {
  readonly batchId: string;
}

export interface AdminPublicationBatchMutationResult {
  readonly updated: boolean;
  readonly batch: AdminPublicationBatchRecord | null;
}

export interface AdminAuditLogEntry {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: string | null;
  readonly summary: string | null;
  readonly metadata: Record<string, unknown>;
  readonly created_at: string;
}

export interface AdminAuditLogResponse {
  readonly data_source: 'database';
  readonly entries: readonly AdminAuditLogEntry[];
  readonly last_updated_at: string;
}

export interface AdminExpenseRecord {
  readonly id: string;
  readonly project_name: string;
  readonly public_description: string;
  readonly amount_allocated: number;
  readonly currency: string;
  readonly status: AdminExpenseStatus;
  readonly published_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AdminExpensesSummary {
  readonly total_count: number;
  readonly published_count: number;
  readonly draft_count: number;
  readonly private_count: number;
  readonly archived_count: number;
  readonly total_allocated: number;
  readonly published_allocated: number;
  readonly currency: string;
}

export interface AdminExpensesResponse {
  readonly data_source: 'database';
  readonly summary: AdminExpensesSummary;
  readonly expenses: readonly AdminExpenseRecord[];
  readonly last_updated_at: string;
}

export interface AdminExpenseCreateRequest {
  readonly projectName: string;
  readonly publicDescription: string;
  readonly amountAllocated: number;
  readonly currency: 'CAD';
  readonly status: AdminExpenseStatus;
  readonly publishedAt?: string | null;
}

export interface AdminExpenseUpdateRequest {
  readonly expenseId: string;
  readonly projectName?: string;
  readonly publicDescription?: string;
  readonly amountAllocated?: number;
  readonly currency?: 'CAD';
  readonly status?: AdminExpenseStatus;
  readonly publishedAt?: string | null;
}

export interface AdminExpenseMutationResult {
  readonly updated: boolean;
  readonly expense: AdminExpenseRecord | null;
}

export interface AdminTransparencyResponse {
  readonly data_source: 'database';
  readonly public_summary: FundTransparencyPublicResponse;
  readonly expenses_summary: AdminExpensesSummary;
  readonly expenses: readonly AdminExpenseRecord[];
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
