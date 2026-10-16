import type {
  AdminPublicationDraftRecord,
  SponsorFeedChannel
} from '@openg7/funding-core';

import { pendingSponsorshipSocialChannels } from '../../../packages/funding-core/src/index.js';

import type { SponsorshipAttentionRecord } from './fund-contributions.repository.js';

export interface SponsorshipPublicationCoverage {
  readonly promisedChannels: readonly SponsorFeedChannel[];
  readonly coveredChannels: readonly SponsorFeedChannel[];
  /** Exact current passage bindings/preparations, separate from historical channel observations. */
  readonly preparedChannels: readonly SponsorFeedChannel[];
  readonly missingChannels: readonly SponsorFeedChannel[];
  /** A legacy published observation must be reconciled before another passage is prepared. */
  readonly preparationChannels: readonly SponsorFeedChannel[];
  readonly reviewChannels: readonly SponsorFeedChannel[];
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
  const prepared = new Set<string>();
  const uniqueDrafts = [...new Map(drafts.map((d) => [d.id, d])).values()].sort(
    (a, b) =>
      Number(Boolean(b.obligation_id)) - Number(Boolean(a.obligation_id)) ||
      a.id.localeCompare(b.id)
  );
  for (const draft of uniqueDrafts) {
    if (
      draft.contribution_id !== record.contributionId ||
      !isActivePublicationDraft(draft)
    )
      continue;
    // A bound historical publication covers only its exact recorded passage.
    // Without a binding, a published observation cannot cover new obligations.
    if (!draft.obligation_id && draft.status === 'published') continue;
    const obligation = outstanding.find(
      (o) =>
        o.channel === draft.channel &&
        o.target === draft.feed_target &&
        (draft.obligation_id
          ? o.id === draft.obligation_id
          : !prepared.has(o.id))
    );
    if (obligation) prepared.add(obligation.id);
  }
  const covered = new Set(
    promisedChannels.filter((channel) => {
      return outstanding
        .filter((o) => o.channel === channel)
        .every((o) => prepared.has(o.id));
    })
  );
  const missingChannels = promisedChannels.filter(
    (channel) => !covered.has(channel)
  );
  const reviewChannels = missingChannels.filter((channel) =>
    uniqueDrafts.some(
      (draft) =>
        draft.contribution_id === record.contributionId &&
        draft.channel === channel &&
        draft.status === 'published' &&
        !draft.obligation_id &&
        outstanding.some(
          (obligation) =>
            obligation.channel === channel &&
            obligation.target === draft.feed_target
        )
    )
  );
  return {
    promisedChannels,
    coveredChannels: [
      ...activeDraftChannels(
        drafts.filter(
          (draft) =>
            !promisedChannels.includes(draft.channel) ||
            outstanding.some(
              (obligation) =>
                obligation.channel === draft.channel &&
                obligation.target === draft.feed_target
            )
        ),
        record.contributionId
      )
    ],
    preparedChannels: [...covered],
    missingChannels,
    preparationChannels: missingChannels.filter(
      (channel) => !reviewChannels.includes(channel)
    ),
    reviewChannels
  };
};
