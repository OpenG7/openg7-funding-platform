import { expect, test } from './support/test.js';

import { WEBHOOK_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import {
  buildPaymentIntentSucceededEvent,
  buildSignedWebhookRequest
} from './support/stripe-webhook.js';

test.describe('Docker local public experience', () => {
  test('serves the Angular shell and public API through the Docker web container', async ({
    page,
    request
  }) => {
    const health = await request.get('/health');
    await expect(health).toBeOK();
    expect((await health.text()).trim()).toBe('ok');

    const runtimeConfig = await request.get('/api/public/funding-config');
    await expect(runtimeConfig).toBeOK();
    expect(runtimeConfig.headers()['content-type']).toContain(
      'application/json'
    );
    expect(await runtimeConfig.json()).toMatchObject({
      business_sponsorship_enabled: expect.any(Boolean)
    });

    await page.goto('/fonds-des-batisseurs');

    await expect(
      page.getByRole('heading', { name: /13 outils\./i })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Choisissez votre contribution/i })
    ).toBeVisible();
    await expect(
      page.locator('#support').getByRole('button', { name: /Soutenir OpenG7/i })
    ).toBeDisabled();
  });

  test('keeps a checkout return as browser state, not an authoritative payment record', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs?checkout=cancel');

    await expect(
      page.getByRole('heading', {
        name: /Le coffre reste/i
      })
    ).toBeVisible();
    await expect(page.getByText(/Aucun paiement confirm/i)).toBeVisible();
  });

  test('keeps checkout success non-authoritative until the matching Stripe webhook is processed', async ({
    page,
    request
  }) => {
    const fixture = WEBHOOK_FIXTURES.checkoutAuthoritative;

    const before = await (
      await request.get('/api/public/fund-transparency')
    ).json();

    await page.goto('/fonds-des-batisseurs?checkout=success');
    // funding.home.checkout.successCopy (fr-CA.json): the browser return
    // itself says the public fund still needs Stripe confirmation -- it's
    // not claiming the payment is already reflected anywhere.
    await expect(
      page.getByText(/synchronis.*confirmation Stripe sera disponible/i)
    ).toBeVisible();

    const afterCheckoutReturn = await (
      await request.get('/api/public/fund-transparency')
    ).json();
    expect(afterCheckoutReturn.total_received).toBeCloseTo(
      before.total_received,
      2
    );
    expect(afterCheckoutReturn.contributions_count).toBe(
      before.contributions_count
    );

    const signed = buildSignedWebhookRequest(
      buildPaymentIntentSucceededEvent({
        eventId: fixture.stripeEventId,
        paymentIntentId: fixture.stripePaymentIntentId,
        chargeId: fixture.stripeChargeId,
        amountCents: fixture.amountCents
      })
    );
    const webhookResponse = await request.post('/api/stripe/webhook', {
      data: signed.body,
      headers: signed.headers
    });
    expect(webhookResponse.status()).toBe(200);

    const afterWebhook = await (
      await request.get('/api/public/fund-transparency')
    ).json();
    expect(afterWebhook.total_received - before.total_received).toBeCloseTo(
      fixture.amountCents / 100,
      2
    );
  });

  test('shows the public sponsors page without private sponsorship fields', async ({
    page,
    request
  }) => {
    const response = await request.get('/api/public/sponsorships');
    await expect(response).toBeOK();
    const body = (await response.json()) as {
      readonly sponsorships?: unknown;
    };
    expect(Array.isArray(body.sponsorships)).toBe(true);

    await page.goto('/commanditaires');

    await expect(
      page.getByRole('heading', { name: /Commanditaires OpenG7/i })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Commanditaires publics/i })
    ).toBeVisible();

    await expect(page.locator('body')).not.toContainText(
      /sponsor_contact_email|email_private|stripe_session_id|stripe_payment_intent_id/i
    );
  });

  test('keeps an invalid sponsorship follow-up token private', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs/suivi-commandite?token=invalid');

    await expect(
      page.getByRole('heading', { name: /Lien introuvable/i })
    ).toBeVisible();
    await expect(page.getByText(/absent, invalide ou expir/i)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/stripe_session/i);
  });

  test('redirects protected admin routes to the login page', async ({
    page
  }) => {
    await page.goto('/admin/fundraiser/sponsors');

    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(
      page.getByRole('heading', { name: /Acces admin/i })
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(
      /Commanditaires \/ partenaires/i
    );
  });
});
