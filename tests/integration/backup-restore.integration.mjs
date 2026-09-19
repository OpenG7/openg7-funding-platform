import assert from 'node:assert/strict';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { listPublicBuilders } from '../../dist/apps/funding-api/src/fund-transparency.repository.js';

test(
  'a PostgreSQL dump restores schema, consent and exact contribution amounts into a separate disposable database',
  { timeout: 120000 },
  async (t) => {
    const source = await startDisposablePostgres();
    t.after(source.stop);
    const target = await startDisposablePostgres({ migrate: false });
    t.after(target.stop);
    await source.pool
      .query(`INSERT INTO fund_contributions (contribution_type,amount_cents,currency,status,public_display_consent,public_name)
    VALUES ('personal_support',12345,'cad','paid',true,'Restore fixture'),('personal_support',6789,'cad','paid',false,'Private fixture')`);
    const before = await listPublicBuilders(source.pool);
    const dump = await source.dumpDatabase();
    assert.ok(dump.includes('fund_contributions'));
    await target.restoreDatabase(dump);
    assert.deepEqual(await listPublicBuilders(target.pool), before);
    const query =
      'SELECT id, amount_cents, currency, status, public_display_consent FROM fund_contributions ORDER BY id';
    assert.deepEqual(
      (await target.pool.query(query)).rows,
      (await source.pool.query(query)).rows
    );
    await assert.rejects(
      target.restoreDatabase(dump),
      /empty disposable database/
    );
  }
);
