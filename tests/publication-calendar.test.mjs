import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publicationDay,
  publicationMonthDays,
  shiftCalendarMonth,
  sortCalendarEntries
} from '../dist/apps/funding-web/src/app/features/funding/components/admin-publications/publication-calendar.js';

test('calendar days use Toronto time across midnight and daylight saving changes', () => {
  assert.equal(publicationDay('2030-06-04T02:00:00Z'), '2030-06-03');
  assert.equal(publicationDay('2030-01-04T04:30:00Z'), '2030-01-03');
  assert.equal(publicationDay('2026-03-08T06:59:00Z'), '2026-03-08');
  assert.equal(publicationDay('2026-03-08T07:01:00Z'), '2026-03-08');
  assert.equal(publicationDay('invalid'), null);
  assert.equal(publicationDay(null), null);
});

test('monthly calendar includes leap days and complete weeks across year boundaries', () => {
  const leap = publicationMonthDays('2028-02');
  assert.equal(leap.length, 42);
  assert.equal(new Set(leap).size, 42);
  assert.equal(leap[0], '2028-01-31');
  assert(leap.includes('2028-02-29'));
  assert(!publicationMonthDays('2027-02').includes('2027-02-29'));
  const january = publicationMonthDays('2030-01');
  assert.equal(january[0], '2029-12-31');
  assert.equal(january.at(-1), '2030-02-10');
  assert.equal(shiftCalendarMonth('2030-01', -1), '2029-12');
  assert.equal(shiftCalendarMonth('2029-12', 1), '2030-01');
});

test('calendar entries sort by instant with deterministic ties and undated items last without mutating input', () => {
  const input = Object.freeze([
    { id: 'undated', startsAt: null },
    { id: 'later', startsAt: '2030-06-04T10:00:00Z' },
    { id: 'tie-b', startsAt: '2030-06-03T14:00:00Z' },
    { id: 'tie-a', startsAt: '2030-06-03T10:00:00-04:00' },
    { id: 'invalid', startsAt: 'invalid' }
  ]);
  assert.deepEqual(
    sortCalendarEntries(input).map((entry) => entry.id),
    ['tie-a', 'tie-b', 'later', 'invalid', 'undated']
  );
  assert.equal(input[0].id, 'undated');
});
