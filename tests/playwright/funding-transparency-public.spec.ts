import type { Download, Page } from '@playwright/test';

import { expect, test } from './support/test.js';

const report = {
  data_source: 'database',
  total_received: 2135,
  total_fees: 62.5,
  total_net: 2072.5,
  total_refunded: 10,
  total_payouts: 50,
  current_available_estimate: 2062.5,
  contributions_count: 12,
  currency: 'CAD',
  monthly_summary: [
    {
      month: '2026-09',
      total_received: 135,
      total_fees: 2.5,
      total_net: 132.5,
      total_refunded: 10,
      total_payouts: 0,
      contributions_count: 2,
      currency: 'CAD'
    },
    {
      month: '2026-08',
      total_received: 2000,
      total_fees: 60,
      total_net: 1940,
      total_refunded: 0,
      total_payouts: 50,
      contributions_count: 10,
      currency: 'CAD'
    }
  ],
  latest_public_allocations: [
    {
      project_name: 'Passerelle de services ouverts',
      public_description: 'Une interface publique pour relier les services.',
      expected_outcome: 'Suivre les demandes en ligne.',
      progress_status: 'in_progress',
      proof_url: 'https://openg7.org/preuve-passerelle',
      proof_source: 'Démonstration publique',
      proof_published_at: '2026-09-11T12:00:00.000Z',
      amount_allocated: 125,
      currency: 'CAD',
      status: 'published',
      published_at: '2026-09-10T12:00:00.000Z'
    }
  ],
  public_builders: [],
  last_updated_at: '2026-09-18T10:00:00.000Z',
  notes_admin: 'private-notes-must-never-be-exported'
};
const emptyReport = {
  ...report,
  total_received: 0,
  total_fees: 0,
  total_net: 0,
  total_refunded: 0,
  total_payouts: 0,
  current_available_estimate: 0,
  contributions_count: 0,
  monthly_summary: [],
  latest_public_allocations: []
};
const path = '/fonds-des-batisseurs/transparence';
const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);

async function contents(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-19T12:00:00.000Z') });
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/public/fund-transparency'))
      await route.fulfill({ json: report });
    else if (pathname.endsWith('/public/funding-config'))
      await route.fulfill({ json: { business_sponsorship_enabled: false } });
    else await route.fulfill({ status: 503, json: {} });
  });
});

for (const locale of [
  {
    prefix: '',
    heading: 'Bâtisseurs',
    registry: 'Voir le registre',
    refunds: 'Remboursements',
    month: '135,00',
    progress: 'En cours',
    contribute: 'Soutenir OpenG7'
  },
  {
    prefix: '/en',
    heading: 'Builders',
    registry: 'View registry',
    refunds: 'Refunds',
    month: '135.00',
    progress: 'In progress',
    contribute: 'Support OpenG7'
  }
]) {
  test(`monthly goal, published evidence, keyboard and navigation ${locale.prefix || 'fr'}`, async ({
    page
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(locale.prefix + path);
    await expect(page.locator('#transparency-title')).toContainText(
      locale.heading
    );
    await expect(hook(page, 'transparency-json')).toBeEnabled();
    await expect(page.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '50'
    );
    await expect(hook(page, 'monthly-received')).toContainText(locale.month);
    await expect(hook(page, 'transparency-campaign')).toContainText(
      /270[,.]00/
    );
    await expect(hook(page, 'transparency-totals')).toContainText(
      /2[\s,]?135[,.]00/
    );
    await expect(hook(page, 'published-allocations')).toContainText(
      locale.progress
    );
    await expect(
      page.getByRole('link', { name: /Démonstration publique/ })
    ).toHaveAttribute('href', 'https://openg7.org/preuve-passerelle');
    const registry = page.getByRole('button', {
      name: locale.registry,
      exact: true
    });
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      if (await registry.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(registry).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#public-registry')).toBeFocused();
    const refunds = page
      .locator('#public-registry')
      .getByRole('button', { name: locale.refunds, exact: true });
    await refunds.click();
    await expect(refunds).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody')).toContainText(/10[,.]00/);
    const support = page
      .locator('#support')
      .getByRole('link', { name: locale.contribute, exact: true });
    await expect(support).toHaveAttribute(
      'href',
      locale.prefix + '/fonds-des-batisseurs#support'
    );
    await expect(
      page.locator('a[href="' + locale.prefix + '/ecosystem#platforms"]')
    ).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await expect(page.locator('main')).not.toContainText(
      /funding\.transparencyPage\.|private-notes/
    );
    expect(errors).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath('transparency.png'),
      fullPage: true
    });
    await support.click();
    await expect(page).toHaveURL(
      new RegExp(locale.prefix + '/fonds-des-batisseurs#support$')
    );
    await expect(page.locator('#support')).toBeVisible();
    // The home page consumes the same monthly contribution and campaign goal.
    await expect(hook(page, 'home-funding-progress')).toContainText(/50\s*%/);
  });
}

