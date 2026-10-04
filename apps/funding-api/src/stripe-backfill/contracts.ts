export interface StripeBackfillCreatedRange {
  readonly gte?: number;
  readonly lte?: number;
}

export interface StripeBackfillOptions {
  readonly projectId: string;
  readonly includeUnmatched: boolean;
  readonly includePayouts: boolean;
  readonly includeRefunds: boolean;
  readonly includeDisputes: boolean;
  readonly dryRun: boolean;
  readonly assumeNonCharityAcknowledged: boolean;
  readonly created: StripeBackfillCreatedRange | null;
  readonly maxRecords: number | null;
  readonly deadlineAt?: number;
  readonly logger?: Pick<Console, 'log' | 'warn'>;
}

export interface StripeBackfillSummary {
  readonly dryRun: boolean;
  readonly projectId: string;
  readonly includeUnmatched: boolean;
  readonly startedAt: string;
  finishedAt: string;
  checkoutSessions: {
    scanned: number;
    matched: number;
    skippedUnmatched: number;
    upserted: number;
    dryRunMatched: number;
  };
  paymentIntents: {
    seen: number;
    insertedTransactions: number;
    skippedExistingTransactions: number;
    missingBalanceTransactions: number;
    dryRunWouldInsertTransactions: number;
  };
  refunds: {
    seen: number;
    insertedTransactions: number;
    skippedExistingTransactions: number;
    dryRunWouldInsertTransactions: number;
  };
  payouts: {
    scanned: number;
    insertedTransactions: number;
    skippedExistingTransactions: number;
    dryRunWouldInsertTransactions: number;
  };
  disputes: {
    scanned: number;
    matched: number;
    statusUpdated: number;
    dryRunWouldUpdate: number;
  };
}

export interface FundTransactionInput {
  readonly stripeEventId: string;
  readonly stripeObjectId: string;
  readonly stripeBalanceTransactionId: string | null;
  readonly type: string;
  readonly amount: number;
  readonly fee: number;
  readonly net: number;
  readonly currency: string;
  readonly status: string;
  readonly createdAtIso: string;
  readonly publicCategory: string;
  readonly metadataJson: Record<string, unknown>;
}

export interface BackfillInsertResult {
  readonly inserted: boolean;
  readonly skippedExisting: boolean;
  readonly dryRunWouldInsert: boolean;
}
