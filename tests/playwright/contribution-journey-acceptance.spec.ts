import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import AxeBuilder from '@axe-core/playwright';
import type { ContributionActivityResponse } from '@openg7/funding-core';

import { test, expect } from './support/test.js';
import { signInAsAdmin } from './support/admin-auth.js';
import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';

test('offline admin receives captured messages, catches up once across tabs, and clears activity on expiry', async ({
  page,
  context,
  request,
  baseURL
}) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable simulation only.'
  );
  test.setTimeout(60000);
  const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
  const checkout = await request.post('/api/checkout-sessions', {
    data: {
      amount: 50,
      currency: 'CAD',
      projectId: 'openg7',
      contributionType: 'sponsorship_interest',
      publicDisplayConsent: true,
      publicDisplayName: 'Atelier hors ligne',
      displayAmountConsent: false,
      nonCharityAcknowledged: true,
      successUrl: baseURL + '/fonds-des-batisseurs?checkout=success',
      cancelUrl: baseURL + '/fonds-des-batisseurs'
    }
  });
  expect(checkout.ok()).toBe(true);
  const created = await checkout.json();
  expect(created.status).toBe('redirected');
  expect(
    (await request.post(created.redirectUrl, { maxRedirects: 0 })).status()
  ).toBe(303);
  const activity = async () =>
    (await (
      await request.get('/api/admin/contribution-activity', { headers })
    ).json()) as ContributionActivityResponse;
  await expect
    .poll(
      async () => {
        const item = (await activity()).items[0];
        return [item?.email, item?.sms];
      },
      { timeout: 15000 }
    )
    .toEqual(['sent', 'captured']);
  const item = (await activity()).items[0]!;
  await signInAsAdmin(page);
  const toast = page.locator(
    `[data-og7="contribution-toast"][data-og7-id="${item.id}"]`
  );
  await expect(toast).toBeVisible({ timeout: 15000 });
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(toast).toContainText('Payment confirmed');
  await expect(toast).toContainText('Company details needed');
  const nextPage = context.waitForEvent('page');
  await page.evaluate(() =>
    window.open('/admin/fundraiser/pilotage', 'contribution-second-tab')
  );
  const other = await nextPage;
  await other.locator('[data-og7="contribution-activity-open"]').click();
  await expect(other.getByRole('dialog')).toContainText(item.reference);
  await expect(other.locator('[data-og7="contribution-toast"]')).toHaveCount(0);
  await other.close();
  await page.bringToFront();
  await page.evaluate(() =>
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2000-01-01T00:00:00.000Z'
    )
  );
  await expect(page.locator('[data-og7="contribution-toast"]')).toHaveCount(0, {
    timeout: 10000
  });
});