test('exports selected month with currency and timestamps, without cumulative totals or private fields', async ({
  page
}) => {
  await page.goto(path);
  await expect(hook(page, 'transparency-json')).toBeEnabled();
  await hook(page, 'transparency-period').selectOption('2026-09');
  const jsonEvent = page.waitForEvent('download');
  await hook(page, 'transparency-json').click();
  const jsonDownload = await jsonEvent;
  expect(jsonDownload.suggestedFilename()).toBe(
    'openg7-transparence-fonds-batisseurs-2026-09.json'
  );
  const json = JSON.parse(await contents(jsonDownload));
  expect(json).toMatchObject({
    scope: 'month',
    period: '2026-09',
    currency: 'CAD',
    data_source: 'database',
    last_updated_at: report.last_updated_at
  });
  expect(json.total_received).toBeUndefined();
  expect(json.monthly_summary).toHaveLength(1);
  expect(json.monthly_summary[0].total_received).toBe(135);
  expect(JSON.stringify(json)).not.toContain('private-notes');
  const csvEvent = page.waitForEvent('download');
  await hook(page, 'transparency-csv').click();
  const csv = await contents(await csvEvent);
  expect(csv).toContain(
    'month,currency,total_received,total_fees,total_net,total_refunded'
  );
  expect(csv).toContain('2026-09,CAD,135,2.5,132.5,10');
  expect(csv).not.toContain('2026-08');
  await hook(page, 'transparency-period').selectOption('all');
  const allEvent = page.waitForEvent('download');
  await hook(page, 'transparency-json').click();
  const all = JSON.parse(await contents(await allEvent));
  expect(all.total_received).toBe(2135);
  expect(all.monthly_summary).toHaveLength(2);
});

test('loading and first-load failure show unknown amounts and allow a successful retry', async ({
  page
}) => {
  await page.route('**/public/fund-transparency', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({ status: 502, json: {} });
  });
  await page.goto(path);
  await expect(hook(page, 'transparency-totals').locator('strong')).toHaveText([
    '—',
    '—',
    '—',
    '—'
  ]);
  await expect(hook(page, 'transparency-json')).toBeDisabled();
  await expect(hook(page, 'transparency-status')).toContainText(
    'Impossible de charger'
  );
  await expect(hook(page, 'snapshot-date')).toHaveText('—');
  await page.route('**/public/fund-transparency', (route) =>
    route.fulfill({ json: report })
  );
  await hook(page, 'transparency-refresh').click();
  await expect(hook(page, 'transparency-json')).toBeEnabled();
  await expect(page.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '50'
  );
});

test('periodic refresh keeps a stale snapshot visible and disables exports until recovery', async ({
  page
}) => {
  let requests = 0;
  await page.route('**/public/fund-transparency', (route) => {
    requests++;
    return requests === 2
      ? route.fulfill({ status: 502, json: {} })
      : route.fulfill({ json: report });
  });
  await page.goto(path);
  await expect(hook(page, 'transparency-json')).toBeEnabled();
  const snapshot = await hook(page, 'snapshot-date').textContent();
  const checked = await hook(page, 'checked-date').textContent();
  await page.clock.fastForward(60_000);
  await expect(hook(page, 'transparency-status')).toContainText(
    'Actualisation impossible'
  );
  await expect(hook(page, 'transparency-totals')).toContainText(
    /2[\s,]?135,00/
  );
  await expect(hook(page, 'snapshot-date')).toHaveText(snapshot!);
  await expect(hook(page, 'checked-date')).toHaveText(checked!);
  await expect(hook(page, 'transparency-csv')).toBeDisabled();
  await hook(page, 'transparency-refresh').click();
  await expect(hook(page, 'transparency-json')).toBeEnabled();
  expect(requests).toBe(3);
  await expect(hook(page, 'checked-date')).not.toHaveText(checked!);
});

