import assert from 'node:assert/strict';
import test from 'node:test';

import * as facade from '../dist/apps/funding-api/src/fund-admin.repository.js';
import * as calendar from '../dist/apps/funding-api/src/fund-publication-calendar.repository.js';

const presence = {
  has_publication_slots: true,
  has_publication_batches: true,
  has_publication_drafts: true
};
const slotRow = {
  id: 'synthetic-slot',
  feed_target: 'openg7',
  channel: 'facebook',
  starts_at: '2026-11-01T12:00:00Z',
  timezone: 'America/Toronto',
  capacity: '3',
  status: 'scheduled',
  notes: null,
  assigned_batch_ids: ['synthetic-batch'],
  assigned_draft_ids: ['synthetic-draft'],
  capacity_used: '1',
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-02T12:00:00Z'
};
const mutationInputs = [
  [
    'createAdminPublicationSlot',
    {
      feedTarget: 'openg7',
      channel: 'facebook',
      startsAt: slotRow.starts_at,
      capacity: 3
    }
  ],
  ['updateAdminPublicationSlot', { slotId: slotRow.id, capacity: 3 }],
  [
    'assignBatchToPublicationSlot',
    { slotId: slotRow.id, batchId: 'synthetic-batch' }
  ],
  [
    'assignDraftToPublicationSlot',
    { slotId: slotRow.id, draftId: 'synthetic-draft' }
  ],
  ['publishAdminPublicationSlot', { slotId: slotRow.id }],
  ['cancelAdminPublicationSlot', { slotId: slotRow.id }]
];

test('calendar facade preserves function and status-set identity', () => {
  for (const name of [
    'allowedPublicationSlotStatuses',
    'getPublicSponsorshipBatchAvailability',
    'listAdminPublicationSlots',
    ...mutationInputs.map(([name]) => name)
  ]) {
    assert.equal(facade[name], calendar[name], name);
  }
});

test('calendar operations retain empty results with no database or slots table', async () => {
  assert.deepEqual(await facade.getPublicSponsorshipBatchAvailability(null), {
    data_source: 'empty',
    availability: [],
    slots: []
  });
  const absent = {
    async query(sql) {
      assert.ok(sql.includes('to_regclass'));
      return { rows: [] };
    },
    connect() {
      assert.fail('absent storage must not acquire a transaction client');
    }
  };
  for (const pool of [null, absent]) {
    const listing = await facade.listAdminPublicationSlots(pool);
    assert.deepEqual(listing.slots, []);
    assert.equal(listing.data_source, 'database');
    assert.ok(Number.isFinite(Date.parse(listing.last_updated_at)));
    for (const [name, input] of mutationInputs) {
      assert.deepEqual(await facade[name](pool, input), {
        updated: false,
        slot: null
      });
    }
    assert.deepEqual(await facade.getPublicSponsorshipBatchAvailability(pool), {
      data_source: 'empty',
      availability: [],
      slots: []
    });
  }
});

for (const [name, flag, input] of [
  [
    'assignBatchToPublicationSlot',
    'has_publication_batches',
    { slotId: slotRow.id, batchId: 'synthetic-batch' }
  ],
  [
    'assignDraftToPublicationSlot',
    'has_publication_drafts',
    { slotId: slotRow.id, draftId: 'synthetic-draft' }
  ]
]) {
  test(`${name} declines when its association table is unavailable`, async () => {
    let queries = 0;
    const pool = {
      async query(sql) {
        queries += 1;
        assert.ok(sql.includes('to_regclass'));
        return { rows: [{ ...presence, [flag]: false }] };
      }
    };
    assert.deepEqual(await facade[name](pool, input), {
      updated: false,
      slot: null
    });
    assert.equal(queries, 1);
  });
}

test('public availability preserves the legacy batch fallback when slots are unavailable', async () => {
  const pool = {
    async query(sql) {
      if (sql.includes('to_regclass')) {
        return { rows: [{ ...presence, has_publication_slots: false }] };
      }
      return {
        rows: [{ channel: 'linkedin', next_available_at: slotRow.starts_at }]
      };
    }
  };
  assert.deepEqual(await facade.getPublicSponsorshipBatchAvailability(pool), {
    data_source: 'database',
    availability: [
      { channel: 'facebook', nextAvailableAt: null },
      { channel: 'linkedin', nextAvailableAt: slotRow.starts_at }
    ],
    slots: []
  });
});