test('company pays 50 CAD: signed confirmation, admin toast, captured email/SMS and private website card', async ({
  page,
  request,
  playwright,
  baseURL
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Requires the disposable acceptance stack and local receivers.'
  );
  test.setTimeout(120000);
  const stub = process.env.STRIPE_STUB_BASE_URL!;
  const smsBefore = (await (await request.get(stub + '/__test__/sms')).json())
    .items.length;
  const emailBefore = (
    await (await request.get(stub + '/__test__/mail')).json()
  ).messages.filter(
    (m: { To: { Address: string }[]; Subject: string }) =>
      m.To.some((t) => t.Address === 'admin@simulation.example.test') &&
      m.Subject.includes('Contribution')
  ).length;
  const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
  const activity = async () =>
    (await (
      await request.get('/api/admin/contribution-activity', { headers })
    ).json()) as ContributionActivityResponse;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signInAsAdmin(page);
  await page.goto('/admin/fundraiser/publications/automation?settings=feeds');
  await expect(
    page.locator('[data-og7="publication-worker-toggle"]')
  ).toHaveAttribute('aria-checked', 'false');
  const directory = await mkdtemp(join(tmpdir(), 'og7-company-journey-'));
  const companyContext = await playwright.chromium.launchPersistentContext(
    directory,
    { baseURL }
  );
  try {
    const company =
      companyContext.pages()[0] ?? (await companyContext.newPage());
    company.on('pageerror', (e) => errors.push(e.message));
    await company.goto('/fonds-des-batisseurs?intent=sponsorship#support');
    const form = company.locator('[data-og7="contribution-form"]');
    await form.getByRole('button', { name: /Commandite d'entreprise/ }).click();
    await form.locator('#custom-contribution').fill('50');
    await form.getByRole('checkbox').nth(0).check();
    await form.locator('#public-display-name').fill('Atelier Démo E2E');
    await form.getByRole('checkbox').nth(2).check();
    const checkoutResponse = company.waitForResponse(
      (r) =>
        r.url().endsWith('/checkout-sessions') &&
        r.request().method() === 'POST'
    );
    await form.locator('button[type="submit"]').click();
    expect((await checkoutResponse).ok()).toBe(true);
    await expect(company).toHaveURL(/\/checkout\/cs_test_/);
    const checkoutUrl = company.url();
    const before = (await activity()).items.length;
    expect(
      (await request.get('/api/admin/contribution-activity')).status()
    ).toBe(401);
    const invalid = await request.post('/api/stripe/webhook', {
      headers: {
        'stripe-signature': 'invalid',
        'content-type': 'application/json'
      },
      data: '{}'
    });
    expect(invalid.status()).toBe(400);
    expect((await activity()).items).toHaveLength(before);
    await company
      .getByRole('button', { name: 'Confirmer le paiement simulé' })
      .click();
    await expect(company.locator('#followup-companyName')).toBeVisible();
    await page.bringToFront();
    const toast = page.locator('[data-og7="contribution-toast"]').first();
    await expect(toast).toContainText('Paiement confirmé', { timeout: 15000 });
    await expect(toast).toContainText('Fiche d’entreprise à compléter');
    let item = (await activity()).items[0]!;
    expect(item.amountMinor).toBe(5000);
    expect(item.currency).toBe('CAD');
    await expect
      .poll(
        async () => {
          const messages = await (
            await request.get(stub + '/__test__/mail')
          ).json();
          return messages.messages.filter(
            (m: { To: { Address: string }[]; Subject: string }) =>
              m.To.some((t) => t.Address === 'admin@simulation.example.test') &&
              m.Subject.includes('Contribution')
          ).length;
        },
        { timeout: 15000 }
      )
      .toBe(emailBefore + 1);
    await expect
      .poll(
        async () => {
          const messages = await (
            await request.get(stub + '/__test__/sms')
          ).json();
          return messages.items.length;
        },
        { timeout: 15000 }
      )
      .toBe(smsBefore + 1);
    await company.locator('#followup-companyName').fill('Atelier Démo E2E');
    await company
      .locator('#followup-contactName')
      .fill('Contact de démonstration');
    await company
      .locator('#followup-contactEmail')
      .fill('company@simulation.example.test');
    await company
      .locator('#followup-websiteUrl')
      .fill('https://simulation.example.test');
    const image = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#28556e' }
    })
      .png()
      .toBuffer();
    await company.getByLabel('Ajouter des photos').setInputFiles({
      name: 'atelier-demo.png',
      mimeType: 'image/png',
      buffer: image
    });
    await expect(
      company.locator('[data-og7="media-upload-attempt"]')
    ).toHaveCount(0, { timeout: 15000 });
    const save = company.waitForResponse(
      (r) =>
        r.url().includes('/sponsorship-followup') &&
        r.request().method() === 'POST' &&
        !r.url().includes('/draft')
    );
    await company
      .getByRole('button', { name: 'Soumettre mes informations à l’équipe' })
      .click();
    expect((await save).ok()).toBe(true);
    await expect(company.getByText(/Informations enregistrées/)).toBeVisible();
    await page.bringToFront();
    await expect(toast).toContainText('moteur arrêté', { timeout: 15000 });
    await page.locator('[data-og7="publication-worker-toggle"]').click();
    await page.locator('[data-og7="confirm-action"]').click();
    await expect(toast).toContainText('Cartouche pour le site préparée', {
      timeout: 15000
    });
    await toast.screenshot({ path: info.outputPath('payment-toast.png') });
    await toast.getByRole('button', { name: 'Voir la préparation' }).click();
    const drawer = page.getByRole('dialog');
    await expect(
      drawer.locator('[data-og7="website-cartouche"]')
    ).toContainText('Atelier Démo E2E');
    await expect(drawer.locator('[data-og7="activity-sms"]')).toHaveText(
      'Capturé par le simulateur'
    );
    await expect(drawer.locator('[data-og7="activity-email"]')).toHaveText(
      'Accepté par le serveur de courriel'
    );
    await expect(drawer).toContainText(
      'Le seuil de contribution pour Facebook n’est pas atteint.'
    );
    await drawer.screenshot({
      path: info.outputPath('private-website-card.png')
    });
    const scan = await new AxeBuilder({ page })
      .include('[data-og7="admin-drawer"][open]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      scan.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target)
      }))
    ).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(
      toast.getByRole('button', { name: 'Voir la préparation' })
    ).toBeFocused();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(toast).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath('payment-toast-mobile.png')
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    // Replaying the same Checkout callback exercises the real signed webhook again.
    expect(
      (await request.post(checkoutUrl, { maxRedirects: 0 })).status()
    ).toBe(303);
    expect((await activity()).items).toHaveLength(before + 1);
    expect(
      (await (await request.get(stub + '/__test__/sms')).json()).items
    ).toHaveLength(smsBefore + 1);
    await expect
      .poll(async () => (await activity()).items[0]?.preparation?.state, {
        timeout: 15000
      })
      .toBe('prepared');
    item = (await activity()).items[0]!;
    expect(item.preparation?.state).toBe('prepared');
    expect(item.history.map((h) => h.state)).toContain('worker_stopped');
    const sponsors = await (
      await request.get(
        '/api/admin/sponsorships?search=Atelier%20D%C3%A9mo%20E2E',
        { headers }
      )
    ).json();
    expect(sponsors.items[0].sponsor_review_status).toBe('pending_review');
    expect(sponsors.items[0].sponsor_feed_status).not.toBe('published');
    const publicSponsors = await request.get('/api/public/sponsorships');
    expect(publicSponsors.ok()).toBe(true);
    expect(JSON.stringify(await publicSponsors.json())).not.toContain(
      'Atelier Démo E2E'
    );
    const artifact = {
      amountMinor: 5000,
      currency: 'CAD',
      providers: 'simulated',
      activity: item,
      sms: await (await request.get(stub + '/__test__/sms')).json(),
      email: await (await request.get(stub + '/__test__/mail')).json()
    };
    await info.attach('journey-evidence', {
      body: JSON.stringify(artifact, null, 2),
      contentType: 'application/json'
    });
    await toast.getByRole('button', { name: 'Fermer', exact: true }).click();
    await page.goto('/admin/fundraiser/pilotage');
    await page.locator('[data-og7="contribution-activity-open"]').click();
    await expect(page.getByRole('dialog')).toContainText('Atelier Démo E2E');
    await expect(page.locator('[data-og7="contribution-toast"]')).toHaveCount(
      0
    );
    expect(errors).toEqual([]);
  } finally {
    await companyContext.close();
  }
});
