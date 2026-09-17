import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';

import { getCockpitMetrics } from '../../dist/apps/funding-api/src/admin-cockpit/metrics.js';
import { getCockpitActivity } from '../../dist/apps/funding-api/src/admin-cockpit/activity.js';
import { readSystemObservation } from '../../dist/apps/funding-api/src/admin-cockpit/systems.js';

const connectionString = process.env.COCKPIT_TEST_DATABASE_URL;
test(
  'cockpit reconciles real PostgreSQL facts beyond list limits without writes or private payloads',
  { skip: !connectionString },
  async () => {
    const url = new URL(connectionString);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.equal(url.pathname, '/cockpit_test');
    const pool = new pg.Pool({ connectionString });
    const now = new Date('2026-09-16T14:00:00Z');
    try {
      assert.equal(
        (await pool.query("SELECT to_regclass('fund_contributions') AS name"))
          .rows[0].name,
        null,
        'fresh disposable database required'
      );
      for (const file of (await readdir('apps/funding-api/migrations'))
        .filter((f) => f.endsWith('.sql'))
        .sort())
        await pool.query(
          await readFile(`apps/funding-api/migrations/${file}`, 'utf8')
        );
      assert.equal((await getCockpitMetrics(pool, now)).available, true);
      assert.deepEqual((await getCockpitActivity(pool, now)).items, []);
      await pool.query(`INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status, paid_at, stripe_payment_intent_id)
      SELECT 'sponsorship_interest', 10000, 'cad', 'paid', '2026-09-01', 'pi_cockpit_' || i FROM generate_series(1,2005) i`);
      await pool.query(`INSERT INTO fund_transactions (stripe_event_id, stripe_object_id, stripe_balance_transaction_id, type, amount, fee, net, currency, status, created_at, public_category)
      SELECT 'evt_cockpit_' || i, 'pi_cockpit_' || i, 'txn_cockpit_' || i, 'payment_intent.succeeded', 10000, 300, 9700, 'cad', 'succeeded', '2026-09-01', 'contribution' FROM generate_series(1,2005) i`);
      const id = (
        await pool.query(
          "SELECT id FROM fund_contributions WHERE stripe_payment_intent_id = 'pi_cockpit_2005'"
        )
      ).rows[0].id;
      await pool.query(`INSERT INTO fund_transactions (stripe_event_id, stripe_object_id, stripe_balance_transaction_id, type, amount, fee, net, currency, status, created_at, public_category)
      VALUES ('evt_repeat', 'pi_cockpit_2005', 'txn_cockpit_2005', 'payment_intent.succeeded', 10000, 300, 9700, 'cad', 'succeeded', '2026-09-01', 'contribution'),
      ('evt_payout', 'po_cockpit', 'txn_payout', 'payout.paid', 9000, 0, 9000, 'cad', 'paid', '2026-09-01', 'payout')`);
      let metrics = await getCockpitMetrics(pool, now);
      assert.equal(metrics.currencies[0].grossMinor, 20050000);
      assert.equal(metrics.currencies[0].netReceivedMinor, 19448500);
      assert.equal(metrics.sponsorshipCount, 2005);
      await pool.query(
        "UPDATE fund_transactions SET stripe_balance_transaction_id = NULL WHERE stripe_object_id = 'pi_cockpit_1'"
      );
      metrics = await getCockpitMetrics(pool, now);
      assert.equal(metrics.currencies[0].netReceivedMinor, null);
      assert.equal(metrics.currencies[0].missingFeeCount, 1);
      await pool.query(
        "UPDATE fund_transactions SET stripe_balance_transaction_id = 'txn_late' WHERE stripe_object_id = 'pi_cockpit_1'"
      );
      assert.equal(
        (await getCockpitMetrics(pool, now)).currencies[0].netReceivedMinor,
        19448500
      );
      await pool.query(`INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status, paid_at, email_private)
      VALUES ('personal_support', 50000, 'usd', 'paid', '2026-09-16T13:00Z', 'private-cockpit@example.invalid')`);
      for (const [event, amount] of [
        ['evt_refund_1', 300],
        ['evt_refund_2', 900],
        ['evt_refund_repeat', 900]
      ]) {
        await pool.query(
          `INSERT INTO stripe_events (stripe_event_id, event_type, processing_status, payload, processed_at)
        VALUES ($1, 'charge.refunded', 'processed', $2::jsonb, $3)`,
          [
            event,
            JSON.stringify({
              data: {
                object: {
                  id: 'ch_cockpit',
                  payment_intent: 'pi_cockpit_2005',
                  amount_refunded: amount,
                  currency: 'cad',
                  private_data: 'never-expose'
                }
              }
            }),
            now
          ]
        );
      }
      await pool.query(
        `INSERT INTO admin_audit_log (entity_type, entity_id, action, metadata, summary, created_at)
      VALUES ('sponsorship', $1, 'sponsorship_refund.stripe_partial', '{"refundId":"re_cockpit","refundStatus":"succeeded","amount":900,"currency":"cad"}', 'private note', '2026-09-16T13:00Z'),
      ('sponsorship', $1, 'sponsorship_refund.stripe_partial', '{"refundId":"re_cockpit","refundStatus":"succeeded","amount":900,"currency":"cad"}', 'retry', '2026-09-16T13:01Z'),
      ('sponsorship', $1, 'sponsorship_review.approved', '{}', 'private review note', '2026-09-16T13:02Z')`,
        [id]
      );
      await pool.query(
        `UPDATE fund_contributions SET sponsorship_refund_status = 'completed', sponsorship_refund_id = 're_cockpit', sponsorship_refund_amount_cents = 900 WHERE id = $1`,
        [id]
      );
      const slot = (
        await pool.query(
          "INSERT INTO publication_slots (feed_target, channel, starts_at, capacity, status) VALUES ('openg7','facebook','2026-09-20',3,'scheduled') RETURNING id"
        )
      ).rows[0].id;
      const batch = (
        await pool.query(
          "INSERT INTO sponsor_publication_batches (channel, capacity, status, slot_id) VALUES ('facebook',3,'scheduled',$1) RETURNING id",
          [slot]
        )
      ).rows[0].id;
      const draft = (
        await pool.query(
          `INSERT INTO sponsor_publication_drafts (contribution_id, feed_target, channel, title, body, disclosure_text, status, batch_id)
      VALUES ($1,'openg7','facebook','Private title','private body','notice','scheduled',$2) RETURNING id`,
          [id, batch]
        )
      ).rows[0].id;
      metrics = await getCockpitMetrics(pool, now);
      assert.equal(metrics.currencies[0].refundedMinor, 900);
      assert.equal(metrics.currencies[1].currency, 'USD');
      assert.equal(metrics.currencies[1].grossMinor, 50000);
      assert.equal(metrics.currencies[1].netReceivedMinor, null);
      assert.equal(
        metrics.plannedPublicationCount,
        1,
        'one obligation, not slot + batch + draft'
      );
      await pool.query(
        "UPDATE sponsor_publication_batches SET status = 'cancelled' WHERE id = $1",
        [batch]
      );
      assert.equal(
        (await getCockpitMetrics(pool, now)).plannedPublicationCount,
        0
      );
      await pool.query(
        "UPDATE sponsor_publication_drafts SET published_at = '2026-09-16T13:10Z', status = 'published' WHERE id = $1",
        [draft]
      );
      await pool.query(
        `INSERT INTO sponsorship_invoices (contribution_id, invoice_number, stripe_session_id, currency, subtotal_cents, total_cents, issuer_name, sponsor_name, issued_at)
      VALUES ($1,'FAC-COCKPIT','cs_cockpit','cad',10000,10000,'Fixture','Fixture','2026-09-16T13:05Z')`,
        [id]
      );
      const activity = await getCockpitActivity(pool, now);
      assert.equal(activity.todayCounts.payment, 1);
      assert.equal(activity.todayCounts.refund, 1, 'audit retry deduplicated');
      assert.equal(activity.todayCounts.review, 1);
      assert.equal(activity.todayCounts.invoice, 1);
      assert.equal(activity.todayCounts.publication, 1);
      assert.ok(
        activity.items.some((item) =>
          item.adminUrl.endsWith('draftId=' + draft)
        )
      );
      for (const value of [
        'private-cockpit',
        'never-expose',
        'private note',
        'private body'
      ])
        assert.ok(!JSON.stringify({ metrics, activity }).includes(value));
      assert.equal((await readSystemObservation(pool, 'stripe')).issues, 0);
      await pool.query(
        "INSERT INTO stripe_events (stripe_event_id, event_type, payload, processing_status) VALUES ('evt_failed','charge.updated','{}','failed')"
      );
      assert.equal((await readSystemObservation(pool, 'stripe')).issues, 1);
      const before = (
        await pool.query(
          'SELECT (SELECT count(*) FROM email_messages) AS mail, (SELECT count(*) FROM admin_audit_log) AS audit'
        )
      ).rows[0];
      await getCockpitMetrics(pool, now);
      await getCockpitActivity(pool, now);
      assert.deepEqual(
        (
          await pool.query(
            'SELECT (SELECT count(*) FROM email_messages) AS mail, (SELECT count(*) FROM admin_audit_log) AS audit'
          )
        ).rows[0],
        before
      );
      await pool.query(
        'ALTER TABLE sponsor_publication_drafts RENAME TO cockpit_hidden_drafts'
      );
      assert.equal(
        (await getCockpitMetrics(pool, now)).plannedPublicationCount,
        null
      );
      assert.ok(
        (await getCockpitActivity(pool, now)).missingSources.includes(
          'sponsor_publication_drafts'
        )
      );
      await pool.query(
        'ALTER TABLE cockpit_hidden_drafts RENAME TO sponsor_publication_drafts'
      );
      await pool.query(`INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status, paid_at, stripe_payment_intent_id)
      VALUES ('sponsorship_interest', 10000, 'cad', 'paid', '2026-09-02', 'pi_cockpit_1')`);
      metrics = await getCockpitMetrics(pool, now);
      assert.equal(metrics.currencies[0].grossMinor, 20050000);
      assert.equal(metrics.sponsorshipCount, 2005);
      assert.ok(metrics.warnings.includes('duplicate_payments'));
      await pool.query(`INSERT INTO fund_transactions (stripe_event_id, stripe_object_id, type, amount, fee, net, currency, status, created_at, public_category)
      VALUES ('evt_orphan', 'pi_orphan', 'payment_intent.succeeded', 5000, 150, 4850, 'cad', 'succeeded', '2026-09-01', 'contribution')`);
      assert.ok(
        (await getCockpitMetrics(pool, now)).warnings.includes(
          'unlinked_transactions'
        )
      );
      // Backfills store cumulative charge amounts; a legacy refunded status must not overwrite a known partial amount.
      await pool.query(
        "UPDATE fund_contributions SET status = 'refunded' WHERE stripe_payment_intent_id = 'pi_cockpit_2'"
      );
      await pool.query(`INSERT INTO fund_transactions (stripe_event_id, stripe_object_id, type, amount, fee, net, currency, status, created_at, public_category, metadata_json)
      VALUES ('evt_backfill_refund', 'ch_backfill', 'charge.refunded', 2000, 0, 2000, 'cad', 'succeeded', '2026-09-01', 'refund', '{"source":"stripe_backfill","paymentIntentId":"pi_cockpit_2"}')`);
      assert.equal(
        (await getCockpitMetrics(pool, now)).currencies[0].refundedMinor,
        2900
      );
      await pool.query(
        `INSERT INTO admin_audit_log (entity_type, entity_id, action, metadata) VALUES ('sponsorship', $1,
      'sponsorship_refund.stripe_partial', '{"refundId":"re_wrong_currency","refundStatus":"succeeded","amount":100,"currency":"usd"}')`,
        [id]
      );
      await assert.rejects(
        getCockpitMetrics(pool, now),
        /Inconsistent payment projection/
      );
    } finally {
      await pool.end();
    }
  }
);
