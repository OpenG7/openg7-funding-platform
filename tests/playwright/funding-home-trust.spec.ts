import type { Page } from '@playwright/test';

import { expect, test } from './support/test';

const emptyReport = {
  data_source: 'database',
  total_received: 0,
  total_fees: 0,
  total_net: 0,
  total_refunded: 0,
  total_payouts: 0,
  current_available_estimate: 0,
  contributions_count: 0,
  currency: 'CAD',
  monthly_summary: [],
  latest_public_allocations: [],
  public_builders: [],
  last_updated_at: '2026-09-11T12:00:00.000Z'
};

const fundedReport = {
  ...emptyReport,
  total_received: 250,
  total_fees: 8,
  total_net: 242,
  current_available_estimate: 242,
  contributions_count: 4
};

function sponsorReturnPath(language: 'fr-CA' | 'en', withReference = true) {
  const query = new URLSearchParams({
    checkout: 'success',
    contributionType: 'sponsorship_interest',
    followup_token: 'test_followup_token_for_browser_only_12345'
  });
  if (withReference) {
    query.set('reference', 'OG7-TEST-REFERENCE');
  }
  return `${language === 'en' ? '/en' : ''}/fonds-des-batisseurs?${query}`;
}

function homeProgress(page: Page) {
  return page.locator('[data-og7="home-funding-progress"]');
}

test.beforeEach(async ({ page }) => {
  // Every API request is intercepted: these scenarios never touch a database,
  // Stripe account, or configured local API.
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/public/funding-config') {
      await route.fulfill({ json: { business_sponsorship_enabled: false } });
    } else if (pathname === '/api/public/fund-transparency') {
      await route.fulfill({ json: emptyReport });
    } else {
      await route.fulfill({ status: 503, json: {} });
    }
  });
});

for (const language of ['fr-CA', 'en'] as const) {
  test(`sponsor return without a server reference stays unconfirmed (${language})`, async ({
    page
  }) => {
    await page.goto(sponsorReturnPath(language, false));

    const notice = page.getByRole('region', {
      name:
        language === 'en'
          ? 'Your payment is being confirmed.'
          : 'Votre paiement est en cours de confirmation.'
    });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(
      language === 'en'
        ? 'Payment awaiting confirmation'
        : 'Paiement en attente de confirmation'
    );
    await expect(notice).not.toContainText(/Paiement reçu|Payment received/);
  });
}

for (const initialResult of ['unpaid', 'not_found', 'error'] as const) {
  test(`sponsor return stays pending after ${initialResult} until the server confirms payment`, async ({
    page
  }) => {
    await page.clock.install();
    let paid = false;
    await page.route('**/api/reference-lookup', async (route) => {
      await route.fulfill({
        status: !paid && initialResult === 'error' ? 503 : 200,
        json: {
          found: paid || initialResult !== 'not_found',
          paymentStatus: paid ? 'paid' : 'unpaid'
        }
      });
    });
    await page.goto(sponsorReturnPath('fr-CA'));

    const notice = page.locator(
      'section[aria-labelledby="checkout-sponsor-title"]'
    );
    await expect(notice).toContainText('Paiement en attente de confirmation');
    await expect(notice).not.toContainText('Paiement reçu');

    paid = true;
    await page.clock.fastForward(5001);
    await expect(notice).toContainText('Paiement reçu par Stripe');
    await expect(notice).toContainText(
      'Publication seulement après approbation'
    );
    await expect(notice).not.toContainText(
      'Paiement en attente de confirmation'
    );
  });
}

test('initial loading and an unavailable registry never display zero totals or progress', async ({
  page
}) => {
  let releaseRequest!: () => void;
  const requestHeld = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route('**/api/public/fund-transparency', async (route) => {
    await requestHeld;
    await route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/fonds-des-batisseurs');

  const progress = homeProgress(page);
  const totals = page.locator('[data-og7="home-funding-totals"]');
  const finance = page.locator('[data-og7="home-finance-summary"]');
  await expect(progress).toContainText('Synchronisation...');
  await expect(progress).not.toContainText(/\b0\s*%/);
  await expect(totals.locator('strong').nth(0)).toHaveText(
    'Synchronisation...'
  );
  await expect(totals).not.toContainText('0 contributions confirmées');

  releaseRequest();
  await expect(progress).toContainText('Registre public indisponible');
  for (let index = 0; index < 3; index++) {
    await expect(totals.locator('strong').nth(index)).toHaveText(
      'Indisponible'
    );
    await expect(finance.locator('dd').nth(index)).toHaveText('Indisponible');
  }
  await expect(progress).not.toContainText(/\b0\s*%/);
  await expect(totals).not.toContainText('0 contributions confirmées');
});

test('an empty registry confirmed by the API displays real zero totals', async ({
  page
}) => {
  await page.goto('/fonds-des-batisseurs');

  await expect(homeProgress(page)).toContainText('0 %');
  const totals = page.locator('[data-og7="home-funding-totals"]');
  await expect(totals.locator('strong').first()).toHaveText(/0\s*\$/);
  await expect(totals).toContainText('0 contributions confirmées');
  await expect(homeProgress(page)).not.toContainText('Indisponible');
});

test('failed refresh keeps the last amounts and timestamp with a warning, then recovers', async ({
  page
}) => {
  await page.clock.install();
  let unavailable = false;
  await page.route('**/api/public/fund-transparency', async (route) => {
    await route.fulfill({
      status: unavailable ? 503 : 200,
      json: fundedReport
    });
  });
  await page.goto('/fonds-des-batisseurs');

  const progress = homeProgress(page);
  const totals = page.locator('[data-og7="home-funding-totals"]');
  const finance = page.locator('[data-og7="home-finance-summary"]');
  await expect(totals.locator('strong').first()).toHaveText(/250\s*\$/);
  const synchronizedStatus = await progress.getByRole('status').innerText();
  const timestamp = synchronizedStatus.replace(
    'Données du registre synchronisées le ',
    ''
  );

  unavailable = true;
  await page.clock.fastForward(30001);
  await expect(progress.getByRole('status')).toContainText(
    'Actualisation impossible.'
  );
  await expect(progress.getByRole('status')).toContainText(timestamp);
  await expect(finance.getByRole('status')).toContainText(
    'les montants peuvent avoir changé'
  );
  await expect(totals.locator('strong').first()).toHaveText(/250\s*\$/);
  await expect(finance.locator('dd').last()).toHaveText(/242\s*\$/);
  await expect(totals).toContainText('4 contributions confirmées');

  unavailable = false;
  await page.clock.fastForward(30001);
  await expect(progress.getByRole('status')).toHaveText(synchronizedStatus);
  await expect(finance.getByRole('status')).toHaveCount(0);
});

test('an unavailable registry recovers to the confirmed API totals', async ({
  page
}) => {
  await page.clock.install();
  let unavailable = true;
  await page.route('**/api/public/fund-transparency', async (route) => {
    await route.fulfill({
      status: unavailable ? 503 : 200,
      json: fundedReport
    });
  });
  await page.goto('/en/fonds-des-batisseurs');
  await expect(homeProgress(page)).toContainText('Unavailable');

  unavailable = false;
  await page.clock.fastForward(30001);
  await expect(homeProgress(page)).toContainText('250');
  await expect(homeProgress(page)).toContainText(
    'Registry data synchronized on'
  );
  await expect(homeProgress(page)).not.toContainText('Unavailable');
});
