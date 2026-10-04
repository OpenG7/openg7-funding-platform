import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  getAdjustmentTotals,
  getPublicTransparencySummary,
  listPublicBuilders
} from '../dist/apps/funding-api/src/fund-transparency.repository.js';

const tables = (overrides = {}) => ({
  has_fund_contributions: true,
  has_fund_transactions: true,
  has_fund_allocations: true,
  has_sponsor_review_status: true,
  ...overrides
});
const totals = (overrides = {}) => ({
  total_received: '10000',
  contribution_refunded: '10000',
  contributions_count: '1',
  pending_fee_count: '0',
  currency_count: '1',
  currency: 'cad',
  last_updated_at: '2026-08-01T12:00:00Z',
  ...overrides
});
const adjustments = (overrides = {}) => ({
  total_fees: '300',
  total_refunded: '2500',
  total_payouts: '1000',
  currency_count: '1',
  currency: 'cad',
  last_updated_at: '2026-10-01T12:00:00Z',
  ...overrides
});
const builder = (overrides = {}) => ({
  contribution_id: '11111111-1111-4111-8111-111111111111',
  display_name: 'Synthetic builder',
  contribution_type: 'personal_support',
  amount: '2501',
  currency: 'cad',
  paid_at: '2026-08-01T12:00:00Z',
  total_count: '1',
  last_updated_at: '2026-10-01T12:00:00Z',
  email_private: 'private@example.invalid',
  ...overrides
});
const allocation = (overrides = {}) => ({
  project_name: 'Synthetic project',
  public_description: 'Public description',
  expected_outcome: 'Public outcome',
  progress_status: 'in_progress',
  proof_url: 'https://example.invalid/proof',
  proof_source: 'Synthetic public report',
  proof_published_at: '2026-09-01T12:00:00Z',
  amount_allocated: '4250',
  currency: 'cad',
  status: 'active',
  published_at: '2026-08-01T12:00:00Z',
  admin_note: 'Private synthetic note',
  ...overrides
});
const queuedPool = (responses) => {
  const calls = [];
  let position = 0;
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      assert.ok(position < responses.length, 'Unexpected transparency query');
      const response = responses[position++];
      if (response instanceof Error) throw response;
      return { rows: response };
    }
  };
};
const contributionResponses = ({
  tableRow = tables(),
  totalRow = totals(),
  monthly = [{ month: '2026-08', ...totals() }],
  adjustmentRow = adjustments(),
  adjustmentMonthly = [
    {
      month: '2026-10',
      ...adjustments({ total_fees: '0', total_refunded: '0' })
    },
    {
      month: '2026-09',
      ...adjustments({ total_fees: '0', total_payouts: '0' })
    },
    {
      month: '2026-08',
      ...adjustments({ total_refunded: '0', total_payouts: '0' })
    }
  ],
  allocations = [],
  builders = []
} = {}) => [
  [tableRow],
  [totalRow],
  monthly,
  ...(tableRow.has_fund_transactions
    ? [[adjustmentRow], adjustmentMonthly]
    : []),
  ...(tableRow.has_fund_allocations ? [allocations] : []),
  builders
];

test('absent storage stays distinct from real zero and preserves unavailable fee information', async () => {
  const absent = await getPublicTransparencySummary(null);
  assert.equal(absent.data_source, 'empty');
  assert.equal(absent.total_received, 0);
  assert.equal(absent.pending_fee_count, null);
  assert.deepEqual(absent.monthly_summary, []);
  assert.deepEqual(absent.latest_public_allocations, []);
  assert.deepEqual(absent.public_builders, []);
  assert.equal(absent.generated_at, undefined);
  assert.ok(Number.isFinite(Date.parse(absent.last_updated_at)));
  assert.deepEqual((await listPublicBuilders(null)).pagination, {
    page: 1,
    page_size: 24,
    total_count: 0
  });
  const missing = queuedPool([[], []]);
  assert.equal(
    (await getPublicTransparencySummary(missing)).data_source,
    'empty'
  );
  assert.equal((await listPublicBuilders(missing)).data_source, 'empty');
  const present = queuedPool(
    contributionResponses({
      tableRow: tables({
        has_fund_transactions: false,
        has_fund_allocations: false
      }),
      totalRow: totals({
        total_received: '0',
        contribution_refunded: '0',
        contributions_count: '0',
        currency_count: '0'
      }),
      monthly: []
    })
  );
  const zero = await getPublicTransparencySummary(present);
  assert.equal(zero.data_source, 'database');
  assert.equal(zero.pending_fee_count, 0);
  assert.equal(zero.current_available_estimate, 0);
  assert.ok(Number.isFinite(Date.parse(zero.generated_at)));
});

