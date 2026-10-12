import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreparationOpportunityPlanner } from '../dist/apps/funding-api/src/publication-automation/preparation-opportunity.js';

const now = new Date('2099-01-01T09:00:00Z');
const feed = {
  id: 'openg7:facebook',
  paused: false,
  autoPrepare: false,
  timezone: 'UTC',
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  localTime: '10:00',
  capacity: 2,
  horizonDays: 1,
  mode: 'live',
  accountId: '20',
  configured: true,
  expiresAt: null,
  connection: 'ready',
  checkedAt: null
};
const source = {
  id: 'source',
  contributionId: 'sponsor',
  name: 'Synthetic sponsor',
  title: 'Editorial title',
  body: 'Complete body.',
  disclosureText: 'Paid sponsorship.'
};
const entry = {
  draftId: source.id,
  sponsorshipId: source.contributionId,
  name: source.name,
  feedId: feed.id,
  status: 'deferred',
  reason: 'AWAITING_PREPARATION',
  renderedLength: 100,
  budget: 2900,
  createdAt: '2020-01-01T00:00:00Z',
  scheduledAt: null,
  batchId: null,
  deliveryId: null,
  deliveryStatus: null,
  publicationFormat: 'collective_text'
};

async function planner({
  settings = feed,
  deliveries = [],
  leases = [],
  reservations = [],
  batches = [],
  manual = []
} = {}) {
  const facts = { deliveries, leases, reservations, batches, manual };
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(sql);
      const key = /\/\* preparation_calendar_(\w+) \*\//.exec(sql)?.[1];
      assert.ok(
        key && Object.hasOwn(facts, key),
        `Unexpected calendar query: ${sql}`
      );
      return { rows: facts[key] };
    }
  };
  const result = await createPreparationOpportunityPlanner(db, [settings], now);
  assert.equal(calls.length, 5);
  assert.ok(calls.every((sql) => sql.trimStart().startsWith('SELECT')));
  return result;
}

test('opportunities are repeatable possibilities and keep the preparation horizon unchanged', async () => {
  const projection = await planner();
  const before = structuredClone(feed);
  const first = projection.project(entry, source);
  assert.equal(first.reason, 'AVAILABLE_IN_HORIZON');
  assert.equal(first.action, 'PREPARE_FEED');
  assert.equal(first.proposedAt, '2099-01-01T10:00:00.000Z');
  assert.equal(first.withinHorizon, true);
  assert.deepEqual(projection.project(entry, source), first);
  assert.deepEqual(feed, before);
});

test('a same-account human delivery inside the technical interval shifts the possibility after horizon', async () => {
  const projection = await planner({
    deliveries: [
      {
        id: 'human',
        feed_id: 'openg20:facebook',
        account_id: '20',
        mode: 'live',
        scheduled_at: new Date('2099-01-01T10:00:30Z'),
        batch_id: null,
        status: 'draft'
      }
    ]
  });
  const next = projection.project(entry, source);
  assert.equal(next.reason, 'AVAILABLE_AFTER_HORIZON');
  assert.equal(next.action, 'REVIEW_HORIZON');
  assert.equal(next.proposedAt, '2099-01-02T10:00:00.000Z');
});

test('provider and mode separate accounts while LinkedIn aliases share their real account', async () => {
  const independent = await planner({
    deliveries: [
      {
        id: 'other-provider',
        feed_id: 'openg20:linkedin',
        account_id: '20',
        mode: 'live',
        scheduled_at: new Date('2099-01-01T10:00:00Z'),
        batch_id: null,
        status: 'approved'
      },
      {
        id: 'mock',
        feed_id: 'openg20:facebook',
        account_id: '20',
        mode: 'mock',
        scheduled_at: new Date('2099-01-01T10:00:00Z'),
        batch_id: null,
        status: 'draft'
      }
    ]
  });
  assert.equal(
    independent.project(entry, source).reason,
    'AVAILABLE_IN_HORIZON'
  );
  const linkedin = await planner({
    settings: {
      ...feed,
      id: 'openg7:linkedin',
      accountId: 'urn:li:organization:20'
    },
    deliveries: [
      {
        id: 'canonical',
        feed_id: 'openg20:linkedin',
        account_id: '20',
        mode: 'live',
        scheduled_at: new Date('2099-01-01T10:00:00Z'),
        batch_id: null,
        status: 'draft'
      }
    ]
  });
  assert.equal(
    linkedin.project({ ...entry, feedId: 'openg7:linkedin' }, source).reason,
    'AVAILABLE_AFTER_HORIZON'
  );
});

