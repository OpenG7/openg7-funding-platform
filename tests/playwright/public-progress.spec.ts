import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { FundTransparencyPublicResponse } from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const path = '/fonds-des-batisseurs/realisations';
const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);

const report: FundTransparencyPublicResponse = {
  data_source: 'database',
  total_received: 500,
  total_fees: 10,
  total_net: 490,
  total_refunded: 0,
  total_payouts: 0,
  current_available_estimate: 490,
  contributions_count: 4,
  pending_fee_count: 0,
  currency: 'CAD',
  monthly_summary: [],
  public_builders: [],
  last_updated_at: '2026-10-01T12:00:00.000Z',
  generated_at: '2026-11-21T12:00:00.000Z',
  latest_public_allocations: [
    {
      project_name: 'Projet synthétique prévu',
      public_description: 'Affectation rendue publique pour cette recette.',
      expected_outcome: 'Un outil commun à préparer.',
      amount_allocated: 125,
      currency: 'CAD',
      status: 'published',
      progress_status: 'planned',
      published_at: '2026-11-20T12:00:00.000Z',
      proof_url: null,
      proof_source: null,
      proof_published_at: null
    },
    {
      project_name: 'Livraison synthétique documentée',
      public_description:
        'L’équipe a renseigné son avancement et une référence.',
      expected_outcome: 'Une capacité décrite dans la publication.',
      amount_allocated: 75,
      currency: 'CAD',
      status: 'active',
      progress_status: 'delivered',
      published_at: '2026-11-19T12:00:00.000Z',
      proof_url: 'https://simulation.example.test/preuve-publique',
      proof_source: 'Référence synthétique publiée',
      proof_published_at: '2026-11-20T13:00:00.000Z'
    },
    {
      project_name: 'Livraison synthétique sans référence',
      public_description: 'L’avancement déclaré reste distinct de la preuve.',
      expected_outcome: '',
      amount_allocated: 50,
      currency: 'CAD',
      status: 'published',
      progress_status: 'delivered',
      published_at: null,
      proof_url: 'https://synthetic-user@simulation.example.test/private-link',
      proof_source: 'REFERENCE-TO-OMIT',
      proof_published_at: '2026-11-20T13:00:00.000Z'
    }
  ]
};

async function interceptPublicReads(
  page: Page,
  response: () => unknown = () => report
) {
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET')
      writes.push(request.method() + ' ' + request.url());
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/public/fund-transparency'))
      await route.fulfill({ json: response() });
    else if (pathname.endsWith('/public/funding-config'))
      await route.fulfill({ json: { business_sponsorship_enabled: true } });
    else await route.fulfill({ status: 503, json: {} });
  });
  return writes;
}

