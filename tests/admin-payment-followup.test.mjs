import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorkQueueItems,
  paginateWorkQueue,
  parseWorkQueueQuery
} from '../dist/apps/funding-api/src/admin-work-queue.service.js';
import {
  buildRefundFollowupItems,
  loadRefundFollowupItems
} from '../dist/apps/funding-api/src/admin-work-queue/refund-followup.js';
import {
  buildReliabilityFollowupItems,
  loadReliabilityFollowupItems
} from '../dist/apps/funding-api/src/admin-work-queue/reliability-followup.js';
import { resolveSponsorshipPublicationCoverage } from '../dist/apps/funding-api/src/sponsorship-publication-coverage.js';

const now = new Date('2026-10-15T14:00:00Z');
const contributionId = '10000000-0000-4000-8000-000000000401';
const obligation = (channel, overrides = {}) => ({
  id: `synthetic-${channel}-1`,
  channel,
  target: 'openg7',
  ordinal: 1,
  state: 'pending',
  blockedReason: null,
  fulfilmentEvidenceId: null,
  ...overrides
});
const record = (obligations, overrides = {}) => ({
  contributionId,
  publicReference: 'DEMO-401',
  amount: 500,
  currency: 'CAD',
  paidAt: '2026-09-01T00:00:00Z',
  paymentStatus: 'paid',
  refundStatus: 'not_requested',
  reviewStatus: 'approved',
  detailsSubmittedAt: '2026-09-01T00:00:00Z',
  hasCompanyName: true,
  hasContactEmail: true,
  hasSupportingImage: true,
  commitment: {
    state: 'active',
    offer: { amountMinor: 50000, currency: 'CAD' },
    obligations
  },
  ...overrides
});
const dataset = (sponsorship, overrides = {}) => ({
  now,
  sponsorships: [sponsorship],
  sponsorshipsTruncated: false,
  drafts: [],
  batches: [],
  slots: [],
  emailMessages: [],
  financialTotals: {
    grossPaid: 500,
    refunded: 0,
    disputed: 0,
    currency: 'CAD'
  },
  ...overrides
});
const draft = (overrides = {}) => ({
  id: 'synthetic-draft',
  contribution_id: contributionId,
  channel: 'facebook',
  feed_target: 'openg7',
  status: 'published',
  obligation_id: 'synthetic-facebook-1',
  ...overrides
});
const candidate = (overrides = {}) => ({
  contributionId,
  reference: 'DEMO-401',
  paymentStatus: 'paid',
  refundStatus: 'not_requested',
  currency: 'CAD',
  amountMinor: 50000,
  refundId: null,
  refundAmountMinor: null,
  refundError: false,
  ...overrides
});
const refundFact = (overrides = {}) => ({
  contributionId,
  id: 're_synthetic',
  kind: 'refund',
  amount: 1000,
  currency: 'CAD',
  ...overrides
});
const credit = (overrides = {}) => ({
  contributionId,
  refundId: 're_synthetic',
  amountMinor: 1000,
  currency: 'CAD',
  ...overrides
});

test('an approved website promise remains work even without social publications or failed services', () => {
  const items = buildWorkQueueItems(dataset(record([obligation('website')])));
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'sponsorship_needs_fulfilment');
  assert.equal(items[0].contributionId, contributionId);
  assert.equal(items[0].facts.obligationId, 'synthetic-website-1');
  assert.equal(
    items[0].adminUrl,
    `/admin/fundraiser/sponsors?sponsorshipId=${contributionId}&tab=publication`
  );
  assert.equal(
    paginateWorkQueue(items, now).firstSponsorshipId,
    contributionId
  );
});

test('a published social draft leaves a precise proof action without proposing an automatic duplicate send', () => {
  const items = buildWorkQueueItems(
    dataset(record([obligation('facebook')]), { drafts: [draft()] })
  );
  assert.deepEqual(
    items.map((item) => item.type),
    ['sponsorship_needs_fulfilment']
  );
  assert.equal(items[0].facts.channel, 'facebook');
  assert.ok(
    items[0].suggestedActions.every(
      (action) => action.executionMode === 'navigate'
    )
  );
});

test('two recorded social ordinals need two preparations and retain both fulfilment actions', () => {
  const obligations = [
    obligation('facebook'),
    obligation('facebook', { id: 'synthetic-facebook-2', ordinal: 2 })
  ];
  const source = record(obligations);
  const items = buildWorkQueueItems(dataset(source, { drafts: [draft()] }));
  assert.equal(
    items.filter((item) => item.type === 'sponsorship_needs_fulfilment').length,
    2
  );
  assert.equal(
    items.filter((item) => item.type === 'publication_needs_preparation')
      .length,
    1
  );
  assert.deepEqual(
    resolveSponsorshipPublicationCoverage(source, [draft(), draft()])
      .missingChannels,
    ['facebook']
  );
  assert.deepEqual(
    resolveSponsorshipPublicationCoverage(source, [
      draft(),
      draft({ id: 'second', obligation_id: 'synthetic-facebook-2' })
    ]).missingChannels,
    []
  );
});

