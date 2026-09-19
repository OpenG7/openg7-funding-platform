import type { PublicMonthlySummary } from '@openg7/funding-core';

/** Parse user input without discarding signs, extra digits or other invalid content. */
export function parseContributionMinor(value: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const minor =
    Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/** Monthly API buckets use UTC; the caller supplies the clock for deterministic tests. */
export function currentFundingMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function monthlyContributions(
  summary: readonly PublicMonthlySummary[],
  month: string,
  currency: string
): number {
  return (
    summary.find(
      (entry) => entry.month === month && entry.currency === currency
    )?.total_received ?? 0
  );
}
