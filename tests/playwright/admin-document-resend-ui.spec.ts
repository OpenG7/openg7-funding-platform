import { readFile } from 'node:fs/promises';

import type { Download } from '@playwright/test';
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
const secondInvoice: AdminSponsorshipInvoiceRecord = {
  ...invoice,
  id: '10000000-0000-4000-8000-000000000713',
  contribution_id: '10000000-0000-4000-8000-000000000713',
  public_reference: 'OG7-SYNTHETIC-B',
  invoice_number: 'INV-SYNTHETIC-B',
  stripe_session_id: 'cs_test_document_b',
  sponsor_name: 'Entreprise synthétique B',
  sponsor_contact_email: 'other@example.test',
  last_email_recipient: 'other@example.test',
  credit_notes: []
};
const twoInvoiceListing = {
  data_source: 'database',
  invoices: [invoice, secondInvoice],
  last_updated_at: date,
  summary: {
    total_count: 2,
    total_amount: 1000,
    credit_note_count: 1,
    total_credited: 500,
    failed_email_count: 0,
    currency: 'CAD'
  }
};

function seedSession(language: string): void {
  localStorage.setItem('openg7.language', language);
  sessionStorage.setItem(
    'openg7-admin-session-token',
    'openg7-admin-session.document-fixture'
  );
  sessionStorage.setItem(
    'openg7-admin-session-expires-at',
    '2099-01-01T00:00:00Z'
  );
}

