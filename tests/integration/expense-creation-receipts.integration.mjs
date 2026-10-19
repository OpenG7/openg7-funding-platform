import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import pg from 'pg';

import {
  createAdminExpense,
  updateAdminExpense
} from '../../dist/apps/funding-api/src/fund-expenses.repository.js';
import { readAdminExpenseCreateReceipt } from '../../dist/apps/funding-api/src/expense-creation-receipts.repository.js';
import { assertProductionDatabasePrivileges } from '../../dist/apps/funding-api/src/database-runtime-security.js';
import { buildRuntimeRoleSql } from '../../scripts/lib/database-runtime-role.mjs';
import {
  startDisposablePostgres,
  observePostgresTransactions
} from './support/disposable-postgres.mjs';

const draft = () => ({
  requestId: randomUUID(),
  projectName: 'Synthetic expense receipt',
  publicDescription: 'Synthetic public description',
  expectedOutcome: 'Synthetic outcome',
  progressStatus: 'planned',
  amountAllocated: 19.99,
  currency: 'CAD',
  status: 'draft'
});

test(
  'expense receipt migration preserves an existing allocation without inventing a receipt',
  { timeout: 90000 },
  async (t) => {
    const db = await startDisposablePostgres({ migrate: false });
    t.after(db.stop);
    const directory = new URL(
      '../../apps/funding-api/migrations/',
      import.meta.url
    );
    const target = '063_create_expense_creation_receipts.sql';
    for (const migration of (await readdir(directory))
      .filter((name) => /^\d+_.+\.sql$/.test(name) && name !== target)
      .sort()) {
      await db.pool.query(
        await readFile(new URL(migration, directory), 'utf8')
      );
    }
    await db.pool.query(`INSERT INTO fund_allocations
    (project_name,public_description,expected_outcome,progress_status,amount_allocated,currency,status)
    VALUES ('Synthetic legacy allocation','Synthetic legacy description','Synthetic outcome','planned',1999,'cad','private')`);
    const before = (
      await db.pool.query('SELECT * FROM fund_allocations ORDER BY id')
    ).rows;
    await db.pool.query(await readFile(new URL(target, directory), 'utf8'));
    assert.deepEqual(
      (await db.pool.query('SELECT * FROM fund_allocations ORDER BY id')).rows,
      before
    );
    assert.equal(
      (
        await db.pool.query(
          'SELECT count(*)::int AS count FROM expense_creation_receipts'
        )
      ).rows[0].count,
      0
    );
    const input = draft();
    const created = await createAdminExpense(db.pool, input, audit);
    assert.notEqual(created.expense.id, before[0].id);
    assert.equal(
      (
        await readAdminExpenseCreateReceipt(
          db.pool,
          input.requestId,
          audit.actor
        )
      ).expenseId,
      created.expense.id
    );
  }
);
const audit = {
  actor: 'synthetic-expense-owner',
  action: 'achievement.created'
};

