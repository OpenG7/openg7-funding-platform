import type {
  FundTransparencyPublicResponse,
  PublicBuilderProfile,
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

interface ContributionTotalsRow {
  readonly total_received: string;
  readonly contribution_refunded: string;
  readonly contributions_count: string;
  readonly currency: string;
  readonly last_updated_at: string;
}

interface AdjustmentTotalsRow {
  readonly total_fees: string;
  readonly total_refunded: string;
  readonly total_payouts: string;
  readonly last_updated_at: string | null;
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

interface ContributionMonthlyRow {
  readonly month: string;
  readonly total_received: string;
  readonly contribution_refunded: string;
  readonly contributions_count: string;
  readonly currency: string;
}

interface AdjustmentMonthlyRow {
  readonly month: string;
  readonly total_fees: string;
  readonly total_refunded: string;
  readonly total_payouts: string;
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
}

const centsToAmount = (value: number): number => Number((value / 100).toFixed(2));
const parseDbInt = (value: string): number => Number.parseInt(value, 10);
const maxIso = (left: string, right: string | null): string => {
  if (!right) {
    return left;
  }

  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
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

const getTablePresence = async (pool: Pool): Promise<TablePresenceRow> => {
  const query = await pool.query<TablePresenceRow>(`
    SELECT
      to_regclass('public.fund_contributions') IS NOT NULL AS has_fund_contributions,
      to_regclass('public.fund_transactions') IS NOT NULL AS has_fund_transactions,
      to_regclass('public.fund_allocations') IS NOT NULL AS has_fund_allocations
  `);

  return query.rows[0] ?? {
    has_fund_contributions: false,
    has_fund_transactions: false,
    has_fund_allocations: false
  };
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
    amount_allocated: centsToAmount(parseDbInt(row.amount_allocated)),
    currency: row.currency.toUpperCase(),
    status: row.status,
    published_at: row.published_at
  }));
};

const getPublicBuilders = async (
  pool: Pool,
  hasFundContributions: boolean
): Promise<readonly PublicBuilderProfile[]> => {
  if (!hasFundContributions) {
    return [];
  }

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
    currency: totals.currency.toUpperCase(),
    monthly_summary: monthlySummary,
    latest_public_allocations: latestAllocations,
    public_builders: [],
    last_updated_at: totals.last_updated_at
  };
};

const getAdjustmentTotals = async (
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
      MAX(inserted_at)::text AS last_updated_at
    FROM fund_transactions
  `);

  return query.rows[0] ?? {
    total_fees: '0',
    total_refunded: '0',
    total_payouts: '0',
    last_updated_at: null
  };
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
      TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN fee ELSE 0 END), 0)::text AS total_fees,
      COALESCE(SUM(CASE WHEN type = 'charge.refunded' THEN amount ELSE 0 END), 0)::text AS total_refunded,
      COALESCE(SUM(CASE WHEN type = 'payout.paid' THEN amount ELSE 0 END), 0)::text AS total_payouts,
      COALESCE(MAX(currency), 'cad') AS currency
    FROM fund_transactions
    GROUP BY DATE_TRUNC('month', created_at)
  `);

  return query.rows;
};

