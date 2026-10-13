import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Stripe from 'stripe';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { upsertCheckoutSessionFromWebhook } from '../../dist/apps/funding-api/src/fund-contributions.repository.js';
import { createSponsorshipInvoiceForStripeSession } from '../../dist/apps/funding-api/src/sponsorship-invoices.repository.js';
import { processStripeWebhook } from '../../dist/apps/funding-api/src/stripe-webhook.service.js';
import { backfillDisputes } from '../../dist/apps/funding-api/src/stripe-backfill/disputes.js';
import { syncStripeChargeRefunds } from '../../dist/apps/funding-api/src/stripe-refunds.service.js';
import { activeClaimSql } from '../../dist/apps/funding-api/src/publication-automation/claims.js';
import { PublicationAutomationService } from '../../dist/apps/funding-api/src/publication-automation/service.js';
import { composePublicationRecognition } from '../../dist/packages/funding-core/src/index.js';
import {
  approveFixtureSubject,
  fixtureModerationDecision
} from './support/moderation-fixture.mjs';
import { recordFixtureSponsorshipAgreement } from './support/sponsorship-agreement-fixture.mjs';

const signer = new Stripe('sk_test_synthetic_reconciliation', {
  host: '127.0.0.1',
  port: 1,
  protocol: 'http',
  maxNetworkRetries: 0
});
const secret = 'whsec_synthetic_reconciliation';

async function fixture(pool, { invoice = true, attached = true } = {}) {
  const suffix = randomUUID().replaceAll('-', '');
  const intent = {
    id: 'pi_' + suffix,
    status: 'succeeded',
    amount: 10000,
    amount_received: 10000,
    currency: 'cad',
    metadata: { projectId: 'openg7' }
  };
  const input = {
    stripeSessionId: 'cs_' + suffix,
    stripePaymentIntentId: intent.id,
    publicReference: null,
    contributionType: 'sponsorship_interest',
    amountCents: 10000,
    currency: 'cad',
    metadata: intent.metadata,
    publicDisplayConsent: false,
    publicName: null,
    displayAmountConsent: false,
    nonCharityAcknowledged: true,
    sponsorshipFollowupTokenHash: null,
    status: 'paid',
    paidAtIso: new Date().toISOString(),
    emailPrivate: 'synthetic@example.test'
  };
  if (attached) await upsertCheckoutSessionFromWebhook(pool, input);
  const id = attached
    ? (
        await pool.query(
          'SELECT id FROM fund_contributions WHERE stripe_session_id=$1',
          [input.stripeSessionId]
        )
      ).rows[0].id
    : randomUUID();
  const invoiceInput = { ...input, customerEmail: 'synthetic@example.test' };
  if (invoice)
    await createSponsorshipInvoiceForStripeSession(pool, invoiceInput);
  const refund = {
    id: 're_' + suffix,
    object: 'refund',
    status: 'succeeded',
    payment_intent: intent.id,
    charge: 'ch_' + suffix,
    amount: 2000,
    currency: 'cad',
    created: Math.floor(Date.now() / 1000),
    balance_transaction: null,
    metadata: {}
  };
  const charge = {
    id: refund.charge,
    object: 'charge',
    status: 'succeeded',
    payment_intent: intent.id,
    amount: 10000,
    currency: 'cad',
    refunds: { has_more: false, data: [refund] }
  };
  const dispute = {
    id: 'dp_' + suffix,
    object: 'dispute',
    payment_intent: intent.id,
    charge: charge.id,
    amount: 10000,
    currency: 'cad',
    status: 'needs_response'
  };
  let failProvider = false;
  const disputes = [dispute];
  const stripe = {
    webhooks: signer.webhooks,
    charges: { retrieve: async () => structuredClone(charge) },
    paymentIntents: { retrieve: async () => structuredClone(intent) },
    refunds: { retrieve: async () => structuredClone(refund) },
    disputes: {
      retrieve: async () => {
        if (failProvider) throw new Error('Synthetic provider outage');
        return structuredClone(dispute);
      },
      list: async function* (params) {
        yield* params.payment_intent ? disputes : [dispute];
      }
    }
  };
  const deliver = async (
    type,
    object,
    eventId = 'evt_' + randomUUID(),
    signature
  ) => {
    const raw = JSON.stringify({ id: eventId, type, data: { object } });
    return processStripeWebhook(
      raw,
      signature ??
        signer.webhooks.generateTestHeaderString({ payload: raw, secret }),
      {
        stripe,
        webhookSecret: secret,
        pool,
        projectId: 'openg7',
        publicBaseUrl: 'https://example.test'
      }
    );
  };
  return {
    id,
    intent,
    input,
    invoiceInput,
    refund,
    charge,
    dispute,
    disputes,
    stripe,
    deliver,
    failProvider(value) {
      failProvider = value;
    }
  };
}

