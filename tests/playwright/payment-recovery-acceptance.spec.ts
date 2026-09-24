import { randomUUID } from 'node:crypto';

import type {
  AdminContributionsResponse,
  AdminEmailQueueResponse,
  AdminSponsorshipsResponse,
  ContributionActivityResponse,
  FundTransparencyPublicResponse
} from '@openg7/funding-core';

import { test, expect } from './support/test.js';
import { signInAsAdmin } from './support/admin-auth.js';
import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import {
  buildStripeEvent,
  buildSignedWebhookRequest
} from './support/stripe-webhook.js';

const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
interface Session {
  id: string;
  payment_intent: string;
  client_reference_id: string;
  metadata: Record<string, string>;
  success_url: string;
  cancel_url: string;
  amount_total: number;
  currency: string;
  created: number;
}
interface Mail {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

for (const outcome of ['abandoned', 'declined', 'expired'] as const) {
  test(`company 500 CAD: ${outcome}, retry and one confirmed payment`, async ({
    page: admin,
    context,
    request
  }, info) => {
    test.skip(
      process.env.OPENG7_E2E_ISOLATED !== '1',
      'Disposable simulation only.'
    );
    test.setTimeout(90000);
    const stub = process.env.STRIPE_STUB_BASE_URL!;
    const email = `payment-${randomUUID()}@simulation.example.test`;
    const companyName = `Reprise ${outcome} ${randomUUID().slice(0, 8)}`;
    const english = outcome === 'expired';
    const prefix = english ? '/en' : '';
    const get = async <T>(url: string, auth = false): Promise<T> => {
      const response = await request.get(url, auth ? { headers } : {});
      expect(response.ok(), url).toBe(true);
      return response.json() as Promise<T>;
    };
    const summary = () =>
      get<FundTransparencyPublicResponse>('/api/public/fund-transparency');
    const financial = (s: FundTransparencyPublicResponse) => ({
      received: Math.round(s.total_received * 100),
      count: s.contributions_count
    });
    const activity = () =>
      get<ContributionActivityResponse>(
        '/api/admin/contribution-activity',
        true
      );
    const queue = () =>
      get<AdminEmailQueueResponse>('/api/admin/email-queue', true);
    const companyMails = async () =>
      (
        await get<{ messages: Mail[] }>(stub + '/__test__/mail')
      ).messages.filter((m) => m.To.some((r) => r.Address === email));
    const adminContributionMails = async () =>
      (
        await get<{ messages: Mail[] }>(stub + '/__test__/mail')
      ).messages.filter(
        (m) =>
          m.To.some((r) => r.Address === 'admin@simulation.example.test') &&
          m.Subject.includes('Contribution')
      );
    const sms = () => get<{ items: unknown[] }>(stub + '/__test__/sms');
    const lookup = async (session: Session) => {
      const result = await request.post('/api/reference-lookup', {
        data: { reference: session.client_reference_id }
      });
      expect(result.ok()).toBe(true);
      return result.json();
    };
    const record = async (session: Session) => {
      const all = await get<AdminContributionsResponse>(
        '/api/admin/contributions',
        true
      );
      const found = all.contributions.filter(
        (c) => c.stripe_session_id === session.id
      );
      expect(found).toHaveLength(1);
      return found[0]!;
    };
    const invoices = async (session: Session) =>
      get<{ invoices: unknown[] }>(
        '/api/admin/sponsorship-invoices?contributionId=' +
          (await record(session)).id,
        true
      );
    const control = async (session: Session, action: string) => {
      const result = await request.post(stub + '/__test__/checkout-delivery', {
        data: { sessionId: session.id, action }
      });
      expect(result.ok()).toBe(true);
    };
    const deliver = async (event: Record<string, unknown>) => {
      const signed = buildSignedWebhookRequest(event);
      const result = await request.post('/api/stripe/webhook', {
        headers: signed.headers,
        data: signed.body
      });
      expect(result.ok()).toBe(true);
    };
    const before = financial(await summary());
    const smsBefore = (await sms()).items.length;
    const mailBefore = (await adminContributionMails()).length;
    await signInAsAdmin(admin);
    const company = await context.newPage();
    await company.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    company.on('pageerror', (e) => errors.push(e.message));
    const start = async () => {
      const form = company.locator('[data-og7="contribution-form"]');
      const type = form.getByRole('button', {
        name: english ? /Business sponsorship/ : /Commandite d'entreprise/
      });
      await expect(type).toHaveAttribute('aria-pressed', 'true');
      await form
        .getByRole('button', {
          name: english ? 'CA$500' : '500 $',
          exact: true
        })
        .click();
      await form.getByRole('checkbox').nth(0).check();
      await form.locator('#public-display-name').fill(companyName);
      await form.getByRole('checkbox').nth(1).uncheck();
      await form.getByRole('checkbox').nth(2).check();
      await form.locator('button[type="submit"]').click();
      await expect(company).toHaveURL(/\/checkout\/cs_test_/);
      const id = new URL(company.url()).pathname.split('/').at(-1)!;
      await company.getByLabel('Courriel simulé').fill(email);
      return get<Session>(stub + '/v1/checkout/sessions/' + id);
    };
    await company.goto(
      `${prefix}/fonds-des-batisseurs?intent=sponsorship#support`
    );
    const first = await start();
    expect((await record(first)).stripe_payment_intent_id).toBeNull();
    if (outcome !== 'abandoned') {
      await company
        .getByRole('button', {
          name:
            outcome === 'declined'
              ? 'Simuler un refus'
              : 'Simuler une expiration'
        })
        .click();
      await expect(company.getByRole('alert')).toContainText(
        outcome === 'declined' ? 'refusé' : 'expirée'
      );
    }
    await company.getByRole('link', { name: 'Retourner à OpenG7' }).click();
    const notice = company.locator('openg7-funding-checkout-notice');
    const expectedStatus =
      outcome === 'abandoned'
        ? 'pending'
        : outcome === 'declined'
          ? 'failed'
          : 'expired';
    await expect(notice.locator('#checkout-cancel-title')).toHaveText(
      outcome === 'abandoned'
        ? 'Le coffre reste fermé pour cette contribution.'
        : outcome === 'declined'
          ? 'Votre tentative de paiement n’a pas abouti.'
          : 'This checkout session has expired.'
    );
    expect(await lookup(first)).toMatchObject({
      paymentStatus: expectedStatus
    });
    expect(financial(await summary())).toEqual(before);
    expect(
      (await activity()).items.filter(
        (i) => i.reference === first.client_reference_id
      )
    ).toHaveLength(0);
    expect((await invoices(first)).invoices).toHaveLength(0);
    expect(await companyMails()).toHaveLength(0);
    expect(JSON.stringify(await get('/api/public/sponsorships'))).not.toContain(
      companyName
    );
    expect((await sms()).items).toHaveLength(smsBefore);
    expect(await adminContributionMails()).toHaveLength(mailBefore);
    expect(
      (await queue()).messages.filter((m) => m.recipient_email === email)
    ).toHaveLength(0);
    if (outcome !== 'abandoned') await control(first, 'replay-negative');
    // Even a forged success return cannot grant a paid status or a paid invoice.
    const forged = new URL(company.url());
    forged.searchParams.set('checkout', 'success');
    await company.goto(forged.toString());
    expect(await lookup(first)).toMatchObject({
      paymentStatus: expectedStatus
    });
    expect(financial(await summary())).toEqual(before);
    await company.goto(first.cancel_url);
    await expect(notice.locator('#checkout-cancel-title')).toBeVisible();
    await company.screenshot({
      path: info.outputPath('unsuccessful-payment-mobile.png'),
      fullPage: true
    });
    await notice
      .getByRole('button', {
        name: english ? 'Try again' : 'Réessayer',
        exact: true
      })
      .click();
    await expect(notice.locator('#checkout-cancel-title')).toHaveCount(0);
    await expect(company.locator('#support')).toBeFocused();
    const second = await start();
    expect(second.id).not.toBe(first.id);
    expect(second.client_reference_id).not.toBe(first.client_reference_id);
    expect(second.metadata.contributionType).toBe('sponsorship_interest');
    expect(second.amount_total).toBe(50000);
    // No financial effect until the provider confirms this second attempt.
    expect(financial(await summary())).toEqual(before);
    await company
      .getByRole('button', { name: 'Confirmer le paiement simulé' })
      .click();
    await expect(company.locator('#followup-companyName')).toBeVisible();
    await expect
      .poll(
        async () =>
          (await activity()).items
            .filter((i) => i.reference === second.client_reference_id)
            .map((i) => [i.email, i.sms]),
        { timeout: 15000 }
      )
      .toEqual([['sent', 'captured']]);
    const item = (await activity()).items.find(
      (i) => i.reference === second.client_reference_id
    )!;
    await expect(
      admin.locator(`[data-og7="contribution-toast"][data-og7-id="${item.id}"]`)
    ).toBeVisible({ timeout: 15000 });
    expect(financial(await summary())).toEqual({
      received: before.received + 50000,
      count: before.count + 1
    });
    expect((await invoices(second)).invoices).toHaveLength(1);
    await expect.poll(async () => (await companyMails()).length).toBe(2);
    expect(await adminContributionMails()).toHaveLength(mailBefore + 1);
    expect((await sms()).items).toHaveLength(smsBefore + 1);
    const paidMessages = (await queue()).messages
      .filter((m) => m.recipient_email === email)
      .map((m) => m.id)
      .sort();
    expect(paidMessages).toHaveLength(2);
    await control(second, 'deliver');
    if (outcome !== 'abandoned') await control(first, 'replay-negative');
    // Fresh event IDs force the status guards to run, beyond event deduplication.
    await deliver(
      buildStripeEvent(
        'evt_late_failure_' + randomUUID(),
        'payment_intent.payment_failed',
        {
          id: second.payment_intent,
          object: 'payment_intent',
          amount: 50000,
          currency: 'cad',
          metadata: second.metadata
        }
      )
    );
    await deliver(
      buildStripeEvent(
        'evt_late_expiry_' + randomUUID(),
        'checkout.session.expired',
        {
          ...second,
          object: 'checkout.session',
          status: 'expired',
          payment_status: 'unpaid',
          customer_details: { email }
        }
      )
    );
    expect(await lookup(second)).toMatchObject({ paymentStatus: 'paid' });
    expect(await lookup(first)).toMatchObject({
      paymentStatus: expectedStatus
    });
    expect(financial(await summary())).toEqual({
      received: before.received + 50000,
      count: before.count + 1
    });
    expect((await invoices(first)).invoices).toHaveLength(0);
    expect((await invoices(second)).invoices).toHaveLength(1);
    expect(
      (await activity()).items.filter(
        (i) => i.reference === second.client_reference_id
      )
    ).toHaveLength(1);
    expect(
      (await queue()).messages
        .filter((m) => m.recipient_email === email)
        .map((m) => m.id)
        .sort()
    ).toEqual(paidMessages);
    expect((await sms()).items).toHaveLength(smsBefore + 1);
    expect(await companyMails()).toHaveLength(2);
    expect(await adminContributionMails()).toHaveLength(mailBefore + 1);
    // Revisiting the old cancellation URL for the now-paid attempt shows confirmation.
    await company.goto(second.cancel_url);
    await expect(company.locator('#checkout-success-title')).toBeVisible();
    const sponsor = (
      await get<AdminSponsorshipsResponse>(
        '/api/admin/sponsorships?search=' + item.contributionId,
        true
      )
    ).items[0]!;
    expect(sponsor).toMatchObject({
      payment_status: 'paid',
      sponsor_review_status: 'pending_review'
    });
    expect(sponsor.sponsor_feed_status).toBe('not_planned');
    expect(sponsor.sponsor_details_submitted_at).toBeNull();
    expect(JSON.stringify(await get('/api/public/sponsorships'))).not.toContain(
      companyName
    );
    await info.attach('payment-recovery-evidence', {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          providers: 'simulated',
          outcome,
          before,
          after: financial(await summary()),
          unsuccessfulReference: first.client_reference_id,
          paidReference: second.client_reference_id,
          activityId: item.id,
          invoiceCount: 1,
          companyEmailCount: 2,
          adminEmailCount: 1,
          smsCount: 1
        },
        null,
        2
      )
    });
    expect(errors).toEqual([]);
    await company.close();
  });
}
