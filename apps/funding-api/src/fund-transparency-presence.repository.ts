import type { Pool } from 'pg';

export interface TablePresenceRow {
  readonly has_fund_contributions: boolean;
  readonly has_fund_transactions: boolean;
  readonly has_fund_allocations: boolean;
  readonly has_sponsor_review_status: boolean;
}

export const getTablePresence = async (
  pool: Pool
): Promise<TablePresenceRow> => {
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
