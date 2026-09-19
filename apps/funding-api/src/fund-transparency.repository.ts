import type {
  FundTransparencyPublicResponse,
  PublicBuilderProfile,
  PublicFundAllocation,
  PublicMonthlySummary
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import { resolveRefundedAmountMinor } from './fund-refunds.js';

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

interface ContributionFundTransactionBalanceUpdate {
  readonly stripePaymentIntentId: string;
  readonly stripeBalanceTransactionId: string;
  readonly amount: number;
  readonly fee: number;
  readonly net: number;
  readonly currency: string;
  readonly status: string;
}

interface TotalsRow {
  readonly currency_count?: string;
  readonly pending_fee_count?: string;
  readonly total_received: string;
  readonly total_fees: string;
  readonly total_net: string;
  readonly total_refunded: string;
  readonly total_payouts: string;
  readonly contributions_count: string;
  readonly currency: string;
  readonly last_updated_at: string;
}

interface ContributionTotalsRow {
  readonly currency_count?: string;
  readonly pending_fee_count?: string;
  readonly total_received: string;
  readonly contribution_refunded: string;
  readonly contributions_count: string;
  readonly currency: string;
  readonly last_updated_at: string;
}

interface AdjustmentTotalsRow {
  readonly currency?: string;
  readonly currency_count?: string;
  readonly total_fees: string;
  readonly total_refunded: string;
  readonly total_payouts: string;
  readonly last_updated_at: string | null;
}

interface MonthlyRow {
  readonly currency_count?: string;
  readonly pending_fee_count?: string;
  readonly month: string;
  readonly total_received: string;
  readonly total_fees: string;
  readonly total_net: string;
  readonly total_refunded: string;
  readonly total_payouts: string;
  readonly contributions_count: string;
  readonly currency: string;
}

interface ContributionMonthlyRow {
  readonly currency_count?: string;
  readonly pending_fee_count?: string;
  readonly month: string;
  readonly total_received: string;
  readonly contribution_refunded: string;
  readonly contributions_count: string;
  readonly currency: string;
}

interface AdjustmentMonthlyRow {
  readonly currency_count?: string;
  readonly month: string;
  readonly total_fees: string;
  readonly total_refunded: string;
  readonly total_payouts: string;
  readonly currency: string;
}

interface AllocationRow {
  readonly project_name: string;
  readonly public_description: string;
  readonly expected_outcome: string;
  readonly progress_status: 'planned' | 'in_progress' | 'delivered';
  readonly proof_url: string | null;
  readonly proof_source: string | null;
  readonly proof_published_at: string | null;
  readonly amount_allocated: string;
  readonly currency: string;
  readonly status: string;
  readonly published_at: string | null;
}

interface PublicBuilderRow {
  readonly display_name: string;
  readonly contribution_type: 'personal_support' | 'sponsorship_interest';
  readonly amount: string | null;
  readonly currency: string;
  readonly paid_at: string | null;
}

interface TablePresenceRow {
  readonly has_fund_contributions: boolean;
  readonly has_fund_transactions: boolean;
  readonly has_fund_allocations: boolean;
  readonly has_sponsor_review_status: boolean;
}

const centsToAmount = (value: number): number =>
  Number((value / 100).toFixed(2));
const parseDbInt = (value: string): number => Number.parseInt(value, 10);
const pendingFeeCount = (value: string | undefined): number | null =>
  value === undefined ? null : parseDbInt(value);
const assertProjectionCurrency = (
  row: { currency?: string; currency_count?: string },
  expected?: string
): void => {
  if (
    Number(row.currency_count ?? 0) > 1 ||
    (Number(row.currency_count ?? 0) > 0 &&
      expected &&
      row.currency !== expected)
  ) {
    throw new Error('Multiple currencies in public transparency');
  }
};
const maxIso = (left: string, right: string | null): string => {
  if (!right) {
    return left;
  }

  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
};
const calculateCurrentAvailableEstimate = (
  totalNet: number,
  totalRefunded: number
): number => {
  // Stripe payouts move money from Stripe to the bank account; they are not fund expenses.
  return Number((totalNet - totalRefunded).toFixed(2));
};

const emptyResponse = (): FundTransparencyPublicResponse => {
  const now = new Date().toISOString();

  return {
    data_source: 'empty',
    total_received: 0,
    total_fees: 0,
    total_net: 0,
    total_refunded: 0,
    total_payouts: 0,
    current_available_estimate: 0,
    contributions_count: 0,
    pending_fee_count: null,
    currency: 'CAD',
    monthly_summary: [],
    latest_public_allocations: [],
    public_builders: [],
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

export const updateContributionFundTransactionBalance = async (
  pool: Pool | null,
  input: ContributionFundTransactionBalanceUpdate
): Promise<boolean> => {
  if (!pool) {
    return false;
  }

  const result = await pool.query(
    `
      UPDATE fund_transactions
      SET
        stripe_balance_transaction_id = $2,
        amount = $3,
        fee = $4,
        net = $5,
        currency = $6,
        status = $7
      WHERE stripe_object_id = $1
        AND type = 'payment_intent.succeeded'
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

  return (result.rowCount ?? 0) > 0;
};

const getTablePresence = async (pool: Pool): Promise<TablePresenceRow> => {
  const query = await pool.query<TablePresenceRow>(`
    SELECT
      to_regclass('public.fund_contributions') IS NOT NULL AS has_fund_contributions,
      to_regclass('public.fund_transactions') IS NOT NULL AS has_fund_transactions,
      to_regclass('public.fund_allocations') IS NOT NULL AS has_fund_allocations,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fund_contributions'
          AND column_name = 'sponsor_review_status'
      ) AS has_sponsor_review_status
  `);

  return (
    query.rows[0] ?? {
      has_fund_contributions: false,
      has_fund_transactions: false,
      has_fund_allocations: false,
      has_sponsor_review_status: false
    }
  );
};

const getLatestPublicAllocations = async (
  pool: Pool,
  hasFundAllocations: boolean
): Promise<readonly PublicFundAllocation[]> => {
  if (!hasFundAllocations) {
    return [];
  }

  const allocationQuery = await pool.query<AllocationRow>(`
    SELECT
      project_name,
      public_description,
      expected_outcome,
      progress_status,
      proof_url,
      proof_source,
      proof_published_at::text AS proof_published_at,
      amount_allocated::text AS amount_allocated,
      currency,
      status,
      published_at::text AS published_at
    FROM fund_allocations
    WHERE status IN ('published', 'active')
    ORDER BY COALESCE(published_at, created_at) DESC
    LIMIT 8
  `);

  return allocationQuery.rows.map((row) => ({
    project_name: row.project_name,
    public_description: row.public_description,
    expected_outcome: row.expected_outcome,
    progress_status: row.progress_status,
    proof_url: row.proof_url,
    proof_source: row.proof_source,
    proof_published_at: row.proof_published_at,
    amount_allocated: centsToAmount(parseDbInt(row.amount_allocated)),
    currency: row.currency.toUpperCase(),
    status: row.status,
    published_at: row.published_at
  }));
};

const getPublicBuilders = async (
  pool: Pool,
  tables: TablePresenceRow
): Promise<readonly PublicBuilderProfile[]> => {
  if (!tables.has_fund_contributions) {
    return [];
  }

  const sponsorshipVisibilityFilter = tables.has_sponsor_review_status
    ? "AND (contribution_type <> 'sponsorship_interest' OR sponsor_review_status = 'approved')"
    : "AND contribution_type <> 'sponsorship_interest'";

  const query = await pool.query<PublicBuilderRow>(`
    SELECT
      public_name AS display_name,
      contribution_type,
      CASE
        WHEN display_amount_consent IS TRUE THEN amount_cents::text
        ELSE NULL
      END AS amount,
      currency,
      paid_at::text AS paid_at
    FROM fund_contributions
    WHERE status IN ('paid', 'refunded', 'disputed')
      AND public_display_consent IS TRUE
      AND public_name IS NOT NULL
      AND btrim(public_name) <> ''
      ${sponsorshipVisibilityFilter}
    ORDER BY COALESCE(paid_at, updated_at, created_at) DESC
    LIMIT 24
  `);

  return query.rows.map((row) => ({
    display_name: row.display_name,
    contribution_type: row.contribution_type,
    amount: row.amount ? centsToAmount(parseDbInt(row.amount)) : null,
    currency: row.currency.toUpperCase(),
    paid_at: row.paid_at
  }));
};

const getTransactionTransparencySummary = async (
  pool: Pool,
  hasFundAllocations: boolean
): Promise<FundTransparencyPublicResponse> => {
  const totalsQuery = await pool.query<TotalsRow>(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN amount ELSE 0 END), 0)::text AS total_received,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN fee ELSE 0 END), 0)::text AS total_fees,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN net ELSE 0 END), 0)::text AS total_net,
      COALESCE(SUM(CASE WHEN type = 'charge.refunded' THEN amount ELSE 0 END), 0)::text AS total_refunded,
      COALESCE(SUM(CASE WHEN type = 'payout.paid' THEN amount ELSE 0 END), 0)::text AS total_payouts,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN 1 ELSE 0 END), 0)::text AS contributions_count,
      COUNT(*) FILTER (WHERE type = 'payment_intent.succeeded' AND stripe_balance_transaction_id IS NULL)::text AS pending_fee_count,
      COUNT(DISTINCT currency)::text AS currency_count,
      COALESCE(MAX(currency), 'cad') AS currency,
      COALESCE(MAX(inserted_at), NOW())::text AS last_updated_at
    FROM fund_transactions
    WHERE type IN ('payment_intent.succeeded', 'charge.refunded', 'payout.paid')
  `);

  const monthlyQuery = await pool.query<MonthlyRow>(`
    SELECT
      TO_CHAR(DATE_TRUNC('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN amount ELSE 0 END), 0)::text AS total_received,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN fee ELSE 0 END), 0)::text AS total_fees,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN net ELSE 0 END), 0)::text AS total_net,
      COALESCE(SUM(CASE WHEN type = 'charge.refunded' THEN amount ELSE 0 END), 0)::text AS total_refunded,
      COALESCE(SUM(CASE WHEN type = 'payout.paid' THEN amount ELSE 0 END), 0)::text AS total_payouts,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN 1 ELSE 0 END), 0)::text AS contributions_count,
      COUNT(*) FILTER (WHERE type = 'payment_intent.succeeded' AND stripe_balance_transaction_id IS NULL)::text AS pending_fee_count,
      COUNT(DISTINCT currency)::text AS currency_count,
      COALESCE(MAX(currency), 'cad') AS currency
    FROM fund_transactions
    WHERE type IN ('payment_intent.succeeded', 'charge.refunded', 'payout.paid')
    GROUP BY DATE_TRUNC('month', created_at AT TIME ZONE 'UTC')
    ORDER BY DATE_TRUNC('month', created_at AT TIME ZONE 'UTC') DESC
    LIMIT 12
  `);

  const totals = totalsQuery.rows[0];
  assertProjectionCurrency(totals);
  for (const row of monthlyQuery.rows)
    assertProjectionCurrency(row, totals.currency);

  const totalReceived = centsToAmount(parseDbInt(totals.total_received));
  const totalFees = centsToAmount(parseDbInt(totals.total_fees));
  const totalNet = centsToAmount(parseDbInt(totals.total_net));
  const totalRefunded = centsToAmount(parseDbInt(totals.total_refunded));
  const totalPayouts = centsToAmount(parseDbInt(totals.total_payouts));
  const currentAvailableEstimate = calculateCurrentAvailableEstimate(
    totalNet,
    totalRefunded
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
      pending_fee_count: pendingFeeCount(row.pending_fee_count),
      currency: row.currency.toUpperCase()
    })
  );

  const latestAllocations: readonly PublicFundAllocation[] =
    await getLatestPublicAllocations(pool, hasFundAllocations);

  return {
    data_source: 'database',
    total_received: totalReceived,
    total_fees: totalFees,
    total_net: totalNet,
    total_refunded: totalRefunded,
    total_payouts: totalPayouts,
    current_available_estimate: currentAvailableEstimate,
    contributions_count: parseDbInt(totals.contributions_count),
    pending_fee_count: pendingFeeCount(totals.pending_fee_count),
    currency: totals.currency.toUpperCase(),
    monthly_summary: monthlySummary,
    latest_public_allocations: latestAllocations,
    public_builders: [],
    last_updated_at: totals.last_updated_at
  };
};

