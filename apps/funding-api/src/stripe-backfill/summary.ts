import type {
  BackfillInsertResult,
  StripeBackfillOptions,
  StripeBackfillSummary
} from './contracts.js';

export const emptySummary = (
  options: StripeBackfillOptions
): StripeBackfillSummary => {
  const now = new Date().toISOString();

  return {
    dryRun: options.dryRun,
    projectId: options.projectId,
    includeUnmatched: options.includeUnmatched,
    startedAt: now,
    finishedAt: now,
    checkoutSessions: {
      scanned: 0,
      matched: 0,
      skippedUnmatched: 0,
      upserted: 0,
      dryRunMatched: 0
    },
    paymentIntents: {
      seen: 0,
      insertedTransactions: 0,
      skippedExistingTransactions: 0,
      missingBalanceTransactions: 0,
      dryRunWouldInsertTransactions: 0
    },
    refunds: {
      seen: 0,
      insertedTransactions: 0,
      skippedExistingTransactions: 0,
      dryRunWouldInsertTransactions: 0
    },
    payouts: {
      scanned: 0,
      insertedTransactions: 0,
      skippedExistingTransactions: 0,
      dryRunWouldInsertTransactions: 0
    },
    disputes: {
      scanned: 0,
      matched: 0,
      statusUpdated: 0,
      dryRunWouldUpdate: 0
    }
  };
};

export const applyInsertResult = (
  target: {
    insertedTransactions: number;
    skippedExistingTransactions: number;
    dryRunWouldInsertTransactions: number;
  },
  result: BackfillInsertResult
): void => {
  if (result.inserted) {
    target.insertedTransactions += 1;
  }

  if (result.skippedExisting) {
    target.skippedExistingTransactions += 1;
  }

  if (result.dryRunWouldInsert) {
    target.dryRunWouldInsertTransactions += 1;
  }
};
