import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { exportAdminContributions } from '../../dist/apps/funding-api/src/admin-contributions-export.service.js';
import { listAdminContributions } from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const seed = async (pool) => {
  const { rows } = await pool.query(`INSERT INTO fund_contributions
    (contribution_type,amount_cents,currency,status,public_name,email_private,sponsor_review_note,public_display_consent)
    VALUES ('personal_support',4250,'cad','paid','=1+1','private-export@example.test','PRIVATE_NOTE_NEVER_EXPORT',false),
    ('personal_support',9900,'usd','paid','Other selection','other-export@example.test',NULL,true)
    RETURNING id,updated_at::text AS "expectedVersion"`);
  return {
    confirmation: 'export_private_contributions',
    contributions: [rows[0]],
    other: rows[1]
  };
};

test(
  'private export reads precisely the confirmed rows beyond the recent-list window and audits without private data',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const { other, ...input } = await seed(db.pool);
    // More than the UI's 250-row window: the explicit selection must not silently
    // substitute recent records or truncate an older dossier.
    await db.pool
      .query(`INSERT INTO fund_contributions (contribution_type,amount_cents,currency,status)
    SELECT 'personal_support',100,'cad','paid' FROM generate_series(1,260)`);
    assert.equal(
      (await listAdminContributions(db.pool)).contributions.length,
      250
    );
    const before = (
      await db.pool.query(
        'SELECT id,amount_cents,currency,status,public_name FROM fund_contributions ORDER BY id'
      )
    ).rows;
    const result = await exportAdminContributions(
      db.pool,
      input,
      'fixture-owner'
    );
    assert.ok(result.csv.includes(input.contributions[0].id));
    assert.ok(result.csv.includes('"\'=1+1"'));
    assert.ok(result.csv.includes('private-export@example.test'));
    assert.ok(!result.csv.includes(other.id));
    assert.ok(!result.csv.includes('PRIVATE_NOTE_NEVER_EXPORT'));
    assert.equal(result.csv.split('\r\n').length, 2);
    const { rows } = await db.pool.query(
      "SELECT actor,metadata FROM admin_audit_log WHERE action='contributions.export'"
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor, 'fixture-owner');
    assert.deepEqual(Object.keys(rows[0].metadata).sort(), [
      'count',
      'requestId',
      'result',
      'scope',
      'selectionHash'
    ]);
    assert.equal(rows[0].metadata.count, 1);
    assert.equal(rows[0].metadata.requestId, result.requestId);
    assert.equal(rows[0].metadata.result, 'generated');
    assert.doesNotMatch(
      JSON.stringify(rows),
      /private-export|PRIVATE_NOTE|=1\+1/
    );
    assert.deepEqual(
      (
        await db.pool.query(
          'SELECT id,amount_cents,currency,status,public_name FROM fund_contributions ORDER BY id'
        )
      ).rows,
      before
    );
  }
);

test(
  'changed or missing records and failed audit never yield a partial private export',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const { other, ...input } = await seed(db.pool);
    assert.ok(other.id);
    await db.pool.query(
      "UPDATE fund_contributions SET updated_at=updated_at+interval '1 microsecond' WHERE id=$1",
      [input.contributions[0].id]
    );
    await assert.rejects(
      exportAdminContributions(db.pool, input, 'fixture-owner'),
      (error) => error.status === 409
    );
    await assert.rejects(
      exportAdminContributions(
        db.pool,
        {
          ...input,
          contributions: [{ ...input.contributions[0], id: randomUUID() }]
        },
        'fixture-owner'
      ),
      (error) => error.status === 409
    );
    const fresh = (await listAdminContributions(db.pool)).contributions.find(
      (row) => row.id === input.contributions[0].id
    );
    input.contributions[0].expectedVersion = fresh.updated_at;
    await db.pool
      .query(`CREATE FUNCTION reject_export_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='contributions.export' THEN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_export_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION reject_export_audit()`);
    await assert.rejects(
      exportAdminContributions(db.pool, input, 'fixture-owner'),
      /SYNTHETIC_AUDIT_FAILURE/
    );
    assert.equal(
      (await db.pool.query('SELECT * FROM admin_audit_log')).rowCount,
      0
    );
    await db.pool.query('DROP TRIGGER reject_export_audit ON admin_audit_log');
    assert.ok(
      (
        await exportAdminContributions(db.pool, input, 'fixture-owner')
      ).csv.includes(fresh.id)
    );
  }
);
