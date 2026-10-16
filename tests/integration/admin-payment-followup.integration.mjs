import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import {
  getAdminWorkQueue,
  resolveSponsorshipSelection
} from '../../dist/apps/funding-api/src/admin-work-queue.service.js';
import { activateSponsorshipCommitments } from '../../dist/apps/funding-api/src/sponsorship-commitments.repository.js';
import { qualifySponsorshipCommitment } from '../../dist/apps/funding-api/src/sponsorship-commitments/qualification.js';
import { createSponsorshipOfferSnapshot } from '../../dist/packages/funding-core/src/index.js';
import { withPostgresTransaction } from '../../dist/apps/funding-api/src/postgres-transaction.js';
import { loadReliabilityFollowupItems } from '../../dist/apps/funding-api/src/admin-work-queue/reliability-followup.js';
import { getPaymentJourney } from '../../dist/apps/funding-api/src/admin-payment-journey.service.js';
import { getSponsorshipProgress } from '../../dist/apps/funding-api/src/sponsorship-progress.service.js';
import { reconcileEmailDelivery } from '../../dist/apps/funding-api/src/email-delivery-reconciliation.repository.js';

test(
  'complete payment followup acquires proofs, exact quantities, credits and every correlated incident from PostgreSQL',
  { timeout: 90000 },
  async () => {
    const { pool, stop } = await startDisposablePostgres();
    try {
      const ids = [];
      for (let index = 0; index < 2; index++) {
        const id = (
          await pool.query(
            `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,
        sponsor_review_status,sponsor_company_name,sponsor_contact_email,sponsor_details_submitted_at,public_display_consent,
        stripe_session_id,stripe_payment_intent_id,sponsorship_refund_status)
        VALUES('sponsorship_interest',50000,'cad','paid',NOW(),'approved','Synthetic followup','synthetic@example.invalid',NOW(),true,$1,$2,$3) RETURNING id`,
            [
              `cs_test_followup_${index}`,
              `pi_test_followup_${index}`,
              index ? 'processing' : 'not_requested'
            ]
          )
        ).rows[0].id;
        ids.push(id);
        await withPostgresTransaction(pool, async (db) => {
          await activateSponsorshipCommitments(db, {
            stripeSessionId: `cs_test_followup_${index}`
          });
          const offer = createSponsorshipOfferSnapshot(50000, 'CAD');
          await qualifySponsorshipCommitment(
            db,
            {
              requestId: randomUUID(),
              contributionId: id,
              expectedVersion: 1,
              confirmation: id,
              reason: 'Synthetic explicit commercial agreement',
              evidenceReference: 'synthetic://payment-followup-agreement',
              offer: {
                ...offer,
                version: 'historical-qualification-v1',
                benefits: offer.benefits.map((benefit) => ({
                  ...benefit,
                  quantity: benefit.channel === 'facebook' ? 2 : 1,
                  deadlineDays: benefit.channel === 'website' ? 7 : null,
                  durationDays: benefit.channel === 'website' ? 30 : null
                }))
              }
            },
            'admin:00000000-0000-4000-8000-000000000041'
          );
        });
      }
      const websiteId = (
        await pool.query(
          "SELECT id FROM sponsorship_obligations WHERE contribution_id=$1 AND channel='website'",
          [ids[0]]
        )
      ).rows[0].id;
      await pool.query(
        `UPDATE sponsorship_obligation_timing SET origin_at='2020-01-01T00:00:00Z',origin_provenance='owner_recorded',
      due_at='2020-01-08T00:00:00Z',version=version+1 WHERE obligation_id=$1`,
        [websiteId]
      );
      const slot = (
        await pool.query(
          "INSERT INTO publication_slots(feed_target,channel,starts_at,capacity) VALUES('openg7','facebook',NOW()+INTERVAL '1 day',1) RETURNING id"
        )
      ).rows[0].id;
      const batch = (
        await pool.query(
          "INSERT INTO sponsor_publication_batches(channel,capacity,status,slot_id) VALUES('facebook',1,'open',$1) RETURNING id",
          [slot]
        )
      ).rows[0].id;
      for (const id of ids)
        await pool.query(
          `INSERT INTO sponsor_publication_drafts(contribution_id,feed_target,channel,title,body,disclosure_text,status,batch_id)
        VALUES($1,'openg7','facebook','Synthetic title','Synthetic body','Synthetic disclosure','published',$2)`,
          [id, batch]
        );
      const delivery = (
        await pool.query(
          `INSERT INTO publication_deliveries(feed_id,kind,batch_id,message,scheduled_at,account_id,mode,status,source_snapshot)
      VALUES('openg7:facebook','sponsorship',$1,'Synthetic ambiguous result',NOW(),'synthetic-account','mock','uncertain',$2::jsonb) RETURNING id`,
          [
            batch,
            JSON.stringify(ids.map((contribution_id) => ({ contribution_id })))
          ]
        )
      ).rows[0].id;
      await pool.query(
        `INSERT INTO fund_transactions(stripe_event_id,stripe_object_id,type,amount,fee,net,currency,status,created_at,public_category,metadata_json)
      VALUES('evt_test_followup_refund','ch_test_followup_refund','charge.refunded',1000,0,-1000,'cad','succeeded',NOW(),'refund',$1::jsonb)`,
        [
          JSON.stringify({
            paymentIntentId: 'pi_test_followup_0',
            refundId: 're_test_followup'
          })
        ]
      );

      const queue = await getAdminWorkQueue(pool, { pageSize: 100 });
      assert.equal(queue.coverage, 'complete');
      assert.equal(queue.typeCounts.sponsorship_needs_fulfilment, 8);
      assert.equal(queue.typeCounts.sponsorship_refund_followup, 1);
      assert.equal(queue.typeCounts.sponsorship_credit_missing, 1);
      assert.ok(queue.typeCounts.sponsorship_timing_review >= 2);
      for (const id of ids) {
        const related = queue.items.filter(
          (item) => item.contributionId === id
        );
        assert.equal(
          related.filter(
            (item) =>
              item.type === 'sponsorship_needs_fulfilment' &&
              item.facts.channel === 'facebook'
          ).length,
          2
        );
        for (const code of [
          'BATCH_CAPACITY_EXCEEDED',
          'SLOT_CAPACITY_EXCEEDED',
          'ACCOUNT_RESULT_UNCERTAIN'
        ])
          assert.ok(
            related.some(
              (item) =>
                item.type === 'publication_reliability_incident' &&
                item.facts.reason === code
            ),
            `${code} must be linked to payment ${id}`
          );
      }
      const global = queue.items.filter(
        (item) =>
          item.type === 'publication_reliability_incident' &&
          item.facts.subjectId === delivery
      );
      assert.ok(global.some((item) => item.contributionId === ids[0]));
      assert.ok(global.some((item) => item.contributionId === ids[1]));
      assert.equal(new Set(global.map((item) => item.id)).size, global.length);
      for (const id of ids) {
        const scoped = await withPostgresTransaction(
          pool,
          (client) => loadReliabilityFollowupItems(client, new Date(), id),
          { readOnlySnapshot: true }
        );
        assert.ok(scoped.length > 0);
        assert.ok(scoped.every((item) => item.contributionId === id));
        assert.ok(scoped.some((item) => item.facts.subjectId === delivery));
      }
      assert.equal(
        (await resolveSponsorshipSelection(pool)).status,
        'selected'
      );
      assert.doesNotMatch(
        JSON.stringify(queue),
        /synthetic@example|Synthetic ambiguous result|synthetic-account/
      );

      // A document repairs the credit action without waiving any commercial promise.
      const invoice = (
        await pool.query(
          `INSERT INTO sponsorship_invoices(contribution_id,invoice_number,stripe_session_id,currency,subtotal_cents,total_cents,issuer_name,sponsor_name)
      VALUES($1,'SYNTHETIC-FOLLOWUP-INVOICE','cs_test_followup_0','cad',50000,50000,'Synthetic issuer','Synthetic sponsor') RETURNING id`,
          [ids[0]]
        )
      ).rows[0].id;
      await pool.query(
        `INSERT INTO sponsorship_credit_notes(invoice_id,contribution_id,credit_note_number,invoice_number,stripe_refund_id,currency,subtotal_cents,total_cents,issuer_name,sponsor_name)
      VALUES($1,$2,'SYNTHETIC-FOLLOWUP-CREDIT','SYNTHETIC-FOLLOWUP-INVOICE','re_test_followup','cad',1000,1000,'Synthetic issuer','Synthetic sponsor')`,
        [invoice, ids[0]]
      );
      assert.equal(
        (await getAdminWorkQueue(pool)).typeCounts.sponsorship_credit_missing,
        0
      );
      const after = await getAdminWorkQueue(pool);
      assert.equal(after.typeCounts.sponsorship_needs_fulfilment, 8);
      assert.equal(after.typeCounts.sponsorship_refund_followup, 1);
    } finally {
      await stop();
    }
  }
);

