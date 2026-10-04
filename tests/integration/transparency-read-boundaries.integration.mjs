import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAdjustmentTotals,
  getPublicTransparencySummary,
  listPublicBuilders
} from '../../dist/apps/funding-api/src/fund-transparency.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'transparency reads retain public and financial boundaries on disposable PostgreSQL',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    t.beforeEach(() =>
      pool.query(
        'TRUNCATE fund_contributions, fund_transactions, fund_allocations CASCADE'
      )
    );

    await t.test(
      'absent tables and existing zero totals retain distinct availability',
      async () => {
        const zero = await getPublicTransparencySummary(pool);
        assert.equal(zero.data_source, 'database');
        assert.equal(zero.total_received, 0);
        assert.equal(zero.pending_fee_count, 0);
        assert.equal((await listPublicBuilders(pool)).data_source, 'database');
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const name of [
            'fund_contributions',
            'fund_transactions',
            'fund_allocations'
          ])
            await client.query(
              `ALTER TABLE ${name} RENAME TO transparency_boundary_${name}`
            );
          const absent = await getPublicTransparencySummary(client);
          assert.equal(absent.data_source, 'empty');
          assert.equal(absent.pending_fee_count, null);
          assert.equal((await listPublicBuilders(client)).data_source, 'empty');
          assert.deepEqual(await getAdjustmentTotals(client, false), {
            total_fees: '0',
            total_refunded: '0',
            total_payouts: '0',
            last_updated_at: null
          });
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      }
    );

    await t.test(
      'directory pages and the historical preview apply consent, approval, visibility and amount masking',
      async () => {
        await pool.query(`
      INSERT INTO fund_contributions (
        contribution_type, amount_cents, currency, status, public_name,
        public_display_consent, display_amount_consent, non_charity_acknowledged,
        paid_at, updated_at, email_private
      )
      SELECT 'personal_support', 2501, 'cad',
        CASE WHEN n % 3 = 0 THEN 'refunded' WHEN n % 3 = 1 THEN 'disputed' ELSE 'paid' END,
        'Same public name', true, false, true, '2026-09-01', '2026-09-01', 'private@example.invalid'
      FROM generate_series(1,27) AS fixture(n)
    `);
        await pool.query(`
      INSERT INTO fund_contributions (
        contribution_type, amount_cents, currency, status, public_name,
        public_display_consent, display_amount_consent, sponsor_review_status,
        sponsor_site_visibility_held, non_charity_acknowledged, email_private
      ) VALUES
        ('sponsorship_interest',2501,'cad','paid','Approved visible',true,true,'approved',false,true,'private@example.invalid'),
        ('sponsorship_interest',2501,'cad','paid','Approved held',true,true,'approved',true,true,'private@example.invalid'),
        ('sponsorship_interest',2501,'cad','paid','Awaiting review',true,true,'pending_review',false,true,'private@example.invalid'),
        ('sponsorship_interest',2501,'cad','paid','Rejected review',true,true,'rejected',false,true,'private@example.invalid'),
        ('personal_support',2501,'cad','paid','No consent',false,true,'pending_review',false,true,'private@example.invalid'),
        ('personal_support',2501,'cad','pending','Awaiting payment',true,true,'pending_review',false,true,'private@example.invalid'),
        ('personal_support',2501,'cad','paid',' ',true,true,'pending_review',false,true,'private@example.invalid')
    `);
        const builders = [];
        for (let page = 1; page <= 3; page++) {
          const response = await listPublicBuilders(pool, {
            page,
            pageSize: 12
          });
          assert.equal(response.pagination.total_count, 28);
          builders.push(...response.builders);
        }
        assert.equal(builders.length, 28);
        assert.equal(new Set(builders.map((row) => row.public_id)).size, 28);
        assert.equal(
          builders.find((row) => row.display_name === 'Approved visible')
            .amount,
          25.01
        );
        assert.ok(
          builders
            .filter((row) => row.display_name === 'Same public name')
            .every((row) => row.amount === null)
        );
        assert.ok(
          !JSON.stringify(builders).includes('private@example.invalid')
        );
        const ids = (
          await pool.query('SELECT id::text FROM fund_contributions')
        ).rows.map((row) => row.id);
        for (const id of ids) assert.ok(!JSON.stringify(builders).includes(id));
        assert.deepEqual(
          (await listPublicBuilders(pool, { page: 1, pageSize: 12 })).builders,
          builders.slice(0, 12)
        );
        assert.deepEqual(
          (await getPublicTransparencySummary(pool)).public_builders,
          builders.slice(0, 24)
        );
        const beyond = await listPublicBuilders(pool, {
          page: 4,
          pageSize: 12
        });
        assert.equal(beyond.pagination.total_count, 28);
        assert.deepEqual(beyond.builders, []);
      }
    );

    await t.test(
      'public allocations cap at eight, exclude private statuses and filter unsafe proofs without changing progress',
      async () => {
        await pool.query(`
      INSERT INTO fund_allocations (
        project_name, public_description, expected_outcome, progress_status,
        amount_allocated, currency, status, published_at, proof_url, proof_source, proof_published_at
      )
      SELECT 'Public ' || n, 'Synthetic public description', 'Synthetic public outcome',
        CASE WHEN n = 10 THEN 'delivered' ELSE 'in_progress' END,
        4250, 'cad', CASE WHEN n % 2 = 0 THEN 'active' ELSE 'published' END,
        '2026-09-01'::timestamptz + n * INTERVAL '1 day',
        CASE WHEN n = 10 THEN 'https://fixture:fixture@example.invalid/proof'
          ELSE 'https://example.invalid/proof' END,
        'Synthetic public source', '2026-09-01'
      FROM generate_series(1,10) AS fixture(n)
    `);
        await pool.query(`
      INSERT INTO fund_allocations (project_name, public_description, amount_allocated, currency, status, published_at)
      VALUES ('Private', 'Private synthetic fixture', 100, 'cad', 'private', '2026-12-01'),
        ('Draft', 'Private synthetic fixture', 100, 'cad', 'draft', '2026-12-01')
    `);
        const report = await getPublicTransparencySummary(pool);
        assert.deepEqual(
          report.latest_public_allocations.map((row) => row.project_name),
          [
            'Public 10',
            'Public 9',
            'Public 8',
            'Public 7',
            'Public 6',
            'Public 5',
            'Public 4',
            'Public 3'
          ]
        );
        assert.equal(report.latest_public_allocations[0].proof_url, null);
        assert.equal(
          report.latest_public_allocations[0].progress_status,
          'delivered'
        );
        assert.equal(
          report.latest_public_allocations[0].proof_source,
          'Synthetic public source'
        );
        assert.equal(
          report.latest_public_allocations[1].proof_url,
          'https://example.invalid/proof'
        );
        assert.ok(
          report.latest_public_allocations.every(
            (row) => row.amount_allocated === 42.5 && row.currency === 'CAD'
          )
        );
        assert.equal(report.total_received, 0);
        assert.equal(report.current_available_estimate, 0);
      }
    );

    await t.test(
      'contributions take precedence while duplicate facts, UTC adjustments and failed payouts remain consistent',
      async () => {
        await pool.query(`
      INSERT INTO fund_contributions (
        contribution_type, amount_cents, currency, status, non_charity_acknowledged,
        paid_at, stripe_payment_intent_id
      ) VALUES
        ('personal_support',10000,'cad','refunded',true,'2026-08-31T23:30:00Z','pi_boundary_first'),
        ('personal_support',5000,'cad','paid',true,'2026-09-01T00:30:00Z','pi_boundary_second')
    `);
        await pool.query(`
      INSERT INTO fund_transactions (
        stripe_event_id, stripe_object_id, stripe_balance_transaction_id,
        type, amount, fee, net, currency, status, created_at, public_category
      ) VALUES
        ('evt_boundary_old','pi_boundary_first',NULL,'payment_intent.succeeded',10000,0,10000,'cad','succeeded','2026-08-31T23:30:00Z','contribution'),
        ('evt_boundary_enriched','pi_boundary_first','txn_boundary_first','payment_intent.succeeded',10000,300,9700,'cad','succeeded','2026-08-31T23:30:00Z','contribution'),
        ('evt_boundary_legacy','pi_boundary_legacy','txn_boundary_legacy','payment_intent.succeeded',70000,0,70000,'cad','succeeded','2026-08-01','contribution'),
        ('evt_boundary_refund','re_boundary',NULL,'charge.refunded',2500,0,-2500,'cad','succeeded','2026-10-01T00:30:00Z','refund'),
        ('evt_boundary_payout','po_boundary',NULL,'payout.paid',1000,0,-1000,'cad','paid','2026-10-01T00:30:00Z','payout'),
        ('evt_boundary_failed','po_boundary',NULL,'payout.failed',1000,0,-1000,'cad','failed','2026-10-02','payout')
    `);
        const before = (
          await pool.query('SELECT * FROM fund_transactions ORDER BY id')
        ).rows;
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SET LOCAL TIME ZONE 'America/Los_Angeles'");
          const report = await getPublicTransparencySummary(client);
          assert.equal(report.total_received, 150);
          assert.equal(report.total_fees, 3);
          assert.equal(report.total_refunded, 25);
          assert.equal(report.total_payouts, 0);
          assert.equal(report.current_available_estimate, 122);
          assert.equal(report.pending_fee_count, 1);
          assert.deepEqual(
            report.monthly_summary.map((row) => [
              row.month,
              row.total_received,
              row.total_refunded,
              row.pending_fee_count
            ]),
            [
              ['2026-10', 0, 25, 0],
              ['2026-09', 50, 0, 1],
              ['2026-08', 100, 0, 0]
            ]
          );
          assert.equal(
            (await getAdjustmentTotals(client, true)).total_payouts,
            '0'
          );
          await client.query(
            'ALTER TABLE fund_contributions RENAME TO transparency_boundary_contributions'
          );
          const legacy = await getPublicTransparencySummary(client);
          assert.equal(legacy.total_received, 800);
          assert.equal(legacy.total_fees, 3);
          assert.equal(legacy.total_refunded, 25);
          assert.equal(legacy.total_payouts, 0);
          assert.equal(legacy.pending_fee_count, 0);
          assert.deepEqual(legacy.public_builders, []);
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
        assert.deepEqual(
          (await pool.query('SELECT * FROM fund_transactions ORDER BY id'))
            .rows,
          before
        );
        await pool.query(
          "UPDATE fund_transactions SET currency = 'usd' WHERE stripe_event_id = 'evt_boundary_refund'"
        );
        await assert.rejects(
          getPublicTransparencySummary(pool),
          /Multiple currencies in public transparency/
        );
      }
    );
  }
);
