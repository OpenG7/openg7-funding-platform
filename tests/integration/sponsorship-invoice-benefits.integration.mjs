import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
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
    const snapshot = async (invoiceId, database = pool) =>
      (
        await database.query(
          'SELECT to_jsonb(invoice) AS snapshot FROM sponsorship_invoices invoice WHERE id = $1',
          [invoiceId]
        )
      ).rows[0].snapshot;
    // A new process loads genuinely different startup settings. It connects only
    // to this helper's loopback database and imports no SMTP or Stripe adapter.
    const issueWithChangedSettings = async (input) => {
      const writerUrl = new URL(
        '../../dist/apps/funding-api/src/sponsorship-documents/invoices.write.js',
        import.meta.url
      ).href;
      const script = `
        import pg from 'pg';
        import { createSponsorshipInvoiceForStripeSession } from ${JSON.stringify(writerUrl)};
        const pool = new pg.Pool(JSON.parse(process.env.OPENG7_TEST_INVOICE_PG));
        try {
          const invoice = await createSponsorshipInvoiceForStripeSession(
            pool, JSON.parse(process.env.OPENG7_TEST_INVOICE_INPUT));
          process.stdout.write(JSON.stringify(invoice));
        } finally { await pool.end(); }
      `;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['--input-type=module', '-e', script],
        {
          windowsHide: true,
          timeout: 15000,
          env: {
            ...process.env,
            OPENG7_TEST_INVOICE_PG: JSON.stringify({
              host: pool.options.host,
              port: pool.options.port,
              user: pool.options.user,
              password: pool.options.password,
              database: pool.options.database,
              ssl: false,
              max: 1,
              connectionTimeoutMillis: 1000
            }),
            OPENG7_TEST_INVOICE_INPUT: JSON.stringify(input),
            FUNDING_SPONSORSHIP_INVOICE_PREFIX: 'SYNTHETIC-NEW',
            FUNDING_INVOICE_ISSUER_NAME: 'Changed synthetic issuer',
            FUNDING_INVOICE_ISSUER_EMAIL: 'changed-issuer@example.invalid',
            FUNDING_INVOICE_ISSUER_ADDRESS: 'Changed synthetic address',
            FUNDING_INVOICE_TAX_ID: 'Changed synthetic tax ID',
            FUNDING_SPONSORSHIP_INVOICE_TAX_LABEL:
              'Changed synthetic tax label',
            FUNDING_SPONSORSHIP_INVOICE_LEGAL_NOTE: 'Changed synthetic policy'
          }
        }
      );
      return JSON.parse(stdout);
    };

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
      'replays retain missing details, placeholder, timestamps and the entire issued snapshot',
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
        assert.equal(original.sponsorContactName, null);
        assert.equal(original.sponsorWebsiteUrl, null);
        assert.equal(original.stripePaymentIntentId, null);
        const stored = await snapshot(original.id);
        const originalPdf = await renderSponsorshipInvoicePdf(original);
        const originalEmail = await queueSponsorshipInvoiceEmail(pool, {
          to: 'original@example.invalid',
          invoice: original,
          deferDelivery: true,
          idempotencyKey: 'snapshot:' + original.id
        });
        const originalMessage = await email(originalEmail.messageId);
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
        const replay = await createSponsorshipInvoiceForStripeSession(
          pool,
          replayInput
        );
        assert.deepEqual(replay, original);
        assert.deepEqual(await snapshot(original.id), stored);
        assert.deepEqual(
          await renderSponsorshipInvoicePdf(replay),
          originalPdf
        );

        // Changed startup configuration must affect new emissions, while the
        // same new process still retrieves an older emission byte for byte.
        const control = await issueWithChangedSettings(await seed(50000));
        assert.equal(control.issuerName, 'Changed synthetic issuer');
        assert.equal(control.issuerEmail, 'changed-issuer@example.invalid');
        assert.equal(control.taxLabel, 'Changed synthetic tax label');
        assert.match(control.invoiceNumber, /^SYNTHETIC-NEW-/);
        assert.match(control.notes, /Changed synthetic policy/);
        assert.deepEqual(await issueWithChangedSettings(replayInput), original);
        assert.deepEqual(await snapshot(original.id), stored);

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
          original,
          'later corrections to the profile never change the issued document'
        );
        assert.deepEqual(await snapshot(original.id), stored);
        const resentId = await enqueueSponsorshipDocumentEmail(pool, {
          to: 'corrected-recipient@example.invalid',
          invoice: replay,
          idempotencyKey: 'snapshot-resend:' + original.id
        });
        const resent = await email(resentId);
        assert.equal(resent.text_body, originalMessage.text_body);
        assert.equal(resent.html_body, originalMessage.html_body);
        assert.equal(
          resent.recipient_email,
          'corrected-recipient@example.invalid'
        );
        assert.equal(resent.status, 'queued');
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
      'a concurrent emission waits for the winner then reads its complete committed snapshot',
      async () => {
        const input = await seed(37550);
        const winner = await pool.connect();
        const loser = await pool.connect();
        let pending;
        let winningInvoice;
        let committed = false;
        const loserQueries = [];
        try {
          await winner.query('BEGIN ISOLATION LEVEL READ COMMITTED');
          winningInvoice = await createSponsorshipInvoiceForStripeSession(
            { query: winner.query.bind(winner) },
            input
          );
          const stored = await snapshot(winningInvoice.id, winner);
          const loserPid = (await loser.query('SELECT pg_backend_pid() AS pid'))
            .rows[0].pid;
          assert.equal(
            (await loser.query('SHOW transaction_isolation')).rows[0]
              .transaction_isolation,
            'read committed'
          );
          pending = createSponsorshipInvoiceForStripeSession(
            {
              query: (sql, values) => {
                loserQueries.push(sql);
                return loser.query(sql, values);
              }
            },
            {
              ...input,
              publicReference: 'OG7-2030-LOSER',
              stripePaymentIntentId: 'pi_test_loser',
              paidAtIso: '2030-01-01T00:00:00Z',
              customerEmail: 'loser@example.invalid'
            }
          ).then(
            (invoice) => ({ invoice }),
            (error) => ({ error })
          );
          const deadline = Date.now() + 5000;
          let blocked = false;
          while (Date.now() < deadline) {
            const activity = await pool.query(
              `SELECT wait_event_type FROM pg_stat_activity
               WHERE pid = $1 AND query LIKE '%INSERT INTO sponsorship_invoices%'`,
              [loserPid]
            );
            if (activity.rows[0]?.wait_event_type === 'Lock') {
              blocked = true;
              break;
            }
            await setTimeout(10);
          }
          assert.equal(
            blocked,
            true,
            'the losing INSERT began before the winning commit'
          );
          await winner.query('COMMIT');
          committed = true;
          const result = await pending;
          assert.ifError(result.error);
          assert.deepEqual(result.invoice, winningInvoice);
          assert.equal(loserQueries.length, 2);
          assert.match(
            loserQueries[1],
            /SELECT[\s\S]*FROM sponsorship_invoices invoice/
          );
          assert.deepEqual(await snapshot(winningInvoice.id), stored);
        } finally {
          if (!committed) await winner.query('ROLLBACK');
          if (pending) await pending;
          winner.release();
          loser.release();
        }
        assert.equal(
          (
            await pool.query(
              'SELECT COUNT(*)::int AS count FROM sponsorship_invoices WHERE contribution_id = $1',
              [winningInvoice.contributionId]
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
