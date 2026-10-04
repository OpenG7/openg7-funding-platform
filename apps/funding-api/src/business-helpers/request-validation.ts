import type {
  AdminSponsorshipStripeRefundReason,
  ContributionType,
  SponsorFeedChannel,
  SponsorFeedTarget
} from '@openg7/funding-core';

import {
  isSponsorshipEmail,
  isSponsorshipHttpsUrl
} from '../../../../packages/funding-core/src/index.js';
import {
  allowedSponsorFeedChannels,
  allowedSponsorFeedTargets,
  allowedSponsorshipStripeRefundReasons
} from '../fund-contributions.repository.js';

export const SPONSOR_TEXT_MAX_LENGTH = 200;
export const SPONSOR_MESSAGE_MAX_LENGTH = 1000;
export const SPONSOR_URL_MAX_LENGTH = 2048;
export const STRIPE_METADATA_VALUE_MAX_LENGTH = 480;
export const PUBLIC_DISPLAY_NAME_MAX_LENGTH = 100;
export const ADMIN_REVIEW_NOTE_MAX_LENGTH = 1000;
export const SPONSOR_MEDIA_ALT_TEXT_MAX_LENGTH = 300;

export const normalizeAmount = (amount: number): number =>
  Number(Number(amount).toFixed(2));

export const amountToCents = (amount: number): number =>
  Math.round(amount * 100);

export const createRequestValidationHelpers = ({
  allowedContributionTypes
}: {
  readonly allowedContributionTypes: ReadonlySet<ContributionType>;
}) => {
  const isAllowedContributionType = (
    contributionType: unknown
  ): contributionType is ContributionType =>
    typeof contributionType === 'string' &&
    allowedContributionTypes.has(contributionType as ContributionType);

  return { isAllowedContributionType };
};

export const isBoolean = (value: unknown): value is boolean =>
  typeof value === 'boolean';

export const isNonEmptySponsorText = (
  value: unknown,
  maxLength: number
): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= maxLength;

export const isValidSponsorEmail = (value: unknown): value is string =>
  isSponsorshipEmail(value, SPONSOR_TEXT_MAX_LENGTH);

export const hasOnlyKeys = (value: unknown, keys: readonly string[]): boolean =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));

export const isValidOptionalHttpsUrl = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  if (typeof value !== 'string' || value.length > SPONSOR_URL_MAX_LENGTH) {
    return false;
  }

  try {
    return isSponsorshipHttpsUrl(value);
  } catch {
    return false;
  }
};

export const truncateStripeMetadataValue = (value: string): string =>
  value.slice(0, STRIPE_METADATA_VALUE_MAX_LENGTH);

export const isValidOptionalBoundedText = (
  value: unknown,
  maxLength: number
): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim().length <= maxLength);

export const isValidOptionalNonEmptyBoundedText = (
  value: unknown,
  maxLength: number
): boolean =>
  value === undefined ||
  (typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength);

export const isAllowedSponsorshipStripeRefundReason = (
  value: unknown
): value is AdminSponsorshipStripeRefundReason =>
  typeof value === 'string' &&
  allowedSponsorshipStripeRefundReasons.has(
    value as AdminSponsorshipStripeRefundReason
  );

export const isValidUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const isValidOptionalIsoDate = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  return typeof value === 'string' && Number.isFinite(Date.parse(value));
};

export const isAllowedSponsorFeedTarget = (
  value: unknown
): value is SponsorFeedTarget | null =>
  value === undefined ||
  value === null ||
  value === '' ||
  (typeof value === 'string' &&
    allowedSponsorFeedTargets.has(value as SponsorFeedTarget));

export const isAllowedSponsorFeedChannel = (
  value: unknown
): value is SponsorFeedChannel =>
  typeof value === 'string' &&
  allowedSponsorFeedChannels.has(value as SponsorFeedChannel);

export const isValidAdminExpectedVersion = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= 128;
