import type { Locator, Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type { AdminDashboardResponse } from '@openg7/funding-core';

import { cockpitFixtures } from './support/cockpit-fixtures.js';
import { setupFixture } from './support/setup-fixtures.js';
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

async function renderedDashboardFixtures(page: Page) {
  const data = await fixtures(page);
  // Empty synthetic operations render the dashboard's own layout surfaces.
  const dashboard: AdminDashboardResponse = {
    data_source: 'database',
    data_available: true,
    totals: {
      total_received: 0,
      total_refunded: 0,
      total_disputed: 0,
      current_available_estimate: 0,
      currency: 'CAD',
      contributions_count: 0,
      paid_contributions_count: 0
    },
    sponsorship_review: { total: 0, pending: 0, approved: 0, rejected: 0 },
    feed_publication: { planned: 0, drafted: 0, published: 0, active: 0 },
    stripe_events: { failed: 0, processing: 0, last_failed_at: null },
    recent_contributions: [],
    last_updated_at: data.metrics.generatedAt
  };
  await page.route('**/api/admin/dashboard', (route) =>
    route.fulfill({ json: dashboard })
  );
  return data;
}

async function gridColumns(element: Locator): Promise<number> {
  return element.evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length
  );
}

const cockpitPalettes = {
  mineral: {
    panel: 'rgb(255, 255, 255)',
    border: 'rgb(216, 224, 236)',
    accent: 'rgb(54, 93, 136)'
  },
  night: {
    panel: 'rgb(20, 35, 56)',
    border: 'rgb(64, 86, 111)',
    accent: 'rgb(158, 218, 255)'
  },
  graphite: {
    panel: 'rgb(37, 41, 47)',
    border: 'rgb(86, 97, 110)',
    accent: 'rgb(176, 210, 235)'
  }
} as const;

