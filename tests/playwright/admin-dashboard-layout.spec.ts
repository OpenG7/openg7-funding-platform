import type { Locator, Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  AdminCockpitMetrics,
  AdminCockpitSystems,
  AdminContributionRecord,
  AdminDashboardResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { cockpitFixtures } from './support/cockpit-fixtures.js';
import { premiumFixtures } from './support/admin-premium-fixtures.js';
import { expectAdminFontsReady } from './support/admin-fonts.js';

const record: AdminContributionRecord = {
  id: 'ui-sponsorship-1',
  public_reference: 'UI-2026-001',
  contribution_type: 'sponsorship_interest',
  amount: 10000,
  currency: 'CAD',
  payment_status: 'paid',
  paid_at: '2026-09-14T14:00:00.000Z',
  public_name: null,
  email_private: 'private@example.invalid',
  public_display_consent: false,
  display_amount_consent: false,
  non_charity_acknowledged: true,
  sponsor_company_name: 'Atelier Boréal · Démonstration',
  sponsor_contact_name: null,
  sponsor_contact_email: null,
  sponsor_review_status: 'pending_review',
  sponsor_feed_status: 'not_planned',
  stripe_session_id: null,
  stripe_payment_intent_id: null,
  created_at: '2026-09-14T14:00:00.000Z',
  updated_at: '2026-09-14T14:00:00.000Z'
};
const dashboard: AdminDashboardResponse = {
  data_source: 'database',
  data_available: true,
  totals: {
    total_received: 285420,
    total_refunded: 10000,
    total_disputed: 500,
    current_available_estimate: 274920,
    currency: 'CAD',
    contributions_count: 105,
    paid_contributions_count: 98
  },
  sponsorship_review: { total: 48, pending: 3, approved: 43, rejected: 2 },
  feed_publication: { planned: 12, drafted: 4, published: 27, active: 43 },
  stripe_events: {
    failed: 1,
    processing: 2,
    last_failed_at: '2026-09-14T13:20:00.000Z'
  },
  recent_contributions: [
    record,
    {
      ...record,
      id: 'ui-personal-1',
      contribution_type: 'personal_support',
      public_name: 'Camille · Démonstration',
      sponsor_company_name: null,
      amount: 250
    },
    {
      ...record,
      id: 'ui-sponsorship-2',
      sponsor_company_name: 'Collectif Horizon · Démonstration',
      amount: 5000,
      payment_status: 'refunded'
    }
  ],
  last_updated_at: '2026-09-15T14:00:00.000Z'
};
const sessionToken = 'openg7-admin-session.ui-fixture';
const dashboardAttention = {
  available: true,
  coverage: 'complete',
  missingSources: [],
  generatedAt: dashboard.last_updated_at,
  timezone: 'America/Toronto',
  total: 4,
  filteredTotal: 4,
  todayTotal: 4,
  page: 1,
  pageSize: 4,
  counts: { urgent: 1, today: 3, this_week: 0, informational: 0 },
  typeCounts: {},
  items: [
    'stripe_event_failed',
    'sponsorship_needs_review',
    'email_delivery_failed',
    'invoice_missing'
  ].map((type, index) => ({
    id: 'dashboard-task-' + index,
    type,
    severity: index === 0 ? 'urgent' : 'today',
    title: type,
    explanation: type,
    detectedAt: dashboard.last_updated_at,
    adminUrl: '/admin/fundraiser/attention',
    facts: { reference: 'DEMO-2026-00' + index },
    suggestedActions: []
  }))
};

async function fixtures(page: Page, expired = false): Promise<void> {
  await page.addInitScript(
    ({ sessionToken, expired }) => {
      sessionStorage.setItem('openg7-admin-session-token', sessionToken);
      sessionStorage.setItem(
        'openg7-admin-session-expires-at',
        expired ? '2000-01-01T00:00:00Z' : '2099-01-01T00:00:00Z'
      );
    },
    { sessionToken, expired }
  );
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/admin/dashboard') {
      await route.fulfill({ json: dashboard });
    } else if (pathname.startsWith('/api/admin/cockpit/')) {
      const block = pathname.split('/').pop() as
        'metrics' | 'activity' | 'systems';
      await route.fulfill({ json: cockpitFixtures()[block] });
    } else if (pathname === '/api/admin/attention') {
      await route.fulfill({ json: dashboardAttention });
    } else if (pathname === '/api/admin/assistant/summary') {
      await route.fulfill({
        json: {
          generatedAt: dashboard.last_updated_at,
          counts: { urgent: 0, today: 0, thisWeek: 0, informational: 0 },
          sponsorships: { needsInfo: 0, needsReview: 0, approved: 0 },
          publications: { needsPreparation: 0, scheduled: 0, late: 0 },
          emails: { failed: 0 },
          attentionItems: []
        }
      });
    } else if (pathname === '/api/admin/auth/config') {
      await route.fulfill({ json: { mode: 'token' } });
    } else if (pathname === '/api/admin/session') {
      await route.fulfill({
        json: {
          sessionToken,
          expiresAt: '2099-01-01T00:00:00Z',
          actor: 'funding-admin-session',
          ttlSeconds: 3600
        }
      });
    } else {
      await route.fulfill({
        status: 503,
        json: { error: 'Not available in this UI fixture.' }
      });
    }
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
});

