import { readFile } from 'node:fs/promises';

import type { Download, Page } from '@playwright/test';
import type { AdminSponsorshipInvoiceRecord } from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  blockAdminReviewWrites,
  captureAdminDesign,
  expectAdminPageFits,
  prepareAdminDesignReview
} from './support/admin-design-review.js';

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

function recordDelivery(
  invoices: AdminSponsorshipInvoiceRecord[],
  payload: Record<string, unknown>,
  sent: boolean
): AdminSponsorshipInvoiceRecord[] {
  const status: Pick<
    AdminSponsorshipInvoiceRecord,
    'last_email_status' | 'last_email_recipient' | 'last_email_sent_at'
  > = {
    last_email_status: sent ? 'sent' : 'queued',
    last_email_recipient: String(payload['to']),
    last_email_sent_at: sent ? date : null
  };
  return invoices.map((candidate) => ({
    ...candidate,
    ...(candidate.id === payload['invoiceId'] ? status : {}),
    credit_notes: candidate.credit_notes.map((creditNote) =>
      creditNote.id === payload['creditNoteId']
        ? { ...creditNote, ...status }
        : creditNote
    )
  }));
}

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

async function documentStyleFixtures(
  page: Page,
  language: string,
  theme: string
) {
  await page.addInitScript(seedSession, language);
  await page.addInitScript((theme) => {
    localStorage.setItem(
      'openg7.pilotage.appearance.v1',
      JSON.stringify({ theme, system: false, density: 'comfortable' })
    );
  }, theme);
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      writes.push(path);
      return route.fulfill({ status: 503, json: {} });
    }
    if (path.endsWith('/sponsorship-invoices'))
      return route.fulfill({
        json: {
          ...twoInvoiceListing,
          summary: { ...twoInvoiceListing.summary, failed_email_count: 1 },
          invoices: [
            {
              ...invoice,
              credit_notes: invoice.credit_notes.map((credit) => ({
                ...credit,
                last_email_status: 'queued'
              }))
            },
            { ...secondInvoice, last_email_status: 'failed' }
          ]
        }
      });
    return route.fulfill({ status: 503, json: {} });
  });
  return writes;
}

const documentPalettes = {
  mineral: {
    panel: 'rgb(255, 255, 255)',
    selected: 'rgb(237, 243, 250)',
    text: 'rgb(23, 43, 80)',
    success: 'rgb(35, 99, 66)',
    warning: 'rgb(128, 84, 17)',
    danger: 'rgb(165, 45, 62)'
  },
  night: {
    panel: 'rgb(20, 35, 56)',
    selected: 'rgb(36, 61, 83)',
    text: 'rgb(241, 245, 252)',
    success: 'rgb(161, 231, 177)',
    warning: 'rgb(255, 218, 133)',
    danger: 'rgb(255, 181, 188)'
  },
  graphite: {
    panel: 'rgb(37, 41, 47)',
    selected: 'rgb(56, 67, 79)',
    text: 'rgb(243, 244, 246)',
    success: 'rgb(167, 223, 188)',
    warning: 'rgb(245, 212, 148)',
    danger: 'rgb(255, 188, 201)'
  }
} as const;

