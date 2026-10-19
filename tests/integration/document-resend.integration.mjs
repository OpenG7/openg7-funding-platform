import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { readAdminDocumentResendReceipt } from '../../dist/apps/funding-api/src/admin-document-resend-receipts.repository.js';
import { queueAdminDocumentResend } from '../../dist/apps/funding-api/src/admin-document-resend.service.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';

const invoice = () => ({
  id: randomUUID(),
  contributionId: randomUUID(),
  invoiceNumber: 'OG7-SYNTHETIC',
  publicReference: 'OG7-TEST',
  stripeSessionId: 'cs_test_document',
  stripePaymentIntentId: null,
  issuedAtIso: '2026-09-01T00:00:00.000Z',
  paidAtIso: '2026-09-01T00:00:00.000Z',
  currency: 'CAD',
  subtotalCents: 50000,
  taxCents: 0,
  totalCents: 50000,
  taxLabel: '',
  issuerName: 'OpenG7 test',
  issuerEmail: null,
  issuerAddress: null,
  issuerTaxId: null,
  sponsorName: 'Entreprise synthétique',
  sponsorContactName: 'Contact synthétique',
  sponsorContactEmail: 'original@example.test',
  sponsorWebsiteUrl: null,
  lineItems: [
    {
      description: 'Commandite synthétique',
      quantity: 1,
      unitAmountCents: 50000,
      totalCents: 50000
    }
  ],
  notes: null
});

