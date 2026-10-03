import type { Pool, PoolClient } from 'pg';

interface AdminBackofficePresenceRow {
  readonly has_publication_drafts: boolean;
  readonly has_publication_batches: boolean;
  readonly has_publication_slots: boolean;
  readonly has_social_publication_jobs: boolean;
  readonly has_audit_log: boolean;
  readonly has_fund_allocations: boolean;
}

export const getAdminBackofficePresence = async (
  pool: Pool | PoolClient
): Promise<AdminBackofficePresenceRow> => {
  const query = await pool.query<AdminBackofficePresenceRow>(`
    SELECT
      to_regclass('public.sponsor_publication_drafts') IS NOT NULL AS has_publication_drafts,
      to_regclass('public.sponsor_publication_batches') IS NOT NULL AS has_publication_batches,
      to_regclass('public.publication_slots') IS NOT NULL AS has_publication_slots,
      to_regclass('public.social_publication_jobs') IS NOT NULL AS has_social_publication_jobs,
      to_regclass('public.admin_audit_log') IS NOT NULL AS has_audit_log,
      to_regclass('public.fund_allocations') IS NOT NULL AS has_fund_allocations
  `);

  return (
    query.rows[0] ?? {
      has_publication_drafts: false,
      has_publication_batches: false,
      has_publication_slots: false,
      has_social_publication_jobs: false,
      has_audit_log: false,
      has_fund_allocations: false
    }
  );
};
