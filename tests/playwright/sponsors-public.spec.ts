import type { Page } from '@playwright/test';

import {
  sponsorProfile,
  sponsorsResponse
} from '../fixtures/public-sponsors.mjs';

import { expect, test } from './support/test.js';

const profiles = [sponsorProfile(), sponsorProfile(1)];
const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);
const endpoint = '**/api/public/sponsorships?*';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/public/sponsorships') {
      await route.fulfill({
        json: sponsorsResponse(
          profiles,
          Number(url.searchParams.get('page')),
          Number(url.searchParams.get('pageSize'))
        )
      });
    } else if (/\/public\/sponsor-(media|logos)\//.test(url.pathname)) {
      await route.fulfill({
        path: 'apps/funding-web/src/assets/openg7-social-communautes-connectees-canada-miniature-480.webp',
        contentType: 'image/webp'
      });
    } else if (url.pathname.endsWith('/public/funding-config')) {
      await route.fulfill({
        json: {
          business_sponsorship_enabled: true,
          allowed_contribution_amounts: [5, 10, 25, 50]
        }
      });
    } else if (
      url.pathname.endsWith('/public/sponsorship-batches/availability')
    ) {
      await route.fulfill({
        json: { data_source: 'empty', availability: [], slots: [] }
      });
    } else await route.fulfill({ status: 503, json: {} });
  });
});

for (const prefix of ['', '/en']) {
  test(`public cards, localized links and responsive layout ${prefix || 'fr'}`, async ({
    page
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /NG\d+/.test(message.text()))
        errors.push(message.text());
    });
    await page.goto(`${prefix}/commanditaires`);
    await expect(hook(page, 'sponsor-card')).toHaveCount(2);
    await expect(hook(page, 'sponsors-total')).toHaveText('2');
    await expect(hook(page, 'sponsors-published')).toHaveText('1');
    await expect(hook(page, 'sponsor-card').first()).toContainText(
      prefix ? 'Amount not published' : 'Montant non publié'
    );
    await expect(hook(page, 'sponsor-card').nth(1)).toContainText('CAD');
    await expect(hook(page, 'sponsors-become')).toHaveAttribute(
      'href',
      `${prefix}/fonds-des-batisseurs?intent=sponsorship#support`
    );
    await expect(hook(page, 'sponsors-followup')).toHaveAttribute(
      'href',
      `${prefix}/fonds-des-batisseurs/suivi-commandite`
    );
    for (const path of [
      '/fonds-des-batisseurs/transparence',
      '/batisseurs',
      '/support',
      '/politique-utilisation-remboursement'
    ]) {
      await expect(
        page.locator(`a[href="${prefix}${path}"]`).last()
      ).toBeVisible();
    }
    await expect(
      page.getByRole('link', {
        name: /Site web — Atelier 1|Website — Atelier 1/
      })
    ).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth
      )
    ).toBeLessThanOrEqual(2);
    await hook(page, 'sponsors-become').focus();
    await page.keyboard.press('Tab');
    await expect(hook(page, 'sponsors-followup')).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath('sponsors.png'),
      fullPage: true
    });
    expect(errors).toEqual([]);
  });
}

