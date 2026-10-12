import type {
  AdminPublicationDraftRecord,
  SponsorFeedChannel
} from '@openg7/funding-core';

import { pendingSponsorshipSocialChannels } from '../../../packages/funding-core/src/index.js';

import type { SponsorshipAttentionRecord } from './fund-contributions.repository.js';

export interface SponsorshipPublicationCoverage {
  readonly promisedChannels: readonly SponsorFeedChannel[];
  readonly coveredChannels: readonly SponsorFeedChannel[];
  readonly missingChannels: readonly SponsorFeedChannel[];
}

/** Published drafts retain informational coverage of the promised channel. */
export const isActivePublicationDraft = (
  draft: Pick<AdminPublicationDraftRecord, 'status'>
): boolean => draft.status !== 'rejected' && draft.status !== 'cancelled';

/** Read-only followup; this grants neither approval nor permission to deliver. */
export const isUnfinishedPublicationDraft = (
  draft: Pick<AdminPublicationDraftRecord, 'status'>
): boolean => isActivePublicationDraft(draft) && draft.status !== 'published';

// Informational coverage of draft preparation, independent of delivery approval.
export const activeDraftChannels = (
  drafts: readonly AdminPublicationDraftRecord[],
  contributionId: string
): ReadonlySet<SponsorFeedChannel> => {
  const channels = new Set<SponsorFeedChannel>();
  for (const draft of drafts) {
    if (
      draft.contribution_id === contributionId &&
      isActivePublicationDraft(draft)
    ) {
      channels.add(draft.channel);
    }
  }
  return channels;
};

export const resolveSponsorshipPublicationCoverage = (
  record: Pick<SponsorshipAttentionRecord, 'commitment' | 'contributionId'>,
  drafts: readonly AdminPublicationDraftRecord[]
): SponsorshipPublicationCoverage => {
  const promisedChannels = pendingSponsorshipSocialChannels(record.commitment);
  const outstanding =
    record.commitment?.obligations.filter((o) =>
      ['pending', 'blocked'].includes(o.state)
    ) ?? [];
  const covered = activeDraftChannels(
    drafts.filter(
      (d) =>
        !promisedChannels.includes(d.channel) ||
        outstanding.some(
          (o) => o.channel === d.channel && o.target === d.feed_target
        )
    ),
    record.contributionId
  );
  return {
    promisedChannels,
    coveredChannels: [...covered],
    missingChannels: promisedChannels.filter((channel) => !covered.has(channel))
  };
};
