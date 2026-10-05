import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publicationDateTimeLocal,
  publicationDateTimeUtc,
  updatedPublicationDateTime
} from '../dist/apps/funding-web/src/app/features/funding/pages/admin-publications-page/publication-panels.helpers.js';

test('publication input and conversion use the selected IANA zone in summer and winter', () => {
  for (const [zone, instant, local] of [
    ['America/Toronto', '2030-06-03T14:00:00Z', '2030-06-03T10:00'],
    ['America/Toronto', '2030-01-03T14:00:00Z', '2030-01-03T09:00'],
    ['Europe/Paris', '2030-06-03T14:00:00Z', '2030-06-03T16:00'],
    ['Asia/Kathmandu', '2030-06-03T14:00:00Z', '2030-06-03T19:45']
  ]) {
    assert.equal(publicationDateTimeLocal(instant, zone), local);
    assert.equal(
      publicationDateTimeUtc(local, zone),
      new Date(instant).toISOString()
    );
  }
});

test('unchanged civil time preserves the exact original instant including a repeated DST time', () => {
  for (const instant of [
    '2030-06-03T14:00:42.123456Z',
    '2030-11-03T05:30:00Z',
    '2030-11-03T06:30:00Z'
  ]) {
    const local = publicationDateTimeLocal(instant);
    assert.equal(updatedPublicationDateTime(local, instant), instant);
  }
  assert.equal(updatedPublicationDateTime('', '2030-06-03T14:00:00Z'), null);
  assert.equal(
    updatedPublicationDateTime(
      '2030-06-03T10:00',
      '2030-06-03T14:00:00Z',
      'Europe/Paris',
      'America/Toronto'
    ),
    '2030-06-03T08:00:00.000Z'
  );
});

test('invalid dates, invalid zones, missing and repeated DST times never choose an instant', () => {
  for (const value of [
    'invalid',
    '2030-02-31T10:00',
    '2030-03-10T02:30',
    '2030-11-03T01:30'
  ]) {
    assert.throws(() => publicationDateTimeUtc(value), RangeError);
  }
  assert.throws(
    () => publicationDateTimeUtc('2030-06-03T10:00', 'Invalid/Zone'),
    RangeError
  );
});