for (const language of ['fr-CA', 'en'] as const) {
  const prefix = language === 'en' ? '/en' : '';
  test(`home connects collective ambition to published progress without changing contribution choices ${language}`, async ({
    page,
    request
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const writes = await interceptPublicReads(page);
    const home = prefix + '/fonds-des-batisseurs';
    await page.goto(home);
    const vision = hook(page, 'home-collective-vision');
    await expect(vision.getByRole('heading', { level: 2 })).toBeVisible();
    await expect(vision).not.toContainText('funding.home.collectiveVision');
    const progressLink = hook(page, 'home-public-progress');
    await expect(progressLink).toHaveCount(1);
    await expect(progressLink).toHaveAttribute('href', prefix + path);
    await expect(progressLink).toHaveAccessibleName(
      language === 'en'
        ? 'View published progress'
        : 'Voir les avancées publiées'
    );
    const accessibility = await new AxeBuilder({ page })
      .include('[data-og7="home-collective-vision"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations.map((item) => item.id)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await vision.screenshot({
      path: info.outputPath('home-collective-' + language + '.png')
    });
    await hook(page, 'home-vision-support').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#support')).toBeFocused();
    await expect(page.locator('#support')).toBeInViewport();
    await expect(
      hook(page, 'contribution-form').locator('input[type="checkbox"]:checked')
    ).toHaveCount(0);
    await progressLink.click();
    await expect(page).toHaveURL(new RegExp(prefix + path + '$'));
    await expect(hook(page, 'progress-allocation')).toHaveCount(3);
    const prerendered = await request.get(home);
    expect(prerendered.status()).toBe(200);
    expect(await prerendered.text()).toContain('home-collective-vision');
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });

  test(`public progress preserves declared facts, safe evidence, language and accessibility ${language}`, async ({
    page
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const writes = await interceptPublicReads(page, () => ({
      ...report,
      private_notes: 'PRIVATE-FINANCIAL-NOTES',
      latest_public_allocations: report.latest_public_allocations.map(
        (row) => ({
          ...row,
          private_contact: 'private@simulation.example.test'
        })
      )
    }));
    await page.goto(prefix + path);
    await expect(hook(page, 'progress-allocation')).toHaveCount(3);
    await expect(hook(page, 'progress-title')).toBeVisible();
    await expect(hook(page, 'public-progress-nav')).toHaveAttribute(
      'aria-current',
      'page'
    );
    await expect(hook(page, 'progress-allocation').nth(0)).toContainText(
      'Projet synthétique prévu'
    );
    await expect(hook(page, 'progress-allocation').nth(1)).toContainText(
      'Livraison synthétique documentée'
    );
    await expect(hook(page, 'progress-allocation').nth(2)).toContainText(
      'Livraison synthétique sans référence'
    );
    await expect(hook(page, 'progress-allocation').nth(0)).toContainText(
      /125[,.]00/
    );
    await expect(hook(page, 'progress-proof')).toHaveCount(1);
    await expect(hook(page, 'progress-proof')).toHaveAttribute(
      'href',
      report.latest_public_allocations[1]!.proof_url!
    );
    await expect(hook(page, 'progress-proof')).toHaveAttribute(
      'target',
      '_blank'
    );
    await expect(hook(page, 'progress-proof')).toHaveAttribute(
      'rel',
      /noopener/
    );
    await expect(hook(page, 'progress-proof')).toHaveAttribute(
      'rel',
      /noreferrer/
    );
    await expect(hook(page, 'progress-allocation').nth(2)).toContainText(
      language === 'en' ? /evidence|reference/i : /preuve|référence/i
    );
    await expect(page.locator('main')).not.toContainText('REFERENCE-TO-OMIT');
    await expect(page.locator('body')).not.toContainText(
      'PRIVATE-FINANCIAL-NOTES'
    );
    await expect(page.locator('body')).not.toContainText(
      'private@simulation.example.test'
    );
    await expect(page.locator('a[href*="synthetic-user"]')).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://openg7.org' + prefix + path
    );
    await expect(page.locator('link[hreflang="en"]')).toHaveAttribute(
      'href',
      'https://openg7.org/en' + path
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page })
      .include('main')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      accessibility.violations.map((item) => ({
        id: item.id,
        targets: item.nodes.map((node) => node.target)
      }))
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath('public-progress-' + language + '.png'),
      fullPage: true
    });
    await expect(hook(page, 'progress-personal-support')).toHaveAttribute(
      'href',
      prefix + '/fonds-des-batisseurs#support'
    );
    await expect(hook(page, 'progress-company-support')).toHaveAttribute(
      'href',
      prefix + '/fonds-des-batisseurs?intent=sponsorship#support'
    );
    await hook(page, 'progress-explore').click();
    await expect(page).toHaveURL(
      new RegExp(prefix + path + '#progress-publications$')
    );
    await expect(hook(page, 'progress-publications')).toBeInViewport();
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
}

