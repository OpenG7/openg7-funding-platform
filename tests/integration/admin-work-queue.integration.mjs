import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

import { getAdminWorkQueue } from '../../dist/apps/funding-api/src/admin-work-queue.service.js';
import { listAdminEmailQueue } from '../../dist/apps/funding-api/src/email-notification.service.js';
import {
  listAdminPublicationDrafts,
  listAdminPublicationBatches,
  listAdminPublicationSlots
} from '../../dist/apps/funding-api/src/fund-admin.repository.js';
import {
  backfillMissingSponsorshipInvoices,
  listAdminSponsorshipInvoices
} from '../../dist/apps/funding-api/src/sponsorship-invoices.repository.js';

// Owns a disposable, loopback-only database. Never loads .env.
test(
  'complete queue, exact links and scoped invoice recovery against PostgreSQL',
  { timeout: 90000 },
  async () => {
    const { pool, stop } = await startDisposablePostgres({ migrate: false });
    try {
      const existing = await pool.query(
        "SELECT to_regclass('public.fund_contributions') AS table_name"
      );
      assert.equal(
        existing.rows[0].table_name,
        null,
        'Requires a fresh disposable database'
      );
      const missingSchema = await getAdminWorkQueue(pool);
      assert.equal(missingSchema.available, false);
      assert.equal(missingSchema.coverage, 'unavailable');
      assert.equal(missingSchema.total, 0);
      assert.deepEqual(missingSchema.missingSources, [
        'fund_contributions',
        'stripe_events',
        'sponsorship_invoices',
        'sponsor_media_assets',
        'sponsor_publication_drafts',
        'sponsor_publication_batches',
        'publication_slots',
        'email_messages'
      ]);
      for (const file of (await readdir('apps/funding-api/migrations'))
        .filter((file) => file.endsWith('.sql'))
        .sort()) {
        await pool.query(
          await readFile(`apps/funding-api/migrations/${file}`, 'utf8')
        );
      }
      const empty = await getAdminWorkQueue(pool);
      assert.equal(empty.available, true);
      assert.equal(empty.total, 0);
      const paidAt = '2026-09-01T14:00:00Z';
      await pool.query(
        `INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status, paid_at, stripe_session_id)
      SELECT 'sponsorship_interest', 10000, 'cad', 'paid', $1::timestamptz, 'cs_test_attention_' || n FROM generate_series(1, 2005) n`,
        [paidAt]
      );
      const contribution = (
        await pool.query(
          'SELECT id FROM fund_contributions ORDER BY id LIMIT 1'
        )
      ).rows[0].id;
      await pool.query(`INSERT INTO email_messages (template_key, recipient_email, from_email, subject, text_body, html_body, status)
      SELECT 'test', 'demo@example.invalid', 'demo@example.invalid', 'Demo', 'Demo', 'Demo', 'failed' FROM generate_series(1, 160)`);
      await pool.query(
        `INSERT INTO sponsor_publication_batches (channel, capacity, status, scheduled_at)
      SELECT 'facebook', 5, 'scheduled', $1::timestamptz FROM generate_series(1, 110)`,
        [paidAt]
      );
      await pool.query(
        `INSERT INTO publication_slots (feed_target, channel, starts_at, capacity)
      SELECT 'openg7', 'facebook', $1::timestamptz, 5 FROM generate_series(1, 110)`,
        [paidAt]
      );
      await pool.query(`INSERT INTO sponsor_publication_drafts (contribution_id, feed_target, channel, title, body, disclosure_text, status)
      SELECT id, 'openg7', 'facebook', 'Demo', 'Demo', 'Demo', 'approved' FROM fund_contributions ORDER BY id LIMIT 110`);
      await pool.query(
        `INSERT INTO stripe_events (stripe_event_id, event_type, payload, processing_status, received_at)
      VALUES ('evt_test_attention', 'payment_intent.succeeded', '{"private":"not exposed"}', 'failed', $1::timestamptz)`,
        [paidAt]
      );
      const queue = await getAdminWorkQueue(
        pool,
        { pageSize: 100 },
        new Date('2026-09-15T14:00:00Z')
      );
      assert.equal(queue.available, true);
      assert.equal(queue.typeCounts.invoice_missing, 2005);
      assert.equal(queue.typeCounts.sponsorship_needs_info, 2005);
      assert.equal(queue.typeCounts.email_delivery_failed, 160);
      assert.equal(queue.typeCounts.publication_late, 220);
      assert.equal(queue.typeCounts.publication_ready, 110);
      assert.equal(queue.typeCounts.stripe_event_failed, 1);
      assert.equal(queue.total, 4501);
      assert.doesNotMatch(JSON.stringify(queue), /demo@example|not exposed/);
      const oldEmail = (
        await pool.query(
          'SELECT id::text FROM email_messages ORDER BY updated_at DESC, created_at DESC OFFSET 155 LIMIT 1'
        )
      ).rows[0].id;
      assert.equal(
        (await listAdminEmailQueue(pool, { id: oldEmail })).messages[0].id,
        oldEmail
      );
      for (const [table, loader, key] of [
        ['sponsor_publication_drafts', listAdminPublicationDrafts, 'drafts'],
        ['sponsor_publication_batches', listAdminPublicationBatches, 'batches'],
        ['publication_slots', listAdminPublicationSlots, 'slots']
      ]) {
        const normal = await loader(pool);
        assert.equal(normal[key].length, 100);
        const all = await loader(pool, { all: true });
        const target = all[key].find(
          (item) => !normal[key].some((normalItem) => normalItem.id === item.id)
        );
        assert.ok(target, table);
        assert.deepEqual(
          (await loader(pool, { id: target.id }))[key].map((item) => item.id),
          [target.id]
        );
      }
      const beforeMail = (
        await pool.query('SELECT COUNT(*)::int AS count FROM email_messages')
      ).rows[0].count;
      const unavailableWritePool = {
        query: (sql, values) => {
          if (sql.includes('INSERT INTO sponsorship_invoices')) {
            throw new Error('Synthetic transient invoice write failure');
          }
          return pool.query(sql, values);
        }
      };
      const failed = await backfillMissingSponsorshipInvoices(
        unavailableWritePool,
        { contributionId: contribution, limit: 1 }
      );
      assert.equal(failed.eligible_count, 1);
      assert.equal(failed.missing_count, 1);
      assert.equal(failed.processed_count, 1);
      assert.equal(failed.created_count, 0);
      assert.equal(failed.failed_count, 1);
      assert.deepEqual(failed.invoiceIds, []);
      assert.equal(failed.errors[0].contribution_id, contribution);
      assert.equal(
        failed.errors[0].error,
        'Synthetic transient invoice write failure'
      );
      assert.equal(
        (
          await getAdminWorkQueue(pool, {
            itemId: `invoice_missing:${contribution}`
          })
        ).filteredTotal,
        1,
        'a failed emission stays in the administrative recovery queue'
      );
      assert.equal(
        (
          await pool.query(
            'SELECT COUNT(*)::int AS count FROM sponsorship_invoices'
          )
        ).rows[0].count,
        0
      );
      const result = await backfillMissingSponsorshipInvoices(pool, {
        contributionId: contribution,
        limit: 1
      });
      assert.equal(result.created_count, 1);
      assert.equal(result.eligible_count, 1);
      assert.equal(result.failed_count, 0);
      assert.equal(
        (
          await pool.query(
            'SELECT COUNT(*)::int AS count FROM sponsorship_invoices'
          )
        ).rows[0].count,
        1
      );
      assert.equal(
        (await pool.query('SELECT COUNT(*)::int AS count FROM email_messages'))
          .rows[0].count,
        beforeMail
      );
      assert.equal(
        (
          await backfillMissingSponsorshipInvoices(pool, {
            contributionId: contribution,
            limit: 1
          })
        ).created_count,
        0
      );
      assert.equal(
        (await listAdminSponsorshipInvoices(pool, contribution)).invoices[0]
          .contribution_id,
        contribution
      );
      const resolved = await getAdminWorkQueue(pool, {
        itemId: `invoice_missing:${contribution}`
      });
      assert.equal(resolved.filteredTotal, 0);
      assert.equal(resolved.typeCounts.invoice_missing, 2004);

      const oldest = (
        await pool.query(
          `SELECT contribution.id::text AS id
           FROM fund_contributions contribution
           LEFT JOIN sponsorship_invoices invoice
             ON invoice.contribution_id = contribution.id
           WHERE invoice.id IS NULL
           ORDER BY contribution.id
           LIMIT 3`
        )
      ).rows;
      for (const [index, row] of oldest.entries()) {
        await pool.query(
          'UPDATE fund_contributions SET paid_at = $2::timestamptz WHERE id = $1',
          [row.id, `2026-07-0${index + 1}T12:00:00Z`]
        );
      }
      await pool.query(
        `INSERT INTO fund_contributions
           (contribution_type, amount_cents, currency, status, paid_at, stripe_session_id)
         VALUES
           ('sponsorship_interest', 25000, 'cad', 'pending', '2026-06-01T12:00:00Z', 'cs_test_pending_recovery'),
           ('personal_support', 25000, 'cad', 'paid', '2026-06-01T12:00:00Z', 'cs_test_personal_recovery'),
           ('sponsorship_interest', 25000, 'cad', 'paid', '2026-06-01T12:00:00Z', NULL)`
      );
      const bounded = await backfillMissingSponsorshipInvoices(pool, {
        limit: 2
      });
      assert.equal(bounded.eligible_count, 2005);
      assert.equal(bounded.missing_count, 2004);
      assert.equal(bounded.processed_count, 2);
      assert.equal(bounded.created_count, 2);
      assert.equal(bounded.skipped_count, 1);
      assert.equal(bounded.remaining_count, 2002);
      assert.equal(bounded.failed_count, 0);
      assert.deepEqual(
        bounded.invoices.map((invoice) => invoice.contribution_id),
        oldest.slice(0, 2).map((row) => row.id),
        'bounded recovery selects the oldest eligible missing invoices'
      );
      const resumed = await backfillMissingSponsorshipInvoices(pool, {
        contributionId: oldest[2].id,
        limit: 1
      });
      assert.equal(resumed.created_count, 1);
      assert.equal(resumed.invoices[0].contribution_id, oldest[2].id);
      const repeated = await backfillMissingSponsorshipInvoices(pool, {
        contributionId: oldest[2].id,
        limit: 1
      });
      assert.equal(repeated.eligible_count, 1);
      assert.equal(repeated.missing_count, 0);
      assert.equal(repeated.processed_count, 0);
      assert.equal(repeated.created_count, 0);
      assert.equal(repeated.skipped_count, 1);
      assert.equal(
        (await pool.query('SELECT COUNT(*)::int AS count FROM email_messages'))
          .rows[0].count,
        beforeMail,
        'bounded recovery and retries never enqueue historical mail'
      );
    } finally {
      await stop();
    }
  }
);
