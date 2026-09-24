import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAdminExpense,
  updateAdminExpense,
  listAdminExpenses
} from '../../dist/apps/funding-api/src/fund-admin.repository.js';
import { getPublicTransparencySummary } from '../../dist/apps/funding-api/src/fund-transparency.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const draft = {
  projectName: 'Atelier de démonstration',
  publicDescription: 'Allocation locale synthétique',
  expectedOutcome: 'Livrer une documentation publique',
  progressStatus: 'planned',
  amountAllocated: 42.5,
  currency: 'CAD',
  status: 'draft'
};
const actor = { actor: 'allocation-test-owner', action: 'achievement.created' };

test(
  'allocations: public lifecycle, confirmation, precision, concurrency and atomic audit',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    t.beforeEach(() =>
      pool.query('TRUNCATE fund_allocations, admin_audit_log CASCADE')
    );
    const create = (changes = {}) =>
      createAdminExpense(pool, { ...draft, ...changes }, actor);
    const update = (expense, changes = {}) =>
      updateAdminExpense(
        pool,
        {
          expenseId: expense.id,
          expectedVersion: expense.updated_at,
          confirmation: expense.id,
          ...changes
        },
        { ...actor, action: 'achievement.updated' }
      );
    const rows = async () =>
      (await pool.query('SELECT * FROM fund_allocations ORDER BY id')).rows;
    const audit = async () =>
      (await pool.query('SELECT * FROM admin_audit_log ORDER BY id')).rows;

    await t.test(
      'public creation and each visibility change require confirmation before writing',
      async () => {
        await assert.rejects(create({ status: 'published' }), {
          code: 'confirmation_required'
        });
        assert.equal((await rows()).length, 0);
        const { expense } = await create();
        for (const status of ['published', 'active', 'private', 'archived']) {
          await assert.rejects(
            update(expense, { status, confirmation: undefined }),
            { code: 'confirmation_required' }
          );
          await assert.rejects(
            update(expense, { status, confirmation: 'another-allocation' }),
            { code: 'confirmation_required' }
          );
        }
        assert.equal((await rows())[0].status, 'draft');
        assert.equal((await audit()).length, 1);
      }
    );

    await t.test(
      'amounts must be exact positive minor units and proof links cannot contain credentials',
      async () => {
        for (const amountAllocated of [
          0.001,
          42.501,
          0,
          -1,
          Number.MAX_SAFE_INTEGER
        ]) {
          await assert.rejects(create({ amountAllocated }), /amount/i);
        }
        await assert.rejects(
          create({ proofUrl: 'https://synthetic:private@example.test/proof' }),
          /proof/i
        );
        const { expense } = await create({ amountAllocated: 19.99 });
        assert.equal((await rows())[0].amount_allocated, '1999');
        await assert.rejects(
          update(expense, { amountAllocated: 19.999 }),
          /amount/i
        );
        assert.equal((await rows())[0].amount_allocated, '1999');
        assert.equal((await audit()).length, 1);
      }
    );

    await t.test(
      'explicit public creation supports both public statuses and legacy unsafe proof links are excluded',
      async () => {
        for (const status of ['published', 'active']) {
          const { expense } = await create({
            status,
            confirmation: 'CREATE_PUBLIC_ALLOCATION'
          });
          assert.ok(expense.published_at);
        }
        await pool.query(
          "UPDATE fund_allocations SET proof_url='https://synthetic:private@example.test/proof'"
        );
        const published = (await getPublicTransparencySummary(pool))
          .latest_public_allocations;
        assert.equal(published.length, 2);
        assert.ok(published.every((entry) => entry.proof_url === null));
        assert.ok(
          (await rows()).every((entry) =>
            entry.proof_url.includes('synthetic:private')
          )
        );
      }
    );

    await t.test(
      'publish, edit, hide and archive retain financial facts and require renewed public approval',
      async () => {
        const before = await getPublicTransparencySummary(pool);
        let { expense } = await create();
        assert.equal(
          (await getPublicTransparencySummary(pool)).latest_public_allocations
            .length,
          0
        );
        ({ expense } = await update(expense, {
          status: 'published',
          publishedAt: null
        }));
        assert.ok(expense.published_at);
        assert.equal(
          (await getPublicTransparencySummary(pool))
            .latest_public_allocations[0].amount_allocated,
          42.5
        );
        await assert.rejects(
          update(expense, {
            progressStatus: 'delivered',
            confirmation: undefined
          }),
          { code: 'confirmation_required' }
        );
        ({ expense } = await update(expense, {
          progressStatus: 'delivered',
          proofUrl: 'https://example.test/public-proof',
          proofSource: 'Compte rendu synthétique',
          proofPublishedAt: '2026-09-24T12:00:00Z'
        }));
        const publicAllocation = (await getPublicTransparencySummary(pool))
          .latest_public_allocations[0];
        assert.equal(publicAllocation.progress_status, 'delivered');
        assert.equal(
          publicAllocation.proof_url,
          'https://example.test/public-proof'
        );
        ({ expense } = await update(expense, { status: 'private' }));
        assert.equal(
          (await getPublicTransparencySummary(pool)).latest_public_allocations
            .length,
          0
        );
        ({ expense } = await update(expense, { status: 'archived' }));
        assert.equal(
          (await getPublicTransparencySummary(pool)).latest_public_allocations
            .length,
          0
        );
        assert.equal((await listAdminExpenses(pool)).summary.archived_count, 1);
        const after = await getPublicTransparencySummary(pool);
        for (const key of [
          'total_received',
          'total_fees',
          'total_refunded',
          'total_payouts',
          'current_available_estimate'
        ])
          assert.equal(after[key], before[key], key);
        assert.equal((await audit()).length, 5);
      }
    );

    await t.test(
      'two writers and a replay cannot overwrite the winning version or duplicate its audit',
      async () => {
        const { expense } = await create();
        const changes = [{ status: 'published' }, { amountAllocated: 65.25 }];
        const results = await Promise.all(
          changes.map((change) => update(expense, change))
        );
        assert.equal(results.filter((r) => r.updated).length, 1);
        const winner = results.find((r) => r.updated).expense;
        assert.equal(
          (await update(expense, { status: 'private' })).updated,
          false
        );
        assert.deepEqual((await listAdminExpenses(pool, expense.id)).expenses, [
          winner
        ]);
        assert.equal((await audit()).length, 2);
      }
    );

    await t.test(
      'audit insertion failure rolls back creation and publication',
      async () => {
        const { expense } = await create();
        const before = await rows();
        await pool.query(`CREATE FUNCTION allocation_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic allocation audit failure'; END $$;
      CREATE TRIGGER allocation_audit_failure BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION allocation_audit_failure()`);
        try {
          await assert.rejects(create(), /synthetic allocation audit failure/);
          await assert.rejects(
            update(expense, { status: 'published' }),
            /synthetic allocation audit failure/
          );
        } finally {
          await pool.query(
            'DROP TRIGGER allocation_audit_failure ON admin_audit_log; DROP FUNCTION allocation_audit_failure()'
          );
        }
        assert.deepEqual(await rows(), before);
        assert.equal((await audit()).length, 1);
        assert.equal(
          (await update(expense, { status: 'published' })).updated,
          true
        );
      }
    );
  }
);