async function reapprovePublication(pool, f, delivery, batch) {
  // A fresh, explicit API approval can authorize the recovered source.
  // Reuse the ordinary edit/approval workflow; resolution alone did none.
  await pool.query(
    "UPDATE fund_contributions SET public_display_consent=true,sponsor_review_status='approved',sponsor_company_name='Synthetic sponsor',sponsor_public_summary='Synthetic' WHERE id=$1",
    [f.id]
  );
  await approveFixtureSubject(pool, { type: 'sponsorship', id: f.id });
  await recordFixtureSponsorshipAgreement(pool, f.id, {
    channel: 'facebook',
    target: 'openg7'
  });
  const service = new PublicationAutomationService(
    pool,
    {},
    { SOCIAL_PUBLICATION_MODE: 'mock' }
  );
  await service.command(
    { action: 'check', feedId: 'openg7:facebook' },
    'synthetic-reviewer'
  );
  const current = (await service.state()).deliveries.find(
    (job) => job.id === delivery
  );
  const source = (
    await pool.query(
      'SELECT id,contribution_id AS "contributionId",title,body,disclosure_text AS "disclosureText" FROM sponsor_publication_drafts WHERE batch_id=$1',
      [batch]
    )
  ).rows[0];
  await service.command(
    {
      action: 'edit',
      id: delivery,
      version: current.version,
      message: composePublicationRecognition([
        { ...source, name: 'Synthetic sponsor' }
      ]),
      scheduledAt: new Date(Date.now() + 60000).toISOString(),
      confirmation: delivery
    },
    'synthetic-reviewer'
  );
  const draft = (await service.state()).deliveries.find(
    (job) => job.id === delivery
  );
  await service.command(
    {
      action: 'approve',
      id: delivery,
      version: draft.version,
      confirmation: delivery,
      moderationDecision: await fixtureModerationDecision(pool, {
        type: 'publication_delivery',
        id: delivery
      })
    },
    'synthetic-reviewer'
  );
  const reapproved = (
    await pool.query(
      'SELECT status,error_code,approved_by FROM publication_deliveries WHERE id=$1',
      [delivery]
    )
  ).rows[0];
  assert.deepEqual(reapproved, {
    status: 'approved',
    error_code: null,
    approved_by: 'synthetic-reviewer'
  });
  assert.equal((await state(pool, f.id)).held, true);
}

const state = async (pool, id) =>
  (
    await pool.query(
      'SELECT status,sponsor_site_visibility_held AS held FROM fund_contributions WHERE id=$1',
      [id]
    )
  ).rows[0];
const documents = async (pool) =>
  (
    await pool.query(
      'SELECT stripe_refund_id,total_cents,issued_at,line_items FROM sponsorship_credit_notes ORDER BY stripe_refund_id'
    )
  ).rows;

