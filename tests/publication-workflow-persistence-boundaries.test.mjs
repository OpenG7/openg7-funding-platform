import assert from 'node:assert/strict';
import test from 'node:test';

import * as facade from '../dist/apps/funding-api/src/fund-admin.repository.js';
import * as drafts from '../dist/apps/funding-api/src/fund-publication-drafts.repository.js';
import * as batches from '../dist/apps/funding-api/src/fund-publication-batches.repository.js';
import * as jobs from '../dist/apps/funding-api/src/social-publication-jobs.repository.js';

const presence = {
  has_publication_drafts: true,
  has_publication_batches: true,
  has_publication_slots: true,
  has_social_publication_jobs: true
};
const draftRow = {
  id: 'synthetic-draft',
  contribution_id: 'synthetic-sponsor',
  sponsor_company_name: 'Synthetic sponsor',
  sponsor_website_url: null,
  sponsor_logo_url: null,
  sponsor_public_summary: 'Approved public summary',
  feed_target: 'openg7',
  channel: 'facebook',
  title: 'Synthetic title',
  body: 'Synthetic body',
  disclosure_text: 'Synthetic disclosure',
  status: 'approved',
  public_url: null,
  scheduled_at: null,
  approved_at: '2026-10-01T12:00:00Z',
  published_at: null,
  review_note: null,
  batch_id: null,
  slot_id: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-02T12:00:00Z'
};
const batchRow = {
  id: 'synthetic-batch',
  channel: 'facebook',
  capacity: '2',
  status: 'scheduled',
  slot_id: 'synthetic-slot',
  scheduled_at: '2026-11-01T12:00:00Z',
  published_at: null,
  notes: null,
  assigned_draft_ids: [draftRow.id],
  capacity_used: '1',
  created_at: draftRow.created_at,
  updated_at: draftRow.updated_at
};
const jobRow = {
  id: 'synthetic-job',
  batch_id: batchRow.id,
  channel: 'facebook',
  provider: 'facebook',
  mode: 'mock',
  status: 'published',
  idempotency_key: `social-publication-batch:${batchRow.id}:facebook`,
  title: 'Synthetic collective title',
  body: 'Synthetic collective body',
  disclosure_text: 'Synthetic disclosure',
  draft_ids: [draftRow.id],
  external_post_id: 'synthetic-external-post',
  external_post_url: 'https://example.test/post',
  error_code: null,
  error_message: null,
  attempted_at: draftRow.created_at,
  published_at: draftRow.updated_at,
  created_at: draftRow.created_at,
  updated_at: draftRow.updated_at
};
const mutations = [
  [
    'createAdminPublicationDraft',
    {
      contributionId: draftRow.contribution_id,
      feedTarget: 'openg7',
      channel: 'facebook'
    },
    'draft'
  ],
  [
    'updateAdminPublicationDraft',
    { draftId: draftRow.id, body: 'Changed body' },
    'draft'
  ],
  [
    'createAdminPublicationBatch',
    { channel: 'facebook', capacity: 2 },
    'batch'
  ],
  [
    'assignDraftToPublicationBatch',
    { draftId: draftRow.id, batchId: batchRow.id },
    'draft'
  ],
  ['unassignDraftFromPublicationBatch', { draftId: draftRow.id }, 'draft'],
  [
    'scheduleAdminPublicationBatch',
    { batchId: batchRow.id, scheduledAt: batchRow.scheduled_at },
    'batch'
  ],
  ['publishAdminPublicationBatch', { batchId: batchRow.id }, 'batch'],
  ['cancelAdminPublicationBatch', { batchId: batchRow.id }, 'batch']
];
const runtime = { mode: 'mock', configuredChannels: ['facebook'] };

test('publication facade preserves every owner export and status-set identity', () => {
  for (const owner of [drafts, batches, jobs]) {
    for (const [name, value] of Object.entries(owner)) {
      if (name === 'getPublicationDraftById') continue;
      assert.equal(facade[name], value, name);
    }
  }
  assert.deepEqual(
    [...facade.allowedPublicationDraftStatuses],
    [
      'draft',
      'pending_review',
      'approved',
      'scheduled',
      'published',
      'rejected',
      'cancelled'
    ]
  );
  assert.deepEqual(
    [...facade.allowedPublicationBatchStatuses],
    ['open', 'scheduled', 'published', 'cancelled']
  );
});

