import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

import { DEFAULT_SPONSORSHIP_PRICING_CONFIG } from '../../dist/packages/funding-core/src/index.js';
import { startDisposablePostgres } from './support/disposable-postgres.mjs';
import { createSponsorshipInvoiceForStripeSession } from '../../dist/apps/funding-api/src/sponsorship-invoices.repository.js';
import {
  enqueueSponsorshipDocumentEmail,
  queueSponsorshipInvoiceEmail
} from '../../dist/apps/funding-api/src/email-notification.service.js';
import { renderSponsorshipInvoicePdf } from '../../dist/apps/funding-api/src/sponsorship-document-pdf.service.js';

// Read text operands from PDFKit's compressed streams and built-in Helvetica.
// Joining the hex fragments also joins words split by kerning adjustments.
const pdfText = (pdf) =>
  [...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .flatMap((stream) => {
      const content = inflateSync(Buffer.from(stream[1], 'latin1')).toString();
      return [...content.matchAll(/\[([^\]]*)\]\s*TJ/g)].map((operand) =>
        [...operand[1].matchAll(/<([0-9a-f]+)>/gi)]
          .map((fragment) => Buffer.from(fragment[1], 'hex').toString('latin1'))
          .join('')
      );
    })
    .join('\n');

test(
  'issued invoice benefits survive storage, email, PDF, pricing changes and resends',
  { timeout: 90000 },
  async (t) => {
    const { pool, stop } = await startDisposablePostgres();
    t.after(stop);
    const seed = async (amountCents, status = 'paid') => {
      const stripeSessionId = 'cs_invoice_benefits_' + randomUUID();
      await pool.query(
        `INSERT INTO fund_contributions
        (contribution_type, amount_cents, currency, status, paid_at, stripe_session_id)
       VALUES ('sponsorship_interest', $1, 'cad', $2, NOW(), $3)`,
        [amountCents, status, stripeSessionId]
      );
      return {
        stripeSessionId,
        stripePaymentIntentId: null,
        publicReference: null,
        amountCents,
        currency: 'cad',
        paidAtIso: '2026-09-01T12:00:00.000Z',
        customerEmail: 'sponsor@example.test'
      };
    };
    const email = async (messageId) =>
      (
        await pool.query('SELECT * FROM email_messages WHERE id = $1', [
          messageId
        ])
      ).rows[0];

    for (const [amount, expected] of [
      [5000, ['OpenG7.org']],
      [10000, ['OpenG7.org']],
      [25000, ['OpenG7.org', 'Facebook']],
      [37550, ['OpenG7.org', 'Facebook']],
      [50000, ['OpenG7.org', 'Facebook', 'LinkedIn']]
    ]) {
      await t.test(
        `${amount} minor units appear with the right benefits in both email formats and PDF`,
        async () => {
          const input = await seed(amount);
          const invoice = await createSponsorshipInvoiceForStripeSession(
            pool,
            input
          );
          const queued = await queueSponsorshipInvoiceEmail(pool, {
            to: input.customerEmail,
            invoice,
            deferDelivery: true,
            idempotencyKey: input.stripeSessionId
          });
          assert.equal(queued.error, null);
          assert.equal(queued.attempted, false);
          const message = await email(queued.messageId);
          const pdf = await renderSponsorshipInvoicePdf(invoice);
          for (const text of [
            invoice.notes,
            message.text_body,
            message.html_body,
            pdfText(pdf)
          ]) {
            assert.match(text, /Avantages de votre commandite/);
            for (const benefit of ['OpenG7.org', 'Facebook', 'LinkedIn']) {
              assert.equal(
                text.includes(benefit),
                expected.includes(benefit),
                benefit
              );
            }
            assert.match(text, /consentement et une validation administrative/);
            assert.match(text, /Aucune publication/);
          }
          assert.match(
            message.html_body,
            /Avantages de votre commandite :<br \/>- /
          );
          assert.equal(invoice.totalCents, amount);
          assert.equal(invoice.lineItems[0].totalCents, amount);
          assert.equal(invoice.taxCents, 0);

          const threshold =
            DEFAULT_SPONSORSHIP_PRICING_CONFIG.benefits.websiteMention;
          const originalMinimum = threshold.minimumAmount;
          try {
            threshold.minimumAmount = 10000;
            const replay = await createSponsorshipInvoiceForStripeSession(
              pool,
              input
            );
            assert.deepEqual(replay, invoice);
            assert.deepEqual(await renderSponsorshipInvoicePdf(replay), pdf);
            const duplicate = await queueSponsorshipInvoiceEmail(pool, {
              to: input.customerEmail,
              invoice: replay,
              deferDelivery: true,
              idempotencyKey: input.stripeSessionId
            });
            assert.equal(duplicate.duplicate, true);
            assert.equal(duplicate.messageId, queued.messageId);

            const resentId = await enqueueSponsorshipDocumentEmail(pool, {
              to: 'corrected@example.test',
              invoice: replay,
              idempotencyKey: 'resend:' + invoice.id
            });
            const resent = await email(resentId);
            assert.equal(resent.text_body, message.text_body);
            assert.equal(resent.html_body, message.html_body);
            assert.equal(resent.recipient_email, 'corrected@example.test');
            assert.equal(resent.status, 'queued');
          } finally {
            threshold.minimumAmount = originalMinimum;
          }
        }
      );
    }

    await t.test(
      'legacy notes remain unchanged and HTML escapes them before preserving line breaks',
      async () => {
        const input = await seed(50000);
        const invoice = await createSponsorshipInvoiceForStripeSession(
          pool,
          input
        );
        const legacyNotes =
          'Ancienne facture <script> & conditions\nNote originale';
        await pool.query(
          'UPDATE sponsorship_invoices SET notes = $1 WHERE id = $2',
          [legacyNotes, invoice.id]
        );
        const replay = await createSponsorshipInvoiceForStripeSession(
          pool,
          input
        );
        assert.equal(replay.notes, legacyNotes);
        const result = await queueSponsorshipInvoiceEmail(pool, {
          to: input.customerEmail,
          invoice: replay,
          deferDelivery: true,
          idempotencyKey: input.stripeSessionId
        });
        const message = await email(result.messageId);
        assert.ok(message.text_body.includes(legacyNotes));
        assert.match(
          message.html_body,
          /Ancienne facture &lt;script&gt; &amp; conditions<br \/>Note originale/
        );
        assert.doesNotMatch(
          message.html_body,
          /<script>|Avantages de votre commandite|Facebook|LinkedIn/
        );
      }
    );

    await t.test(
      'invoice replay enriches missing sponsor and payment details while preserving the issued snapshot',
      async () => {
        const input = {
          ...(await seed(25000)),
          paidAtIso: null,
          customerEmail: null
        };
        await pool.query(
          'UPDATE fund_contributions SET paid_at = NULL WHERE stripe_session_id = $1',
          [input.stripeSessionId]
        );
        const original = await createSponsorshipInvoiceForStripeSession(
          pool,
          input
        );
        assert.equal(original.sponsorName, 'Commanditaire a confirmer');
        assert.equal(original.publicReference, null);
        assert.equal(original.paidAtIso, null);
        assert.equal(original.sponsorContactEmail, null);
        const publicReference = `OG7-2024-${randomUUID()}`;
        const paymentIntentId = `pi_test_enriched_${randomUUID()}`;
        await pool.query(
          `UPDATE fund_contributions
           SET public_reference = $2, stripe_payment_intent_id = $3,
             paid_at = '2024-01-01T12:00:00Z', amount_cents = 60000,
             currency = 'usd', sponsor_company_name = ' Synthetic company ',
             sponsor_contact_name = 'Synthetic contact',
             sponsor_contact_email = ' contact@example.invalid ',
             sponsor_website_url = 'https://sponsor.example.invalid'
           WHERE stripe_session_id = $1`,
          [input.stripeSessionId, publicReference, paymentIntentId]
        );
        const replayInput = {
          ...input,
          publicReference,
          amountCents: 60000,
          currency: 'usd',
          paidAtIso: '2024-01-01T12:00:00.000Z'
        };
        const enriched = await createSponsorshipInvoiceForStripeSession(
          pool,
          replayInput
        );
        assert.deepEqual(enriched, {
          ...original,
          publicReference,
          stripePaymentIntentId: paymentIntentId,
          paidAtIso: enriched.paidAtIso,
          sponsorName: 'Synthetic company',
          sponsorContactName: 'Synthetic contact',
          sponsorContactEmail: 'contact@example.invalid',
          sponsorWebsiteUrl: 'https://sponsor.example.invalid'
        });
        assert.equal(
          Date.parse(enriched.paidAtIso),
          Date.parse(replayInput.paidAtIso)
        );
        assert.equal(enriched.totalCents, 25000);
        assert.equal(enriched.currency, 'CAD');
        assert.equal(enriched.invoiceNumber, original.invoiceNumber);
        assert.deepEqual(enriched.lineItems, original.lineItems);
        assert.equal(enriched.notes, original.notes);

        await pool.query(
          `UPDATE fund_contributions
           SET public_reference = $2, stripe_payment_intent_id = $3,
             paid_at = '2025-01-01T12:00:00Z',
             sponsor_company_name = 'Later company',
             sponsor_contact_name = 'Later contact',
             sponsor_contact_email = 'later@example.invalid',
             sponsor_website_url = 'https://later.example.invalid'
           WHERE stripe_session_id = $1`,
          [
            input.stripeSessionId,
            `OG7-2025-${randomUUID()}`,
            `pi_test_later_${randomUUID()}`
          ]
        );
        assert.deepEqual(
          await createSponsorshipInvoiceForStripeSession(pool, replayInput),
          enriched,
          'already populated details and issued facts survive later input changes'
        );
        assert.equal(
          (
            await pool.query(
              'SELECT COUNT(*)::int AS count FROM sponsorship_invoices WHERE contribution_id = $1',
              [original.contributionId]
            )
          ).rows[0].count,
          1
        );
      }
    );

    await t.test(
      'concurrent payment deliveries return one invoice without changing its snapshot',
      async () => {
        const input = await seed(37550);
        const invoices = await Promise.all([
          createSponsorshipInvoiceForStripeSession(pool, input),
          createSponsorshipInvoiceForStripeSession(pool, input)
        ]);
        assert.deepEqual(invoices[0], invoices[1]);
        assert.equal(
          (
            await pool.query(
              'SELECT COUNT(*)::int AS count FROM sponsorship_invoices WHERE contribution_id = $1',
              [invoices[0].contributionId]
            )
          ).rows[0].count,
          1
        );
      }
    );

    await t.test(
      'refunded and disputed sponsorships remain eligible while a paid personal contribution does not',
      async () => {
        for (const status of ['refunded', 'disputed']) {
          const input = await seed(25000, status);
          assert.ok(
            await createSponsorshipInvoiceForStripeSession(pool, input),
            status
          );
        }
        const personal = await seed(25000);
        await pool.query(
          "UPDATE fund_contributions SET contribution_type = 'personal_support' WHERE stripe_session_id = $1",
          [personal.stripeSessionId]
        );
        assert.equal(
          await createSponsorshipInvoiceForStripeSession(pool, personal),
          null
        );
      }
    );

    await t.test(
      'pending payment creates no invoice or benefits document',
      async () => {
        const input = await seed(50000, 'pending');
        assert.equal(
          await createSponsorshipInvoiceForStripeSession(pool, input),
          null
        );
      }
    );
  }
);
