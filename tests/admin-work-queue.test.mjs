import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorkQueueItems,
  getAdminWorkQueue,
  paginateWorkQueue,
  parseWorkQueueQuery
} from '../dist/apps/funding-api/src/admin-work-queue.service.js';

const now = new Date('2026-09-15T14:00:00Z');
const dataset = (overrides = {}) => ({
  now,
  sponsorships: [],
  sponsorshipsTruncated: false,
  drafts: [],
  batches: [],
  slots: [],
  emailMessages: [],
  financialTotals: { grossPaid: 0, refunded: 0, disputed: 0, currency: 'CAD' },
  ...overrides
});
const event = (
  id,
  status = 'failed',
  received_at = '2026-09-15T13:00:00Z'
) => ({ id, status, event_type: 'payment_intent.succeeded', received_at });
const slot = (overrides = {}) => ({
  id: 'slot-1',
  status: 'scheduled',
  startsAt: '2026-09-14T14:00:00Z',
  channel: 'facebook',
  ...overrides
});
const batch = (overrides = {}) => ({
  id: 'batch-1',
  slotId: 'slot-1',
  status: 'scheduled',
  scheduledAt: '2026-09-14T14:00:00Z',
  channel: 'facebook',
  ...overrides
});
const draft = (overrides = {}) => ({
  id: 'draft-1',
  contribution_id: 'c-1',
  slot_id: null,
  batch_id: 'batch-1',
  status: 'scheduled',
  scheduled_at: '2026-09-14T14:00:00Z',
  channel: 'facebook',
  ...overrides
});

test('all results beyond the old 100-item cap remain reachable with global counts', () => {
  const items = buildWorkQueueItems(
    dataset(),
    [],
    Array.from({ length: 231 }, (_, i) =>
      event(`evt_${String(i).padStart(4, '0')}`)
    )
  );
  const seen = new Set();
  for (let page = 1; page <= 10; page++) {
    const response = paginateWorkQueue(items, now, { page, pageSize: 25 });
    assert.equal(response.total, 231);
    assert.equal(response.counts.urgent, 231);
    assert.equal(response.filteredTotal, 231);
    assert.equal(response.todayTotal, 231);
    response.items.forEach((item) => seen.add(item.id));
  }
  assert.equal(seen.size, 231);
  assert.equal(paginateWorkQueue(items, now, { page: 999 }).page, 10);
});

test('combined filters count the filtered dataset before pagination', () => {
  const items = buildWorkQueueItems(
    dataset(),
    [{ id: 'c-1', reference: 'TEST-1', paid_at: null }],
    [event('evt_1')]
  );
  const response = paginateWorkQueue(items, now, {
    type: 'invoice_missing',
    priority: 'today',
    due: 'undated'
  });
  assert.equal(response.total, 2);
  assert.equal(response.filteredTotal, 1);
  assert.equal(response.typeCounts.stripe_event_failed, 1);
  assert.equal(
    response.items[0].adminUrl,
    '/admin/fundraiser/invoices?contributionId=c-1'
  );
  assert.equal(
    paginateWorkQueue(items, now, {
      type: 'invoice_missing',
      priority: 'urgent'
    }).filteredTotal,
    0
  );
});

test('Stripe processing becomes actionable at 15 minutes, never for completed events', () => {
  const items = buildWorkQueueItems(
    dataset(),
    [],
    [
      event('young', 'processing', '2026-09-15T13:45:01Z'),
      event('boundary', 'processing', '2026-09-15T13:45:00Z'),
      event('done', 'processed'),
      event('failed')
    ]
  );
  assert.deepEqual(items.map((item) => item.id).sort(), [
    'stripe_event_failed:failed',
    'stripe_event_stalled:boundary'
  ]);
  assert.match(items[1].adminUrl, /itemId=stripe_event_stalled%3Aboundary/);
});

test('slot, batch and draft yield one late alert for a shared placement', () => {
  const ds = dataset({
    slots: [slot()],
    batches: [batch()],
    drafts: [draft()]
  });
  const items = buildWorkQueueItems(ds);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'publication_late:slot:slot-1');
  assert.equal(
    items[0].adminUrl,
    '/admin/fundraiser/publications?slotId=slot-1'
  );
  assert.equal(
    buildWorkQueueItems(
      dataset({ batches: [batch({ slotId: null })], drafts: [draft()] })
    ).length,
    1
  );
});