test(
  'uncertain email delivery keeps payment and sponsorship journeys open until an audited reconciliation',
  { timeout: 90000 },
  async () => {
    const { pool, stop } = await startDisposablePostgres();
    try {
      const personal = (
        await pool.query(
          "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at) VALUES('personal_support',2500,'cad','paid',NOW()) RETURNING id"
        )
      ).rows[0].id;
      const company = (
        await pool.query(
          "INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at) VALUES('sponsorship_interest',50000,'cad','paid',NOW()) RETURNING id"
        )
      ).rows[0].id;
      const invoice = (
        await pool.query(
          `INSERT INTO sponsorship_invoices(contribution_id,invoice_number,stripe_session_id,currency,subtotal_cents,total_cents,issuer_name,sponsor_name)
      VALUES($1,'SYNTHETIC-UNCERTAIN-INVOICE','cs_test_uncertain_invoice','cad',50000,50000,'Synthetic issuer','Synthetic sponsor') RETURNING id`,
          [company]
        )
      ).rows[0].id;
      const credit = (
        await pool.query(
          `INSERT INTO sponsorship_credit_notes(invoice_id,contribution_id,credit_note_number,invoice_number,stripe_refund_id,currency,subtotal_cents,total_cents,issuer_name,sponsor_name)
      VALUES($1,$2,'SYNTHETIC-UNCERTAIN-CREDIT','SYNTHETIC-UNCERTAIN-INVOICE','re_test_uncertain_credit','cad',1000,1000,'Synthetic issuer','Synthetic sponsor') RETURNING id`,
          [invoice, company]
        )
      ).rows[0].id;
      for (const [contributionId, metadata] of [
        [personal, { contributionId: personal }],
        [company, { invoiceId: invoice }],
        [company, { creditNoteId: credit }]
      ]) {
        const message = (
          await pool.query(
            `INSERT INTO email_messages(template_key,recipient_email,from_email,subject,text_body,html_body,status,metadata)
        VALUES('synthetic_followup','synthetic@example.invalid','synthetic@example.invalid','Synthetic communication','Synthetic body','Synthetic body','uncertain',$1::jsonb)
        RETURNING id::text,updated_at::text AS version`,
            [JSON.stringify(metadata)]
          )
        ).rows[0];
        const journey = await getPaymentJourney(pool, contributionId);
        assert.equal(journey.status, 'ok');
        assert.equal(journey.journey.state, 'action_required');
        assert.equal(journey.journey.next.reason, 'email_uncertain');
        assert.equal(journey.journey.next.target, 'email-delivery-evidence');
        assert.equal(
          new URL(
            journey.journey.next.adminUrl,
            'https://example.invalid'
          ).searchParams.get('messageId'),
          message.id
        );
        if (contributionId === company) {
          const dossier = (await getSponsorshipProgress(pool, company)).dossier;
          assert.equal(dossier.next.reason, 'email_uncertain');
          assert.ok(
            dossier.failedEmails.some(
              (incident) =>
                incident.id === message.id && incident.status === 'uncertain'
            )
          );
          assert.notEqual(
            (await getPaymentJourney(pool, personal)).journey.next?.reason,
            'email_uncertain'
          );
        } else {
          assert.equal(
            (await getPaymentJourney(pool, company)).journey.steps.some(
              (step) => step.reason === 'email_uncertain'
            ),
            false
          );
        }
        assert.equal(
          await reconcileEmailDelivery(
            pool,
            {
              messageId: message.id,
              expectedUpdatedAt: message.version,
              outcome: 'sent',
              evidenceReference: 'synthetic://confirmed-provider-delivery'
            },
            'admin:00000000-0000-4000-8000-000000000041'
          ),
          true
        );
        const reconciled = await getPaymentJourney(pool, contributionId);
        assert.notEqual(reconciled.journey.next?.reason, 'email_uncertain');
        assert.equal(
          reconciled.journey.steps.find((step) => step.id === 'communications')
            .state,
          'complete'
        );
        if (contributionId === personal)
          assert.equal(reconciled.journey.state, 'complete');
      }
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS total FROM email_messages WHERE status='sent'"
          )
        ).rows[0].total,
        3
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS total FROM admin_audit_log WHERE action='email_queue.reconcile'"
          )
        ).rows[0].total,
        3
      );
      assert.equal(
        (await pool.query('SELECT count(*)::int AS total FROM email_messages'))
          .rows[0].total,
        3
      );
    } finally {
      await stop();
    }
  }
);

