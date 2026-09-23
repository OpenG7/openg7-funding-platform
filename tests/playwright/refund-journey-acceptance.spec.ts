import { randomUUID } from 'node:crypto';

import type { Download } from '@playwright/test';
import type {
  AdminContributionsResponse,
  AdminDashboardResponse,
  AdminSponsorshipInvoiceRecord,
  AdminSponsorshipInvoicesResponse,
  AdminSponsorshipRefundResult,
  AdminSponsorshipsResponse,
  FundTransparencyPublicResponse
} from '@openg7/funding-core';

import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';
import {
  buildPaymentIntentSucceededEvent,
  buildSignedWebhookRequest,
  buildStripeEvent
} from './support/stripe-webhook.js';
import { test, expect } from './support/test.js';

const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
const refundUrl = '/api/admin/sponsorships/refund';
const amountMinor = 50000;
// Synthetic fee, retained after refund; this is not a Stripe pricing claim.
const feeMinor = 1000;
const minor = (value: number) => Math.round(value * 100);
const recipient = 'refund@simulation.example.test';
const snapshot = (i: AdminSponsorshipInvoiceRecord) => ({
  id: i.id,
  number: i.invoice_number,
  issuedAt: i.issued_at,
  total: i.total,
  currency: i.currency,
  sponsorName: i.sponsor_name,
  items: i.line_items,
  notes: i.notes
});
const downloadBytes = async (download: Download) => {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

for (const amounts of [[20000, 30000], [50000]]) {
  test(`500 CAD refund journey: ${amounts.map((v) => v / 100).join(' + ')} CAD, credit notes and reconciled totals`, async ({
    page,
    context,
    request
  }, info) => {
    test.skip(
      process.env.OPENG7_E2E_ISOLATED !== '1',
      'Disposable simulation only.'
    );
    test.setTimeout(180000);
    context.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1280, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const stub = process.env.STRIPE_STUB_BASE_URL!;
    const get = async <T>(url: string, authenticated = false): Promise<T> => {
      const result = await request.get(url, authenticated ? { headers } : {});
      expect(result.ok(), url).toBe(true);
      return result.json() as Promise<T>;
    };
    const summary = () =>
      get<FundTransparencyPublicResponse>('/api/public/fund-transparency');
    const before = await summary();
    expect(before.data_source).toBe('database');
    const beforeAdmin = await get<AdminContributionsResponse>(
      '/api/admin/contributions',
      true
    );
    const beforeDashboard = await get<AdminDashboardResponse>(
      '/api/admin/dashboard',
      true
    );
    let sessionId = '';
    let reference = '';
    let paymentIntentId = '';
    let chargeId = '';
    const events: Record<string, unknown>[] = [];
    const deliver = async (event: Record<string, unknown>) => {
      const signed = buildSignedWebhookRequest(event);
      const result = await request.post('/api/stripe/webhook', {
        data: signed.body,
        headers: signed.headers
      });
      expect(result.status(), await result.text()).toBe(200);
    };
    await test.step('Pay through Checkout, then confirm the provider payment and fee facts', async () => {
      await page.goto('/fonds-des-batisseurs?intent=sponsorship#support');
      const form = page.locator('[data-og7="contribution-form"]');
      await form
        .getByRole('button', { name: /Commandite d'entreprise/ })
        .click();
      await form.getByRole('button', { name: '500 $', exact: true }).click();
      await form.getByRole('checkbox').nth(0).uncheck();
      await form.getByRole('checkbox').nth(1).uncheck();
      await form.getByRole('checkbox').nth(2).check();
      await form.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(/\/checkout\/cs_test_/);
      sessionId = new URL(page.url()).pathname.split('/').at(-1)!;
      const session = await get<{
        payment_intent: string;
        client_reference_id: string;
        metadata: Record<string, string>;
      }>(stub + '/v1/checkout/sessions/' + sessionId);
      reference = session.client_reference_id;
      paymentIntentId = session.payment_intent;
      await page
        .getByRole('button', { name: 'Confirmer le paiement simulé' })
        .click();
      await expect(page.locator('#followup-companyName')).toBeVisible();
      const registration = await request.post(
        stub + '/__test__/payment-intents',
        {
          data: {
            id: paymentIntentId,
            amount: amountMinor,
            currency: 'cad',
            fee: feeMinor,
            metadata: session.metadata
          }
        }
      );
      expect(registration.ok()).toBe(true);
      chargeId = (await registration.json()).chargeId;
      const event = buildPaymentIntentSucceededEvent({
        eventId: 'evt_refund_payment_' + randomUUID(),
        paymentIntentId,
        chargeId,
        amountCents: amountMinor
      });
      events.push(event);
      await deliver(event);
    });

    const sponsor = async () => {
      const result = await get<AdminSponsorshipsResponse>(
        '/api/admin/sponsorships?search=' + encodeURIComponent(reference),
        true
      );
      expect(result.items).toHaveLength(1);
      return result.items[0]!;
    };
    const record = await sponsor();
    const invoices = () =>
      get<AdminSponsorshipInvoicesResponse>(
        '/api/admin/sponsorship-invoices?contributionId=' + record.id,
        true
      );
    const invoice = async () => {
      const result = await invoices();
      expect(result.invoices).toHaveLength(1);
      return result.invoices[0]!;
    };
    const originalInvoice = await invoice();
    expect(originalInvoice).toMatchObject({
      total: 500,
      currency: 'CAD',
      credit_notes: []
    });
    const originalSnapshot = snapshot(originalInvoice);
    const charge = () =>
      get<
        {
          amount: number;
          amount_refunded: number;
          refunds: {
            data: Array<{
              id: string;
              amount: number;
              balance_transaction: string;
            }>;
          };
        } & Record<string, unknown>
      >(stub + '/v1/charges/' + chargeId);
    const postRefund = (data: Record<string, unknown>, authenticated = true) =>
      request.post(refundUrl, { data, ...(authenticated ? { headers } : {}) });
    const baseRequest = (version: string, amount: number) => ({
      contributionId: record.id,
      expectedVersion: version,
      confirmationText: reference,
      amount
    });
    const totals = async (refundedMinor: number) => {
      const current = await summary();
      expect({
        gross: minor(current.total_received) - minor(before.total_received),
        fees: minor(current.total_fees) - minor(before.total_fees),
        net: minor(current.total_net) - minor(before.total_net),
        refunded: minor(current.total_refunded) - minor(before.total_refunded),
        available:
          minor(current.current_available_estimate) -
          minor(before.current_available_estimate)
      }).toEqual({
        gross: amountMinor,
        fees: feeMinor,
        net: amountMinor - feeMinor,
        refunded: refundedMinor,
        available: amountMinor - feeMinor - refundedMinor
      });
      const admin = await get<AdminContributionsResponse>(
        '/api/admin/contributions',
        true
      );
      const dashboard = await get<AdminDashboardResponse>(
        '/api/admin/dashboard',
        true
      );
      expect(
        minor(admin.summary.total_refunded) -
          minor(beforeAdmin.summary.total_refunded)
      ).toBe(refundedMinor);
      expect(
        minor(dashboard.totals.total_refunded) -
          minor(beforeDashboard.totals.total_refunded)
      ).toBe(refundedMinor);
      return current;
    };
    await totals(0);
    await signInAsAdmin(page);
    await test.step('Reject unauthenticated, unconfirmed and fractional-cent requests without a provider effect', async () => {
      const data = baseRequest(record.version, 200);
      expect((await postRefund(data, false)).status()).toBe(401);
      expect(
        (
          await postRefund({ ...data, confirmationText: 'wrong-reference' })
        ).status()
      ).toBe(400);
      expect((await postRefund({ ...data, amount: 0.001 })).status()).toBe(400);
      expect((await charge()).refunds.data).toHaveLength(0);
      expect((await invoice()).credit_notes).toHaveLength(0);
      expect((await sponsor()).payment_status).toBe('paid');
    });

    const receipts: AdminSponsorshipRefundResult[] = [];
    let cumulative = 0;
    for (const refundMinor of amounts) {
      await test.step(`Confirm ${refundMinor / 100} CAD in the admin form and reconcile its webhook`, async () => {
        const version = (await sponsor()).version;
        await page.goto(
          '/admin/fundraiser/sponsors?sponsorshipId=' +
            record.id +
            '&tab=refund'
        );
        await page
          .getByRole('button', { name: 'Rembourser Stripe', exact: true })
          .click();
        const panel = page.getByRole('region', {
          name: 'Remboursement Stripe'
        });
        await expect(panel).toBeVisible();
        const submit = panel.getByRole('button', {
          name: 'Rembourser Stripe',
          exact: true
        });
        await panel
          .getByLabel(/Montant a rembourser/)
          .fill(String(refundMinor / 100));
        await expect(submit).toBeDisabled();
        await panel.getByLabel(/Texte de confirmation/).fill('wrong-reference');
        await expect(submit).toBeDisabled();
        await panel.getByLabel(/Texte de confirmation/).fill(reference);
        await panel
          .getByRole('checkbox', {
            name: /Envoyer le courriel de remboursement/i
          })
          .check();
        await panel.getByLabel('Destinataire', { exact: true }).fill(recipient);
        await panel
          .getByLabel(/Message au commanditaire/)
          .fill('Remboursement de recette, sans mouvement de fonds réel.');
        await panel
          .getByLabel(/Note remboursement/)
          .fill('Note interne de recette.');
        const pending = page.waitForResponse(
          (r) => r.url().endsWith(refundUrl) && r.request().method() === 'POST'
        );
        await expect(submit).toBeEnabled();
        await submit.click();
        const response = await pending;
        expect(response.status(), await response.text()).toBe(200);
        const receipt = (await response.json()) as AdminSponsorshipRefundResult;
        expect(receipt).toMatchObject({
          refunded: true,
          amount: refundMinor / 100,
          creditNote: { total: refundMinor / 100 }
        });
        receipts.push(receipt);
        await expect(panel).toBeHidden();
        await expect(page.getByText(/Avoir cree:/)).toBeVisible();
        const duplicated = await postRefund(
          baseRequest(version, refundMinor / 100)
        );
        expect(duplicated.status()).toBe(409);
        expect(await duplicated.json()).toMatchObject({
          code: 'SPONSORSHIP_CONCURRENT_UPDATE'
        });
        cumulative += refundMinor;
        const providerCharge = await charge();
        expect(providerCharge.amount_refunded).toBe(cumulative);
        expect(providerCharge.refunds.data).toHaveLength(receipts.length);
        expect(providerCharge.refunds.data[0]).toMatchObject({
          id: receipt.refundId,
          amount: refundMinor
        });
        const event = buildStripeEvent(
          'evt_refund_' + randomUUID(),
          'charge.refunded',
          providerCharge
        );
        events.push(event);
        await deliver(event);
        await deliver(event);
        await totals(cumulative);
        expect((await sponsor()).payment_status).toBe(
          cumulative === amountMinor ? 'refunded' : 'paid'
        );
        const note = (await invoice()).credit_notes.find(
          (n) => n.stripe_refund_id === receipt.refundId
        )!;
        expect(note).toMatchObject({
          invoice_id: originalInvoice.id,
          currency: 'CAD',
          total: refundMinor / 100
        });
        expect(note.line_items[0]!.description).toContain(
          refundMinor < amountMinor ? 'partiel' : 'complet'
        );
        expect(note.notes).toContain('du montant indique');
        expect(note.notes).not.toContain('annule la facture');
        expect(snapshot(await invoice())).toEqual(originalSnapshot);
        await page.reload();
        await expect(
          page
            .locator('openg7-admin-sponsor-detail-header')
            .getByText(cumulative === amountMinor ? 'Rembourse' : 'Paye', {
              exact: true
            })
        ).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`refund-${cumulative}.png`),
          fullPage: true
        });
      });
      if (cumulative < amountMinor) {
        await test.step('A provider rejects a cumulative over-refund; no extra credit note or refund is created', async () => {
          const current = await sponsor();
          const rejected = await postRefund({
            ...baseRequest(current.version, 400),
            notifySponsor: true,
            notificationEmail: recipient,
            sponsorMessage: 'This rejected request must not send.'
          });
          expect(rejected.status()).toBe(502);
          expect((await rejected.json()).error).toMatch(/exceed/i);
          expect((await sponsor()).sponsorship_refund_status).toBe('failed');
          expect((await sponsor()).payment_status).toBe('paid');
          expect((await invoice()).credit_notes).toHaveLength(receipts.length);
          expect((await charge()).amount_refunded).toBe(cumulative);
          await totals(cumulative);
        });
      }
    }

    await test.step('Download the original invoice and every credit note, and observe captured delivery', async () => {
      await expect
        .poll(
          async () =>
            (await invoice()).credit_notes.every(
              (n) => n.last_email_status === 'sent'
            ),
          { timeout: 30000 }
        )
        .toBe(true);
      const current = await invoice();
      expect(current.credit_notes).toHaveLength(amounts.length);
      expect(
        current.credit_notes.reduce((sum, note) => sum + minor(note.total), 0)
      ).toBe(amountMinor);
      const mail = await get<{
        messages: Array<{ Subject: string; To: Array<{ Address: string }> }>;
      }>(stub + '/__test__/mail');
      for (const note of current.credit_notes) {
        const delivered = mail.messages.filter((m) =>
          m.Subject.includes(note.credit_note_number)
        );
        expect(delivered).toHaveLength(1);
        expect(delivered[0]!.To.some((to) => to.Address === recipient)).toBe(
          true
        );
        const path =
          '/api/admin/sponsorship-credit-notes/pdf?creditNoteId=' + note.id;
        expect((await request.get(path)).status()).toBe(401);
      }
      expect(
        (
          await request.get(
            '/api/admin/sponsorship-invoices/pdf?invoiceId=' +
              originalInvoice.id
          )
        ).status()
      ).toBe(401);
      await page.goto('/admin/fundraiser/invoices?contributionId=' + record.id);
      await expect(
        page.getByText(originalInvoice.invoice_number, { exact: true }).first()
      ).toBeVisible();
      const documents = [
        page
          .locator('.detail-header')
          .getByRole('button', { name: /Telecharger PDF/i }),
        ...current.credit_notes.map((note) =>
          page
            .locator('.credit-note-card')
            .filter({ hasText: note.credit_note_number })
            .getByRole('button', { name: /Telecharger PDF/i })
        )
      ];
      for (const [index, button] of documents.entries()) {
        const downloaded = page.waitForEvent('download');
        await button.click();
        const download = await downloaded;
        expect(download.suggestedFilename()).toMatch(/^openg7-.*\.pdf$/);
        const bytes = await downloadBytes(download);
        expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
        expect(bytes.length).toBeGreaterThan(1000);
        await info.attach(`document-${index}.pdf`, {
          body: bytes,
          contentType: 'application/pdf'
        });
      }
      await page.screenshot({
        path: info.outputPath('invoice-and-credit-notes.png'),
        fullPage: true
      });
    });

    await test.step('Replay confirmations and reject another refund without changing documents or totals', async () => {
      const current = await sponsor();
      expect((await postRefund(baseRequest(current.version, 1))).status()).toBe(
        409
      );
      for (const event of [...events].reverse()) await deliver(event);
      expect(
        (
          await request.post(stub + '/__test__/checkout-delivery', {
            data: { sessionId, action: 'deliver' }
          })
        ).ok()
      ).toBe(true);
      expect((await sponsor()).payment_status).toBe('refunded');
      expect((await invoice()).credit_notes).toHaveLength(amounts.length);
      expect(snapshot(await invoice())).toEqual(originalSnapshot);
      const after = await totals(amountMinor);
      const audit = (await sponsor()).admin_audit_entries.filter((e) =>
        e.action.startsWith('sponsorship_refund.stripe_')
      );
      expect(audit).toHaveLength(amounts.length);
      await page.goto('/fonds-des-batisseurs/transparence');
      const exported = page.waitForEvent('download');
      await page.locator('[data-og7="transparency-json"]').click();
      const json = (await downloadBytes(await exported)).toString('utf8');
      expect(JSON.parse(json).total_refunded).toBe(after.total_refunded);
      expect(json).not.toContain(reference);
      expect(json).not.toContain(recipient);
      await page.screenshot({
        path: info.outputPath('transparency-after-refunds.png'),
        fullPage: true
      });
      await info.attach('refund-journey-evidence', {
        body: JSON.stringify(
          {
            providers: 'simulated',
            reference,
            amountMinor,
            feeMinor,
            refunds: receipts.map((r) => ({
              id: r.refundId,
              amount: r.amount
            })),
            before,
            after,
            invoice: snapshot(await invoice()),
            audit
          },
          null,
          2
        ),
        contentType: 'application/json'
      });
      expect(errors).toEqual([]);
    });
  });
}
