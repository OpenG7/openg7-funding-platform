import type {
  AdminAttentionItem,
  AdminAttentionItemType,
  AdminAttentionSeverity,
  AdminWorkQueueQuery,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import {
  DAY,
  WORK_QUEUE_PRIORITIES,
  WORK_QUEUE_TYPES,
  localDay
} from './contracts.js';

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
