import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapPublicationBatchRow,
  mapPublicationDraftRow,
  mapPublicationSlotRow,
  mapSocialPublicationJobRow
} from '../dist/apps/funding-api/src/fund-publication.mapping.js';
import {
  getPublicationBatchById,
  getPublicSponsorshipBatchAvailability,
  listAdminPublicationBatches,
  listAdminPublicationDrafts,
  listAdminPublicationSlots,
  listAdminSocialPublicationJobs
} from '../dist/apps/funding-api/src/fund-admin.repository.js';

const createdAt = '2025-12-01 16:30:00+00';
const updatedAt = '2026-01-01 09:15:00+00';
const dates = { created_at: createdAt, updated_at: updatedAt };
const draftRow = {
  id: 'synthetic-draft',
  contribution_id: 'synthetic-contribution',
  sponsor_company_name: 'Historical sponsor',
  sponsor_website_url: null,
  sponsor_logo_url: 'https://example.test/historical-logo',
  sponsor_public_summary: 'Historical approved summary',
  feed_target: 'openg20',
  channel: 'linkedin',
  title: '  Historical title  ',
  body: 'Historical approved body\nwith its original whitespace.',
  disclosure_text: 'Historical disclosure',
  status: 'approved',
  public_url: null,
  scheduled_at: null,
  approved_at: '2025-12-31 10:15:00+00',
  published_at: null,
  review_note: 'Synthetic private review note',
  batch_id: null,
  slot_id: null,
  ...dates
};
const batchRow = {
  id: 'synthetic-batch',
  channel: 'linkedin',
  capacity: '5',
  status: 'scheduled',
  slot_id: null,
  scheduled_at: '2026-02-01 10:00:00+00',
  published_at: null,
  notes: 'Historical private batch note',
  assigned_draft_ids: ['synthetic-draft-2', null, 'synthetic-draft-1'],
  capacity_used: '2',
  ...dates
};
const slotRow = {
  id: 'synthetic-slot',
  feed_target: 'openg20',
  channel: 'linkedin',
  starts_at: '2026-02-01 10:00:00+00',
  timezone: 'America/Toronto',
  capacity: '5',
  status: 'scheduled',
  notes: 'Historical private slot note',
  assigned_batch_ids: ['synthetic-batch'],
  assigned_draft_ids: ['synthetic-draft-2', null, 'synthetic-draft-1'],
  capacity_used: '2',
  ...dates
};
const jobRow = {
  id: 'synthetic-job',
  batch_id: 'synthetic-batch',
  channel: 'linkedin',
  provider: 'linkedin',
  mode: 'live',
  status: 'failed',
  idempotency_key: 'synthetic-stable-publication-key',
  title: 'Historical final title',
  body: 'Historical final content',
  disclosure_text: 'Historical final disclosure',
  draft_ids: ['synthetic-draft-2', null, 'synthetic-draft-1'],
  external_post_id: null,
  external_post_url: null,
  error_code: 'SYNTHETIC_PROVIDER_ERROR',
  error_message: 'Synthetic safe diagnostic',
  attempted_at: '2026-01-01 09:00:00+00',
  published_at: null,
  ...dates
};
const batch = {
  id: 'synthetic-batch',
  channel: 'linkedin',
  capacity: 5,
  status: 'scheduled',
  slotId: null,
  scheduledAt: '2026-02-01 10:00:00+00',
  publishedAt: null,
  notes: 'Historical private batch note',
  assignedDraftIds: ['synthetic-draft-2', 'synthetic-draft-1'],
  capacityUsed: 2,
  capacityAvailable: 3,
  createdAt,
  updatedAt
};
const slot = {
  id: 'synthetic-slot',
  feedTarget: 'openg20',
  channel: 'linkedin',
  startsAt: '2026-02-01 10:00:00+00',
  timezone: 'America/Toronto',
  capacity: 5,
  status: 'scheduled',
  notes: 'Historical private slot note',
  assignedBatchIds: ['synthetic-batch'],
  assignedDraftIds: ['synthetic-draft-2', 'synthetic-draft-1'],
  capacityUsed: 2,
  capacityAvailable: 3,
  createdAt,
  updatedAt
};
const job = {
  id: 'synthetic-job',
  batchId: 'synthetic-batch',
  channel: 'linkedin',
  provider: 'linkedin',
  mode: 'live',
  status: 'failed',
  idempotencyKey: 'synthetic-stable-publication-key',
  title: 'Historical final title',
  body: 'Historical final content',
  disclosureText: 'Historical final disclosure',
  draftIds: ['synthetic-draft-2', 'synthetic-draft-1'],
  externalPostId: null,
  externalPostUrl: null,
  errorCode: 'SYNTHETIC_PROVIDER_ERROR',
  errorMessage: 'Synthetic safe diagnostic',
  attemptedAt: '2026-01-01 09:00:00+00',
  publishedAt: null,
  createdAt,
  updatedAt
};

