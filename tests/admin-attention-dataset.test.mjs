import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAttentionDatasetLoader,
  loadAttentionDataset
} from '../dist/apps/funding-api/src/admin-assistant/attention/dataset.js';

const NOW = new Date('2026-11-01T01:15:00-04:00');
const emptyResults = () => ({
  listSponsorshipsForAttention: { items: [], truncated: false },
  listAdminPublicationDrafts: { drafts: [] },
  listAdminPublicationBatches: { batches: [] },
  listAdminPublicationSlots: { slots: [] },
  listAdminEmailQueue: { messages: [] },
  getAdminDashboard: {
    totals: {
      total_received: 0,
      total_refunded: 0,
      total_disputed: 0,
      currency: 'CAD'
    }
  }
});

test('complete datasets request every source without caps and preserve source truncation', async () => {
  const calls = [];
  const cappedSponsorships = Array.from({ length: 2000 }, (_unused, index) => ({
    contributionId: `synthetic-${index}`
  }));
  const allSponsorships = [
    ...cappedSponsorships,
    { contributionId: 'synthetic-final' }
  ];
  const sources = {
    listAdminPublicationDrafts: [
      'drafts',
      Array.from({ length: 151 }, (_unused, id) => ({ id }))
    ],
    listAdminPublicationBatches: [
      'batches',
      Array.from({ length: 101 }, (_unused, id) => ({ id }))
    ],
    listAdminPublicationSlots: [
      'slots',
      Array.from({ length: 101 }, (_unused, id) => ({ id }))
    ],
    listAdminEmailQueue: [
      'messages',
      Array.from({ length: 151 }, (_unused, id) => ({ id }))
    ]
  };
  const readers = {
    listSponsorshipsForAttention: async (pool, maxRows) => {
      calls.push(['sponsorships', pool, maxRows]);
      return {
        items: maxRows === null ? allSponsorships : cappedSponsorships,
        truncated: maxRows !== null
      };
    },
    ...Object.fromEntries(
      Object.entries(sources).map(([name, [key, rows]]) => [
        name,
        async (pool, options) => {
          calls.push([name, pool, options]);
          return { [key]: options.all ? rows : rows.slice(0, 100) };
        }
      ])
    ),
    getAdminDashboard: async (pool) => {
      calls.push(['dashboard', pool]);
      return {
        totals: {
          total_received: 900,
          total_refunded: 120,
          total_disputed: 40,
          currency: 'USD',
          current_available_estimate: 740
        },
        recent_contributions: [{ privateSyntheticValue: 'private-synthetic' }]
      };
    }
  };
  const load = createAttentionDatasetLoader(readers);
  const pool = Object.freeze({ synthetic: true });
  const capped = await load(pool, NOW);
  const complete = await load(pool, NOW, true);

  assert.equal(capped.sponsorships.length, 2000);
  assert.equal(capped.sponsorshipsTruncated, true);
  assert.equal(complete.sponsorships.length, 2001);
  assert.equal(complete.sponsorshipsTruncated, false);
  assert.strictEqual(complete.sponsorships, allSponsorships);
  for (const [name, [key, rows]] of Object.entries(sources)) {
    const datasetKey = key === 'messages' ? 'emailMessages' : key;
    assert.equal(capped[datasetKey].length, 100);
    assert.strictEqual(complete[datasetKey], rows);
    assert.deepEqual(
      calls.filter(([reader]) => reader === name).map((call) => call[2]),
      [{ all: false }, { all: true }]
    );
  }
  assert.deepEqual(
    calls
      .filter(([reader]) => reader === 'sponsorships')
      .map((call) => call[2]),
    [undefined, null]
  );
  assert.equal(calls.length, 12);
  assert.ok(calls.every((call) => call[1] === pool));
  assert.strictEqual(complete.now, NOW);
  assert.deepEqual(complete.financialTotals, {
    grossPaid: 900,
    refunded: 120,
    disputed: 40,
    currency: 'USD'
  });
  assert.ok(!JSON.stringify(complete).includes('private-synthetic'));
  assert.ok(!JSON.stringify(complete).includes('current_available_estimate'));
});

test('all readers start before the dataset waits for a delayed source', async () => {
  const results = emptyResults();
  const gate = Promise.withResolvers();
  const calls = [];
  const readers = Object.fromEntries(
    Object.entries(results).map(([name, result]) => [
      name,
      async () => {
        calls.push(name);
        if (name === 'listSponsorshipsForAttention') await gate.promise;
        return result;
      }
    ])
  );
  const loading = createAttentionDatasetLoader(readers)(null, NOW);
  assert.equal(calls.length, 6);
  gate.resolve();
  assert.deepEqual((await loading).financialTotals, {
    grossPaid: 0,
    refunded: 0,
    disputed: 0,
    currency: 'CAD'
  });
});

test('reader failures propagate unchanged instead of producing empty success', async (context) => {
  for (const failingReader of Object.keys(emptyResults())) {
    await context.test(failingReader, async () => {
      const failure = new Error(`Synthetic ${failingReader} unavailable`);
      const readers = Object.fromEntries(
        Object.entries(emptyResults()).map(([name, result]) => [
          name,
          async () => {
            if (name === failingReader) throw failure;
            return result;
          }
        ])
      );
      await assert.rejects(
        createAttentionDatasetLoader(readers)(null, NOW),
        (error) => error === failure
      );
    });
  }
});

test('production reader composition preserves the pool-null fallback for both list modes', async () => {
  for (const complete of [false, true]) {
    const loaded = await loadAttentionDataset(null, NOW, complete);
    assert.strictEqual(loaded.now, NOW);
    assert.equal(loaded.sponsorshipsTruncated, false);
    for (const key of [
      'sponsorships',
      'drafts',
      'batches',
      'slots',
      'emailMessages'
    ]) {
      assert.deepEqual(loaded[key], []);
    }
    assert.deepEqual(loaded.financialTotals, {
      grossPaid: 0,
      refunded: 0,
      disputed: 0,
      currency: 'CAD'
    });
  }
  const before = Date.now();
  const defaultDate = (await loadAttentionDataset(null)).now;
  assert.ok(
    defaultDate.getTime() >= before && defaultDate.getTime() <= Date.now()
  );
});

test('repository errors from a present pool still reject the public loader', async () => {
  const failure = new Error('Synthetic database read failed');
  const pool = {
    query: async () => {
      throw failure;
    }
  };
  await assert.rejects(
    loadAttentionDataset(pool, NOW),
    (error) => error === failure
  );
});