const shellPalettes = {
  mineral: {
    background: 'rgb(245, 247, 251)',
    sidebar: 'rgb(247, 249, 252)',
    border: 'rgb(216, 224, 236)',
    text: 'rgb(23, 43, 80)',
    selected: 'rgb(237, 243, 250)',
    accent: 'rgb(54, 93, 136)'
  },
  night: {
    background: 'rgb(11, 23, 39)',
    sidebar: 'rgb(13, 27, 44)',
    border: 'rgb(64, 86, 111)',
    text: 'rgb(241, 245, 252)',
    selected: 'rgb(36, 61, 83)',
    accent: 'rgb(158, 218, 255)'
  },
  graphite: {
    background: 'rgb(25, 27, 31)',
    sidebar: 'rgb(30, 33, 38)',
    border: 'rgb(86, 97, 110)',
    text: 'rgb(243, 244, 246)',
    selected: 'rgb(56, 67, 79)',
    accent: 'rgb(176, 210, 235)'
  }
} as const;

async function shellColumns(element: Locator): Promise<number> {
  return element.evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length
  );
}

for (const language of ['fr-CA', 'en'] as const)
  for (const viewport of [
    { width: 390, height: 1000 },
    // 1920x1080 at 125% supplies 1536x864 CSS pixels.
    { width: 1536, height: 864 }
  ]) {
    test(`dashboard composition starts with journey status and keeps the work queue accessible in ${language} at ${viewport.width}px`, async ({
      page
    }, testInfo) => {
      const { state, writes } = await premiumFixtures(
        page,
        language,
        dashboard
      );
      state.sponsor = {
        ...state.sponsor,
        sponsor_company_name: 'NordVale Énergie'
      };
      state.progress = { ...state.progress, companyName: 'NordVale Énergie' };
      await page.route('**/api/admin/attention*', (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ json: dashboardAttention })
          : route.fallback()
      );
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/admin/fundraiser');
      const root = page.locator('[data-og7="admin-dashboard"]');
      const heading = root.getByRole('heading', {
        name: language === 'en' ? 'Control centre' : 'Centre de pilotage',
        exact: true
      });
      const metrics = root.locator('[data-og7="cockpit-metrics"]');
      const journeys = root.locator('[data-og7="platform-journeys"]');
      const cards = metrics.getByRole('article');
      const workflow = root.locator('[data-og7="dashboard-workflow"]');
      const queue = workflow.locator('[data-og7="attention-panel"]');
      const dossier = workflow.locator('[data-og7="sponsorship-progress"]');
      const secondary = root.locator('[data-og7="dashboard-secondary"]');
      const supervision = root.locator('[data-og7="dashboard-supervision"]');
      const firstTask = queue
        .locator('[data-og7="attention-items"]')
        .getByRole('listitem')
        .first();
      await expect(heading).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(
        root.locator('[data-og7="dashboard-refresh"]')
      ).toBeEnabled();
      await expect(cards).toHaveCount(4);
      await expect(dossier).toContainText('NordVale Énergie');
      await expect(firstTask).toContainText('DEMO-2026-000');
      await expectAdminFontsReady(page);

      async function expectComposition(stacked: boolean) {
        const cardBoxes = await cards.evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height };
          })
        );
        for (let index = 1; index < cardBoxes.length; index++) {
          const previous = cardBoxes[index - 1]!;
          const current = cardBoxes[index]!;
          if (stacked) {
            expect(current.x).toBeCloseTo(previous.x, 0);
            expect(current.y).toBeGreaterThanOrEqual(
              previous.y + previous.height - 1
            );
          } else {
            expect(current.y).toBeCloseTo(previous.y, 0);
            expect(current.x).toBeGreaterThanOrEqual(
              previous.x + previous.width - 1
            );
          }
        }
        const queueBox = (await queue.boundingBox())!;
        const dossierBox = (await dossier.boundingBox())!;
        if (stacked) {
          expect(dossierBox.x).toBeCloseTo(queueBox.x, 0);
          expect(dossierBox.y).toBeGreaterThanOrEqual(
            queueBox.y + queueBox.height - 1
          );
        } else {
          // The queue's emphasis border sits above its inner section.
          expect(Math.abs(dossierBox.y - queueBox.y)).toBeLessThanOrEqual(4);
          expect(dossierBox.x).toBeGreaterThanOrEqual(
            queueBox.x + queueBox.width - 1
          );
          expect(queueBox.width / dossierBox.width).toBeCloseTo(1.5, 1);
        }
        const metricsBox = (await metrics.boundingBox())!;
        const journeysBox = (await journeys.boundingBox())!;
        expect(metricsBox.y).toBeGreaterThanOrEqual(
          journeysBox.y + journeysBox.height - 1
        );
        const workflowBox = (await workflow.boundingBox())!;
        expect(workflowBox.y).toBeGreaterThanOrEqual(
          metricsBox.y + metricsBox.height - 1
        );
        for (const element of [metrics, workflow, secondary, supervision]) {
          const box = (await element.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(-1);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
      }

      await test.step('journey status leads the metrics and work queue before secondary information', async () => {
        await expectComposition(viewport.width === 390);
        await expect(
          secondary.locator('[data-og7="assistant-context"]')
        ).toHaveCount(1);
        await expect(
          secondary.locator('[data-og7="cockpit-activity"]')
        ).toHaveCount(1);
        await expect(
          supervision.locator('[data-og7="cockpit-systems"]')
        ).toHaveCount(1);
        const workflowBox = (await workflow.boundingBox())!;
        const celebrationBox = (await root
          .locator('[data-og7="admin-celebrations"]')
          .boundingBox())!;
        expect(celebrationBox.y).toBeGreaterThanOrEqual(
          workflowBox.y + workflowBox.height - 1
        );
        const secondaryBox = (await secondary.boundingBox())!;
        const supervisionBox = (await supervision.boundingBox())!;
        expect(supervisionBox.y).toBeGreaterThanOrEqual(
          secondaryBox.y + secondaryBox.height - 1
        );
        await page.screenshot({
          path: testInfo.outputPath(
            `dashboard-composition-${viewport.width}.png`
          ),
          animations: 'disabled'
        });
        if (language === 'fr-CA' && viewport.width === 1536)
          await page.screenshot({
            path: testInfo.outputPath('dashboard-composition-full.png'),
            animations: 'disabled',
            fullPage: true
          });
        if (viewport.width === 1536) {
          // No earlier focus, click or scroll may reveal these first-screen targets.
          expect(await page.evaluate(() => scrollY)).toBe(0);
          await expect(
            journeys.getByRole('heading', { level: 2 })
          ).toBeInViewport({ ratio: 1 });
          await expect(
            journeys.locator('[data-og7="platform-journey"]').first()
          ).toBeInViewport({ ratio: 1 });
        }
      });

      await test.step('the primary control-desk link and the exact attention destination remain keyboard accessible', async () => {
        const primary = root.locator('[data-og7="dashboard-pilotage"]');
        await expect(primary).toHaveAccessibleName(
          language === 'en' ? 'Control desk' : 'Poste de pilotage'
        );
        await expect(primary).toHaveAttribute(
          'href',
          '/admin/fundraiser/pilotage'
        );
        await page.keyboard.press('Tab');
        await primary.focus();
        await expect(primary).toBeFocused();
        await expect(primary).toHaveCSS('outline-style', 'solid');
        await expect(queue.getByRole('link').first()).toHaveAttribute(
          'href',
          '/admin/fundraiser/attention?due=today'
        );
      });

      if (language === 'en' && viewport.width === 390)
        await test.step('200% mobile text keeps the queue usable without horizontal page scrolling', async () => {
          await page.evaluate(() => {
            document.documentElement.style.fontSize = '200%';
          });
          await expect(page.locator('html')).toHaveCSS('font-size', '32px');
          await expectComposition(true);
          const open = firstTask.getByRole('link');
          await open.focus();
          await expect(open).toBeFocused();
          await expect(open).toBeInViewport({ ratio: 1 });
          await page.screenshot({
            path: testInfo.outputPath('dashboard-composition-390-text-200.png'),
            animations: 'disabled',
            fullPage: true
          });
        });
      expect(writes).toEqual([]);
      expect(state.commands).toEqual([]);
    });
  }

