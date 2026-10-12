import assert from 'node:assert/strict';
import test from 'node:test';
import { publicationReliability } from '../../dist/apps/funding-api/src/publication-reliability.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test('reliability spacing preserves strict millisecond boundaries in both directions and active holds', async (t) => {
  const { pool, stop } = await startDisposablePostgres();
  t.after(stop);
  await pool.query(
    `INSERT INTO publication_account_leases(provider,account_id,mode) VALUES('facebook','synthetic-spacing','live')`
  );
  const ids = (
    await pool.query(`INSERT INTO publication_deliveries(feed_id,kind,scheduled_at,message,status,account_id,mode)
    VALUES('openg7:facebook','news','2030-01-01T12:00:00Z','Synthetic boundary','approved','synthetic-spacing','live'),
          ('openg20:facebook','news','2030-01-01T12:01:00Z','Synthetic boundary','uncertain','synthetic-spacing','live') RETURNING id`)
  ).rows.map((r) => r.id);
  await pool.query(
    `INSERT INTO publication_account_reservations(delivery_id,provider,account_id,mode,scheduled_at,approval_version,status)
    SELECT id,'facebook','synthetic-spacing','live',scheduled_at,1,CASE WHEN status='uncertain' THEN 'uncertain' ELSE 'reserved' END
    FROM publication_deliveries WHERE id=ANY($1::uuid[])`,
    [ids]
  );
  for (const [milliseconds, expected] of [
    [59999, 1],
    [60000, 0],
    [60001, 0],
    [-59999, 1],
    [-60000, 0],
    [-60001, 0]
  ]) {
    await pool.query(
      `UPDATE publication_account_reservations SET scheduled_at='2030-01-01T12:00:00Z'::timestamptz+$2*INTERVAL '1 millisecond' WHERE delivery_id=$1`,
      [ids[1], milliseconds]
    );
    assert.equal(
      (await publicationReliability(pool)).capacity.accountConflicts,
      expected,
      String(milliseconds)
    );
  }
  await pool.query(
    `UPDATE publication_account_reservations SET scheduled_at='2030-01-01T12:00:00Z'::timestamptz+INTERVAL '59 seconds',status='released' WHERE delivery_id=$1`,
    [ids[1]]
  );
  assert.equal(
    (await publicationReliability(pool)).capacity.accountConflicts,
    0
  );
});
