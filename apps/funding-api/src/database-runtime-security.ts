import type { Pool } from 'pg';

interface RuntimePrivilegeCheck {
  readonly role_is_safe: boolean;
  readonly no_role_memberships: boolean;
  readonly no_ddl: boolean;
  readonly no_destructive_dml: boolean;
  readonly immutable_audit: boolean;
}

/** Check effective privileges, including PUBLIC grants, before opening a production listener. */
export const assertProductionDatabasePrivileges = async (
  pool: Pick<Pool, 'query'> | null,
  isProduction: boolean
): Promise<void> => {
  if (!isProduction) return;
  if (!pool) throw new Error('DATABASE_RUNTIME_REQUIRED');

  let checks: RuntimePrivilegeCheck | undefined;
  try {
    const result = await pool.query<RuntimePrivilegeCheck>(`
      WITH runtime_role AS (
        SELECT * FROM pg_roles WHERE rolname = current_user
      ), application_relations AS (
        SELECT c.oid, c.relname, c.relowner, n.nspname
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      )
      SELECT
        current_user = session_user AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
          OR r.rolreplication OR r.rolbypassrls) AS role_is_safe,
        NOT EXISTS (
          SELECT 1 FROM pg_roles other
          WHERE other.oid <> r.oid
            AND pg_has_role(current_user, other.oid, 'MEMBER')
        ) AS no_role_memberships,
        NOT (
          has_database_privilege(current_user, current_database(), 'CREATE,TEMP')
          OR EXISTS (
            SELECT 1 FROM pg_namespace n
            WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
              AND has_schema_privilege(current_user, n.oid, 'CREATE')
          )
          OR EXISTS (SELECT 1 FROM application_relations WHERE relowner = r.oid)
          OR EXISTS (
            SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
              AND (p.proowner = r.oid OR (
                p.prosecdef AND has_function_privilege(current_user, p.oid, 'EXECUTE')
              ))
          )
        ) AS no_ddl,
        NOT EXISTS (
          SELECT 1 FROM application_relations a
          WHERE has_table_privilege(current_user, a.oid, 'TRUNCATE,TRIGGER,REFERENCES')
            OR (has_table_privilege(current_user, a.oid, 'DELETE')
              AND NOT (a.nspname = 'public' AND a.relname = 'admin_login_challenges'))
        ) AS no_destructive_dml,
        NOT EXISTS (
          SELECT 1 FROM application_relations a
          WHERE a.nspname = 'public' AND (
            (a.relname = 'admin_audit_log'
              AND has_table_privilege(current_user, a.oid, 'UPDATE'))
            OR (a.relname = 'openg7_schema_migrations'
              AND has_table_privilege(current_user, a.oid, 'INSERT,UPDATE'))
          )
        ) AS immutable_audit
      FROM runtime_role r
    `);
    checks = result.rows[0];
  } catch {
    // PostgreSQL connection/diagnostic errors can contain private connection data.
    throw new Error('DATABASE_RUNTIME_PRIVILEGE_CHECK_FAILED');
  }

  if (
    !checks ||
    checks.role_is_safe !== true ||
    checks.no_role_memberships !== true ||
    checks.no_ddl !== true ||
    checks.no_destructive_dml !== true ||
    checks.immutable_audit !== true
  ) {
    throw new Error('DATABASE_RUNTIME_PRIVILEGES_UNSAFE');
  }
};