test('preparation coverage does not merge destinations or unrelated contributions', () => {
  const source = record([
    obligation('facebook'),
    obligation('facebook', { id: 'other', target: 'openg20' })
  ]);
  assert.deepEqual(
    resolveSponsorshipPublicationCoverage(source, [
      draft(),
      draft({
        id: 'other',
        contribution_id: 'unrelated',
        obligation_id: 'other',
        feed_target: 'openg20'
      })
    ]).missingChannels,
    ['facebook']
  );
  assert.deepEqual(
    resolveSponsorshipPublicationCoverage(source, [
      draft(),
      draft({ id: 'other', obligation_id: 'other', feed_target: 'openg20' })
    ]).missingChannels,
    []
  );
});

test('published history cannot cover the next recorded passage or consume its remaining quantity', () => {
  const source = record([
    obligation('facebook', {
      state: 'fulfilled',
      fulfilmentEvidenceId: 'synthetic-proof'
    }),
    obligation('facebook', { id: 'synthetic-facebook-2', ordinal: 2 }),
    obligation('facebook', { id: 'synthetic-facebook-3', ordinal: 3 })
  ]);
  assert.deepEqual(
    resolveSponsorshipPublicationCoverage(source, [
      draft(),
      draft({
        id: 'current',
        status: 'draft',
        obligation_id: 'synthetic-facebook-2'
      })
    ]).missingChannels,
    ['facebook']
  );
  assert.deepEqual(
    resolveSponsorshipPublicationCoverage(source, [
      draft({ obligation_id: null }),
      draft({ id: 'current', status: 'draft', obligation_id: null })
    ]).missingChannels,
    ['facebook']
  );
  assert.deepEqual(
    resolveSponsorshipPublicationCoverage(source, [
      draft(),
      draft({
        id: 'current-2',
        status: 'draft',
        obligation_id: 'synthetic-facebook-2'
      }),
      draft({
        id: 'current-3',
        status: 'draft',
        obligation_id: 'synthetic-facebook-3'
      })
    ]).missingChannels,
    []
  );
});

test('unbound legacy publications keep an informational observation without covering new preparation', () => {
  const source = record([obligation('facebook')]);
  assert.deepEqual(
    resolveSponsorshipPublicationCoverage(source, [
      draft({ obligation_id: null })
    ]).missingChannels,
    ['facebook']
  );
  const ambiguous = resolveSponsorshipPublicationCoverage(source, [
    draft({ obligation_id: null })
  ]);
  assert.deepEqual(ambiguous.preparedChannels, []);
  assert.deepEqual(ambiguous.reviewChannels, ['facebook']);
  assert.deepEqual(ambiguous.preparationChannels, []);
  const items = buildWorkQueueItems(
    dataset(source, { drafts: [draft({ obligation_id: null })] })
  );
  assert.equal(
    items.some((item) => item.type === 'publication_needs_preparation'),
    false
  );
  assert.equal(
    items.find((item) => item.type === 'sponsorship_needs_fulfilment').facts
      .reason,
    'fulfilment_evidence_missing'
  );
  assert.deepEqual(
    resolveSponsorshipPublicationCoverage(source, [
      draft({ obligation_id: null, status: 'draft' })
    ]).missingChannels,
    []
  );
});

test('fulfilled proofs and adjusted promises disappear; absent proof never counts as fulfilment', () => {
  const obligations = [
    obligation('website', {
      state: 'fulfilled',
      fulfilmentEvidenceId: 'proof'
    }),
    obligation('facebook', { state: 'adjusted' }),
    obligation('linkedin', { state: 'fulfilled' })
  ];
  const items = buildWorkQueueItems(dataset(record(obligations)));
  assert.equal(
    items.filter((item) => item.type === 'sponsorship_needs_fulfilment').length,
    1
  );
  assert.equal(
    items.find((item) => item.type === 'sponsorship_needs_fulfilment').facts
      .reason,
    'fulfilment_evidence_missing'
  );
  assert.equal(
    buildWorkQueueItems(dataset(record(obligations.slice(0, 2)))).length,
    0
  );
});

