import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  rmdirSync,
  readFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, delimiter } from 'node:path';
import test from 'node:test';
import {
  buildMigrationSql,
  migrationFailure,
  migrationReport,
  parseMigrationArgs,
  readMigrations
} from '../scripts/lib/database-migrations.mjs';

function directory(t) {
  const root = mkdtempSync(join(tmpdir(), 'og7-migration-manifest-'));
  t.after(() => {
    for (const name of readdirSync(root)) unlinkSync(join(root, name));
    rmdirSync(root);
  });
  return root;
}

test('migration manifest sorts versions and canonicalizes Windows line endings', (t) => {
  const root = directory(t);
  writeFileSync(join(root, '002_second.sql'), 'SELECT 2;\n');
  writeFileSync(join(root, '001_first.sql'), "-- apostrophe '\nSELECT 1;\n");
  const lf = readMigrations(root);
  writeFileSync(
    join(root, '001_first.sql'),
    "-- apostrophe '\r\nSELECT 1;\r\n"
  );
  assert.deepEqual(readMigrations(root), lf);
  assert.deepEqual(
    lf.map((item) => item.version),
    [1, 2]
  );
  writeFileSync(join(root, '001_first.sql'), 'SELECT 3;\n');
  assert.notEqual(readMigrations(root)[0].sha256, lf[0].sha256);
});

test('empty manifests, invalid filenames and duplicate versions are refused', (t) => {
  const root = directory(t);
  assert.throws(() => readMigrations(root), /No SQL/);
  writeFileSync(join(root, 'bad.sql'), 'SELECT 1;');
  assert.throws(() => readMigrations(root), /Migration names/);
  unlinkSync(join(root, 'bad.sql'));
  writeFileSync(join(root, '001_first.sql'), 'SELECT 1;');
  writeFileSync(join(root, '001_duplicate.sql'), 'SELECT 2;');
  assert.throws(() => readMigrations(root), /Migration names/);
});

test('baseline requires a boundary, exact target confirmation and a non-secret review reference', () => {
  assert.equal(parseMigrationArgs([]).mode, 'apply');
  assert.equal(parseMigrationArgs(['--plan']).mode, 'plan');
  const baseline = [
    '--baseline-through',
    '027_last.sql',
    '--confirm-database',
    'synthetic',
    '--baseline-reference',
    'review-123'
  ];
  assert.equal(parseMigrationArgs(baseline).mode, 'baseline');
  for (const args of [
    ['--baseline-through', '027_last.sql'],
    ['--confirm-database', 'synthetic'],
    ['--plan', '--plan'],
    ['--plan', ...baseline],
    ['--baseline-through'],
    [
      '--baseline-through',
      '../027_last.sql',
      '--confirm-database',
      'synthetic',
      '--baseline-reference',
      'review-123'
    ],
    ['--secret-private-value']
  ])
    assert.throws(() => parseMigrationArgs(args));
  assert.throws(
    () =>
      buildMigrationSql(readMigrations('apps/funding-api/migrations'), {
        database: 'synthetic',
        mode: 'baseline',
        baselineThrough: '999_absent.sql',
        baselineReference: 'review-123'
      }),
    /boundary/
  );
});

test('migration diagnostics never relay SQL row values or provider errors', () => {
  const raw =
    "ERROR: private-row-canary password=private-secret-canary\nCONTEXT: INSERT INTO private_table VALUES ('private-row-canary')";
  assert.doesNotMatch(migrationFailure(raw), /private-row|private-secret/);
  assert.match(
    migrationFailure('ERROR: OG7_MIGRATIONS_HISTORY_CHANGED'),
    /checksum/
  );
  assert.deepEqual(migrationReport(raw), []);
  assert.deepEqual(
    migrationReport(
      'NOTICE:  OG7_MIGRATION applied 001_first.sql\n' +
        raw +
        '\nNOTICE: OG7_MIGRATION pending ../../private.sql'
    ),
    ['applied 001_first.sql']
  );
});

test('both entrypoints expose the same help and reject invalid input before Docker', (t) => {
  const root = directory(t);
  const emptyEnv = join(root, 'empty.env');
  writeFileSync(emptyEnv, '');
  writeFileSync(
    join(root, 'node'),
    '#!/usr/bin/env bash\nexec "$OPENG7_TEST_NODE" "$@"\n',
    { mode: 0o755 }
  );
  const env = {
    ...process.env,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
    OPENG7_TEST_NODE: process.execPath.replaceAll('\\', '/'),
    OPENG7_TEST_NODE_DIR: root
      .replaceAll('\\', '/')
      .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`),
    OPENG7_E2E_ENV_FILE: emptyEnv,
    POSTGRES_DB: 'synthetic_target'
  };
  const bash =
    process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const nodeHelp = spawnSync(
    process.execPath,
    ['scripts/db-migrate.mjs', '--help'],
    { encoding: 'utf8', env }
  );
  assert.equal(nodeHelp.status, 0, nodeHelp.stderr);
  // Execute normalized shell source while keeping its repository root resolution.
  const shell = readFileSync('scripts/db-migrate.sh', 'utf8').replaceAll(
    '\r\n',
    '\n'
  );
  const bashHelp = spawnSync(
    bash,
    [
      '-c',
      'export PATH="$OPENG7_TEST_NODE_DIR:$PATH"\n' +
        shell.replace('"${BASH_SOURCE[0]}"', 'scripts/db-migrate.sh'),
      'migration-test',
      '--help'
    ],
    { encoding: 'utf8', env }
  );
  assert.equal(bashHelp.status, 0, bashHelp.stderr);
  assert.equal(bashHelp.stdout, nodeHelp.stdout);
  const mismatch = spawnSync(
    process.execPath,
    [
      'scripts/db-migrate.mjs',
      '--baseline-through',
      '027_create_contribution_activity.sql',
      '--confirm-database',
      'wrong_target',
      '--baseline-reference',
      'review-123'
    ],
    { encoding: 'utf8', env }
  );
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /does not match POSTGRES_DB/);
  const invalid = spawnSync(
    process.execPath,
    ['scripts/db-migrate.mjs', '--private-canary'],
    { encoding: 'utf8', env }
  );
  assert.equal(invalid.status, 1);
  assert.doesNotMatch(invalid.stderr, /private-canary/);
});
