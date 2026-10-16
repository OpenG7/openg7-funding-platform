import type { AdminSponsorshipProgress } from '@openg7/funding-core';

export interface SponsorshipRefundProgressFacts {
  readonly amountMinor: number;
  readonly refundId: string | null;
  readonly refundAmountMinor: number | null;
  readonly refundError: boolean;
  readonly documents: readonly {
    readonly kind: string;
    readonly currency: string;
    readonly amountMinor: number;
    readonly refundId?: string;
  }[];
  readonly refunds: readonly {
    readonly id: string;
    readonly amount: number;
    readonly currency: string;
  }[];
  readonly charges: readonly {
    readonly id: string;
    readonly amount: number;
    readonly currency: string;
  }[];
}

/** One projection for the dossier and complete queue; only confirmed facts count. */
export const projectSponsorshipRefundProgress = (
  record: {
    readonly currency: string;
    readonly paymentStatus: string;
    readonly refundStatus: string;
  },
  facts: SponsorshipRefundProgressFacts
): AdminSponsorshipProgress['refund'] => {
  const currency = record.currency.toUpperCase();
  const sumDistinct = (
    rows: SponsorshipRefundProgressFacts['refunds']
  ): number => {
    const amounts = new Map<string, number>();
    for (const row of rows) {
      if (
        row.currency.toUpperCase() !== currency ||
        !Number.isSafeInteger(row.amount) ||
        row.amount < 0
      )
        throw new Error('Inconsistent refund facts.');
      amounts.set(row.id, Math.max(amounts.get(row.id) ?? 0, row.amount));
    }
    const total = [...amounts.values()].reduce((a, b) => a + b, 0);
    if (!Number.isSafeInteger(total)) throw new Error('Invalid refund total.');
    return total;
  };
  const refunds = [...facts.refunds];
  if (
    record.refundStatus === 'completed' &&
    facts.refundId &&
    facts.refundAmountMinor !== null
  )
    refunds.push({
      id: facts.refundId,
      amount: facts.refundAmountMinor,
      currency
    });
  // Charge totals are cumulative snapshots, not additional refunds.
  const confirmedAmountMinor = Math.max(
    sumDistinct(refunds),
    sumDistinct(facts.charges),
    record.paymentStatus === 'refunded' ? facts.amountMinor : 0
  );
  const credits = facts.documents.filter(
    (d) => d.kind === 'credit_note' && d.currency.toUpperCase() === currency
  );
  const credited = credits.reduce((sum, d) => sum + d.amountMinor, 0);
  const creditMissing =
    confirmedAmountMinor > credited ||
    refunds.some(
      (r) =>
        (credits.find((d) => d.refundId === r.id)?.amountMinor ?? 0) < r.amount
    );
  const hasError =
    facts.refundError ||
    record.refundStatus === 'failed' ||
    confirmedAmountMinor > facts.amountMinor;
  const pending = ['requested', 'processing'].includes(record.refundStatus);
  return {
    workflow: record.refundStatus,
    state: hasError
      ? 'error'
      : pending
        ? 'pending'
        : confirmedAmountMinor > 0
          ? confirmedAmountMinor < facts.amountMinor
            ? 'partial'
            : 'complete'
          : 'not_required',
    confirmedAmountMinor,
    creditMissing,
    hasError
  };
};
