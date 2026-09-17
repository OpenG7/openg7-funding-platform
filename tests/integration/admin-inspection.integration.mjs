import assert from 'node:assert/strict';
import test from 'node:test';

import { getAdminStripeEvent } from '../../dist/apps/funding-api/src/admin-stripe-event.service.js';
import {
  listAdminAuditLog,
  listAdminExpenses
} from '../../dist/apps/funding-api/src/fund-admin.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'admin inspections read minimal Stripe facts and exact audit/expense records in PostgreSQL',
  { timeout: 90000 },
  async () => {
    const { pool, stop } = await startDisposablePostgres();
    try {
      assert.deepEqual(await getAdminStripeEvent(pool, 'evt_missing'), {
        available: true,
        event: null
      });
      await pool.query(`INSERT INTO stripe_events (stripe_event_id, event_type, processing_status, payload)
      VALUES ('evt_inspection', 'charge.updated', 'failed', '{"private":"do-not-expose@example.invalid"}')`);
      const result = await getAdminStripeEvent(pool, 'evt_inspection');
      assert.equal(result.event.error, 'processing_failed');
      assert.equal(result.event.status, 'failed');
      assert.deepEqual(Object.keys(result.event).sort(), [
        'error',
        'id',
        'processedAt',
        'receivedAt',
        'status',
        'type'
      ]);
      assert.ok(!JSON.stringify(result).includes('do-not-expose'));
      assert.equal(
        (
          await pool.query(
            "SELECT processing_status FROM stripe_events WHERE stripe_event_id='evt_inspection'"
          )
        ).rows[0].processing_status,
        'failed'
      );

      const auditId = (
        await pool.query(`INSERT INTO admin_audit_log (actor, action, entity_type, entity_id, summary, created_at)
      VALUES ('test','fixture.old','expense','old','Old entry','2020-01-01') RETURNING id`)
      ).rows[0].id;
      await pool.query(`INSERT INTO admin_audit_log (actor, action, entity_type, entity_id, summary)
      SELECT 'test','fixture.new','expense',i::text,'Recent entry' FROM generate_series(1,101) i`);
      assert.ok(
        !(await listAdminAuditLog(pool)).entries.some(
          (entry) => entry.id === auditId
        )
      );
      assert.deepEqual(
        (await listAdminAuditLog(pool, auditId)).entries.map(
          (entry) => entry.id
        ),
        [auditId]
      );

      const expenseId = (
        await pool.query(`INSERT INTO fund_allocations (project_name, public_description, amount_allocated, currency, status, created_at, updated_at)
      VALUES ('Old proof','Fixture', 10050,'cad','draft','2020-01-01','2020-01-01') RETURNING id`)
      ).rows[0].id;
      await pool.query(`INSERT INTO fund_allocations (project_name, public_description, amount_allocated, currency, status)
      SELECT 'New proof','Fixture',10,'cad','draft' FROM generate_series(1,251)`);
      assert.ok(
        !(await listAdminExpenses(pool)).expenses.some(
          (expense) => expense.id === expenseId
        )
      );
      assert.deepEqual(
        (await listAdminExpenses(pool, expenseId)).expenses.map(
          (expense) => expense.id
        ),
        [expenseId]
      );
      for (const [read, field] of [
        [listAdminAuditLog, 'entries'],
        [listAdminExpenses, 'expenses']
      ]) {
        assert.deepEqual(
          (
            await read(
              pool,
              field === 'expenses'
                ? '99999'
                : '10000000-0000-4000-8000-000000000799'
            )
          )[field],
          []
        );
      }
    } finally {
      await stop();
    }
  }
);
