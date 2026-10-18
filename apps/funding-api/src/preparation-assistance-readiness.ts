import type { Pool } from 'pg';

/** Detect a missing migration or incomplete runtime grants before scheduling jobs. */
export async function assertPreparationAssistanceReadiness(
  pool: Pick<Pool, 'query'>
): Promise<void> {
  let ready = false;
  try {
    const result = await pool.query<{ ready: boolean }>(`
      WITH expected(name, mutable) AS (VALUES
        ('preparation_assistance_sources',false),
        ('preparation_assistance_runs',true),
        ('preparation_assistance_suggestions',false),
        ('preparation_assistance_reviews',false),
        ('preparation_assistance_requests',false)
      )
      SELECT bool_and(COALESCE(
        c.oid IS NOT NULL AND has_schema_privilege(current_user,n.oid,'USAGE')
        AND has_table_privilege(current_user,c.oid,'SELECT')
        AND has_table_privilege(current_user,c.oid,'INSERT')
        AND (NOT expected.mutable OR has_table_privilege(current_user,c.oid,'UPDATE')),
        false
      )) AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid=to_regclass('public.preparation_assistance_runs')
          AND conname='preparation_assistance_runs_supported_adapter_check'
          AND contype='c' AND convalidated
      ) AS ready
      FROM expected
      LEFT JOIN pg_namespace n ON n.nspname='public'
      LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.name
        AND c.relkind IN ('r','p')
    `);
    ready = result.rows[0]?.ready === true;
  } catch {
    // Connection diagnostics may contain credentials or private agreement text.
  }
  if (!ready)
    throw new Error('PREPARATION_ASSISTANCE_SCHEMA_OR_GRANTS_REQUIRED');
}
