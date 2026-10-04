import type {
  FundTransparencyPublicResponse,
  PublicMonthlySummary
} from '@openg7/funding-core';

import type {
  StripeContribution,
  StripePayoutRecord,
  StripeTransparencyFact
} from './contracts.js';

interface FinanceAccumulator {
  totalReceived: number;
  totalFees: number;
  totalNet: number;
  totalRefunded: number;
  totalPayouts: number;
  contributionsCount: number;
  pendingFeeCount: number;
  currency: string;
}

const centsToAmount = (value: number): number =>
  Number((value / 100).toFixed(2));
const calculateCurrentAvailableEstimate = (
  totalNet: number,
  totalRefunded: number
): number => {
  // Stripe payouts move money from Stripe to the bank account; they are not fund expenses.
  return Number((totalNet - totalRefunded).toFixed(2));
};

const createAccumulator = (currency = 'cad'): FinanceAccumulator => ({
  totalReceived: 0,
  totalFees: 0,
  totalNet: 0,
  totalRefunded: 0,
  totalPayouts: 0,
  contributionsCount: 0,
  pendingFeeCount: 0,
  currency
});

const monthKeyFromUnix = (seconds: number): string => {
  const date = new Date(seconds * 1000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const applyContribution = (
  accumulator: FinanceAccumulator,
  contribution: StripeContribution
): void => {
  if (
    accumulator.contributionsCount > 0 &&
    accumulator.currency !== contribution.currency
  ) {
    throw new Error('Multiple contribution currencies in public transparency');
  }
  accumulator.totalReceived += contribution.amount;
  accumulator.totalFees += contribution.fee;
  accumulator.totalNet += contribution.net;
  accumulator.totalRefunded += contribution.refunded;
  accumulator.contributionsCount += 1;
  accumulator.pendingFeeCount += contribution.feePending ? 1 : 0;
  accumulator.currency = contribution.currency;
};

const applyPayout = (
  accumulator: FinanceAccumulator,
  payout: StripePayoutRecord
): void => {
  accumulator.totalPayouts += payout.amount;
  accumulator.currency = payout.currency;
};

const toMonthlySummary = (
  month: string,
  accumulator: FinanceAccumulator
): PublicMonthlySummary => ({
  month,
  total_received: centsToAmount(accumulator.totalReceived),
  total_fees: centsToAmount(accumulator.totalFees),
  total_net: centsToAmount(accumulator.totalNet),
  total_refunded: centsToAmount(accumulator.totalRefunded),
  total_payouts: centsToAmount(accumulator.totalPayouts),
  contributions_count: accumulator.contributionsCount,
  pending_fee_count: accumulator.pendingFeeCount,
  currency: accumulator.currency.toUpperCase()
});

export const projectStripeTransparency = async (
  facts: AsyncIterable<StripeTransparencyFact>,
  generatedAt: string
): Promise<FundTransparencyPublicResponse> => {
  const totals = createAccumulator();
  const monthly = new Map<string, FinanceAccumulator>();

  for await (const fact of facts) {
    if (fact.kind === 'contribution') {
      applyContribution(totals, fact.contribution);
    } else {
      applyPayout(totals, fact.payout);
    }

    const record =
      fact.kind === 'contribution' ? fact.contribution : fact.payout;
    const month = monthKeyFromUnix(record.created);
    const monthAccumulator =
      monthly.get(month) ?? createAccumulator(record.currency);

    if (fact.kind === 'contribution') {
      applyContribution(monthAccumulator, fact.contribution);
    } else {
      applyPayout(monthAccumulator, fact.payout);
    }
    monthly.set(month, monthAccumulator);
  }

  const totalNet = centsToAmount(totals.totalNet);
  const totalRefunded = centsToAmount(totals.totalRefunded);
  const totalPayouts = centsToAmount(totals.totalPayouts);
  const currentAvailableEstimate = calculateCurrentAvailableEstimate(
    totalNet,
    totalRefunded
  );

  return {
    data_source: 'stripe_direct',
    total_received: centsToAmount(totals.totalReceived),
    total_fees: centsToAmount(totals.totalFees),
    total_net: totalNet,
    total_refunded: totalRefunded,
    total_payouts: totalPayouts,
    current_available_estimate: currentAvailableEstimate,
    contributions_count: totals.contributionsCount,
    pending_fee_count: totals.pendingFeeCount,
    currency: totals.currency.toUpperCase(),
    monthly_summary: Array.from(monthly.entries())
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, 12)
      .map(([month, accumulator]) => toMonthlySummary(month, accumulator)),
    latest_public_allocations: [],
    public_builders: [],
    last_updated_at: new Date().toISOString(),
    generated_at: generatedAt
  };
};
