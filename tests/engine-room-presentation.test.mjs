import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readableDuration,
  aggregateWidth
} from '../dist/apps/funding-web/src/app/features/funding/components/admin-flow-measurement/flow-presentation.js';

test('durations retain zero, distinguish unmeasured values and format source seconds for FR/EN', () => {
  assert.equal(readableDuration(350014, 'fr-CA'), '4 j 1 h');
  assert.equal(readableDuration(1120702, 'fr-CA'), '12 j 23 h');
  assert.equal(readableDuration(350014, 'en'), '4 d 1 h');
  assert.equal(readableDuration(60, 'en'), '1 min 0 s');
  assert.equal(readableDuration(0, 'fr-CA'), '0 s');
  for (const value of [null, undefined, NaN, Infinity, -1])
    assert.equal(readableDuration(value, 'en'), null);
});

test('aggregate comparison has no invented timeline, rate or nonzero empty bar', () => {
  assert.equal(aggregateWidth(0, 0), 0);
  assert.equal(aggregateWidth(0, 8), 0);
  assert.equal(aggregateWidth(8, 0), 100);
  assert.equal(aggregateWidth(3, 6), 50);
});
