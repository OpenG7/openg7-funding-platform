import type {
  AdminAttentionItem,
  AdminAttentionItemType,
  AdminAttentionSeverity,
  AdminWorkQueueQuery,
  AdminWorkQueueResponse
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import {
  buildAttentionItems,
  loadAttentionDataset,
  type AttentionDataset
} from './admin-assistant/attention.service.js';

export const WORK_QUEUE_TYPES: readonly AdminAttentionItemType[] = [
  'sponsorship_needs_info',
  'sponsorship_needs_review',
  'publication_needs_preparation',
  'publication_late',
  'email_delivery_failed',
  'financial_data_warning',
  'invoice_missing',
  'stripe_event_failed',
  'stripe_event_stalled',
  'publication_ready',
  'publication_slot_upcoming'
];
export const WORK_QUEUE_PRIORITIES: readonly AdminAttentionSeverity[] = [
  'urgent',
  'today',
  'this_week',
  'informational'
];
export const STRIPE_STALLED_AFTER_MS = 15 * 60 * 1000;
const DAY = 86400000;
const PUBLICATIONS = '/admin/fundraiser/publications';

export interface QueueInvoiceCandidate {
  readonly id: string;
  readonly reference: string | null;
  readonly paid_at: string | null;
}
export interface QueueStripeEvent {
  readonly id: string;
  readonly event_type: string;
  readonly status: string;
  readonly received_at: string;
}

const localDay = (iso: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(iso));

export const parseWorkQueueQuery = (
  params: URLSearchParams
): AdminWorkQueueQuery => {
  const integer = (key: string, fallback: number, max: number): number => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max)
      throw new Error('Invalid queue query');
    return Number(raw);
  };
  const type = params.get('type') || undefined;
  const priority = params.get('priority') || undefined;
  const due = params.get('due') || 'all';
  const itemId = params.get('itemId') || undefined;
  const emailTemplate = params.get('emailTemplate') || undefined;
  const emailError = params.get('emailError') || undefined;
  const overview = params.get('overview');
  if (
    (type && !WORK_QUEUE_TYPES.includes(type as AdminAttentionItemType)) ||
    (priority &&
      !WORK_QUEUE_PRIORITIES.includes(priority as AdminAttentionSeverity)) ||
    !['all', 'today', 'overdue', 'this_week', 'undated'].includes(due) ||
    (itemId && itemId.length > 200) ||
    (emailTemplate && !/^[a-zA-Z0-9_-]{1,100}$/.test(emailTemplate)) ||
    (emailError &&
      ![
        'inconnue',
        'authentification',
        'destinataire_rejeté',
        'connexion',
        'autre'
      ].includes(emailError)) ||
    (overview !== null && overview !== 'true' && overview !== 'false')
  ) {
    throw new Error('Invalid queue query');
  }
  return {
    page: integer('page', 1, 1000000),
    pageSize: integer('pageSize', 25, 100),
    type: type as AdminWorkQueueQuery['type'],
    priority: priority as AdminWorkQueueQuery['priority'],
    due: due as AdminWorkQueueQuery['due'],
    itemId,
    ...(overview !== null ? { overview: overview === 'true' } : {}),
    ...(emailTemplate ? { emailTemplate } : {}),
    ...(emailError ? { emailError } : {})
  };
};

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
          adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${encodeURIComponent(item.sponsorshipId!)}`
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
            .filter(
              (draft) =>
                !['cancelled', 'rejected', 'published'].includes(draft.status)
            )
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

export const paginateWorkQueue = (
  items: readonly AdminAttentionItem[],
  now: Date,
  query: AdminWorkQueueQuery = {},
  missingSources: readonly string[] = []
): AdminWorkQueueResponse => {
  const counts = Object.fromEntries(
    WORK_QUEUE_PRIORITIES.map((priority) => [
      priority,
      items.filter((item) => item.severity === priority).length
    ])
  ) as Record<AdminAttentionSeverity, number>;
  const typeCounts = Object.fromEntries(
    WORK_QUEUE_TYPES.map((type) => [
      type,
      items.filter((item) => item.type === type).length
    ])
  ) as Record<AdminAttentionItemType, number>;
  const today = localDay(now.toISOString());
  const todayItem = (item: AdminAttentionItem): boolean =>
    item.severity === 'urgent' ||
    item.severity === 'today' ||
    Boolean(item.dueAt && localDay(item.dueAt) <= today);
  const filtered = items.filter((item) => {
    if (query.itemId && item.id !== query.itemId) return false;
    if (query.type && item.type !== query.type) return false;
    if (query.priority && item.severity !== query.priority) return false;
    if (
      (query.emailTemplate || query.emailError) &&
      item.type !== 'email_delivery_failed'
    )
      return false;
    if (
      query.emailTemplate &&
      item.facts['templateKey'] !== query.emailTemplate
    )
      return false;
    if (query.emailError && item.facts['errorCategory'] !== query.emailError)
      return false;
    if (query.due === 'today') return todayItem(item);
    if (query.due === 'overdue')
      return Boolean(item.dueAt && Date.parse(item.dueAt) < now.getTime());
    if (query.due === 'this_week')
      return Boolean(
        item.dueAt &&
        localDay(item.dueAt) >= today &&
        localDay(item.dueAt) <=
          localDay(new Date(now.getTime() + 7 * DAY).toISOString())
      );
    if (query.due === 'undated') return !item.dueAt;
    return true;
  });
  const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 25));
  const page = Math.max(
    1,
    Math.min(
      query.page ?? 1,
      Math.max(1, Math.ceil(filtered.length / pageSize))
    )
  );
  const recommendations: AdminAttentionItem[] = [];
  const emailGroups = new Map<
    string,
    { template: string; error: string; count: number }
  >();
  if (query.overview) {
    for (const item of items) {
      if (
        recommendations.length < 3 &&
        item.severity !== 'informational' &&
        !recommendations.some((candidate) => candidate.type === item.type)
      )
        recommendations.push(item);
      if (
        item.type !== 'email_delivery_failed' ||
        (query.priority && item.severity !== query.priority)
      )
        continue;
      const template = String(item.facts['templateKey'] ?? '');
      const error = String(item.facts['errorCategory'] ?? 'inconnue');
      const key = JSON.stringify([template, error]);
      const group = emailGroups.get(key) ?? { template, error, count: 0 };
      group.count++;
      emailGroups.set(key, group);
    }
  }
  return {
    available: missingSources.length === 0,
    coverage: missingSources.length ? 'unavailable' : 'complete',
    missingSources,
    generatedAt: now.toISOString(),
    timezone: 'America/Toronto',
    total: items.length,
    filteredTotal: filtered.length,
    todayTotal: items.filter(todayItem).length,
    counts,
    typeCounts,
    actionCounts: Object.fromEntries(
      WORK_QUEUE_TYPES.map((type) => [
        type,
        items.filter(
          (item) => item.type === type && item.severity !== 'informational'
        ).length
      ])
    ),
    page,
    pageSize,
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    firstSponsorshipId:
      items.find(
        (item) => item.sponsorshipId && item.severity !== 'informational'
      )?.sponsorshipId ?? null,
    ...(query.overview
      ? {
          overview: {
            recommendations,
            emailGroups: [...emailGroups.values()].sort(
              (a, b) =>
                b.count - a.count ||
                a.template.localeCompare(b.template) ||
                a.error.localeCompare(b.error)
            )
          }
        }
      : {})
  };
};

export const getAdminWorkQueue = async (
  pool: Pool | null,
  query: AdminWorkQueueQuery = {},
  now = new Date()
): Promise<AdminWorkQueueResponse> => {
  const snapshot = await loadAdminWorkQueue(pool, now);
  return paginateWorkQueue(snapshot.items, now, query, snapshot.missingSources);
};

/** Shared deterministic projection; callers paginate after cross-domain deduplication. */
export const loadAdminWorkQueue = async (
  pool: Pool | null,
  now = new Date()
): Promise<{ items: AdminAttentionItem[]; missingSources: string[] }> => {
  if (!pool) return { items: [], missingSources: ['database'] };
  const required = [
    'fund_contributions',
    'stripe_events',
    'sponsorship_invoices',
    'sponsor_media_assets',
    'sponsor_publication_drafts',
    'sponsor_publication_batches',
    'publication_slots',
    'email_messages'
  ];
  const presence = await pool.query<{ name: string; present: boolean }>(
    "SELECT name, to_regclass('public.' || name) IS NOT NULL AS present FROM unnest($1::text[]) AS name",
    [required]
  );
  const missing = required.filter(
    (name) => !presence.rows.some((row) => row.name === name && row.present)
  );
  if (missing.length) return { items: [], missingSources: missing };
  const [dataset, invoices, events] = await Promise.all([
    loadAttentionDataset(pool, now, true),
    pool.query<QueueInvoiceCandidate>(`SELECT c.id::text AS id, c.public_reference AS reference, c.paid_at::text AS paid_at
      FROM fund_contributions c LEFT JOIN sponsorship_invoices i ON i.contribution_id = c.id
      WHERE c.contribution_type = 'sponsorship_interest' AND c.status IN ('paid', 'refunded', 'disputed')
        AND c.stripe_session_id IS NOT NULL AND i.id IS NULL`),
    pool.query<QueueStripeEvent>(
      `SELECT stripe_event_id AS id, event_type, processing_status AS status, received_at::text AS received_at
      FROM stripe_events WHERE processing_status = 'failed' OR (processing_status = 'processing' AND received_at <= $1::timestamptz)`,
      [new Date(now.getTime() - STRIPE_STALLED_AFTER_MS).toISOString()]
    )
  ]);
  return {
    items: buildWorkQueueItems(dataset, invoices.rows, events.rows),
    missingSources: []
  };
};