test(
  'expense creation receipts: durable idempotency, conflict, atomic audit and pure actor-bound reads',
  { timeout: 90000 },
  async (t) => {
    const db = await startDisposablePostgres();
    let runtime;
    t.after(async () => {
      await runtime?.end();
      await db.stop();
    });
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          [
            'fund_allocations',
            'admin_audit_log',
            'expense_creation_receipts'
          ].map(async (table) => [
            table,
            (
              await db.pool.query(
                `SELECT * FROM ${table} ORDER BY ${table === 'expense_creation_receipts' ? 'request_id' : 'id'}`
              )
            ).rows
          ])
        )
      );
    t.beforeEach(() =>
      db.pool.query('TRUNCATE fund_allocations, admin_audit_log CASCADE')
    );

    await t.test(
      'lost-response command repeated concurrently makes one expense, one receipt and one audit',
      async () => {
        const input = draft();
        const before = await snapshot();
        assert.deepEqual(
          await readAdminExpenseCreateReceipt(
            db.pool,
            input.requestId,
            audit.actor
          ),
          { requestId: input.requestId, found: false }
        );
        assert.deepEqual(await snapshot(), before);
        const results = await Promise.all(
          Array.from({ length: 6 }, () =>
            createAdminExpense(db.pool, input, audit)
          )
        );
        for (const result of results) assert.deepEqual(result, results[0]);
        assert.deepEqual(
          await createAdminExpense(
            db.pool,
            { ...input, requestId: input.requestId.toUpperCase() },
            audit
          ),
          results[0]
        );
        const accepted = await snapshot();
        assert.equal(accepted.fund_allocations.length, 1);
        assert.equal(accepted.fund_allocations[0].amount_allocated, '1999');
        assert.equal(accepted.admin_audit_log.length, 1);
        assert.equal(
          accepted.admin_audit_log[0].metadata.requestId,
          input.requestId
        );
        assert.equal(accepted.expense_creation_receipts.length, 1);
        const receipt = await readAdminExpenseCreateReceipt(
          db.pool,
          input.requestId.toUpperCase(),
          audit.actor
        );
        assert.deepEqual(Object.keys(receipt).sort(), [
          'acceptedAt',
          'expenseId',
          'found',
          'requestId'
        ]);
        assert.equal(receipt.expenseId, results[0].expense.id);
        assert.equal(receipt.found, true);
        assert.equal(
          receipt.acceptedAt,
          new Date(receipt.acceptedAt).toISOString()
        );
        for (let i = 0; i < 3; i++) {
          assert.deepEqual(
            await readAdminExpenseCreateReceipt(
              db.pool,
              input.requestId,
              'another-owner'
            ),
            { requestId: input.requestId, found: false }
          );
          assert.deepEqual(
            await readAdminExpenseCreateReceipt(
              db.pool,
              input.requestId,
              audit.actor
            ),
            receipt
          );
        }
        assert.deepEqual(await snapshot(), accepted);
      }
    );

    await t.test(
      'UUID is bound to its actor and every accepted field',
      async () => {
        const input = draft();
        await createAdminExpense(db.pool, input, audit);
        const before = await snapshot();
        for (const change of [
          { projectName: 'Other name' },
          { publicDescription: 'Other description' },
          { expectedOutcome: 'Other outcome' },
          { progressStatus: 'delivered' },
          { proofUrl: 'https://example.test/proof' },
          { proofSource: 'Other source' },
          { proofPublishedAt: '2026-10-01T12:00:00Z' },
          { amountAllocated: 20 },
          { status: 'private' },
          { publishedAt: '2026-10-01T12:00:00Z' },
          { confirmation: 'changed' }
        ]) {
          await assert.rejects(
            createAdminExpense(db.pool, { ...input, ...change }, audit),
            { code: 'request_conflict' }
          );
        }
        await assert.rejects(
          createAdminExpense(db.pool, input, {
            ...audit,
            actor: 'another-owner'
          }),
          { code: 'request_conflict' }
        );
        assert.deepEqual(await snapshot(), before);
        const conflictingId = randomUUID();
        const competing = await Promise.allSettled([
          createAdminExpense(
            db.pool,
            { ...input, requestId: conflictingId },
            audit
          ),
          createAdminExpense(
            db.pool,
            { ...input, requestId: conflictingId, amountAllocated: 25 },
            audit
          )
        ]);
        assert.equal(
          competing.filter((result) => result.status === 'fulfilled').length,
          1
        );
        assert.equal(
          competing.find((result) => result.status === 'rejected').reason.code,
          'request_conflict'
        );
        assert.equal((await snapshot()).fund_allocations.length, 2);
      }
    );

    await t.test(
      'replay keeps the original response after expense edits, with no second mutation or audit',
      async () => {
        const input = draft();
        const original = await createAdminExpense(db.pool, input, audit);
        await updateAdminExpense(
          db.pool,
          {
            expenseId: original.expense.id,
            expectedVersion: original.expense.updated_at,
            projectName: 'Renamed expense',
            amountAllocated: 32.5
          },
          { ...audit, action: 'achievement.updated' }
        );
        const before = await snapshot();
        assert.deepEqual(
          await createAdminExpense(db.pool, input, audit),
          original
        );
        assert.equal(
          (
            await readAdminExpenseCreateReceipt(
              db.pool,
              input.requestId,
              audit.actor
            )
          ).expenseId,
          original.expense.id
        );
        assert.deepEqual(await snapshot(), before);
      }
    );

    await t.test(
      'receipt insert failure rolls back allocation and audit; the exact UUID can be retried safely',
      async () => {
        const input = draft();
        const before = await snapshot();
        await db.pool
          .query(`CREATE FUNCTION reject_expense_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt insert failure'; END $$;
      CREATE TRIGGER reject_expense_receipt BEFORE INSERT ON expense_creation_receipts FOR EACH ROW EXECUTE FUNCTION reject_expense_receipt()`);
        const observed = observePostgresTransactions(db.pool);
        try {
          await assert.rejects(
            createAdminExpense(observed.pool, input, audit),
            /synthetic receipt insert failure/
          );
          assert.equal(observed.openTransactions, 0);
          assert.deepEqual(await snapshot(), before);
        } finally {
          await db.pool.query(
            'DROP TRIGGER reject_expense_receipt ON expense_creation_receipts; DROP FUNCTION reject_expense_receipt()'
          );
        }
        assert.equal(
          (await createAdminExpense(db.pool, input, audit)).updated,
          true
        );
        const second = draft();
        await db.pool
          .query(`CREATE FUNCTION reject_expense_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$;
      CREATE TRIGGER reject_expense_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION reject_expense_audit()`);
        const accepted = await snapshot();
        try {
          await assert.rejects(
            createAdminExpense(observed.pool, second, audit),
            /synthetic audit failure/
          );
          assert.equal(observed.openTransactions, 0);
          assert.deepEqual(await snapshot(), accepted);
        } finally {
          await db.pool.query(
            'DROP TRIGGER reject_expense_audit ON admin_audit_log; DROP FUNCTION reject_expense_audit()'
          );
        }
      }
    );

    await t.test(
      'dedicated runtime role can create/read but cannot alter receipts; unsafe grants fail startup',
      async () => {
        const password = 'synthetic-runtime-expense-password-only-for-tests';
        const database = (
          await db.pool.query('SELECT current_database() AS name')
        ).rows[0].name;
        const config = { role: 'expense_receipt_runtime', database, password };
        await db.pool.query(buildRuntimeRoleSql(config, { create: true }));
        runtime = new pg.Pool({
          ...db.pool.options,
          user: config.role,
          password
        });
        await assertProductionDatabasePrivileges(runtime, true);
        const input = draft();
        const created = await createAdminExpense(runtime, input, audit);
        assert.equal(
          (
            await readAdminExpenseCreateReceipt(
              runtime,
              input.requestId,
              audit.actor
            )
          ).expenseId,
          created.expense.id
        );
        for (const sql of [
          'UPDATE expense_creation_receipts SET actor=actor',
          'DELETE FROM expense_creation_receipts',
          'TRUNCATE expense_creation_receipts'
        ]) {
          await assert.rejects(runtime.query(sql), { code: '42501' });
        }
        await db.pool.query(
          'GRANT UPDATE (actor) ON expense_creation_receipts TO expense_receipt_runtime'
        );
        await assert.rejects(
          assertProductionDatabasePrivileges(runtime, true),
          /DATABASE_RUNTIME_PRIVILEGES_UNSAFE/
        );
        await db.pool.query(buildRuntimeRoleSql(config));
        await assertProductionDatabasePrivileges(runtime, true);
        assert.equal(
          (await createAdminExpense(runtime, input, audit)).expense.id,
          created.expense.id
        );
      }
    );
  }
);