test('a refund does not silently waive remaining commercial promises', () => {
  for (const refundStatus of [
    'requested',
    'processing',
    'failed',
    'completed'
  ]) {
    const items = buildWorkQueueItems(
      dataset(record([obligation('website')], { refundStatus }))
    );
    assert.ok(
      items.some((item) => item.type === 'sponsorship_needs_fulfilment')
    );
    assert.equal(
      items.some((item) => item.type === 'sponsorship_refund_followup'),
      refundStatus !== 'completed'
    );
  }
});

test('unqualified history asks for qualification without inventing today’s obligations', () => {
  const items = buildWorkQueueItems(
    dataset(
      record([], {
        commitment: {
          state: 'needs_confirmation',
          offer: null,
          obligations: []
        }
      })
    )
  );
  assert.deepEqual(
    items.map((item) => item.type),
    ['sponsorship_needs_commitment']
  );
});

for (const [overrides, reason] of [
  [{ overdue: true, dueAt: '2026-10-01T00:00:00Z' }, 'deadline_exceeded'],
  [{ deadlineDays: 7, originAt: null }, 'deadline_origin_unknown'],
  [
    { durationDays: 30, durationState: 'awaiting_observation' },
    'duration_awaiting_observation'
  ],
  [
    { durationDays: 30, durationState: 'awaiting_review' },
    'duration_awaiting_review'
  ],
  [
    { durationDays: 30, durationState: 'restart_required' },
    'duration_restart_required'
  ],
  [{ durationDays: 30, durationState: 'unsupported' }, 'duration_unsupported']
])
  test(`contractual timing remains actionable: ${reason}`, () => {
    const timing = {
      deadlineDays: null,
      originAt: null,
      dueAt: null,
      overdue: false,
      durationDays: null,
      durationState: 'not_required',
      ...overrides
    };
    const items = buildWorkQueueItems(
      dataset(record([obligation('website', { timing })]))
    );
    const item = items.find(
      (item) => item.type === 'sponsorship_timing_review'
    );
    assert.equal(item.facts.reason, reason);
    assert.equal(item.contributionId, contributionId);
    if (timing.overdue) assert.equal(item.severity, 'urgent');
  });

test('a pending review uses the earlier dossier action and never becomes a false completed queue', () => {
  const items = buildWorkQueueItems(
    dataset(record([obligation('website')], { reviewStatus: 'pending_review' }))
  );
  assert.ok(items.some((item) => item.type === 'sponsorship_needs_review'));
  assert.equal(
    items.some((item) => item.type === 'sponsorship_needs_fulfilment'),
    false
  );
});

test('processing refunds remain actionable after all promises have closed', () => {
  const items = buildRefundFollowupItems(
    [candidate({ refundStatus: 'processing' })],
    [],
    [],
    now
  );
  assert.deepEqual(
    items.map((item) => item.type),
    ['sponsorship_refund_followup']
  );
  assert.equal(
    items[0].adminUrl,
    `/admin/fundraiser/sponsors?sponsorshipId=${contributionId}&tab=refund`
  );
  const projected = buildWorkQueueItems(
    dataset(record([], { refundStatus: 'processing' })),
    [],
    [],
    items
  );
  assert.equal(
    projected.filter((item) => item.type === 'sponsorship_refund_followup')
      .length,
    1
  );
});

test('missing credit notes compare refund identities even when unrelated credits cover the total', () => {
  const items = buildRefundFollowupItems(
    [candidate()],
    [refundFact()],
    [credit({ refundId: 're_other' })],
    now
  );
  assert.deepEqual(
    items.map((item) => item.type),
    ['sponsorship_credit_missing']
  );
  assert.equal(
    buildRefundFollowupItems([candidate()], [refundFact()], [credit()], now)
      .length,
    0
  );
});

test('partial refunds, duplicates and cumulative charge snapshots are not added twice', () => {
  const facts = [
    refundFact(),
    refundFact(),
    refundFact({ kind: 'charge', id: 'ch_synthetic' })
  ];
  const item = buildRefundFollowupItems([candidate()], facts, [], now)[0];
  assert.equal(item.facts.confirmedAmountMinor, 1000);
  assert.equal(
    buildRefundFollowupItems([candidate()], facts, [credit()], now).length,
    0
  );
});

test('completed workflow and fully refunded payment still require their credit documents', () => {
  for (const source of [
    candidate({
      refundStatus: 'completed',
      refundId: 're_synthetic',
      refundAmountMinor: 1000
    }),
    candidate({ paymentStatus: 'refunded' })
  ])
    assert.equal(
      buildRefundFollowupItems([source], [], [], now)[0].type,
      'sponsorship_credit_missing'
    );
});

