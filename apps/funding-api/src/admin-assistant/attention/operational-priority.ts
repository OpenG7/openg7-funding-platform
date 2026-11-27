import type {
  AdminAttentionItem,
  SponsorshipPublicationWorkflowObligation
} from '@openg7/funding-core';

import type { AttentionDataset } from './contracts.js';

const publicationTypes = new Set<AdminAttentionItem['type']>([
  'sponsorship_needs_fulfilment',
  'sponsorship_timing_review',
  'publication_needs_preparation',
  'publication_late',
  'publication_ready',
  'publication_slot_upcoming'
]);

/** Enrich the existing queue from native workflow observations, never create a decision. */
export function prioritizeOperationalItems(
  items: readonly AdminAttentionItem[],
  dataset: AttentionDataset
): AdminAttentionItem[] {
  if (!dataset.publicationWorkflows) return [...items];
  const sources = dataset.publicationWorkflows;
  return items.map((item) => {
    if (!publicationTypes.has(item.type)) return item;
    const obligationId = item.facts['obligationId'];
    const contributionId = item.contributionId ?? item.sponsorshipId;
    const kind = item.facts['kind'];
    const placementId = item.facts['reference'] ?? item.publicationId;
    const placement = dataset.drafts.filter((draft) =>
      kind === 'draft'
        ? draft.id === placementId
        : kind === 'batch'
          ? draft.batch_id === placementId
          : kind === 'slot'
            ? draft.slot_id === placementId ||
              dataset.batches.some(
                (batch) =>
                  batch.id === draft.batch_id && batch.slotId === placementId
              )
            : false
    );
    if (kind && placement.length === 0) return item;
    const contributionIds = [
      ...new Set(
        placement.length
          ? placement.map((draft) => draft.contribution_id)
          : contributionId
            ? [contributionId]
            : []
      )
    ].sort();
    const observed = sources.filter((source) =>
      contributionIds.includes(source.contributionId)
    );
    const workflows = observed.flatMap((source) =>
      source.workflow.obligations.filter((workflow) =>
        typeof obligationId === 'string'
          ? workflow.obligationId === obligationId
          : placement.length
            ? placement.some(
                (draft) =>
                  draft.contribution_id === source.contributionId &&
                  draft.obligation_id === workflow.obligationId
              )
            : true
      )
    );
    // Missing exact passage coverage is not evidence that the platform owns the work.
    const complete = placement.length
      ? placement.every(
          (draft) =>
            !!draft.obligation_id &&
            observed.some(
              (source) =>
                source.contributionId === draft.contribution_id &&
                source.workflow.obligations.some(
                  (workflow) => workflow.obligationId === draft.obligation_id
                )
            )
        )
      : observed.length === contributionIds.length && workflows.length > 0;
    if (!complete || !workflows.length) return item;
    const active = workflows.filter(
      (workflow) => workflow.state !== 'complete'
    );
    if (!active.length) return item;
    const selected: SponsorshipPublicationWorkflowObligation =
      active.find((workflow) => workflow.state === 'uncertain') ??
      active.find((workflow) => workflow.state === 'error') ??
      active.find((workflow) => workflow.state === 'blocked') ??
      active.find((workflow) => workflow.responsibility === 'admin') ??
      active[0]!;
    const timingException =
      item.type === 'sponsorship_timing_review' &&
      [
        'deadline_exceeded',
        'deadline_origin_unknown',
        'duration_restart_required',
        'duration_unsupported',
        'duration_awaiting_observation'
      ].includes(String(item.facts['reason']));
    const platform =
      !timingException &&
      active.every(
        (workflow) =>
          workflow.state === 'waiting' && workflow.responsibility === 'platform'
      );
    const intervention = timingException
      ? {
          state: 'action_required' as const,
          responsibility: 'admin' as const,
          reason: String(item.facts['reason'])
        }
      : {
          state: selected.state,
          responsibility: selected.responsibility,
          reason: selected.reason
        };
    const deliveryIds = [
      ...new Set(
        workflows.flatMap((workflow) =>
          workflow.deliveryId ? [workflow.deliveryId] : []
        )
      )
    ].sort();
    return {
      ...item,
      intervention,
      relatedContributionIds: contributionIds,
      relatedDeliveryIds: deliveryIds,
      severity: platform
        ? 'informational'
        : ['uncertain', 'error'].includes(intervention.state)
          ? 'urgent'
          : item.severity,
      facts: { ...item.facts, reason: intervention.reason },
      ...(deliveryIds.length === 1
        ? {
            adminUrl: `/admin/fundraiser/publications/automation?deliveryId=${deliveryIds[0]}`
          }
        : {}),
      suggestedActions:
        platform || deliveryIds.length
          ? item.suggestedActions.filter(
              (action) => action.executionMode === 'navigate'
            )
          : item.suggestedActions
    };
  });
}
