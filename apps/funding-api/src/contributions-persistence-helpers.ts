import type {
  ContributionType,
  SponsorFeedStatus,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

const allowedContributionTypes = new Set<ContributionType>([
  'personal_support',
  'sponsorship_interest'
]);

export const allowedSponsorshipReviewStatuses =
  new Set<SponsorshipReviewStatus>(['pending_review', 'approved', 'rejected']);
export const allowedSponsorFeedStatuses = new Set<SponsorFeedStatus>([
  'not_planned',
  'planned',
  'drafted',
  'published'
]);

export const centsToAmount = (value: number): number =>
  Number((value / 100).toFixed(2));

export const parseDbInt = (value: string): number => Number.parseInt(value, 10);

export const normalizeSponsorFeedStatus = (
  value: SponsorFeedStatus | null
): SponsorFeedStatus =>
  value && allowedSponsorFeedStatuses.has(value) ? value : 'not_planned';

export const normalizeSponsorshipReviewStatus = (
  value: SponsorshipReviewStatus | null
): SponsorshipReviewStatus | null =>
  value && allowedSponsorshipReviewStatuses.has(value) ? value : null;

export const normalizeContributionType = (
  value: string | undefined
): ContributionType =>
  value && allowedContributionTypes.has(value as ContributionType)
    ? (value as ContributionType)
    : 'personal_support';

export const parseMetadataBoolean = (value: string | undefined): boolean =>
  value === 'true';