test('pending refunds with pre-issued credits never become a confirmed refund amount', () => {
  const items = buildRefundFollowupItems(
    [candidate({ refundStatus: 'processing' })],
    [],
    [credit()],
    now
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'sponsorship_refund_followup');
  assert.equal(items[0].facts.confirmedAmountMinor, 0);
});

test('invalid financial facts fail visibly instead of producing a complete empty queue', () => {
  for (const invalid of [
    refundFact({ currency: 'USD' }),
    refundFact({ amount: 0.5 }),
    refundFact({ amount: -1 })
  ])
    assert.throws(
      () => buildRefundFollowupItems([candidate()], [invalid], [], now),
      /Inconsistent refund facts/
    );
});

test('financial acquisition uses three group reads independent of payment volume', async () => {
  const statements = [];
  const pool = {
    query: async (sql) => {
      statements.push(sql);
      assert.match(sql, /^(SELECT|WITH) /);
      return {
        rows: sql.includes('public_reference AS reference')
          ? Array.from({ length: 2005 }, (_, index) =>
              candidate({
                contributionId: `synthetic-${index}`,
                refundStatus: 'processing'
              })
            )
          : []
      };
    }
  };
  const items = await loadRefundFollowupItems(pool, now);
  assert.equal(statements.length, 3);
  assert.equal(items.length, 2005);
  assert.ok(statements.some((sql) => sql.includes('effective_refunds')));
  await assert.rejects(
    loadRefundFollowupItems(
      {
        query: async () => {
          throw new Error('Synthetic source unavailable');
        }
      },
      now
    ),
    /Synthetic source unavailable/
  );
});

test('reliability incidents retain all entries, exact subjects and safe read-only links', async () => {
  const incidents = Array.from({ length: 120 }, (_, index) => ({
    code: 'FULFILMENT_EVIDENCE_MISMATCH',
    subjectType: 'obligation',
    subjectId: `synthetic-${index}`,
    sponsorshipId: contributionId
  }));
  let calls = 0;
  const items = await loadReliabilityFollowupItems(
    {
      query: async (sql) => {
        calls++;
        assert.match(sql, /^WITH/);
        assert.doesNotMatch(sql, /LIMIT 50/);
        return { rows: incidents.map((incident) => ({ incident })) };
      }
    },
    now
  );
  assert.equal(calls, 1);
  assert.equal(items.length, 120);
  assert.equal(items[0].contributionId, contributionId);
  assert.ok(
    items.every((item) =>
      item.suggestedActions.every(
        (action) => action.executionMode === 'navigate'
      )
    )
  );
  assert.doesNotMatch(JSON.stringify(items), /recipient|token|password/);
  const query = parseWorkQueueQuery(
    new URLSearchParams(
      'type=publication_reliability_incident&page=2&pageSize=100'
    )
  );
  assert.equal(paginateWorkQueue(items, now, query).items.length, 20);
  assert.equal(
    buildReliabilityFollowupItems(
      [
        {
          code: 'ACCOUNT_RESULT_UNCERTAIN',
          subjectType: 'delivery',
          subjectId: 'synthetic',
          deliveryId: 'delivery-synthetic'
        }
      ],
      now
    )[0].adminUrl,
    '/admin/fundraiser/publications/automation?deliveryId=delivery-synthetic'
  );
});

test('all new work types can be filtered and count toward actionable navigation', () => {
  for (const type of [
    'sponsorship_needs_fulfilment',
    'sponsorship_refund_followup',
    'sponsorship_credit_missing',
    'sponsorship_timing_review',
    'publication_reliability_incident'
  ]) {
    const query = parseWorkQueueQuery(new URLSearchParams({ type }));
    const response = paginateWorkQueue(
      [
        {
          id: 'synthetic',
          type,
          severity: 'today',
          sponsorshipId: contributionId
        }
      ],
      now,
      query
    );
    assert.equal(response.actionCounts[type], 1);
    assert.equal(response.firstSponsorshipId, contributionId);
  }
});

test('a shared incident retains a distinct task for every related contribution', () => {
  const incident = {
    code: 'BATCH_CAPACITY_EXCEEDED',
    subjectType: 'batch',
    subjectId: 'synthetic-batch',
    batchId: 'synthetic-batch'
  };
  const items = buildReliabilityFollowupItems(
    [
      { ...incident, sponsorshipId: contributionId },
      { ...incident, sponsorshipId: '10000000-0000-4000-8000-000000000402' }
    ],
    now
  );
  const projected = buildWorkQueueItems(
    { ...dataset(record([])), sponsorships: [] },
    [],
    [],
    items
  );
  assert.equal(projected.length, 2);
  assert.equal(new Set(projected.map((item) => item.id)).size, 2);
});