test('a committed uncomposed batch is occupied and current full blocks control residual capacity', async () => {
  const batch = {
    feed_id: feed.id,
    batch_id: 'batch',
    starts_at: new Date('2099-01-01T10:00:00Z'),
    capacity: 2,
    publication_format: 'collective_text',
    mutable: true,
    has_delivery: false,
    sources: [
      {
        ...source,
        id: 'existing',
        contributionId: 'other',
        body: 'x'.repeat(1600)
      }
    ]
  };
  const projection = await planner({ batches: [batch] });
  assert.equal(
    projection.project(entry, source).reason,
    'AVAILABLE_IN_HORIZON'
  );
  assert.equal(
    projection.project(entry, { ...source, body: 'y'.repeat(1600) }).reason,
    'AVAILABLE_AFTER_HORIZON'
  );
  const full = await planner({ batches: [{ ...batch, capacity: 1 }] });
  assert.equal(full.project(entry, source).reason, 'AVAILABLE_AFTER_HORIZON');
});

test('assigned private dates are retained and an incompatible proposal requires review', async () => {
  const own = {
    id: 'own',
    feed_id: feed.id,
    account_id: '20',
    mode: 'live',
    scheduled_at: new Date('2099-01-01T10:00:00Z'),
    batch_id: 'batch',
    status: 'draft'
  };
  const assigned = {
    ...entry,
    deliveryId: own.id,
    batchId: own.batch_id,
    status: 'retained',
    reason: 'AWAITING_APPROVAL',
    scheduledAt: own.scheduled_at.toISOString()
  };
  const compatible = await planner({ deliveries: [own] });
  assert.equal(
    compatible.project(assigned, source).reason,
    'EXISTING_PROPOSAL'
  );
  const conflict = await planner({
    deliveries: [
      own,
      {
        ...own,
        id: 'other',
        batch_id: 'other-batch',
        feed_id: 'openg20:facebook'
      }
    ]
  });
  const blocked = conflict.project(assigned, source);
  assert.equal(blocked.reason, 'PROPOSAL_REPAIR_REQUIRED');
  assert.equal(blocked.proposedAt, null);
});

test('an uncertain or in-flight account refuses a hypothetical date without releasing authority', async () => {
  const projection = await planner({
    leases: [
      {
        provider: 'facebook',
        accountId: '20',
        mode: 'live',
        uncertain: true,
        delivery_id: 'unknown',
        next_dispatch_at: new Date('2099-01-01T11:00:00Z')
      }
    ]
  });
  const next = projection.project(entry, source);
  assert.equal(next.reason, 'ACCOUNT_RECONCILIATION_REQUIRED');
  assert.equal(next.proposedAt, null);
});

test('a retained date beyond the search is preserved without asserting unchecked compatibility', async () => {
  const projection = await planner();
  const existing = {
    ...entry,
    status: 'retained',
    reason: 'AWAITING_APPROVAL',
    deliveryId: 'existing-delivery',
    batchId: 'existing-batch',
    scheduledAt: '2101-01-01T10:00:00Z'
  };
  const before = structuredClone(existing);
  const next = projection.project(existing, source);
  assert.equal(next.reason, 'EXISTING_DATE_OUTSIDE_SEARCH');
  assert.equal(next.action, 'REVIEW_CALENDAR');
  assert.equal(next.proposedAt, null);
  assert.equal(next.withinHorizon, false);
  assert.deepEqual(existing, before);
});

