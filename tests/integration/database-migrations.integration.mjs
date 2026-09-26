import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildMigrationSql,
  readMigrations
} from '../../scripts/lib/database-migrations.mjs';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const migrations = readMigrations('apps/funding-api/migrations');
const synthetic = (version, sql) => ({
  version,
  name: `${String(version).padStart(3, '0')}_synthetic.sql`,
  sql,
  sha256: createHash('sha256').update(sql).digest('hex')
});

async function fixture(t) {
  const database = await startDisposablePostgres({ migrate: false });
  t.after(database.stop);
  const name = (await database.pool.query('SELECT current_database() AS name'))
    .rows[0].name;
  const run = async (files = migrations, options = {}) => {
    const client = await database.pool.connect();
    const notices = [];
    const onNotice = (notice) => notices.push(notice.message);
    client.on('notice', onNotice);
    try {
      await client.query(
        buildMigrationSql(files, { database: name, ...options })
      );
      return notices;
    } finally {
      await client.query('ROLLBACK');
      client.off('notice', onNotice);
      client.release();
    }
  };
  return { ...database, name, run };
}

test(
  'migration plan leaves an empty database untouched; all application migrations then apply exactly once',
  { timeout: 60_000 },
  async (t) => {
    const db = await fixture(t);
    const plan = await db.run(migrations, { mode: 'plan' });
    assert.equal(
      plan.filter((line) => line.startsWith('OG7_MIGRATION pending ')).length,
      migrations.length
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT to_regclass('public.openg7_schema_migrations') AS ledger"
        )
      ).rows[0].ledger,
      null
    );
    await db.run();
    const before = (
      await db.pool.query(
        'SELECT * FROM openg7_schema_migrations ORDER BY version'
      )
    ).rows;
    assert.equal(before.length, migrations.length);
    assert.ok(
      before.every(
        (row) =>
          row.action === 'applied' &&
          row.recorded_by === 'og7_test' &&
          row.recorded_at &&
          row.sha256.length === 64
      )
    );
    // Migration 023 updates existing feed settings; replay must preserve later choices.
    await db.pool.query(
      "UPDATE publication_feeds SET auto_prepare=false, last_prepared_at='2026-09-01T00:00:00Z'"
    );
    const repeated = await db.run();
    assert.equal(
      repeated.filter((line) => line.startsWith('OG7_MIGRATION skipped '))
        .length,
      migrations.length
    );
    assert.deepEqual(
      (
        await db.pool.query(
          'SELECT * FROM openg7_schema_migrations ORDER BY version'
        )
      ).rows,
      before
    );
    assert.ok(
      (
        await db.pool.query(
          'SELECT auto_prepare,last_prepared_at FROM publication_feeds'
        )
      ).rows.every(
        (row) =>
          !row.auto_prepare &&
          row.last_prepared_at.toISOString() === '2026-09-01T00:00:00.000Z'
      )
    );
    await db.run(migrations, { mode: 'plan' });
    assert.deepEqual(
      (
        await db.pool.query(
          'SELECT * FROM openg7_schema_migrations ORDER BY version'
        )
      ).rows,
      before
    );
    const restored = await fixture(t);
    await restored.restoreDatabase(await db.dumpDatabase());
    const afterRestore = await restored.run();
    assert.equal(
      afterRestore.filter((line) => line.startsWith('OG7_MIGRATION skipped '))
        .length,
      migrations.length
    );
    assert.deepEqual(
      (
        await restored.pool.query(
          'SELECT * FROM openg7_schema_migrations ORDER BY version'
        )
      ).rows,
      before
    );
  }
);

