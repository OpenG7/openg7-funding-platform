import type {
  AdminPublicationDraftRecord,
  SponsorFeedChannel
} from '@openg7/funding-core';

import type { SponsorshipAttentionRecord } from './fund-contributions.repository.js';
import { resolveSponsorshipSocialChannels } from './sponsorship-benefits.js';

export interface SponsorshipPublicationCoverage {
  readonly promisedChannels: readonly SponsorFeedChannel[];
  readonly coveredChannels: readonly SponsorFeedChannel[];
  readonly missingChannels: readonly SponsorFeedChannel[];
}

// Informational coverage of draft preparation, independent of delivery approval.
export const activeDraftChannels = (
  drafts: readonly AdminPublicationDraftRecord[],
  contributionId: string
): ReadonlySet<SponsorFeedChannel> => {
  const channels = new Set<SponsorFeedChannel>();
  for (const draft of drafts) {
    if (
      draft.contribution_id === contributionId &&
      draft.status !== 'rejected' &&
      draft.status !== 'cancelled'
    ) {
      channels.add(draft.channel);
    }
  }
  return channels;
};

export const resolveSponsorshipPublicationCoverage = (
  record: Pick<SponsorshipAttentionRecord, 'amount' | 'contributionId'>,
  drafts: readonly AdminPublicationDraftRecord[]
): SponsorshipPublicationCoverage => {
  const promisedChannels = resolveSponsorshipSocialChannels(record.amount);
  const covered = activeDraftChannels(drafts, record.contributionId);
  return {
    promisedChannels,
    coveredChannels: [...covered],
    missingChannels: promisedChannels.filter((channel) => !covered.has(channel))
  };
};
