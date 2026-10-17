import type { Pool } from 'pg';

import { AdminAutomaticRunError } from './admin-automatic-run-error.js';

interface PreparationReadiness {
  readonly schema_compatible: boolean;
  readonly can_read: boolean;
  readonly can_approve: boolean;
}

/** Inspect the active API role without touching preparation or financial records. */
export async function assertPreparationReadiness(
  pool: Pick<Pool, 'query'>,
  operation: 'read' | 'approve' = 'read'
): Promise<void> {
  let checks: PreparationReadiness | undefined;
  try {
    checks = (
      await pool.query<PreparationReadiness>(`
        WITH relation AS (
          SELECT c.oid, c.relnamespace
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname='admin_preparation_approvals'
            AND c.relkind IN ('r','p')
        ), required_columns(name, type_name, not_null, inserted) AS (
          VALUES
            ('id','uuid',true,false),
            ('run_id','uuid',false,true),
            ('contribution_id','uuid',true,true),
            ('preparation_version','text',true,true),
            ('actor','text',true,true),
            ('request_id','uuid',true,true),
            ('request_hash','text',true,true),
            ('audit_reference','uuid',true,true),
            ('snapshot','jsonb',true,true),
            ('approved_at','timestamptz',true,false),
            ('approval_generation','int4',true,true)
        ), columns AS (
          SELECT a.* FROM relation r JOIN pg_attribute a ON a.attrelid=r.oid
          WHERE a.attnum>0 AND NOT a.attisdropped
        )
        SELECT
          EXISTS (SELECT 1 FROM relation)
          AND NOT EXISTS (
            SELECT 1 FROM required_columns expected
            LEFT JOIN columns a ON a.attname=expected.name
            WHERE a.attname IS NULL OR a.atttypid<>to_regtype(expected.type_name)
              OR a.attnotnull<>expected.not_null
              OR (expected.name IN ('id','approved_at') AND NOT a.atthasdef)
          )
          AND NOT EXISTS (
            SELECT 1 FROM columns a
            WHERE a.attnotnull AND NOT a.atthasdef AND a.attidentity=''
              AND a.attgenerated='' AND NOT EXISTS (
                SELECT 1 FROM required_columns expected
                WHERE expected.name=a.attname AND expected.inserted
              )
          )
          AND EXISTS (
            SELECT 1 FROM relation r JOIN pg_index i ON i.indrelid=r.oid
            WHERE i.indisunique AND i.indisvalid AND i.indisready
              AND i.indnkeyatts=2
              AND i.indkey[0]=(SELECT attnum FROM columns WHERE attname='contribution_id')
              AND i.indkey[1]=(SELECT attnum FROM columns WHERE attname='preparation_version')
              AND pg_get_expr(i.indpred,i.indrelid)='(approval_generation = 2)'
          ) AS schema_compatible,
          COALESCE((SELECT
            has_schema_privilege(current_user,r.relnamespace,'USAGE')
            AND NOT EXISTS (
              SELECT 1 FROM columns a
              WHERE NOT has_column_privilege(current_user,r.oid,a.attnum,'SELECT')
            ) FROM relation r),false) AS can_read,
          COALESCE((SELECT
            has_schema_privilege(current_user,r.relnamespace,'USAGE')
            AND NOT EXISTS (
              SELECT 1 FROM required_columns expected JOIN columns a ON a.attname=expected.name
              WHERE expected.inserted
                AND NOT has_column_privilege(current_user,r.oid,a.attnum,'INSERT')
            ) FROM relation r),false) AS can_approve
      `)
    ).rows[0];
  } catch (error) {
    // Never attach PostgreSQL diagnostics: they may contain credentials or private data.
    const denied =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '42501';
    throw new AdminAutomaticRunError(
      denied ? 'PREPARATION_DATABASE_ACCESS_DENIED' : 'RUN_UNAVAILABLE',
      503
    );
  }

  if (!checks || checks.schema_compatible !== true)
    throw new AdminAutomaticRunError('PREPARATION_SCHEMA_INCOMPATIBLE', 503);
  if (
    checks.can_read !== true ||
    (operation === 'approve' && checks.can_approve !== true)
  )
    throw new AdminAutomaticRunError('PREPARATION_DATABASE_ACCESS_DENIED', 503);
}
