import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findSponsorshipRequestAudit,
  insertAdminAuditLog
} from '../../dist/apps/funding-api/src/fund-admin.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'extracted audit helpers retain the caller transaction and its rollback/retry boundary',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    let client;
    t.after(async () => {
      client?.release();
      await stop();
    });
    client = await pool.connect();
    const lookup = {
      contributionId: '10000000-0000-4000-8000-000000000001',
      action: 'synthetic.sponsorship.request',
      requestId: '10000000-0000-4000-8000-000000000002'
    };
    const input = {
      actor: 'synthetic-owner',
      action: lookup.action,
      entityType: 'sponsorship',
      entityId: lookup.contributionId,
      summary: 'Synthetic receipt',
      metadata: { requestId: lookup.requestId, result: 'prepared' }
    };

    try {
      await client.query('BEGIN');
      assert.equal(await insertAdminAuditLog(client, input), true);
      const receipt = await findSponsorshipRequestAudit(client, lookup);
      assert.equal(receipt.actor, input.actor);
      assert.deepEqual(receipt.metadata, input.metadata);
      assert.ok(receipt.id);
      assert.ok(Number.isFinite(Date.parse(receipt.recordedAt)));
      assert.equal(
        (await pool.query('SELECT count(*)::int AS count FROM admin_audit_log'))
          .rows[0].count,
        0,
        'an extracted helper must not commit the caller transaction'
      );
      await client.query('ROLLBACK');
      assert.equal(await findSponsorshipRequestAudit(client, lookup), null);

      await client.query('BEGIN');
      assert.equal(await insertAdminAuditLog(client, input), true);
      assert.equal(
        (await findSponsorshipRequestAudit(client, lookup)).actor,
        input.actor
      );
      await client.query('COMMIT');
      assert.equal(
        (await pool.query('SELECT count(*)::int AS count FROM admin_audit_log'))
          .rows[0].count,
        1
      );
    } finally {
      await client.query('ROLLBACK');
    }
  }
);
