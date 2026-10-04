import type { Pool, PoolClient } from 'pg';

export interface FundTransactionInsert {
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

export interface ContributionFundTransactionBalanceUpdate {
  readonly stripePaymentIntentId: string;
  readonly stripeBalanceTransactionId: string;
  readonly amount: number;
  readonly fee: number;
  readonly net: number;
  readonly currency: string;
  readonly status: string;
}

const writeFundTransaction = async (
  pool: Pool | PoolClient,
  transaction: FundTransactionInsert
): Promise<boolean> => {
  const result = await pool.query(
    `
      INSERT INTO fund_transactions (
        stripe_event_id,
        stripe_object_id,
        stripe_balance_transaction_id,
        type,
        amount,
        fee,
        net,
        currency,
        status,
        created_at,
        public_category,
        metadata_json
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12::jsonb
      )
      ON CONFLICT (stripe_event_id) DO NOTHING
    `,
    [
      transaction.stripeEventId,
      transaction.stripeObjectId,
      transaction.stripeBalanceTransactionId,
      transaction.type,
      transaction.amount,
      transaction.fee,
      transaction.net,
      transaction.currency,
      transaction.status,
      transaction.createdAtIso,
      transaction.publicCategory,
      JSON.stringify(transaction.metadataJson)
    ]
  );

  return result.rowCount === 1;
};

export const insertFundTransaction = async (
  pool: Pool | null,
  transaction: FundTransactionInsert
): Promise<boolean> => {
  if (!pool) return false;
  const isPayment = transaction.type === 'payment_intent.succeeded';
  const isPayout = ['payout.paid', 'payout.failed'].includes(transaction.type);
  const refundId =
    transaction.type === 'charge.refunded' &&
    typeof transaction.metadataJson.refundId === 'string'
      ? transaction.metadataJson.refundId
      : null;
  if (!isPayment && !isPayout && !refundId) {
    return writeFundTransaction(pool, transaction);
  }
  const kind = isPayment ? 'payment' : refundId ? 'refund' : 'payout';
  if (
    isPayment || refundId
      ? transaction.status !== 'succeeded'
      : transaction.type !== `payout.${transaction.status}`
  ) {
    throw new Error(`Inconsistent ${kind} status.`);
  }

  // Different webhook IDs and backfills can describe the same Stripe object.
  // Keep one immutable fact per outcome, on the event owner's connection.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [`fund-${kind}:${refundId ?? transaction.stripeObjectId}`]
    );
    if (refundId) {
      // Settlement uses the same lock: a stale success cannot race a durable failure.
      const failedOperation = await client.query(
        `SELECT 1 FROM sponsorship_refund_operations WHERE status='failed'
         AND (stripe_refund_id=$1 OR id::text=$2) LIMIT 1`,
        [refundId, transaction.metadataJson.refundOperationId ?? null]
      );
      if (failedOperation.rowCount)
        throw new Error('REFUND_FINANCIAL_CORRECTION_REQUIRED');
    }
    const existing = await client.query<{
      amount: string;
      currency: string;
      type: string;
    }>(
      refundId
        ? `SELECT amount::text, currency, type FROM fund_transactions
       WHERE type='charge.refunded' AND metadata_json->>'refundId'=$1`
        : `SELECT amount::text, currency, type FROM fund_transactions
       WHERE stripe_object_id = $1 AND type = ANY($2::text[])`,
      refundId
        ? [refundId]
        : [
            transaction.stripeObjectId,
            isPayment
              ? ['payment_intent.succeeded']
              : ['payout.paid', 'payout.failed']
          ]
    );
    if (
      existing.rows.some(
        (row) =>
          row.amount !== String(transaction.amount) ||
          row.currency.toLowerCase() !== transaction.currency.toLowerCase()
      )
    ) {
      throw new Error(`Inconsistent ${kind} monetary facts.`);
    }
    const duplicate = existing.rows.some(
      (row) => row.type === transaction.type
    );
    const inserted = duplicate
      ? false
      : await writeFundTransaction(client, transaction);
    await client.query('COMMIT');
    return inserted;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const updateContributionFundTransactionBalance = async (
  pool: Pool | null,
  input: ContributionFundTransactionBalanceUpdate
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [`fund-payment:${input.stripePaymentIntentId}`]
    );
    const existing = await client.query<{ amount: string; currency: string }>(
      `SELECT amount::text, currency FROM fund_transactions
       WHERE stripe_object_id = $1 AND type = 'payment_intent.succeeded'
       FOR UPDATE`,
      [input.stripePaymentIntentId]
    );
    if (
      existing.rows.some(
        (row) =>
          row.amount !== String(input.amount) ||
          row.currency.toLowerCase() !== input.currency.toLowerCase()
      ) ||
      input.status !== 'succeeded'
    ) {
      throw new Error('Inconsistent payment balance monetary facts.');
    }
    const result = await client.query(
      `
      UPDATE fund_transactions
      SET
        stripe_balance_transaction_id = $2,
        fee = $4,
        net = $5
      WHERE stripe_object_id = $1
        AND type = 'payment_intent.succeeded'
        AND amount = $3
        AND LOWER(currency) = LOWER($6)
        AND status = $7
    `,
      [
        input.stripePaymentIntentId,
        input.stripeBalanceTransactionId,
        input.amount,
        input.fee,
        input.net,
        input.currency,
        input.status
      ]
    );

    await client.query('COMMIT');
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
