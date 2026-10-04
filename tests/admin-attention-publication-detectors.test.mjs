import assert from 'node:assert/strict';
import test from 'node:test';

import { detectLatePublicationItems } from '../dist/apps/funding-api/src/admin-assistant/attention.service.js';

const NOW = new Date('2026-07-24T00:00:00.000Z');
const publication = {
  channel: 'facebook',
  capacity: 5,
  capacityUsed: 2
};
const dataset = (scheduledAt, status = 'scheduled') => ({
  now: NOW,
  slots: [
    {
      ...publication,
      id: 'attention-slot-demo',
      feedTarget: 'openg7',
      startsAt: scheduledAt,
      status
    }
  ],
  batches: [
    {
      ...publication,
      id: 'attention-batch-demo',
      scheduledAt,
      status
    }
  ]
});

test('late slots and batches become urgent after two full elapsed days', () => {
  for (const [scheduledAt, severity] of [
    ['2026-07-24T00:00:00.000Z', 'today'],
    ['2026-07-22T00:00:00.001Z', 'today'],
    ['2026-07-22T00:00:00.000Z', 'urgent']
  ]) {
    const items = detectLatePublicationItems(dataset(scheduledAt));
    assert.equal(items.length, 2, scheduledAt);
    assert.deepEqual(
      items.map((item) => item.severity),
      [severity, severity],
      scheduledAt
    );
    assert.deepEqual(
      items.map((item) => item.dueAt),
      [scheduledAt, scheduledAt],
      scheduledAt
    );
  }
});

test('late open slots are actionable while only scheduled batches are detected', () => {
  const items = detectLatePublicationItems(
    dataset('2026-07-22T00:00:00.000Z', 'open')
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ['publication_late:slot:attention-slot-demo']
  );
});

test('published and cancelled schedules do not create late attention items', () => {
  for (const status of ['published', 'cancelled']) {
    assert.deepEqual(
      detectLatePublicationItems(dataset('2026-07-22T00:00:00.000Z', status)),
      [],
      status
    );
  }
});