for (const language of ['fr-CA', 'en'])
  for (const width of [390, 1280]) {
    test(`document resend confirmation, uncertain retry and queue shortcut in ${language} at ${width}px`, async ({
      page
    }) => {
      const english = language === 'en';
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript(seedSession, language);
      const calls: Record<string, unknown>[] = [];
      const storedResends = () =>
        page.evaluate(() =>
          Object.entries(sessionStorage).filter(([key]) =>
            key.startsWith('openg7-admin-document-resend:')
          )
        );
      let fail = true;
      let sent = false;
      let release: (() => void) | undefined;
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/resend')) {
          const payload = route.request().postDataJSON();
          calls.push(payload);
          if (fail) return route.abort('failed');
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          const emailStatus = {
            last_email_status: sent ? 'sent' : 'queued',
            last_email_recipient: payload.to,
            last_email_sent_at: sent ? date : null
          };
          return route.fulfill({
            json: {
              queued: !sent,
              attempted: sent,
              sent,
              messageId: 'message-fixture',
              ...(payload.invoiceId
                ? { invoice: { ...invoice, ...emailStatus } }
                : {
                    creditNote: { ...invoice.credit_notes[0], ...emailStatus }
                  }),
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
        sent = false;
        await send.click();
        await send.dispatchEvent('click');
        await expect(dialog).toContainText('corrected@example.test');
        expect(calls).toHaveLength(before);
        await page.locator('[data-og7="confirm-action"]').click();
        await expect.poll(() => calls.length).toBe(before + 1);
        await expect(send).toBeEnabled();
        const retainedResends = await storedResends();
        expect(retainedResends).toEqual([
          [
            expect.stringMatching(
              /^openg7-admin-document-resend:[0-9a-f]{64}$/
            ),
            expect.stringMatching(
              /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/
            )
          ]
        ]);
        expect(retainedResends[0][1]).toBe(calls[before]['requestId']);
        expect(JSON.stringify(retainedResends)).not.toContain('@');
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
        await expect(
          page.getByRole('button', {
            name:
              kind === 'invoice'
                ? english
                  ? 'Resend credit note'
                  : 'Renvoyer avoir'
                : english
                  ? 'Resend'
                  : 'Renvoyer',
            exact: true
          })
        ).toBeEnabled();
        expect(calls[before + 1]).toEqual(calls[before]);
        expect(calls[before]).toMatchObject({
          confirmation: docId,
          to: 'corrected@example.test',
          requestId: expect.stringMatching(/^[0-9a-f-]{36}$/)
        });
        release!();
        const queuedMessage =
          kind === 'invoice'
            ? english
              ? 'The invoice email is recorded in the queue. Check its delivery status.'
              : 'Le courriel de la facture est enregistré dans la file. Consultez son état de livraison.'
            : english
              ? 'The credit note email is recorded in the queue. Check its delivery status.'
              : 'Le courriel de l’avoir est enregistré dans la file. Consultez son état de livraison.';
        const sentMessage =
          kind === 'invoice'
            ? english
              ? 'Invoice sent.'
              : 'Facture envoyee.'
            : english
              ? 'Credit note sent.'
              : 'Avoir envoye.';
        await expect(
          panel.getByText(queuedMessage, { exact: true })
        ).toBeVisible();
        expect(await storedResends()).toEqual([]);
        await expect(panel.getByText(sentMessage, { exact: true })).toHaveCount(
          0
        );
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
        await panel
          .getByLabel(label, { exact: true })
          .fill('another@example.test');
        sent = true;
        release = undefined;
        await send.click();
        await expect(dialog).toContainText('another@example.test');
        await page.locator('[data-og7="confirm-action"]').click();
        await expect.poll(() => release !== undefined).toBe(true);
        expect(calls).toHaveLength(before + 3);
        expect(calls[before + 2]).toMatchObject({
          confirmation: docId,
          to: 'another@example.test'
        });
        expect(calls[before + 2]['requestId']).not.toBe(
          calls[before]['requestId']
        );
        release!();
        await expect(
          panel.getByText(sentMessage, { exact: true })
        ).toBeVisible();
        expect(await storedResends()).toEqual([]);
        await expect(
          panel.getByText(queuedMessage, { exact: true })
        ).toHaveCount(0);
      }
    });

    test(`invoice resend stays with its document across selection in ${language} at ${width}px`, async ({
      page
    }) => {
      const english = language === 'en';
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript(seedSession, language);
      const calls: Record<string, unknown>[] = [];
      let release: ((failed: boolean) => void) | undefined;
      let listLoads = 0;
      const failure = 'Synthetic invoice A resend failure';
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/sponsorship-invoices/resend')) {
          const payload = route.request().postDataJSON();
          calls.push(payload);
          const failed = await new Promise<boolean>((resolve) => {
            release = resolve;
          });
          if (failed)
            return route.fulfill({ status: 503, json: { error: failure } });
          return route.fulfill({
            json: {
              queued: true,
              attempted: false,
              sent: false,
              messageId: 'message-fixture-a',
              invoice: {
                ...invoice,
                last_email_status: 'queued',
                last_email_recipient: payload.to,
                last_email_sent_at: null
              },
              error: null
            }
          });
        }
        if (path.endsWith('/sponsorship-invoices')) {
          listLoads++;
          return route.fulfill({ json: twoInvoiceListing });
        }
        return route.fulfill({ status: 503, json: {} });
      });
      await page.goto('/admin/fundraiser/invoices');
      const select = (number: string) =>
        page.getByRole('button', { name: new RegExp(`^${number}\\s`) }).click();
      const recipient = page.getByLabel(
        english ? 'Recipient' : 'Destinataire',
        {
          exact: true
        }
      );
      const send = page.getByRole('button', {
        name: english ? 'Resend' : 'Renvoyer',
        exact: true
      });
      const sending = page.getByRole('button', {
        name: english ? 'Sending…' : 'Envoi...',
        exact: true
      });
      const queuedMessage = english
        ? 'The invoice email is recorded in the queue. Check its delivery status.'
        : 'Le courriel de la facture est enregistré dans la file. Consultez son état de livraison.';
      const startResend = async () => {
        release = undefined;
        await send.click();
        await expect(page.getByRole('dialog')).toContainText(
          'corrected-a@example.test'
        );
        await page.locator('[data-og7="confirm-action"]').click();
        await expect.poll(() => release !== undefined).toBe(true);
      };
      await recipient.fill('corrected-a@example.test');
      await startResend();
      await select(secondInvoice.invoice_number);
      await expect(send).toBeEnabled();
      await recipient.fill('corrected-b@example.test');
      await select(invoice.invoice_number);
      await expect(sending).toBeDisabled();
      await expect(recipient).toHaveValue('corrected-a@example.test');
      const refresh = page.getByRole('button', {
        name: english ? 'Refresh' : 'Actualiser',
        exact: true
      });
      await refresh.click();
      await expect.poll(() => listLoads).toBe(2);
      await expect(refresh).toBeEnabled();
      await expect(sending).toBeDisabled();
      await expect(recipient).toHaveValue('corrected-a@example.test');
      await sending.dispatchEvent('click');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(calls).toHaveLength(1);
      await select(secondInvoice.invoice_number);
      await expect(recipient).toHaveValue('corrected-b@example.test');
      release!(false);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              Object.keys(sessionStorage).filter((key) =>
                key.startsWith('openg7-admin-document-resend:')
              ).length
          )
        )
        .toBe(0);
      await expect(page.getByText(queuedMessage, { exact: true })).toHaveCount(
        0
      );
      await expect(
        page.locator('[data-og7="document-email-status"]')
      ).toHaveCount(0);
      await select(invoice.invoice_number);
      await expect(
        page.getByText(queuedMessage, { exact: true })
      ).toBeVisible();
      await expect(
        page.locator(`[data-og7="document-email-status"][data-og7-id="${id}"]`)
      ).toHaveAttribute(
        'href',
        '/admin/fundraiser/email-queue?messageId=message-fixture-a'
      );
      await expect(recipient).toHaveValue('corrected-a@example.test');

      await startResend();
      await select(secondInvoice.invoice_number);
      const failedResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith(
            '/sponsorship-invoices/resend'
          ) && response.status() === 503
      );
      release!(true);
      await (await failedResponse).finished();
      await expect(send).toBeEnabled();
      await expect(page.getByText(failure, { exact: true })).toHaveCount(0);
      await select(invoice.invoice_number);
      await expect(page.getByText(failure, { exact: true })).toBeVisible();
      await expect(recipient).toHaveValue('corrected-a@example.test');
      await select(secondInvoice.invoice_number);
      await expect(page.getByText(failure, { exact: true })).toHaveCount(0);
      await expect(recipient).toHaveValue('corrected-b@example.test');
      await expect(
        page.locator('[data-og7="document-email-status"]')
      ).toHaveCount(0);
      await select(invoice.invoice_number);
      await startResend();
      expect(calls).toHaveLength(3);
      expect(calls[2]).toEqual(calls[1]);
      expect(calls[2]).toMatchObject({
        invoiceId: id,
        confirmation: id,
        to: 'corrected-a@example.test'
      });
      release!(false);
      await expect(
        page.getByText(queuedMessage, { exact: true })
      ).toBeVisible();
      await expect(page.getByText(failure, { exact: true })).toHaveCount(0);
    });

    test(`document PDF stays with its document across selection in ${language} at ${width}px`, async ({
      page
    }) => {
      const english = language === 'en';
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript(seedSession, language);
      const calls: string[] = [];
      let release: ((failed: boolean) => void) | undefined;
      let failure = '';
      const pdf = (docId: string) =>
        `%PDF-1.4\nSynthetic document ${docId}\n%%EOF`;
      await page.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/pdf')) {
          const docId =
            url.searchParams.get('invoiceId') ??
            url.searchParams.get('creditNoteId')!;
          calls.push(docId);
          if (docId !== secondInvoice.id) {
            const failed = await new Promise<boolean>((resolve) => {
              release = resolve;
            });
            if (failed)
              return route.fulfill({ status: 503, json: { error: failure } });
          }
          return route.fulfill({
            contentType: 'application/pdf',
            body: pdf(docId)
          });
        }
        if (url.pathname.endsWith('/sponsorship-invoices'))
          return route.fulfill({ json: twoInvoiceListing });
        return route.fulfill({ status: 503, json: {} });
      });
      await page.goto('/admin/fundraiser/invoices');
      const select = (number: string) =>
        page.getByRole('button', { name: new RegExp(`^${number}\\s`) }).click();
      const detail = page.getByRole('region', {
        name: english ? 'Invoice details' : 'Detail facture',
        exact: true
      });
      const invoiceHeader = detail.locator('header').first();
      const downloadName = english ? 'Download PDF' : 'Telecharger PDF';
      const loadingName = english ? 'Preparing…' : 'Preparation...';
      const checkDownload = async (
        pending: Promise<Download>,
        docId: string,
        number: string
      ) => {
        const download = await pending;
        expect(download.suggestedFilename()).toBe(`openg7-${number}.pdf`);
        expect(await readFile((await download.path())!, 'utf8')).toBe(
          pdf(docId)
        );
      };
      for (const kind of ['invoice', 'creditNote'] as const) {
        const docId = kind === 'invoice' ? id : creditId;
        const number =
          kind === 'invoice' ? invoice.invoice_number : 'CN-SYNTHETIC';
        failure = `Synthetic PDF failure ${number}`;
        await select(invoice.invoice_number);
        const document =
          kind === 'invoice'
            ? invoiceHeader
            : detail.locator(
                `[data-og7="credit-note"][data-og7-id="${creditId}"]`
              );
        const download = document.getByRole('button', {
          name: downloadName,
          exact: true
        });
        const loading = document.getByRole('button', {
          name: loadingName,
          exact: true
        });
        release = undefined;
        await download.focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => release !== undefined).toBe(true);
        await select(secondInvoice.invoice_number);
        const downloadB = invoiceHeader.getByRole('button', {
          name: downloadName,
          exact: true
        });
        await expect(downloadB).toBeEnabled();
        await select(invoice.invoice_number);
        await expect(loading).toBeDisabled();
        await loading.dispatchEvent('click');
        await select(secondInvoice.invoice_number);
        const downloadedB = page.waitForEvent('download');
        await downloadB.click();
        await checkDownload(
          downloadedB,
          secondInvoice.id,
          secondInvoice.invoice_number
        );
        expect(calls.filter((calledId) => calledId === docId)).toHaveLength(1);
        const failedResponse = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname.endsWith('/pdf') &&
            response.status() === 503
        );
        release!(true);
        await (await failedResponse).finished();
        await expect(downloadB).toBeEnabled();
        await expect(detail.getByText(failure, { exact: true })).toHaveCount(0);
        await select(invoice.invoice_number);
        await expect(
          document.getByText(failure, { exact: true })
        ).toBeVisible();
        release = undefined;
        await download.click();
        await expect.poll(() => release !== undefined).toBe(true);
        expect(calls.filter((calledId) => calledId === docId)).toHaveLength(2);
        const downloaded = page.waitForEvent('download');
        await select(secondInvoice.invoice_number);
        release!(false);
        await checkDownload(downloaded, docId, number);
        await expect(downloadB).toBeEnabled();
        await expect(detail.getByText(failure, { exact: true })).toHaveCount(0);
        await select(invoice.invoice_number);
        await expect(download).toBeEnabled();
        await expect(document.getByText(failure, { exact: true })).toHaveCount(
          0
        );
      }
    });
  }
