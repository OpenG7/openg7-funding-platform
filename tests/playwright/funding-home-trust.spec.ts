import type { Page } from '@playwright/test';

import { expect, test } from './support/test.js';

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
  contributions_count: 4,
  monthly_summary: [
    {
      month: new Date().toISOString().slice(0, 7),
      currency: 'CAD',
      total_received: 250
    }
  ]
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

async function enableSponsorship(page: Page, amounts = [5, 10, 25, 50]) {
  await page.route('**/api/public/funding-config', (route) =>
    route.fulfill({
      json: {
        business_sponsorship_enabled: true,
        allowed_contribution_amounts: amounts
      }
    })
  );
  await page.route('**/api/public/sponsorship-batches/availability', (route) =>
    route.fulfill({
      json: { data_source: 'empty', availability: [], slots: [] }
    })
  );
}

const contributionForm = (page: Page) =>
  page.locator('[data-og7="contribution-form"]');
const checkoutButton = (page: Page) =>
  contributionForm(page).getByRole('button', { name: /Soutenir OpenG7/i });
const acknowledge = (page: Page) =>
  page.getByLabel(/OpenG7 est un projet ind.pendant en d.veloppement/i).check();

test('switching the default personal amount to sponsorship submits a valid 50 CAD amount only once', async ({
  page
}) => {
  await enableSponsorship(page);
  const requests: {
    amount: number;
    currency: string;
    contributionType: string;
  }[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/checkout-sessions', async (route) => {
    requests.push(route.request().postDataJSON());
    await held;
    await route.fulfill({
      json: { status: 'mocked', checkoutId: 'local-browser-test' }
    });
  });
  await page.goto('/fonds-des-batisseurs');
  await page.getByRole('button', { name: /Commandite d'entreprise/i }).click();
  await expect(
    contributionForm(page).getByRole('button', { name: /^50\s*\$$/ })
  ).toHaveAttribute('aria-pressed', 'true');
  await acknowledge(page);
  await checkoutButton(page).click();
  await expect(checkoutButton(page)).toBeDisabled();
  // A second form submission must not start another checkout.
  await contributionForm(page).dispatchEvent('submit');
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    amount: 50,
    currency: 'CAD',
    contributionType: 'sponsorship_interest'
  });
  release();
  await expect(contributionForm(page).getByRole('status')).toContainText(
    /Mode local/i
  );
});

test('the personal form follows the server allowlist and rejects arbitrary amounts', async ({
  page
}) => {
  await enableSponsorship(page, [15, 75]);
  await page.goto('/fonds-des-batisseurs');
  await expect(
    contributionForm(page).getByRole('button', { name: /^15\s*\$$/ })
  ).toHaveAttribute('aria-pressed', 'true');
  await acknowledge(page);
  const amount = page.getByLabel('Autre montant', { exact: false });
  await amount.fill('12,34');
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(checkoutButton(page)).toBeDisabled();
  await expect(page.locator('#custom-contribution-help')).toContainText(
    /15.*75/
  );
  await amount.fill('75');
  await expect(checkoutButton(page)).toBeEnabled();
});

test('invalid sponsorship input is preserved and blocked instead of silently changing the amount', async ({
  page
}) => {
  await enableSponsorship(page);
  await page.goto('/fonds-des-batisseurs');
  await page.getByRole('button', { name: /Commandite d'entreprise/i }).click();
  await acknowledge(page);
  const amount = page.locator('#custom-contribution');
  for (const value of ['-50', '1e3', '50.999', '10']) {
    await amount.fill(value);
    await amount.blur();
    await expect(amount).toHaveValue(value);
    await expect(amount).toHaveAttribute('aria-invalid', 'true');
    await expect(checkoutButton(page)).toBeDisabled();
  }
  await amount.fill('50,25');
  await expect(amount).toHaveAttribute('aria-invalid', 'false');
  await expect(checkoutButton(page)).toBeEnabled();
  await page.getByRole('button', { name: /Contribution personnelle/i }).click();
  await expect(checkoutButton(page)).toBeDisabled();
});

test('monthly progress ignores historical contributions and advances at the UTC month boundary', async ({
  page
}) => {
  await page.clock.install({ time: new Date('2026-09-30T23:59:45Z') });
  await page.route('**/api/public/fund-transparency', (route) =>
    route.fulfill({
      json: {
        ...fundedReport,
        total_received: 1162,
        monthly_summary: [
          { month: '2026-08', currency: 'CAD', total_received: 1000 },
          { month: '2026-09', currency: 'CAD', total_received: 135 },
          { month: '2026-10', currency: 'CAD', total_received: 27 }
        ]
      }
    })
  );
  await page.goto('/fonds-des-batisseurs');
  await expect(homeProgress(page)).toContainText('50 %');
  await expect(homeProgress(page)).toContainText(/135\s*\$/);
  await expect(page.locator('[data-og7="home-funding-totals"]')).toContainText(
    /1\s*162\s*\$/
  );
  await page.clock.fastForward(30001);
  await expect(homeProgress(page)).toContainText('10 %');
  await expect(homeProgress(page)).toContainText(/27\s*\$/);
});

test('closing a slow payment lookup prevents overlapping requests and late confirmation', async ({
  page
}) => {
  await page.clock.install();
  let requests = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/reference-lookup', async (route) => {
    requests++;
    await held;
    await route
      .fulfill({ json: { found: true, paymentStatus: 'paid' } })
      .catch(() => {});
  });
  await page.goto(sponsorReturnPath('fr-CA'));
  await expect.poll(() => requests).toBe(1);
  await page.clock.fastForward(5001);
  expect(requests).toBe(1);
  const notice = page.getByRole('region', {
    name: 'Votre paiement est en cours de confirmation.'
  });
  await notice.getByRole('button', { name: /Fermer/i }).click();
  release();
  await page.clock.fastForward(30001);
  await expect(notice).toHaveCount(0);
  await expect(page.getByText('Paiement reçu par Stripe')).toHaveCount(0);
  expect(requests).toBe(1);
  await expect(page).not.toHaveURL(/followup_token|reference|checkout=/);
});