const getContributionTransparencySummary = async (
  pool: Pool,
  tables: TablePresenceRow
): Promise<FundTransparencyPublicResponse> => {
  const totalsQuery = await pool.query<ContributionTotalsRow>(`
    SELECT
      COALESCE(SUM(CASE WHEN status IN ('paid', 'refunded', 'disputed') THEN amount_cents ELSE 0 END), 0)::text AS total_received,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount_cents ELSE 0 END), 0)::text AS contribution_refunded,
      COALESCE(SUM(CASE WHEN status IN ('paid', 'refunded', 'disputed') THEN 1 ELSE 0 END), 0)::text AS contributions_count,
      COALESCE(MAX(currency), 'cad') AS currency,
      COALESCE(MAX(updated_at), NOW())::text AS last_updated_at
    FROM fund_contributions
    WHERE non_charity_acknowledged IS TRUE
  `);

  const monthlyQuery = await pool.query<ContributionMonthlyRow>(`
    SELECT
      TO_CHAR(DATE_TRUNC('month', COALESCE(paid_at, updated_at, created_at)), 'YYYY-MM') AS month,
      COALESCE(SUM(CASE WHEN status IN ('paid', 'refunded', 'disputed') THEN amount_cents ELSE 0 END), 0)::text AS total_received,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount_cents ELSE 0 END), 0)::text AS contribution_refunded,
      COALESCE(SUM(CASE WHEN status IN ('paid', 'refunded', 'disputed') THEN 1 ELSE 0 END), 0)::text AS contributions_count,
      COALESCE(MAX(currency), 'cad') AS currency
    FROM fund_contributions
    WHERE non_charity_acknowledged IS TRUE
      AND status IN ('paid', 'refunded', 'disputed')
    GROUP BY DATE_TRUNC('month', COALESCE(paid_at, updated_at, created_at))
    ORDER BY DATE_TRUNC('month', COALESCE(paid_at, updated_at, created_at)) DESC
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
  const totalReceivedCents = parseDbInt(totals.total_received);
  const totalFeesCents = parseDbInt(adjustmentTotals.total_fees);
  const transactionRefundedCents = parseDbInt(adjustmentTotals.total_refunded);
  const contributionRefundedCents = parseDbInt(totals.contribution_refunded);
  const totalRefundedCents =
    transactionRefundedCents > 0
      ? transactionRefundedCents
      : contributionRefundedCents;
  const totalPayoutsCents = parseDbInt(adjustmentTotals.total_payouts);

  const totalReceived = centsToAmount(totalReceivedCents);
  const totalFees = centsToAmount(totalFeesCents);
  const totalRefunded = centsToAmount(totalRefundedCents);
  const totalPayouts = centsToAmount(totalPayoutsCents);
  const totalNet = Number((totalReceived - totalFees).toFixed(2));
  const currentAvailableEstimate = Number(
    (totalNet - totalRefunded - totalPayouts).toFixed(2)
  );

  const monthlySummary = monthlyQuery.rows.map((row) => {
    const adjustment = adjustmentMonthlyByMonth.get(row.month);
    const totalReceivedForMonth = centsToAmount(parseDbInt(row.total_received));
    const totalFeesForMonth = centsToAmount(
      parseDbInt(adjustment?.total_fees ?? '0')
    );
    const transactionRefundedForMonth = parseDbInt(
      adjustment?.total_refunded ?? '0'
    );
    const contributionRefundedForMonth = parseDbInt(row.contribution_refunded);
    const totalRefundedForMonth = centsToAmount(
      transactionRefundedForMonth > 0
        ? transactionRefundedForMonth
        : contributionRefundedForMonth
    );
    const totalPayoutsForMonth = centsToAmount(
      parseDbInt(adjustment?.total_payouts ?? '0')
    );
    const totalNetForMonth = Number(
      (totalReceivedForMonth - totalFeesForMonth).toFixed(2)
    );

    return {
      month: row.month,
      total_received: totalReceivedForMonth,
      total_fees: totalFeesForMonth,
      total_net: totalNetForMonth,
      total_refunded: totalRefundedForMonth,
      total_payouts: totalPayoutsForMonth,
      contributions_count: parseDbInt(row.contributions_count),
      currency: row.currency.toUpperCase()
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
    currency: totals.currency.toUpperCase(),
    monthly_summary: monthlySummary,
    latest_public_allocations: await getLatestPublicAllocations(
      pool,
      tables.has_fund_allocations
    ),
    public_builders: await getPublicBuilders(
      pool,
      tables.has_fund_contributions
    ),
    last_updated_at: maxIso(
      totals.last_updated_at,
      adjustmentTotals.last_updated_at
    )
  };
};

export const getPublicTransparencySummary = async (
  pool: Pool | null
): Promise<FundTransparencyPublicResponse> => {
  if (!pool) {
    return emptyResponse();
  }

  const tables = await getTablePresence(pool);
  if (tables.has_fund_contributions) {
    return getContributionTransparencySummary(pool, tables);
  }

  if (tables.has_fund_transactions) {
    return getTransactionTransparencySummary(
      pool,
      tables.has_fund_allocations
    );
  }

  return emptyResponse();
};