test(
  'document resend serializes requests, binds the payload and commits queue/audit together without sending',
  { timeout: 90000 },
  async (t) => {
    const db = await startDisposablePostgres();
    t.after(db.stop);
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          [
            'email_messages',
            'admin_audit_log',
            'sponsorship_invoices',
            'sponsorship_credit_notes'
          ].map(async (table) => [
            table,
            (await db.pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows
          ])
        )
      );
    for (const kind of ['invoice', 'creditNote']) {
      await t.test(kind, async () => {
        const original = invoice();
        const document =
          kind === 'invoice'
            ? original
            : {
                ...original,
                id: randomUUID(),
                invoiceId: original.id,
                creditNoteNumber: 'OG7-CN-SYNTHETIC',
                stripeRefundId: 're_test_document'
              };
        const input = {
          [kind]: document,
          to: 'corrected@example.test',
          requestId: randomUUID()
        };
        const receiptRequest = {
          requestId: input.requestId,
          documentKind: kind === 'invoice' ? 'invoice' : 'credit_note',
          documentId: document.id
        };
        const beforeMissingRead = await snapshot();
        assert.deepEqual(
          await readAdminDocumentResendReceipt(
            db.pool,
            receiptRequest,
            'fixture'
          ),
          { ...receiptRequest, found: false }
        );
        assert.deepEqual(await snapshot(), beforeMissingRead);
        const results = await Promise.all(
          Array.from({ length: 6 }, () =>
            queueAdminDocumentResend(db.pool, input, 'fixture')
          )
        );
        assert.equal(new Set(results.map((r) => r.messageId)).size, 1);
        assert.ok(results.every((r) => r.queued && !r.attempted && !r.sent));
        const messageId = results[0].messageId;
        assert.equal(
          (
            await queueAdminDocumentResend(
              db.pool,
              { ...input, requestId: input.requestId.toUpperCase() },
              'fixture'
            )
          ).messageId,
          messageId
        );
        const message = (
          await db.pool.query('SELECT * FROM email_messages WHERE id=$1', [
            messageId
          ])
        ).rows[0];
        assert.equal(message.recipient_email, input.to);
        assert.equal(message.status, 'queued');
        assert.equal(message.attempts, 0);
        const audits = (
          await db.pool.query(
            'SELECT * FROM admin_audit_log WHERE entity_id=$1',
            [document.id]
          )
        ).rows;
        assert.equal(audits.length, 1);
        assert.equal(
          audits[0].action,
          kind === 'invoice'
            ? 'sponsorship_invoice.resend'
            : 'sponsorship_credit_note.resend'
        );
        assert.equal(audits[0].metadata.requestId, input.requestId);
        assert.ok(!JSON.stringify(audits).includes(input.to));
        await assert.rejects(
          queueAdminDocumentResend(
            db.pool,
            { ...input, to: 'other@example.test' },
            'fixture'
          ),
          { code: 'REQUEST_CONFLICT' }
        );
        await assert.rejects(
          queueAdminDocumentResend(
            db.pool,
            { ...input, [kind]: { ...document, id: randomUUID() } },
            'fixture'
          ),
          { code: 'REQUEST_CONFLICT' }
        );
        // A repeated HTTP request cannot reset delivery backoff or manufacture another attempt.
        await db.pool.query(
          "UPDATE email_messages SET status='failed',attempts=2,last_error='EMAIL_TRANSPORT' WHERE id=$1",
          [messageId]
        );
        assert.equal(
          (await queueAdminDocumentResend(db.pool, input, 'fixture')).messageId,
          messageId
        );
        assert.equal(
          (
            await db.pool.query(
              'SELECT attempts FROM email_messages WHERE id=$1',
              [messageId]
            )
          ).rows[0].attempts,
          2
        );
        await db.pool.query(
          "UPDATE email_messages SET status='sent',sent_at=NOW() WHERE id=$1",
          [messageId]
        );
        assert.deepEqual(
          await queueAdminDocumentResend(db.pool, input, 'fixture'),
          {
            queued: false,
            attempted: false,
            sent: true,
            messageId,
            error: null
          }
        );
        // Receipt reads observe the committed command and current worker state,
        // without retrying delivery, resetting backoff or changing the document.
        const sentAt = '2026-10-19T18:30:00.000Z';
        for (const deliveryStatus of [
          'queued',
          'sending',
          'sent',
          'failed',
          'uncertain'
        ]) {
          await db.pool.query(
            `UPDATE email_messages SET status=$2, attempts=3,
              delivery_attempt_id=$3, next_attempt_at='2030-01-01T00:00:00Z',
              last_error='SYNTHETIC_DELIVERY_STATE', sent_at=$4 WHERE id=$1`,
            [
              messageId,
              deliveryStatus,
              randomUUID(),
              deliveryStatus === 'sent' ? sentAt : null
            ]
          );
          const beforeReads = await snapshot();
          const receipt = await readAdminDocumentResendReceipt(
            db.pool,
            {
              ...receiptRequest,
              requestId: receiptRequest.requestId.toUpperCase(),
              documentId: receiptRequest.documentId.toUpperCase()
            },
            'fixture'
          );
          assert.deepEqual(receipt, {
            ...receiptRequest,
            found: true,
            messageId,
            acceptedAt: audits[0].created_at.toISOString(),
            deliveryStatus,
            sentAt: deliveryStatus === 'sent' ? sentAt : null
          });
          for (const [request, actor] of [
            [receiptRequest, 'another-synthetic-admin'],
            [
              {
                ...receiptRequest,
                documentKind: kind === 'invoice' ? 'credit_note' : 'invoice'
              },
              'fixture'
            ],
            [{ ...receiptRequest, documentId: randomUUID() }, 'fixture'],
            [{ ...receiptRequest, requestId: randomUUID() }, 'fixture']
          ]) {
            assert.deepEqual(
              await readAdminDocumentResendReceipt(db.pool, request, actor),
              { ...request, found: false }
            );
          }
          assert.deepEqual(await snapshot(), beforeReads);
        }
      });
    }
    await t.test(
      'audit failure rolls back the queued message, allowing the same request to recover',
      async () => {
        await db.pool
          .query(`CREATE FUNCTION fail_document_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit outage'; END $$;
      CREATE TRIGGER fail_document_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION fail_document_audit()`);
        const input = {
          invoice: invoice(),
          to: 'corrected@example.test',
          requestId: randomUUID()
        };
        await assert.rejects(
          queueAdminDocumentResend(db.pool, input, 'fixture')
        );
        assert.equal(
          (
            await db.pool.query(
              'SELECT count(*)::int AS count FROM email_messages WHERE idempotency_key=$1',
              ['admin-document-resend:' + input.requestId]
            )
          ).rows[0].count,
          0
        );
        const receiptRequest = {
          requestId: input.requestId,
          documentKind: 'invoice',
          documentId: input.invoice.id
        };
        assert.deepEqual(
          await readAdminDocumentResendReceipt(
            db.pool,
            receiptRequest,
            'fixture'
          ),
          { ...receiptRequest, found: false }
        );
        await db.pool.query(
          'DROP TRIGGER fail_document_audit ON admin_audit_log'
        );
        const accepted = await queueAdminDocumentResend(
          db.pool,
          input,
          'fixture'
        );
        const receipt = await readAdminDocumentResendReceipt(
          db.pool,
          receiptRequest,
          'fixture'
        );
        assert.equal(receipt.found, true);
        assert.equal(receipt.messageId, accepted.messageId);
      }
    );
  }
);