test('adjustment reads skip absent tables and preserve the empty-row fallback', async () => {
  const fallback = {
    total_fees: '0',
    total_refunded: '0',
    total_payouts: '0',
    last_updated_at: null
  };
  const absent = queuedPool([]);
  assert.deepEqual(await getAdjustmentTotals(absent, false), fallback);
  assert.equal(absent.calls.length, 0);
  assert.deepEqual(await getAdjustmentTotals(queuedPool([[]]), true), fallback);
  const row = adjustments();
  assert.deepEqual(await getAdjustmentTotals(queuedPool([[row]]), true), row);
});

test('directory pagination validates before storage and maps stable public identities without private data', async () => {
  const invalidPool = queuedPool([]);
  for (const pagination of [
    { page: 0 },
    { page: 100001 },
    { page: 1.5 },
    { pageSize: 0 },
    { pageSize: 51 },
    { pageSize: NaN }
  ])
    await assert.rejects(
      listPublicBuilders(invalidPool, pagination),
      RangeError
    );
  assert.equal(invalidPool.calls.length, 0);
  const pool = queuedPool([
    [tables()],
    [builder(), builder({ contribution_id: 'second', amount: null })]
  ]);
  const page = await listPublicBuilders(pool, { page: 2, pageSize: 12 });
  assert.deepEqual(pool.calls[1].params, [12, 12]);
  assert.equal(page.builders[0].amount, 25.01);
  assert.equal(page.builders[1].amount, null);
  assert.equal(page.builders[0].currency, 'CAD');
  assert.equal(
    page.builders[0].public_id,
    createHash('sha256')
      .update('public-builder:' + builder().contribution_id)
      .digest('hex')
  );
  assert.ok(!JSON.stringify(page).includes('private@example.invalid'));
  assert.ok(!JSON.stringify(page).includes(builder().contribution_id));
  const beyond = queuedPool([
    [tables({ has_sponsor_review_status: false })],
    [builder({ contribution_id: null, total_count: '7' })]
  ]);
  const empty = await listPublicBuilders(beyond, {
    page: 100000,
    pageSize: 50
  });
  assert.deepEqual(empty.builders, []);
  assert.deepEqual(empty.pagination, {
    page: 100000,
    page_size: 50,
    total_count: 7
  });
  assert.deepEqual(beyond.calls[1].params, [50, 4999950]);
  assert.match(
    beyond.calls[1].sql,
    /AND contribution_type <> 'sponsorship_interest'/
  );
});

test('contribution totals retain ledger refunds, adjustment-only months, safe proof mapping and the bounded preview', async () => {
  const pool = queuedPool(
    contributionResponses({
      allocations: [
        allocation(),
        allocation({
          proof_url: 'https://fixture:fixture@example.invalid/proof'
        })
      ],
      builders: [builder({ amount: null })]
    })
  );
  const result = await getPublicTransparencySummary(pool);
  assert.equal(result.total_received, 100);
  assert.equal(result.total_fees, 3);
  assert.equal(result.total_refunded, 25);
  assert.equal(result.total_payouts, 10);
  assert.equal(result.current_available_estimate, 72);
  assert.equal(result.last_updated_at, '2026-10-01T12:00:00Z');
  assert.deepEqual(
    result.monthly_summary.map((row) => [
      row.month,
      row.total_received,
      row.total_refunded,
      row.pending_fee_count
    ]),
    [
      ['2026-10', 0, 0, 0],
      ['2026-09', 0, 25, 0],
      ['2026-08', 100, 0, 0]
    ]
  );
  assert.equal(result.latest_public_allocations[0].amount_allocated, 42.5);
  assert.equal(
    result.latest_public_allocations[0].progress_status,
    'in_progress'
  );
  assert.equal(
    result.latest_public_allocations[0].proof_url,
    'https://example.invalid/proof'
  );
  assert.equal(result.latest_public_allocations[1].proof_url, null);
  assert.equal(
    result.latest_public_allocations[1].proof_source,
    'Synthetic public report'
  );
  assert.ok(!JSON.stringify(result).includes('Private synthetic note'));
  assert.equal(result.public_builders[0].amount, null);
  assert.deepEqual(pool.calls.at(-1).params, [24, 0]);
  assert.match(pool.calls.at(-2).sql, /LIMIT 8/);
});

