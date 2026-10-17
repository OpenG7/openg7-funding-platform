import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, type BrowserContext } from '@playwright/test';
import Stripe from 'stripe';

import { startIdentityStack } from './stack.mjs';
import { startIdentityStripeProvider } from './stripe-provider.mjs';
import { signInAdminIdentity } from './support/admin-browser.js';

test('cockpit displays confirmed amounts, late fees and a real partial refund separately per currency', async ({
  playwright
}, info) => {
  test.setTimeout(180000);
  const stripe = await startIdentityStripeProvider();
  let stack: Awaited<ReturnType<typeof startIdentityStack>> | undefined;
  let context: BrowserContext | undefined;
  try {
    stack = await startIdentityStack({ stripe: { origin: stripe.origin } });
    const { pool, origin } = stack;
    const suffix = randomUUID().replaceAll('-', '');
    const cadId = randomUUID();
    const usdId = randomUUID();
    const cadIntent = 'pi_cockpit_cad_' + suffix;
    const usdIntent = 'pi_cockpit_usd_' + suffix;
    const reference = 'OG7-2026-' + suffix.slice(0, 8).toUpperCase();
    await pool.query(
      `INSERT INTO fund_contributions(id,contribution_type,amount_cents,currency,status,stripe_payment_intent_id,public_reference,sponsor_company_name,non_charity_acknowledged)
       VALUES($1,'personal_support',2500,'cad','pending',$2,NULL,NULL,TRUE),
             ($3,'sponsorship_interest',1000,'usd','pending',$4,$5,'Synthetic cockpit sponsor',TRUE)`,
      [cadId, cadIntent, usdId, usdIntent, reference]
    );
    context = await playwright.chromium.launchPersistentContext(
      await mkdtemp(join(tmpdir(), 'og7-cockpit-finance-')),
      { baseURL: origin, viewport: { width: 1280, height: 1000 } }
    );
    const page = context.pages()[0] ?? (await context.newPage());
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await signInAdminIdentity(page, '/admin/fundraiser', 'owner');
    await expect(page).toHaveURL(/\/admin\/fundraiser$/);

    const signer = new Stripe('sk_test_cockpit_signer');
    const deliver = async (
      type: string,
      object: Record<string, unknown>,
      eventId = 'evt_cockpit_' + randomUUID()
    ) => {
      const body = JSON.stringify({
        id: eventId,
        object: 'event',
        type,
        livemode: false,
        created: Math.floor(Date.now() / 1000),
        data: { object }
      });
      const response = await page.request.post('/api/stripe/webhook', {
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': signer.webhooks.generateTestHeaderString({
            payload: body,
            secret: stripe.webhookSecret
          })
        },
        data: body
      });
      expect(response.status(), await response.text()).toBe(200);
      expect((await response.json()).ignored).not.toBe(true);
    };
    const register = async (
      id: string,
      amount: number,
      currency: string,
      fee: number
    ) => {
      const response = await page.request.post(
        stripe.origin + '/__test__/payment-intents',
        {
          data: { id, amount, currency, fee, metadata: { projectId: 'openg7' } }
        }
      );
      expect(response.status()).toBe(200);
      return (await response.json()) as {
        chargeId: string;
        balanceTransactionId: string;
      };
    };
    const payment = (
      id: string,
      amount: number,
      currency: string,
      chargeId: string | null
    ) => ({
      id,
      object: 'payment_intent',
      amount,
      amount_received: amount,
      currency,
      status: 'succeeded',
      created: Math.floor(Date.now() / 1000),
      latest_charge: chargeId,
      metadata: { projectId: 'openg7' }
    });
    const cad = await register(cadIntent, 2500, 'cad', 100);
    await deliver(
      'payment_intent.succeeded',
      payment(cadIntent, 2500, 'cad', cad.chargeId)
    );
    await deliver(
      'payment_intent.succeeded',
      payment(usdIntent, 1000, 'usd', null)
    );
    expect(
      (
        await pool.query(
          'SELECT status FROM fund_contributions ORDER BY currency'
        )
      ).rows.map((row) => row.status)
    ).toEqual(['paid', 'paid']);

    const metrics = page.locator('[data-og7="cockpit-metrics"]');
    const metric = (label: string) =>
      metrics
        .getByRole('article', { name: label, exact: true })
        .locator('strong');
    const currency = metrics.getByLabel('Devise des montants');
    const money = (minor: number, code: string, locale = 'fr-CA') =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: code
      }).format(minor / 100);
    const refresh = async () => {
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/admin/cockpit/metrics') &&
          r.request().method() === 'GET'
      );
      await metrics
        .getByRole('button', { name: 'Actualiser', exact: true })
        .click();
      expect((await response).status()).toBe(200);
    };
    const fact = (label: string) =>
      metrics
        .locator('dl > div')
        .filter({ has: page.locator('dt', { hasText: label }) })
        .locator('dd');
    await refresh();
    await expect(metric('Montants encaissés')).toHaveText(money(2500, 'CAD'));
    await expect(metric('Net des encaissements')).toHaveText(
      money(2400, 'CAD')
    );
    await currency.selectOption('USD');
    await expect(metric('Montants encaissés')).toHaveText(money(1000, 'USD'));
    await expect(metric('Net des encaissements')).toHaveText('Non disponible');
    await expect(
      metrics.getByText(
        'Frais non confirmés pour 1 encaissement(s). Le net total reste indisponible.'
      )
    ).toBeVisible();

    const usd = await register(usdIntent, 1000, 'usd', 45);
    const charge = await (
      await page.request.get(stripe.origin + '/v1/charges/' + usd.chargeId)
    ).json();
    const feeEventId = 'evt_cockpit_late_fee_' + randomUUID();
    await deliver('charge.updated', charge, feeEventId);
    await deliver('charge.updated', charge, feeEventId);
    await refresh();
    await expect(metric('Montants encaissés')).toHaveText(money(1000, 'USD'));
    await expect(metric('Net des encaissements')).toHaveText(money(955, 'USD'));
    await metrics
      .getByText('Comprendre les montants et leur couverture', { exact: true })
      .click();
    await expect(fact('Frais confirmés connus')).toHaveText(money(45, 'USD'));
    await expect(fact('Remboursements confirmés')).toHaveText(money(0, 'USD'));

    // This recipe exercises cockpit reads and refunds. Prepare the historical
    // immutable invoice required by refund reconciliation, without testing issuance here.
    await pool.query(
      `INSERT INTO sponsorship_invoices(contribution_id,invoice_number,stripe_session_id,stripe_payment_intent_id,currency,subtotal_cents,total_cents,issuer_name,sponsor_name)
       VALUES($1,$2,$3,$4,'usd',1000,1000,'Synthetic issuer','Synthetic cockpit sponsor')`,
      [usdId, 'SYNTHETIC-COCKPIT-' + suffix, 'cs_cockpit_' + suffix, usdIntent]
    );
    await page.goto(
      '/admin/fundraiser/sponsors?sponsorshipId=' + usdId + '&tab=refund'
    );
    await page
      .getByRole('button', { name: 'Rembourser Stripe', exact: true })
      .click();
    const panel = page.getByRole('region', {
      name: 'Remboursement Stripe',
      exact: true
    });
    await panel.getByLabel(/Montant a rembourser/).fill('2');
    await panel.getByLabel(/Texte de confirmation/).fill(reference);
    await panel
      .getByRole('checkbox', { name: /Envoyer le courriel de remboursement/ })
      .uncheck();
    await panel
      .getByLabel(/Note sur le remboursement/)
      .fill('Synthetic cockpit partial refund.');
    const refunded = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/admin/sponsorships/refund') &&
        r.request().method() === 'POST'
    );
    await panel
      .getByRole('button', { name: 'Rembourser Stripe', exact: true })
      .click();
    expect((await refunded).status()).toBe(200);
    const refundedCharge = await (
      await page.request.get(stripe.origin + '/v1/charges/' + usd.chargeId)
    ).json();
    expect(refundedCharge.amount_refunded).toBe(200);
    expect(refundedCharge.refunds.data).toHaveLength(1);
    const refundEventId = 'evt_cockpit_refund_' + randomUUID();
    await deliver('charge.refunded', refundedCharge, refundEventId);
    await deliver('charge.refunded', refundedCharge, refundEventId);

    await page.goto('/admin/fundraiser');
    await currency.selectOption('USD');
    await expect(metric('Montants encaissés')).toHaveText(money(1000, 'USD'));
    await expect(metric('Net des encaissements')).toHaveText(money(955, 'USD'));
    await metrics
      .getByText('Comprendre les montants et leur couverture', { exact: true })
      .click();
    await expect(fact('Remboursements confirmés')).toHaveText(
      money(200, 'USD')
    );
    await expect(fact('Net après remboursements')).toHaveText(
      money(755, 'USD')
    );
    await currency.selectOption('CAD');
    await expect(metric('Montants encaissés')).toHaveText(money(2500, 'CAD'));
    await expect(metric('Net des encaissements')).toHaveText(
      money(2400, 'CAD')
    );
    await page.reload();
    await expect(metric('Montants encaissés')).toHaveText(money(2500, 'CAD'));
    const beforeRead = (
      await pool.query(
        'SELECT id,amount_cents,currency,status FROM fund_contributions ORDER BY id'
      )
    ).rows;
    const rejected = page.waitForResponse((r) =>
      r.url().endsWith('/api/admin/contributions')
    );
    await page.goto('/admin/fundraiser/contributions');
    const conflict = await rejected;
    expect(conflict.status()).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: 'ADMIN_FINANCIAL_CURRENCY_CONFLICT'
    });
    await expect(page.getByText(/plusieurs devises/)).toBeVisible();
    expect(
      (
        await pool.query(
          'SELECT id,amount_cents,currency,status FROM fund_contributions ORDER BY id'
        )
      ).rows
    ).toEqual(beforeRead);
    expect(errors).toEqual([]);
    await info.attach('cockpit-financial-journey', {
      contentType: 'application/json',
      body: JSON.stringify({
        cad: { gross: 2500, fees: 100, net: 2400 },
        usd: {
          gross: 1000,
          fees: 45,
          net: 955,
          refunded: 200,
          netAfterRefunds: 755
        }
      })
    });
  } finally {
    try {
      await context?.close();
    } finally {
      try {
        await stack?.stop();
      } finally {
        await stripe.stop();
      }
    }
  }
});