for (const theme of ['mineral', 'night', 'graphite'] as const) {
  test(`admin shell preserves ${theme} navigation surfaces on French mobile and English desktop`, async ({
    page
  }) => {
    await fixtures(page);
    await page.addInitScript((theme) => {
      localStorage.setItem('openg7.language', 'fr-CA');
      localStorage.setItem(
        'openg7.pilotage.appearance.v1',
        JSON.stringify({ theme, system: false, density: 'comfortable' })
      );
    }, theme);
    await page.setViewportSize({ width: 390, height: 941 });
    await page.goto('/admin/fundraiser');
    const shell = page.locator('openg7-admin-layout');
    const sidebar = page.locator('#admin-sidebar');
    const aside = sidebar.getByRole('complementary');
    const banner = page.getByRole('banner');
    const nav = sidebar.locator('nav');
    const mobileToggle = sidebar.getByRole('button', {
      name: 'Ouvrir le menu'
    });
    const palette = shellPalettes[theme];
    for (const language of ['fr-CA', 'en']) {
      await test.step(
        language === 'fr-CA' ? '390px mobile' : '1536px desktop',
        async () => {
          if (language === 'fr-CA') await mobileToggle.click();
          else {
            await page.setViewportSize({ width: 1536, height: 941 });
            await banner
              .getByRole('button', {
                name: 'Switch administration language to English'
              })
              .click();
          }
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          await expect(shell).toHaveCSS('background-color', palette.background);
          await expect(aside).toHaveCSS('background-color', palette.sidebar);
          await expect(aside).toHaveCSS('padding', '16px 12px');
          await expect(banner).toHaveCSS('border-bottom-color', palette.border);
          const active = nav.getByRole('link', {
            name: language === 'en' ? 'Dashboard' : 'Tableau de bord',
            exact: true
          });
          await expect(active).toHaveAttribute('aria-current', 'page');
          await expect(active).toHaveCSS('background-color', palette.selected);
          await expect(active).toHaveCSS('color', palette.accent);
          await expect(active).toHaveCSS('font-size', '15px');
          await expect(active).toHaveCSS('min-height', '44px');
          await expect(active).toHaveCSS('padding', '10px 12px');
          const shadow = await active.evaluate(
            (node) => getComputedStyle(node).boxShadow
          );
          expect(shadow).toContain(palette.accent);
          expect(shadow).toContain('3px 0px 0px 0px inset');
          if (language === 'fr-CA') {
            await active.focus();
            await page.keyboard.press('Escape');
            await expect(nav).toBeHidden();
            await expect(mobileToggle).toBeFocused();
          } else {
            await expect(sidebar).toHaveCSS('width', '240px');
            await expect(aside).toHaveCSS('position', 'sticky');
            await expect(aside).toHaveCSS('max-height', '941px');
          }
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1
            )
          ).toBe(true);
        }
      );
    }
  });
}

