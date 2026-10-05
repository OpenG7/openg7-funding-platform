import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORK_QUEUE_PRIORITIES,
  buildWorkQueueItems,
  getAdminWorkQueue,
  loadAdminWorkQueue,
  paginateWorkQueue,
  parseWorkQueueQuery
} from '../dist/apps/funding-api/src/admin-work-queue.service.js';
import {
  WORK_QUEUE_PRIORITIES as corePriorities,
  compareAdminWorkQueueItems
} from '../dist/packages/funding-core/src/index.js';

const now = new Date('2026-09-15T14:00:00Z');

test('queue and pilotage share priority ordering, dated-first items and stable ID ties', () => {
  assert.equal(WORK_QUEUE_PRIORITIES, corePriorities);
  const keys = Object.freeze(
    [
      { id: 'week-dated', severity: 'this_week', dueAt: '2020-01-01' },
      { id: 'urgent-undated-z', severity: 'urgent' },
      { id: 'info-dated', severity: 'informational', dueAt: '2010-01-01' },
      { id: 'urgent-early-b', severity: 'urgent', dueAt: '2026-10-05' },
      { id: 'urgent-undated-a', severity: 'urgent', dueAt: null },
      { id: 'urgent-late', severity: 'urgent', dueAt: '2026-10-06' },
      { id: 'today-undated', severity: 'today' },
      { id: 'urgent-early-a', severity: 'urgent', dueAt: '2026-10-05' }
    ].map(Object.freeze)
  );
  assert.deepEqual(
    [...keys].sort(compareAdminWorkQueueItems).map((key) => key.id),
    [
      'urgent-early-a',
      'urgent-early-b',
      'urgent-late',
      'urgent-undated-a',
      'urgent-undated-z',
      'today-undated',
      'week-dated',
      'info-dated'
    ]
  );
  assert.equal(compareAdminWorkQueueItems(keys[0], keys[0]), 0);
  assert.equal(
    compareAdminWorkQueueItems(
      { id: 'same', severity: 'today', dueAt: null },
      { id: 'same', severity: 'today' }
    ),
    0
  );
});

test('navigation action counts and fallback dossier use the complete queue before filters', () => {
  const items = [
    {
      id: 'info',
      type: 'financial_data_warning',
      severity: 'informational',
      sponsorshipId: 'ignore'
    },
    {
      id: 'action',
      type: 'sponsorship_needs_review',
      severity: 'today',
      sponsorshipId: 'selected'
    },
    {
      id: 'other',
      type: 'invoice_missing',
      severity: 'this_week',
      sponsorshipId: 'later'
    }
  ];
  const result = paginateWorkQueue(items, now, {
    type: 'invoice_missing',
    pageSize: 1
  });
  assert.equal(result.firstSponsorshipId, 'selected');
  assert.equal(result.actionCounts.financial_data_warning, 0);
  assert.equal(result.actionCounts.sponsorship_needs_review, 1);
  assert.equal(result.items[0].id, 'other');
});
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

