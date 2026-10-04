import type {
  AdminAttentionItem,
  AdminAttentionItemType,
  AdminAttentionSeverity
} from '@openg7/funding-core';

import {
  buildAttentionItems,
  type AttentionDataset
} from '../admin-assistant/attention.service.js';
import { sponsorshipAdminUrl } from '../sponsorship-admin-presentation.js';
import { isUnfinishedPublicationDraft } from '../sponsorship-publication-coverage.js';

import {
  DAY,
  PUBLICATIONS,
  STRIPE_STALLED_AFTER_MS,
  WORK_QUEUE_PRIORITIES,
  localDay,
  type QueueInvoiceCandidate,
  type QueueStripeEvent
} from './contracts.js';

/** One publication action per logical placement: slot > batch > standalone draft. */
export const buildWorkQueueItems = (
  dataset: AttentionDataset,
  invoices: readonly QueueInvoiceCandidate[] = [],
  events: readonly QueueStripeEvent[] = []
): AdminAttentionItem[] => {
  const now = dataset.now.getTime();
  const detectedAt = dataset.now.toISOString();
  const items = buildAttentionItems(dataset)
    .filter((item) => item.type !== 'publication_late')
    .map((item) => {
      if (item.type === 'email_delivery_failed')
        return {
          ...item,
          adminUrl: `/admin/fundraiser/email-queue?messageId=${encodeURIComponent(item.emailQueueId!)}`
        };
      if (item.type === 'publication_needs_preparation')
        return {
          ...item,
          adminUrl: sponsorshipAdminUrl(item.sponsorshipId!)
        };
      return item;
    });
  const add = (
    type: AdminAttentionItemType,
    id: string,
    severity: AdminAttentionSeverity,
    adminUrl: string,
    facts: AdminAttentionItem['facts'],
    dueAt?: string
  ): void => {
    const sponsorshipId =
      type === 'invoice_missing'
        ? id
        : dataset.drafts
            .filter((draft) =>
              facts['kind'] === 'draft'
                ? draft.id === facts['reference']
                : facts['kind'] === 'batch'
                  ? draft.batch_id === facts['reference']
                  : facts['kind'] === 'slot'
                    ? draft.slot_id === facts['reference'] ||
                      dataset.batches.some(
                        (batch) =>
                          batch.id === draft.batch_id &&
                          batch.slotId === facts['reference']
                      )
                    : false
            )
            .filter(isUnfinishedPublicationDraft)
            .map((draft) => draft.contribution_id)
            .sort()[0];
    items.push({
      id: `${type}:${id}`,
      type,
      severity,
      title: type,
      explanation: type,
      detectedAt,
      dueAt,
      adminUrl,
      facts,
      ...(sponsorshipId
        ? { sponsorshipId, contributionId: sponsorshipId }
        : {}),
      suggestedActions: [
        { actionType: 'open', label: 'Ouvrir', executionMode: 'navigate' }
      ]
    });
  };
  const activeSlots = new Set(
    dataset.slots
      .filter((slot) => slot.status === 'open' || slot.status === 'scheduled')
      .map((slot) => slot.id)
  );
  const activeBatches = new Set(
    dataset.batches
      .filter(
        (batch) => batch.status === 'open' || batch.status === 'scheduled'
      )
      .map((batch) => batch.id)
  );
  const publication = (
    kind: 'slot' | 'batch' | 'draft',
    id: string,
    channel: string,
    due: string | null,
    ready: boolean
  ): void => {
    const date = due ? Date.parse(due) : NaN;
    const facts = { kind, reference: id, channel };
    const url = `${PUBLICATIONS}?${kind}Id=${encodeURIComponent(id)}`;
    if (Number.isFinite(date) && date <= now) {
      add(
        'publication_late',
        `${kind}:${id}`,
        now - date >= 2 * DAY ? 'urgent' : 'today',
        url,
        facts,
        due!
      );
    } else if (kind === 'slot' && date <= now + 7 * DAY) {
      add(
        'publication_slot_upcoming',
        id,
        localDay(due!) === localDay(detectedAt) ? 'today' : 'this_week',
        url,
        facts,
        due!
      );
    } else if (ready) {
      add(
        'publication_ready',
        `${kind}:${id}`,
        'today',
        url,
        facts,
        due ?? undefined
      );
    }
  };
  for (const slot of dataset.slots) {
    if (activeSlots.has(slot.id))
      publication('slot', slot.id, slot.channel, slot.startsAt, false);
  }
  for (const batch of dataset.batches) {
    if (
      !activeBatches.has(batch.id) ||
      (batch.slotId && activeSlots.has(batch.slotId))
    )
      continue;
    const assigned = dataset.drafts.filter(
      (draft) => draft.batch_id === batch.id
    );
    const ready =
      batch.status === 'open' &&
      assigned.length > 0 &&
      assigned.every((draft) => draft.status === 'approved');
    publication('batch', batch.id, batch.channel, batch.scheduledAt, ready);
  }
  for (const draft of dataset.drafts) {
    if (
      (draft.slot_id && activeSlots.has(draft.slot_id)) ||
      (draft.batch_id && activeBatches.has(draft.batch_id))
    )
      continue;
    if (draft.status === 'approved' || draft.status === 'scheduled')
      publication(
        'draft',
        draft.id,
        draft.channel,
        draft.scheduled_at,
        draft.status === 'approved'
      );
  }
  for (const invoice of invoices) {
    add(
      'invoice_missing',
      invoice.id,
      'today',
      `/admin/fundraiser/invoices?contributionId=${encodeURIComponent(invoice.id)}`,
      {
        reference: invoice.reference ?? invoice.id,
        contributionId: invoice.id,
        paidAt: invoice.paid_at
      }
    );
  }
  for (const event of events) {
    const stalled =
      event.status === 'processing' &&
      now - Date.parse(event.received_at) >= STRIPE_STALLED_AFTER_MS;
    if (event.status !== 'failed' && !stalled) continue;
    const type =
      event.status === 'failed'
        ? 'stripe_event_failed'
        : 'stripe_event_stalled';
    add(
      type,
      event.id,
      'urgent',
      `/admin/fundraiser/attention?itemId=${encodeURIComponent(`${type}:${event.id}`)}`,
      {
        reference: event.id,
        eventType: event.event_type,
        status: event.status,
        receivedAt: event.received_at
      }
    );
  }
  return [...new Map(items.map((item) => [item.id, item])).values()].sort(
    (a, b) =>
      WORK_QUEUE_PRIORITIES.indexOf(a.severity) -
        WORK_QUEUE_PRIORITIES.indexOf(b.severity) ||
      (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') ||
      a.id.localeCompare(b.id)
  );
};