test('a timeout can be retried and navigation stops polling', async ({
  page
}) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/public/fund-transparency', async (route) => {
    await pending;
    await route.fulfill({ json: report }).catch(() => {});
  });
  await page.goto(path);
  await page.clock.fastForward(15_001);
  await expect(hook(page, 'transparency-status')).toContainText(
    'Impossible de charger'
  );
  release();
  await page.unroute('**/public/fund-transparency');
  await hook(page, 'transparency-refresh').click();
  await expect(hook(page, 'transparency-json')).toBeEnabled();
  await page.locator('footer a[href="/fonds-des-batisseurs/a-propos"]').click();
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/public/fund-transparency')) requests++;
  });
  await page.clock.fastForward(120_000);
  expect(requests).toBe(0);
});

test('unconfigured source and valid zero activity are different states', async ({
  page
}) => {
  await page.route('**/public/fund-transparency', (route) =>
    route.fulfill({ json: { ...emptyReport, data_source: 'empty' } })
  );
  await page.goto(path);
  await expect(hook(page, 'transparency-status')).toContainText(
    'Aucune source financière'
  );
  await expect(hook(page, 'transparency-totals').locator('strong')).toHaveText([
    '—',
    '—',
    '—',
    '—'
  ]);
  await expect(hook(page, 'transparency-json')).toBeDisabled();
  await page.route('**/public/fund-transparency', (route) =>
    route.fulfill({ json: emptyReport })
  );
  await hook(page, 'transparency-refresh').click();
  await expect(hook(page, 'transparency-json')).toBeEnabled();
  await expect(
    hook(page, 'transparency-totals').locator('strong').first()
  ).toContainText('0,00');
  await expect(page.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '0'
  );
});

test('malformed data is unavailable and copying a link announces failure', async ({
  page
}) => {
  await page.route('**/public/fund-transparency', (route) =>
    route.fulfill({ json: {} })
  );
  await page.goto(path);
  await expect(hook(page, 'transparency-status')).toContainText(
    'Impossible de charger'
  );
  await expect(hook(page, 'transparency-json')).toBeDisabled();
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true
    })
  );
  await page
    .getByRole('button', { name: 'Copier le lien de transparence' })
    .click();
  await expect(page.getByText(/Copie impossible/)).toBeVisible();
});

test('month rollover during an outage keeps new-month progress unknown until recovery', async ({
  page
}) => {
  await page.clock.setFixedTime(new Date('2026-09-30T23:59:59.000Z'));
  await page.goto(path);
  await expect(page.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '50'
  );
  await page.route('**/public/fund-transparency', (route) =>
    route.fulfill({ status: 502, json: {} })
  );
  await page.clock.setFixedTime(new Date('2026-10-01T00:00:01.000Z'));
  await hook(page, 'transparency-refresh').click();
  await expect(hook(page, 'transparency-status')).toContainText(
    'Actualisation impossible'
  );
  await expect(hook(page, 'monthly-received')).toHaveText('—');
  await expect(page.getByRole('progressbar')).not.toHaveAttribute(
    'aria-valuenow'
  );
  await page.route('**/public/fund-transparency', (route) =>
    route.fulfill({ json: report })
  );
  await hook(page, 'transparency-refresh').click();
  await expect(page.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '0'
  );
});

test('a successfully received cached report from last month cannot confirm a new-month zero', async ({
  page
}) => {
  await page.clock.setFixedTime(new Date('2026-10-01T00:00:01.000Z'));
  await page.route('**/public/fund-transparency', (route) =>
    route.fulfill({
      json: { ...report, generated_at: '2026-09-30T23:59:30.000Z' }
    })
  );
  await page.goto(path);
  await expect(hook(page, 'transparency-json')).toBeEnabled();
  await expect(hook(page, 'monthly-received')).toHaveText('—');
  await expect(page.getByRole('progressbar')).not.toHaveAttribute(
    'aria-valuenow'
  );
  await page.route('**/public/fund-transparency', (route) =>
    route.fulfill({
      json: { ...report, generated_at: '2026-10-01T00:00:00.000Z' }
    })
  );
  await hook(page, 'transparency-refresh').click();
  await expect(page.getByRole('progressbar')).toHaveAttribute(
    'aria-valuenow',
    '0'
  );
});

