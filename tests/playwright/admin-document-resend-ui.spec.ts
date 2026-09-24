import type { AdminSponsorshipInvoiceRecord } from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const id = '10000000-0000-4000-8000-000000000711';
const creditId = '10000000-0000-4000-8000-000000000712';
const date = '2026-09-23T12:00:00Z';
const shared = {
  contribution_id: id,
  public_reference: 'OG7-SYNTHETIC',
  stripe_payment_intent_id: null,
  issued_at: date,
  currency: 'CAD',
  subtotal: 500,
  tax: 0,
  total: 500,
  tax_label: '',
  issuer_name: 'OpenG7',
  issuer_email: null,
  issuer_address: null,
  issuer_tax_id: null,
  sponsor_name: 'Entreprise synthétique',
  sponsor_contact_name: 'Contact synthétique',
  sponsor_contact_email: 'original@example.test',
  sponsor_website_url: null,
  line_items: [
    { description: 'Commandite', quantity: 1, unit_amount: 500, total: 500 }
  ],
  notes: null,
  last_email_status: 'sent',
  last_email_recipient: 'original@example.test',
  last_email_sent_at: date,
  last_email_error: null
};
const invoice: AdminSponsorshipInvoiceRecord = {
  ...shared,
  id,
  invoice_number: 'INV-SYNTHETIC',
  stripe_session_id: 'cs_test_document',
  paid_at: date,
  credit_notes: [
    {
      ...shared,
      id: creditId,
      invoice_id: id,
      invoice_number: 'INV-SYNTHETIC',
      credit_note_number: 'CN-SYNTHETIC',
      stripe_refund_id: 're_test_document'
    }
  ]
};

for (const language of ['fr-CA', 'en'])
  for (const width of [390, 1280]) {
    test(`document resend confirmation, uncertain retry and queue shortcut in ${language} at ${width}px`, async ({
      page
    }) => {
      const english = language === 'en';
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript((locale) => {
        localStorage.setItem('openg7.language', locale);
        sessionStorage.setItem(
          'openg7-admin-session-token',
          'openg7-admin-session.document-fixture'
        );
        sessionStorage.setItem(
          'openg7-admin-session-expires-at',
          '2099-01-01T00:00:00Z'
        );
      }, language);
      const calls: Record<string, unknown>[] = [];
      let fail = true;
      let release: (() => void) | undefined;
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/resend')) {
          calls.push(route.request().postDataJSON());
          if (fail) return route.abort('failed');
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return route.fulfill({
            json: {
              queued: true,
              attempted: false,
              sent: false,
              messageId: 'message-fixture',
              invoice,
              creditNote: invoice.credit_notes[0],
              error: null
            }
          });
        }
        if (path.endsWith('/sponsorship-invoices'))
          return route.fulfill({
            json: {
              data_source: 'database',
              invoices: [invoice],
              last_updated_at: date,
              summary: {
                total_count: 1,
                total_amount: 500,
                credit_note_count: 1,
                total_credited: 500,
                failed_email_count: 0,
                currency: 'CAD'
              }
            }
          });
        return route.fulfill({ status: 503, json: {} });
      });
      await page.goto('/admin/fundraiser/invoices');
      for (const kind of ['invoice', 'creditNote'] as const) {
        const docId = kind === 'invoice' ? id : creditId;
        const panel =
          kind === 'invoice' ? page : page.locator('[data-og7="credit-note"]');
        const label =
          kind === 'invoice'
            ? english
              ? 'Recipient'
              : 'Destinataire'
            : english
              ? 'Credit note recipient'
              : 'Destinataire avoir';
        await panel
          .getByLabel(label, { exact: true })
          .fill('corrected@example.test');
        const send = panel.getByRole('button', {
          name:
            kind === 'invoice'
              ? english
                ? 'Resend'
                : 'Renvoyer'
              : english
                ? 'Resend credit note'
                : 'Renvoyer avoir',
          exact: true
        });
        await send.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText('corrected@example.test');
        await expect(dialog).toContainText(
          kind === 'invoice' ? 'INV-SYNTHETIC' : 'CN-SYNTHETIC'
        );
        const before = calls.length;
        await dialog
          .getByRole('button', {
            name: english ? 'Cancel' : 'Annuler',
            exact: true
          })
          .last()
          .click();
        await expect(send).toBeFocused();
        expect(calls).toHaveLength(before);
        fail = true;
        await send.click();
        await page.locator('[data-og7="confirm-action"]').click();
        await expect.poll(() => calls.length).toBe(before + 1);
        await expect(send).toBeEnabled();
        await page.reload();
        await panel
          .getByLabel(label, { exact: true })
          .fill('corrected@example.test');
        fail = false;
        release = undefined;
        await send.click();
        await page.locator('[data-og7="confirm-action"]').click();
        await expect.poll(() => release !== undefined).toBe(true);
        await expect(
          panel.getByRole('button', {
            name: english ? 'Sending…' : 'Envoi...',
            exact: true
          })
        ).toBeDisabled();
        expect(calls[before + 1]).toEqual(calls[before]);
        expect(calls[before]).toMatchObject({
          confirmation: docId,
          to: 'corrected@example.test',
          requestId: expect.stringMatching(/^[0-9a-f-]{36}$/)
        });
        release!();
        const link = page.locator(
          '[data-og7="document-email-status"][data-og7-id="' + docId + '"]'
        );
        await expect(link).toHaveAttribute(
          'href',
          '/admin/fundraiser/email-queue?messageId=message-fixture'
        );
        await expect(link).toHaveText(
          english ? 'Track email' : 'Suivre le courriel'
        );
        await link.focus();
        await expect(link).toBeFocused();
      }
    });
  }
