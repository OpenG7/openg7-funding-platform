import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleAdminPublicationBatch } from '../dist/apps/funding-api/src/fund-publication-batches.repository.js';

const id = '11111111-1111-4111-8111-111111111111';
const slotId = '22222222-2222-4222-8222-222222222222';
const date = '2099-02-04T15:00:00Z';
const presence = {
  has_publication_batches: true,
  has_publication_drafts: true,
  has_publication_slots: true
};
const batchRow = {
  id,
  channel: 'facebook',
  capacity: '2',
  status: 'scheduled',
  slot_id: slotId,
  scheduled_at: date,
  published_at: null,
  notes: null,
  assigned_draft_ids: [],
  capacity_used: '0',
  created_at: date,
  updated_at: date
};

function fixture({
  batch = { status: 'open', slot_id: slotId, date_is_future: true },
  candidate = batch,
  slot = { status: 'scheduled', date_is_future: true, date_matches: true },
  failAt,
  updateCount = 1
} = {}) {
  const events = [];
  const failure = new Error('Synthetic schedule transaction failure');
  let open = false;
  const client = {
    async query(sql) {
      const text = sql.replace(/\s+/g, ' ').trim();
      if (text === 'BEGIN') {
        open = true;
        events.push('BEGIN');
        return { rows: [] };
      }
      assert.equal(open, true);
      if (text === 'COMMIT' || text === 'ROLLBACK') {
        events.push(text);
        if (text === failAt) throw failure;
        open = false;
        return { rows: [] };
      }
      const stage = text.startsWith('SELECT status,slot_id')
        ? text.endsWith('FOR UPDATE')
          ? 'batch-lock'
          : 'membership-read'
        : text.startsWith('SELECT status,starts_at')
          ? 'slot-lock'
          : text.startsWith('UPDATE sponsor_publication_batches')
            ? 'batch-write'
            : text.startsWith('UPDATE sponsor_publication_drafts')
              ? 'draft-write'
              : text.includes('FROM sponsor_publication_batches batch')
                ? 'reread'
                : null;
      assert.ok(
        stage,
        'only scoped batch/draft writes and locked reads are allowed'
      );
      events.push(stage);
      if (stage === failAt) throw failure;
      if (stage === 'membership-read') {
        return { rows: candidate ? [candidate] : [] };
      }
      if (stage === 'batch-lock') {
        assert.match(text, /FOR UPDATE$/);
        return { rows: batch ? [batch] : [] };
      }
      if (stage === 'slot-lock') {
        assert.match(text, /FOR SHARE$/);
        return { rows: slot ? [slot] : [] };
      }
      if (stage === 'reread') return { rows: batch ? [batchRow] : [] };
      if (stage === 'batch-write') {
        assert.match(text, /clock_timestamp\(\)/);
        return { rows: [], rowCount: updateCount };
      }
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
          'all transaction reads and writes use its client'
        );
        assert.ok(sql.includes('to_regclass'));
        return { rows: [presence] };
      },
      async connect() {
        return client;
      }
    }
  };
}

test('batch scheduling declines missing, final and expired targets before any slot read or write', async () => {
  for (const batch of [
    null,
    { status: 'published', slot_id: slotId, date_is_future: true },
    { status: 'cancelled', slot_id: slotId, date_is_future: true },
    { status: 'open', slot_id: slotId, date_is_future: false }
  ]) {
    const f = fixture({ batch });
    assert.equal(
      (
        await scheduleAdminPublicationBatch(f.pool, {
          batchId: id,
          scheduledAt: date
        })
      ).updated,
      false
    );
    assert.deepEqual(f.events, [
      'BEGIN',
      'membership-read',
      'reread',
      'ROLLBACK',
      'release'
    ]);
  }
});