export const getAdjustmentTotals = async (
  pool: Pool,
  hasFundTransactions: boolean
): Promise<AdjustmentTotalsRow> => {
  if (!hasFundTransactions) {
    return {
      total_fees: '0',
      total_refunded: '0',
      total_payouts: '0',
      last_updated_at: null
    };
  }

  const query = await pool.query<AdjustmentTotalsRow>(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN fee ELSE 0 END), 0)::text AS total_fees,
      COALESCE(SUM(CASE WHEN type = 'charge.refunded' THEN amount ELSE 0 END), 0)::text AS total_refunded,
      COALESCE(SUM(CASE WHEN type = 'payout.paid' THEN amount ELSE 0 END), 0)::text AS total_payouts,
      COALESCE(MAX(currency), 'cad') AS currency,
      COUNT(DISTINCT currency)::text AS currency_count,
      MAX(inserted_at)::text AS last_updated_at
    FROM fund_transactions
    WHERE type IN ('payment_intent.succeeded', 'charge.refunded', 'payout.paid')
  `);

  return (
    query.rows[0] ?? {
      total_fees: '0',
      total_refunded: '0',
      total_payouts: '0',
      last_updated_at: null
    }
  );
};

const getAdjustmentMonthly = async (
  pool: Pool,
  hasFundTransactions: boolean
): Promise<readonly AdjustmentMonthlyRow[]> => {
  if (!hasFundTransactions) {
    return [];
  }

  const query = await pool.query<AdjustmentMonthlyRow>(`
    SELECT
      TO_CHAR(DATE_TRUNC('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN fee ELSE 0 END), 0)::text AS total_fees,
      COALESCE(SUM(CASE WHEN type = 'charge.refunded' THEN amount ELSE 0 END), 0)::text AS total_refunded,
      COALESCE(SUM(CASE WHEN type = 'payout.paid' THEN amount ELSE 0 END), 0)::text AS total_payouts,
      COALESCE(MAX(currency), 'cad') AS currency,
      COUNT(DISTINCT currency)::text AS currency_count
    FROM fund_transactions
    WHERE type IN ('payment_intent.succeeded', 'charge.refunded', 'payout.paid')
    GROUP BY DATE_TRUNC('month', created_at AT TIME ZONE 'UTC')
    ORDER BY DATE_TRUNC('month', created_at AT TIME ZONE 'UTC') DESC
    LIMIT 12
  `);

  return query.rows;
};

const getContributionTransparencySummary = async (
  pool: Pool,
  tables: TablePresenceRow
): Promise<FundTransparencyPublicResponse> => {
  const feeMissing = tables.has_fund_transactions
    ? `NOT EXISTS (
    SELECT 1 FROM fund_transactions payment
    WHERE payment.type = 'payment_intent.succeeded'
      AND payment.stripe_object_id = fund_contributions.stripe_payment_intent_id
      AND payment.currency = fund_contributions.currency
      AND payment.stripe_balance_transaction_id IS NOT NULL
  )`
    : 'TRUE';
  const totalsQuery = await pool.query<ContributionTotalsRow>(`
    SELECT
      COALESCE(SUM(CASE WHEN status IN ('paid', 'refunded', 'disputed') THEN amount_cents ELSE 0 END), 0)::text AS total_received,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount_cents ELSE 0 END), 0)::text AS contribution_refunded,
      COALESCE(SUM(CASE WHEN status IN ('paid', 'refunded', 'disputed') THEN 1 ELSE 0 END), 0)::text AS contributions_count,
      COALESCE(MAX(currency) FILTER (WHERE status IN ('paid', 'refunded', 'disputed')), 'cad') AS currency,
      COUNT(DISTINCT currency) FILTER (WHERE status IN ('paid', 'refunded', 'disputed'))::text AS currency_count,
      COUNT(*) FILTER (WHERE status IN ('paid', 'refunded', 'disputed') AND ${feeMissing})::text AS pending_fee_count,
      COALESCE(MAX(updated_at), NOW())::text AS last_updated_at
    FROM fund_contributions
    WHERE non_charity_acknowledged IS TRUE
  `);

  const monthlyQuery = await pool.query<ContributionMonthlyRow>(`
    SELECT
      TO_CHAR(DATE_TRUNC('month', COALESCE(paid_at, updated_at, created_at) AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
      COALESCE(SUM(CASE WHEN status IN ('paid', 'refunded', 'disputed') THEN amount_cents ELSE 0 END), 0)::text AS total_received,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount_cents ELSE 0 END), 0)::text AS contribution_refunded,
      COALESCE(SUM(CASE WHEN status IN ('paid', 'refunded', 'disputed') THEN 1 ELSE 0 END), 0)::text AS contributions_count,
      COALESCE(MAX(currency), 'cad') AS currency,
      COUNT(DISTINCT currency)::text AS currency_count,
      COUNT(*) FILTER (WHERE ${feeMissing})::text AS pending_fee_count
    FROM fund_contributions
    WHERE non_charity_acknowledged IS TRUE
      AND status IN ('paid', 'refunded', 'disputed')
    GROUP BY DATE_TRUNC('month', COALESCE(paid_at, updated_at, created_at) AT TIME ZONE 'UTC')
    ORDER BY DATE_TRUNC('month', COALESCE(paid_at, updated_at, created_at) AT TIME ZONE 'UTC') DESC
    LIMIT 12
  `);

  const adjustmentTotals = await getAdjustmentTotals(
    pool,
    tables.has_fund_transactions
  );
  const adjustmentMonthly = await getAdjustmentMonthly(
    pool,
    tables.has_fund_transactions
  );
  const adjustmentMonthlyByMonth = new Map(
    adjustmentMonthly.map((row) => [row.month, row])
  );
  const totals = totalsQuery.rows[0];
  assertProjectionCurrency(totals);
  assertProjectionCurrency(adjustmentTotals);
  const currency =
    Number(totals.currency_count ?? totals.contributions_count) > 0
      ? totals.currency
      : (adjustmentTotals.currency ?? totals.currency);
  assertProjectionCurrency(adjustmentTotals, currency);
  for (const row of monthlyQuery.rows) assertProjectionCurrency(row, currency);
  for (const row of adjustmentMonthly) assertProjectionCurrency(row, currency);
  const totalReceivedCents = parseDbInt(totals.total_received);
  const totalFeesCents = parseDbInt(adjustmentTotals.total_fees);
  const transactionRefundedCents = parseDbInt(adjustmentTotals.total_refunded);
  const contributionRefundedCents = parseDbInt(totals.contribution_refunded);
  const totalRefundedCents = resolveRefundedAmountMinor(
    transactionRefundedCents,
    contributionRefundedCents
  );
  const totalPayoutsCents = parseDbInt(adjustmentTotals.total_payouts);

  const totalReceived = centsToAmount(totalReceivedCents);
  const totalFees = centsToAmount(totalFeesCents);
  const totalRefunded = centsToAmount(totalRefundedCents);
  const totalPayouts = centsToAmount(totalPayoutsCents);
  const totalNet = centsToAmount(totalReceivedCents - totalFeesCents);
  const currentAvailableEstimate = calculateCurrentAvailableEstimate(
    totalNet,
    totalRefunded
  );

  const contributionsByMonth = new Map(
    monthlyQuery.rows.map((row) => [row.month, row])
  );
  const months = [
    ...new Set([
      ...contributionsByMonth.keys(),
      ...adjustmentMonthlyByMonth.keys()
    ])
  ]
    .sort()
    .reverse()
    .slice(0, 12);
  const monthlySummary = months.map((month) => {
    const row = contributionsByMonth.get(month);
    const adjustment = adjustmentMonthlyByMonth.get(month);
    const receivedMinor = parseDbInt(row?.total_received ?? '0');
    const feesMinor = parseDbInt(adjustment?.total_fees ?? '0');
    const totalReceivedForMonth = centsToAmount(receivedMinor);
    const totalFeesForMonth = centsToAmount(
      parseDbInt(adjustment?.total_fees ?? '0')
    );
    const transactionRefundedForMonth = parseDbInt(
      adjustment?.total_refunded ?? '0'
    );
    const contributionRefundedForMonth = parseDbInt(
      row?.contribution_refunded ?? '0'
    );
    const totalRefundedForMonth = centsToAmount(
      // Use the same source policy as the cumulative total, across all months.
      // A refund ledger in a later month must not duplicate a status fallback.
      transactionRefundedCents > 0
        ? transactionRefundedForMonth
        : contributionRefundedForMonth
    );
    const totalPayoutsForMonth = centsToAmount(
      parseDbInt(adjustment?.total_payouts ?? '0')
    );
    const totalNetForMonth = centsToAmount(receivedMinor - feesMinor);

    return {
      month,
      total_received: totalReceivedForMonth,
      total_fees: totalFeesForMonth,
      total_net: totalNetForMonth,
      total_refunded: totalRefundedForMonth,
      total_payouts: totalPayoutsForMonth,
      contributions_count: parseDbInt(row?.contributions_count ?? '0'),
      pending_fee_count: row ? pendingFeeCount(row.pending_fee_count) : 0,
      currency: currency.toUpperCase()
    };
  });

  return {
    data_source: 'database',
    total_received: totalReceived,
    total_fees: totalFees,
    total_net: totalNet,
    total_refunded: totalRefunded,
    total_payouts: totalPayouts,
    current_available_estimate: currentAvailableEstimate,
    contributions_count: parseDbInt(totals.contributions_count),
    pending_fee_count: pendingFeeCount(totals.pending_fee_count),
    currency: currency.toUpperCase(),
    monthly_summary: monthlySummary,
    latest_public_allocations: await getLatestPublicAllocations(
      pool,
      tables.has_fund_allocations
    ),
    public_builders: await getPublicBuilders(pool, tables),
    last_updated_at: maxIso(
      totals.last_updated_at,
      adjustmentTotals.last_updated_at
    )
  };
};

export const getPublicTransparencySummary = async (
  pool: Pool | null
): Promise<FundTransparencyPublicResponse> => {
  const generatedAt = new Date().toISOString();
  if (!pool) {
    return emptyResponse();
  }

  const tables = await getTablePresence(pool);
  if (tables.has_fund_contributions) {
    return {
      ...(await getContributionTransparencySummary(pool, tables)),
      generated_at: generatedAt
    };
  }

  if (tables.has_fund_transactions) {
    return {
      ...(await getTransactionTransparencySummary(
        pool,
        tables.has_fund_allocations
      )),
      generated_at: generatedAt
    };
  }

  return emptyResponse();
};
