import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { startDisposablePostgres } from './support/disposable-postgres.mjs';

process.env.FUNDING_SPONSORSHIP_INVOICE_PREFIX = 'OG7-CMD';
process.env.FUNDING_SPONSORSHIP_CREDIT_NOTE_PREFIX = 'OG7-AV';
process.env.FUNDING_SPONSORSHIP_CREDIT_NOTE_LEGAL_NOTE = '';
const { createSponsorshipCreditNoteForRefund } =
  await import('../../dist/apps/funding-api/src/sponsorship-invoices.repository.js');

test(
  'Refund credit notes on disposable PostgreSQL',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const seedInvoice = async (number) => {
      const session = 'cs_credit_note_' + randomUUID();
      const contributionId = (
        await pool.query(
          `
      INSERT INTO fund_contributions
        (contribution_type, amount_cents, currency, status, paid_at, stripe_session_id)
      VALUES ('sponsorship_interest', 50000, 'cad', 'paid', NOW(), $1)
      RETURNING id`,
          [session]
        )
      ).rows[0].id;
      return (
        await pool.query(
          `
      INSERT INTO sponsorship_invoices
        (contribution_id, invoice_number, stripe_session_id, currency,
         subtotal_cents, total_cents, issuer_name, sponsor_name, notes)
      VALUES ($1, $2, $3, 'cad', 50000, 50000, 'OpenG7', 'Synthetic company', 'Original invoice')
      RETURNING *`,
          [contributionId, number, session]
        )
      ).rows[0];
    };
    const issue = (invoice, refundId, amount) =>
      createSponsorshipCreditNoteForRefund(pool, {
        contributionId: invoice.contribution_id,
        stripeRefundId: refundId,
        refundAmountCents: amount
      });
    const assertInvoiceUnchanged = async (invoice) => {
      assert.deepEqual(
        (
          await pool.query('SELECT * FROM sponsorship_invoices WHERE id = $1', [
            invoice.id
          ])
        ).rows[0],
        invoice
      );
    };

    for (const number of ['OG7-CMD-2026-MULTIPLE', 'CUSTOM-2026-MULTIPLE']) {
      await t.test(
        `distinct partial credit notes and stable retries for ${number}`,
        async () => {
          const invoice = await seedInvoice(number);
          const firstId = 're_first_' + randomUUID();
          const secondId = 're_second_' + randomUUID();
          const first = await issue(invoice, firstId, 20000);
          const second = await issue(invoice, secondId, 30000);
          assert.notEqual(first.id, second.id);
          assert.notEqual(first.creditNoteNumber, second.creditNoteNumber);
          assert.equal(first.totalCents + second.totalCents, 50000);
          for (const note of [first, second]) {
            assert.equal(note.invoiceId, invoice.id);
            assert.equal(note.currency, 'CAD');
            assert.match(
              note.lineItems[0].description,
              /remboursement partiel/
            );
            assert.match(note.notes, /du montant indique/);
          }
          const retries = await Promise.all([
            issue(invoice, firstId, 20000),
            issue(invoice, firstId, 20000),
            issue(invoice, secondId, 30000)
          ]);
          assert.deepEqual(retries, [first, first, second]);
          assert.equal(
            (
              await pool.query(
                'SELECT count(*)::int AS count FROM sponsorship_credit_notes WHERE invoice_id = $1',
                [invoice.id]
              )
            ).rows[0].count,
            2
          );
          await assertInvoiceUnchanged(invoice);
        }
      );
    }

    await t.test(
      'a single full refund is explicit and leaves the original invoice intact',
      async () => {
        const invoice = await seedInvoice('OG7-CMD-2026-FULL');
        const note = await issue(invoice, 're_full', 50000);
        assert.equal(note.totalCents, 50000);
        assert.match(note.lineItems[0].description, /remboursement complet/);
        assert.match(note.notes, /du montant indique/);
        await assertInvoiceUnchanged(invoice);
      }
    );

    await t.test(
      'legacy issued credit notes keep their number and snapshot when retried',
      async () => {
        const invoice = await seedInvoice('OG7-CMD-2026-LEGACY');
        await pool.query(
          `
      INSERT INTO sponsorship_credit_notes
        (invoice_id, contribution_id, credit_note_number, invoice_number,
         stripe_refund_id, currency, subtotal_cents, total_cents, issuer_name,
         sponsor_name, notes, line_items)
      VALUES ($1, $2, 'OG7-AV-2026-LEGACY', $3, 're_legacy', 'cad', 20000, 20000,
        'Historical issuer', 'Historical company', 'Historical wording',
        '[{"description":"Historical line","quantity":1,"unitAmountCents":20000,"totalCents":20000}]')`,
          [invoice.id, invoice.contribution_id, invoice.invoice_number]
        );
        const historical = async () =>
          (
            await pool.query(`
      SELECT to_jsonb(note) - 'updated_at' AS snapshot
      FROM sponsorship_credit_notes note WHERE stripe_refund_id = 're_legacy'`)
          ).rows[0].snapshot;
        const before = await historical();
        const retried = await issue(invoice, 're_legacy', 20000);
        assert.equal(retried.creditNoteNumber, 'OG7-AV-2026-LEGACY');
        assert.deepEqual(await historical(), before);
        const remaining = await issue(invoice, 're_legacy_remaining', 30000);
        assert.notEqual(remaining.creditNoteNumber, retried.creditNoteNumber);
        assert.match(
          remaining.lineItems[0].description,
          /remboursement partiel/
        );
        assert.deepEqual(await historical(), before);
        await assertInvoiceUnchanged(invoice);
      }
    );
  }
);
