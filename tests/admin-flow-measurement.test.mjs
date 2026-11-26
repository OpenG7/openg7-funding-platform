import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectFlowMeasurement,
  unavailableFlowMeasurement
} from '../dist/apps/funding-api/src/admin-flow-measurement.js';
import { readFlowMeasurement } from '../dist/apps/funding-api/src/admin-flow-measurement.repository.js';
import { readEngineRoom } from '../dist/apps/funding-api/src/admin-engine-room.service.js';
import { HumanWorkSample } from '../dist/apps/funding-web/src/app/features/funding/components/admin-flow-measurement/human-work-sample.js';

const now = new Date('2026-11-25T12:00:00Z');
const day = 86400000;
const iso = (days) => new Date(now.getTime() - days * day).toISOString();
const fact = (id, extra = {}) => ({
  obligation: {
    id,
    channel: 'facebook',
    target: 'openg7',
    format: 'collective_text',
    state: 'pending',
    timing: { dueAt: iso(-1) }
  },
  createdAt: iso(2),
  qualifiedDeliveredAt: null,
  mode: 'live',
  ...extra
});
test('seven day half-open boundaries, unique obligations, waivers and unproven flags are distinct', () => {
  const rows = [
    fact('a', { createdAt: iso(7) }),
    fact('a', { createdAt: iso(7) }),
    fact('b', { createdAt: iso(0) }),
    fact('c', { qualifiedDeliveredAt: iso(7) }),
    fact('d', { qualifiedDeliveredAt: iso(0) }),
    fact('e', {
      obligation: { ...fact('e').obligation, state: 'adjusted' },
      qualifiedDeliveredAt: iso(1)
    }),
    fact('f', { obligation: { ...fact('f').obligation, state: 'fulfilled' } })
  ];
  const m = projectFlowMeasurement(rows, 2, {}, now);
  assert.equal(m.totals.population, 6);
  assert.equal(m.totals.entries, 5);
  assert.equal(m.totals.qualifiedExits, 1);
  assert.equal(m.totals.qualified, 2);
  assert.equal(m.totals.adjusted, 1);
  assert.equal(m.totals.open, 3);
  assert.equal(m.totals.cycleSamples, 0); // proof precedes creation: not a valid cycle sample
  assert.equal(m.humanActiveSeconds, null);
  assert.equal(m.autonomyRate, null);
});
test('age percentiles, cycle samples and unknown dates expose denominators', () => {
  const a = fact('a');
  const m = projectFlowMeasurement(
    [
      fact('one', { createdAt: iso(1) }),
      fact('two', { createdAt: iso(3) }),
      fact('bad', {
        createdAt: 'invalid',
        obligation: { ...a.obligation, id: 'bad', timing: null }
      }),
      fact('future', { createdAt: iso(-1), qualifiedDeliveredAt: iso(-2) }),
      fact('done', { createdAt: iso(4), qualifiedDeliveredAt: iso(1) }),
      fact('late', {
        createdAt: iso(5),
        obligation: { ...a.obligation, id: 'late', timing: { dueAt: iso(1) } }
      })
    ],
    0,
    {},
    now
  );
  assert.equal(m.totals.ageSamples, 3);
  assert.equal(m.totals.unknownAge, 2);
  assert.equal(m.totals.medianAgeSeconds, 3 * 86400);
  assert.equal(m.totals.p95AgeSeconds, 5 * 86400);
  assert.equal(m.totals.oldestAgeSeconds, 5 * 86400);
  assert.equal(m.totals.cycleSamples, 1);
  assert.equal(m.totals.medianCycleSeconds, 3 * 86400);
  assert.equal(m.totals.overdue, 1);
  assert.equal(m.totals.undated, 1);
});
test('even sample medians average the two middle values while P95 uses nearest upper rank', () => {
  const m = projectFlowMeasurement(
    [fact('one', { createdAt: iso(1) }), fact('two', { createdAt: iso(3) })],
    0,
    {},
    now
  );
  assert.equal(m.totals.medianAgeSeconds, 2 * 86400);
  assert.equal(m.totals.p95AgeSeconds, 3 * 86400);
});
test('cohort dimensions remain distinct and reconcile exactly to the snapshot', () => {
  const a = fact('a');
  const m = projectFlowMeasurement(
    [
      a,
      fact('b', { mode: 'mock' }),
      fact('c', { mode: 'unknown' }),
      fact('d', {
        obligation: { ...a.obligation, id: 'd', target: 'openg20' }
      }),
      fact('e', {
        obligation: { ...a.obligation, id: 'e', format: null, timing: null }
      })
    ],
    0,
    {},
    now
  );
  assert.equal(m.cohorts.length, 5);
  for (const key of [
    'population',
    'entries',
    'qualifiedExits',
    'open',
    'qualified',
    'adjusted',
    'overdue',
    'undated'
  ])
    assert.equal(
      m.cohorts.reduce((sum, c) => sum + c[key], 0),
      m.totals[key]
    );
});
test('empty known population is zero but empty samples and unavailable populations remain unknown', async () => {
  const m = projectFlowMeasurement([], 0, {}, now);
  assert.equal(m.totals.open, 0);
  assert.equal(m.totals.medianAgeSeconds, null);
  assert.equal(unavailableFlowMeasurement({}, now).totals, null);
  assert.equal((await readFlowMeasurement(null, {}, now)).totals, null);
  assert.equal(
    (
      await readFlowMeasurement(
        { connect: () => assert.fail('invalid scope read') },
        { sponsorshipId: 'bad' },
        now
      )
    ).status,
    'unavailable'
  );
});
test('snapshot errors roll back, release and return no private diagnostic or fabricated zero', async () => {
  const calls = [];
  const result = await readFlowMeasurement(
    {
      connect: async () => ({
        query: async (sql) => {
          calls.push(sql);
          if (sql.startsWith('SELECT')) throw Error('private');
          return { rows: [] };
        },
        release: () => calls.push('release')
      })
    },
    {},
    now
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(result.totals, null);
  assert.equal(calls[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.deepEqual(calls.slice(-2), ['ROLLBACK', 'release']);
  assert.equal(JSON.stringify(result).includes('private'), false);
});
test('flow observation failure is independent of native engine reads and scope is exact', async () => {
  const scope = { deliveryId: '11111111-1111-4111-8111-111111111111' };
  const result = await readEngineRoom(
    {
      connectorEnabled: false,
      localPreparationEnabled: false,
      connector: async () => null,
      publications: async () => ({
        workerEnabled: false,
        feeds: [],
        deliveries: []
      }),
      flowMeasurement: async (input) => {
        assert.deepEqual(input, scope);
        throw Error('private');
      }
    },
    scope,
    () => now
  );
  assert.equal(result.flowMeasurement, null);
  assert.equal(result.publications.available, true);
});
test('voluntary clock excludes pauses, handles categories, ignores repeated starts and erases all samples', () => {
  const sample = new HumanWorkSample();
  assert.deepEqual(Object.values(sample.seconds(10000)), [0, 0, 0, 0]);
  sample.start('diagnostic', 1000);
  sample.start('review', 1500);
  assert.equal(sample.seconds(3000).diagnostic, 2);
  sample.pause(4500);
  sample.pause(10000);
  assert.equal(sample.seconds(20000).diagnostic, 3);
  sample.start('review', 20000);
  sample.pause(22500);
  assert.equal(sample.seconds(30000).review, 2);
  sample.start('recovery', 30000);
  sample.pause(29000);
  assert.equal(sample.seconds(30000).recovery, 0);
  sample.clear();
  assert.equal(sample.running, false);
  assert.deepEqual(Object.values(sample.seconds(100000)), [0, 0, 0, 0]);
});
