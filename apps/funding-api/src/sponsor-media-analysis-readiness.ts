import type { Pool } from 'pg';

export async function assertSponsorMediaAnalysisReadiness(
  pool: Pick<Pool, 'query'>
): Promise<void> {
  let ready = false;
  try {
    const result = await pool.query<{ ready: boolean }>(
      `WITH expected(name,mutable) AS (VALUES ('sponsor_media_analysis_runs',true),('sponsor_media_analysis_suggestions',false),('sponsor_media_analysis_reviews',false),('sponsor_media_analysis_requests',false)) SELECT bool_and(COALESCE(c.oid IS NOT NULL AND has_schema_privilege(current_user,n.oid,'USAGE') AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND (NOT expected.mutable OR has_table_privilege(current_user,c.oid,'UPDATE')),false)) AS ready FROM expected LEFT JOIN pg_namespace n ON n.nspname='public' LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.name AND c.relkind IN ('r','p')`
    );
    ready = result.rows[0]?.ready === true;
  } catch {
    /* Connection diagnostics can contain secrets. */
  }
  if (!ready)
    throw new Error('SPONSOR_MEDIA_ANALYSIS_SCHEMA_OR_GRANTS_REQUIRED');
}