test('loading and a failed read keep counts unknown; retry recovers', async ({
  page
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(endpoint, async (route) => {
    await gate;
    await route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/commanditaires');
  await expect(hook(page, 'sponsors-total')).toHaveText('—');
  await expect(
    page.getByRole('status').filter({ hasText: /Chargement/ })
  ).toBeVisible();
  await expect(
    page.getByText('Aucun commanditaire public pour le moment')
  ).toHaveCount(0);
  release();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(hook(page, 'sponsors-total')).toHaveText('—');
  await page.unroute(endpoint);
  await hook(page, 'sponsors-retry').click();
  await expect(hook(page, 'sponsor-card')).toHaveCount(2);
});

test('unavailable source and confirmed empty directory are distinct', async ({
  page
}) => {
  await page.route(endpoint, (route) =>
    route.fulfill({
      json: {
        data_source: 'empty',
        sponsorships: [],
        last_updated_at: '2026-09-01T00:00:00Z'
      }
    })
  );
  await page.goto('/commanditaires');
  await expect(page.getByRole('status')).toContainText('Cela ne signifie pas');
  await expect(hook(page, 'sponsors-total')).toHaveText('—');
  await page.route(endpoint, (route) =>
    route.fulfill({ json: sponsorsResponse([]) })
  );
  await hook(page, 'sponsors-refresh').click();
  await expect(hook(page, 'sponsors-total')).toHaveText('0');
  await expect(
    page.getByRole('heading', {
      name: 'Aucun commanditaire public pour le moment'
    })
  ).toBeVisible();
});

test('timeout can be retried and leaving the route aborts the request', async ({
  page
}) => {
  await page.clock.install();
  await page.route(endpoint, () => new Promise<void>(() => {}));
  await page.goto('/commanditaires');
  await page.clock.fastForward(15_001);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute(endpoint);
  await hook(page, 'sponsors-retry').click();
  await expect(hook(page, 'sponsor-card')).toHaveCount(2);
  let aborted = false;
  page.on('requestfailed', (request) => {
    if (request.url().includes('/public/sponsorships')) aborted = true;
  });
  await page.route(endpoint, () => new Promise<void>(() => {}));
  await hook(page, 'sponsors-refresh').click();
  await hook(page, 'sponsors-become').click();
  await expect(page).toHaveURL(/fonds-des-batisseurs\?intent=sponsorship/);
  await expect.poll(() => aborted).toBe(true);
});

test('a refresh failure removes previously visible profiles until recovery', async ({
  page
}) => {
  await page.goto('/commanditaires');
  await expect(hook(page, 'sponsor-card')).toHaveCount(2);
  await page.route(endpoint, (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await hook(page, 'sponsors-refresh').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(hook(page, 'sponsor-card')).toHaveCount(0);
  await expect(hook(page, 'sponsors-total')).toHaveText('—');
  await page.route(endpoint, (route) =>
    route.fulfill({ json: sponsorsResponse([]) })
  );
  await hook(page, 'sponsors-retry').click();
  await expect(hook(page, 'sponsors-total')).toHaveText('0');
});

test('57 profiles and duplicate company names remain reachable, with focus after pagination', async ({
  page
}) => {
  const many = Array.from({ length: 57 }, (_, i) =>
    sponsorProfile(i, { company_name: 'Même entreprise' })
  );
  await page.route(endpoint, (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: sponsorsResponse(many, Number(url.searchParams.get('page')))
    });
  });
  await page.goto('/commanditaires');
  await expect(hook(page, 'sponsors-total')).toHaveText('57');
  await expect(hook(page, 'sponsor-card')).toHaveCount(12);
  const ids = new Set<string>();
  for (let n = 1; n <= 5; n++) {
    for (const id of await hook(page, 'sponsor-card').evaluateAll((cards) =>
      cards.map((card) => card.getAttribute('data-og7-id')!)
    ))
      ids.add(id);
    if (n < 5) {
      await hook(page, 'sponsors-next').click();
      await expect(
        page.getByText(`Page ${n + 1} sur 5`, { exact: true })
      ).toBeVisible();
      await expect(page.locator('#sponsors-list-title')).toBeFocused();
    }
  }
  expect(ids.size).toBe(57);
  await expect(hook(page, 'sponsors-next')).toBeDisabled();
  await hook(page, 'sponsors-previous').click();
  await expect(page.getByText('Page 4 sur 5', { exact: true })).toBeVisible();
});

test('a directory shrinking during pagination offers a return to page one', async ({
  page
}) => {
  await page.route(endpoint, (route) => {
    const requested = Number(
      new URL(route.request().url()).searchParams.get('page')
    );
    return route.fulfill({
      json:
        requested === 1
          ? sponsorsResponse(
              Array.from({ length: 13 }, (_, i) => sponsorProfile(i))
            )
          : sponsorsResponse([], requested)
    });
  });
  await page.goto('/commanditaires');
  await hook(page, 'sponsors-next').click();
  await expect(page.getByText(/Cette page ne contient plus/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Revenir à la première page' })
    .click();
  await expect(hook(page, 'sponsor-card')).toHaveCount(12);
});

test('draft links and workflow badges stay out of the public cards', async ({
  page
}) => {
  await page.goto('/commanditaires');
  const cards = hook(page, 'sponsor-card');
  await expect(cards.first()).not.toContainText(
    /Brouillon|Planifié|Non planifié/
  );
  await expect(
    cards.first().getByRole('link', { name: /publication/ })
  ).toHaveCount(0);
  await expect(
    cards.nth(1).getByRole('link', { name: /Voir la publication/ })
  ).toHaveAttribute('href', 'https://example.com/partner-post');
});

test('failed media have a fallback and unsafe external links are omitted', async ({
  page
}) => {
  await page.route('**/api/public/sponsor-*/*', (route) =>
    route.fulfill({ status: 404, body: '' })
  );
  await page.route(endpoint, (route) =>
    route.fulfill({
      json: sponsorsResponse([
        sponsorProfile(0, { website_url: 'javascript:alert(1)' })
      ])
    })
  );
  await page.goto('/commanditaires');
  const card = hook(page, 'sponsor-card');
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('img')).toHaveCount(0);
  await expect(card).toContainText('A1');
  await expect(card.getByRole('link')).toHaveCount(0);
});

test('legacy responses remain usable and malformed responses never show invented totals', async ({
  page
}) => {
  const legacy = { ...sponsorsResponse(profiles), pagination: undefined };
  await page.route(endpoint, (route) => route.fulfill({ json: legacy }));
  await page.goto('/commanditaires');
  await expect(hook(page, 'sponsor-card')).toHaveCount(2);
  await expect(hook(page, 'sponsors-total')).toHaveText('—');
  await expect(
    page.getByText(/Le total de l’annuaire n’est pas disponible/)
  ).toBeVisible();
  await page.route(endpoint, (route) =>
    route.fulfill({ json: { ...legacy, sponsorships: [{}] } })
  );
  await hook(page, 'sponsors-refresh').click();
  await expect(page.getByRole('alert')).toBeVisible();
});

for (const prefix of ['', '/en']) {
  test(`sponsor intent selects the enabled form type without granting consent ${prefix || 'fr'}`, async ({
    page
  }) => {
    await page.goto(`${prefix}/commanditaires`);
    await hook(page, 'sponsors-become').click();
    const form = hook(page, 'contribution-form');
    await expect(
      form.getByRole('button', {
        name: prefix ? /Business sponsorship/ : /Commandite d'entreprise/
      })
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      form.getByRole('button', {
        name: prefix ? 'Support OpenG7' : 'Soutenir OpenG7',
        exact: true
      })
    ).toBeDisabled();
    for (const checkbox of await form.getByRole('checkbox').all())
      await expect(checkbox).not.toBeChecked();
  });
}

test('disabled sponsorship cannot be enabled through the public intent', async ({
  page
}) => {
  await page.route('**/api/public/funding-config', (route) =>
    route.fulfill({ json: { business_sponsorship_enabled: false } })
  );
  await page.goto('/fonds-des-batisseurs?intent=sponsorship#support');
  const choice = hook(page, 'contribution-form').getByRole('button', {
    name: /Commandite d'entreprise/
  });
  await expect(choice).toBeDisabled();
  await expect(choice).toHaveAttribute('aria-pressed', 'false');
});

test('a deliberate personal selection survives a delayed sponsorship configuration', async ({
  page
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/public/funding-config', async (route) => {
    await gate;
    await route.fulfill({ json: { business_sponsorship_enabled: true } });
  });
  await page.goto('/fonds-des-batisseurs?intent=sponsorship#support');
  const form = hook(page, 'contribution-form');
  await form.getByRole('button', { name: /Contribution personnelle/ }).click();
  release();
  const business = form.getByRole('button', {
    name: /Commandite d'entreprise/
  });
  await expect(business).toBeEnabled();
  await expect(business).toHaveAttribute('aria-pressed', 'false');
});

for (const prefix of ['', '/en']) {
  test(`find sponsorship opens recovery without an invalid-link error ${prefix || 'fr'}`, async ({
    page
  }) => {
    await page.goto(`${prefix}/commanditaires`);
    await hook(page, 'sponsors-followup').click();
    await expect(hook(page, 'followup-recovery')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page).not.toHaveURL(/token=/);
    await page.goto(
      `${prefix}/fonds-des-batisseurs/suivi-commandite?token=invalid`
    );
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(hook(page, 'followup-recovery')).toBeVisible();
  });
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('prerender keeps counts unknown and never asserts that no sponsors exist', async ({
    page
  }) => {
    await page.goto('/commanditaires');
    await expect(hook(page, 'sponsors-total')).toHaveText('—');
    await expect(
      page.getByText('Aucun commanditaire public pour le moment')
    ).toHaveCount(0);
    // Playwright text selectors intentionally skip noscript nodes.
    expect(await page.locator('noscript').textContent()).toContain(
      'Activez JavaScript'
    );
    await expect(page.locator('noscript')).toBeVisible();
    await expect(hook(page, 'sponsors-become')).toHaveAttribute(
      'href',
      /intent=sponsorship/
    );
  });
});
