import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

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

for (const language of ['fr-CA', 'en']) {
  for (const width of [390, 1280]) {
    test(`sponsorship trend explains a zero baseline and keeps daily values accessible in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      const data = await fixtures(page);
      await page.setViewportSize({ width, height: 900 });
      const series = Array.from({ length: 30 }, (_, index) => ({
        day: `2026-09-${String(index + 1).padStart(2, '0')}`,
        value: [21, 27, 28].includes(index) ? 1 : 0
      }));
      await page.route('**/api/admin/cockpit/metrics', (route) =>
        route.fulfill({
          json: {
            ...data.metrics,
            sponsorshipCount: 3,
            sponsorshipTrend: { current: 3, previous: 0, percent: null, series }
          }
        })
      );
      await page.goto('/admin/fundraiser');
      if (language === 'en') {
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      }
      const card = page.locator(
        '[data-og7="cockpit-metric"][data-og7-id="sponsorships"]'
      );
      await expect(card.getByRole('definition')).toHaveText(['3', '0']);
      await expect(card).toContainText(
        language === 'en'
          ? 'The previous period is zero'
          : 'La période précédente est à zéro'
      );
      await expect(card).not.toContainText('%');
      const chart = card.locator('[data-og7="cockpit-trend-chart"]');
      await expect(chart).toBeVisible();
      await expect(card.getByRole('table')).toBeHidden();
      await card.screenshot({
        path: testInfo.outputPath('sponsorship-card.png')
      });

      const disclosure = card.locator('summary');
      await disclosure.focus();
      await page.keyboard.press('Enter');
      await expect(card.getByRole('table')).toBeVisible();
      await expect(card.getByRole('row')).toHaveCount(31);
      await expect(
        card.getByRole('row').nth(1).locator('time')
      ).toHaveAttribute('datetime', '2026-09-30');
      await expect(card.getByRole('row').nth(2).getByRole('cell')).toHaveText(
        '1'
      );
      await page.keyboard.press('Tab');
      const region = card.getByRole('region');
      await expect(region).toBeFocused();
      await page.keyboard.press('End');
      await expect
        .poll(() => region.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await card.screenshot({
        path: testInfo.outputPath('sponsorship-card-expanded.png')
      });
      const accessibility = await new AxeBuilder({ page })
        .include('[data-og7="cockpit-metric"][data-og7-id="sponsorships"]')
        .analyze();
      expect(accessibility.violations).toEqual([]);
      await page.keyboard.press('Shift+Tab');
      await expect(disclosure).toBeFocused();
      await page.keyboard.press('Space');
      await expect(card.getByRole('table')).toBeHidden();
    });
  }
}

test('trend distinguishes empty periods, missing daily values and unavailable comparisons', async ({
  page
}) => {
  const data = await fixtures(page);
  let trend = {
    current: 0 as number | null,
    previous: 0 as number | null,
    percent: null as number | null,
    series: [
      { day: '2026-09-29', value: 0 as number | null },
      { day: '2026-09-30', value: 0 as number | null }
    ]
  };
  await page.route('**/api/admin/cockpit/metrics', (route) =>
    route.fulfill({
      json: { ...data.metrics, sponsorshipCount: 0, sponsorshipTrend: trend }
    })
  );
  await page.goto('/admin/fundraiser');
  const card = page.locator(
    '[data-og7="cockpit-metric"][data-og7-id="sponsorships"]'
  );
  await expect(card).toContainText(
    'Les deux périodes affichent un total de zéro.'
  );
  await expect(card.locator('[data-og7="cockpit-trend-chart"]')).toBeVisible();
  await expect(card.getByRole('definition')).toHaveText(['0', '0']);

  trend = {
    ...trend,
    current: null,
    series: [
      { day: '2026-09-29', value: 0 },
      { day: '2026-09-30', value: null }
    ]
  };
  await metrics(page).getByRole('button', { name: 'Actualiser' }).click();
  await expect(card).toContainText('Comparaison indisponible');
  await expect(card).not.toContainText('Totaux à zéro');
  await expect(card.getByRole('definition')).toHaveText([
    'Non disponible',
    '0'
  ]);
  await expect(card.locator('[data-og7="cockpit-trend-chart"]')).toHaveCount(0);
  await card.locator('summary').click();
  await expect(card.getByRole('row').nth(1).getByRole('cell')).toHaveText(
    'Non disponible'
  );
  await expect(card.getByRole('row').nth(2).getByRole('cell')).toHaveText('0');

  trend = { ...trend, series: [] };
  await metrics(page).getByRole('button', { name: 'Actualiser' }).click();
  await expect(card.locator('summary')).toHaveCount(0);
  await expect(card).toContainText('ne permettent pas de tracer la courbe');
});

test('trend shows server comparisons for increases, decreases and unchanged periods', async ({
  page
}) => {
  const data = await fixtures(page);
  let percent = 100;
  await page.route('**/api/admin/cockpit/metrics', (route) =>
    route.fulfill({
      json: {
        ...data.metrics,
        sponsorshipTrend: {
          current: percent === 100 ? 6 : percent === -50 ? 1 : 3,
          previous: percent === -50 ? 2 : 3,
          percent,
          series: [
            { day: '2026-09-29', value: 0 },
            { day: '2026-09-30', value: 1 }
          ]
        }
      }
    })
  );
  await page.goto('/admin/fundraiser');
  const card = page.locator(
    '[data-og7="cockpit-metric"][data-og7-id="sponsorships"]'
  );
  await expect(card).toContainText(/\+100\s*%/);
  percent = -50;
  await metrics(page).getByRole('button', { name: 'Actualiser' }).click();
  await expect(card).toContainText(/-50\s*%/);
  percent = 0;
  await metrics(page).getByRole('button', { name: 'Actualiser' }).click();
  await expect(card).toContainText(/0\s*%/);
  await expect(card).not.toContainText('Totaux à zéro');
});

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

test('system retry keeps failed observations unknown until a successful response', async ({
  page
}) => {
  const data = await fixtures(page);
  await page.goto('/admin/fundraiser');
  const database = systems(page).locator('[data-og7-id="database"]');
  const refresh = systems(page).getByRole('button', { name: 'Actualiser' });
  await expect(database).toContainText('Opérationnel');
  await page.route('**/api/admin/cockpit/systems', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await refresh.click();
  await expect(database).toContainText('Inconnu');
  let releaseResponse!: () => void;
  const pendingResponse = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route('**/api/admin/cockpit/systems', async (route) => {
    await pendingResponse;
    await route.fulfill({ json: data.systems });
  });
  try {
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect(database).toContainText('Inconnu');
    await expect(database).not.toContainText('Opérationnel');
    await expect(systems(page)).toContainText('Dernière lecture conservée');
  } finally {
    releaseResponse();
  }
  await expect(database).toContainText('Opérationnel');
  await expect(systems(page)).not.toContainText('Dernière lecture conservée');
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