test('attached batch date changes return the slot command contract without any write', async () => {
  const f = fixture({
    slot: { status: 'scheduled', date_is_future: true, date_matches: false }
  });
  const result = await scheduleAdminPublicationBatch(f.pool, {
    batchId: id,
    scheduledAt: date
  });
  assert.equal(result.updated, false);
  assert.equal(result.code, 'PUBLICATION_SLOT_SCHEDULE_REQUIRED');
  assert.deepEqual(f.events, [
    'BEGIN',
    'membership-read',
    'slot-lock',
    'batch-lock',
    'reread',
    'ROLLBACK',
    'release'
  ]);
});

test('attached batches reject unavailable or final slots before scheduling', async () => {
  for (const slot of [
    null,
    { status: 'published', date_is_future: true, date_matches: true },
    { status: 'cancelled', date_is_future: true, date_matches: true },
    { status: 'scheduled', date_is_future: false, date_matches: true }
  ]) {
    const f = fixture({ slot });
    assert.equal(
      (
        await scheduleAdminPublicationBatch(f.pool, {
          batchId: id,
          scheduledAt: date
        })
      ).updated,
      false
    );
    assert.equal(
      f.events.some((event) => event.endsWith('-write')),
      false
    );
    assert.deepEqual(f.events.slice(-2), ['ROLLBACK', 'release']);
  }
});

test('same-date attached and unbound batch scheduling commit only their batch and drafts', async () => {
  for (const attached of [true, false]) {
    const f = fixture({
      batch: {
        status: 'open',
        slot_id: attached ? slotId : null,
        date_is_future: true
      }
    });
    assert.equal(
      (
        await scheduleAdminPublicationBatch(f.pool, {
          batchId: id,
          scheduledAt: date
        })
      ).updated,
      true
    );
    assert.deepEqual(f.events, [
      'BEGIN',
      'membership-read',
      ...(attached ? ['slot-lock'] : []),
      'batch-lock',
      'batch-write',
      'draft-write',
      'reread',
      'COMMIT',
      'release'
    ]);
  }
});

test('changed membership or eligibility after the first read declines without acquiring a different slot lock', async () => {
  const otherSlotId = '33333333-3333-4333-8333-333333333333';
  for (const [candidateSlotId, batch] of [
    [null, { status: 'open', slot_id: slotId, date_is_future: true }],
    [slotId, { status: 'open', slot_id: null, date_is_future: true }],
    [slotId, { status: 'open', slot_id: otherSlotId, date_is_future: true }],
    [slotId, { status: 'published', slot_id: slotId, date_is_future: true }],
    [slotId, { status: 'open', slot_id: slotId, date_is_future: false }]
  ]) {
    const f = fixture({
      batch,
      candidate: {
        status: 'open',
        slot_id: candidateSlotId,
        date_is_future: true
      }
    });
    const result = await scheduleAdminPublicationBatch(f.pool, {
      batchId: id,
      scheduledAt: date
    });
    assert.equal(result.updated, false);
    assert.deepEqual(f.events, [
      'BEGIN',
      'membership-read',
      ...(candidateSlotId ? ['slot-lock'] : []),
      'batch-lock',
      'reread',
      'ROLLBACK',
      'release'
    ]);
  }
});

test('a date that expires while waiting for the batch lock declines before draft writes', async () => {
  const f = fixture({ updateCount: 0 });
  assert.equal(
    (
      await scheduleAdminPublicationBatch(f.pool, {
        batchId: id,
        scheduledAt: date
      })
    ).updated,
    false
  );
  assert.equal(f.events.includes('draft-write'), false);
  assert.deepEqual(f.events.slice(-2), ['ROLLBACK', 'release']);
});

test('draft, projection and commit failures roll back the whole scheduling transaction', async () => {
  for (const failAt of ['draft-write', 'reread', 'COMMIT']) {
    const f = fixture({ failAt });
    await assert.rejects(
      scheduleAdminPublicationBatch(f.pool, { batchId: id, scheduledAt: date }),
      (error) => error === f.failure
    );
    assert.equal(f.events.includes('batch-write'), true);
    assert.deepEqual(f.events.slice(-2), ['ROLLBACK', 'release']);
  }
});
