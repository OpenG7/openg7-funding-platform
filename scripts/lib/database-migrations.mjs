import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const migrationLock = [186904759, 1];
const filePattern = /^(\d{3})_[a-z0-9_]+\.sql$/;
const registrySql = readFileSync(
  new URL('../sql/001_migration_registry.sql', import.meta.url),
  'utf8'
);
const literal = (value) =>
  `E'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;

export function readMigrations(directory) {
  const names = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (!names.length) throw new Error('No SQL migrations found.');
  const versions = new Set();
  return names.map((name) => {
    const match = filePattern.exec(name);
    const version = Number(match?.[1]);
    if (!match || version === 0 || versions.has(version)) {
      throw new Error(
        'Migration names must have unique positive NNN versions and lowercase SQL filenames.'
      );
    }
    versions.add(version);
    // Git checkouts may use CRLF on Windows; SQL and its hash use canonical LF.
    const sql = readFileSync(join(directory, name), 'utf8').replaceAll(
      '\r\n',
      '\n'
    );
    return {
      name,
      version,
      sql,
      sha256: createHash('sha256').update(sql).digest('hex')
    };
  });
}

export function parseMigrationArgs(argv) {
  const options = { mode: 'apply' };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (seen.has(arg)) throw new Error('Duplicate migration option.');
    seen.add(arg);
    if (arg === '--help') options.help = true;
    else if (arg === '--plan') options.mode = 'plan';
    else if (
      [
        '--baseline-through',
        '--confirm-database',
        '--baseline-reference'
      ].includes(arg)
    ) {
      const value = argv[++index];
      if (!value || value.startsWith('--'))
        throw new Error('Migration option requires a value.');
      if (arg === '--baseline-through') options.baselineThrough = value;
      if (arg === '--confirm-database') options.confirmDatabase = value;
      if (arg === '--baseline-reference') options.baselineReference = value;
    } else throw new Error('Unknown migration option.');
  }
  if (options.baselineThrough) {
    if (options.mode === 'plan')
      throw new Error('Plan and baseline are separate operations.');
    if (
      !filePattern.test(options.baselineThrough) ||
      !options.confirmDatabase ||
      !/^[A-Za-z0-9._:-]{1,100}$/.test(options.baselineReference ?? '')
    ) {
      throw new Error(
        'Baseline requires a migration filename, --confirm-database and a non-secret --baseline-reference.'
      );
    }
    options.mode = 'baseline';
  } else if (options.confirmDatabase || options.baselineReference) {
    throw new Error(
      'Baseline confirmation options require --baseline-through.'
    );
  }
  return options;
}

export function buildMigrationSql(
  migrations,
  { mode = 'apply', database, baselineThrough, baselineReference } = {}
) {
  if (
    !['apply', 'plan', 'baseline'].includes(mode) ||
    !database ||
    !migrations.length
  ) {
    throw new Error('Invalid migration execution options.');
  }
  const baseline =
    mode === 'baseline'
      ? migrations.find((item) => item.name === baselineThrough)
      : null;
  if (mode === 'baseline' && (!baseline || !baselineReference))
    throw new Error('Baseline boundary is not in the migration directory.');
  const manifest = JSON.stringify(migrations);
  let delimiter = '$og7_migrations$';
  while (
    [manifest, registrySql, database, baselineReference ?? ''].some((value) =>
      value.includes(delimiter)
    )
  ) {
    delimiter = delimiter.slice(0, -1) + '_x$';
  }
  // One transaction and one connection: the manifest is checked before any SQL
  // is applied. A waiting runner takes a fresh READ COMMITTED snapshot after the lock.
  return `BEGIN ISOLATION LEVEL READ COMMITTED${mode === 'plan' ? ' READ ONLY' : ''};
SET LOCAL standard_conforming_strings = on;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';
SET LOCAL client_min_messages = notice;
SELECT pg_advisory_xact_lock(${migrationLock.join(',')});
DO ${delimiter}
DECLARE
  manifest jsonb := ${literal(manifest)}::jsonb;
  run_mode text := ${literal(mode)};
  item record;
  previous record;
  current_item jsonb;
  occupied boolean;
  highest integer;
