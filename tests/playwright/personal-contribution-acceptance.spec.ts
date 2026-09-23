import { randomUUID } from 'node:crypto';

import type { APIRequestContext, Download } from '@playwright/test';
import type {
  AdminContributionsResponse,
  ContributionActivityResponse,
  FundTransparencyPublicResponse,
  PublicBuildersResponse
} from '@openg7/funding-core';

import { test, expect } from './support/test.js';
import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import {
  buildPaymentIntentSucceededEvent,
  buildSignedWebhookRequest
} from './support/stripe-webhook.js';

const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
const amountMinor = 2500;
// Synthetic provider fee, not a claim about real Stripe pricing.
const feeMinor = 73;
const minor = (amount: number) => Math.round(amount * 100);
const normalizeSpaces = (value: string) => value.replace(/\s/g, ' ');

async function json<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(url);
  expect(response.ok(), url).toBe(true);
  return response.json() as Promise<T>;
}

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

const variants = [
  { label: 'public name and amount', name: true, amount: true },
  { label: 'public name only', name: true, amount: false },
  { label: 'private contribution', name: false, amount: false },
  { label: 'private name despite amount consent', name: false, amount: true }
];

for (const variant of variants) {
  test(`personal 25 CAD: delayed confirmation, unique totals and ${variant.label}`, async ({
    page,
    request
  }, info) => {
    test.skip(
      process.env.OPENG7_E2E_ISOLATED !== '1',
      'Disposable simulation only.'
    );
    test.setTimeout(90000);
    const stub = process.env.STRIPE_STUB_BASE_URL!;
    const displayName = `Personne Démo ${randomUUID().slice(0, 8)}`;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const summary = () =>
      json<FundTransparencyPublicResponse>(
        request,
        '/api/public/fund-transparency'
      );
    const builders = () =>
      json<PublicBuildersResponse>(request, '/api/public/builders?pageSize=50');
    const activity = async () => {
      const response = await request.get('/api/admin/contribution-activity', {
        headers
      });
      expect(response.ok()).toBe(true);
      return response.json() as Promise<ContributionActivityResponse>;
    };
    const before = await summary();
    const buildersBefore = await builders();
    const adminBeforeResponse = await request.get('/api/admin/contributions', {
      headers
    });
    expect(adminBeforeResponse.ok()).toBe(true);
    const adminBefore =
      (await adminBeforeResponse.json()) as AdminContributionsResponse;
    expect(before.data_source).toBe('database');
    expect(before.currency.toUpperCase()).toBe('CAD');

    await page.goto('/fonds-des-batisseurs#support');
    const form = page.locator('[data-og7="contribution-form"]');
    const personal = form.getByRole('button', {
      name: /Contribution personnelle/i
    });
    await personal.click();
    await expect(personal).toHaveAttribute('aria-pressed', 'true');
    await form.getByRole('button', { name: '25 $', exact: true }).click();
    const consents = form.getByRole('checkbox');
    await expect(consents).toHaveCount(3);
    // Enter a name before disabling visibility: stale input must not leak publicly.
    await consents.nth(0).check();
    await form.locator('#public-display-name').fill(displayName);
    if (!variant.name) await consents.nth(0).uncheck();
    await consents.nth(1).setChecked(variant.amount);
    await expect(form.locator('button[type="submit"]')).toBeDisabled();
    await consents.nth(2).check();
    const checkoutRequest = page.waitForRequest(
      (r) => r.url().endsWith('/checkout-sessions') && r.method() === 'POST'
    );
    await form.locator('button[type="submit"]').click();
    const submitted = (await checkoutRequest).postDataJSON();
    expect(submitted).toMatchObject({
      amount: 25,
      currency: 'CAD',
      contributionType: 'personal_support',
      publicDisplayConsent: variant.name,
      displayAmountConsent: variant.amount,
      nonCharityAcknowledged: true
    });
    await expect(page).toHaveURL(/\/checkout\/cs_test_/);
    const checkoutUrl = page.url();
    const sessionId = new URL(checkoutUrl).pathname.split('/').at(-1)!;
    const session = await json<{
      payment_intent: string;
      client_reference_id: string;
      payment_status: string;
      metadata: Record<string, string>;
    }>(request, `${stub}/v1/checkout/sessions/${sessionId}`);
    const reference = session.client_reference_id;
    expect(session.payment_status).toBe('unpaid');
    const control = (action: 'defer' | 'deliver') =>
      request.post(`${stub}/__test__/checkout-delivery`, {
        data: { sessionId, action }
      });
    expect((await control('deliver')).status()).toBe(409);
    expect((await control('defer')).ok()).toBe(true);
    const lookup = async () => {
      const response = await request.post('/api/reference-lookup', {
        data: { reference }
      });
      expect(response.ok()).toBe(true);
      return response.json();
    };
    expect(await lookup()).toMatchObject({
      found: true,
      paymentStatus: 'pending'
    });

    await page
      .getByRole('button', { name: 'Confirmer le paiement simulé' })
      .click();
    await expect(
      page.getByRole('heading', {
        name: /Votre paiement est en cours de confirmation/i
      })
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get('reference')).toBe(reference);
    expect(new URL(page.url()).searchParams.has('followup_token')).toBe(false);
    await expect(
      page.getByRole('link', { name: /Compl.ter le suivi commanditaire/i })
    ).toHaveCount(0);

    const financialSnapshot = (report: FundTransparencyPublicResponse) => ({
      count: report.contributions_count,
      received: minor(report.total_received),
      fees: minor(report.total_fees),
      net: minor(report.total_net),
      refunded: minor(report.total_refunded),
      available: minor(report.current_available_estimate)
    });
    expect(financialSnapshot(await summary())).toEqual(
      financialSnapshot(before)
    );
    expect((await builders()).pagination.total_count).toBe(
      buildersBefore.pagination.total_count
    );
    expect(
      (await activity()).items.some((item) => item.reference === reference)
    ).toBe(false);
    await page.screenshot({
      path: info.outputPath('payment-pending.png'),
      fullPage: true
    });

    const invalid = await request.post('/api/stripe/webhook', {
      headers: {
        'stripe-signature': 'invalid',
        'content-type': 'application/json'
      },
      data: '{}'
    });
    expect(invalid.status()).toBe(400);
    expect(await lookup()).toMatchObject({ paymentStatus: 'pending' });
    // Reloading the success URL cannot manufacture a confirmed payment.
    await page.reload();
    await expect(
      page.getByRole('heading', {
        name: /Votre paiement est en cours de confirmation/i
      })
    ).toBeVisible();
    expect(financialSnapshot(await summary())).toEqual(
      financialSnapshot(before)
    );

    expect((await control('deliver')).ok()).toBe(true);
    await expect(
      page.getByRole('heading', {
        name: /Le coffre des B.tisseurs vient de recevoir votre contribution/i
      })
    ).toBeVisible({ timeout: 15000 });
    expect(await lookup()).toMatchObject({
      paymentStatus: 'paid',
      contributionType: 'personal_support',
      currency: 'CAD',
      displayAmount: variant.amount,
      amount: variant.amount ? 25 : null
    });
    const confirmed = await summary();
    expect(minor(confirmed.total_received) - minor(before.total_received)).toBe(
      amountMinor
    );
    expect(confirmed.contributions_count - before.contributions_count).toBe(1);
    expect(confirmed.pending_fee_count! - before.pending_fee_count!).toBe(1);

    // Provider-side Charge/BalanceTransaction data is read by the real webhook service.
    const registration = await request.post(
      `${stub}/__test__/payment-intents`,
      {
        data: {
          id: session.payment_intent,
          amount: amountMinor,
          fee: feeMinor,
          currency: 'cad',
          metadata: session.metadata
        }
      }
    );
    expect(registration.ok()).toBe(true);
    const { chargeId } = await registration.json();
    const paymentEvent = buildPaymentIntentSucceededEvent({
      eventId: `evt_personal_${randomUUID().replaceAll('-', '')}`,
      paymentIntentId: session.payment_intent,
      chargeId,
      amountCents: amountMinor
    });
    const signed = buildSignedWebhookRequest(paymentEvent);
    const deliverIntent = () =>
      request.post('/api/stripe/webhook', {
        data: signed.body,
        headers: signed.headers
      });
    expect((await deliverIntent()).ok()).toBe(true);
    const after = await summary();
    expect(financialSnapshot(after)).toEqual({
      count: before.contributions_count + 1,
      received: minor(before.total_received) + amountMinor,
      fees: minor(before.total_fees) + feeMinor,
      net: minor(before.total_net) + amountMinor - feeMinor,
      refunded: minor(before.total_refunded),
      available:
        minor(before.current_available_estimate) + amountMinor - feeMinor
    });
    expect(after.pending_fee_count).toBe(before.pending_fee_count);
    const month = new Date(after.generated_at!).toISOString().slice(0, 7);
    const monthBefore = before.monthly_summary.find((m) => m.month === month);
    const monthAfter = after.monthly_summary.find((m) => m.month === month)!;
    expect(
      minor(monthAfter.total_received) - minor(monthBefore?.total_received ?? 0)
    ).toBe(amountMinor);
    expect(
      minor(monthAfter.total_fees) - minor(monthBefore?.total_fees ?? 0)
    ).toBe(feeMinor);

    // Repeat both signed events and verify logical uniqueness in public/private projections.
    expect((await control('deliver')).ok()).toBe(true);
    expect((await deliverIntent()).ok()).toBe(true);
    expect(financialSnapshot(await summary())).toEqual(
      financialSnapshot(after)
    );
    const activityForPayment = (await activity()).items.filter(
      (item) => item.reference === reference
    );
    expect(activityForPayment).toHaveLength(1);
    const item = activityForPayment[0]!;
    await expect
      .poll(
        async () => {
          const current = (await activity()).items.find(
            (i) => i.id === item.id
          );
          return [current?.preparation?.state, current?.email, current?.sms];
        },
        { timeout: 15000 }
      )
      .toEqual(['ineligible', 'sent', 'captured']);
    expect(
      (await activity()).items.find((i) => i.id === item.id)?.preparation
        ?.cartouche
    ).toBeNull();
    const adminResponse = await request.get(
      `/api/admin/contributions?contributionId=${item.contributionId}`,
      { headers }
    );
    expect(adminResponse.ok()).toBe(true);
    const admin = (await adminResponse.json()) as AdminContributionsResponse;
    const records = admin.contributions.filter(
      (i) => i.id === item.contributionId
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      public_reference: reference,
      contribution_type: 'personal_support',
      payment_status: 'paid',
      amount: 25,
      currency: 'CAD',
      public_display_consent: variant.name,
      display_amount_consent: variant.amount,
      stripe_session_id: sessionId,
      stripe_payment_intent_id: session.payment_intent
    });
    expect(
      minor(admin.summary.total_received) -
        minor(adminBefore.summary.total_received)
    ).toBe(amountMinor);
    expect(admin.summary.paid_count - adminBefore.summary.paid_count).toBe(1);

    const registry = await builders();
    expect(registry.pagination.total_count).toBe(
      buildersBefore.pagination.total_count + Number(variant.name)
    );
    const entry = registry.builders.find((b) => b.display_name === displayName);
    if (variant.name) {
      expect(entry).toMatchObject({
        contribution_type: 'personal_support',
        currency: 'CAD',
        amount: variant.amount ? 25 : null
      });
    } else {
      expect(entry).toBeUndefined();
      expect(JSON.stringify(after.public_builders)).not.toContain(displayName);
    }
    expect(JSON.stringify(registry)).not.toContain(reference);
    expect(JSON.stringify(registry)).not.toContain(session.payment_intent);
    expect(JSON.stringify(registry)).not.toContain(
      'company@simulation.example.test'
    );
    await page.goto('/batisseurs');
    await expect(page.locator('[data-og7="builders-total"]')).toHaveText(
      String(registry.pagination.total_count)
    );
    if (variant.name) {
      const card = page
        .locator('[data-og7="builder-record"]')
        .filter({ hasText: displayName });
      await expect(card).toBeVisible();
      await expect(card).toContainText(
        variant.amount
          ? /25[,.]00\s*CAD/
          : /Montant (?:non affiché|privé|masqué)/i
      );
    } else
      await expect(
        page.locator('[data-og7="builders-directory"]')
      ).not.toContainText(displayName);
    await page.screenshot({
      path: info.outputPath('builders-consent.png'),
      fullPage: true
    });

    await page.goto('/fonds-des-batisseurs/transparence');
    const exportButton = page.locator('[data-og7="transparency-json"]');
    await expect(exportButton).toBeEnabled();
    const download = page.waitForEvent('download');
    await exportButton.click();
    const reportText = await downloadText(await download);
    const report = JSON.parse(reportText);
    expect(financialSnapshot(report)).toEqual(financialSnapshot(after));
    expect(reportText).not.toContain(displayName);
    expect(reportText).not.toContain(reference);
    const displayedAmount = new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: 'CAD'
    }).format(after.total_received);
    await expect
      .poll(async () =>
        normalizeSpaces(
          await page.locator('[data-og7="transparency-totals"]').innerText()
        )
      )
      .toContain(normalizeSpaces(displayedAmount));
    await page.screenshot({
      path: info.outputPath('transparency-confirmed.png'),
      fullPage: true
    });
    await info.attach('personal-journey-evidence', {
      body: JSON.stringify(
        {
          variant,
          providers: 'simulated',
          amountMinor,
          feeMinor,
          reference,
          before: financialSnapshot(before),
          after: financialSnapshot(after),
          publicEntry: entry ?? null,
          activityId: item.id
        },
        null,
        2
      ),
      contentType: 'application/json'
    });
    expect(errors).toEqual([]);
  });
}