const lifecyclePool = ({ operation, failureAt, matched = true }) => {
  const events = [];
  const failure = new Error('Synthetic calendar write failure');
  let transactionOpen = false;
  let committed = false;
  let released = false;
  const client = {
    async query(command, values) {
      const sql = command.replace(/\s+/g, ' ').trim();
      events.push({ sql, values });
      if (sql === 'BEGIN') {
        transactionOpen = true;
        return { rows: [] };
      }
      assert.equal(
        transactionOpen,
        true,
        'linked writes require the same client'
      );
      if (sql === 'COMMIT' || sql === 'ROLLBACK') {
        transactionOpen = false;
        committed = sql === 'COMMIT';
        return { rows: [] };
      }
      assert.deepEqual(values, [slotRow.id]);
      if (sql.includes(`UPDATE ${failureAt}`)) throw failure;
      if (sql.includes('UPDATE publication_slots')) {
        return { rows: matched ? [{ id: slotRow.id }] : [] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {
      assert.equal(transactionOpen, false);
      assert.equal(released, false);
      released = true;
      events.push({ sql: 'release' });
    }
  };
  return {
    events,
    failure,
    pool: {
      async query(sql, values) {
        assert.equal(
          transactionOpen,
          false,
          'pool must not receive transaction writes'
        );
        if (sql.includes('to_regclass')) return { rows: [presence] };
        assert.equal(
          committed,
          true,
          'snapshot is read after the existing commit'
        );
        assert.deepEqual(values, [slotRow.id]);
        assert.ok(sql.includes('WHERE slot.id = $1::uuid'));
        return {
          rows: [{ ...slotRow, status: matched ? operation : slotRow.status }]
        };
      },
      async connect() {
        events.push({ sql: 'connect' });
        return client;
      }
    }
  };
};

for (const [name, operation] of [
  ['publishAdminPublicationSlot', 'published'],
  ['cancelAdminPublicationSlot', 'cancelled']
]) {
  test(`${name} keeps slot, batch and draft writes in its existing transaction`, async () => {
    const { pool, events } = lifecyclePool({ operation });
    const result = await facade[name](pool, { slotId: slotRow.id });
    assert.equal(result.updated, true);
    assert.equal(result.slot.status, operation);
    assert.deepEqual(result.slot.assignedBatchIds, ['synthetic-batch']);
    assert.deepEqual(result.slot.assignedDraftIds, ['synthetic-draft']);
    assert.equal(result.slot.capacityUsed, 1);
    assert.equal(result.slot.capacityAvailable, 2);
    assert.deepEqual(
      events
        .filter(({ sql }) =>
          ['connect', 'BEGIN', 'COMMIT', 'ROLLBACK', 'release'].includes(sql)
        )
        .map(({ sql }) => sql),
      ['connect', 'BEGIN', 'COMMIT', 'release']
    );
    for (const table of [
      'publication_slots',
      'sponsor_publication_batches',
      'sponsor_publication_drafts'
    ]) {
      assert.ok(events.some(({ sql }) => sql.includes(`UPDATE ${table}`)));
    }
  });

  test(`${name} leaves related records untouched when its slot transition does not match`, async () => {
    const { pool, events } = lifecyclePool({ operation, matched: false });
    const result = await facade[name](pool, { slotId: slotRow.id });
    assert.equal(result.updated, false);
    assert.equal(result.slot.status, 'scheduled');
    assert.equal(events.filter(({ sql }) => sql.includes('UPDATE ')).length, 1);
    assert.ok(events.some(({ sql }) => sql === 'COMMIT'));
    assert.equal(events.at(-1).sql, 'release');
  });

  for (const table of [
    'sponsor_publication_batches',
    'sponsor_publication_drafts'
  ]) {
    test(`${name} rolls back and releases on ${table} failure`, async () => {
      const { pool, events, failure } = lifecyclePool({
        operation,
        failureAt: table
      });
      await assert.rejects(
        facade[name](pool, { slotId: slotRow.id }),
        (error) => error === failure
      );
      assert.deepEqual(
        events
          .filter(({ sql }) =>
            ['BEGIN', 'COMMIT', 'ROLLBACK', 'release'].includes(sql)
          )
          .map(({ sql }) => sql),
        ['BEGIN', 'ROLLBACK', 'release']
      );
    });
  }
}

test('calendar readers and writes propagate unavailable database errors', async () => {
  const failure = new Error('Synthetic database unavailable');
  const pool = {
    async query() {
      throw failure;
    }
  };
  for (const [name, input] of [
    ['getPublicSponsorshipBatchAvailability'],
    ['listAdminPublicationSlots'],
    ...mutationInputs
  ]) {
    await assert.rejects(
      facade[name](pool, input),
      (error) => error === failure
    );
  }
});
