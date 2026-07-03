import type {
  FundTransparencyPublicResponse,
  PublicFundAllocation,
  PublicMonthlySummary
} from '@openg7/funding-core';
import type { Pool } from 'pg';

interface FundTransactionInsert {
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

interface TotalsRow {
  readonly total_received: string;
  readonly total_fees: string;
  readonly total_net: string;
  readonly total_refunded: string;
  readonly total_payouts: string;
  readonly contributions_count: string;
  readonly currency: string;
  readonly last_updated_at: string;
}

interface MonthlyRow {
  readonly month: string;
  readonly total_received: string;
  readonly total_fees: string;
  readonly total_net: string;
  readonly total_refunded: string;
  readonly total_payouts: string;
  readonly contributions_count: string;
  readonly currency: string;
}

interface AllocationRow {
  readonly project_name: string;
  readonly public_description: string;
  readonly amount_allocated: string;
  readonly currency: string;
  readonly status: string;
  readonly published_at: string | null;
}

const centsToAmount = (value: number): number => Number((value / 100).toFixed(2));
const parseDbInt = (value: string): number => Number.parseInt(value, 10);

const emptyResponse = (): FundTransparencyPublicResponse => {
  const now = new Date().toISOString();

  return {
    total_received: 0,
    total_fees: 0,
    total_net: 0,
    total_refunded: 0,
    total_payouts: 0,
    current_available_estimate: 0,
    contributions_count: 0,
    currency: 'CAD',
    monthly_summary: [],
    latest_public_allocations: [],
    last_updated_at: now
  };
};

export const insertFundTransaction = async (
  pool: Pool | null,
  transaction: FundTransactionInsert
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

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

export const getPublicTransparencySummary = async (
  pool: Pool | null
): Promise<FundTransparencyPublicResponse> => {
  if (!pool) {
    return emptyResponse();
  }

  const totalsQuery = await pool.query<TotalsRow>(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN amount ELSE 0 END), 0)::text AS total_received,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN fee ELSE 0 END), 0)::text AS total_fees,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN net ELSE 0 END), 0)::text AS total_net,
      COALESCE(SUM(CASE WHEN type = 'charge.refunded' THEN amount ELSE 0 END), 0)::text AS total_refunded,
      COALESCE(SUM(CASE WHEN type = 'payout.paid' THEN amount ELSE 0 END), 0)::text AS total_payouts,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN 1 ELSE 0 END), 0)::text AS contributions_count,
      COALESCE(MAX(currency), 'cad') AS currency,
      COALESCE(MAX(inserted_at), NOW())::text AS last_updated_at
    FROM fund_transactions
  `);

  const monthlyQuery = await pool.query<MonthlyRow>(`
    SELECT
      TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN amount ELSE 0 END), 0)::text AS total_received,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN fee ELSE 0 END), 0)::text AS total_fees,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN net ELSE 0 END), 0)::text AS total_net,
      COALESCE(SUM(CASE WHEN type = 'charge.refunded' THEN amount ELSE 0 END), 0)::text AS total_refunded,
      COALESCE(SUM(CASE WHEN type = 'payout.paid' THEN amount ELSE 0 END), 0)::text AS total_payouts,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN 1 ELSE 0 END), 0)::text AS contributions_count,
      COALESCE(MAX(currency), 'cad') AS currency
    FROM fund_transactions
    GROUP BY DATE_TRUNC('month', created_at)
    ORDER BY DATE_TRUNC('month', created_at) DESC
    LIMIT 12
  `);

  const allocationQuery = await pool.query<AllocationRow>(`
    SELECT
      project_name,
      public_description,
      amount_allocated::text AS amount_allocated,
      currency,
      status,
      published_at::text AS published_at
    FROM fund_allocations
    WHERE status IN ('published', 'active')
    ORDER BY COALESCE(published_at, created_at) DESC
    LIMIT 8
  `);

  const totals = totalsQuery.rows[0];

  const totalReceived = centsToAmount(parseDbInt(totals.total_received));
  const totalFees = centsToAmount(parseDbInt(totals.total_fees));
  const totalNet = centsToAmount(parseDbInt(totals.total_net));
  const totalRefunded = centsToAmount(parseDbInt(totals.total_refunded));
  const totalPayouts = centsToAmount(parseDbInt(totals.total_payouts));
  const currentAvailableEstimate = Number(
    (totalNet - totalRefunded - totalPayouts).toFixed(2)
  );

  const monthlySummary: readonly PublicMonthlySummary[] = monthlyQuery.rows.map(
    (row) => ({
      month: row.month,
      total_received: centsToAmount(parseDbInt(row.total_received)),
      total_fees: centsToAmount(parseDbInt(row.total_fees)),
      total_net: centsToAmount(parseDbInt(row.total_net)),
      total_refunded: centsToAmount(parseDbInt(row.total_refunded)),
      total_payouts: centsToAmount(parseDbInt(row.total_payouts)),
      contributions_count: parseDbInt(row.contributions_count),
      currency: row.currency.toUpperCase()
    })
  );

  const latestAllocations: readonly PublicFundAllocation[] =
    allocationQuery.rows.map((row) => ({
      project_name: row.project_name,
      public_description: row.public_description,
      amount_allocated: centsToAmount(parseDbInt(row.amount_allocated)),
      currency: row.currency.toUpperCase(),
      status: row.status,
      published_at: row.published_at
    }));

  return {
    total_received: totalReceived,
    total_fees: totalFees,
    total_net: totalNet,
    total_refunded: totalRefunded,
    total_payouts: totalPayouts,
    current_available_estimate: currentAvailableEstimate,
    contributions_count: parseDbInt(totals.contributions_count),
    currency: totals.currency.toUpperCase(),
    monthly_summary: monthlySummary,
    latest_public_allocations: latestAllocations,
    last_updated_at: totals.last_updated_at
  };
};