test('draft projection preserves the exact reviewed content, dates and private review fields', () => {
  assert.deepEqual(
    mapPublicationDraftRow({
      ...draftRow,
      extra_private_contact: 'excluded@example.test'
    }),
    draftRow
  );
});

test('batch and slot projections preserve association order and their distinct contracts', () => {
  const before = structuredClone([batchRow, slotRow]);
  assert.deepEqual(mapPublicationBatchRow(batchRow), batch);
  assert.deepEqual(mapPublicationSlotRow(slotRow), slot);
  assert.deepEqual([batchRow, slotRow], before, 'stored rows remain unchanged');
});

test('social job projection preserves the attempt, stable identity and provider error', () => {
  assert.deepEqual(
    mapSocialPublicationJobRow({
      ...jobRow,
      provider_token: 'synthetic-excluded'
    }),
    job
  );
  assert.deepEqual(
    mapSocialPublicationJobRow({
      ...jobRow,
      status: 'published',
      external_post_id: 'synthetic-post',
      external_post_url: 'https://example.test/synthetic-post',
      published_at: updatedAt,
      error_code: null,
      error_message: null
    }),
    {
      ...job,
      status: 'published',
      externalPostId: 'synthetic-post',
      externalPostUrl: 'https://example.test/synthetic-post',
      publishedAt: updatedAt,
      errorCode: null,
      errorMessage: null
    }
  );
});

test('shared capacity conversion keeps historical parsing and clamps only available capacity', () => {
  for (const [capacity, used, expectedCapacity, expectedUsed, available] of [
    ['5', '2', 5, 2, 3],
    ['0009', '03', 9, 3, 6],
    ['0', '0', 0, 0, 0],
    ['2', '5', 2, 5, 0],
    ['-4', '-2', -4, -2, 0],
    ['9items', '2.7', 9, 2, 7],
    [3, 1, 3, 1, 2],
    ['invalid', '0', NaN, 0, NaN],
    [null, '1', NaN, 1, NaN],
    ['3', null, 3, NaN, NaN],
    [undefined, undefined, NaN, NaN, NaN]
  ]) {
    for (const [map, source] of [
      [mapPublicationBatchRow, batchRow],
      [mapPublicationSlotRow, slotRow]
    ]) {
      const result = map({ ...source, capacity, capacity_used: used });
      assert.deepEqual(
        [result.capacity, result.capacityUsed, result.capacityAvailable],
        [expectedCapacity, expectedUsed, available]
      );
    }
  }
});

test('shared assignment filtering preserves duplicates, whitespace and historical truthy values', () => {
  const malformedEntry = { historical: 'synthetic' };
  const ids = [
    'second',
    null,
    '',
    'first',
    'second',
    ' ',
    0,
    false,
    malformedEntry
  ];
  const expected = ['second', 'first', 'second', ' ', malformedEntry];
  assert.deepEqual(
    mapPublicationBatchRow({ ...batchRow, assigned_draft_ids: ids })
      .assignedDraftIds,
    expected
  );
  const result = mapPublicationSlotRow({
    ...slotRow,
    assigned_batch_ids: ids,
    assigned_draft_ids: ids
  });
  assert.deepEqual(result.assignedBatchIds, expected);
  assert.deepEqual(result.assignedDraftIds, expected);
  assert.deepEqual(
    mapSocialPublicationJobRow({ ...jobRow, draft_ids: ids }).draftIds,
    expected
  );
  assert.deepEqual(ids, [
    'second',
    null,
    '',
    'first',
    'second',
    ' ',
    0,
    false,
    malformedEntry
  ]);
});

test('missing assignment aggregates remain empty and invalid aggregate shapes still fail', () => {
  for (const value of [null, undefined, []]) {
    assert.deepEqual(
      mapPublicationBatchRow({ ...batchRow, assigned_draft_ids: value })
        .assignedDraftIds,
      []
    );
    const result = mapPublicationSlotRow({
      ...slotRow,
      assigned_batch_ids: value,
      assigned_draft_ids: value
    });
    assert.deepEqual(result.assignedBatchIds, []);
    assert.deepEqual(result.assignedDraftIds, []);
    assert.deepEqual(
      mapSocialPublicationJobRow({ ...jobRow, draft_ids: value }).draftIds,
      []
    );
  }
  for (const value of ['not-an-array', 42, {}]) {
    assert.throws(
      () => mapPublicationBatchRow({ ...batchRow, assigned_draft_ids: value }),
      TypeError
    );
    assert.throws(
      () => mapPublicationSlotRow({ ...slotRow, assigned_batch_ids: value }),
      TypeError
    );
    assert.throws(
      () => mapSocialPublicationJobRow({ ...jobRow, draft_ids: value }),
      TypeError
    );
  }
});