test(
  'failed pending batch rolls back its DDL, data and receipts, then can resume',
  { timeout: 60_000 },
  async (t) => {
    const db = await fixture(t);
    const first = synthetic(
      1,
      'CREATE TABLE migration_probe (id integer PRIMARY KEY); INSERT INTO migration_probe VALUES (1);'
    );
    const second = synthetic(
      2,
      'CREATE TABLE migration_partial(id integer); INSERT INTO migration_probe VALUES (2);'
    );
    const broken = synthetic(
      3,
      "DO $$ BEGIN RAISE EXCEPTION 'synthetic-private-row'; END $$;"
    );
    await db.run([first]);
    await assert.rejects(
      db.run([first, second, broken]),
      /synthetic-private-row/
    );
    assert.deepEqual(
      (await db.pool.query('SELECT id FROM migration_probe')).rows,
      [{ id: 1 }]
    );
    assert.equal(
      (await db.pool.query("SELECT to_regclass('migration_partial') AS value"))
        .rows[0].value,
      null
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT count(*)::int AS count FROM openg7_schema_migrations'
        )
      ).rows[0].count,
      1
    );
    const fixed = synthetic(3, 'INSERT INTO migration_probe VALUES (3);');
    await db.run([first, second, fixed]);
    assert.deepEqual(
      (await db.pool.query('SELECT id FROM migration_probe ORDER BY id')).rows,
      [{ id: 1 }, { id: 2 }, { id: 3 }]
    );
  }
);

test(
  'concurrent runners serialize and the waiter observes committed history',
  { timeout: 60_000 },
  async (t) => {
    const db = await fixture(t);
    const file = synthetic(
      1,
      'SELECT pg_sleep(0.3); CREATE TABLE migration_once (id integer); INSERT INTO migration_once VALUES (1);'
    );
    const reports = (
      await Promise.all([db.run([file]), db.run([file])])
    ).flat();
    assert.equal(
      reports.filter((line) => line.startsWith('OG7_MIGRATION applied '))
        .length,
      1
    );
    assert.equal(
      reports.filter((line) => line.startsWith('OG7_MIGRATION skipped '))
        .length,
      1
    );
    assert.equal(
      (await db.pool.query('SELECT count(*)::int AS count FROM migration_once'))
        .rows[0].count,
      1
    );
  }
);

test(
  'changed, missing, renamed and out-of-order history is refused before any pending SQL',
  { timeout: 60_000 },
  async (t) => {
    const db = await fixture(t);
    const first = synthetic(1, 'CREATE TABLE migration_history(id integer);');
    const third = synthetic(3, 'INSERT INTO migration_history VALUES (3);');
    const fourth = synthetic(4, 'INSERT INTO migration_history VALUES (4);');
    await db.run([first, third]);
    await assert.rejects(
      db.run([synthetic(1, first.sql + '\n-- changed'), third, fourth]),
      /HISTORY_CHANGED/
    );
    await assert.rejects(db.run([third, fourth]), /HISTORY_MISSING/);
    await assert.rejects(
      db.run([{ ...first, name: '001_renamed.sql' }, third, fourth]),
      /HISTORY_MISSING/
    );
    await assert.rejects(
      db.run([first, synthetic(2, 'SELECT 1;'), third, fourth]),
      /OUT_OF_ORDER/
    );
    await assert.rejects(
      db.run([third, fourth], { mode: 'plan' }),
      /HISTORY_MISSING/
    );
    assert.deepEqual(
      (await db.pool.query('SELECT id FROM migration_history')).rows,
      [{ id: 3 }]
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT count(*)::int AS count FROM openg7_schema_migrations'
        )
      ).rows[0].count,
      2
    );
  }
);

test(
  'legacy schema requires explicit reviewed adoption; adoption records only the selected prefix',
  { timeout: 60_000 },
  async (t) => {
    const db = await fixture(t);
    const legacy = migrations.slice(0, -1);
    for (const file of legacy) await db.pool.query(file.sql);
    await db.pool.query('UPDATE publication_feeds SET auto_prepare=false');
    await assert.rejects(db.run(), /BASELINE_REQUIRED/);
    await assert.rejects(
      db.run(migrations, { mode: 'plan' }),
      /BASELINE_REQUIRED/
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT to_regclass('public.openg7_schema_migrations') AS value"
        )
      ).rows[0].value,
      null
    );
    const options = {
      mode: 'baseline',
      baselineThrough: legacy.at(-1).name,
      baselineReference: 'synthetic-review-001'
    };
    await db.run(migrations, options);
    assert.equal(
      (
        await db.pool.query(
          "SELECT to_regclass('contribution_activity') AS value"
        )
      ).rows[0].value,
      null
    );
    const history = (
      await db.pool.query('SELECT * FROM openg7_schema_migrations')
    ).rows;
    assert.equal(history.length, legacy.length);
    assert.ok(
      history.every(
        (row) =>
          row.action === 'baseline' &&
          row.baseline_reference === 'synthetic-review-001'
      )
    );
    await assert.rejects(db.run(migrations, options), /ALREADY_TRACKED/);
    const plan = await db.run(migrations, { mode: 'plan' });
    assert.ok(plan.includes(`OG7_MIGRATION pending ${migrations.at(-1).name}`));
    await db.run();
    assert.ok(
      (
        await db.pool.query('SELECT auto_prepare FROM publication_feeds')
      ).rows.every((row) => !row.auto_prepare)
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT action FROM openg7_schema_migrations WHERE version=27'
        )
      ).rows[0].action,
      'applied'
    );
  }
);

