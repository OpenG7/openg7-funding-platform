import assert from 'node:assert/strict';
import test from 'node:test';

import * as facade from '../dist/apps/funding-api/src/fund-admin.repository.js';
import * as auditOwner from '../dist/apps/funding-api/src/fund-admin-audit.repository.js';
import * as expensesOwner from '../dist/apps/funding-api/src/fund-expenses.repository.js';

const draft = {
  projectName: 'Synthetic allocation',
  publicDescription: 'Synthetic description',
  expectedOutcome: 'Synthetic outcome',
  progressStatus: 'planned',
  amountAllocated: 19.99,
  currency: 'CAD',
  status: 'draft'
};
const actor = { actor: 'synthetic-owner', action: 'achievement.created' };
const presence = { has_fund_allocations: true, has_audit_log: true };
const allocation = {
  id: '7',
  project_name: draft.projectName,
  public_description: draft.publicDescription,
  expected_outcome: draft.expectedOutcome,
  progress_status: draft.progressStatus,
  proof_url: null,
  proof_source: null,
  proof_published_at: null,
  amount_allocated: '1999',
  currency: 'cad',
  status: 'draft',
  published_at: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z'
};

test('administration persistence facade preserves function, class and status-set identity', () => {
  for (const name of [
    'allowedAdminExpenseStatuses',
    'AdminExpenseValidationError',
    'listAdminExpenses',
    'createAdminExpense',
    'updateAdminExpense'
  ]) {
    assert.equal(facade[name], expensesOwner[name], name);
  }
  for (const name of [
    'insertAdminAuditLog',
    'findSponsorshipRequestAudit',
    'listAdminAuditLog'
  ]) {
    assert.equal(facade[name], auditOwner[name], name);
  }
});

test('administration persistence keeps database-free results and validation errors', async () => {
  assert.deepEqual(await facade.createAdminExpense(null, draft, actor), {
    updated: false,
    expense: null
  });
  const expenses = await facade.listAdminExpenses(null);
  assert.equal(expenses.data_source, 'database');
  assert.deepEqual(expenses.expenses, []);
  assert.equal(expenses.summary.currency, 'CAD');
  assert.equal(expenses.summary.total_allocated, 0);
  assert.ok(Number.isFinite(Date.parse(expenses.last_updated_at)));
  assert.equal(
    await facade.insertAdminAuditLog(null, {
      ...actor,
      entityType: 'expense',
      entityId: '7',
      summary: null
    }),
    false
  );
  assert.deepEqual((await facade.listAdminAuditLog(null)).entries, []);
  await assert.rejects(
    facade.createAdminExpense(
      null,
      { ...draft, amountAllocated: 19.999 },
      actor
    ),
    (error) =>
      error instanceof facade.AdminExpenseValidationError &&
      error.code === 'invalid_amount'
  );
  await assert.rejects(
    facade.createAdminExpense(null, { ...draft, status: 'published' }, actor),
    (error) =>
      error instanceof facade.AdminExpenseValidationError &&
      error.code === 'confirmation_required'
  );
});

const expenseTransaction = ({
  auditAvailable = true,
  auditRowCount = 1
} = {}) => {
  const events = [];
  let inTransaction = false;
  const client = {
    async query(command, values = []) {
      const sql = command.replace(/\s+/g, ' ').trim();
      events.push({ sql, values });
      if (sql === 'BEGIN') {
        inTransaction = true;
        return { rows: [] };
      }
      assert.equal(inTransaction, true);
      if (sql === 'COMMIT' || sql === 'ROLLBACK') {
        inTransaction = false;
        return { rows: [] };
      }
      if (sql.includes('to_regclass')) {
        return { rows: [{ ...presence, has_audit_log: auditAvailable }] };
      }
      if (sql.startsWith('INSERT INTO fund_allocations')) {
        assert.equal(values[7], 1999);
        assert.equal(values[8], 'cad');
        return { rows: [{ id: allocation.id }] };
      }
      if (sql.includes('FROM fund_allocations')) {
        return { rows: [allocation] };
      }
      if (sql.startsWith('INSERT INTO admin_audit_log')) {
        assert.deepEqual(values.slice(0, 4), [
          actor.actor,
          actor.action,
          'expense',
          allocation.id
        ]);
        const metadata = JSON.parse(values[5]);
        assert.equal(metadata.amountAllocated, 19.99);
        assert.equal(metadata.expectedOutcome, draft.expectedOutcome);
        return { rows: [], rowCount: auditRowCount };
      }
      assert.fail(`Unexpected transaction query: ${sql}`);
    },
    release() {
      assert.equal(inTransaction, false);
      events.push({ sql: 'release' });
    }
  };
  return {
    events,
    pool: {
      async query(command) {
        assert.equal(inTransaction, false, 'writes and audit use the client');
        assert.ok(command.includes('to_regclass'));
        return { rows: [presence] };
      },
      async connect() {
        return client;
      }
    }
  };
};

test('expense owner keeps allocation, reread and audit on the acquired transaction client', async () => {
  const { pool, events } = expenseTransaction();
  const result = await facade.createAdminExpense(pool, draft, actor);
  assert.equal(result.updated, true);
  assert.equal(result.expense.amount_allocated, 19.99);
  assert.equal(result.expense.currency, 'CAD');
  assert.ok(
    events.some(({ sql }) => sql.startsWith('INSERT INTO admin_audit_log'))
  );
  assert.deepEqual(
    events
      .filter(({ sql }) =>
        ['BEGIN', 'COMMIT', 'ROLLBACK', 'release'].includes(sql)
      )
      .map(({ sql }) => sql),
    ['BEGIN', 'COMMIT', 'release']
  );
});

for (const options of [{ auditAvailable: false }, { auditRowCount: 0 }]) {
  test(`expense owner rolls back when audit cannot be recorded: ${JSON.stringify(options)}`, async () => {
    const { pool, events } = expenseTransaction(options);
    await assert.rejects(
      facade.createAdminExpense(pool, draft, actor),
      /Achievement audit could not be recorded/
    );
    assert.deepEqual(
      events
        .filter(({ sql }) =>
          ['BEGIN', 'COMMIT', 'ROLLBACK', 'release'].includes(sql)
        )
        .map(({ sql }) => sql),
      ['BEGIN', 'ROLLBACK', 'release']
    );
  });
}