for (const language of ['fr-CA', 'en'] as const)
  for (const width of [390, 1536]) {
    test(`invoice composition keeps document selection and amounts accessible in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await prepareAdminDesignReview(page);
      await documentStyleFixtures(page, language, 'mineral');
      const writes = await blockAdminReviewWrites(page);
      await page.setViewportSize({
        width,
        height: width === 1536 ? 864 : 1000
      });
      await page.goto('/admin/fundraiser/invoices');
      const summary = page.getByRole('region', {
        name: language === 'en' ? 'Invoice summary' : 'Resume factures',
        exact: true
      });
      const detail = page.getByRole('region', {
        name: language === 'en' ? 'Invoice details' : 'Detail facture',
        exact: true
      });
      const selections = page.locator('[data-og7="invoice-selection"]');
      await expect(selections).toHaveCount(2);
      await expect(summary.getByRole('article')).toHaveCount(5);
      await expect(detail).toContainText('INV-SYNTHETIC');
      await expect(detail).toContainText('CAD');
      await captureAdminDesign(page, testInfo, `invoices-${width}`);
      if (width === 1536) {
        for (const metric of await summary.getByRole('article').all())
          await expect(metric).toBeInViewport({ ratio: 1 });
        await expect(selections.first()).toBeInViewport({ ratio: 1 });
        await captureAdminDesign(page, testInfo, 'invoices-detail-1536', true);
      }
      await selections.last().focus();
      await page.keyboard.press('Enter');
      await expect(detail).toContainText('INV-SYNTHETIC-B');
      await expect(selections.last()).toHaveAttribute('aria-pressed', 'true');
      await expect(selections.last()).toBeFocused();
      if (language === 'en') {
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
        });
        await expectAdminPageFits(page);
        const recipient = detail.getByLabel('Recipient', { exact: true });
        await recipient.scrollIntoViewIfNeeded();
        await recipient.focus();
        await expect(recipient).toBeInViewport({ ratio: 1 });
        await expect(recipient).toHaveValue('other@example.test');
      }
      expect(writes).toEqual([]);
    });
  }

for (const theme of ['mineral', 'night', 'graphite'] as const) {
  for (const { language, width } of [
    { language: 'fr-CA', width: 390 },
    { language: 'en', width: 1280 }
  ]) {
    test(`invoice and credit-note surfaces keep delivery states readable with ${theme} in ${language} at ${width}px`, async ({
      page
    }) => {
      const palette = documentPalettes[theme];
      const english = language === 'en';
      await page.setViewportSize({ width, height: 950 });
      const writes = await documentStyleFixtures(page, language, theme);
      await page.goto('/admin/fundraiser/invoices');
      const summary = page.getByRole('region', {
        name: english ? 'Invoice summary' : 'Resume factures',
        exact: true
      });
      const detail = page.getByRole('region', {
        name: english ? 'Invoice details' : 'Detail facture',
        exact: true
      });
      const selections = page.locator('[data-og7="invoice-selection"]');
      await expect(selections).toHaveCount(2);
      await expect(summary.getByRole('article')).toHaveCount(5);
      await expect(detail).toHaveCSS('background-color', palette.panel);
      await expect(summary).toHaveCSS('background-color', palette.panel);
      await expect(selections.first()).toHaveCSS(
        'background-color',
        palette.selected
      );
      await expect(selections.first()).toHaveCSS('color', palette.text);
      await expect(
        selections.first().locator('openg7-admin-document-email-status span')
      ).toHaveCSS('color', palette.success);
      await expect(
        selections.last().locator('openg7-admin-document-email-status span')
      ).toHaveCSS('color', palette.danger);
      await expect(
        page
          .locator('[data-og7="credit-note"]')
          .locator('openg7-admin-document-email-status span')
      ).toHaveCSS('color', palette.warning);

      const recipient = page.getByLabel(
        english ? 'Recipient' : 'Destinataire',
        {
          exact: true
        }
      );
      await expect(recipient).toHaveValue('original@example.test');
      await expect(recipient).toHaveCSS('background-color', palette.panel);
      await expect(recipient).toHaveCSS('color', palette.text);
      const bounds = await recipient.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);

      const resend = detail.getByRole('button', {
        name: english ? 'Resend' : 'Renvoyer',
        exact: true
      });
      await resend.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('INV-SYNTHETIC');
      await dialog
        .getByRole('button', {
          name: english ? 'Cancel' : 'Annuler',
          exact: true
        })
        .last()
        .click();
      await expect(resend).toBeFocused();
      expect(writes).toEqual([]);
    });
  }
}

test('invoice identities, summary and delivery controls fit resized viewports with accessible document selection', async ({
  page
}) => {
  await documentStyleFixtures(page, 'fr-CA', 'mineral');
  await page.goto('/admin/fundraiser/invoices');
  const summary = page.getByRole('region', {
    name: 'Resume factures',
    exact: true
  });
  const board = page.getByRole('region', {
    name: 'Factures admin',
    exact: true
  });
  const identity = page.getByRole('region', {
    name: 'Identite facture',
    exact: true
  });
  const selected = page.locator('[data-og7="invoice-selection"]').first();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  for (const width of [
    390, 619, 620, 621, 859, 860, 861, 1079, 1080, 1081, 1536
  ]) {
    await page.setViewportSize({ width, height: 950 });
    await expect(summary.getByRole('article')).toHaveCount(5);
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    for (const surface of [board, identity, selected]) {
      const bounds = (await surface.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(-1);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    }
    await expect(selected).toContainText('INV-SYNTHETIC');
    const recipient = page.getByLabel('Destinataire', { exact: true });
    expect((await recipient.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
  }
});

for (const language of ['fr-CA', 'en'])
  for (const width of [390, 1280]) {
    test(`document response loss blocks new requests and exposes reconciliation in ${language} at ${width}px`, async ({
      page
    }) => {
      const english = language === 'en';
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript(seedSession, language);
      const calls: Record<string, unknown>[] = [];
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/resend')) {
          calls.push(route.request().postDataJSON());
          return route.abort('failed');
        }
        if (path.endsWith('/sponsorship-invoices'))
          return route.fulfill({
            json: { ...twoInvoiceListing, invoices: [invoice] }
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
        const input = panel.getByLabel(label, { exact: true });
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
        await input.fill('corrected@example.test');
        await send.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText('corrected@example.test');
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
        await send.click();
        await page.locator('[data-og7="confirm-action"]').click();
        await expect.poll(() => calls.length).toBe(before + 1);
        await expect(send).toBeDisabled();
        await expect(input).toHaveAttribute('readonly', '');
        const link = page.locator(
          `[data-og7="document-email-reconcile"][data-og7-id="${docId}"]`
        );
        await expect(link).toHaveAttribute(
          'href',
          '/admin/fundraiser/email-queue'
        );
        await link.focus();
        await expect(link).toBeFocused();
        const persisted = await page.evaluate(() =>
          Object.entries(sessionStorage).filter(([key]) =>
            key.startsWith('openg7-admin-document-')
          )
        );
        expect(JSON.stringify(persisted)).not.toContain('@');
        await page.reload();
        await expect(send).toBeDisabled();
        await expect(input).toHaveAttribute('readonly', '');
        await expect(link).toBeVisible();
        expect(calls).toHaveLength(before + 1);
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
      let documents = [invoice, secondInvoice];
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
          documents = recordDelivery(documents, payload, false);
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
          return route.fulfill({
            json: { ...twoInvoiceListing, invoices: documents }
          });
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
      await expect(
        page.locator('[data-og7="document-email-reconcile"]')
      ).toBeVisible();
      await expect(send).toBeDisabled();
      await expect(recipient).toHaveValue('corrected-a@example.test');
      await select(secondInvoice.invoice_number);
      await expect(page.getByText(failure, { exact: true })).toHaveCount(0);
      await expect(recipient).toHaveValue('corrected-b@example.test');
      await expect(
        page.locator('[data-og7="document-email-status"]')
      ).toHaveCount(0);
      await select(invoice.invoice_number);
      await expect(send).toBeDisabled();
      await expect(
        page.locator('[data-og7="document-email-reconcile"]')
      ).toBeVisible();
      await send.dispatchEvent('click');
      expect(calls).toHaveLength(2);
    });

    test(`document resend captures its recipient before confirmation across selection in ${language} at ${width}px`, async ({
      page
    }) => {
      const english = language === 'en';
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript(seedSession, language);
      const calls: Record<string, unknown>[] = [];
      let release: (() => void) | undefined;
      let documents = [invoice, secondInvoice];
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/resend')) {
          const payload = route.request().postDataJSON();
          calls.push(payload);
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          documents = recordDelivery(documents, payload, false);
          const emailStatus = {
            last_email_status: 'queued',
            last_email_recipient: payload.to,
            last_email_sent_at: null
          };
          return route.fulfill({
            json: {
              queued: true,
              attempted: false,
              sent: false,
              messageId: `message-captured-${payload.confirmation}`,
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
            json: { ...twoInvoiceListing, invoices: documents }
          });
        return route.fulfill({ status: 503, json: {} });
      });
      await page.goto('/admin/fundraiser/invoices');
      const select = (invoiceId: string) =>
        page.locator(
          `[data-og7="invoice-selection"][data-og7-id="${invoiceId}"]`
        );
      for (const kind of ['invoice', 'creditNote'] as const) {
        await select(id).focus();
        await page.keyboard.press('Enter');
        await expect(select(id)).toHaveAttribute('aria-pressed', 'true');
        await expect(select(secondInvoice.id)).toHaveAttribute(
          'aria-pressed',
          'false'
        );
        const docId = kind === 'invoice' ? id : creditId;
        const captured = `captured-${kind}@example.test`;
        const edited = `edited-${kind}@example.test`;
        const panel =
          kind === 'invoice' ? page : page.locator('[data-og7="credit-note"]');
        const recipient = panel.getByLabel(
          kind === 'invoice'
            ? english
              ? 'Recipient'
              : 'Destinataire'
            : english
              ? 'Credit note recipient'
              : 'Destinataire avoir',
          { exact: true }
        );
        await recipient.fill(captured);
        await panel
          .getByRole('button', {
            name:
              kind === 'invoice'
                ? english
                  ? 'Resend'
                  : 'Renvoyer'
                : english
                  ? 'Resend credit note'
                  : 'Renvoyer avoir',
            exact: true
          })
          .click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText(captured);
        // Simulate page updates during the async confirmation boundary.
        await recipient.evaluate((element, email) => {
          (element as HTMLInputElement).value = email;
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }, edited);
        await select(secondInvoice.id).dispatchEvent('click');
        await expect(dialog).toContainText(captured);
        release = undefined;
        await page.locator('[data-og7="confirm-action"]').click();
        await expect.poll(() => release !== undefined).toBe(true);
        expect(calls.at(-1)).toMatchObject({
          confirmation: docId,
          to: captured,
          [kind === 'invoice' ? 'invoiceId' : 'creditNoteId']: docId
        });
        await expect(
          page.getByLabel(english ? 'Recipient' : 'Destinataire', {
            exact: true
          })
        ).toHaveValue('other@example.test');
        const response = page.waitForResponse((candidate) =>
          new URL(candidate.url()).pathname.endsWith('/resend')
        );
        release!();
        await (await response).finished();
        await expect(
          page.locator('[data-og7="document-email-status"]')
        ).toHaveCount(0);
        await select(id).click();
        await expect(
          panel.locator(
            `[data-og7="document-email-status"][data-og7-id="${docId}"]`
          )
        ).toHaveAttribute(
          'href',
          `/admin/fundraiser/email-queue?messageId=message-captured-${docId}`
        );
        await expect(panel.getByText(captured, { exact: true })).toBeVisible();
        if (kind === 'invoice') await expect(recipient).toHaveValue(captured);
      }
      expect(calls).toHaveLength(2);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBeLessThanOrEqual(width);
    });

    test(`confirmed backfill stays bounded to its target and reloads facts in ${language} at ${width}px`, async ({
      page
    }) => {
      const english = language === 'en';
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript(seedSession, language);
      const calls: Record<string, unknown>[] = [];
      let release: (() => void) | undefined;
      let listLoads = 0;
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/sponsorship-invoices/backfill')) {
          calls.push(route.request().postDataJSON());
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return route.fulfill({
            json: {
              data_source: 'database',
              eligible_count: 1,
              missing_count: 1,
              processed_count: 1,
              created_count: 1,
              skipped_count: 0,
              remaining_count: 0,
              failed_count: 0,
              invoiceIds: [id],
              invoices: [invoice],
              errors: [],
              last_updated_at: date
            }
          });
        }
        if (path.endsWith('/sponsorship-invoices')) {
          listLoads++;
          return route.fulfill({ json: twoInvoiceListing });
        }
        return route.fulfill({ status: 503, json: {} });
      });
      await page.goto(`/admin/fundraiser/invoices?contributionId=${id}`);
      const generate = page.getByRole('button', {
        name: english
          ? 'Generate invoice for this record'
          : 'Générer la facture de ce dossier',
        exact: true
      });
      await expect(generate).toBeEnabled();
      await generate.focus();
      await expect(generate).toBeFocused();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(id);
      await expect(dialog).toContainText(
        english ? 'No email will be sent.' : 'Aucun courriel ne sera envoyé.'
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(generate).toBeFocused();
      expect(calls).toHaveLength(0);
      await page.keyboard.press('Enter');
      await generate.dispatchEvent('click');
      expect(calls).toHaveLength(0);
      await page.locator('[data-og7="confirm-action"]').click();
      await expect.poll(() => calls.length).toBe(1);
      await expect(
        page.getByRole('button', {
          name: english ? 'Generating…' : 'Generation...',
          exact: true
        })
      ).toBeDisabled();
      expect(calls[0]).toEqual({
        limit: 1,
        contributionId: id,
        confirmation: id
      });
      expect(
        await page.evaluate(() =>
          Object.keys(sessionStorage).filter((key) =>
            key.startsWith('openg7-admin-document-resend:')
          )
        )
      ).toEqual([]);
      release!();
      await expect.poll(() => listLoads).toBe(2);
      await expect(generate).toBeEnabled();
      await expect(
        page.getByText(
          english
            ? 'Generation complete: 1 invoice(s) created, 0 already present, 0 error(s).'
            : 'Backfill termine: 1 facture(s) creee(s), 0 deja presente(s), 0 erreur(s).',
          { exact: true }
        )
      ).toBeVisible();
    });

    test(`leaving the page suppresses late PDF and resend UI effects in ${language} at ${width}px`, async ({
      page
    }) => {
      const english = language === 'en';
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript(seedSession, language);
      let documents = [invoice, secondInvoice];
      const resendRequests: Record<string, unknown>[] = [];
      let releaseResend: (() => void) | undefined;
      let releasePdf: (() => void) | undefined;
      let listLoads = 0;
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/sponsorship-invoices/resend')) {
          const payload = route.request().postDataJSON();
          resendRequests.push(payload);
          if (resendRequests.length === 1)
            await new Promise<void>((resolve) => {
              releaseResend = resolve;
            });
          documents = recordDelivery(documents, payload, false);
          return route.fulfill({
            json: {
              ...documents[0],
              queued: true,
              sent: false,
              attempted: false,
              invoice: documents[0],
              messageId: 'message-after-navigation',
              error: null
            }
          });
        }
        if (path.endsWith('/sponsorship-invoices/pdf')) {
          await new Promise<void>((resolve) => {
            releasePdf = resolve;
          });
          return route.fulfill({
            contentType: 'application/pdf',
            body: '%PDF-1.4\nSynthetic late document\n%%EOF'
          });
        }
        if (path.endsWith('/sponsorship-invoices')) {
          listLoads++;
          return route.fulfill({
            json: { ...twoInvoiceListing, invoices: documents }
          });
        }
        return route.fulfill({ status: 503, json: {} });
      });
      await page.goto('/admin/fundraiser/invoices');
      await page
        .getByLabel(english ? 'Recipient' : 'Destinataire', { exact: true })
        .fill('late@example.test');
      await page
        .getByRole('button', {
          name: english ? 'Resend' : 'Renvoyer',
          exact: true
        })
        .click();
      await page.locator('[data-og7="confirm-action"]').click();
      await expect.poll(() => releaseResend !== undefined).toBe(true);
      const detail = page.getByRole('region', {
        name: english ? 'Invoice details' : 'Detail facture',
        exact: true
      });
      await detail
        .locator('header')
        .first()
        .getByRole('button', {
          name: english ? 'Download PDF' : 'Telecharger PDF',
          exact: true
        })
        .click();
      await expect.poll(() => releasePdf !== undefined).toBe(true);
      await page
        .locator('a[href="/admin/fundraiser/assistant"]:visible')
        .first()
        .click();
      await expect(page).toHaveURL(/\/admin\/fundraiser\/assistant$/);
      await expect(page.locator('openg7-admin-invoices-page')).toHaveCount(0);
      const resendResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith(
          '/sponsorship-invoices/resend'
        )
      );
      const pdfResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith('/sponsorship-invoices/pdf')
      );
      const downloaded = page.waitForEvent('download', { timeout: 500 }).then(
        () => true,
        () => false
      );
      releaseResend!();
      releasePdf!();
      await (await resendResponse).finished();
      await (await pdfResponse).finished();
      expect(await downloaded).toBe(false);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              Object.keys(sessionStorage).filter((key) =>
                key.startsWith('openg7-admin-document-resend:')
              ).length
          )
        )
        .toBe(1);
      expect(listLoads).toBe(1);
      if (width < 861)
        await page
          .locator('button[aria-controls="admin-navigation-content"]')
          .click();
      await page
        .locator('a[href="/admin/fundraiser/invoices"]')
        .first()
        .click();
      await expect.poll(() => listLoads).toBe(2);
      await expect(
        page.getByText('late@example.test', { exact: true })
      ).toBeVisible();
      await expect(
        page.locator('[data-og7="document-email-status"]')
      ).toHaveCount(0);
      await expect(
        page.locator('[data-og7="document-email-reconcile"]')
      ).toBeVisible();
      expect(resendRequests).toHaveLength(1);
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
