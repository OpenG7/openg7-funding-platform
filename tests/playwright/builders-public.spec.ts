import { expect, test } from './support/test.js';

const rows = Array.from({ length: 31 }, (_, i) => ({
  public_id: `builder-${i}`,
  display_name: 'Même nom',
  contribution_type: 'personal_support',
  amount: i === 0 ? null : 25.01,
  currency: i === 2 ? 'USD' : 'CAD',
  paid_at: null
}));
const response = (page = 1, total = rows.length, source = 'database') => ({
  data_source: source,
  builders: rows.slice((page - 1) * 12, Math.min(page * 12, total)),
  last_updated_at: '2026-09-19T00:00:00Z',
  pagination: { page, page_size: 12, total_count: total }
});
const endpoint = '**/api/public/builders?*';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (r) => r.fulfill({ status: 503, json: {} }));
  await page.route(endpoint, (r) =>
    r.fulfill({
      json: response(
        Number(new URL(r.request().url()).searchParams.get('page'))
      )
    })
  );
});

for (const prefix of ['', '/en']) {
  test(`builders show consented amounts, true totals and localized links ${prefix || 'fr'}`, async ({
    page
  }) => {
    await page.goto(`${prefix}/batisseurs`);
    await expect(page.locator('[data-og7="builder-record"]')).toHaveCount(12);
    await expect(page.locator('[data-og7="builders-total"]')).toHaveText('31');
    await expect(
      page.locator('[data-og7="builder-record"]').first()
    ).toContainText(prefix ? 'Amount hidden' : 'Montant masqué');
    await expect(
      page.locator('[data-og7="builder-record"]').nth(2)
    ).toContainText('USD');
    await expect(
      page.locator(`a[href="${prefix}/commanditaires"]`).last()
    ).toBeVisible();
    await expect(
      page.locator(`a[href="${prefix}/support"]`).last()
    ).toBeVisible();
  });
}

test('all homonyms beyond the historical limit are reachable, with keyboard focus restored', async ({
  page
}) => {
  await page.goto('/batisseurs');
  const ids: string[] = [];
  for (let n = 1; n <= 3; n++) {
    const cards = page.locator('[data-og7="builder-record"]');
    await expect(cards).toHaveCount(n === 3 ? 7 : 12);
    ids.push(
      ...(await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-og7-id')!)
      ))
    );
    if (n < 3) {
      await page.locator('[data-og7="builders-next"]').click();
      await expect(page.locator('#public-builders-title')).toBeFocused();
    }
  }
  expect(new Set(ids).size).toBe(31);
  await expect(page.locator('[data-og7="builders-next"]')).toBeDisabled();
  await page.route(endpoint, (r) => r.fulfill({ json: response(3, 1) }));
  await page.locator('[data-og7="builders-refresh"]').click();
  await expect(
    page.getByRole('button', { name: 'Revenir à la première page' })
  ).toBeVisible();
});

test('loading and failed refresh never present zero or retain withdrawn profiles', async ({
  page
}) => {
  await page.route(endpoint, async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await r.fulfill({ status: 502, json: {} });
  });
  await page.goto('/batisseurs');
  await expect(page.locator('[data-og7="builders-total"]')).toHaveText('—');
  await expect(page.locator('[data-og7="builders-empty"]')).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.route(endpoint, (r) => r.fulfill({ json: response() }));
  await page.locator('[data-og7="builders-retry"]').click();
  await expect(page.locator('[data-og7="builder-record"]')).toHaveCount(12);
  await page.route(endpoint, (r) => r.abort());
  await page.locator('[data-og7="builders-refresh"]').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('[data-og7="builder-record"]')).toHaveCount(0);
});

test('unavailable storage, an empty registry and malformed data remain distinct', async ({
  page
}) => {
  await page.route(endpoint, (r) =>
    r.fulfill({ json: response(1, 0, 'empty') })
  );
  await page.goto('/batisseurs');
  await expect(page.locator('[data-og7="builders-unavailable"]')).toBeVisible();
  await expect(page.locator('[data-og7="builders-total"]')).toHaveText('—');
  await page.route(endpoint, (r) => r.fulfill({ json: response(1, 0) }));
  await page.locator('[data-og7="builders-refresh"]').click();
  await expect(page.locator('[data-og7="builders-empty"]')).toBeVisible();
  await expect(page.locator('[data-og7="builders-total"]')).toHaveText('0');
  await page.route(endpoint, (r) =>
    r.fulfill({ json: { ...response(), builders: [{}] } })
  );
  await page.locator('[data-og7="builders-refresh"]').click();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('a stalled registry request times out and can be retried', async ({
  page
}) => {
  await page.clock.install();
  await page.route(endpoint, () => new Promise<void>(() => {}));
  await page.goto('/batisseurs');
  await expect(page.locator('[data-og7="builders-directory"]')).toHaveAttribute(
    'aria-busy',
    'true'
  );
  await page.clock.fastForward(15001);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.route(endpoint, (r) => r.fulfill({ json: response() }));
  await page.locator('[data-og7="builders-retry"]').click();
  await expect(page.locator('[data-og7="builder-record"]')).toHaveCount(12);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('prerender does not claim an empty registry', async ({ page }) => {
    await page.goto('/batisseurs');
    await expect(page.locator('[data-og7="builders-total"]')).toHaveText('—');
    await expect(page.locator('[data-og7="builders-empty"]')).toHaveCount(0);
    expect(await page.locator('noscript').textContent()).toContain(
      'Activez JavaScript'
    );
  });
});
