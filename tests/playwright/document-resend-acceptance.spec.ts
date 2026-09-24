import { createHash, randomUUID } from 'node:crypto';

import type {
  AdminAuditLogResponse,
  AdminEmailQueueResponse,
  AdminSponsorshipInvoicesResponse,
  AdminSponsorshipsResponse,
  FundTransparencyPublicResponse
} from '@openg7/funding-core';

import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';
import {
  buildPaymentIntentSucceededEvent,
  buildSignedWebhookRequest
} from './support/stripe-webhook.js';
import { expect, test } from './support/test.js';

test('confirmed invoice and credit-note resends recover from SMTP failure and lost responses without changing financial documents', async ({
  page,
  request
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable simulation only.'
  );
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
  const stub = process.env.STRIPE_STUB_BASE_URL!;
  const email = `payer-${randomUUID()}@simulation.example.test`;
  const corrected = `documents-${randomUUID()}@simulation.example.test`;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const get = async <T>(url: string, authenticated = true): Promise<T> => {
    const r = await request.get(url, authenticated ? { headers } : {});
    expect(r.ok(), url).toBe(true);
    return r.json();
  };
  const gate = async (mode: 'allow' | 'reject') => {
    expect(
      (await request.post(stub + '/__test__/smtp', { data: { mode } })).ok()
    ).toBe(true);
  };
  const queue = () => get<AdminEmailQueueResponse>('/api/admin/email-queue');
  const totals = () =>
    get<FundTransparencyPublicResponse>('/api/public/fund-transparency', false);
  const pdf = async (url: string) => {
    const response = await request.get(url, { headers });
    expect(response.ok()).toBe(true);
    const buffer = await response.body();
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    return createHash('sha256').update(buffer).digest('hex');
  };
  try {
    await gate('allow');
    await page.goto('/fonds-des-batisseurs?intent=sponsorship#support');
    const form = page.locator('[data-og7="contribution-form"]');
    await form.getByRole('button', { name: '500 $', exact: true }).click();
    await form.getByRole('checkbox').nth(0).uncheck();
    await form.getByRole('checkbox').nth(1).uncheck();
    await form.getByRole('checkbox').nth(2).check();
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/checkout\/cs_test_/);
    const session = await get<{
      client_reference_id: string;
      payment_intent: string;
      metadata: Record<string, string>;
    }>(
      stub +
        '/v1/checkout/sessions/' +
        new URL(page.url()).pathname.split('/').at(-1)!,
      false
    );
    await page.getByLabel('Courriel simulé').fill(email);
    await page
      .getByRole('button', { name: 'Confirmer le paiement simulé' })
      .click();
    await expect(page.locator('#followup-companyName')).toBeVisible();
    const sponsor = async () =>
      (
        await get<AdminSponsorshipsResponse>(
          '/api/admin/sponsorships?search=' + session.client_reference_id
        )
      ).items[0]!;
    const record = await sponsor();
    const invoices = async () =>
      (
        await get<AdminSponsorshipInvoicesResponse>(
          '/api/admin/sponsorship-invoices?contributionId=' + record.id
        )
      ).invoices;
    await expect
      .poll(async () => (await invoices())[0]?.last_email_status)
      .toBe('sent');
    const registration = await request.post(
      stub + '/__test__/payment-intents',
      {
        data: {
          id: session.payment_intent,
          amount: 50000,
          currency: 'cad',
          fee: 1000,
          metadata: session.metadata
        }
      }
    );
    expect(registration.ok()).toBe(true);
    const signed = buildSignedWebhookRequest(
      buildPaymentIntentSucceededEvent({
        eventId: 'evt_document_' + randomUUID(),
        paymentIntentId: session.payment_intent,
        chargeId: (await registration.json()).chargeId,
        amountCents: 50000
      })
    );
    expect(
      (
        await request.post('/api/stripe/webhook', {
          data: signed.body,
          headers: signed.headers
        })
      ).ok()
    ).toBe(true);
    const refund = await request.post('/api/admin/sponsorships/refund', {
      headers,
      data: {
        contributionId: record.id,
        expectedVersion: (await sponsor()).version,
        confirmationText: session.client_reference_id,
        amount: 100
      }
    });
    expect(refund.ok(), await refund.text()).toBe(true);
    const original = (await invoices())[0]!;
    expect(original.credit_notes).toHaveLength(1);
    const note = original.credit_notes[0]!;
    const beforeTotals = await totals();
    const beforeSponsor = await sponsor();
    const snapshot = (value: typeof original) => ({
      id: value.id,
      number: value.invoice_number,
      total: value.total,
      currency: value.currency,
      issuedAt: value.issued_at,
      sponsor: value.sponsor_contact_email,
      lines: value.line_items,
      notes: value.notes,
      credits: value.credit_notes.map((n) => ({
        id: n.id,
        number: n.credit_note_number,
        total: n.total,
        lines: n.line_items,
        sponsor: n.sponsor_contact_email
      }))
    });
    const originalSnapshot = snapshot(original);
    await signInAsAdmin(page);
    for (const kind of ['invoice', 'creditNote'] as const) {
      const id = kind === 'invoice' ? original.id : note.id;
      const number =
        kind === 'invoice' ? original.invoice_number : note.credit_note_number;
      const endpoint =
        '/api/admin/sponsorship-' +
        (kind === 'invoice' ? 'invoices' : 'credit-notes') +
        '/resend';
      const pdfUrl =
        endpoint.replace('/resend', '/pdf') + '?' + kind + 'Id=' + id;
      const originalPdf = await pdf(pdfUrl);
      const payload = {
        [kind + 'Id']: id,
        to: corrected,
        requestId: randomUUID(),
        confirmation: id
      };
      await test.step(
        kind +
          ': authentication, confirmation and recipient validation precede queueing',
        async () => {
          expect(
            (await request.post(endpoint, { data: payload })).status()
          ).toBe(401);
          for (const invalid of [
            { ...payload, confirmation: '' },
            { ...payload, requestId: '' },
            { ...payload, to: '' }
          ])
            expect(
              (
                await request.post(endpoint, { headers, data: invalid })
              ).status()
            ).toBe(400);
        }
      );
      await page.goto('/admin/fundraiser/invoices?contributionId=' + record.id);
      const panel =
        kind === 'invoice'
          ? page
          : page.locator('[data-og7="credit-note"][data-og7-id="' + id + '"]');
      const recipient = panel.getByLabel(
        kind === 'invoice' ? 'Destinataire' : 'Destinataire avoir',
        { exact: true }
      );
      await recipient.fill(corrected);
      const send = panel.getByRole('button', {
        name: kind === 'invoice' ? 'Renvoyer' : 'Renvoyer avoir',
        exact: true
      });
      await send.click();
      const confirmation = page.getByRole('dialog', {
        name: 'Confirmer l’action'
      });
      await expect(confirmation).toContainText(corrected);
      await expect(confirmation).toContainText(number);
      await confirmation
        .getByRole('button', { name: 'Annuler', exact: true })
        .last()
        .click();
      const targeted = async () =>
        (await queue()).messages.filter(
          (m) =>
            m.recipient_email === corrected &&
            m.metadata[kind + 'Id'] === id &&
            m.template_key ===
              (kind === 'invoice'
                ? 'sponsorship_invoice'
                : 'sponsorship_credit_note')
        );
      expect(await targeted()).toHaveLength(0);
      let body: Record<string, unknown> = {};
      let messageId = '';
      await test.step(
        kind +
          ': lost response reuses the confirmed request, then SMTP failure remains visible',
        async () => {
          await gate('reject');
          await page.route(
            '**' + endpoint,
            async (route) => {
              body = route.request().postDataJSON();
              const response = await route.fetch({ maxRetries: 0 });
              expect(response.ok()).toBe(true);
              messageId = (await response.json()).messageId;
              await route.abort('failed');
            },
            { times: 1 }
          );
          await send.click();
          await page.locator('[data-og7="confirm-action"]').click();
          await expect.poll(() => messageId).not.toBe('');
          await expect(send).toBeEnabled();
          await page.reload();
          await recipient.fill(corrected);
          await send.click();
          const recovered = page.waitForResponse(
            (r) => r.url().endsWith(endpoint) && r.request().method() === 'POST'
          );
          await page.locator('[data-og7="confirm-action"]').click();
          const response = await recovered;
          expect(response.ok()).toBe(true);
          expect(response.request().postDataJSON()).toEqual(body);
          expect((await response.json()).messageId).toBe(messageId);
          const duplicates = await Promise.all(
            [1, 2].map(() => request.post(endpoint, { headers, data: body }))
          );
          for (const duplicate of duplicates) {
            expect(duplicate.ok()).toBe(true);
            expect((await duplicate.json()).messageId).toBe(messageId);
          }
          expect(
            (
              await request.post(endpoint, {
                headers,
                data: { ...body, to: 'changed@simulation.example.test' }
              })
            ).status()
          ).toBe(409);
          await expect
            .poll(async () => (await targeted())[0]?.status, { timeout: 20000 })
            .toBe('failed');
          expect(await targeted()).toHaveLength(1);
        }
      );
      await test.step(
        kind +
          ': retry the same queue entry and observe exactly one captured mail',
        async () => {
          await gate('allow');
          await page
            .locator(
              '[data-og7="document-email-status"][data-og7-id="' + id + '"]'
            )
            .click();
          await expect(page).toHaveURL(
            new RegExp('/admin/fundraiser/email-queue\\?messageId=' + messageId)
          );
          const row = page.getByRole('row').filter({ hasText: corrected });
          await row
            .getByRole('button', { name: 'Relancer', exact: true })
            .click();
          await page.locator('[data-og7="confirm-action"]').click();
          await expect(
            row.locator('[data-og7="email-retry-result"]')
          ).toContainText('Message envoye.');
          await expect
            .poll(async () => (await targeted())[0]?.status)
            .toBe('sent');
          const mails = await get<{
            messages: { Subject: string; To: { Address: string }[] }[];
          }>(stub + '/__test__/mail', false);
          expect(
            mails.messages.filter(
              (m) =>
                m.Subject.includes(number) &&
                m.To.some((to) => to.Address === corrected)
            )
          ).toHaveLength(1);
          expect(
            (
              await request.post('/api/admin/email-queue/retry', {
                headers,
                data: { messageId }
              })
            ).status()
          ).toBe(409);
          expect(await pdf(pdfUrl)).toBe(originalPdf);
          const audit = await get<AdminAuditLogResponse>(
            '/api/admin/audit-log'
          );
          expect(
            audit.entries.filter(
              (e) =>
                e.entity_id === id &&
                e.action ===
                  (kind === 'invoice'
                    ? 'sponsorship_invoice.resend'
                    : 'sponsorship_credit_note.resend')
            )
          ).toHaveLength(1);
          await page.screenshot({
            path: info.outputPath(kind + '-resend-recovered.png'),
            fullPage: true
          });
        }
      );
    }
    expect(snapshot((await invoices())[0]!)).toEqual(originalSnapshot);
    expect(await sponsor()).toEqual(beforeSponsor);
    const afterTotals = await totals();
    for (const key of [
      'total_received',
      'total_refunded',
      'contributions_count'
    ] as const)
      expect(afterTotals[key]).toBe(beforeTotals[key]);
    expect(
      JSON.stringify(await get('/api/public/sponsorships', false))
    ).not.toContain(corrected);
    expect(errors).toEqual([]);
  } finally {
    await gate('allow');
  }
});
