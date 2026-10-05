import type { ContributionType } from './contribution-contracts.js';
import type { SponsorshipReviewStatus } from './sponsorship-contracts.js';

const contributionPublicReferencePattern = /^OG7-\d{4}-[A-Z0-9]{4,8}$/;

export const normalizeContributionPublicReference = (
  value: string | null | undefined
): string | null => {
  if (!value) {
    return null;
  }

  const reference = value.trim().toUpperCase();
  return contributionPublicReferencePattern.test(reference) ? reference : null;
};

export interface PublicReferenceLookupRequest {
  readonly reference: string;
}

export type PublicReferenceLookupNextStep =
  | 'none'
  | 'wait_for_payment_confirmation'
  | 'recover_private_link_by_email'
  | 'contact_support_with_reference';

export interface PublicReferenceLookupFoundResponse {
  readonly found: true;
  readonly publicReference: string;
  readonly contributionType: ContributionType;
  readonly paymentStatus: string;
  readonly amount: number | null;
  readonly displayAmount: boolean;
  readonly currency: string;
  readonly paidAt: string | null;
  readonly createdAt: string;
  readonly reviewStatus: SponsorshipReviewStatus | null;
  readonly detailsSubmitted: boolean | null;
  readonly nextStep: PublicReferenceLookupNextStep;
}

export interface PublicReferenceLookupNotFoundResponse {
  readonly found: false;
  readonly publicReference: string;
}

export type PublicReferenceLookupResponse =
  PublicReferenceLookupFoundResponse | PublicReferenceLookupNotFoundResponse;

export interface ReferenceRecoveryRequest {
  readonly email: string;
}

export interface ReferenceRecoveryResult {
  readonly accepted: true;
}
