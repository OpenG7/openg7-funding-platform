const identifierPattern = /^[a-z_][a-z0-9_]{0,62}$/;
const literal = (value) =>
  `E'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;

export function runtimeRoleConfig(env, { requirePassword = false } = {}) {
  const role = env.FUNDING_DATABASE_RUNTIME_USER?.trim();
  if (!role) return null;
  const database = env.POSTGRES_DB || 'openg7_funding';
  const owner = env.POSTGRES_USER || 'openg7_funding';
  const password = env.FUNDING_DATABASE_RUNTIME_PASSWORD;
  if (
    ![role, database, owner].every((value) => identifierPattern.test(value)) ||
    role === owner ||
    role.startsWith('pg_') ||
    (requirePassword && (!password || password.length < 32)) ||
    (password && /[\r\n\x00]/.test(password))
  )
    throw new Error('Invalid dedicated runtime role configuration.');
  return { role, database, owner, password };
}

/** Run by the migration owner only, inside the caller's transaction. No ownership transfer. */
export function buildRuntimeRoleSql(config, { create = false } = {}) {
  const { role, database, password } = config;
  if (![role, database].every((value) => identifierPattern.test(value)))
    throw new Error('Invalid role or database identifier.');
  if (
    create &&
    (!password || password.length < 32 || /[\r\n\x00]/.test(password))
  )
    throw new Error('A strong runtime password is required.');
  // Password is encoded so it cannot terminate the enclosing dollar-quoted DO block.
  const encodedPassword = create
    ? Buffer.from(password, 'utf8').toString('base64')
    : '';
  return `
DO $og7_runtime_role$
DECLARE account record; item record; runtime_name text := ${literal(role)};
BEGIN
  IF current_database() <> ${literal(database)} THEN
    RAISE EXCEPTION 'OG7_RUNTIME_ROLE_TARGET_MISMATCH';
  END IF;
  PERFORM pg_advisory_xact_lock(186904759, 2);
  SELECT * INTO account FROM pg_roles WHERE rolname=runtime_name;
  IF NOT FOUND THEN
    ${create ? `EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', runtime_name, convert_from(decode('${encodedPassword}', 'base64'), 'UTF8'));` : "RAISE EXCEPTION 'OG7_RUNTIME_ROLE_NOT_PROVISIONED';"}
    SELECT * INTO account FROM pg_roles WHERE rolname=runtime_name;
  END IF;
  IF account.rolsuper OR account.rolcreatedb OR account.rolcreaterole OR account.rolreplication OR account.rolbypassrls
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=account.oid)
     OR EXISTS (SELECT 1 FROM pg_database WHERE datdba=account.oid)
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner=account.oid)
     OR EXISTS (SELECT 1 FROM pg_class WHERE relowner=account.oid)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner=account.oid) THEN
    RAISE EXCEPTION 'OG7_RUNTIME_ROLE_UNSAFE_EXISTING_ROLE';
  END IF;
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM %I', current_database(), runtime_name);
  EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), runtime_name);
  EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', runtime_name);
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', runtime_name);
  EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', runtime_name);
  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', runtime_name);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', runtime_name);
  FOR item IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef LOOP
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC, %I', item.signature, runtime_name);
  END LOOP;
  FOR item IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO %I', item.relname, runtime_name);
    IF item.relname <> 'openg7_schema_migrations' THEN
      EXECUTE format('GRANT INSERT ON TABLE public.%I TO %I', item.relname, runtime_name);
      IF item.relname <> 'admin_audit_log' THEN
        EXECUTE format('GRANT UPDATE ON TABLE public.%I TO %I', item.relname, runtime_name);
      END IF;
    END IF;
    IF item.relname = 'admin_login_challenges' THEN
      EXECUTE format('GRANT DELETE ON TABLE public.%I TO %I', item.relname, runtime_name);
    END IF;
  END LOOP;
END
$og7_runtime_role$;
`;
}
