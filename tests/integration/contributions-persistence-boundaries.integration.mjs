import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAdminDashboard,
  listAdminContributionSelection,
  listAdminContributions,
  listContributionReferencesByEmail,
  lookupPublicContributionReference
} from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

test(
  'extracted contribution reads preserve transactional selection, refund projections and recovery on PostgreSQL',
  { timeout: 120000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const { rows } = await db.pool.query(`
      INSERT INTO fund_contributions (
        contribution_type, amount_cents, currency, status, public_reference,
        email_private, paid_at, display_amount_consent, sponsor_company_name
      ) VALUES
        ('personal_support', 12345, 'cad', 'paid', 'OG7-BOUNDARY-PERSONAL',
          'boundary@example.invalid', '2026-09-01', false, NULL),
        ('sponsorship_interest', 6789, 'cad', 'paid', 'OG7-BOUNDARY-SPONSOR',
          'boundary@example.invalid', '2026-09-02', true, 'Boundary Fixture')
      RETURNING id
    `);
    const personalId = rows[0].id;
    const sponsorId = rows[1].id;

    await t.test(
      'FOR SHARE uses and releases the caller transaction while rolled-back updates leave facts unchanged',
      async () => {
        const reader = await db.pool.connect();
        const writer = await db.pool.connect();
        try {
          await reader.query('BEGIN');
          const selected = await listAdminContributionSelection(reader, [
            personalId,
            personalId
          ]);
          assert.equal(selected.length, 1);
          assert.equal(selected[0].id, personalId);
          assert.equal(selected[0].amount, 123.45);
          assert.equal(selected[0].currency, 'CAD');

          await writer.query('BEGIN');
          await writer.query("SET LOCAL lock_timeout = '150ms'");
          await assert.rejects(
            writer.query(
              'UPDATE fund_contributions SET amount_cents = 54321 WHERE id = $1',
              [personalId]
            ),
            (error) => error.code === '55P03'
          );
          await writer.query('ROLLBACK');
          await reader.query('ROLLBACK');

          await writer.query('BEGIN');
          await writer.query("SET LOCAL lock_timeout = '1s'");
          const updated = await writer.query(
            'UPDATE fund_contributions SET amount_cents = 54321 WHERE id = $1 RETURNING id',
            [personalId]
          );
          assert.equal(updated.rowCount, 1);
          await writer.query('ROLLBACK');
          assert.equal(
            (await listAdminContributionSelection(reader, [personalId]))[0]
              .amount,
            123.45
          );
          assert.deepEqual(
            await listAdminContributionSelection(reader, []),
            []
          );
        } finally {
          await reader.query('ROLLBACK');
          await writer.query('ROLLBACK');
          reader.release();
          writer.release();
        }
      }
    );

    await t.test(
      'dashboard uses deduplicated partial refunds and lookup/recovery retain consent and currency',
      async () => {
        await db.pool.query(`
        INSERT INTO fund_transactions (
          stripe_event_id, stripe_object_id, type, amount, fee, net, currency,
          status, created_at, public_category, metadata_json
        ) VALUES
          ('evt_boundary_refund_a', 'pi_boundary_refund', 'charge.refunded', 234, 0, -234,
            'cad', 'succeeded', '2026-09-03', 'refund', '{"refundId":"re_boundary"}'),
          ('evt_boundary_refund_b', 'pi_boundary_refund', 'charge.refunded', 234, 0, -234,
            'cad', 'succeeded', '2026-09-03', 'refund', '{"refundId":"re_boundary"}')
      `);
        const dashboard = await getAdminDashboard(db.pool);
        assert.equal(dashboard.data_available, true);
        assert.equal(dashboard.totals.currency, 'CAD');
        assert.equal(dashboard.totals.total_received, 191.34);
        assert.equal(dashboard.totals.total_refunded, 2.34);
        assert.equal(dashboard.totals.current_available_estimate, 189);
        assert.equal(dashboard.sponsorship_review.pending, 1);
        assert.equal(dashboard.recent_contributions.length, 2);
        assert.equal(
          (await listAdminContributions(db.pool, sponsorId)).contributions[0]
            .amount,
          67.89
        );

        const personal = await lookupPublicContributionReference(
          db.pool,
          'OG7-BOUNDARY-PERSONAL'
        );
        assert.equal(personal.amount, null);
        assert.equal(personal.nextStep, 'none');
        assert.ok(
          !JSON.stringify(personal).includes('boundary@example.invalid')
        );
        const sponsor = await lookupPublicContributionReference(
          db.pool,
          'OG7-BOUNDARY-SPONSOR'
        );
        assert.equal(sponsor.amount, 67.89);
        assert.equal(sponsor.nextStep, 'recover_private_link_by_email');
        const references = await listContributionReferencesByEmail(
          db.pool,
          '  BOUNDARY@EXAMPLE.INVALID  '
        );
        assert.equal(references.length, 2);
        assert.deepEqual(
          references.map((row) => row.amount),
          [67.89, 123.45]
        );
        assert.ok(references.every((row) => row.currency === 'CAD'));
      }
    );
  }
);
