import type { Pool } from 'pg';

/** Refuse a partial schema or missing grants before exposing inherited media workflows. */
export async function assertSponsorMediaReadiness(
  pool: Pick<Pool, 'query'>
): Promise<void> {
  let ready = false;
  try {
    const result = await pool.query<{ ready: boolean }>(`
      WITH expected(name,mutable) AS (VALUES
        ('sponsor_media_workspaces',true),
        ('sponsor_media_batches',true),
        ('sponsor_media_rule_versions',false),
        ('sponsor_media_workspace_commands',false),
        ('sponsor_media_batch_plans',false),
        ('sponsor_media_cleanup_jobs',true)
      )
      SELECT bool_and(COALESCE(c.oid IS NOT NULL
        AND has_schema_privilege(current_user,n.oid,'USAGE')
        AND has_table_privilege(current_user,c.oid,'SELECT')
        AND has_table_privilege(current_user,c.oid,'INSERT')
        AND (NOT expected.mutable OR has_table_privilege(current_user,c.oid,'UPDATE')),false))
        AND to_regprocedure('public.sponsor_media_effective_usage(uuid)') IS NOT NULL
        AND (SELECT count(*)=3 AND bool_and(
          has_column_privilege(current_user,'public.sponsor_media_assets',column_name,'SELECT')
          AND has_column_privilege(current_user,'public.sponsor_media_assets',column_name,'INSERT')
          AND has_column_privilege(current_user,'public.sponsor_media_assets',column_name,'UPDATE'))
          FROM information_schema.columns WHERE table_schema='public' AND table_name='sponsor_media_assets'
          AND column_name IN ('website_selected','usage_inheritance','media_batch_id'))
        AS ready
      FROM expected LEFT JOIN pg_namespace n ON n.nspname='public'
      LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.name AND c.relkind IN ('r','p')
    `);
    ready = result.rows[0]?.ready === true;
  } catch {
    // PostgreSQL diagnostics may include private connection details.
  }
  if (!ready) throw new Error('SPONSOR_MEDIA_SCHEMA_OR_GRANTS_REQUIRED');
}