test('pending, complete and unspecified fees are distinct and included in exports', async ({
  page
}) => {
  await page.goto(path);
  await expect(hook(page, 'fee-quality')).toContainText('n’est pas précisée');
  await page.route('**/public/fund-transparency', (route) =>
    route.fulfill({ json: { ...report, pending_fee_count: 2 } })
  );
  await hook(page, 'transparency-refresh').click();
  await expect(hook(page, 'fee-quality')).toContainText('Net provisoire');
  await expect(hook(page, 'fee-quality')).toContainText('2 paiement(s)');
  const downloadEvent = page.waitForEvent('download');
  await hook(page, 'transparency-json').click();
  expect(
    JSON.parse(await contents(await downloadEvent)).pending_fee_count
  ).toBe(2);
  await page.route('**/public/fund-transparency', (route) =>
    route.fulfill({ json: { ...report, pending_fee_count: 0 } })
  );
  await hook(page, 'transparency-refresh').click();
  await expect(hook(page, 'fee-quality')).toContainText('tous les paiements');
});

test('shared period and type survive loading, changes, history and copying in the current language', async ({
  page
}) => {
  await page.goto('/en' + path + '?period=2026-09&type=refunds');
  await expect(hook(page, 'transparency-period')).toHaveValue('2026-09');
  const registry = page.locator('#public-registry');
  const refunds = registry.getByRole('button', {
    name: 'Refunds',
    exact: true
  });
  await expect(refunds).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('10.00');
  await hook(page, 'transparency-period').selectOption('2026-08');
  await expect(page).toHaveURL(/period=2026-08&type=refunds/);
  await expect(registry).toBeInViewport();
  await page.goBack();
  await expect(hook(page, 'transparency-period')).toHaveValue('2026-09');
  await page.goForward();
  await expect(hook(page, 'transparency-period')).toHaveValue('2026-08');
  await registry.getByRole('button', { name: 'Fees', exact: true }).click();
  await expect(page).toHaveURL(/period=2026-08&type=fees/);
  await page.reload();
  await expect(hook(page, 'transparency-period')).toHaveValue('2026-08');
  await expect(
    registry.getByRole('button', { name: 'Fees', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset['copiedLink'] = text;
        }
      },
      configurable: true
    })
  );
  await page.getByRole('button', { name: 'Copy transparency link' }).click();
  const copied = new URL(
    (await page.locator('html').getAttribute('data-copied-link')) ?? ''
  );
  expect(copied.pathname).toBe('/en' + path);
  expect(copied.searchParams.get('period')).toBe('2026-08');
  expect(copied.searchParams.get('type')).toBe('fees');
  await expect(page.getByText('Link copied.', { exact: true })).toBeVisible();
});

test('unavailable or invalid shared periods never silently export all history', async ({
  page
}) => {
  await page.goto(path + '?period=2024-01&type=refunds');
  await expect(hook(page, 'transparency-status')).toContainText(
    'Données reçues'
  );
  await expect(hook(page, 'transparency-period')).toHaveValue('2024-01');
  await expect(
    page.getByText(/Cette période n’est pas disponible/)
  ).toBeVisible();
  await expect(hook(page, 'transparency-json')).toBeDisabled();
  await page.goto(path + '?period=2026-13&type=unknown');
  await expect(hook(page, 'transparency-period')).toHaveValue('all');
  await expect(
    page
      .locator('#public-registry')
      .getByRole('button', { name: 'Tous', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
});

test.describe('SSR without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('renders meaningful content and unknown data without inventing a timestamp', async ({
    page
  }) => {
    await page.goto(path);
    await expect(page.locator('#transparency-title')).toContainText(
      'Bâtisseurs'
    );
    await expect(
      hook(page, 'transparency-totals').locator('strong')
    ).toHaveText(['—', '—', '—', '—']);
    await expect(hook(page, 'snapshot-date')).toHaveText('—');
    await expect(hook(page, 'transparency-json')).toBeDisabled();
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
      'href',
      /fonds-des-batisseurs\/transparence$/
    );
  });
});
