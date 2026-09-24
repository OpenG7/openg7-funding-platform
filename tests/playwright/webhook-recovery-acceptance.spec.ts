import { randomUUID } from 'node:crypto';

import type {
  AdminDashboardResponse,
  AdminEmailQueueResponse,
  AdminSponsorshipsResponse,
  AdminSponsorshipInvoicesResponse,
  ContributionActivityResponse,
  FundTransparencyPublicResponse
} from '@openg7/funding-core';

import { test, expect } from './support/test.js';
import { signInAsAdmin } from './support/admin-auth.js';
import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import {
  acceptanceSql,
  restartAcceptanceApi
} from './support/acceptance-database.js';
import {
  buildStripeEvent,
  buildSignedWebhookRequest
} from './support/stripe-webhook.js';

const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
interface EventState {
  stripe_event_id: string;
  processing_status: string;
}
interface Mail {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

for (const fault of ['invoice_insert', 'invoice_email_connection'] as const) {
  test(`webhook recovery: ${fault}, restart and finish once`, async ({
    page: admin,
    context,
    request
  }, info) => {
    test.skip(
      process.env.OPENG7_E2E_ISOLATED !== '1',
      'Disposable simulation only.'
    );
    test.setTimeout(120000);
    context.setDefaultTimeout(15000);
    const stub = process.env.STRIPE_STUB_BASE_URL!;
    const email = `webhook-${randomUUID()}@simulation.example.test`;
    const name = `Reprise webhook ${randomUUID().slice(0, 8)}`;
    const get = async <T>(url: string, auth = false): Promise<T> => {
      const response = await request.get(url, auth ? { headers } : {});
      expect(response.ok(), url).toBe(true);
      return response.json() as Promise<T>;
    };
    const dashboard = () =>
      get<AdminDashboardResponse>('/api/admin/dashboard', true);
    const activity = () =>
      get<ContributionActivityResponse>(
        '/api/admin/contribution-activity',
        true
      );
    const summary = () =>
      get<FundTransparencyPublicResponse>('/api/public/fund-transparency');
    const amounts = (s: FundTransparencyPublicResponse) => ({
      received: Math.round(s.total_received * 100),
      count: s.contributions_count
    });
    const mails = async () =>
      (await get<{ messages: Mail[] }>(stub + '/__test__/mail')).messages;
    const companyMails = async () =>
      (await mails()).filter((m) => m.To.some((r) => r.Address === email));
    const adminMails = async () =>
      (await mails()).filter(
        (m) =>
          m.To.some((r) => r.Address === 'admin@simulation.example.test') &&
          m.Subject.includes('Contribution')
      );
    const sms = () => get<{ items: unknown[] }>(stub + '/__test__/sms');
    const queuedCompanyMails = async () =>
      (
        await get<AdminEmailQueueResponse>('/api/admin/email-queue', true)
      ).messages.filter((m) => m.recipient_email === email);
    const before = amounts(await summary());
    const statusBefore = (await dashboard()).stripe_events;
    const smsBefore = (await sms()).items.length;
    const adminMailBefore = (await adminMails()).length;
    await signInAsAdmin(admin);
    const english = fault === 'invoice_email_connection';
    if (english) {
      await admin
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
    }
    const company = await context.newPage();
    await company.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    company.on('pageerror', (e) => errors.push(e.message));
    await company.goto('/fonds-des-batisseurs?intent=sponsorship#support');
    const form = company.locator('[data-og7="contribution-form"]');
    await expect(
      form.getByRole('button', { name: /Commandite d'entreprise/ })
    ).toHaveAttribute('aria-pressed', 'true');
    await form.getByRole('button', { name: '500 $', exact: true }).click();
    await form.getByRole('checkbox').nth(0).check();
    await form.locator('#public-display-name').fill(name);
    await form.getByRole('checkbox').nth(2).check();
    await form.locator('button[type="submit"]').click();
    await expect(company).toHaveURL(/\/checkout\/cs_test_/);
    const sessionId = new URL(company.url()).pathname.split('/').at(-1)!;
    const session = await get<{ client_reference_id: string }>(
      stub + '/v1/checkout/sessions/' + sessionId
    );
    const reference = session.client_reference_id;
    const sponsor = async () => {
      const result = await get<AdminSponsorshipsResponse>(
        '/api/admin/sponsorships?search=' + reference,
        true
      );
      expect(result.items).toHaveLength(1);
      return result.items[0]!;
    };
    const eventState = async () =>
      await acceptanceSql<EventState>(
        `SELECT stripe_event_id,processing_status FROM stripe_events
       WHERE event_type='checkout.session.completed' AND payload#>>'{data,object,id}'=$1`,
        [sessionId]
      );
    const replay = () =>
      request.post(stub + '/__test__/checkout-delivery', {
        data: { sessionId, action: 'deliver' }
      });

    // These triggers exist only in the temporary database. Unlike editing a
    // processing status after the fact, they interrupt the actual webhook SQL.
    await acceptanceSql(`CREATE TABLE IF NOT EXISTS acceptance_webhook_faults(session_id text PRIMARY KEY, stage text NOT NULL);
      CREATE OR REPLACE FUNCTION acceptance_fail_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS(SELECT 1 FROM acceptance_webhook_faults WHERE session_id=NEW.stripe_session_id AND stage='invoice_insert') THEN
          RAISE EXCEPTION 'SIMULATED_INVOICE_WRITE_FAILURE';
        END IF;
        RETURN NEW;
      END $$;
      CREATE OR REPLACE FUNCTION acceptance_disconnect_invoice_email() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS(SELECT 1 FROM acceptance_webhook_faults WHERE stage='invoice_email_connection'
          AND NEW.idempotency_key='stripe-session:' || session_id || ':sponsorship-invoice') THEN
          PERFORM pg_terminate_backend(pg_backend_pid());
        END IF;
        RETURN NEW;
      END $$;
      DROP TRIGGER IF EXISTS acceptance_invoice_fault ON sponsorship_invoices;
      CREATE TRIGGER acceptance_invoice_fault BEFORE INSERT ON sponsorship_invoices FOR EACH ROW EXECUTE FUNCTION acceptance_fail_invoice();
      DROP TRIGGER IF EXISTS acceptance_invoice_email_fault ON email_messages;
      CREATE TRIGGER acceptance_invoice_email_fault BEFORE INSERT ON email_messages FOR EACH ROW EXECUTE FUNCTION acceptance_disconnect_invoice_email();`);
    await acceptanceSql('INSERT INTO acceptance_webhook_faults VALUES($1,$2)', [
      sessionId,
      fault
    ]);
    try {
      await company.getByLabel('Courriel simulé').fill(email);
      await company
        .getByRole('button', { name: 'Confirmer le paiement simulé' })
        .click();
      await expect(company.locator('#followup-companyName')).toBeVisible();
      const id = (await sponsor()).id;
      const invoices = async () =>
        (
          await get<AdminSponsorshipInvoicesResponse>(
            '/api/admin/sponsorship-invoices?contributionId=' + id,
            true
          )
        ).invoices;
      const expectedState =
        fault === 'invoice_insert' ? 'failed' : 'processing';
      await expect
        .poll(async () => (await eventState()).map((e) => e.processing_status))
        .toEqual([expectedState]);
      const event = (await eventState())[0]!;
      expect(await sponsor()).toMatchObject({
        payment_status: 'paid',
        sponsor_review_status: 'pending_review',
        sponsor_details_submitted_at: null,
        sponsor_feed_status: 'not_planned'
      });
      expect(amounts(await summary())).toEqual({
        received: before.received + 50000,
        count: before.count + 1
      });
      const initialInvoices = await invoices();
      expect(initialInvoices).toHaveLength(fault === 'invoice_insert' ? 0 : 1);
      await expect.poll(async () => (await companyMails()).length).toBe(1);
      expect((await queuedCompanyMails()).map((m) => m.template_key)).toEqual([
        'sponsorship_followup'
      ]);
      await expect
        .poll(
          async () =>
            (await activity()).items
              .filter((i) => i.contributionId === id)
              .map((i) => [i.email, i.sms]),
          { timeout: 15000 }
        )
        .toEqual([['sent', 'captured']]);
      const item = (await activity()).items.find(
        (i) => i.contributionId === id
      )!;
      await expect(
        admin.locator(
          `[data-og7="contribution-toast"][data-og7-id="${item.id}"]`
        )
      ).toBeVisible({ timeout: 15000 });
      const initialMailIds = (await queuedCompanyMails()).map((m) => m.id);
      const field = expectedState === 'failed' ? 'failed' : 'processing';
      expect((await dashboard()).stripe_events[field]).toBe(
        statusBefore[field] + 1
      );
      await admin.goto('/admin/fundraiser');
      const stripePanel = admin.locator(
        'section[aria-labelledby="admin-stripe-title"]'
      );
      await expect(stripePanel).toBeVisible();
      const failedCount = stripePanel
        .locator('dl > div')
        .filter({ hasText: english ? 'Failed' : 'En erreur' })
        .locator('dd');
      const processingCount = stripePanel
        .locator('dl > div')
        .filter({ hasText: english ? 'Processing' : 'En traitement' })
        .locator('dd');
      await expect(failedCount).toHaveText(
        String(statusBefore.failed + Number(expectedState === 'failed'))
      );
      await expect(processingCount).toHaveText(
        String(statusBefore.processing + Number(expectedState === 'processing'))
      );
      await stripePanel.screenshot({
        path: info.outputPath('webhook-interrupted.png')
      });
      // The fault is still active: another signed delivery must not pretend to
      // finish, nor duplicate the already delivered follow-up or paid amount.
      expect((await replay()).status()).toBe(502);
      expect((await eventState())[0]).toEqual(event);
      expect((await queuedCompanyMails()).map((m) => m.id)).toEqual(
        initialMailIds
      );
      expect(await companyMails()).toHaveLength(1);

      await restartAcceptanceApi();
      await expect
        .poll(
          async () => {
            try {
              return (
                await request.get('/api/admin/dashboard', { headers })
              ).status();
            } catch {
              return 0;
            }
          },
          { timeout: 45000, intervals: [1000] }
        )
        .toBe(200);
      expect((await eventState())[0]).toEqual(event);
      expect(amounts(await summary())).toEqual({
        received: before.received + 50000,
        count: before.count + 1
      });
      await acceptanceSql(
        'DELETE FROM acceptance_webhook_faults WHERE session_id=$1',
        [sessionId]
      );
      expect((await replay()).ok()).toBe(true);
      await expect
        .poll(async () => (await eventState())[0]?.processing_status)
        .toBe('processed');
      await expect.poll(async () => (await companyMails()).length).toBe(2);
      const finalInvoice = (await invoices())[0]!;
      expect(await invoices()).toHaveLength(1);
      expect(finalInvoice).toMatchObject({ total: 500, currency: 'CAD' });
      if (initialInvoices[0])
        expect(finalInvoice).toMatchObject({
          id: initialInvoices[0].id,
          invoice_number: initialInvoices[0].invoice_number,
          issued_at: initialInvoices[0].issued_at
        });
      const finalMailIds = (await queuedCompanyMails()).map((m) => m.id).sort();
      expect(finalMailIds).toHaveLength(2);
      expect(finalMailIds).toContain(initialMailIds[0]);
      const signed = buildSignedWebhookRequest(
        buildStripeEvent(
          event.stripe_event_id,
          'checkout.session.completed',
          await get<Record<string, unknown>>(
            stub + '/v1/checkout/sessions/' + sessionId
          )
        )
      );
      const deliverDirectly = () =>
        request.post('/api/stripe/webhook', {
          headers: signed.headers,
          data: signed.body
        });
      const replayResults = await Promise.all([
        deliverDirectly(),
        deliverDirectly()
      ]);
      expect(replayResults.some((r) => r.status() === 200)).toBe(true);
      for (const result of replayResults) {
        // Even duplicate checks acquire the event lock. A concurrent delivery
        // can receive a retryable 503; it must succeed once the owner returns.
        expect([200, 503]).toContain(result.status());
        if (result.status() === 503) {
          expect(await result.json()).toMatchObject({ received: false });
          expect((await deliverDirectly()).status()).toBe(200);
        }
      }
      expect(await eventState()).toEqual([
        {
          stripe_event_id: event.stripe_event_id,
          processing_status: 'processed'
        }
      ]);
      expect((await queuedCompanyMails()).map((m) => m.id).sort()).toEqual(
        finalMailIds
      );
      expect(await invoices()).toEqual([finalInvoice]);
      expect(await companyMails()).toHaveLength(2);
      expect(await adminMails()).toHaveLength(adminMailBefore + 1);
      expect((await sms()).items).toHaveLength(smsBefore + 1);
      expect(
        (await activity()).items
          .filter((i) => i.contributionId === id)
          .map((i) => i.id)
      ).toEqual([item.id]);
      expect(amounts(await summary())).toEqual({
        received: before.received + 50000,
        count: before.count + 1
      });
      expect((await dashboard()).stripe_events.failed).toBe(
        statusBefore.failed
      );
      expect((await dashboard()).stripe_events.processing).toBe(
        statusBefore.processing
      );
      await admin.reload();
      await expect(stripePanel).toBeVisible();
      await expect(failedCount).toHaveText(String(statusBefore.failed));
      await expect(processingCount).toHaveText(String(statusBefore.processing));
      await stripePanel.screenshot({
        path: info.outputPath('webhook-recovered.png')
      });
      await company.reload();
      await expect(company.locator('#followup-companyName')).toBeVisible();
      expect(
        JSON.stringify(await get('/api/public/sponsorships'))
      ).not.toContain(name);
      const pdf = await request.get(
        '/api/admin/sponsorship-invoices/pdf?invoiceId=' + finalInvoice.id,
        { headers }
      );
      expect(pdf.ok()).toBe(true);
      expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
      await info.attach('webhook-recovery-evidence', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            fault,
            providers: 'simulated',
            eventId: event.stripe_event_id,
            interruptedState: expectedState,
            finalState: 'processed',
            invoicePreserved: initialInvoices.length === 1,
            invoiceId: finalInvoice.id,
            activityId: item.id,
            companyEmailCount: 2,
            adminEmailCount: 1,
            smsCount: 1,
            after: amounts(await summary())
          },
          null,
          2
        )
      });
      expect(errors).toEqual([]);
    } finally {
      await acceptanceSql(
        'DELETE FROM acceptance_webhook_faults WHERE session_id=$1',
        [sessionId]
      );
      await company.close();
    }
  });
}
