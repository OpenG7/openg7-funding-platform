import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publicationFeedSettingsSnapshot,
  samePublicationFeedSettings
} from '../dist/packages/funding-core/src/index.js';

const settings = {
  id: 'openg7:facebook',
  paused: true,
  autoPrepare: false,
  timezone: 'America/Toronto',
  weekdays: [3, 1],
  localTime: '09:00',
  capacity: 3,
  horizonDays: 7
};
test('settings comparison excludes provider observations and normalizes weekday order without mutating inputs', () => {
  const snapshot = publicationFeedSettingsSnapshot({
    ...settings,
    connection: 'error',
    accountId: 'synthetic-account',
    mode: 'mock'
  });
  assert.deepEqual(snapshot, { ...settings, weekdays: [1, 3] });
  assert.deepEqual(settings.weekdays, [3, 1]);
  assert.notEqual(snapshot.weekdays, settings.weekdays);
  assert.ok(
    samePublicationFeedSettings(settings, { ...settings, weekdays: [1, 3] })
  );
  for (const [field, value] of Object.entries({
    id: 'openg20:facebook',
    paused: false,
    autoPrepare: true,
    timezone: 'Europe/Paris',
    weekdays: [1],
    localTime: '10:00',
    capacity: 4,
    horizonDays: 8
  })) {
    assert.equal(
      samePublicationFeedSettings(settings, { ...settings, [field]: value }),
      false,
      field
    );
  }
});
