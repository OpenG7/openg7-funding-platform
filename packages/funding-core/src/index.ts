import {
  ContributorRecord,
  FundingAllocation,
  FundingTotals
} from '@openg7/funding-models';

export type ContributionType = 'personal_support' | 'sponsorship_interest';

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
  readonly paymentStatus: string;
  readonly reviewStatus: SponsorshipReviewStatus;
  readonly amount: number;
  readonly currency: string;
  readonly paidAt: string | null;
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

export interface AdminSponsorshipsResponse {
  readonly data_source: 'database';
  readonly sponsorships: readonly AdminSponsorshipRecord[];
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
}

export interface AdminSponsorLogoDeleteResult {
  readonly updated: boolean;
  readonly contributionId: string;
  readonly deletedLogoUrl: string | null;
}

export interface AdminContributionRecord {
  readonly id: string;
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
}

export interface AdminSponsorshipReviewResult {
  readonly updated: boolean;
  readonly reviewStatus: SponsorshipReviewStatus;
}

export interface AdminSponsorshipPublicationRequest {
  readonly contributionId: string;
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
