import assert from 'node:assert/strict';
import test from 'node:test';

import { formatCockpitDateTime } from '../dist/apps/funding-web/src/app/features/funding/components/admin-cockpit/admin-cockpit-date-time.js';

test('cockpit timestamp labels keep Toronto calendar dates in both administration languages', () => {
  const value = '2026-01-01T02:00:00Z';
  assert.equal(formatCockpitDateTime(value, 'fr-CA'), '2025-12-31 21 h 00');
  assert.equal(formatCockpitDateTime(value, 'en'), '12/31/25, 9:00 PM');
  assert.equal(formatCockpitDateTime(value, 'fr-CA'), '2025-12-31 21 h 00');
});

test('cockpit timestamp labels preserve Toronto daylight saving transitions', () => {
  for (const [iso, french, english] of [
    ['2026-03-08T06:59:00Z', '2026-03-08 01 h 59', '3/8/26, 1:59 AM'],
    ['2026-03-08T07:00:00Z', '2026-03-08 03 h 00', '3/8/26, 3:00 AM'],
    ['2026-11-01T05:30:00Z', '2026-11-01 01 h 30', '11/1/26, 1:30 AM'],
    ['2026-11-01T06:30:00Z', '2026-11-01 01 h 30', '11/1/26, 1:30 AM']
  ]) {
    assert.equal(formatCockpitDateTime(iso, 'fr-CA'), french);
    assert.equal(formatCockpitDateTime(iso, 'en'), english);
  }
});

test('invalid cockpit timestamps keep their existing formatting error', () => {
  for (const value of ['', 'invalid timestamp'])
    assert.throws(() => formatCockpitDateTime(value, 'fr-CA'), RangeError);
});
