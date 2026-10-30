export type HubActivityKind = 'ready' | 'media' | 'rules' | 'preparation';
export type HubActivityOrigin = 'human' | 'automatic';
export type HubActivityPeriod = 'today' | 'week' | 'all';
export type HubActivityDossierId =
  'atelier-boreal' | 'collectif-rivages' | 'studio-canopée';
export type HubActivityGuideId =
  'guide-exceptions' | 'guide-context' | 'guide-human' | 'guide-services';

export interface HubActivity {
  readonly id: string;
  readonly occurredAt: string;
  readonly kind: HubActivityKind;
  readonly origin: HubActivityOrigin;
  readonly actorKey: string;
  readonly titleKey: string;
  readonly summaryKey: string;
  readonly detailKey: string;
  readonly entityId: string;
  readonly targetDossierId: HubActivityDossierId;
  readonly guideId: HubActivityGuideId;
  readonly attention: boolean;
  readonly afterRefresh?: boolean;
}

export interface HubActivityFilters {
  readonly kind: HubActivityKind | 'all';
  readonly period: HubActivityPeriod;
  readonly origin: HubActivityOrigin | 'all';
  readonly query: string;
  readonly attention: boolean;
}

/** Fixed demonstration snapshot: October 28 at 14:30 in Toronto. */
export const HUB_ACTIVITY_SNAPSHOT = '2026-10-28T18:30:00Z';
export const HUB_ACTIVITY_TIMEZONE = 'America/Toronto';

const periodStarts: Readonly<
  Record<Exclude<HubActivityPeriod, 'all'>, string>
> = {
  today: '2026-10-28T04:00:00Z',
  week: '2026-10-26T04:00:00Z'
};

const newestFirst = (left: HubActivity, right: HubActivity): number =>
  Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
  left.id.localeCompare(right.id);

/** Periods belong to the fixed snapshot, never to the browser's current date. */
export function hubActivitiesForPeriod(
  activities: readonly HubActivity[],
  period: HubActivityPeriod
): readonly HubActivity[] {
  const start = period === 'all' ? -Infinity : Date.parse(periodStarts[period]);
  const end = Date.parse(HUB_ACTIVITY_SNAPSHOT);
  return activities
    .filter((activity) => {
      const date = Date.parse(activity.occurredAt);
      return date >= start && date <= end;
    })
    .sort(newestFirst);
}

/** The metric and its drilldown use this same latest event per unique entity. */
export function hubMetricItems(
  kind: HubActivityKind,
  activities: readonly HubActivity[]
): readonly HubActivity[] {
  const latest = new Map<string, HubActivity>();
  for (const activity of activities
    .filter((item) => item.kind === kind)
    .sort(newestFirst)) {
    if (!latest.has(activity.entityId)) latest.set(activity.entityId, activity);
  }
  return [...latest.values()];
}

type FixtureActivity = Omit<
  HubActivity,
  'actorKey' | 'titleKey' | 'summaryKey' | 'detailKey'
> & { readonly copy: string };

function activityFixture({ copy, ...activity }: FixtureActivity): HubActivity {
  return {
    ...activity,
    actorKey: `activityHubJournal.actors.${activity.origin}`,
    titleKey: `activityHubJournal.events.${copy}.title`,
    summaryKey: `activityHubJournal.events.${copy}.summary`,
    detailKey: `activityHubJournal.events.${copy}.detail`
  };
}

