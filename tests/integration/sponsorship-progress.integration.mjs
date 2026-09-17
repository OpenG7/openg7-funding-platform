import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { getSponsorshipProgress } from '../../dist/apps/funding-api/src/sponsorship-progress.service.js';
import { getAdminWorkQueue } from '../../dist/apps/funding-api/src/admin-work-queue.service.js';
import { getAdminAssistantContext } from '../../dist/apps/funding-api/src/admin-assistant/context.service.js';

const connectionString = process.env.SPONSOR_PROGRESS_TEST_DATABASE_URL;
test(
  'dossier progress reads exact persisted facts and the complete work queue on PostgreSQL',
  { skip: !connectionString },
  async () => {
    const url = new URL(connectionString);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.equal(url.pathname, '/progress_test');
    const pool = new pg.Pool({ connectionString });
    try {
      assert.equal(
        (
          await pool.query(
            "SELECT to_regclass('public.fund_contributions') AS name"
          )
        ).rows[0].name,
        null,
        'fresh disposable database required'
      );
      for (const file of (await readdir('apps/funding-api/migrations'))
        .filter((f) => f.endsWith('.sql'))
        .sort())
        await pool.query(
          await readFile(`apps/funding-api/migrations/${file}`, 'utf8')
        );
      assert.equal((await getSponsorshipProgress(pool)).status, 'empty');
      await pool.query(`INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status, sponsor_review_status, sponsorship_refund_status)
      SELECT 'sponsorship_interest', 50000, 'cad', 'refunded', 'rejected', 'completed' FROM generate_series(1, 2005)`);
      const id = (
        await pool.query(`INSERT INTO fund_contributions (contribution_type, amount_cents, currency, status, paid_at, updated_at, sponsor_company_name,
      sponsor_contact_email, sponsor_details_submitted_at, public_display_consent, stripe_session_id, stripe_payment_intent_id)
      VALUES ('sponsorship_interest', 50000, 'cad', 'paid', NOW(), '2020-01-01', 'Synthetic dossier', 'private@example.invalid', NOW(), true, 'cs_progress_fixture', 'pi_progress_fixture') RETURNING id`)
      ).rows[0].id;
      await pool.query(
        `INSERT INTO sponsor_media_assets (contribution_id, kind, review_status, original_filename, original_mime_type, original_size_bytes,
      original_storage_key, processed_size_bytes, processed_storage_key, public_storage_key, public_url, checksum_sha256, width, height)
      VALUES ($1, 'supporting_image', 'approved', 'fixture.png', 'image/png', 100, 'private-original', 100, 'private-processed', 'public-fixture', 'https://example.invalid/fixture.webp', repeat('a',64), 100,100)`,
        [id]
      );
      const invoice = (
        await pool.query(
          `INSERT INTO sponsorship_invoices (contribution_id, invoice_number, stripe_session_id, currency, subtotal_cents, total_cents, issuer_name, sponsor_name)
      VALUES ($1, 'FAC-PROGRESS', 'cs_progress_fixture', 'cad', 50000, 50000, 'Fixture', 'Synthetic dossier') RETURNING id`,
          [id]
        )
      ).rows[0].id;
      const load = async () => (await getSponsorshipProgress(pool, id)).dossier;
      const initial = await load();
      assert.equal(initial.contributionId, id);
      assert.equal(
        (await getAdminAssistantContext(pool)).context.contributionId,
        id
      );
      assert.equal(
        (await getSponsorshipProgress(pool, id.toUpperCase())).dossier
          .contributionId,
        id
      );
      assert.equal(
        initial.milestones.find((s) => s.id === 'billing').state,
        'complete'
      );
      assert.equal(
        initial.milestones.find((s) => s.id === 'review').state,
        'pending'
      );
      assert.equal(initial.next.reason, 'review_pending');
      const queue = await getAdminWorkQueue(pool, {
        pageSize: 1,
        type: 'invoice_missing'
      });
      assert.equal(
        queue.firstSponsorshipId,
        id,
        'fallback independent of a filter with zero rows'
      );
      assert.equal(queue.actionCounts.sponsorship_needs_review, 1);
      assert.equal(
        (await getSponsorshipProgress(pool)).dossier.contributionId,
        id
      );
      assert.doesNotMatch(
        JSON.stringify(initial),
        /private@example|private-original|private-processed/
      );
      assert.equal(
        (
          await getSponsorshipProgress(
            pool,
            '10000000-0000-4000-8000-000000000999'
          )
        ).status,
        'not_found'
      );
      const batch = (
        await pool.query(
          "INSERT INTO sponsor_publication_batches (channel,capacity,status) VALUES ('facebook', 5, 'cancelled') RETURNING id"
        )
      ).rows[0].id;
      await pool.query(
        `INSERT INTO sponsor_publication_drafts (contribution_id, feed_target, channel, title, body, disclosure_text, status, batch_id)
      VALUES ($1, 'openg7','facebook','Fixture','Private draft body','Fixture','approved',$2)`,
        [id, batch]
      );
      assert.equal(
        (await load()).milestones.find((s) => s.id === 'publication').state,
        'cancelled'
      );
      for (const [refundId, amount] of [
        ['re_a', 12000],
        ['re_b', 8000],
        ['re_a', 12000]
      ])
        await pool.query(
          `INSERT INTO admin_audit_log (action,entity_type,entity_id,metadata)
      VALUES ('sponsorship_refund.stripe_partial','sponsorship',$1,$2::jsonb)`,
          [
            id,
            JSON.stringify({
              refundId,
              amount,
              currency: 'cad',
              refundStatus: 'succeeded',
              recipient: 'private@example.invalid'
            })
          ]
        );
      for (const [eventId, amount] of [
        ['evt_first', 12000],
        ['evt_repeat', 20000]
      ])
        await pool.query(
          `INSERT INTO stripe_events (stripe_event_id,event_type,processing_status,payload)
      VALUES ($1,'charge.refunded','processed',$2::jsonb)`,
          [
            eventId,
            JSON.stringify({
              data: {
                object: {
                  id: 'ch_fixture',
                  payment_intent: 'pi_progress_fixture',
                  amount_refunded: amount,
                  currency: 'cad',
                  refunds: {
                    data: [
                      {
                        id: 're_b',
                        amount: 8000,
                        currency: 'cad',
                        status: 'succeeded'
                      }
                    ]
                  }
                }
              }
            })
          ]
        );
      await pool.query(
        "UPDATE fund_contributions SET sponsorship_refund_status='completed', sponsorship_refund_id='re_b', sponsorship_refund_amount_cents=8000 WHERE id=$1",
        [id]
      );
      const partial = await load();
      assert.equal(partial.refund.confirmedAmountMinor, 20000);
      assert.equal(partial.refund.state, 'partial');
      assert.equal(partial.refund.creditMissing, true);
      for (const [refundId, amount] of [
        ['re_a', 12000],
        ['re_b', 8000]
      ])
        await pool.query(
          `INSERT INTO sponsorship_credit_notes (invoice_id,contribution_id,credit_note_number,invoice_number,stripe_refund_id,currency,subtotal_cents,total_cents,issuer_name,sponsor_name)
      VALUES ($1,$2,$3,'FAC-PROGRESS',$4,'cad',$5,$5,'Fixture','Fixture')`,
          [invoice, id, 'CREDIT-' + refundId, refundId, amount]
        );
      assert.equal((await load()).refund.creditMissing, false);
      await pool.query(
        `INSERT INTO email_messages (template_key,recipient_email,from_email,subject,text_body,html_body,status,metadata)
      VALUES ('invoice','private@example.invalid','fixture@example.invalid','Private subject','Private body','Private body','failed',jsonb_build_object('invoiceId',$1::text))`,
        [invoice]
      );
      assert.equal((await load()).failedEmails.length, 1);
      await pool.query(
        `INSERT INTO stripe_events (stripe_event_id,event_type,processing_status,payload) VALUES ('evt_failed','payment_intent.succeeded','failed',$1::jsonb)`,
        [
          JSON.stringify({
            data: {
              object: {
                id: 'pi_progress_fixture',
                customer: 'private-customer'
              }
            }
          })
        ]
      );
      const failed = await load();
      assert.equal(failed.failedStripeEvents.length, 1);
      assert.equal(failed.next.reason, 'stripe_failed');
      assert.doesNotMatch(
        JSON.stringify(failed),
        /private@example|Private body|private-customer|Private draft body/
      );
      const before = (
        await pool.query(
          'SELECT (SELECT count(*) FROM email_messages)::int AS emails, (SELECT count(*) FROM admin_audit_log)::int AS audits'
        )
      ).rows[0];
      await load();
      await load();
      assert.deepEqual(
        (
          await pool.query(
            'SELECT (SELECT count(*) FROM email_messages)::int AS emails, (SELECT count(*) FROM admin_audit_log)::int AS audits'
          )
        ).rows[0],
        before,
        'opening the dossier performs no writes'
      );
    } finally {
      await pool.end();
    }
  }
);