test('admin shell preserves inclusive navigation and chrome breakpoints through menu changes', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser');
  const layout = page.locator('[data-og7="admin-layout"]');
  const sidebar = page.locator('#admin-sidebar');
  const aside = sidebar.getByRole('complementary');
  const nav = sidebar.locator('nav');
  const main = page.getByRole('main');
  const banner = page.getByRole('banner');
  const search = banner.locator('openg7-admin-global-search');
  const newPassage = banner.locator(
    '[data-og7="admin-automatic-portfolio-start"]'
  );
  const tools = banner
    .getByRole('button', {
      name: 'Switch administration language to English'
    })
    .locator('..');
  const identity = banner
    .getByText('Administration', { exact: true })
    .locator('..');
  const desktopToggle = page.locator('[data-og7="admin-navigation-toggle"]');
  const mobileToggle = sidebar.locator(
    'button[aria-controls="admin-navigation-content"]'
  );
  const brandText = sidebar.getByText('Open G7', { exact: true }).locator('..');
  for (const width of [400, 401, 480, 481, 860, 861, 1200, 1201]) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 941 });
      await expect(banner).toHaveCSS(
        'padding',
        width <= 860 ? '12.8px 16px' : `12px ${Math.min(32, width * 0.02)}px`
      );
      await expect(main).toHaveCSS(
        'padding',
        width <= 860
          ? '20px 16px 32px'
          : `20px ${Math.min(32, width * 0.02)}px 32px`
      );
      await expect(search).toHaveCSS(
        'flex-basis',
        width <= 480 ? '100%' : '0%'
      );
      await expect(banner).toHaveCSS('flex-wrap', 'wrap');
      await expect(newPassage).toHaveCSS(
        'flex-basis',
        width <= 480 ? '100%' : 'auto'
      );
      if (width <= 1200) await expect(identity).toBeHidden();
      else await expect(identity).toBeVisible();
      if (width <= 480) {
        await expect(brandText).toBeHidden();
        await expect(tools).toHaveCSS('justify-content', 'space-between');
      } else await expect(brandText).toBeVisible();
      if (width <= 860) {
        await expect(desktopToggle).toBeHidden();
        await expect(nav).toBeHidden();
        await expect.poll(() => shellColumns(layout)).toBe(1);
        await mobileToggle.focus();
        await page.keyboard.press('Enter');
        await expect(nav).toBeVisible();
        await expect.poll(() => shellColumns(nav)).toBe(width <= 400 ? 1 : 2);
        await expect(aside).toHaveCSS('border-right-width', '0px');
        await expect(aside).toHaveCSS('border-bottom-width', '1px');
        await page.keyboard.press('Escape');
        await expect(nav).toBeHidden();
        await expect(mobileToggle).toBeFocused();
      } else {
        await expect(mobileToggle).toBeHidden();
        await expect(sidebar).toHaveCSS(
          'width',
          width <= 1200 ? '224px' : '240px'
        );
        await expect(aside).toHaveCSS('border-right-width', '1px');
        await expect(aside).toHaveCSS('overflow-y', 'auto');
        await expect.poll(() => shellColumns(layout)).toBe(2);
        const expandedWidth = await main.evaluate(
          (node) => node.getBoundingClientRect().width
        );
        await desktopToggle.focus();
        await page.keyboard.press('Enter');
        await expect(sidebar).toBeHidden();
        await expect.poll(() => shellColumns(layout)).toBe(1);
        expect(
          await main.evaluate((node) => node.getBoundingClientRect().width)
        ).toBeGreaterThan(expandedWidth);
        await page.keyboard.press('Space');
        await expect(sidebar).toBeVisible();
        await expect(desktopToggle).toBeFocused();
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }
});

test('default Premium Light palette keeps dashboard readable at 125% display scaling', async ({
  page
}, testInfo) => {
  await fixtures(page);
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser');
  await expect(
    page.getByRole('article', { name: 'Commandites', exact: true })
  ).toContainText('48');
  await expect(page.locator('[data-og7="dashboard-refresh"]')).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute(
    'data-og7-pilot-theme',
    'mineral'
  );
  await expect(page.locator('openg7-admin-layout')).toHaveCSS(
    'background-color',
    'rgb(245, 247, 251)'
  );
  await expect(
    page.getByRole('heading', { name: 'Centre de pilotage' })
  ).toHaveCSS('color', 'rgb(23, 43, 80)');
  await page.screenshot({
    path: testInfo.outputPath('mineral-dashboard.png'),
    fullPage: true
  });
  const audit = await new AxeBuilder({ page })
    .include('openg7-admin-layout')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
});