test('the home ambition remains readable when public data is unavailable', async ({
  page
}) => {
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    if (route.request().method() !== 'GET')
      writes.push(route.request().method());
    await route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/fonds-des-batisseurs');
  await expect(hook(page, 'home-collective-vision')).toBeVisible();
  await hook(page, 'home-vision-support').click();
  await expect(page.locator('#support')).toBeFocused();
  const form = hook(page, 'contribution-form');
  await expect(
    form.getByRole('button', { name: /Commandite d'entreprise/ })
  ).toBeDisabled();
  await expect(form.locator('input[type="checkbox"]:checked')).toHaveCount(0);
  await hook(page, 'home-public-progress').click();
  await expect(page).toHaveURL(new RegExp(path + '$'));
  await expect(hook(page, 'progress-error')).toBeVisible();
  expect(writes).toEqual([]);
});

test('progress is reachable from home and transparency and keeps its canonical path when changing language', async ({
  page
}) => {
  await interceptPublicReads(page);
  await page.goto('/fonds-des-batisseurs');
  await expect(hook(page, 'home-public-progress')).toHaveAttribute(
    'href',
    path
  );
  await hook(page, 'home-public-progress').click();
  await expect(page).toHaveURL(new RegExp(path + '$'));
  await page
    .getByRole('button', { name: 'Switch site language to English' })
    .click();
  await expect(page).toHaveURL(new RegExp('/en' + path + '$'));
  await expect(hook(page, 'public-progress-nav')).toHaveAttribute(
    'aria-current',
    'page'
  );
  await page.goto('/en/fonds-des-batisseurs/transparence');
  await expect(hook(page, 'transparency-public-progress')).toHaveAttribute(
    'href',
    '/en' + path
  );
  await hook(page, 'transparency-public-progress').click();
  await expect(page).toHaveURL(new RegExp('/en' + path + '$'));
});

test('a valid database with no published allocations has an honest empty state', async ({
  page
}) => {
  await interceptPublicReads(page, () => ({
    ...report,
    latest_public_allocations: []
  }));
  await page.goto(path);
  await expect(hook(page, 'progress-empty')).toBeVisible();
  await expect(hook(page, 'progress-unavailable')).toHaveCount(0);
  await expect(hook(page, 'progress-allocation')).toHaveCount(0);
});

for (const source of ['stripe_direct', 'empty']) {
  test(`progress stays unavailable when ${source} supplies no published-project data`, async ({
    page
  }) => {
    await interceptPublicReads(page, () => ({
      ...report,
      data_source: source,
      latest_public_allocations: []
    }));
    await page.goto(path);
    await expect(hook(page, 'progress-unavailable')).toBeVisible();
    await expect(hook(page, 'progress-empty')).toHaveCount(0);
    await expect(hook(page, 'progress-allocation')).toHaveCount(0);
  });
}

test('an unavailable first response remains distinct from empty and can be retried', async ({
  page
}) => {
  let attempts = 0;
  await page.route('**/api/public/fund-transparency', async (route) => {
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, json: {} });
    else await route.fulfill({ json: report });
  });
  await page.goto(path);
  await expect(hook(page, 'progress-error')).toBeVisible();
  await expect(hook(page, 'progress-empty')).toHaveCount(0);
  await hook(page, 'progress-refresh').click();
  await expect(hook(page, 'progress-allocation')).toHaveCount(3);
  await expect(hook(page, 'progress-error')).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('a stalled read times out, prevents concurrent refreshes and supports a keyboard retry', async ({
  page
}) => {
  await page.clock.install();
  let attempts = 0;
  await page.route('**/api/public/fund-transparency', async (route) => {
    attempts++;
    if (attempts > 1) await route.fulfill({ json: report });
  });
  await page.goto(path);
  await expect(hook(page, 'progress-loading')).toBeVisible();
  await expect(hook(page, 'progress-refresh')).toBeDisabled();
  await expect(hook(page, 'progress-empty')).toHaveCount(0);
  await page.clock.runFor(15_001);
  await expect(hook(page, 'progress-error')).toBeVisible();
  await expect(hook(page, 'progress-refresh')).toBeEnabled();
  expect(attempts).toBe(1);
  await hook(page, 'progress-refresh').focus();
  await expect(hook(page, 'progress-refresh')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(hook(page, 'progress-allocation')).toHaveCount(3);
  expect(attempts).toBe(2);
});

test('a failed refresh retains the last published snapshot and marks it stale until recovery', async ({
  page
}) => {
  let fail = false;
  await page.route('**/api/public/fund-transparency', async (route) => {
    if (fail) await route.fulfill({ status: 503, json: {} });
    else await route.fulfill({ json: report });
  });
  await page.goto(path);
  await expect(hook(page, 'progress-allocation')).toHaveCount(3);
  fail = true;
  await hook(page, 'progress-refresh').click();
  await expect(hook(page, 'progress-stale')).toBeVisible();
  await expect(hook(page, 'progress-allocation')).toHaveCount(3);
  fail = false;
  await hook(page, 'progress-refresh').click();
  await expect(hook(page, 'progress-stale')).toHaveCount(0);
  await expect(hook(page, 'progress-allocation')).toHaveCount(3);
});

test('malformed project rows never become an empty or completed portfolio', async ({
  page
}) => {
  await interceptPublicReads(page, () => ({
    ...report,
    latest_public_allocations: [
      { ...report.latest_public_allocations[0], progress_status: 'verified' }
    ]
  }));
  await page.goto(path);
  await expect(hook(page, 'progress-error')).toBeVisible();
  await expect(hook(page, 'progress-empty')).toHaveCount(0);
  await expect(hook(page, 'progress-allocation')).toHaveCount(0);
});

test('French and English direct entries are prerendered without embedding a synthetic allocation', async ({
  request
}) => {
  for (const prefix of ['', '/en']) {
    const response = await request.get(prefix + path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('progress-title');
    expect(html).not.toContain('Projet synthétique prévu');
    expect(html).not.toContain('funding.collectiveProgressPage');
  }
});