test('payment verification pauses after twelve attempts and can be retried manually', async ({
  page
}) => {
  await page.clock.install();
  let requests = 0;
  let paid = false;
  await page.route('**/api/reference-lookup', (route) => {
    requests++;
    return route.fulfill({
      json: { found: true, paymentStatus: paid ? 'paid' : 'unpaid' }
    });
  });
  await page.goto(sponsorReturnPath('fr-CA'));
  for (let count = 1; count <= 12; count++) {
    await expect.poll(() => requests).toBe(count);
    // Wait for the completed lookup before advancing its next scheduled attempt.
    await expect(
      page.locator('openg7-funding-checkout-notice')
    ).toHaveAttribute('aria-busy', 'false');
    if (count < 12) {
      await page.clock.fastForward(5001);
    }
  }
  const retry = page.getByRole('button', { name: 'Vérifier à nouveau' });
  await expect(retry).toBeVisible();
  await page.clock.fastForward(60001);
  expect(requests).toBe(12);
  paid = true;
  await retry.click();
  await expect(page.getByText('Paiement reçu par Stripe')).toBeVisible();
  expect(requests).toBe(13);
});

test('the support action moves keyboard focus and English amounts use the active locale', async ({
  page
}) => {
  await page.goto('/en/fonds-des-batisseurs');
  await homeProgress(page).getByRole('button').click();
  await expect(page.locator('#support')).toBeFocused();
  await expect(
    contributionForm(page).getByRole('button', { name: 'CA$25', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await expect(
    contributionForm(page).getByRole('button', {
      name: /Personal contribution/i
    })
  ).toBeFocused();
});

test('leaving the page cancels a pending lookup without restarting it', async ({
  page
}) => {
  await page.clock.install();
  let requests = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/reference-lookup', async (route) => {
    requests++;
    await held;
    await route.fulfill({ json: { found: false } }).catch(() => {});
  });
  await page.goto(sponsorReturnPath('fr-CA'));
  await expect.poll(() => requests).toBe(1);
  await page
    .getByRole('link', { name: 'Contacter le support', exact: true })
    .click();
  await expect(page).toHaveURL(/\/support$/);
  release();
  await page.clock.fastForward(30001);
  expect(requests).toBe(1);
  await expect(page.locator('openg7-funding-checkout-notice')).toHaveCount(0);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 1000 }
]) {
  test(`funding form and optimized artwork render at ${viewport.width}px`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await enableSponsorship(page);
    await page.goto('/fonds-des-batisseurs');
    await page
      .getByRole('button', { name: /Commandite d'entreprise/i })
      .click();
    const cards = page.locator('[data-og7="ecosystem-card"]');
    await expect(cards).toHaveCount(13);
    await cards.first().scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        cards
          .first()
          .locator('img')
          .evaluate((image: HTMLImageElement) => image.naturalWidth)
      )
      .toBeGreaterThan(0);
    await expect(cards.first().locator('img')).toHaveAttribute(
      'loading',
      'lazy'
    );
    expect(
      await cards
        .first()
        .locator('img')
        .evaluate((image: HTMLImageElement) => image.currentSrc)
    ).toMatch(/\.webp$/);
    await contributionForm(page).scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await expect(checkoutButton(page)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`funding-home-${viewport.width}.png`),
      fullPage: true
    });
  });
}
