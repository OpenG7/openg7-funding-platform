import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  listPublicBuilders,
  getPublicTransparencySummary
} from '../../dist/apps/funding-api/src/fund-transparency.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'public builder pagination preserves consent and the transparency preview',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    await pool.query(`INSERT INTO fund_contributions (contribution_type,amount_cents,currency,status,
    public_display_consent,display_amount_consent,public_name,paid_at,updated_at,email_private)
    SELECT 'personal_support', 2501, 'cad', 'paid', true, false, 'Same name', '2026-09-01', '2026-09-01', 'private@example.invalid'
    FROM generate_series(1,31)`);
    await t.test(
      'all records beyond 24 can be reached once, and legacy preview stays bounded',
      async () => {
        const all = [];
        for (let page = 1; page <= 3; page++) {
          const response = await listPublicBuilders(pool, {
            page,
            pageSize: 12
          });
          assert.equal(response.pagination.total_count, 31);
          assert.equal(response.builders.length, page === 3 ? 7 : 12);
          all.push(...response.builders.map((b) => b.public_id));
          assert.ok(response.builders.every((b) => b.amount === null));
          assert.equal(JSON.stringify(response).includes('private@'), false);
        }
        assert.equal(new Set(all).size, 31);
        assert.equal(
          (await getPublicTransparencySummary(pool)).public_builders.length,
          24
        );
        assert.equal(
          (await listPublicBuilders(pool, { page: 9 })).pagination.total_count,
          31
        );
        assert.equal(
          (await listPublicBuilders(pool, { page: 9 })).builders.length,
          0
        );
      }
    );
    await t.test(
      'consent, approval, payment and amount visibility govern cards and totals',
      async () => {
        await pool.query('TRUNCATE fund_contributions CASCADE');
        await pool.query(`INSERT INTO fund_contributions (contribution_type,amount_cents,currency,status,
      public_display_consent,display_amount_consent,public_name,sponsor_review_status)
      VALUES
      ('personal_support',2501,'cad','paid',true,true,'Visible','pending_review'),
      ('personal_support',2501,'cad','paid',false,true,'Private','pending_review'),
      ('personal_support',2501,'cad','pending',true,true,'Pending','pending_review'),
      ('personal_support',2501,'cad','paid',true,true,' ','pending_review'),
      ('sponsorship_interest',2501,'cad','paid',true,true,'Unapproved','pending_review'),
      ('sponsorship_interest',2501,'cad','paid',true,false,'Approved','approved'),
      ('personal_support',2501,'cad','refunded',true,true,'Refunded','pending_review'),
      ('personal_support',2501,'cad','disputed',true,true,'Disputed','pending_review')`);
        const result = await listPublicBuilders(pool);
        assert.equal(result.pagination.total_count, 4);
        assert.deepEqual(result.builders.map((b) => b.display_name).sort(), [
          'Approved',
          'Disputed',
          'Refunded',
          'Visible'
        ]);
        assert.equal(
          result.builders.find((b) => b.display_name === 'Visible').amount,
          25.01
        );
        assert.equal(
          result.builders.find((b) => b.display_name === 'Approved').amount,
          null
        );
        await pool.query(
          "UPDATE fund_contributions SET public_display_consent=false WHERE public_name='Visible'"
        );
        assert.equal(
          (await listPublicBuilders(pool)).pagination.total_count,
          3
        );
      }
    );
    await t.test(
      'empty storage, empty registry and invalid pagination remain distinct',
      async () => {
        await pool.query('TRUNCATE fund_contributions CASCADE');
        assert.equal((await listPublicBuilders(pool)).data_source, 'database');
        assert.equal((await listPublicBuilders(null)).data_source, 'empty');
        for (const pagination of [
          { page: 0 },
          { page: 100001 },
          { pageSize: 51 },
          { pageSize: 1.5 }
        ])
          await assert.rejects(
            listPublicBuilders(pool, pagination),
            RangeError
          );
      }
    );
  }
);