/** Synthetic events only. Repeated media events deliberately share an entity. */
export const HUB_ACTIVITIES: readonly HubActivity[] = [
  activityFixture({
    id: 'activity-ready-boreal-28',
    occurredAt: '2026-10-28T13:12:00Z',
    kind: 'ready',
    origin: 'human',
    copy: 'readyBoreal',
    entityId: 'DEMO-DOSSIER-BOREAL',
    targetDossierId: 'atelier-boreal',
    guideId: 'guide-services',
    attention: true
  }),
  activityFixture({
    id: 'activity-media-boreal-28',
    occurredAt: '2026-10-28T14:04:00Z',
    kind: 'media',
    origin: 'automatic',
    copy: 'mediaBoreal',
    entityId: 'DEMO-MEDIA-BOREAL-01',
    targetDossierId: 'atelier-boreal',
    guideId: 'guide-exceptions',
    attention: true
  }),
  activityFixture({
    id: 'activity-rules-media-28',
    occurredAt: '2026-10-28T15:18:00Z',
    kind: 'rules',
    origin: 'automatic',
    copy: 'rulesMedia',
    entityId: 'DEMO-REGLE-MEDIA-01',
    targetDossierId: 'collectif-rivages',
    guideId: 'guide-context',
    attention: false
  }),
  activityFixture({
    id: 'activity-preparation-rivages-28',
    occurredAt: '2026-10-28T18:05:00Z',
    kind: 'preparation',
    origin: 'human',
    copy: 'preparationRivages',
    entityId: 'DEMO-PREPARATION-RIVAGES-01',
    targetDossierId: 'collectif-rivages',
    guideId: 'guide-human',
    attention: true
  }),
  activityFixture({
    id: 'activity-ready-rivages-27',
    occurredAt: '2026-10-27T13:30:00Z',
    kind: 'ready',
    origin: 'human',
    copy: 'readyRivages',
    entityId: 'DEMO-DOSSIER-RIVAGES',
    targetDossierId: 'collectif-rivages',
    guideId: 'guide-services',
    attention: false
  }),
  activityFixture({
    id: 'activity-media-boreal-27',
    occurredAt: '2026-10-27T14:10:00Z',
    kind: 'media',
    origin: 'human',
    copy: 'mediaBorealEarlier',
    entityId: 'DEMO-MEDIA-BOREAL-01',
    targetDossierId: 'atelier-boreal',
    guideId: 'guide-exceptions',
    attention: false
  }),
  activityFixture({
    id: 'activity-media-rivages-27',
    occurredAt: '2026-10-27T16:20:00Z',
    kind: 'media',
    origin: 'automatic',
    copy: 'mediaRivages',
    entityId: 'DEMO-MEDIA-RIVAGES-01',
    targetDossierId: 'collectif-rivages',
    guideId: 'guide-exceptions',
    attention: false
  }),
  activityFixture({
    id: 'activity-rules-consent-27',
    occurredAt: '2026-10-27T18:00:00Z',
    kind: 'rules',
    origin: 'human',
    copy: 'rulesConsent',
    entityId: 'DEMO-REGLE-CONSENTEMENT-02',
    targetDossierId: 'studio-canopée',
    guideId: 'guide-context',
    attention: true
  }),
  activityFixture({
    id: 'activity-media-canopee-26',
    occurredAt: '2026-10-26T14:45:00Z',
    kind: 'media',
    origin: 'human',
    copy: 'mediaCanopee',
    entityId: 'DEMO-MEDIA-CANOPEE-01',
    targetDossierId: 'studio-canopée',
    guideId: 'guide-exceptions',
    attention: false
  }),
  activityFixture({
    id: 'activity-ready-canopee-26',
    occurredAt: '2026-10-26T17:00:00Z',
    kind: 'ready',
    origin: 'human',
    copy: 'readyCanopee',
    entityId: 'DEMO-DOSSIER-CANOPEE',
    targetDossierId: 'studio-canopée',
    guideId: 'guide-services',
    attention: true
  }),
  activityFixture({
    id: 'activity-preparation-boreal-23',
    occurredAt: '2026-10-23T15:00:00Z',
    kind: 'preparation',
    origin: 'human',
    copy: 'preparationBorealEarlier',
    entityId: 'DEMO-PREPARATION-BOREAL-01',
    targetDossierId: 'atelier-boreal',
    guideId: 'guide-human',
    attention: false
  }),
  activityFixture({
    id: 'activity-media-canopee-refresh',
    occurredAt: '2026-10-28T18:30:00Z',
    kind: 'media',
    origin: 'automatic',
    copy: 'mediaCanopeeRefresh',
    entityId: 'DEMO-MEDIA-CANOPEE-02',
    targetDossierId: 'studio-canopée',
    guideId: 'guide-exceptions',
    attention: true,
    afterRefresh: true
  })
];