test('a batch whose delivery appeared after the first read occupies its immutable account and actual date', async () => {
  const batch = {
    feed_id: feed.id,
    batch_id: 'batch',
    starts_at: new Date('2099-01-01T11:00:00Z'),
    capacity: 2,
    publication_format: 'collective_text',
    mutable: false,
    has_delivery: true,
    delivery_id: 'newly-committed',
    delivery_feed_id: feed.id,
    delivery_account_id: '20',
    delivery_mode: 'live',
    delivery_scheduled_at: new Date('2099-01-01T10:00:30Z'),
    sources: [{ ...source, id: 'existing', contributionId: 'other' }]
  };
  const current = await planner({ batches: [batch] });
  assert.equal(
    current.project(entry, source).reason,
    'AVAILABLE_AFTER_HORIZON'
  );
  const changedConfig = await planner({
    batches: [{ ...batch, delivery_account_id: 'historical-account' }]
  });
  assert.equal(
    changedConfig.project(entry, source).reason,
    'AVAILABLE_IN_HORIZON'
  );
});

test('invalid content, moderation and manual dates expose their own action ahead of calendar prediction', async () => {
  const projection = await planner({ settings: { ...feed, paused: true } });
  for (const [state, reason, action] of [
    [
      { status: 'needs_correction', reason: 'INDIVIDUAL_TEXT_TOO_LONG' },
      'SOURCE_CORRECTION_REQUIRED',
      'CORRECT_SOURCE'
    ],
    [
      { reason: 'MODERATION_REVIEW_REQUIRED' },
      'MODERATION_REVIEW_REQUIRED',
      'REVIEW_MODERATION'
    ],
    [
      { reason: 'MANUAL_RESERVATION', scheduledAt: '2099-01-01T10:00:00Z' },
      'MANUAL_RESERVATION',
      'REVIEW_CALENDAR'
    ],
    [
      { reason: 'PREPARATION_FAILED' },
      'PROPOSAL_REPAIR_REQUIRED',
      'REPAIR_PROPOSAL'
    ]
  ]) {
    const next = projection.project({ ...entry, ...state }, source);
    assert.equal(next.reason, reason);
    assert.equal(next.action, action);
    assert.equal(next.proposedAt, null);
  }
  assert.equal(projection.project(entry, source).reason, 'FEED_PAUSED');
});

test('missing connections, unsupported formats and singleton collections expose explicit prerequisites', async () => {
  const unavailable = await planner({
    settings: { ...feed, configured: false }
  });
  assert.equal(
    unavailable.project(entry, source).reason,
    'ACCOUNT_CONNECTION_REQUIRED'
  );
  const facebook = await planner();
  assert.equal(
    facebook.project(
      { ...entry, publicationFormat: 'image_collection' },
      source
    ).reason,
    'FORMAT_UNAVAILABLE'
  );
  const linkedin = await planner({
    settings: { ...feed, id: 'openg7:linkedin', capacity: 1 }
  });
  assert.equal(
    linkedin.project(
      {
        ...entry,
        feedId: 'openg7:linkedin',
        publicationFormat: 'image_collection'
      },
      source
    ).reason,
    'CAPACITY_INSUFFICIENT'
  );
  const singleton = await planner({
    settings: { ...feed, id: 'openg7:linkedin' }
  });
  assert.equal(
    singleton.project(
      {
        ...entry,
        feedId: 'openg7:linkedin',
        publicationFormat: 'image_collection'
      },
      source
    ).reason,
    'GROUP_PARTICIPANTS_REQUIRED'
  );
});

test('a bounded forecast reports no date when all permitted weekdays are absent', async () => {
  const projection = await planner({ settings: { ...feed, weekdays: [] } });
  const next = projection.project(entry, source);
  assert.equal(next.reason, 'NO_COMPATIBLE_RECURRENCE');
  assert.equal(next.proposedAt, null);
  assert.equal(
    Date.parse(next.searchUntil) - Date.parse(next.evaluatedAt),
    366 * 86400000
  );
});
