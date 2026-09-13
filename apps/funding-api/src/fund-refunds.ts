// Preserve the public projection's historical fallback when no refund ledger
// entries are available. Once present, the ledger includes both partial and full
// refunds; adding the status-based amount would count full refunds twice.
export const resolveRefundedAmountMinor = (
  transactionRefundedMinor: number,
  contributionRefundedMinor: number
): number =>
  transactionRefundedMinor > 0
    ? transactionRefundedMinor
    : contributionRefundedMinor;
