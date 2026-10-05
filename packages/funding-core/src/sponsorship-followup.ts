import type {
  SponsorshipBenefitId,
  SponsorshipTierId
} from './sponsorship-benefits.js';
import type { SponsorshipReviewStatus } from './sponsorship-contracts.js';

/** Incomplete private text; never a published profile or a payment fact. */
export interface SponsorshipDraftValues {
  readonly companyName: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly websiteUrl: string;
  readonly logoUrl: string;
  readonly message: string;
}

export interface SponsorshipDraftSnapshot {
  readonly revision: number;
  readonly data: SponsorshipDraftValues | null;
  readonly updatedAt: string | null;
}

export interface SponsorshipDraftRequest {
  readonly token: string;
  readonly expectedRevision: number;
  readonly data: SponsorshipDraftValues | null;
}

export interface SponsorshipAccessRecoveryRequest {
  readonly email: string;
  readonly locale: 'fr-CA' | 'en';
}

export interface AdminSponsorshipAccessRequest {
  readonly contributionId: string;
  readonly recipient: string;
  readonly requestId: string;
  readonly confirmed: true;
  readonly locale: 'fr-CA' | 'en';
}

export interface AdminSponsorshipAccessResult {
  readonly status:
    'queued' | 'already_queued' | 'already_sent' | 'delivery_failed';
}

/** @deprecated The session-ID endpoint returns 410; use SponsorshipFollowupDetailsRequest. */
export interface SponsorshipDetailsRequest {
  readonly sessionId: string;
  readonly companyName: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly websiteUrl?: string;
  readonly logoUrl?: string;
  readonly message?: string;
}

/** @deprecated The session-ID endpoint no longer accepts writes. */
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
  readonly draftRevision?: number;
  readonly companyName: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly websiteUrl?: string;
  readonly logoUrl?: string;
  readonly message?: string;
}
