import type {
  FundTransparencyPublicResponse,
  PublicMonthlySummary
} from '@openg7/funding-core';

export type TransparencyRegistryFilter =
  'all' | 'contributions' | 'fees' | 'refunds';

export function parseTransparencyView(
  period: string | null,
  filter: string | null
): { period: string; filter: TransparencyRegistryFilter } {
  return {
    period: period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : 'all',
    filter:
      filter && ['contributions', 'fees', 'refunds'].includes(filter)
        ? (filter as TransparencyRegistryFilter)
        : 'all'
  };
}

/** A malformed or mixed-currency response is unavailable, never a zero balance. */
export function isTransparencyReport(
  value: unknown
): value is FundTransparencyPublicResponse {
  if (!value || typeof value !== 'object') return false;
  const report = value as Record<string, unknown>;
  const amounts = [
    'total_received',
    'total_fees',
    'total_net',
    'total_refunded',
    'total_payouts',
    'contributions_count'
  ];
  const finiteAmounts = (row: Record<string, unknown>) =>
    amounts.every(
      (key) => typeof row[key] === 'number' && Number.isFinite(row[key])
    );
  const validPendingCount = (row: Record<string, unknown>) =>
    row['pending_fee_count'] == null ||
    (Number.isSafeInteger(row['pending_fee_count']) &&
      Number(row['pending_fee_count']) >= 0 &&
      Number(row['pending_fee_count']) <= Number(row['contributions_count']));
  return (
    ['database', 'stripe_direct', 'empty'].includes(
      String(report['data_source'])
    ) &&
    typeof report['currency'] === 'string' &&
    /^[A-Z]{3}$/.test(report['currency']) &&
    finiteAmounts(report) &&
    validPendingCount(report) &&
    typeof report['current_available_estimate'] === 'number' &&
    Number.isFinite(report['current_available_estimate']) &&
    typeof report['last_updated_at'] === 'string' &&
    Number.isFinite(Date.parse(report['last_updated_at'])) &&
    (report['generated_at'] === undefined ||
      (typeof report['generated_at'] === 'string' &&
        Number.isFinite(Date.parse(report['generated_at'])))) &&
    Array.isArray(report['monthly_summary']) &&
    report['monthly_summary'].every((row: unknown) => {
      if (!row || typeof row !== 'object') return false;
      const summary = row as Record<string, unknown>;
      return (
        typeof summary['month'] === 'string' &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(summary['month']) &&
        summary['currency'] === report['currency'] &&
        finiteAmounts(summary) &&
        validPendingCount(summary)
      );
    }) &&
    Array.isArray(report['latest_public_allocations']) &&
    Array.isArray(report['public_builders'])
  );
}

/** Export only the public financial fields, never arbitrary response properties. */
export function publicMonthlySummary(
  row: PublicMonthlySummary
): PublicMonthlySummary {
  return {
    month: row.month,
    currency: row.currency,
    total_received: row.total_received,
    total_fees: row.total_fees,
    total_net: row.total_net,
    total_refunded: row.total_refunded,
    total_payouts: row.total_payouts,
    contributions_count: row.contributions_count,
    pending_fee_count: row.pending_fee_count ?? null
  };
}

export function transparencyExport(
  report: FundTransparencyPublicResponse,
  period: string,
  exportedAt: string
) {
  const metadata = {
    schema_version: 1,
    scope:
      period === 'all' ? 'cumulative_totals_and_available_months' : 'month',
    period,
    currency: report.currency,
    data_source: report.data_source,
    last_updated_at: report.last_updated_at,
    exported_at: exportedAt,
    generated_at: report.generated_at ?? null,
    monthly_summary: report.monthly_summary
      .filter((row) => period === 'all' || row.month === period)
      .map(publicMonthlySummary)
  };
  if (period !== 'all') return metadata;
  return {
    ...metadata,
    total_received: report.total_received,
    total_fees: report.total_fees,
    total_net: report.total_net,
    total_refunded: report.total_refunded,
    total_payouts: report.total_payouts,
    current_available_estimate: report.current_available_estimate,
    contributions_count: report.contributions_count,
    pending_fee_count: report.pending_fee_count ?? null
  };
}

export function transparencyCsv(
  report: FundTransparencyPublicResponse,
  period: string,
  exportedAt: string
): string {
  const headers = [
    'month',
    'currency',
    'total_received',
    'total_fees',
    'total_net',
    'total_refunded',
    'total_payouts',
    'contributions_count',
    'data_source',
    'last_updated_at',
    'exported_at',
    'pending_fee_count',
    'generated_at'
  ];
  const escape = (value: string | number): string => {
    // Spreadsheet formula protection also applies to any future textual values.
    const text = String(value);
    const safe =
      typeof value === 'string' && /^[=+\-@\t\r]/.test(text)
        ? `'${text}`
        : text;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = report.monthly_summary
    .filter((row) => period === 'all' || row.month === period)
    .map((row) =>
      [
        row.month,
        row.currency,
        row.total_received,
        row.total_fees,
        row.total_net,
        row.total_refunded,
        row.total_payouts,
        row.contributions_count,
        report.data_source,
        report.last_updated_at,
        exportedAt,
        row.pending_fee_count ?? '',
        report.generated_at ?? ''
      ]
        .map(escape)
        .join(',')
    );
  return [headers.join(','), ...rows].join('\r\n');
}