test('publication operations preserve empty database-free and unavailable-table results', async () => {
  const absent = {
    async query(sql) {
      assert.ok(sql.includes('to_regclass'));
      return { rows: [] };
    },
    connect() {
      assert.fail('unavailable tables must not acquire a transaction client');
    }
  };
  for (const pool of [null, absent]) {
    for (const [name, input, key] of mutations) {
      assert.deepEqual(await facade[name](pool, input), {
        updated: false,
        [key]: null
      });
    }
    for (const [name, key, args] of [
      ['listAdminPublicationDrafts', 'drafts', {}],
      ['listAdminPublicationBatches', 'batches', {}],
      ['listAdminSocialPublicationJobs', 'jobs', runtime]
    ]) {
      const result = await facade[name](pool, args);
      assert.equal(result.data_source, 'database');
      assert.deepEqual(result[key], []);
      assert.ok(Number.isFinite(Date.parse(result.last_updated_at)));
      if (key === 'jobs') {
        assert.equal(result.mode, runtime.mode);
        assert.equal(result.configuredChannels, runtime.configuredChannels);
      }
    }
    assert.equal(
      await facade.createSocialPublicationJobForBatch(pool, {
        batchId: batchRow.id,
        mode: 'mock',
        provider: 'facebook'
      }),
      null
    );
  }
  assert.equal(await facade.getPublicationBatchById(null, batchRow.id), null);
  assert.equal(
    await facade.markSocialPublicationJobPublishing(null, jobRow.id),
    null
  );
  assert.equal(
    await facade.markSocialPublicationJobFailed(null, {
      jobId: jobRow.id,
      errorCode: 'SYNTHETIC',
      errorMessage: 'Synthetic failure'
    }),
    null
  );
  assert.deepEqual(
    await facade.markSocialPublicationJobPublished(null, {
      jobId: jobRow.id,
      externalPostId: jobRow.external_post_id,
      externalPostUrl: null
    }),
    { published: false, mode: 'disabled', job: null, batch: null }
  );
});

test('draft creation declines ineligible sponsors without inserting a publication', async () => {
  const pool = {
    async query(sql, values) {
      if (sql.includes('to_regclass')) return { rows: [presence] };
      assert.ok(sql.includes('FROM fund_contributions'));
      assert.deepEqual(values, [draftRow.contribution_id]);
      return { rows: [] };
    }
  };
  assert.deepEqual(
    await facade.createAdminPublicationDraft(pool, mutations[0][1]),
    { updated: false, draft: null }
  );
});

test('draft edits preserve normalization, explicit nulls, timestamps and no-op rereads', async () => {
  const updates = [];
  const pool = {
    async query(sql, values) {
      if (sql.includes('to_regclass')) return { rows: [presence] };
      if (sql.includes('UPDATE sponsor_publication_drafts')) {
        updates.push({ sql, values });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [draftRow] };
    }
  };
  assert.equal(
    (await facade.updateAdminPublicationDraft(pool, { draftId: draftRow.id }))
      .updated,
    false
  );
  assert.equal(updates.length, 0);
  const result = await facade.updateAdminPublicationDraft(pool, {
    draftId: draftRow.id,
    title: '  Revised title  ',
    body: '  Revised body  ',
    disclosureText: '  Revised disclosure  ',
    status: 'approved',
    publicUrl: '  ',
    scheduledAt: null,
    reviewNote: '  '
  });
  assert.equal(result.updated, true);
  assert.deepEqual(result.draft, draftRow);
  assert.deepEqual(updates[0].values, [
    draftRow.id,
    'Revised title',
    'Revised body',
    'Revised disclosure',
    'approved',
    '',
    null,
    ''
  ]);
  assert.ok(
    updates[0].sql.includes('approved_at = COALESCE(approved_at, NOW())')
  );
});

test('conflicting assignments reread the unchanged draft without reporting success', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('to_regclass')) return { rows: [presence] };
      if (sql.includes('UPDATE sponsor_publication_drafts'))
        return { rows: [], rowCount: 0 };
      return { rows: [draftRow] };
    }
  };
  assert.deepEqual(
    await facade.assignDraftToPublicationBatch(pool, mutations[3][1]),
    { updated: false, draft: draftRow }
  );
});

test('manual publication preserves sequential cascades and propagates database errors', async () => {
  const events = [];
  const failure = new Error('Synthetic draft cascade failure');
  const pool = {
    async query(sql) {
      if (sql.includes('to_regclass')) return { rows: [presence] };
      if (sql.includes('UPDATE sponsor_publication_batches')) {
        events.push('batch');
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('UPDATE sponsor_publication_drafts')) {
        events.push('drafts');
        throw failure;
      }
      assert.fail(
        'a failed draft cascade must not continue to slots or rereads'
      );
    },
    connect() {
      assert.fail('manual batch publication retains its pool-based queries');
    }
  };
  await assert.rejects(
    facade.publishAdminPublicationBatch(pool, { batchId: batchRow.id }),
    (error) => error === failure
  );
  assert.deepEqual(events, ['batch', 'drafts']);
});

