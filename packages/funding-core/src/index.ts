import {
  ContributorRecord,
  FundingAllocation,
  FundingTotals
} from '@openg7/funding-models';

export type ContributionType = 'personal_support' | 'sponsorship_interest';

export type SponsorFeedTarget = 'openg7' | 'openg20';

export type SponsorFeedChannel = 'facebook' | 'linkedin';

export type SponsorFeedStatus =
  | 'not_planned'
  | 'planned'
  | 'drafted'
  | 'published';

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
  | 'pending_review'
  | 'approved'
  | 'rejected';

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
