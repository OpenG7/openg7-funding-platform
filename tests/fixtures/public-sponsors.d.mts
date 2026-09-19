import type {
  PublicSponsorshipProfile,
  PublicSponsorshipsResponse
} from '@openg7/funding-core';

export function sponsorProfile(
  index?: number,
  overrides?: Partial<PublicSponsorshipProfile>
): PublicSponsorshipProfile;
export function sponsorsResponse(
  profiles: readonly PublicSponsorshipProfile[],
  page?: number,
  pageSize?: number
): PublicSponsorshipsResponse & {
  pagination: NonNullable<PublicSponsorshipsResponse['pagination']>;
};