test('standalone scheduled drafts are late, completed/cancelled objects are absent', () => {
  const items = buildWorkQueueItems(
    dataset({
      slots: [slot({ status: 'published' })],
      batches: [batch({ status: 'cancelled' })],
      drafts: [draft({ batch_id: null })]
    })
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'publication_late:draft:draft-1');
  assert.equal(
    buildWorkQueueItems(dataset({ drafts: [draft({ status: 'published' })] }))
      .length,
    0
  );
});

test('a ready batch covers its approved drafts, an unapproved batch is not ready', () => {
  const ds = dataset({
    batches: [batch({ status: 'open', slotId: null, scheduledAt: null })],
    drafts: [draft({ status: 'approved', scheduled_at: null })]
  });
  const items = buildWorkQueueItems(ds);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'publication_ready:batch:batch-1');
  assert.equal(
    buildWorkQueueItems({
      ...ds,
      drafts: [draft({ status: 'pending_review' })]
    }).length,
    0
  );
});

test('upcoming slots have a seven-day window and Toronto calendar priority', () => {
  const items = buildWorkQueueItems(
    dataset({
      slots: [
        slot({ id: 'today', startsAt: '2026-09-16T01:00:00Z' }),
        slot({ id: 'week', startsAt: '2026-09-22T14:00:00Z' }),
        slot({ id: 'later', startsAt: '2026-09-22T14:00:01Z' })
      ]
    })
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].severity, 'today');
  assert.equal(items[1].severity, 'this_week');
  assert.equal(
    paginateWorkQueue(items, now, { due: 'today' }).filteredTotal,
    1
  );
});

test('Toronto day boundaries hold across daylight-saving transitions', () => {
  const winter = new Date('2026-11-01T05:30:00Z');
  const items = buildWorkQueueItems(
    dataset({
      now: winter,
      slots: [slot({ startsAt: '2026-11-02T04:30:00Z' })]
    })
  );
  assert.equal(items[0].severity, 'today');
});

test('stable sorting does not depend on repository result order and duplicate IDs collapse', () => {
  const first = buildWorkQueueItems(
    dataset(),
    [],
    [event('z'), event('a'), event('a')]
  );
  const second = buildWorkQueueItems(dataset(), [], [event('a'), event('z')]);
  assert.deepEqual(first, second);
});

test('email links are exact and private recipient/errors are absent', () => {
  const items = buildWorkQueueItems(
    dataset({
      emailMessages: [
        {
          id: 'old-email',
          status: 'failed',
          attempts: 2,
          max_attempts: 3,
          template_key: 'test',
          recipient_email: 'private@example.invalid',
          last_error: 'auth password=private-value'
        }
      ]
    })
  );
  assert.equal(
    items[0].adminUrl,
    '/admin/fundraiser/email-queue?messageId=old-email'
  );
  assert.doesNotMatch(
    JSON.stringify(items),
    /private@|private-value|password=/
  );
});

test('resolved items disappear on a fresh projection, including direct item lookup', () => {
  const items = buildWorkQueueItems(
    dataset(),
    [],
    [event('resolved', 'processed')]
  );
  assert.equal(
    paginateWorkQueue(items, now, { itemId: 'stripe_event_failed:resolved' })
      .filteredTotal,
    0
  );
});

test('query parser rejects invalid filters, fractions, overflow and oversized pages', () => {
  for (const query of [
    'page=0',
    'page=1.5',
    'page=Infinity',
    'pageSize=101',
    'type=anything',
    'priority=low',
    'due=tomorrow'
  ])
    assert.throws(() => parseWorkQueueQuery(new URLSearchParams(query)));
  assert.equal(
    parseWorkQueueQuery(
      new URLSearchParams('page=3&type=email_delivery_failed')
    ).page,
    3
  );
});

test('absent database or missing tables never look like an empty operational queue', async () => {
  assert.equal((await getAdminWorkQueue(null)).available, false);
  const missing = await getAdminWorkQueue({
    query: async () => ({ rows: [] })
  });
  assert.equal(missing.coverage, 'unavailable');
  assert.ok(missing.missingSources.includes('sponsor_publication_batches'));
  assert.equal(paginateWorkQueue([], now).available, true);
});
