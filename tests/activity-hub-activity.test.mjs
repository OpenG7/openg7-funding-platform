import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import ts from 'typescript';

const source = readFileSync(
  new URL(
    '../apps/funding-web/src/app/features/funding/activity-hub/activity-hub-activity.ts',
    import.meta.url
  ),
  'utf8'
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS
  }
}).outputText;
const exports = {};
// Exercise the private, pure presentation model without starting Angular,
// a browser, a build, or a real administrative data source.
new Function('exports', 'require', transpiled)(exports, () => {
  throw new Error(
    'Synthetic activity selectors must not load runtime clients.'
  );
});
const {
  HUB_ACTIVITIES,
  HUB_ACTIVITY_SNAPSHOT,
  HUB_ACTIVITY_TIMEZONE,
  hubActivitiesForPeriod,
  hubMetricItems
} = exports;
const initial = HUB_ACTIVITIES.filter((activity) => !activity.afterRefresh);
const sample = initial[0];
const eventAt = (id, occurredAt, overrides = {}) => ({
  ...sample,
  id,
  occurredAt,
  entityId: `DEMO-ENTITY-${id}`,
  ...overrides
});

test('the fixed snapshot separates today, this week and older synthetic activity', () => {
  assert.equal(HUB_ACTIVITY_SNAPSHOT, '2026-10-28T18:30:00Z');
  assert.equal(HUB_ACTIVITY_TIMEZONE, 'America/Toronto');
  assert.equal(hubActivitiesForPeriod(initial, 'today').length, 4);
  assert.equal(hubActivitiesForPeriod(initial, 'week').length, 10);
  assert.equal(hubActivitiesForPeriod(initial, 'all').length, 11);
  assert.ok(
    !hubActivitiesForPeriod(initial, 'week').some(
      (activity) => activity.id === 'activity-preparation-boreal-23'
    )
  );
});

test('Toronto midnight bounds are inclusive and do not follow the UTC calendar day', () => {
  const activities = [
    eventAt('day-before', '2026-10-28T03:59:59Z'),
    eventAt('day-start', '2026-10-28T04:00:00Z'),
    eventAt('week-before', '2026-10-26T03:59:59Z'),
    eventAt('week-start', '2026-10-26T04:00:00Z')
  ];
  assert.deepEqual(
    hubActivitiesForPeriod(activities, 'today').map((activity) => activity.id),
    ['day-start']
  );
  assert.deepEqual(
    hubActivitiesForPeriod(activities, 'week').map((activity) => activity.id),
    ['day-start', 'day-before', 'week-start']
  );
});

test('future and invalid timestamps never appear, including in the all-period view', () => {
  const activities = [
    eventAt('at-snapshot', HUB_ACTIVITY_SNAPSHOT),
    eventAt('future', '2026-10-28T18:30:01Z'),
    eventAt('invalid', 'not-a-timestamp')
  ];
  for (const period of ['today', 'week', 'all'])
    assert.deepEqual(
      hubActivitiesForPeriod(activities, period).map((activity) => activity.id),
      ['at-snapshot']
    );
});

test('weekly metrics count unique entities and retain the latest matching event', () => {
  const week = hubActivitiesForPeriod(initial, 'week');
  assert.deepEqual(
    Object.fromEntries(
      ['ready', 'media', 'rules', 'preparation'].map((kind) => [
        kind,
        hubMetricItems(kind, week).length
      ])
    ),
    { ready: 3, media: 3, rules: 2, preparation: 1 }
  );
  const media = hubMetricItems('media', [...week].reverse());
  assert.deepEqual(
    media.map((activity) => activity.id),
    [
      'activity-media-boreal-28',
      'activity-media-rivages-27',
      'activity-media-canopee-26'
    ]
  );
  assert.equal(
    media.find((activity) => activity.entityId === 'DEMO-MEDIA-BOREAL-01')
      .origin,
    'automatic'
  );
});

test('deduplication remains scoped to the requested activity kind and breaks ties deterministically', () => {
  const timestamp = '2026-10-28T10:00:00Z';
  const activities = [
    eventAt('z-media', timestamp, { kind: 'media', entityId: 'DEMO-SHARED' }),
    eventAt('a-media', timestamp, { kind: 'media', entityId: 'DEMO-SHARED' }),
    eventAt('other-kind', '2026-10-28T11:00:00Z', {
      kind: 'rules',
      entityId: 'DEMO-SHARED'
    })
  ];
  assert.deepEqual(
    hubMetricItems('media', activities).map((activity) => activity.id),
    ['a-media']
  );
  assert.deepEqual(
    hubMetricItems('rules', activities).map((activity) => activity.id),
    ['other-kind']
  );
});

test('refresh adds one event and one new media entity without inflating repeated events', () => {
  const refreshedWeek = hubActivitiesForPeriod(HUB_ACTIVITIES, 'week');
  assert.equal(hubActivitiesForPeriod(HUB_ACTIVITIES, 'today').length, 5);
  assert.equal(refreshedWeek.length, 11);
  assert.equal(hubMetricItems('media', refreshedWeek).length, 4);
  assert.equal(
    hubMetricItems('media', [...refreshedWeek, ...refreshedWeek]).length,
    4
  );
  assert.equal(hubMetricItems('ready', refreshedWeek).length, 3);
});

test('selectors preserve frozen source order and handle an empty dataset', () => {
  const activities = Object.freeze([...initial].reverse());
  const ids = activities.map((activity) => activity.id);
  hubActivitiesForPeriod(activities, 'week');
  hubMetricItems('media', activities);
  assert.deepEqual(
    activities.map((activity) => activity.id),
    ids
  );
  assert.deepEqual(hubActivitiesForPeriod([], 'week'), []);
  assert.deepEqual(hubMetricItems('ready', []), []);
});

test('all example destinations and guide references remain inside the known synthetic demo', () => {
  const dossierIds = new Set([
    'atelier-boreal',
    'collectif-rivages',
    'studio-canopée'
  ]);
  const guideIds = new Set([
    'guide-exceptions',
    'guide-context',
    'guide-human',
    'guide-services'
  ]);
  assert.equal(
    new Set(HUB_ACTIVITIES.map((activity) => activity.id)).size,
    HUB_ACTIVITIES.length
  );
  for (const activity of HUB_ACTIVITIES) {
    assert.ok(dossierIds.has(activity.targetDossierId), activity.id);
    assert.ok(guideIds.has(activity.guideId), activity.id);
    assert.match(activity.entityId, /^DEMO-/);
  }
});