test('admin text palette remains readable and the cockpit reflows with enlarged text in both languages', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser');
  const palette = await page
    .locator('[data-og7="admin-layout"]')
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return Object.fromEntries(
        [
          'text',
          'muted',
          'gold',
          'success',
          'warning',
          'danger',
          'bg',
          'panel',
          'panel-raised'
        ].map((name) => [
          name,
          style.getPropertyValue('--admin-' + name).trim()
        ])
      );
    });
  const luminance = (hex: string) => {
    expect(hex).toMatch(/^#[a-f\d]{6}$/i);
    const channels = [1, 3, 5].map((offset) => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return (
      channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
    );
  };
  for (const text of [
    'text',
    'muted',
    'gold',
    'success',
    'warning',
    'danger'
  ]) {
    for (const surface of ['bg', 'panel', 'panel-raised']) {
      const a = luminance(palette[text]!);
      const b = luminance(palette[surface]!);
      expect(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        `${text}/${surface}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
  // 836 CSS px models the layout space at 200% browser zoom on a 1672px
  // desktop; doubling root text size separately checks text enlargement.
  // This is reflow coverage, not a claim to automate browser-chrome zoom.
  await page.setViewportSize({ width: 836, height: 941 });
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  for (const language of ['fr-CA', 'en']) {
    if (language === 'en')
      await page
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
    await expect(page.locator('h1')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
    await page.locator('[data-og7="admin-search-open"]').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-og7="admin-search-open"]')).toBeFocused();
    await page.screenshot({
      path: `test-results/lot8-reflow-${language}.png`,
      fullPage: true
    });
  }
});

test('dashboard displays truthful metrics and preserves every navigation destination', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser');
  await expect(
    page.getByRole('heading', { name: 'Centre de pilotage' })
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Net des encaissements' })
  ).toContainText('Brut moins frais confirmés');
  await expect(
    page.getByRole('article', { name: 'Commandites', exact: true })
  ).toContainText('48');
  await expect(
    page.getByRole('article', { name: 'Publications prévues' })
  ).toContainText('12');
  await expect(page.getByText('private@example.invalid')).toHaveCount(0);
  await expect(page.getByLabel(/Jeton admin/)).toHaveCount(0);
  const nav = page.getByRole('navigation', {
    name: 'Navigation admin du fonds'
  });
  for (const heading of ['Pilotage', 'Opérations', 'Finances', 'Système']) {
    await expect(
      nav.getByRole('heading', { name: heading, exact: true })
    ).toBeVisible();
  }
  for (const [label, suffix] of [
    ['Tableau de bord', ''],
    ['Assistant', '/assistant'],
    ['Contributions', '/contributions'],
    ['Commandites', '/sponsors'],
    ['Publications', '/publications'],
    ['Factures', '/invoices'],
    ['Dépenses', '/expenses'],
    ['Transparence', '/transparency'],
    ['Courriels', '/email-queue'],
    ['Audit', '/audit'],
    ['Configuration', '/setup']
  ]) {
    await expect(
      nav.getByRole('link', { name: label, exact: true })
    ).toHaveAttribute('href', '/admin/fundraiser' + suffix);
  }
  await expect(
    nav.getByRole('link', { name: 'Tableau de bord' })
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('link', { name: /Atelier Boréal/ })
  ).toHaveAttribute(
    'href',
    '/admin/fundraiser/contributions?contributionId=ui-sponsorship-1'
  );
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Aller au contenu principal' })
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

test('language persists across admin navigation and reload without changing public locales', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser');
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Control centre' })
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page
    .getByRole('banner')
    .getByRole('link', { name: 'Assistant', exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/fundraiser\/assistant$/);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Dashboard', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Control centre' })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Control centre' })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Passer l’administration en français' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Centre de pilotage' })
  ).toBeVisible();
  await page.goto('/en/fonds-des-batisseurs');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.goto('/fonds-des-batisseurs');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr-CA');
});

test('loading prevents duplicate refreshes; failures preserve and label the last snapshot', async ({
  page
}) => {
  await fixtures(page);
  let release: (() => void) | undefined;
  await page.route('**/api/admin/dashboard', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ json: dashboard });
  });
  await page.goto('/admin/fundraiser', { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('status').filter({ hasText: 'Actualisation' })
  ).toContainText('Actualisation');
  await expect(page.locator('[data-og7=dashboard-refresh]')).toBeDisabled();
  release?.();
  await expect(
    page.getByRole('article', { name: 'Montants encaissés' })
  ).toBeVisible();
  await page.unroute('**/api/admin/dashboard');
  await page.route('**/api/admin/dashboard', (route) =>
    route.fulfill({ status: 502, json: {} })
  );
  await page.locator('[data-og7=dashboard-refresh]').click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'périmées' })
  ).toContainText('périmées');
  await expect(
    page.getByRole('article', { name: 'Montants encaissés' })
  ).toBeVisible();
  await page.unroute('**/api/admin/dashboard');
  await page.locator('[data-og7=dashboard-refresh]').click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'périmées' })
  ).toHaveCount(0);
});

test('unavailable storage is distinct from an empty fund', async ({ page }) => {
  await fixtures(page);
  await page.route('**/api/admin/cockpit/metrics', (route) =>
    route.fulfill({ json: { ...cockpitFixtures().metrics, available: false } })
  );
  await page.route('**/api/admin/dashboard', (route) =>
    route.fulfill({ json: { ...dashboard, data_available: false } })
  );
  await page.goto('/admin/fundraiser');
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Données du fonds indisponibles' })
  ).toContainText('Données du fonds indisponibles');
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.unroute('**/api/admin/dashboard');
  await page.route('**/api/admin/dashboard', (route) =>
    route.fulfill({
      json: {
        ...dashboard,
        totals: {
          ...dashboard.totals,
          total_received: 0,
          total_refunded: 0,
          total_disputed: 0,
          current_available_estimate: 0,
          contributions_count: 0,
          paid_contributions_count: 0
        },
        sponsorship_review: { total: 0, pending: 0, approved: 0, rejected: 0 },
        feed_publication: { planned: 0, drafted: 0, published: 0, active: 0 },
        stripe_events: { failed: 0, processing: 0, last_failed_at: null },
        recent_contributions: []
      }
    })
  );
  await page.route('**/api/admin/cockpit/metrics', (route) =>
    route.fulfill({
      json: {
        ...cockpitFixtures().metrics,
        currencies: [],
        sponsorshipCount: 0,
        plannedPublicationCount: 0
      }
    })
  );
  await page.locator('[data-og7=dashboard-refresh]').click();
  await expect(
    page.getByRole('heading', { name: 'Aucune contribution enregistrée' })
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Commandites', exact: true })
  ).toContainText('0');
});

test('a forbidden response removes previously displayed private data', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser');
  await expect(
    page.getByRole('link', { name: /Atelier Boréal/ })
  ).toBeVisible();
  await page.route('**/api/admin/dashboard', (route) =>
    route.fulfill({ status: 403, json: {} })
  );
  await page.locator('[data-og7=dashboard-refresh]').click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Accès refusé' })
  ).toContainText('Accès refusé');
  await expect(page.getByRole('link', { name: /Atelier Boréal/ })).toHaveCount(
    0
  );
});

test('an expired session returns to login before loading the dashboard', async ({
  page
}) => {
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/admin/dashboard')) requests++;
  });
  await fixtures(page, true);
  await page.goto('/admin/fundraiser');
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByLabel(/Jeton admin/)).toBeVisible();
  expect(requests).toBe(0);
});

test('server session rejection clears credentials and login returns to the dashboard', async ({
  page
}) => {
  await fixtures(page);
  await page.route('**/api/admin/dashboard', (route) =>
    route.fulfill({ status: 401, json: {} })
  );
  await page.goto('/admin/fundraiser');
  await expect(page).toHaveURL(/\/admin\/login/);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-session-token')
    )
  ).toBeNull();
  await page.unroute('**/api/admin/dashboard');
  await page.getByLabel(/Jeton admin/).fill('ui-fixture-token');
  await page.getByRole('button', { name: /Se connecter/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Centre de pilotage' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Déconnexion', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-session-token')
    )
  ).toBeNull();
});

test('desktop hamburger expands the workspace and remains keyboard accessible in both languages', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser');
  const toggle = page.locator('[data-og7="admin-navigation-toggle"]');
  const sidebar = page.locator('#admin-sidebar');
  const main = page.getByRole('main');
  await expect(toggle).toHaveAttribute('aria-controls', 'admin-sidebar');

  for (const language of ['fr-CA', 'en']) {
    if (language === 'en')
      await page
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
    for (const width of [1672, 1024, 861]) {
      await page.setViewportSize({ width, height: 941 });
      await expect(sidebar).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(toggle).toHaveAccessibleName(
        language === 'en' ? 'Close menu' : 'Fermer le menu'
      );
      const expandedWidth = await main.evaluate(
        (element) => element.getBoundingClientRect().width
      );

      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(sidebar).toBeHidden();
      await expect(page.getByRole('navigation')).toHaveCount(0);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle).toHaveAccessibleName(
        language === 'en' ? 'Open menu' : 'Ouvrir le menu'
      );
      await expect(toggle).toBeFocused();
      expect(
        await main.evaluate((element) => element.getBoundingClientRect().width)
      ).toBeGreaterThan(expandedWidth);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);

      await page.keyboard.press('Tab');
      await expect(
        page.locator('[data-og7="admin-search-open"]')
      ).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Space');
      await expect(sidebar).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(toggle).toBeFocused();
    }
  }
});

test('desktop hamburger keeps the mobile menu usable across viewport changes', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser');
  const desktopToggle = page.locator('[data-og7="admin-navigation-toggle"]');
  const sidebar = page.locator('#admin-sidebar');
  await desktopToggle.click();
  await expect(sidebar).toBeHidden();

  for (const width of [860, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(desktopToggle).toBeHidden();
    await expect(sidebar).toBeVisible();
    const mobileToggle = page.getByRole('button', { name: 'Ouvrir le menu' });
    await mobileToggle.click();
    await expect(sidebar.getByRole('navigation')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sidebar.getByRole('navigation')).toBeHidden();
    await expect(mobileToggle).toBeFocused();
  }

  await page.setViewportSize({ width: 1672, height: 941 });
  await expect(sidebar).toBeHidden();
  await expect(desktopToggle).toBeVisible();
  await desktopToggle.click();
  await expect(sidebar.getByRole('navigation')).toBeVisible();
});

test('mobile disclosure supports Escape, focus restoration and keyboard navigation', async ({
  page
}) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/fundraiser');
  const nav = page.getByRole('navigation', {
    name: 'Navigation admin du fonds'
  });
  await expect(nav).toBeHidden();
  const toggle = page.getByRole('button', { name: 'Ouvrir le menu' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(nav).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Fermer le menu' })
  ).toHaveAttribute('aria-expanded', 'true');
  const links = nav.getByRole('link');
  await page.keyboard.press('Tab');
  await expect(links.first()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(links.nth(1)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(links.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await nav.getByRole('link', { name: 'Tableau de bord' }).click();
  await expect(nav).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('desktop, tablet and mobile views fit their viewport with translated long content', async ({
  page
}, testInfo) => {
  await fixtures(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/admin/fundraiser');
  await expect(
    page.getByRole('heading', { name: 'Centre de pilotage' })
  ).toBeVisible();
  for (const width of [1672, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 800 ? 941 : 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('dashboard-fr-' + width + '.png'),
      fullPage: true
    });
  }
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Control centre' })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('dashboard-en-320.png'),
    fullPage: true
  });
  expect(errors).toEqual([]);
});

type CelebrationFixture = ReturnType<typeof cockpitFixtures> & {
  metricsStatus: number;
  systemsStatus: number;
};

async function celebrationFixtures(page: Page): Promise<CelebrationFixture> {
  await fixtures(page);
  const data = {
    ...cockpitFixtures(),
    metricsStatus: 200,
    systemsStatus: 200
  };
  data.systems = {
    ...data.systems,
    systems: data.systems.systems.map((system) => ({
      ...system,
      state: 'operational',
      evidence: system.id === 'stripe' ? 'recent_webhook' : system.evidence,
      observedAt: data.systems.generatedAt,
      ...(system.id === 'stripe'
        ? {
            connection: {
              ...system.connection!,
              observedAt: data.systems.generatedAt
            }
          }
        : {})
    }))
  } satisfies AdminCockpitSystems;
  await page.route('**/api/admin/cockpit/metrics', (route) =>
    route.fulfill({ status: data.metricsStatus, json: data.metrics })
  );
  await page.route('**/api/admin/cockpit/systems', (route) =>
    route.fulfill({ status: data.systemsStatus, json: data.systems })
  );
  return data;
}

function nextCelebrationMetrics(
  data: CelebrationFixture,
  changes: Partial<AdminCockpitMetrics>
): void {
  data.metrics = {
    ...data.metrics,
    generatedAt: new Date(
      Date.parse(data.metrics.generatedAt) + 1
    ).toISOString(),
    ...changes
  };
}

async function refreshCelebrationBlock(
  page: Page,
  block: 'metrics' | 'systems'
): Promise<void> {
  const button = page
    .locator(`[data-og7="cockpit-${block}"]`)
    .getByRole('button', { name: 'Actualiser', exact: true });
  await Promise.all([
    page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/cockpit/' + block)
    ),
    button.click()
  ]);
  await expect(button).toBeEnabled();
}

test('dashboard celebrations use a confirmed baseline and keep gains in their own currencies', async ({
  page
}) => {
  await page.clock.install();
  const data = await celebrationFixtures(page);
  await page.goto('/admin/fundraiser');
  const celebrations = page.locator('[data-og7="admin-celebrations"]');
  const gains = celebrations.locator('[data-og7="celebration-gains"]');
  await expect(celebrations).toBeVisible();
  await expect(
    page.locator('[data-og7="cockpit-metrics"]').getByRole('article')
  ).toHaveCount(4);
  await expect(gains).toBeHidden();

  nextCelebrationMetrics(data, {
    currencies: data.metrics.currencies.map((currency) => ({
      ...currency,
      confirmedFeesMinor: currency.confirmedFeesMinor + 100,
      netReceivedMinor:
        currency.netReceivedMinor === null
          ? null
          : currency.netReceivedMinor - 100,
      refundedMinor: currency.refundedMinor + 500,
      netAfterRefundsMinor:
        currency.netAfterRefundsMinor === null
          ? null
          : currency.netAfterRefundsMinor - 600,
      grossTrend: { ...currency.grossTrend, current: 999999 }
    }))
  });
  await refreshCelebrationBlock(page, 'metrics');
  await expect(gains).toBeHidden();

  nextCelebrationMetrics(data, {
    warnings: ['unlinked_transactions'],
    currencies: data.metrics.currencies.map((currency) => ({
      ...currency,
      grossMinor: currency.grossMinor + 10000
    }))
  });
  await refreshCelebrationBlock(page, 'metrics');
  await expect(gains).toBeHidden();
  nextCelebrationMetrics(data, { warnings: [] });
  await refreshCelebrationBlock(page, 'metrics');
  await expect(gains).toBeHidden();

  nextCelebrationMetrics(data, {
    currencies: data.metrics.currencies.map((currency) => ({
      ...currency,
      grossMinor:
        currency.grossMinor + (currency.currency === 'CAD' ? 2500 : 1234)
    }))
  });
  await refreshCelebrationBlock(page, 'metrics');
  await expect(gains).toBeVisible();
  await expect(gains).toContainText(/25,00\s*CAD/);
  await expect(gains).toContainText(/12,34\s*USD/);
  await expect(gains).not.toContainText(/37,34/);
  await expect(
    celebrations.locator('[data-og7="celebration-coins"]')
  ).toHaveAttribute('aria-hidden', 'true');
  await page.clock.fastForward(5_100);
  await expect(gains).toBeHidden();
  await refreshCelebrationBlock(page, 'metrics');
  await expect(gains).toBeHidden();
});

test('dashboard celebrations never replay a decrease and rebound or a failed or stale snapshot', async ({
  page
}) => {
  await page.clock.install();
  const data = await celebrationFixtures(page);
  const baseline = data.metrics;
  data.metricsStatus = 503;
  await page.goto('/admin/fundraiser');
  const gains = page.locator('[data-og7="celebration-gains"]');
  await expect(
    page.locator('[data-og7="cockpit-metrics"]').getByRole('alert')
  ).toBeVisible();
  await expect(gains).toBeHidden();
  data.metricsStatus = 200;
  await refreshCelebrationBlock(page, 'metrics');
  await expect(gains).toBeHidden();

  nextCelebrationMetrics(data, {
    currencies: baseline.currencies.map((currency) => ({
      ...currency,
      grossMinor: currency.grossMinor - 1000
    }))
  });
  await refreshCelebrationBlock(page, 'metrics');
  await expect(gains).toBeHidden();
  nextCelebrationMetrics(data, { currencies: baseline.currencies });
  await refreshCelebrationBlock(page, 'metrics');
  await expect(gains).toBeHidden();

  data.metricsStatus = 503;
  nextCelebrationMetrics(data, {
    currencies: baseline.currencies.map((currency) => ({
      ...currency,
      grossMinor: currency.grossMinor + 100000
    }))
  });
  await refreshCelebrationBlock(page, 'metrics');
  await expect(gains).toBeHidden();
  data.metricsStatus = 200;
  nextCelebrationMetrics(data, {
    generatedAt: new Date(Date.parse(baseline.generatedAt) - 1000).toISOString()
  });
  await refreshCelebrationBlock(page, 'metrics');
  await expect(gains).toBeHidden();

  nextCelebrationMetrics(data, {
    generatedAt: new Date(Date.parse(baseline.generatedAt) + 10).toISOString(),
    currencies: baseline.currencies.map((currency) => ({
      ...currency,
      grossMinor: currency.grossMinor + 500
    }))
  });
  await refreshCelebrationBlock(page, 'metrics');
  await expect(gains).toContainText(/5,00\s*CAD/);
  await page.clock.fastForward(5_100);
  await refreshCelebrationBlock(page, 'metrics');
  await expect(gains).toBeHidden();
});

test('dashboard celebrations can be disabled with the keyboard and retain that choice after reload', async ({
  page
}) => {
  const data = await celebrationFixtures(page);
  await page.goto('/admin/fundraiser');
  const section = page.locator('[data-og7="admin-celebrations"]');
  const toggle = section.locator('[data-og7="celebrations-toggle"]');
  const gains = section.locator('[data-og7="celebration-gains"]');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('[data-og7="cockpit-metrics"]').getByRole('article')
  ).toHaveCount(4);
  nextCelebrationMetrics(data, {
    currencies: data.metrics.currencies.map((currency) => ({
      ...currency,
      grossMinor: currency.grossMinor + 100
    }))
  });
  await refreshCelebrationBlock(page, 'metrics');
  await expect(gains).toBeVisible();
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(gains).toBeHidden();
  expect(
    await page.evaluate(() =>
      localStorage.getItem('openg7.admin.celebrations.v1')
    )
  ).toBe('off');
  expect(
    await section.evaluate(
      (element) => element.getAnimations({ subtree: true }).length
    )
  ).toBe(0);
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.locator('[data-og7="cockpit-metrics"]').getByRole('article')
  ).toHaveCount(4);
  nextCelebrationMetrics(data, {
    currencies: data.metrics.currencies.map((currency) => ({
      ...currency,
      grossMinor: currency.grossMinor + 100
    }))
  });
  await refreshCelebrationBlock(page, 'metrics');
  await expect(gains).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(gains).toBeHidden();
});

test('dashboard health requires fresh observations from every system and both Stripe checks', async ({
  page
}) => {
  const data = await celebrationFixtures(page);
  const healthy = data.systems;
  await page.goto('/admin/fundraiser');
  const health = page.locator('[data-og7="celebration-health"]');
  await expect(health).toHaveAttribute('data-state', 'operational');
  expect(
    await health.evaluate((element) =>
      element
        .getAnimations({ subtree: true })
        .every(
          (animation) =>
            Number(animation.effect?.getComputedTiming().endTime ?? 0) < 5000
        )
    )
  ).toBe(true);

  data.systems = {
    ...healthy,
    systems: healthy.systems.map((system) =>
      system.id === 'stripe'
        ? {
            ...system,
            connection: { ...system.connection!, state: 'unavailable' }
          }
        : system
    )
  };
  await refreshCelebrationBlock(page, 'systems');
  await expect(health).toHaveAttribute('data-state', 'attention');
  data.systems = {
    ...healthy,
    systems: healthy.systems.map((system) =>
      system.id === 'stripe'
        ? { ...system, state: 'unknown', evidence: 'no_recent_observation' }
        : system
    )
  };
  await refreshCelebrationBlock(page, 'systems');
  await expect(health).toHaveAttribute('data-state', 'unknown');
  data.systems = {
    ...healthy,
    systems: healthy.systems.filter((system) => system.id !== 'identity')
  };
  await refreshCelebrationBlock(page, 'systems');
  await expect(health).toHaveAttribute('data-state', 'unknown');
  data.systems = healthy;
  await refreshCelebrationBlock(page, 'systems');
  await expect(health).toHaveAttribute('data-state', 'operational');
  data.systemsStatus = 503;
  await refreshCelebrationBlock(page, 'systems');
  await expect(health).toHaveAttribute('data-state', 'unknown');
});

test('dashboard health stops indicating success when observations expire without a reload', async ({
  page
}) => {
  await page.clock.install();
  await celebrationFixtures(page);
  await page.goto('/admin/fundraiser');
  const health = page.locator('[data-og7="celebration-health"]');
  await expect(health).toHaveAttribute('data-state', 'operational');
  await page.clock.fastForward(90_000);
  await expect(health).toHaveAttribute('data-state', 'unknown');
});

test('dashboard celebrations respect reduced motion and remain accessible on mobile in French and English', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 844 });
  const data = await celebrationFixtures(page);
  await page.goto('/admin/fundraiser');
  const section = page.locator('[data-og7="admin-celebrations"]');
  await expect(
    page.locator('[data-og7="cockpit-metrics"]').getByRole('article')
  ).toHaveCount(4);
  nextCelebrationMetrics(data, {
    currencies: data.metrics.currencies.map((currency) => ({
      ...currency,
      grossMinor: currency.grossMinor + 2500
    }))
  });
  await refreshCelebrationBlock(page, 'metrics');
  await expect(section.locator('[data-og7="celebration-gains"]')).toBeVisible();
  for (const language of ['fr-CA', 'en']) {
    if (language === 'en')
      await page
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: language === 'en' ? 'Control centre' : 'Centre de pilotage',
        exact: true
      })
    ).toBeVisible();
    await expect(
      section.getByRole('heading', {
        name: language === 'en' ? 'The little wins' : 'Les petites victoires',
        exact: true
      })
    ).toBeVisible();
    await expect(
      section.locator('[data-og7="celebrations-toggle"]')
    ).toHaveAccessibleName(
      language === 'en' ? 'Animations On' : 'Animations Activées'
    );
    expect(
      await section.evaluate(
        (element) => element.getAnimations({ subtree: true }).length
      )
    ).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    const audit = await new AxeBuilder({ page })
      .include('[data-og7="admin-celebrations"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
  }
});
