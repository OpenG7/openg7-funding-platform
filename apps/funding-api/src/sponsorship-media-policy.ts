import type { SponsorMediaAsset } from '@openg7/funding-core';

export interface SponsorshipMediaSummary {
  readonly total: number;
  readonly approved: number;
  readonly pending: number;
  readonly rejected: number;
  readonly hasApprovedPresentation: boolean;
}

/** Read-only review facts; these do not authorize visibility or publication. */
export const summarizeSponsorshipMedia = (
  media: readonly Pick<SponsorMediaAsset, 'kind' | 'reviewStatus'>[]
): SponsorshipMediaSummary => {
  let approved = 0;
  let pending = 0;
  let rejected = 0;
  let hasApprovedPresentation = false;
  for (const asset of media) {
    if (asset.reviewStatus === 'approved') {
      approved++;
      if (asset.kind === 'supporting_image') hasApprovedPresentation = true;
    } else if (asset.reviewStatus === 'pending_review') {
      pending++;
    } else if (asset.reviewStatus === 'rejected') {
      rejected++;
    }
  }
  return {
    total: media.length,
    approved,
    pending,
    rejected,
    hasApprovedPresentation
  };
};