test(
  'external refunds and dispute resolution retain accounting and editorial boundaries',
  { timeout: 120000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    t.beforeEach(() =>
      pool.query(
        'TRUNCATE fund_contributions,stripe_checkout_sessions,stripe_events,fund_transactions,email_messages,admin_audit_log CASCADE'
      )
    );

    await t.test(
      'one external update issues each confirmed partial/full credit note once across repeats and silent backfill',
      async () => {
        const f = await fixture(pool);
        f.charge.refunds.data.push({
          ...f.refund,
          id: f.refund.id + '_remaining',
          amount: 8000
        });
        for (const response of await Promise.all([
          f.deliver('refund.updated', f.refund),
          f.deliver('charge.refunded', f.charge)
        ]))
          assert.equal(response.statusCode, 200);
        const issued = await documents(pool);
        assert.equal(issued.length, 2);
        assert.deepEqual(
          issued.map((n) => n.total_cents).sort((a, b) => a - b),
          [2000, 8000]
        );
        assert.equal((await state(pool, f.id)).status, 'refunded');
        await syncStripeChargeRefunds(f.stripe, pool, f.charge, {
          paymentIntentId: f.intent.id,
          source: 'stripe_backfill'
        });
        assert.deepEqual(await documents(pool), issued);
        assert.equal(
          (await pool.query('SELECT count(*)::int n FROM fund_transactions'))
            .rows[0].n,
          2
        );
        assert.equal(
          (await pool.query('SELECT count(*)::int n FROM email_messages'))
            .rows[0].n,
          0
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM admin_audit_log WHERE action='sponsorship_refund.credit_note'"
            )
          ).rows[0].n,
          2
        );
      }
    );

    await t.test(
      'missing invoice fails durably and redelivery completes documents after invoice recovery',
      async () => {
        const f = await fixture(pool, { invoice: false });
        const event = 'evt_' + randomUUID();
        assert.equal(
          (await f.deliver('refund.updated', f.refund, event)).statusCode,
          500
        );

        assert.equal(
          (await pool.query('SELECT count(*)::int n FROM fund_transactions'))
            .rows[0].n,
          1
        );
        assert.equal((await documents(pool)).length, 0);
        await createSponsorshipInvoiceForStripeSession(pool, f.invoiceInput);
        assert.equal(
          (await f.deliver('refund.updated', f.refund, event)).statusCode,
          200
        );
        assert.equal((await documents(pool)).length, 1);
        assert.equal(
          (await pool.query('SELECT count(*)::int n FROM fund_transactions'))
            .rows[0].n,
          1
        );
      }
    );

    await t.test(
      'credit note and its audit roll back together then retry without a second financial fact',
      async () => {
        const f = await fixture(pool);
        await pool.query(
          `CREATE FUNCTION synthetic_fail_refund_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sponsorship_refund.credit_note' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_fail_refund_audit()`
        );

        try {
          assert.equal(
            (await f.deliver('refund.updated', f.refund)).statusCode,
            500
          );
          assert.equal((await documents(pool)).length, 0);
        } finally {
          await pool.query(
            'DROP TRIGGER synthetic_audit_failure ON admin_audit_log; DROP FUNCTION synthetic_fail_refund_audit()'
          );
        }
        assert.equal(
          (await f.deliver('refund.updated', f.refund)).statusCode,
          200
        );
        assert.equal((await documents(pool)).length, 1);
        assert.equal(
          (await pool.query('SELECT count(*)::int n FROM fund_transactions'))
            .rows[0].n,
          1
        );
      }
    );

    await t.test(
      'a known personal contribution reconciles its refund without sponsorship documents',
      async () => {
        const f = await fixture(pool, { invoice: false });
        await pool.query(
          "UPDATE fund_contributions SET contribution_type='personal_support' WHERE id=$1",
          [f.id]
        );
        assert.equal(
          (await f.deliver('refund.updated', f.refund)).statusCode,
          200
        );
        assert.equal((await documents(pool)).length, 0);
        assert.equal(
          (await pool.query('SELECT count(*)::int n FROM fund_transactions'))
            .rows[0].n,
          1
        );
      }
    );

    await t.test(
      'refund arriving before Checkout remains retryable until contribution and invoice attach',
      async () => {
        const f = await fixture(pool, { invoice: false, attached: false });
        const event = 'evt_' + randomUUID();
        assert.equal(
          (await f.deliver('refund.updated', f.refund, event)).statusCode,
          500
        );
        assert.equal(
          (
            await pool.query(
              'SELECT processing_status FROM stripe_events WHERE stripe_event_id=$1',
              [event]
            )
          ).rows[0].processing_status,
          'failed'
        );
        assert.equal(
          (await pool.query('SELECT count(*)::int n FROM fund_transactions'))
            .rows[0].n,
          1
        );
        await upsertCheckoutSessionFromWebhook(pool, f.input);
        await createSponsorshipInvoiceForStripeSession(pool, f.invoiceInput);
        assert.equal(
          (await f.deliver('refund.updated', f.refund, event)).statusCode,
          200
        );
        assert.equal((await documents(pool)).length, 1);
        assert.equal(
          (await pool.query('SELECT count(*)::int n FROM fund_transactions'))
            .rows[0].n,
          1
        );
      }
    );

    await t.test(
      'won closure restores payment once and delayed created cannot restore publication authorization',
      async () => {
        const f = await fixture(pool);
        await pool.query(
          'UPDATE fund_contributions SET sponsor_site_visibility_held=false WHERE id=$1',
          [f.id]
        );
        const batch = (
          await pool.query(
            "INSERT INTO sponsor_publication_batches(channel,capacity) VALUES('facebook',5) RETURNING id"
          )
        ).rows[0].id;
        await pool.query(
          "INSERT INTO sponsor_publication_drafts(contribution_id,batch_id,feed_target,channel,title,body,disclosure_text) VALUES($1,$2,'openg7','facebook','Synthetic','Synthetic','Synthetic')",
          [f.id, batch]
        );
        const delivery = (
          await pool.query(
            "INSERT INTO publication_deliveries(feed_id,kind,batch_id,message,scheduled_at,account_id,mode,status,approved_at,approved_by) VALUES('openg7:facebook','sponsorship',$1,'Synthetic',NOW(),'synthetic','mock','approved',NOW(),'synthetic-admin') RETURNING id",
            [batch]
          )
        ).rows[0].id;
        const stale = structuredClone(f.dispute);
        assert.equal(
          (await f.deliver('charge.dispute.created', stale)).statusCode,
          200
        );
        assert.equal((await state(pool, f.id)).status, 'disputed');
        f.dispute.status = 'won';
        assert.equal(
          (await f.deliver('charge.dispute.closed', f.dispute)).statusCode,
          200
        );
        assert.deepEqual(await state(pool, f.id), {
          status: 'paid',
          held: true
        });
        assert.equal(
          (await f.deliver('charge.dispute.created', stale)).statusCode,
          200
        );
        assert.deepEqual(await state(pool, f.id), {
          status: 'paid',
          held: true
        });
        const d = (
          await pool.query(
            'SELECT status,approved_at,approved_by,error_code FROM publication_deliveries WHERE id=$1',
            [delivery]
          )
        ).rows[0];
        assert.deepEqual(d, {
          status: 'blocked',
          approved_at: null,
          approved_by: null,
          error_code: 'PAYMENT_REVIEW_REQUIRED'
        });
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM admin_audit_log WHERE action='contribution.dispute_resolved'"
            )
          ).rows[0].n,
          1
        );
        await reapprovePublication(pool, f, delivery, batch);
      }
    );

    await t.test(
      'won-first blocks old approvals once and preserves explicit reapproval across delayed events and backfill',
      async () => {
        const f = await fixture(pool);
        await pool.query(
          'UPDATE fund_contributions SET sponsor_site_visibility_held=false WHERE id=$1',
          [f.id]
        );
        const batch = (
          await pool.query(
            "INSERT INTO sponsor_publication_batches(channel,capacity) VALUES('facebook',5) RETURNING id"
          )
        ).rows[0].id;
        await pool.query(
          "INSERT INTO sponsor_publication_drafts(contribution_id,batch_id,feed_target,channel,title,body,disclosure_text) VALUES($1,$2,'openg7','facebook','Synthetic','Synthetic','Synthetic')",
          [f.id, batch]
        );
        const delivery = (
          await pool.query(
            "INSERT INTO publication_deliveries(feed_id,kind,batch_id,message,scheduled_at,account_id,mode,status,approved_at,approved_by) VALUES('openg7:facebook','sponsorship',$1,'Synthetic',NOW(),'synthetic','mock','approved',NOW(),'synthetic-admin') RETURNING id",
            [batch]
          )
        ).rows[0].id;
        const stale = structuredClone(f.dispute);
        f.dispute.status = 'won';
        // A failed audit must roll back the hold and authorization change too.
        await pool.query(
          `CREATE FUNCTION synthetic_fail_dispute_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='contribution.dispute_reconciled' THEN RAISE EXCEPTION 'Synthetic marker failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER synthetic_dispute_audit_failure BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_fail_dispute_audit()`
        );
        const event = 'evt_' + randomUUID();
        try {
          assert.equal(
            (await f.deliver('charge.dispute.closed', f.dispute, event))
              .statusCode,
            500
          );
          assert.deepEqual(await state(pool, f.id), {
            status: 'paid',
            held: false
          });
          assert.equal(
            (
              await pool.query(
                'SELECT status FROM publication_deliveries WHERE id=$1',
                [delivery]
              )
            ).rows[0].status,
            'approved'
          );
        } finally {
          await pool.query(
            'DROP TRIGGER synthetic_dispute_audit_failure ON admin_audit_log; DROP FUNCTION synthetic_fail_dispute_audit()'
          );
        }
        assert.equal(
          (await f.deliver('charge.dispute.closed', f.dispute, event))
            .statusCode,
          200
        );
        assert.deepEqual(await state(pool, f.id), {
          status: 'paid',
          held: true
        });
        assert.equal(
          (
            await pool.query(
              'SELECT status FROM publication_deliveries WHERE id=$1',
              [delivery]
            )
          ).rows[0].status,
          'blocked'
        );
        await reapprovePublication(pool, f, delivery, batch);
        // Model the independently authorized visibility decision; Stripe must
        // preserve this newer local decision as well as the real API approval.
        await pool.query(
          'UPDATE fund_contributions SET sponsor_site_visibility_held=false WHERE id=$1',
          [f.id]
        );
        const approved = (
          await pool.query(
            'SELECT status,version,approved_at,approved_by,error_code FROM publication_deliveries WHERE id=$1',
            [delivery]
          )
        ).rows[0];
        for (const response of await Promise.all([
          f.deliver('charge.dispute.created', stale),
          f.deliver('charge.dispute.closed', f.dispute)
        ]))
          assert.equal(response.statusCode, 200);
        await backfillDisputes(
          f.stripe,
          pool,
          {
            includeDisputes: true,
            includeUnmatched: false,
            projectId: 'openg7',
            dryRun: false,
            maxRecords: 10
          },
          {
            disputes: {
              scanned: 0,
              matched: 0,
              statusUpdated: 0,
              dryRunWouldUpdate: 0
            }
          }
        );
        assert.deepEqual(
          (
            await pool.query(
              'SELECT status,version,approved_at,approved_by,error_code FROM publication_deliveries WHERE id=$1',
              [delivery]
            )
          ).rows[0],
          approved
        );
        assert.deepEqual(await state(pool, f.id), {
          status: 'paid',
          held: false
        });
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM admin_audit_log WHERE action='contribution.dispute_reconciled' AND entity_id=$1 AND metadata->>'disputeId'=$2",
              [f.id, f.dispute.id]
            )
          ).rows[0].n,
          1
        );
      }
    );

    await t.test(
      'dispute arriving before Checkout retries after the payment attaches',
      async () => {
        const f = await fixture(pool, { invoice: false, attached: false });
        const event = 'evt_' + randomUUID();
        assert.equal(
          (await f.deliver('charge.dispute.created', f.dispute, event))
            .statusCode,
          500
        );
        assert.equal(
          (
            await pool.query(
              'SELECT processing_status FROM stripe_events WHERE stripe_event_id=$1',
              [event]
            )
          ).rows[0].processing_status,
          'failed'
        );
        await upsertCheckoutSessionFromWebhook(pool, f.input);
        assert.equal(
          (await f.deliver('charge.dispute.created', f.dispute, event))
            .statusCode,
          200
        );
        const contribution = (
          await pool.query(
            'SELECT id FROM fund_contributions WHERE stripe_payment_intent_id=$1',
            [f.intent.id]
          )
        ).rows[0];
        assert.deepEqual(await state(pool, contribution.id), {
          status: 'disputed',
          held: true
        });
      }
    );

    await t.test(
      'backfill of already won dispute preserves paid and current lost/another active dispute remain blocking',
      async () => {
        const f = await fixture(pool);
        f.dispute.status = 'won';
        const summary = {
          disputes: {
            scanned: 0,
            matched: 0,
            statusUpdated: 0,
            dryRunWouldUpdate: 0
          }
        };
        await backfillDisputes(
          f.stripe,
          pool,
          {
            includeDisputes: true,
            includeUnmatched: false,
            projectId: 'openg7',
            dryRun: false,
            maxRecords: 10
          },
          summary
        );
        assert.equal((await state(pool, f.id)).status, 'paid');
        f.dispute.status = 'lost';
        assert.equal(
          (await f.deliver('charge.dispute.closed', f.dispute)).statusCode,
          200
        );
        assert.equal((await state(pool, f.id)).status, 'disputed');
        f.dispute.status = 'won';
        f.disputes.push({
          ...f.dispute,
          id: 'dp_other',
          status: 'needs_response'
        });
        assert.equal(
          (await f.deliver('charge.dispute.updated', f.dispute)).statusCode,
          200
        );
        assert.equal((await state(pool, f.id)).status, 'disputed');
      }
    );

    await t.test(
      'a dispute opened during dispatch fences the existing claim even after a won closure',
      async () => {
        const f = await fixture(pool);
        const batch = (
          await pool.query(
            "INSERT INTO sponsor_publication_batches(channel,capacity) VALUES('facebook',5) RETURNING id"
          )
        ).rows[0].id;
        await pool.query(
          "INSERT INTO sponsor_publication_drafts(contribution_id,batch_id,feed_target,channel,title,body,disclosure_text) VALUES($1,$2,'openg7','facebook','Synthetic','Synthetic','Synthetic')",
          [f.id, batch]
        );
        const d = (
          await pool.query(
            "INSERT INTO publication_deliveries(feed_id,kind,batch_id,message,scheduled_at,account_id,mode,status,approved_at,approved_by,lease_until,external_post_id) VALUES('openg7:facebook','sponsorship',$1,'Synthetic',NOW(),$2,'mock','publishing',NOW(),'synthetic',NOW()+INTERVAL '5 minutes','synthetic-observed-post') RETURNING *",
            [batch, f.intent.id]
          )
        ).rows[0];
        await pool.query(
          "INSERT INTO publication_account_leases(provider,account_id,mode,delivery_id,delivery_version,lease_until) VALUES('facebook',$1,'mock',$2,$3,NOW()+INTERVAL '5 minutes')",
          [f.intent.id, d.id, d.version]
        );
        const claimActive = async () =>
          (
            await pool.query(
              `SELECT id FROM publication_deliveries WHERE id=$1 AND ${activeClaimSql('$2')}`,
              [d.id, d.version]
            )
          ).rowCount === 1;
        assert.equal(await claimActive(), true);
        assert.equal(
          (await f.deliver('charge.dispute.created', f.dispute)).statusCode,
          200
        );
        assert.equal(await claimActive(), false);
        f.dispute.status = 'won';
        assert.equal(
          (await f.deliver('charge.dispute.closed', f.dispute)).statusCode,
          200
        );
        assert.equal(await claimActive(), false);
        const current = (
          await pool.query(
            'SELECT status,error_code,external_post_id FROM publication_deliveries WHERE id=$1',
            [d.id]
          )
        ).rows[0];
        assert.deepEqual(current, {
          status: 'publishing',
          error_code: 'PAYMENT_REVIEW_REQUIRED',
          external_post_id: 'synthetic-observed-post'
        });
        assert.equal((await state(pool, f.id)).status, 'paid');
      }
    );

    await t.test(
      'provider failure, incomplete and over-cap pagination are retryable and never restore paid',
      async () => {
        const f = await fixture(pool);
        await f.deliver('charge.dispute.created', f.dispute);
        f.dispute.status = 'won';
        const event = 'evt_' + randomUUID();
        f.failProvider(true);
        assert.equal(
          (await f.deliver('charge.dispute.closed', f.dispute, event))
            .statusCode,
          500
        );
        assert.equal((await state(pool, f.id)).status, 'disputed');
        f.failProvider(false);
        f.disputes.length = 0;
        assert.equal(
          (await f.deliver('charge.dispute.closed', f.dispute, event))
            .statusCode,
          500
        );
        f.disputes.push(
          ...Array.from({ length: 101 }, (_, i) => ({
            ...f.dispute,
            id: i ? 'dp_' + i : f.dispute.id
          }))
        );
        assert.equal(
          (await f.deliver('charge.dispute.closed', f.dispute, event))
            .statusCode,
          500
        );
        assert.equal((await state(pool, f.id)).status, 'disputed');
        f.disputes.splice(1);
        assert.equal(
          (await f.deliver('charge.dispute.closed', f.dispute, event))
            .statusCode,
          200
        );
        assert.equal((await state(pool, f.id)).status, 'paid');
      }
    );

    await t.test(
      'charge-only events resolve references and signatures/full refunds remain authoritative',
      async () => {
        const f = await fixture(pool);
        const chargeOnly = { ...f.dispute, payment_intent: null };
        assert.equal(
          (
            await f.deliver(
              'charge.dispute.created',
              chargeOnly,
              'evt_invalid',
              'invalid'
            )
          ).statusCode,
          400
        );
        assert.equal((await state(pool, f.id)).status, 'paid');
        assert.equal(
          (await f.deliver('charge.dispute.created', chargeOnly)).statusCode,
          200
        );
        assert.equal((await state(pool, f.id)).status, 'disputed');
        f.refund.amount = 10000;
        assert.equal(
          (await f.deliver('refund.updated', f.refund)).statusCode,
          200
        );
        f.dispute.status = 'won';
        assert.equal(
          (await f.deliver('charge.dispute.closed', f.dispute)).statusCode,
          200
        );
        assert.equal((await state(pool, f.id)).status, 'refunded');
      }
    );

    await t.test(
      'inconsistent provider monetary facts fail without mutating the local payment',
      async () => {
        const f = await fixture(pool);
        f.intent.currency = 'usd';
        assert.equal(
          (await f.deliver('charge.dispute.created', f.dispute)).statusCode,
          500
        );
        assert.equal((await state(pool, f.id)).status, 'paid');
        f.intent.currency = 'cad';
        f.intent.amount_received = 9000;
        assert.equal(
          (await f.deliver('charge.dispute.created', f.dispute)).statusCode,
          500
        );
        assert.equal((await state(pool, f.id)).status, 'paid');
      }
    );
  }
);
