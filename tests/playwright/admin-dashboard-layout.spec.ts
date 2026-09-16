import type { Page } from '@playwright/test';
import type {
  AdminContributionRecord,
  AdminDashboardResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

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
    } else if (pathname === '/api/admin/attention') {
      await route.fulfill({ json: {
        available: true, coverage: 'complete', missingSources: [], generatedAt: dashboard.last_updated_at,
        timezone: 'America/Toronto', total: 4, filteredTotal: 4, todayTotal: 4, page: 1, pageSize: 4,
        counts: { urgent: 1, today: 3, this_week: 0, informational: 0 }, typeCounts: {},
        items: ['stripe_event_failed', 'sponsorship_needs_review', 'email_delivery_failed', 'invoice_missing'].map((type, index) => ({
          id: 'dashboard-task-' + index, type, severity: index === 0 ? 'urgent' : 'today',
          title: type, explanation: type, detectedAt: dashboard.last_updated_at,
          adminUrl: '/admin/fundraiser/attention', facts: { reference: 'DEMO-2026-00' + index }, suggestedActions: []
        }))
      } });
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

test('dashboard displays truthful metrics and preserves every navigation destination', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser');
  await expect(
    page.getByRole('heading', { name: 'Centre de pilotage' })
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Solde estimé' })
  ).toContainText('Hors frais Stripe et dépenses');
  await expect(
    page.getByRole('article', { name: 'Commandites', exact: true })
  ).toContainText('48');
  await expect(
    page.getByRole('article', { name: 'Commandites à publier' })
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
  await expect(page.getByRole('status').filter({ hasText: 'Actualisation' })).toContainText('Actualisation');
  await expect(
    page.getByRole('button', { name: 'Actualiser', exact: true })
  ).toBeDisabled();
  release?.();
  await expect(
    page.getByRole('article', { name: 'Montants encaissés' })
  ).toBeVisible();
  await page.unroute('**/api/admin/dashboard');
  await page.route('**/api/admin/dashboard', (route) =>
    route.fulfill({ status: 502, json: {} })
  );
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('périmées');
  await expect(
    page.getByRole('article', { name: 'Montants encaissés' })
  ).toBeVisible();
  await page.unroute('**/api/admin/dashboard');
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('unavailable storage is distinct from an empty fund', async ({ page }) => {
  await fixtures(page);
  await page.route('**/api/admin/dashboard', (route) =>
    route.fulfill({ json: { ...dashboard, data_available: false } })
  );
  await page.goto('/admin/fundraiser');
  await expect(page.getByRole('alert')).toContainText(
    'Données du fonds indisponibles'
  );
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
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
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
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Accès refusé');
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
  await page.keyboard.press('Tab');
  await expect(
    nav.getByRole('link', { name: 'Tableau de bord' })
  ).toBeFocused();
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
