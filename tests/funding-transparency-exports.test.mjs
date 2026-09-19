import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isTransparencyReport,
  parseTransparencyView,
  transparencyCsv,
  transparencyExport
} from '../dist/apps/funding-web/src/app/features/funding/models/funding-transparency.utils.js';

const month = (month, amount) => ({
  month,
  currency: 'CAD',
  total_received: amount,
  total_fees: 1,
  total_net: amount - 1,
  total_refunded: 2,
  total_payouts: 3,
  contributions_count: 1,
  email_private: 'private@example.test'
});
const report = {
  data_source: 'database',
  currency: 'CAD',
  total_received: 150,
  total_fees: 2,
  total_net: 148,
  total_refunded: 4,
  total_payouts: 6,
  current_available_estimate: 144,
  contributions_count: 2,
  monthly_summary: [month('2026-09', 50), month('2026-08', 100)],
  latest_public_allocations: [],
  public_builders: [],
  last_updated_at: '2026-09-19T10:00:00.000Z',
  notes_admin: 'private note'
};
const exportedAt = '2026-09-19T12:00:00.000Z';

test('monthly JSON exports only the selected month, without lifetime totals or private fields', () => {
  const result = transparencyExport(report, '2026-09', exportedAt);
  assert.equal(result.scope, 'month');
  assert.equal(result.period, '2026-09');
  assert.equal(result.exported_at, exportedAt);
  assert.equal(result.last_updated_at, report.last_updated_at);
  assert.equal(result.total_received, undefined);
  assert.equal(result.monthly_summary.length, 1);
  assert.equal(result.monthly_summary[0].total_received, 50);
  assert.doesNotMatch(JSON.stringify(result), /private|notes_admin/);
});

test('complete JSON labels lifetime totals separately from available monthly summaries', () => {
  const result = transparencyExport(report, 'all', exportedAt);
  assert.equal(result.scope, 'cumulative_totals_and_available_months');
  assert.equal(result.total_received, 150);
  assert.equal(result.current_available_estimate, 144);
  assert.equal(result.monthly_summary.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /private|notes_admin/);
});

test('CSV contains the selected period, currency, source, timestamps, fees and refunds', () => {
  const lines = transparencyCsv(report, '2026-09', exportedAt).split('\r\n');
  assert.equal(lines.length, 2);
  assert.equal(
    lines[0],
    'month,currency,total_received,total_fees,total_net,total_refunded,total_payouts,contributions_count,data_source,last_updated_at,exported_at,pending_fee_count,generated_at'
  );
  assert.equal(
    lines[1],
    `2026-09,CAD,50,1,49,2,3,1,database,${report.last_updated_at},${exportedAt},,`
  );
});

test('valid zero reports remain distinguishable from malformed or mixed-currency reports', () => {
  assert.equal(isTransparencyReport(report), true);
  assert.equal(
    isTransparencyReport({ ...report, total_received: 0, monthly_summary: [] }),
    true
  );
  for (const invalid of [
    null,
    {},
    { ...report, total_fees: null },
    { ...report, current_available_estimate: NaN },
    { ...report, last_updated_at: 'bad' },
    { ...report, generated_at: 'bad' },
    { ...report, pending_fee_count: -1 },
    { ...report, pending_fee_count: 1.5 },
    { ...report, pending_fee_count: 3 },
    {
      ...report,
      monthly_summary: [{ ...month('2026-09', 50), currency: 'USD' }]
    }
  ]) {
    assert.equal(isTransparencyReport(invalid), false);
  }
});

test('fee completeness stays explicit in JSON and CSV, including compatibility with older APIs', () => {
  const generated_at = '2026-09-19T09:59:00.000Z';
  const enriched = {
    ...report,
    generated_at,
    pending_fee_count: 1,
    monthly_summary: report.monthly_summary.map((row) => ({
      ...row,
      pending_fee_count: row.month === '2026-09' ? 1 : 0
    }))
  };
  assert.equal(isTransparencyReport(enriched), true);
  const exported = transparencyExport(enriched, '2026-09', exportedAt);
  assert.equal(exported.generated_at, generated_at);
  assert.equal(exported.monthly_summary[0].pending_fee_count, 1);
  assert.match(
    transparencyCsv(enriched, '2026-09', exportedAt),
    /,1,2026-09-19T09:59:00.000Z$/
  );
  assert.equal(
    transparencyExport(report, 'all', exportedAt).pending_fee_count,
    null
  );
});

test('shared views accept only supported period and type values', () => {
  assert.deepEqual(parseTransparencyView('2026-09', 'refunds'), {
    period: '2026-09',
    filter: 'refunds'
  });
  for (const period of [null, '', '2026-13', '<script>', '2026-1'])
    assert.deepEqual(parseTransparencyView(period, 'unknown'), {
      period: 'all',
      filter: 'all'
    });
});
