import type {
  SponsorshipCommitmentRecord,
  SponsorshipProgressPublication,
  SponsorshipPublicationWorkflow,
  SponsorshipPublicationWorkflowObligation,
  SponsorshipPublicationWorkflowStep
} from '@openg7/funding-core';

import { hasQualifiedSponsorshipFulfilment } from './sponsorship-progress-evidence.js';

const step = (
  state: SponsorshipPublicationWorkflowStep['state'],
  reason: string,
  responsibility: SponsorshipPublicationWorkflowStep['responsibility'] = 'admin'
): SponsorshipPublicationWorkflowStep => ({ state, reason, responsibility });

const priority: Record<SponsorshipPublicationWorkflowStep['state'], number> = {
  uncertain: 0,
  error: 1,
  blocked: 2,
  action_required: 3,
  waiting: 4,
  complete: 5
};

/** A date or legacy published declaration alone establishes neither authority nor fulfilment. */
export function projectSponsorshipPublicationWorkflow(
  commitment: SponsorshipCommitmentRecord | null | undefined,
  publications: readonly SponsorshipProgressPublication[],
  blockers: readonly string[] = [],
  now = new Date(),
  qualifiedEvidenceIds: readonly string[] = []
): SponsorshipPublicationWorkflow {
  if (
    commitment?.state !== 'active' ||
    !commitment.offer ||
    blockers.includes('commitment_needs_confirmation')
  )
    return {
      ...step('blocked', 'commitment_needs_confirmation'),
      obligations: []
    };
  const obligations: SponsorshipPublicationWorkflowObligation[] =
    commitment.obligations.map((obligation) => {
      // Legacy rows can be matched only when the destination has a single
      // promised passage. Never let one unbound draft cover repeated benefits.
      const matches = publications.filter(
        (publication) =>
          publication.channel === obligation.channel &&
          publication.target === obligation.target &&
          (publication.obligationId === obligation.id ||
            (!publication.obligationId &&
              commitment.obligations.filter(
                (other) =>
                  other.channel === obligation.channel &&
                  other.target === obligation.target
              ).length === 1))
      );
      const activeMatches = matches.filter(
        (item) =>
          !['cancelled', 'rejected'].includes(item.status) &&
          !['cancelled', 'rejected'].includes(item.deliveryStatus ?? '')
      );
      // An unresolved send holds the whole source channel, including legacy
      // unbound drafts and an older destination. Expose that incident for
      // resolution without using it as evidence for any promised passage.
      const heldChannel = publications.filter(
        (item) => item.channel === obligation.channel
      );
      const publication =
        heldChannel.find((item) => item.deliveryStatus === 'uncertain') ??
        heldChannel.find((item) => item.deliveryStatus === 'publishing') ??
        activeMatches.find((item) => item.deliveryStatus === 'approved') ??
        activeMatches.find(
          (item) =>
            !['published', 'cancelled', 'rejected'].includes(
              item.deliveryStatus ?? item.status
            )
        ) ??
        activeMatches[0] ??
        matches.find(
          (item) =>
            item.deliveryStatus === 'published' || item.status === 'published'
        ) ??
        publications.find(
          (item) =>
            item.channel === obligation.channel &&
            item.target === obligation.target &&
            (!item.obligationId || item.obligationId === obligation.id) &&
            (item.deliveryStatus === 'rejected' || item.status === 'rejected')
        );
      const status = publication?.deliveryStatus;
      let current: SponsorshipPublicationWorkflowStep;
      if (status === 'uncertain')
        current = step('uncertain', 'publication_uncertain');
      else if (obligation.state === 'adjusted')
        current = step('complete', 'obligation_adjusted', 'none');
      else if (
        hasQualifiedSponsorshipFulfilment(obligation, qualifiedEvidenceIds)
      )
        current = step('complete', 'publication_done', 'none');
      else if (obligation.state === 'fulfilled')
        current = step('blocked', 'fulfilment_unverified');
      else if (status === 'failed')
        current = step('error', 'publication_failed');
      else if (obligation.state === 'blocked' || blockers.length)
        current = step('blocked', 'publication_blocked');
      else if (
        status === 'blocked' ||
        status === 'rejected' ||
        publication?.status === 'rejected'
      )
        current = step('blocked', 'publication_failed');
      else if (status === 'publishing')
        current = step('waiting', 'publication_publishing', 'platform');
      else if (publication?.feedPaused && status === 'approved')
        current = step('blocked', 'publication_paused');
      else if (publication?.workerEnabled === false && status === 'approved')
        current = step('blocked', 'publication_worker_disabled');
      else if (
        publication?.deliveryId &&
        publication?.deliveryMode === 'live' &&
        status === 'approved'
      )
        current = step(
          'waiting',
          publication.nextAttemptAt
            ? 'publication_retry_pending'
            : 'publication_scheduled',
          'platform'
        );
      else if (status === 'draft')
        current = step('action_required', 'publication_authorization_required');
      else if (publication?.deliveryMode === 'mock' && status === 'published')
        current = step('action_required', 'publication_simulation');
      else if (
        obligation.channel === 'website' &&
        obligation.timing?.durationState === 'awaiting_review' &&
        obligation.timing.startObservation &&
        Date.parse(obligation.timing.startObservation.earliestCompletionAt) >
          now.getTime()
      )
        current = step('waiting', 'duration_in_progress', 'platform');
      else if (obligation.channel === 'website')
        current = step('action_required', 'website_publication_required');
      else if (
        !publication &&
        commitment.obligations.some(
          (other) =>
            other.channel === obligation.channel &&
            other.target === obligation.target &&
            other.ordinal < obligation.ordinal &&
            !['fulfilled', 'adjusted'].includes(other.state)
        )
      )
        current = step('waiting', 'publication_pending', 'platform');
      else if (!publication)
        current = step('action_required', 'publication_preparation_required');
      else if (status === 'published' || publication.status === 'published')
        current = step('blocked', 'publication_pending');
      else
        current = step('action_required', 'publication_authorization_required');
      return {
        ...current,
        obligationId: obligation.id,
        channel: obligation.channel,
        target: obligation.target,
        ordinal: obligation.ordinal,
        deliveryId: publication?.deliveryId ?? null,
        scheduledAt:
          publication && matches.includes(publication)
            ? (publication.scheduledAt ?? null)
            : null
      };
    });
  const next = [...obligations].sort(
    (a, b) => priority[a.state] - priority[b.state]
  )[0];
  return {
    ...(next && next.state !== 'complete'
      ? step(next.state, next.reason, next.responsibility)
      : next
        ? step('complete', 'publication_done', 'none')
        : step('blocked', 'publication_pending')),
    obligations
  };
}