BEGIN
  IF current_database() <> ${literal(database)} THEN
    RAISE EXCEPTION 'OG7_MIGRATIONS_TARGET_MISMATCH';
  END IF;
  IF to_regclass('public.openg7_schema_migrations') IS NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
        AND c.relkind IN ('r','p','v','m','S','f')
    ) INTO occupied;
    IF occupied AND run_mode <> 'baseline' THEN
      RAISE EXCEPTION 'OG7_MIGRATIONS_BASELINE_REQUIRED';
    END IF;
    IF NOT occupied AND run_mode = 'baseline' THEN
      RAISE EXCEPTION 'OG7_MIGRATIONS_BASELINE_EMPTY';
    END IF;
    IF run_mode = 'plan' THEN
      FOR item IN SELECT * FROM jsonb_to_recordset(manifest) AS m(name text) LOOP
        RAISE NOTICE 'OG7_MIGRATION pending %', item.name;
      END LOOP;
      RETURN;
    END IF;
    EXECUTE ${literal(registrySql)};
  ELSIF run_mode = 'baseline' THEN
    RAISE EXCEPTION 'OG7_MIGRATIONS_ALREADY_TRACKED';
  END IF;

  FOR previous IN SELECT * FROM public.openg7_schema_migrations ORDER BY version LOOP
    SELECT entry INTO current_item FROM jsonb_array_elements(manifest) AS entries(entry)
      WHERE entry->>'name' = previous.name;
    IF current_item IS NULL THEN RAISE EXCEPTION 'OG7_MIGRATIONS_HISTORY_MISSING'; END IF;
    IF previous.sha256 <> current_item->>'sha256' OR previous.version <> (current_item->>'version')::integer THEN
      RAISE EXCEPTION 'OG7_MIGRATIONS_HISTORY_CHANGED';
    END IF;
  END LOOP;
  SELECT COALESCE(max(version), 0) INTO highest FROM public.openg7_schema_migrations;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(manifest) AS m(version integer)
    WHERE m.version < highest AND NOT EXISTS (
      SELECT 1 FROM public.openg7_schema_migrations h WHERE h.version = m.version
    )
  ) THEN RAISE EXCEPTION 'OG7_MIGRATIONS_OUT_OF_ORDER'; END IF;

  FOR item IN SELECT * FROM jsonb_to_recordset(manifest)
    AS m(name text, version integer, sha256 text, sql text) ORDER BY version LOOP
    IF EXISTS (SELECT 1 FROM public.openg7_schema_migrations h WHERE h.version = item.version) THEN
      RAISE NOTICE 'OG7_MIGRATION skipped %', item.name;
    ELSIF run_mode = 'plan' OR (run_mode = 'baseline' AND item.version > ${baseline?.version ?? 0}) THEN
      RAISE NOTICE 'OG7_MIGRATION pending %', item.name;
    ELSE
      IF run_mode = 'apply' THEN
        -- Dynamic SQL cannot commit or run psql metacommands inside this block.
        EXECUTE item.sql;
      END IF;
      INSERT INTO public.openg7_schema_migrations(version,name,sha256,action,baseline_reference)
        VALUES (item.version,item.name,item.sha256,
          CASE WHEN run_mode = 'baseline' THEN 'baseline' ELSE 'applied' END,
          ${baseline ? literal(baselineReference) : 'NULL'});
      RAISE NOTICE 'OG7_MIGRATION % %',
        CASE WHEN run_mode = 'baseline' THEN 'baseline' ELSE 'applied' END, item.name;
    END IF;
  END LOOP;
END
${delimiter};
COMMIT;
`;
}

// PostgreSQL errors can include row contents or SQL literals. Expose only fixed
// diagnostics and validated filenames; never relay the raw psql/Docker output.
export function migrationFailure(stderr = '') {
  const messages = {
    TARGET_MISMATCH: 'Connected database does not match the configured target.',
    BASELINE_REQUIRED:
      'Existing schema has no migration registry. Review a backup and schema inventory before explicit baseline adoption.',
    BASELINE_EMPTY:
      'Baseline is refused on an empty database. Apply the migrations normally.',
    ALREADY_TRACKED:
      'A migration registry already exists. Reconcile it with --plan before another operation.',
    HISTORY_MISSING:
      'An applied migration is missing or renamed. Restore the complete migration directory.',
    HISTORY_CHANGED:
      'An applied migration checksum or version has changed. Restore the immutable file.',
    OUT_OF_ORDER:
      'A pending migration precedes recorded history. Use a new migration number.'
  };
  const code = /OG7_MIGRATIONS_([A-Z_]+)/.exec(stderr)?.[1];
  return (
    messages[code] ??
    'Migration execution failed or its result is uncertain. No success is claimed; reconcile with --plan before retrying. Raw SQL errors are suppressed.'
  );
}

export function migrationReport(stderr = '') {
  return stderr.split(/\r?\n/).flatMap((line) => {
    const match =
      /^NOTICE:\s+OG7_MIGRATION (pending|skipped|applied|baseline) (\d{3}_[a-z0-9_]+\.sql)$/.exec(
        line
      );
    return match ? [`${match[1]} ${match[2]}`] : [];
  });
}
