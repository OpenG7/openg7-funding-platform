import type {
  AdminAttentionItem,
  AdminAttentionItemType,
  SponsorshipObligation
} from '@openg7/funding-core';

import {
  sponsorshipAdminUrl,
  sponsorshipRef
} from '../../sponsorship-admin-presentation.js';

import type { AttentionDataset } from './contracts.js';

/** Recorded promises stay actionable until proof or an explicit adjustment closes them. */
export const detectSponsorshipObligationItems = (
  dataset: AttentionDataset
): AdminAttentionItem[] =>
  dataset.sponsorships.flatMap((record) => {
    const items: AdminAttentionItem[] = [];
    const add = (
      type: AdminAttentionItemType,
      id: string,
      reason: string,
      obligation?: SponsorshipObligation
    ): void => {
      const dueAt = obligation?.timing?.dueAt ?? undefined;
      const overdue =
        dueAt !== undefined && Date.parse(dueAt) < dataset.now.getTime();
      items.push({
        id: `${type}:${id}`,
        type,
        severity:
          overdue || reason === 'refund_failed'
            ? 'urgent'
            : type === 'sponsorship_refund_followup'
              ? 'today'
              : 'this_week',
        title: type,
        explanation: reason,
        detectedAt: dataset.now.toISOString(),
        ...(dueAt ? { dueAt } : {}),
        sponsorshipId: record.contributionId,
        contributionId: record.contributionId,
        adminUrl: sponsorshipAdminUrl(
          record.contributionId,
          type === 'sponsorship_refund_followup' ? 'refund' : 'publication'
        ),
        facts: {
          reference: sponsorshipRef(record),
          reason,
          ...(obligation
            ? {
                obligationId: obligation.id,
                channel: obligation.channel,
                target: obligation.target,
                ordinal: obligation.ordinal
              }
            : {})
        },
        suggestedActions: [
          {
            actionType: 'open_sponsorship',
            label: 'Ouvrir le dossier',
            executionMode: 'navigate'
          }
        ]
      });
    };
    if (['requested', 'processing', 'failed'].includes(record.refundStatus))
      add(
        'sponsorship_refund_followup',
        record.contributionId,
        `refund_${record.refundStatus}`
      );
    if (record.commitment?.state !== 'active' || !record.commitment.offer)
      return items;
    for (const obligation of record.commitment.obligations) {
      if (
        obligation.state === 'adjusted' ||
        (obligation.state === 'fulfilled' && obligation.fulfilmentEvidenceId)
      )
        continue;
      // Preparation, authorization, publication and proof are separate. In particular,
      // a published draft never closes an unproven obligation or its next ordinal.
      if (
        record.reviewStatus !== 'pending_review' ||
        record.refundStatus !== 'not_requested' ||
        record.paymentStatus !== 'paid'
      )
        add(
          'sponsorship_needs_fulfilment',
          obligation.id,
          obligation.state === 'fulfilled' ||
            dataset.drafts.some(
              (draft) =>
                draft.contribution_id === record.contributionId &&
                draft.channel === obligation.channel &&
                draft.feed_target === obligation.target &&
                draft.status === 'published' &&
                (!draft.obligation_id || draft.obligation_id === obligation.id)
            )
            ? 'fulfilment_evidence_missing'
            : record.refundStatus !== 'not_requested'
              ? 'refund_requires_review'
              : record.paymentStatus !== 'paid'
                ? 'payment_requires_review'
                : record.reviewStatus !== 'approved'
                  ? 'review_required'
                  : (obligation.blockedReason ??
                    (obligation.channel === 'website'
                      ? 'website_fulfilment_required'
                      : 'social_fulfilment_required')),
          obligation
        );
      const timing = obligation.timing;
      if (!timing) continue;
      const reason = timing.overdue
        ? 'deadline_exceeded'
        : timing.deadlineDays !== null && timing.originAt === null
          ? 'deadline_origin_unknown'
          : !['not_required', 'attested'].includes(timing.durationState)
            ? `duration_${timing.durationState}`
            : null;
      if (reason)
        add('sponsorship_timing_review', obligation.id, reason, obligation);
    }
    return items;
  });
