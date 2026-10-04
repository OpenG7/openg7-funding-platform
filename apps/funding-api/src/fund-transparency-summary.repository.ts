import type {
  FundTransparencyPublicResponse,
  PublicFundAllocation,
  PublicMonthlySummary
} from '@openg7/funding-core';
import type { Pool } from 'pg';

import { resolveRefundedAmountMinor } from './fund-refunds.js';
import { effectiveRefundsSql } from './fund-refund-projection.js';
import {
  getTablePresence,
  type TablePresenceRow
} from './fund-transparency-presence.repository.js';
import { centsToAmount, parseDbInt } from './fund-transparency-projection.js';
import { getLatestPublicAllocations } from './public-allocations.repository.js';
import { getPublicBuilders } from './public-builders.repository.js';

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

// Project old duplicate facts once without deleting or rewriting the ledger.
// A terminal failure cancels that payout even when its older success arrives last.
const effectiveFundTransactionsSql = `
  WITH ${effectiveRefundsSql}, payments AS (
    SELECT DISTINCT ON (stripe_object_id) * FROM fund_transactions
    WHERE type = 'payment_intent.succeeded'
    ORDER BY stripe_object_id, (stripe_balance_transaction_id IS NOT NULL) DESC, id
  ), successful_payouts AS (
    SELECT DISTINCT ON (payout.stripe_object_id) payout.*
    FROM fund_transactions payout
    WHERE payout.type = 'payout.paid' AND payout.status = 'paid'
      AND NOT EXISTS (
        SELECT 1 FROM fund_transactions failure
        WHERE failure.stripe_object_id = payout.stripe_object_id
          AND failure.type = 'payout.failed' AND failure.status = 'failed'
      )
    ORDER BY payout.stripe_object_id, payout.id
  ), effective_transactions AS (
    SELECT * FROM fund_transactions WHERE type NOT IN ('payment_intent.succeeded', 'payout.paid', 'payout.failed', 'charge.refunded')
    UNION ALL
    SELECT * FROM effective_refunds
    UNION ALL
    SELECT * FROM payments
    UNION ALL
    SELECT * FROM successful_payouts
  )
`;

const getTransactionTransparencySummary = async (
  pool: Pool,
  hasFundAllocations: boolean
): Promise<FundTransparencyPublicResponse> => {
  const totalsQuery = await pool.query<TotalsRow>(`
    ${effectiveFundTransactionsSql}
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
      COALESCE(GREATEST(MAX(inserted_at),
        (SELECT MAX(inserted_at) FROM fund_transactions WHERE type = 'payout.failed')
      ), NOW())::text AS last_updated_at
    FROM effective_transactions
    WHERE type IN ('payment_intent.succeeded', 'charge.refunded', 'payout.paid')
  `);

  const monthlyQuery = await pool.query<MonthlyRow>(`
    ${effectiveFundTransactionsSql}
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
    FROM effective_transactions
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
    ${effectiveFundTransactionsSql}
    SELECT
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN fee ELSE 0 END), 0)::text AS total_fees,
      COALESCE(SUM(CASE WHEN type = 'charge.refunded' THEN amount ELSE 0 END), 0)::text AS total_refunded,
      COALESCE(SUM(CASE WHEN type = 'payout.paid' THEN amount ELSE 0 END), 0)::text AS total_payouts,
      COALESCE(MAX(currency), 'cad') AS currency,
      COUNT(DISTINCT currency)::text AS currency_count,
      GREATEST(MAX(inserted_at),
        (SELECT MAX(inserted_at) FROM fund_transactions WHERE type = 'payout.failed')
      )::text AS last_updated_at
    FROM effective_transactions
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
    ${effectiveFundTransactionsSql}
    SELECT
      TO_CHAR(DATE_TRUNC('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
      COALESCE(SUM(CASE WHEN type = 'payment_intent.succeeded' THEN fee ELSE 0 END), 0)::text AS total_fees,
      COALESCE(SUM(CASE WHEN type = 'charge.refunded' THEN amount ELSE 0 END), 0)::text AS total_refunded,
      COALESCE(SUM(CASE WHEN type = 'payout.paid' THEN amount ELSE 0 END), 0)::text AS total_payouts,
      COALESCE(MAX(currency), 'cad') AS currency,
      COUNT(DISTINCT currency)::text AS currency_count
    FROM effective_transactions
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
