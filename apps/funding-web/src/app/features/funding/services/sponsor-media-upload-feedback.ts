import type { SponsorMediaLimits } from '@openg7/funding-core';

export interface SponsorMediaFeedback {
  readonly key: string;
  readonly params?: Record<string, string | number>;
}

interface SponsorMediaFileCandidate {
  readonly size: number;
  readonly type: string;
}

export const getSponsorMediaFileValidationFeedback = (
  file: SponsorMediaFileCandidate,
  limits: SponsorMediaLimits
): SponsorMediaFeedback | null => {
  if (file.size === 0) return { key: 'emptyFile' };
  if (file.size > limits.maxUploadBytes)
    return {
      key: 'tooLarge',
      params: { size: limits.maxUploadBytes / (1024 * 1024) }
    };
  if (
    file.type &&
    !limits.acceptedMimeTypes.includes(
      file.type as 'image/jpeg' | 'image/png' | 'image/webp'
    )
  )
    return { key: 'invalidType' };
  return null;
};

export const getSponsorMediaUploadFailureFeedback = (
  error: unknown,
  limits: SponsorMediaLimits
): SponsorMediaFeedback => {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('payment') && message.includes('not confirmed'))
    return { key: 'paymentUnconfirmed' };
  if (message.includes('too large'))
    return {
      key: 'tooLarge',
      params: { size: limits.maxUploadBytes / (1024 * 1024) }
    };
  if (
    message.includes('declared image type') ||
    message.includes('valid jpeg') ||
    message.includes('valid token, media kind')
  )
    return { key: 'invalidType' };
  if (message.includes('supporting image limit'))
    return { key: 'limit', params: { count: limits.maxSupportingImages } };
  if (message.includes('approved logo')) return { key: 'approvedLogo' };
  if (message.includes('follow-up was not found'))
    return { key: 'expiredLink' };
  return { key: 'uploadError' };
};