test(
  'baseline of an empty database and mismatched target are refused',
  { timeout: 60_000 },
  async (t) => {
    const db = await fixture(t);
    await assert.rejects(
      db.run(migrations, {
        mode: 'baseline',
        baselineThrough: migrations.at(-1).name,
        baselineReference: 'synthetic-review-002'
      }),
      /BASELINE_EMPTY/
    );
    await assert.rejects(
      db.run(migrations, { database: 'wrong_database' }),
      /TARGET_MISMATCH/
    );
    assert.equal(
      (
        await db.pool.query(
          "SELECT to_regclass('public.openg7_schema_migrations') AS value"
        )
      ).rows[0].value,
      null
    );
  }
);

test(
  'SQL quoting is preserved and migration transaction control cannot escape atomic execution',
  { timeout: 60_000 },
  async (t) => {
    const db = await fixture(t);
    const value = "apostrophe ' and \\ and $og7_migrations$";
    const first = synthetic(
      1,
      `CREATE TABLE migration_quotes(value text); INSERT INTO migration_quotes VALUES ($quoted$${value}$quoted$);`
    );
    await db.run([first]);
    assert.equal(
      (await db.pool.query('SELECT value FROM migration_quotes')).rows[0].value,
      value
    );
    await assert.rejects(
      db.run([
        first,
        synthetic(
          2,
          "INSERT INTO migration_quotes VALUES ('uncommitted'); COMMIT;"
        )
      ])
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT count(*)::int AS count FROM migration_quotes'
        )
      ).rows[0].count,
      1
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT count(*)::int AS count FROM openg7_schema_migrations'
        )
      ).rows[0].count,
      1
    );
  }
);

test(
  'connection loss rolls back the pending batch and releases the migration lock',
  { timeout: 60_000 },
  async (t) => {
    const db = await fixture(t);
    const first = synthetic(
      1,
      'CREATE TABLE migration_interruption(id integer);'
    );
    const pending = synthetic(
      2,
      'INSERT INTO migration_interruption VALUES (2); SELECT pg_sleep(1);'
    );
    await db.run([first]);
    const client = await db.pool.connect();
    client.on('error', () => {});
    try {
      const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0]
        .pid;
      const interrupted = client
        .query(buildMigrationSql([first, pending], { database: db.name }))
        .then(
          () => null,
          (error) => error
        );
      const deadline = Date.now() + 5000;
      while (true) {
        const activity = (
          await db.pool.query(
            'SELECT wait_event FROM pg_stat_activity WHERE pid=$1',
            [pid]
          )
        ).rows[0];
        if (activity?.wait_event === 'PgSleep') break;
        assert.ok(
          Date.now() < deadline,
          'pending migration did not reach its interruptible operation'
        );
        await new Promise((done) => setTimeout(done, 20));
      }
      await db.pool.query('SELECT pg_terminate_backend($1)', [pid]);
      assert.ok(await interrupted);
    } finally {
      client.release(true);
    }
    assert.equal(
      (
        await db.pool.query(
          'SELECT count(*)::int AS count FROM migration_interruption'
        )
      ).rows[0].count,
      0
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT count(*)::int AS count FROM openg7_schema_migrations'
        )
      ).rows[0].count,
      1
    );
    await db.run([first, pending]);
    assert.equal(
      (
        await db.pool.query(
          'SELECT count(*)::int AS count FROM migration_interruption'
        )
      ).rows[0].count,
      1
    );
  }
);
