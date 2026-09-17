import type { Page } from '@playwright/test';

import { cockpitFixtures } from './support/cockpit-fixtures.js';
import { expect, test } from './support/test.js';

async function fixtures(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.cockpit-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  });
  const data = cockpitFixtures();
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/admin/cockpit/')) {
      const block = path.split('/').pop() as keyof typeof data;
      await route.fulfill({ json: data[block] });
    } else if (path.endsWith('/dashboard'))
      await route.fulfill({ json: { data_available: false } });
    else await route.fulfill({ status: 503, json: {} });
  });
  return data;
}
const metrics = (page: Page) => page.locator('[data-og7="cockpit-metrics"]');
const activity = (page: Page) => page.locator('[data-og7="cockpit-activity"]');
const systems = (page: Page) => page.locator('[data-og7="cockpit-systems"]');

test('cockpit separates currencies, missing fees and net from available balance', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser');
  await expect(
    metrics(page).getByRole('article', { name: 'Net des encaissements' })
  ).toContainText(/276\s?420/);
  await expect(
    metrics(page).getByRole('article', { name: 'Publications prévues' })
  ).toContainText('12');
  await metrics(page).getByLabel('Devise des montants').selectOption('USD');
  await expect(
    metrics(page).getByRole('article', { name: 'Net des encaissements' })
  ).toContainText('Non disponible');
  await expect(
    metrics(page).getByText(/Frais non confirmés pour 1/)
  ).toBeVisible();
  await expect(
    metrics(page).getByRole('article', { name: 'Montants encaissés' })
  ).toContainText('100');
  await metrics(page)
    .getByText('Comprendre les montants et leur couverture')
    .click();
  await expect(
    metrics(page).getByText(/Ce net n’est pas un solde disponible/)
  ).toBeVisible();
  await expect(
    activity(page).getByRole('link', { name: /FAC-COCKPIT/ })
  ).toHaveAttribute('href', /invoices\?contributionId=11111111/);
  await expect(systems(page).locator('[data-og7-id="email"]')).toContainText(
    'SMTP'
  );
  await expect(systems(page).locator('[data-og7-id="stripe"]')).toContainText(
    'Inconnu'
  );
});

test('a failed metrics source leaves activity and system status usable', async ({
  page
}) => {
  await fixtures(page);
  await page.route('**/api/admin/cockpit/metrics', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await page.goto('/admin/fundraiser');
  await expect(metrics(page).getByRole('alert')).toContainText('indisponible');
  await expect(
    activity(page).getByRole('link', { name: /FAC-COCKPIT/ })
  ).toBeVisible();
  await expect(systems(page).locator('[data-og7-id="database"]')).toContainText(
    'Opérationnel'
  );
  await expect(metrics(page).getByRole('article')).toHaveCount(0);
});

test('block retry retains a labelled snapshot and forbidden access removes it', async ({
  page
}) => {
  const data = await fixtures(page);
  await page.goto('/admin/fundraiser');
  await expect(metrics(page).getByRole('article')).toHaveCount(4);
  await page.route('**/api/admin/cockpit/metrics', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await metrics(page).getByRole('button', { name: 'Actualiser' }).click();
  await expect(
    metrics(page).getByText(/Dernière lecture conservée/)
  ).toBeVisible();
  await expect(metrics(page).getByRole('article')).toHaveCount(4);
  await page.route('**/api/admin/cockpit/metrics', (route) =>
    route.fulfill({ status: 403, json: {} })
  );
  await metrics(page).getByRole('button', { name: 'Actualiser' }).click();
  await expect(metrics(page).getByRole('alert')).toContainText('Accès refusé');
  await expect(metrics(page).getByRole('article')).toHaveCount(0);
  await page.route('**/api/admin/cockpit/metrics', (route) =>
    route.fulfill({ json: data.metrics })
  );
  await metrics(page).getByRole('button', { name: 'Actualiser' }).click();
  await expect(metrics(page).getByRole('article')).toHaveCount(4);
});

test('expired system observations lose their operational indication without a reload', async ({
  page
}) => {
  await page.clock.install();
  await fixtures(page);
  await page.goto('/admin/fundraiser');
  const database = systems(page).locator('[data-og7-id="database"]');
  await expect(database).toContainText('Opérationnel');
  await page.clock.fastForward(90_000);
  await expect(database).toContainText('Inconnu');
  await expect(database).toContainText('Observation périmée');
});

test('missing data and an empty activity are explicit without fabricated zero financial totals', async ({
  page
}) => {
  const data = await fixtures(page);
  await page.route('**/api/admin/cockpit/metrics', (route) =>
    route.fulfill({ json: { ...data.metrics, available: false } })
  );
  await page.route('**/api/admin/cockpit/activity', (route) =>
    route.fulfill({
      json: {
        ...data.activity,
        items: [],
        missingSources: ['sponsorship_invoices'],
        todayCounts: { ...data.activity.todayCounts, invoice: null }
      }
    })
  );
  await page.goto('/admin/fundraiser');
  await expect(metrics(page).getByRole('alert')).toContainText('indisponibles');
  await expect(metrics(page).getByRole('article')).toHaveCount(0);
  await expect(
    activity(page).getByText('Aucune activité enregistrée.')
  ).toBeVisible();
  await expect(activity(page).getByText(/Activité partielle/)).toBeVisible();
});

test('new cockpit endpoints respect session expiration', async ({ page }) => {
  await fixtures(page);
  await page.route('**/api/admin/cockpit/activity', (route) =>
    route.fulfill({ status: 401, json: {} })
  );
  await page.goto('/admin/fundraiser');
  await expect(page).toHaveURL(/\/admin\/login/);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-session-token')
    )
  ).toBeNull();
});

test('a late metrics response cannot replace a newer global refresh', async ({
  page
}) => {
  const data = await fixtures(page);
  let release: (() => void) | undefined;
  let calls = 0;
  await page.route('**/api/admin/cockpit/metrics', async (route) => {
    const index = ++calls;
    if (index === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route.fulfill({
      json: { ...data.metrics, sponsorshipCount: index === 1 ? 999 : 48 }
    });
  });
  await page.goto('/admin/fundraiser', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => calls).toBe(1);
  await page.locator('[data-og7="dashboard-refresh"]').click();
  await expect(
    metrics(page).getByRole('article', { name: 'Commandites', exact: true })
  ).toContainText('48');
  release?.();
  await expect.poll(() => calls).toBe(2);
  await expect(metrics(page).getByText('999', { exact: true })).toHaveCount(0);
});

test('English cockpit supports keyboard currency selection and mobile width', async ({
  page
}, testInfo) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/fundraiser');
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  const currency = metrics(page).getByLabel('Amount currency');
  await currency.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(currency).toHaveValue('USD');
  await expect(
    metrics(page).getByRole('article', { name: 'Net receipts' })
  ).toContainText('Not available');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('cockpit-en-mobile.png'),
    fullPage: true
  });
});
