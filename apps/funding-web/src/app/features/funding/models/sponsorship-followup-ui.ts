import type {
  SponsorshipFollowupDetailsRequest,
  SponsorshipFollowupResponse
} from '@openg7/funding-core';

export type SponsorshipDetailsDraft = Omit<
  SponsorshipFollowupDetailsRequest,
  'token'
>;

/** Editing eligibility is separate from the payment label and publication. */
export const canEditSponsorshipDetails = (status: string): boolean =>
  ['paid', 'refunded', 'disputed'].includes(status);

export const normalizeSponsorshipDetails = (
  value: SponsorshipDetailsDraft
): SponsorshipDetailsDraft => ({
  companyName: value.companyName.trim(),
  contactName: value.contactName.trim(),
  contactEmail: value.contactEmail.trim(),
  websiteUrl: value.websiteUrl?.trim() || undefined,
  logoUrl: value.logoUrl?.trim() || undefined,
  message: value.message?.trim() || undefined
});

export const sponsorshipDetailsFromFollowup = (
  value: SponsorshipFollowupResponse
): SponsorshipDetailsDraft =>
  normalizeSponsorshipDetails({
    companyName: value.companyName ?? '',
    contactName: value.contactName ?? '',
    contactEmail: value.contactEmail ?? '',
    websiteUrl: value.websiteUrl ?? '',
    logoUrl: value.logoUrl ?? '',
    message: value.message ?? ''
  });

export const sameSponsorshipDetails = (
  first: SponsorshipDetailsDraft,
  second: SponsorshipDetailsDraft
): boolean =>
  JSON.stringify(normalizeSponsorshipDetails(first)) ===
  JSON.stringify(normalizeSponsorshipDetails(second));

export class SponsorshipFollowupError extends Error {
  constructor(readonly status: number) {
    super('Sponsorship follow-up request failed.');
  }
}

export const followupAccessExpired = (error: unknown): boolean =>
  error instanceof SponsorshipFollowupError &&
  [400, 401, 403, 404, 410].includes(error.status);