test('refund status fallback and missing fee information remain observable when ledger tables are absent', async () => {
  const pool = queuedPool(
    contributionResponses({
      tableRow: tables({
        has_fund_transactions: false,
        has_fund_allocations: false
      }),
      totalRow: totals({ pending_fee_count: undefined }),
      monthly: [
        { month: '2026-08', ...totals({ pending_fee_count: undefined }) }
      ]
    })
  );
  const result = await getPublicTransparencySummary(pool);
  assert.equal(result.total_refunded, 100);
  assert.equal(result.current_available_estimate, 0);
  assert.equal(result.pending_fee_count, null);
  assert.equal(result.monthly_summary[0].pending_fee_count, null);
  assert.equal(result.monthly_summary[0].total_refunded, 100);
  assert.deepEqual(result.latest_public_allocations, []);
  assert.equal(pool.calls.length, 4);
});

test('transaction-only storage retains monetary projections and does not query a builder directory', async () => {
  const totalRow = { ...totals(), ...adjustments(), total_net: '9700' };
  const pool = queuedPool([
    [tables({ has_fund_contributions: false, has_fund_allocations: false })],
    [totalRow],
    [{ ...totalRow, month: '2026-08' }]
  ]);
  const result = await getPublicTransparencySummary(pool);
  assert.equal(result.data_source, 'database');
  assert.equal(result.total_net, 97);
  assert.equal(result.current_available_estimate, 72);
  assert.equal(result.pending_fee_count, 0);
  assert.equal(result.monthly_summary[0].currency, 'CAD');
  assert.deepEqual(result.public_builders, []);
  assert.equal(pool.calls.length, 3);
});

test('currency mismatches from each projection reject instead of publishing mixed totals', async (t) => {
  for (const change of [
    { totalRow: totals({ currency_count: '2' }) },
    { adjustmentRow: adjustments({ currency: 'usd' }) },
    { monthly: [{ month: '2026-08', ...totals({ currency: 'usd' }) }] },
    {
      adjustmentMonthly: [
        { month: '2026-09', ...adjustments({ currency: 'usd' }) }
      ]
    }
  ]) {
    await t.test(JSON.stringify(change), async () => {
      const pool = queuedPool(contributionResponses(change));
      await assert.rejects(
        getPublicTransparencySummary(pool),
        /Multiple currencies in public transparency/
      );
      assert.equal(pool.calls.length, 5);
    });
  }
});

test('read failures retain their identity at presence, financial, allocation and directory boundaries', async (t) => {
  for (let index = 0; index < 7; index++) {
    await t.test(`summary query ${index + 1}`, async () => {
      const failure = new Error('Synthetic transparency database failure');
      const responses = contributionResponses();
      responses[index] = failure;
      const pool = queuedPool(responses);
      await assert.rejects(
        getPublicTransparencySummary(pool),
        (error) => error === failure
      );
      assert.equal(pool.calls.length, index + 1);
    });
  }
  const failure = new Error('Synthetic adjustment database failure');
  await assert.rejects(
    getAdjustmentTotals(queuedPool([failure]), true),
    (error) => error === failure
  );
  await assert.rejects(
    listPublicBuilders(queuedPool([[tables()], failure])),
    (error) => error === failure
  );
});