const publicationTransaction = ({
  failureAt,
  missingJob = false,
  slotsAvailable = true
} = {}) => {
  const events = [];
  const failure = new Error('Synthetic social publication failure');
  let open = false;
  const client = {
    async query(command, values) {
      const sql = command.replace(/\s+/g, ' ').trim();
      if (sql === 'BEGIN') {
        open = true;
        events.push('BEGIN');
        return { rows: [] };
      }
      assert.equal(
        open,
        true,
        'every publication write uses the open transaction client'
      );
      if (sql === 'COMMIT' || sql === 'ROLLBACK') {
        open = false;
        events.push(sql);
        return { rows: [] };
      }
      const stage = sql.startsWith('UPDATE social_publication_jobs')
        ? 'job'
        : sql.startsWith('UPDATE sponsor_publication_batches')
          ? 'batch'
          : sql.startsWith('UPDATE sponsor_publication_drafts')
            ? 'drafts'
            : sql.startsWith('UPDATE publication_slots')
              ? 'slot'
              : null;
      assert.ok(stage, 'expected only publication writes on the client');
      events.push(stage);
      if (stage === failureAt) throw failure;
      if (stage === 'job') {
        assert.deepEqual(values, [
          jobRow.id,
          jobRow.external_post_id,
          jobRow.external_post_url
        ]);
        return { rows: missingJob ? [] : [jobRow] };
      }
      assert.equal(values[0], batchRow.id);
      return { rows: [], rowCount: 1 };
    },
    release() {
      assert.equal(open, false);
      events.push('release');
    }
  };
  return {
    events,
    failure,
    pool: {
      async query(sql) {
        assert.equal(
          open,
          false,
          'pool reads must remain outside the transaction'
        );
        if (sql.includes('to_regclass'))
          return {
            rows: [{ ...presence, has_publication_slots: slotsAvailable }]
          };
        assert.ok(sql.includes('FROM sponsor_publication_batches'));
        events.push('reread');
        return { rows: [{ ...batchRow, status: 'published' }] };
      },
      async connect() {
        return client;
      }
    }
  };
};
const publishInput = {
  jobId: jobRow.id,
  externalPostId: jobRow.external_post_id,
  externalPostUrl: jobRow.external_post_url
};

test('job publication commits job, batch, drafts and slot before rereading the batch', async () => {
  const { pool, events } = publicationTransaction();
  const result = await facade.markSocialPublicationJobPublished(
    pool,
    publishInput
  );
  assert.deepEqual(events, [
    'BEGIN',
    'job',
    'batch',
    'drafts',
    'slot',
    'COMMIT',
    'reread',
    'release'
  ]);
  assert.equal(result.published, true);
  assert.equal(result.job.externalPostId, jobRow.external_post_id);
  assert.equal(result.batch.status, 'published');
});

for (const failureAt of ['job', 'batch', 'drafts', 'slot']) {
  test(`job publication rolls back and releases the client on ${failureAt} failure`, async () => {
    const { pool, events, failure } = publicationTransaction({ failureAt });
    await assert.rejects(
      facade.markSocialPublicationJobPublished(pool, publishInput),
      (error) => error === failure
    );
    assert.deepEqual(events, [
      'BEGIN',
      ...['job', 'batch', 'drafts', 'slot'].slice(
        0,
        ['job', 'batch', 'drafts', 'slot'].indexOf(failureAt) + 1
      ),
      'ROLLBACK',
      'release'
    ]);
  });
}

test('missing jobs commit without cascading, and unavailable slots omit only the slot write', async () => {
  const missing = publicationTransaction({ missingJob: true });
  assert.deepEqual(
    await facade.markSocialPublicationJobPublished(missing.pool, publishInput),
    { published: false, mode: 'disabled', job: null, batch: null }
  );
  assert.deepEqual(missing.events, ['BEGIN', 'job', 'COMMIT', 'release']);
  const withoutSlots = publicationTransaction({ slotsAvailable: false });
  assert.equal(
    (
      await facade.markSocialPublicationJobPublished(
        withoutSlots.pool,
        publishInput
      )
    ).published,
    true
  );
  assert.deepEqual(withoutSlots.events, [
    'BEGIN',
    'job',
    'batch',
    'drafts',
    'COMMIT',
    'reread',
    'release'
  ]);
});
