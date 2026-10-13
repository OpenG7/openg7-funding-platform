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

/** Shared presentation of a monthly target; the caller retains unavailable states. */
export function monthlyGoalProgress(
  received: number,
  goal: number
): { progress: number; remaining: number } {
  return {
    progress:
      goal <= 0
        ? 0
        : Math.min(100, Math.max(0, Math.round((received / goal) * 100))),
    remaining: Math.max(0, goal - received)
  };
}