test('a refused incomplete dossier does not request information through navigation badges', () => {
  const items = buildWorkQueueItems(
    dataset({
      sponsorships: [
        {
          contributionId: 'refused',
          paymentStatus: 'paid',
          refundStatus: 'not_requested',
          reviewStatus: 'rejected',
          detailsSubmittedAt: null,
          hasCompanyName: false,
          hasContactEmail: false,
          hasSupportingImage: false
        }
      ]
    })
  );
  assert.equal(
    items.filter((item) => item.type === 'sponsorship_needs_info').length,
    0
  );
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

test('assistant overview groups the complete email queue and keeps other priorities visible', () => {
  const emails = Array.from({ length: 127 }, (_, i) => ({
    id: `mail-${String(i).padStart(3, '0')}`,
    status: 'failed',
    template_key: i < 71 ? 'sponsorship_invoice' : 'sponsorship_followup',
    attempts: 5,
    max_attempts: 5,
    last_error: 'ECONNRESET private detail',
    recipient_email: 'private@example.invalid'
  }));
  const items = buildWorkQueueItems(
    dataset({ emailMessages: emails }),
    [{ id: 'invoice', reference: 'DEMO', paid_at: null }],
    [event('evt_1')]
  );
  const query = parseWorkQueueQuery(
    new URLSearchParams(
      'overview=true&type=email_delivery_failed&emailTemplate=sponsorship_followup&emailError=connexion&page=4&pageSize=15'
    )
  );
  const result = paginateWorkQueue(items, now, query);
  assert.equal(result.filteredTotal, 56);
  assert.equal(result.items.length, 11);
  assert.equal(result.total, 129);
  assert.equal(result.typeCounts.email_delivery_failed, 127);
  assert.deepEqual(result.overview.emailGroups, [
    { template: 'sponsorship_invoice', error: 'connexion', count: 71 },
    { template: 'sponsorship_followup', error: 'connexion', count: 56 }
  ]);
  assert.equal(
    new Set(result.overview.recommendations.map((item) => item.type)).size,
    3
  );
  assert.ok(
    result.overview.recommendations.some(
      (item) => item.type === 'stripe_event_failed'
    )
  );
  assert.ok(
    result.items.every((item) => item.adminUrl.includes('?messageId='))
  );
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(paginateWorkQueue(items, now).overview, undefined);
  assert.equal(
    paginateWorkQueue(items, now, { emailTemplate: 'absent' }).filteredTotal,
    0
  );
  assert.equal(
    paginateWorkQueue(items, now, { overview: true, priority: 'today' })
      .overview.emailGroups.length,
    0
  );
});

test('assistant group filters and overview flag reject unsupported values', () => {
  for (const query of [
    'overview=1',
    'overview=yes',
    'emailError=raw-secret',
    'emailTemplate=a%20b',
    `emailTemplate=${'a'.repeat(101)}`
  ]) {
    assert.throws(() => parseWorkQueueQuery(new URLSearchParams(query)));
  }
  const result = paginateWorkQueue([], now, { overview: true }, ['database']);
  assert.equal(result.available, false);
  assert.deepEqual(result.overview.recommendations, []);
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

test('publication placements attach a dossier only while its matching draft remains unfinished', () => {
  const placements = [
    {
      label: 'direct slot',
      slots: [slot()],
      batches: [],
      assignment: { slot_id: 'slot-1', batch_id: null },
      itemId: 'publication_late:slot:slot-1'
    },
    {
      label: 'slot through batch',
      slots: [slot()],
      batches: [batch()],
      assignment: { slot_id: null, batch_id: 'batch-1' },
      itemId: 'publication_late:slot:slot-1'
    },
    {
      label: 'batch',
      slots: [],
      batches: [batch({ slotId: null })],
      assignment: { slot_id: null, batch_id: 'batch-1' },
      itemId: 'publication_late:batch:batch-1'
    }
  ];
  for (const [status, expectedDossier] of [
    ['draft', 'c-1'],
    ['pending_review', 'c-1'],
    ['approved', 'c-1'],
    ['scheduled', 'c-1'],
    ['published', undefined],
    ['rejected', undefined],
    ['cancelled', undefined]
  ]) {
    for (const placement of placements) {
      const items = buildWorkQueueItems(
        dataset({
          slots: placement.slots,
          batches: placement.batches,
          drafts: [draft({ ...placement.assignment, status })]
        })
      );
      const label = `${placement.label}, ${status}`;
      assert.equal(items.length, 1, label);
      assert.equal(items[0].id, placement.itemId, label);
      assert.equal(items[0].sponsorshipId, expectedDossier, label);
      assert.equal(items[0].contributionId, expectedDossier, label);
      assert.equal(
        paginateWorkQueue(items, now).firstSponsorshipId,
        expectedDossier ?? null,
        label
      );
    }
  }
});

test('slot dossier selection stays stable across direct and batch assignments and excludes terminal or unrelated drafts', () => {
  const drafts = Object.freeze([
    Object.freeze(
      draft({
        id: 'direct',
        contribution_id: 'c-z',
        slot_id: 'slot-1',
        batch_id: null,
        status: 'pending_review'
      })
    ),
    Object.freeze(draft({ id: 'indirect', contribution_id: 'c-a' })),
    ...['published', 'rejected', 'cancelled'].map((status) =>
      Object.freeze(
        draft({ id: status, contribution_id: `c-0-${status}`, status })
      )
    ),
    Object.freeze(
      draft({
        id: 'unrelated',
        contribution_id: 'c-00',
        batch_id: 'another-batch',
        status: 'pending_review'
      })
    )
  ]);
  let expected;
  for (const orderedDrafts of [drafts, Object.freeze([...drafts].reverse())]) {
    const ds = dataset({
      slots: [slot()],
      batches: [batch()],
      drafts: orderedDrafts
    });
    const before = JSON.stringify(ds);
    const items = buildWorkQueueItems(ds);
    assert.equal(items.length, 1);
    assert.equal(items[0].sponsorshipId, 'c-a');
    assert.equal(items[0].contributionId, 'c-a');
    assert.equal(paginateWorkQueue(items, now).firstSponsorshipId, 'c-a');
    if (expected) assert.deepEqual(items, expected);
    expected = items;
    assert.equal(JSON.stringify(ds), before);
  }
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

test('incomplete sources stop acquisition and report each missing table in stable order', async () => {
  let calls = 0;
  const snapshot = await loadAdminWorkQueue(
    {
      query: async (_sql, [required]) => {
        calls++;
        assert.equal(calls, 1, 'Incomplete sources must not be read');
        return {
          rows: [...required].reverse().map((name) => ({
            name,
            present: !['stripe_events', 'publication_slots'].includes(name)
          }))
        };
      }
    },
    now
  );
  assert.deepEqual(snapshot, {
    items: [],
    missingSources: ['stripe_events', 'publication_slots']
  });
  assert.equal(calls, 1);
  assert.deepEqual(await loadAdminWorkQueue(null, now), {
    items: [],
    missingSources: ['database']
  });
});

test('database errors propagate instead of presenting an empty operational queue', async () => {
  const failure = new Error('Synthetic acquisition failure');
  for (const sourcesPresent of [false, true]) {
    await assert.rejects(
      getAdminWorkQueue(
        {
          query: async (sql, values) => {
            if (sourcesPresent && sql.includes('FROM unnest')) {
              return {
                rows: values[0].map((name) => ({ name, present: true }))
              };
            }
            throw failure;
          }
        },
        {},
        now
      ),
      (error) => error === failure
    );
  }
});
