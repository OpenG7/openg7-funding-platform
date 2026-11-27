import assert from 'node:assert/strict';
import test from 'node:test';
import { prioritizeOperationalItems } from '../dist/apps/funding-api/src/admin-assistant/attention/operational-priority.js';
import {
  attentionPublicationWorkflow,
  loadAttentionPublicationWorkflows
} from '../dist/apps/funding-api/src/admin-assistant/attention/workflows.js';
import { detectSponsorshipObligationItems } from '../dist/apps/funding-api/src/admin-assistant/attention/obligation.detectors.js';
import { paginateWorkQueue } from '../dist/apps/funding-api/src/admin-work-queue/pagination.js';
import { parseWorkQueueQuery } from '../dist/apps/funding-api/src/admin-work-queue/query.js';
import { readEngineRoom } from '../dist/apps/funding-api/src/admin-engine-room.service.js';
import { recordedSponsorshipCommitment } from './support/sponsorship-commitment-fixture.mjs';

const now = new Date('2026-11-25T15:00:00Z');
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const deliveryId = '33333333-3333-4333-8333-333333333333';

test('unavailable queue counters remain unknown and never recommend platform work', () => {
  const f = fixture();
  const items = prioritizeOperationalItems([f.item], f.dataset);
  const response = paginateWorkQueue(items, now, { overview: true });
  assert.equal(response.humanTotal, 0);
  assert.equal(response.platformTotal, 1);
  assert.equal(response.overview.recommendations.length, 0);
  const unavailable = paginateWorkQueue(items, now, { overview: true }, [
    'database'
  ]);
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.humanTotal, null);
  assert.equal(unavailable.platformTotal, null);
});

test('an unavailable shared queue does not erase independent engine observations or expose an error', async () => {
  let scope;
  const result = await readEngineRoom(
    {
      connectorEnabled: false,
      localPreparationEnabled: false,
      connector: async () => null,
      publications: async () => ({
        workerEnabled: true,
        feeds: [],
        deliveries: []
      }),
      workQueue: async (input) => {
        scope = input;
        throw new Error('private dependency error');
      }
    },
    { deliveryId },
    () => now
  );
  assert.deepEqual(scope, { deliveryId });
  assert.equal(result.workQueue, null);
  assert.equal(result.publications.available, true);
  assert.equal(
    JSON.stringify(result).includes('private dependency error'),
    false
  );
});

function fixture(status = 'approved', changes = {}) {
  const commitment = recordedSponsorshipCommitment(['facebook_batch']);
  const obligation = commitment.obligations[0];
  const record = {
    commitment,
    contributionId: id,
    paymentStatus: 'paid',
    reviewStatus: 'approved',
    refundStatus: 'not_requested',
    feedStatus: 'planned'
  };
  const publication = {
    id: 'draft',
    obligationId: obligation.id,
    channel: 'facebook',
    target: obligation.target,
    status: 'scheduled',
    deliveryId,
    deliveryStatus: status,
    deliveryMode: 'live',
    scheduledAt: '2026-11-25T16:00:00Z',
    publishedAt: null,
    ...changes
  };
  const workflow = attentionPublicationWorkflow(
    record,
    true,
    [publication],
    [],
    now
  );
  const dataset = {
    now,
    sponsorships: [record],
    drafts: [
      {
        id: 'draft',
        contribution_id: id,
        obligation_id: obligation.id,
        channel: 'facebook',
        feed_target: obligation.target,
        batch_id: 'batch',
        slot_id: null
      }
    ],
    batches: [{ id: 'batch', slotId: 'slot' }],
    publicationWorkflows: [{ contributionId: id, workflow }]
  };
  const item = {
    id: 'sponsorship_needs_fulfilment:' + obligation.id,
    type: 'sponsorship_needs_fulfilment',
    severity: 'this_week',
    contributionId: id,
    sponsorshipId: id,
    detectedAt: now.toISOString(),
    dueAt: '2026-11-25T14:00:00Z',
    facts: { obligationId: obligation.id },
    suggestedActions: [
      { executionMode: 'prepare' },
      { executionMode: 'navigate' }
    ]
  };
  return { dataset, item, record, obligation, publication, workflow };
}

for (const [status, changes, reason] of [
  ['approved', {}, 'publication_scheduled'],
  ['publishing', {}, 'publication_publishing'],
  [
    'approved',
    { nextAttemptAt: '2026-11-25T17:00:00Z' },
    'publication_retry_pending'
  ]
])
  test(`native ${reason} is observed as platform work without a new human task`, () => {
    const f = fixture(status, changes);
    const [item] = prioritizeOperationalItems([f.item], f.dataset);
    assert.equal(item.severity, 'informational');
    assert.equal(item.intervention.reason, reason);
    assert.equal(item.intervention.responsibility, 'platform');
    assert.ok(
      item.suggestedActions.every(
        (action) => action.executionMode === 'navigate'
      )
    );
    const page = paginateWorkQueue([item], now, { overview: true });
    assert.equal(page.humanTotal, 0);
    assert.equal(page.platformTotal, 1);
    assert.equal(page.todayTotal, 0);
    assert.deepEqual(page.overview.recommendations, []);
    assert.equal(page.firstSponsorshipId, null);
    assert.equal(page.actionCounts.sponsorship_needs_fulfilment, 0);
  });

