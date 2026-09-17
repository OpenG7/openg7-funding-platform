import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';

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

// Explicitly opt in with a disposable, loopback-only database. Never loads .env.
const connectionString = process.env.ATTENTION_TEST_DATABASE_URL;
test(
  'complete queue, exact links and scoped invoice recovery against PostgreSQL',
  { skip: !connectionString },
  async () => {
    const url = new URL(connectionString);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
    assert.equal(url.pathname, '/attention_test');
    const pool = new pg.Pool({ connectionString });
    try {
      const existing = await pool.query(
        "SELECT to_regclass('public.fund_contributions') AS table_name"
      );
      assert.equal(
        existing.rows[0].table_name,
        null,
        'Requires a fresh disposable database'
      );
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
    } finally {
      await pool.end();
    }
  }
);