for (const theme of ['mineral', 'night', 'graphite'] as const) {
  for (const { language, width } of [
    { language: 'fr-CA', width: 390 },
    { language: 'en', width: 1536 }
  ] as const) {
    test(`cockpit CSS keeps ${theme} panels and rendered trends readable in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 950 });
      await page.addInitScript(
        ({ theme, language }) => {
          localStorage.setItem('openg7.language', language);
          localStorage.setItem(
            'openg7.pilotage.appearance.v1',
            JSON.stringify({ theme, system: false, density: 'comfortable' })
          );
        },
        { theme, language }
      );
      await renderedDashboardFixtures(page);
      await page.goto('/admin/fundraiser');
      await expect(metrics(page).getByRole('article')).toHaveCount(4);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('html')).toHaveAttribute(
        'data-og7-pilot-theme',
        theme
      );
      for (const panel of [activity(page), systems(page)]) {
        await expect(panel).toHaveCSS(
          'background-color',
          cockpitPalettes[theme].panel
        );
        await expect(panel).toHaveCSS(
          'border-top-color',
          cockpitPalettes[theme].border
        );
        await expect(panel).toHaveCSS('border-top-width', '1px');
        await expect(panel).toHaveCSS('border-radius', '14px');
        await expect(panel).toHaveCSS('padding', '20px');
      }
      const summaryPanel = page
        .getByRole('region', {
          name:
            language === 'en' ? 'Operations summary' : 'Synthèse des opérations'
        })
        .getByRole('article')
        .first();
      await expect(summaryPanel).toHaveCSS(
        'background-color',
        cockpitPalettes[theme].panel
      );
      await expect(summaryPanel).toHaveCSS('border-radius', '14px');
      await expect(summaryPanel.locator('header')).toHaveCSS('padding', '20px');
      const metricGrid = page
        .locator('[data-og7="cockpit-metric"][data-og7-id="sponsorships"]')
        .locator('..');
      await expect
        .poll(() => gridColumns(metricGrid))
        .toBe(width === 390 ? 1 : 4);
      await expect(metricGrid).toHaveCSS('gap', '0px');
      const chart = metrics(page)
        .locator('[data-og7="cockpit-trend-chart"]')
        .first();
      await expect(chart).toBeVisible();
      await expect(chart).toHaveCSS('height', '40px');
      await expect(chart).toHaveCSS('display', 'block');
      await expect(chart).toHaveCSS('overflow', 'visible');
      await expect(chart.locator('polyline').last()).toHaveCSS(
        'stroke',
        cockpitPalettes[theme].accent
      );
      const connection = systems(page).locator(
        '[data-og7="stripe-check"][data-og7-id="connection"]'
      );
      await expect(connection).toHaveCSS('display', 'flex');
      await expect(connection).toHaveCSS('flex-direction', 'column');
      await expect(connection).toHaveCSS('gap', '6.4px');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }
}

test('dashboard and cockpit queries follow the same resized container rather than the viewport', async ({
  page
}) => {
  await page.setViewportSize({ width: 2000, height: 1000 });
  await renderedDashboardFixtures(page);
  await page.goto('/admin/fundraiser');
  const dashboard = page.locator('[data-og7="admin-dashboard"]');
  const recent = dashboard.locator(
    'section[aria-labelledby="admin-recent-title"]'
  );
  await expect(recent).toBeVisible();
  const summary = dashboard.getByRole('region', {
    name: 'Synthèse des opérations'
  });
  const workflow = dashboard.locator('[data-og7="dashboard-workflow"]');
  const secondary = dashboard.locator('[data-og7="dashboard-secondary"]');
  const supervision = dashboard.locator('[data-og7="dashboard-supervision"]');
  const metricGrid = page
    .locator('[data-og7="cockpit-metric"][data-og7-id="sponsorships"]')
    .locator('..');
  for (const width of [
    607, 608, 609, 959, 960, 992, 993, 1023, 1024, 1343, 1344
  ]) {
    await test.step(`${width}px container in a 2000px viewport`, async () => {
      await dashboard.evaluate((node, width) => {
        node.style.width = `${width}px`;
      }, width);
      expect(
        await dashboard.evaluate((node) => node.getBoundingClientRect().width)
      ).toBe(width);
      await expect.poll(() => gridColumns(summary)).toBe(width < 960 ? 1 : 2);
      await expect
        .poll(() => gridColumns(recent.locator('..')))
        .toBe(width < 960 ? 1 : 2);
      // At exactly 38rem both cockpit queries match; the later max query wins.
      await expect
        .poll(() => gridColumns(metricGrid))
        .toBe(width <= 608 ? 1 : width < 1024 ? 2 : 4);
      await expect.poll(() => gridColumns(workflow)).toBe(width < 1024 ? 1 : 2);
      await expect
        .poll(() => gridColumns(secondary))
        .toBe(width < 1024 ? 1 : 2);
      await expect(dashboard.locator(':scope > header')).toHaveCSS(
        'flex-direction',
        width <= 608 ? 'column' : 'row'
      );
      await expect(recent.locator('header')).toHaveCSS(
        'flex-direction',
        width <= 992 ? 'column' : 'row'
      );
      await expect(
        supervision.locator('[data-og7="cockpit-systems"]')
      ).toBeVisible();
      const secondaryBox = (await secondary.boundingBox())!;
      const supervisionBox = (await supervision.boundingBox())!;
      expect(supervisionBox.y).toBeGreaterThanOrEqual(
        secondaryBox.y + secondaryBox.height - 1
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }
});

test('system cards retain viewport breakpoints, reduced motion and visible keyboard focus', async ({
  page
}) => {
  await fixtures(page);
  await page.route('**/api/admin/setup-status', (route) =>
    route.fulfill({ json: setupFixture() })
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/admin/fundraiser/setup');
  const cards = page.locator('[data-og7="setup-system"]');
  await expect(cards).toHaveCount(5);
  const grid = cards.first().locator('..');
  for (const width of [540, 541, 1250, 1251]) {
    await test.step(`${width}px viewport`, async () => {
      await page.setViewportSize({ width, height: 1000 });
      if (width <= 1250)
        await expect.poll(() => gridColumns(grid)).toBe(width <= 540 ? 1 : 2);
      else await expect.poll(() => gridColumns(grid)).toBeGreaterThan(2);
      await expect(grid).toHaveCSS('gap', '12px');
      // The global reduced-motion rule caps transitions at 0.01ms with !important.
      const durationMs = await cards.first().evaluate((node) =>
        Math.max(
          ...getComputedStyle(node)
            .transitionDuration.split(',')
            .map(
              (duration) =>
                Number.parseFloat(duration) *
                (duration.trim().endsWith('ms') ? 1 : 1000)
            )
        )
      );
      expect(durationMs).toBeLessThanOrEqual(0.01);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }
  // Choose the real system card by its existing hook, without a style class.
  const target = page.locator(
    '[data-og7="setup-system"][data-og7-id="database"]'
  );
  await target.focus();
  await expect(target).toHaveCSS('outline-width', '3px');
  await expect(target).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page.locator('#setup-database')).toBeFocused();
  await expect(page.locator('#setup-database details')).toHaveAttribute(
    'open',
    ''
  );
});

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
      await expect(card.getByRole('definition')).toHaveCount(0);
      await expect(card).not.toContainText('%');
      const chart = card.locator('[data-og7="cockpit-trend-chart"]');
      await expect(chart).toBeVisible();
      await expect(chart).toHaveCSS('height', '40px');
      await expect(card.getByRole('table')).toBeHidden();
      await card.screenshot({
        path: testInfo.outputPath('sponsorship-card.png')
      });

      const disclosure = card.locator('summary');
      await expect(disclosure).toHaveAccessibleName(
        language === 'en' ? 'Daily breakdown' : 'Détail par jour'
      );
      await disclosure.focus();
      await page.keyboard.press('Enter');
      await expect(card.getByRole('definition')).toHaveText(['3', '0']);
      await expect(
        card.getByText(
          language === 'en'
            ? /The previous period is zero/
            : /La période précédente est à zéro/
        )
      ).toBeVisible();
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
      await expect(region).toHaveCSS('max-height', '192px');
      await expect(region).toHaveCSS('overflow', 'auto');
      const header = region.getByRole('columnheader').first();
      await expect(header).toHaveCSS('position', 'sticky');
      await expect(header).toHaveCSS('top', '0px');
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
  await card.locator('summary').click();
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
  await expect(card.getByRole('row').nth(1).getByRole('cell')).toHaveText(
    'Non disponible'
  );
  await expect(card.getByRole('row').nth(2).getByRole('cell')).toHaveText('0');

  trend = { ...trend, series: [] };
  await metrics(page).getByRole('button', { name: 'Actualiser' }).click();
  await expect(card.locator('summary')).toBeVisible();
  await expect(card.getByRole('table')).toHaveCount(0);
  await expect(card.getByRole('definition')).toHaveText([
    'Non disponible',
    '0'
  ]);
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
  await expect(card.getByText(/\+100\s*%/)).toBeVisible();
  percent = -50;
  await metrics(page).getByRole('button', { name: 'Actualiser' }).click();
  await expect(card.getByText(/-50\s*%/)).toBeVisible();
  percent = 0;
  await metrics(page).getByRole('button', { name: 'Actualiser' }).click();
  await expect(card.locator('[data-direction="flat"]')).toHaveText(
    /^\s*↔\s*\+?0\s*%\s*$/
  );
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
  const periods = metrics(page).getByText(/2026-08-17/);
  await expect(periods).toBeVisible();
  await expect(periods).toContainText('2026-09-15');
  await expect(periods).toContainText('2026-07-18');
  await expect(periods).toContainText('2026-08-16');
  await expect(periods).toContainText('America/Toronto');
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
    'Aucune activité récente'
  );
  await expect(
    systems(page).locator('[data-og7-id="connection"]')
  ).toContainText('Opérationnel');
});

test('cockpit presents a failed Stripe connection separately from successful webhook activity', async ({
  page
}) => {
  const data = await fixtures(page);
  data.systems = {
    ...data.systems,
    systems: data.systems.systems.map((system) =>
      system.id === 'stripe'
        ? {
            ...system,
            state: 'operational',
            evidence: 'recent_webhook',
            observedAt: data.systems.generatedAt,
            connection: {
              ...system.connection!,
              state: 'unavailable',
              evidence: 'check_failed',
              observedAt: null
            }
          }
        : system
    )
  };
  await page.goto('/admin/fundraiser');
  const stripe = systems(page).locator('[data-og7-id="stripe"]');
  await expect(stripe.locator('[data-og7-id="connection"]')).toContainText(
    'Indisponible'
  );
  await expect(stripe.locator('[data-og7-id="webhooks"]')).toContainText(
    'Activité récente'
  );
  await expect(stripe.locator('[data-og7-id="webhooks"]')).toContainText(
    'Dernier webhook de paiement traité'
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
