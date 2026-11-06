import type { Pool } from 'pg';

import { AdminAutomaticRunError } from './admin-automatic-run-error.js';

/** Fail closed if the exact-version uniqueness or immutable journal is missing. */
export async function assertServicePreparationReadiness(
  pool: Pick<Pool, 'query'>,
  operation: 'read' | 'decide' = 'read'
): Promise<void> {
  try {
    const row = (
      await pool.query<{
        compatible: boolean;
        can_read: boolean;
        can_insert: boolean;
      }>(`
      WITH relation AS (
        SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='admin_service_preparation_decisions' AND c.relkind IN ('r','p')
      ) SELECT
        EXISTS(SELECT 1 FROM relation) AND EXISTS(
          SELECT 1 FROM relation r JOIN pg_index i ON i.indrelid=r.oid
          WHERE i.indisunique AND i.indisvalid AND i.indisready AND i.indnkeyatts=3 AND i.indpred IS NULL
            AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=r.oid AND attname='contribution_id')
            AND i.indkey[1]=(SELECT attnum FROM pg_attribute WHERE attrelid=r.oid AND attname='obligation_id')
            AND i.indkey[2]=(SELECT attnum FROM pg_attribute WHERE attrelid=r.oid AND attname='expected_version')
        ) AND EXISTS(
          SELECT 1 FROM relation r JOIN pg_trigger t ON t.tgrelid=r.oid
          WHERE t.tgname='admin_service_preparation_decisions_immutable' AND t.tgenabled IN ('O','A')
        ) AS compatible,
        COALESCE((SELECT has_table_privilege(current_user,r.oid,'SELECT') FROM relation r),false) AS can_read,
        COALESCE((SELECT has_table_privilege(current_user,r.oid,'INSERT') FROM relation r),false) AS can_insert
    `)
    ).rows[0];
    if (!row?.compatible)
      throw new AdminAutomaticRunError('PREPARATION_SCHEMA_INCOMPATIBLE', 503);
    if (!row.can_read || (operation === 'decide' && !row.can_insert))
      throw new AdminAutomaticRunError(
        'PREPARATION_DATABASE_ACCESS_DENIED',
        503
      );
  } catch (error) {
    if (error instanceof AdminAutomaticRunError) throw error;
    throw new AdminAutomaticRunError(
      error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '42501'
        ? 'PREPARATION_DATABASE_ACCESS_DENIED'
        : 'RUN_UNAVAILABLE',
      503
    );
  }
}