for (const [status, changes, reason] of [
  ['uncertain', {}, 'publication_uncertain'],
  ['failed', {}, 'publication_failed'],
  ['approved', { feedPaused: true }, 'publication_paused'],
  ['approved', { workerEnabled: false }, 'publication_worker_disabled'],
  ['published', { deliveryMode: 'mock' }, 'publication_simulation'],
  ['approved', { deliveryId: null }, 'publication_authorization_required']
])
  test(`${reason} remains a human exception using the native reason`, () => {
    const f = fixture(status, changes);
    const [item] = prioritizeOperationalItems([f.item], f.dataset);
    assert.notEqual(item.severity, 'informational');
    assert.equal(item.intervention.responsibility, 'admin');
    assert.equal(item.intervention.reason, reason);
    assert.equal(
      paginateWorkQueue([item], now, { overview: true }).overview
        .recommendations.length,
      1
    );
  });

test('future website duration waits for the platform but a real deadline remains human work', () => {
  const f = fixture();
  const obligation = {
    ...f.obligation,
    channel: 'website',
    timing: {
      durationState: 'awaiting_review',
      startObservation: { earliestCompletionAt: '2026-12-25T12:00:00Z' }
    }
  };
  const record = {
    ...f.record,
    commitment: { ...f.record.commitment, obligations: [obligation] }
  };
  const workflow = attentionPublicationWorkflow(record, true, [], [], now);
  f.dataset.publicationWorkflows = [{ contributionId: id, workflow }];
  const timing = {
    ...f.item,
    type: 'sponsorship_timing_review',
    facts: { ...f.item.facts, reason: 'duration_awaiting_review' }
  };
  assert.equal(
    prioritizeOperationalItems([timing], f.dataset)[0].severity,
    'informational'
  );
  timing.facts.reason = 'deadline_exceeded';
  const [late] = prioritizeOperationalItems([timing], f.dataset);
  assert.equal(late.intervention.responsibility, 'admin');
  assert.equal(late.intervention.reason, 'deadline_exceeded');
  assert.notEqual(late.severity, 'informational');
});

test('collective scope covers every exact participant; one uncertain participant prevents a normal waiting classification', () => {
  const f = fixture();
  const second = fixture('uncertain');
  f.dataset.drafts.push({
    ...f.dataset.drafts[0],
    id: 'draft-other',
    contribution_id: other
  });
  f.dataset.publicationWorkflows.push({
    contributionId: other,
    workflow: second.workflow
  });
  const slot = {
    ...f.item,
    id: 'publication_late:slot:slot',
    type: 'publication_late',
    facts: { kind: 'slot', reference: 'slot' }
  };
  const [item] = prioritizeOperationalItems([slot], f.dataset);
  assert.equal(item.intervention.reason, 'publication_uncertain');
  assert.equal(item.severity, 'urgent');
  assert.deepEqual(item.relatedContributionIds, [id, other]);
  assert.equal(
    paginateWorkQueue([item], now, { sponsorshipId: other, overview: true })
      .total,
    1
  );
  assert.equal(
    paginateWorkQueue([item], now, { deliveryId, overview: true }).total,
    1
  );
  assert.equal(
    paginateWorkQueue([item], now, { sponsorshipId: 'absent' }).total,
    0
  );
});

test('missing or legacy passage coverage never hides a human item; older datasets preserve their behavior', () => {
  const f = fixture();
  const unknown = { ...f.item, facts: { obligationId: 'not-observed' } };
  assert.equal(prioritizeOperationalItems([unknown], f.dataset)[0], unknown);
  assert.equal(
    prioritizeOperationalItems([f.item], {
      ...f.dataset,
      publicationWorkflows: undefined
    })[0],
    f.item
  );
  f.dataset.drafts[0].obligation_id = null;
  const placement = { ...f.item, facts: { kind: 'slot', reference: 'slot' } };
  assert.equal(
    prioritizeOperationalItems([placement], f.dataset)[0],
    placement
  );
});

test('a persisted fulfilled flag without qualified native proof still produces a fulfilment exception', () => {
  const f = fixture('published');
  f.obligation.state = 'fulfilled';
  f.obligation.fulfilmentEvidenceId = 'unqualified';
  f.dataset.publicationWorkflows = [
    {
      contributionId: id,
      workflow: attentionPublicationWorkflow(
        f.record,
        true,
        [f.publication],
        [],
        now
      )
    }
  ];
  const items = detectSponsorshipObligationItems(f.dataset);
  assert.ok(
    items.some((item) => item.facts.reason === 'fulfilment_unverified')
  );
});

test('bulk workflow observations fail closed on dependency errors and do not read empty scopes', async () => {
  assert.deepEqual(
    await loadAttentionPublicationWorkflows(
      { query: () => assert.fail('empty scope') },
      [],
      now
    ),
    []
  );
  const f = fixture();
  await assert.rejects(
    loadAttentionPublicationWorkflows(
      {
        query: async () => {
          throw new Error('source unavailable');
        }
      },
      [f.record],
      now
    ),
    /source unavailable/
  );
});

test('queue scope UUIDs are normalized, intersections are explicit, and repeated or malformed parameters fail before reads', () => {
  assert.equal(
    parseWorkQueueQuery(
      new URLSearchParams({ sponsorshipId: id.toUpperCase(), deliveryId })
    ).sponsorshipId,
    id
  );
  for (const query of [
    'sponsorshipId=bad',
    `deliveryId=${id}&deliveryId=${other}`,
    'deliveryId='
  ])
    assert.throws(() => parseWorkQueueQuery(new URLSearchParams(query)));
});