test(
  'personal payment journeys navigate to the exact failed or stalled Stripe event without contaminating another payment',
  { timeout: 90000 },
  async () => {
    const { pool, stop } = await startDisposablePostgres();
    try {
      const now = new Date('2026-10-15T14:00:00Z');
      const payments = new Map();
      const snapshots = [];
      const snapshotPool = {
        connect: async () => {
          const client = await pool.connect();
          return {
            query: async (sql, values) => {
              const result = await client.query(sql, values);
              if (sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY') {
                const settings = (
                  await client.query(
                    "SELECT current_setting('transaction_read_only') AS read_only,current_setting('transaction_isolation') AS isolation"
                  )
                ).rows[0];
                assert.equal(settings.read_only, 'on');
                assert.equal(settings.isolation, 'repeatable read');
                snapshots.push(settings);
              }
              return result;
            },
            release: () => client.release()
          };
        }
      };
      for (const kind of [
        'failed',
        'stalled',
        'boundary',
        'recent',
        'healthy'
      ]) {
        const paymentIntentId = `pi_test_personal_followup_${kind}`;
        const id = (
          await pool.query(
            `INSERT INTO fund_contributions(contribution_type,amount_cents,currency,status,paid_at,stripe_payment_intent_id,stripe_session_id)
             VALUES('personal_support',2500,'cad','paid',$1::timestamptz,$2,$3) RETURNING id`,
            [
              now.toISOString(),
              paymentIntentId,
              `cs_test_personal_followup_${kind}`
            ]
          )
        ).rows[0].id;
        payments.set(kind, id);
        if (kind === 'healthy') continue;
        await pool.query(
          `INSERT INTO stripe_events(stripe_event_id,event_type,payload,processing_status,received_at)
           VALUES($1,$2,$3::jsonb,$4,$5::timestamptz)`,
          [
            `evt_test_personal_followup_${kind}`,
            kind === 'failed' ? 'payment_intent.succeeded' : 'charge.updated',
            JSON.stringify({
              data: {
                object:
                  kind === 'failed'
                    ? { id: paymentIntentId }
                    : {
                        id: `ch_test_personal_followup_${kind}`,
                        payment_intent: { id: paymentIntentId }
                      }
              }
            }),
            kind === 'failed' ? 'failed' : 'processing',
            new Date(
              now.getTime() -
                (kind === 'recent' ? 14 : kind === 'boundary' ? 15 : 16) *
                  60 *
                  1000
            ).toISOString()
          ]
        );
      }
      for (const [kind, type] of [
        ['failed', 'stripe_event_failed'],
        ['stalled', 'stripe_event_stalled'],
        ['boundary', 'stripe_event_stalled']
      ]) {
        const result = await getPaymentJourney(
          snapshotPool,
          payments.get(kind),
          now
        );
        assert.equal(result.status, 'ok');
        assert.equal(result.journey.contributionType, 'personal_support');
        assert.notEqual(result.journey.state, 'complete');
        assert.equal(result.journey.next.reason, 'stripe_failed');
        assert.equal(result.journey.next.target, 'attention-items');
        const expectedItemId = `${type}:evt_test_personal_followup_${kind}`;
        const next = new URL(
          result.journey.next.adminUrl,
          'https://funding.example.invalid'
        );
        assert.equal(next.pathname, '/admin/fundraiser/attention');
        assert.equal(next.searchParams.get('itemId'), expectedItemId);
        const queue = await getAdminWorkQueue(
          pool,
          { itemId: expectedItemId },
          now
        );
        assert.equal(queue.available, true);
        assert.equal(queue.filteredTotal, 1);
        assert.equal(queue.items[0].type, type);
        assert.equal(
          queue.items[0].facts.reference,
          `evt_test_personal_followup_${kind}`
        );
      }
      for (const kind of ['healthy', 'recent']) {
        const result = await getPaymentJourney(
          snapshotPool,
          payments.get(kind),
          now
        );
        assert.equal(result.status, 'ok');
        assert.equal(result.journey.contributionId, payments.get(kind));
        assert.equal(result.journey.state, 'complete');
        assert.equal(result.journey.next, null);
        assert.deepEqual(
          result.journey.steps.map((step) => step.id),
          ['payment']
        );
      }
      assert.equal(
        (await pool.query('SELECT count(*)::int AS total FROM stripe_events'))
          .rows[0].total,
        4
      );
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int AS total FROM fund_contributions'
          )
        ).rows[0].total,
        5
      );
      assert.equal(
        (await pool.query('SELECT count(*)::int AS total FROM email_messages'))
          .rows[0].total,
        0
      );
      assert.equal(snapshots.length, 5);
    } finally {
      await stop();
    }
  }
);