const presence = {
  has_publication_drafts: true,
  has_publication_batches: true,
  has_publication_slots: true,
  has_social_publication_jobs: true,
  has_audit_log: true,
  has_fund_allocations: true
};
const runtime = { mode: 'mock', configuredChannels: ['facebook'] };
const listings = [
  [
    listAdminPublicationDrafts,
    'has_publication_drafts',
    'drafts',
    draftRow,
    draftRow,
    {
      id: 'synthetic-filter',
      all: true,
      contributionId: 'synthetic-contribution'
    },
    ['synthetic-filter', null, 'synthetic-contribution']
  ],
  [
    listAdminPublicationBatches,
    'has_publication_batches',
    'batches',
    batchRow,
    batch,
    { id: 'synthetic-filter', all: true },
    ['synthetic-filter', null]
  ],
  [
    listAdminPublicationSlots,
    'has_publication_slots',
    'slots',
    slotRow,
    slot,
    { id: 'synthetic-filter', all: true },
    ['synthetic-filter', null]
  ],
  [
    listAdminSocialPublicationJobs,
    'has_social_publication_jobs',
    'jobs',
    jobRow,
    job,
    runtime,
    undefined
  ]
];

for (const [
  list,
  tableFlag,
  collection,
  row,
  expected,
  options,
  params
] of listings) {
  test(`${collection} listing binds its filters and projects rows without reordering`, async () => {
    const calls = [];
    const olderRow = { ...row, updated_at: createdAt };
    const pool = {
      async query(sql, bound) {
        calls.push(bound);
        assert.match(sql, /^\s*SELECT\s/);
        return {
          rows: sql.includes('to_regclass') ? [presence] : [olderRow, row]
        };
      }
    };
    const result = await list(pool, options);
    assert.equal(result.data_source, 'database');
    assert.equal(result.last_updated_at, updatedAt);
    assert.deepEqual(result[collection], [
      {
        ...expected,
        [collection === 'drafts' ? 'updated_at' : 'updatedAt']: createdAt
      },
      expected
    ]);
    assert.deepEqual(calls, [undefined, params]);
    if (collection === 'jobs') {
      assert.equal(
        result.mode,
        'mock',
        'runtime mode stays separate from stored live job'
      );
      assert.deepEqual(result.configuredChannels, ['facebook']);
    }
  });

  test(`${collection} listing preserves empty results when storage is absent`, async () => {
    assert.deepEqual((await list(null, options))[collection], []);
    let queries = 0;
    const pool = {
      async query(sql) {
        queries += 1;
        assert.ok(sql.includes('to_regclass'));
        return { rows: [{ ...presence, [tableFlag]: false }] };
      }
    };
    assert.deepEqual((await list(pool, options))[collection], []);
    assert.equal(
      queries,
      1,
      'missing table does not query publication records'
    );
  });

  test(`${collection} listing propagates storage failures without reporting an empty success`, async () => {
    const failure = new Error('Synthetic query failure');
    const pool = {
      async query(sql) {
        if (sql.includes('to_regclass')) return { rows: [presence] };
        throw failure;
      }
    };
    await assert.rejects(list(pool, options), (error) => error === failure);
  });
}

test('batch lookup preserves identity binding, absence and query failures', async () => {
  const pool = {
    async query(sql, params) {
      assert.ok(sql.includes('WHERE batch.id = $1::uuid'));
      assert.deepEqual(params, ['synthetic-batch']);
      return { rows: [batchRow] };
    }
  };
  assert.deepEqual(await getPublicationBatchById(pool, batchRow.id), batch);
  assert.equal(await getPublicationBatchById(null, 'missing'), null);
  assert.equal(
    await getPublicationBatchById(
      {
        async query() {
          return { rows: [] };
        }
      },
      'missing'
    ),
    null
  );
  const failure = new Error('Synthetic batch lookup failure');
  await assert.rejects(
    getPublicationBatchById(
      {
        async query() {
          throw failure;
        }
      },
      'missing'
    ),
    (error) => error === failure
  );
});

test('public availability still exposes only dates and destinations, with no admin snapshot fields', async () => {
  const pool = {
    async query(sql) {
      assert.match(sql, /^\s*SELECT\s/);
      return {
        rows: sql.includes('to_regclass')
          ? [presence]
          : [{ ...slotRow, sponsor_contact_email: 'excluded@example.test' }]
      };
    }
  };
  assert.deepEqual(await getPublicSponsorshipBatchAvailability(pool), {
    data_source: 'database',
    availability: [
      { channel: 'facebook', nextAvailableAt: null },
      { channel: 'linkedin', nextAvailableAt: '2026-02-01 10:00:00+00' }
    ],
    slots: [
      {
        feedTarget: 'openg20',
        channel: 'linkedin',
        startsAt: '2026-02-01 10:00:00+00',
        timezone: 'America/Toronto'
      }
    ]
  });
});
