import type { Locator, Page } from '@playwright/test';

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
  last_updated_at: '2026-09-19T12:00:00.000Z'
};

const locales = [
  {
    prefix: '',
    language: 'fr-CA',
    about: 'À propos',
    home: 'Accueil',
    mission: 'Des outils ouverts pour les organisations et les communautés',
    transparency:
      'Les contributions confirmées et les frais sont présentés publiquement sous forme agrégée.',
    understand: 'Comprendre le fonds',
    contribute: 'Contribuer au fonds',
    toggle: 'Switch site language to English',
    alternate: '/en',
    links: [
      ['Explorer les plateformes', '/ecosystem#platforms', '#platforms-title'],
      [
        'Voir le registre public',
        '/fonds-des-batisseurs/transparence',
        '#transparency-title'
      ],
      ['Rencontrer les bâtisseurs', '/batisseurs', '#builders-directory-title'],
      ['Découvrir les commanditaires', '/commanditaires', '#sponsors-title'],
      ['Besoin d’aide ?', '/support', '#support-title'],
      [
        'Politique d’utilisation et de remboursement',
        '/politique-utilisation-remboursement',
        '#policy-title'
      ]
    ]
  },
  {
    prefix: '/en',
    language: 'en',
    about: 'About',
    home: 'Home',
    mission: 'Open tools for organizations and communities',
    transparency:
      'Confirmed contributions and fees are presented publicly in aggregate form.',
    understand: 'Understand the fund',
    contribute: 'Contribute to the fund',
    toggle: 'Changer la langue du site vers le français',
    alternate: '',
    links: [
      ['Explore the platforms', '/ecosystem#platforms', '#platforms-title'],
      [
        'View the public registry',
        '/fonds-des-batisseurs/transparence',
        '#transparency-title'
      ],
      ['Meet the builders', '/batisseurs', '#builders-directory-title'],
      ['Discover the sponsors', '/commanditaires', '#sponsors-title'],
      ['Need help?', '/support', '#support-title'],
      [
        'Usage and refund policy',
        '/politique-utilisation-remboursement',
        '#policy-title'
      ]
    ]
  }
] as const;

test.beforeEach(async ({ page }) => {
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

async function tabTo(page: Page, link: Locator) {
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.keyboard.press('Tab');
    if (await link.evaluate((element) => element === document.activeElement)) {
      break;
    }
  }
  await expect(link).toBeFocused();
}

for (const locale of locales) {
  const aboutPath = `${locale.prefix}/fonds-des-batisseurs/a-propos`;

  test(`about content, artwork and layout (${locale.language})`, async ({
    page
  }, testInfo) => {
    const errors: string[] = [];
    const apiRequests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/'))
        apiRequests.push(request.url());
    });
    await page.goto(aboutPath);
    await expect(page.locator('html')).toHaveAttribute('lang', locale.language);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'OpenG7'
    );
    await expect(
      page.getByRole('heading', { name: locale.mission })
    ).toBeVisible();
    await expect(
      page.getByText(locale.transparency, { exact: true })
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText('funding.aboutPage.');
    await expect(
      page
        .locator('openg7-funding-header')
        .getByRole('link', { name: locale.about, exact: true })
    ).toHaveAttribute('aria-current', 'page');

    const image = page.locator('[data-og7="about-hero-image"]');
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => element.naturalWidth)
      )
      .toBeGreaterThan(0);
    expect(
      await image.evaluate((element: HTMLImageElement) => element.currentSrc)
    ).toMatch(/-(960|1672)\.webp$/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    expect(apiRequests).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`about-${locale.language}.png`),
      fullPage: true
    });
  });

  test(`about links reach their public destinations (${locale.language})`, async ({
    page
  }) => {
    for (const [name, destination, heading] of locale.links) {
      await page.goto(aboutPath);
      const link = page.getByRole('link', { name, exact: true });
      await expect(link).toHaveAttribute('href', locale.prefix + destination);
      await link.click();
      await expect(page).toHaveURL(
        new URL(locale.prefix + destination, page.url()).href
      );
      await expect(page.locator(heading)).toBeInViewport();
    }
  });

  test(`about actions reach the fund sections by keyboard (${locale.language})`, async ({
    page
  }) => {
    await page.goto(aboutPath);
    const understand = page.getByRole('link', {
      name: locale.understand,
      exact: true
    });
    await tabTo(page, understand);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      new URL(
        `${locale.prefix}/fonds-des-batisseurs#funding-purpose`,
        page.url()
      ).href
    );
    await expect(page.locator('#funding-purpose-title')).toBeInViewport();
    await expect(
      page
        .locator('openg7-funding-header')
        .getByRole('link', { name: locale.home, exact: true })
    ).toHaveAttribute('aria-current', 'page');

    await page.goto(aboutPath);
    const contribute = page.getByRole('link', {
      name: locale.contribute,
      exact: true
    });
    await tabTo(page, contribute);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      new URL(`${locale.prefix}/fonds-des-batisseurs#support`, page.url()).href
    );
    await expect(
      page.locator('[data-og7="contribution-form"]')
    ).toBeInViewport();
    await expect(page.locator('#support')).toBeFocused();
  });

  test(`switching languages keeps the about page and its destinations (${locale.language})`, async ({
    page
  }) => {
    await page.goto(aboutPath);
    await page.getByRole('button', { name: locale.toggle }).click();
    await expect(page).toHaveURL(
      new URL(`${locale.alternate}/fonds-des-batisseurs/a-propos`, page.url())
        .href
    );
    const nextLocale = locales.find(
      (candidate) => candidate.prefix === locale.alternate
    )!;
    await expect(
      page.getByRole('heading', { name: nextLocale.mission })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: nextLocale.contribute, exact: true })
    ).toHaveAttribute(
      'href',
      `${locale.alternate}/fonds-des-batisseurs#support`
    );
  });
}

test.describe('prerendered about page', () => {
  test.use({ javaScriptEnabled: false });

  for (const locale of locales) {
    test(`content and links are available without JavaScript (${locale.language})`, async ({
      page
    }) => {
      const path = `${locale.prefix}/fonds-des-batisseurs/a-propos`;
      await page.goto(path);
      await expect(
        page.getByRole('heading', { name: locale.mission })
      ).toBeVisible();
      await expect(
        page.getByText(locale.transparency, { exact: true })
      ).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        `https://openg7.org${path}`
      );
      await expect(page.locator('link[hreflang="en"]')).toHaveAttribute(
        'href',
        'https://openg7.org/en/fonds-des-batisseurs/a-propos'
      );
      await expect(page.locator('link[hreflang="fr-CA"]')).toHaveAttribute(
        'href',
        'https://openg7.org/fonds-des-batisseurs/a-propos'
      );
      const contribute = page.getByRole('link', {
        name: locale.contribute,
        exact: true
      });
      await expect(contribute).toHaveAttribute(
        'href',
        `${locale.prefix}/fonds-des-batisseurs#support`
      );
      await contribute.click();
      await expect(
        page.locator('[data-og7="contribution-form"]')
      ).toBeInViewport();
    });
  }
});
