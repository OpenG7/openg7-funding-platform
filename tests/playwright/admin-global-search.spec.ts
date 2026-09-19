import type { Page } from '@playwright/test';
import type {
  AdminSearchGroup,
  AdminSearchResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const id = '10000000-0000-4000-8000-000000000601';
const nextId = '10000000-0000-4000-8000-000000000602';
const draftId = '10000000-0000-4000-8000-000000000603';
const nextDraftId = '10000000-0000-4000-8000-000000000604';
const group = (value = id): AdminSearchGroup => ({
  contributionId: value,
  title: value === id ? 'Atelier Boréal' : 'Atelier Rivage',
  reference: value === id ? 'OG7-601' : 'OG7-602',
  amountMinor: 10050,
  currency: 'CAD',
  sponsorship: true,
  invoice: { id: value, number: value === id ? 'FAC-601' : 'FAC-602' },
  publications: [
    {
      id: value === id ? draftId : nextDraftId,
      target: 'openg7',
      channel: 'facebook'
    }
  ]
});
const response = (
  groups = [group()],
  page = 1,
  total = groups.length
): AdminSearchResponse => ({
  available: true,
  missingSources: [],
  groups,
  total,
  page,
  pageSize: 10
});
const dialog = (page: Page) => page.getByRole('dialog');
const input = (page: Page) => dialog(page).getByRole('searchbox');

async function fixtures(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.search-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/admin/search'))
      return route.fulfill({ json: response() });
    if (url.pathname.endsWith('/sponsorship-invoices')) {
      const value = url.searchParams.get('contributionId') || id;
      return route.fulfill({
        json: {
          invoices: [
            {
              id: value,
              contribution_id: value,
              invoice_number: value === id ? 'FAC-601' : 'FAC-602',
              currency: 'cad',
              subtotal: 10050,
              tax: 0,
              total: 10050,
              issued_at: '2026-09-16T12:00Z',
              paid_at: '2026-09-16T12:00Z',
              issuer_name: 'OpenG7',
              sponsor_name: group(value).title,
              line_items: [],
              credit_notes: []
            }
          ],
          summary: {
            total_count: 1,
            total_amount: 10050,
            currency: 'cad',
            credit_note_count: 0,
            total_credited: 0,
            failed_email_count: 0
          }
        }
      });
    }
    if (url.pathname.endsWith('/contributions')) {
      const value = url.searchParams.get('contributionId');
      return route.fulfill({
        json: {
          contributions: value
            ? [
                {
                  id: value,
                  public_reference: group(value).reference,
                  contribution_type: 'sponsorship_interest',
                  amount: 10050,
                  currency: 'cad',
                  payment_status: 'paid',
                  paid_at: '2026-09-16T12:00Z',
                  sponsor_company_name: group(value).title,
                  public_display_consent: true
                }
              ]
            : [],
          summary: {
            total_count: 2008,
            paid_count: 2008,
            sponsorship_count: 2008,
            total_received: 10050,
            currency: 'cad'
          }
        }
      });
    }
    if (url.pathname.endsWith('/publication-drafts')) {
      const value = url.searchParams.get('draftId') || draftId;
      return route.fulfill({
        json: {
          drafts: [
            {
              id: value,
              contribution_id: value === draftId ? id : nextId,
              sponsor_company_name: 'Atelier',
              title:
                value === draftId ? 'Publication Boréal' : 'Publication Rivage',
              feed_target: 'openg7',
              channel: 'facebook',
              body: 'Contenu de test',
              disclosure_text: 'Avis',
              status: 'draft',
              created_at: '2026-09-16T12:00Z',
              updated_at: '2026-09-16T12:00Z'
            }
          ]
        }
      });
    }
    for (const [path, key] of [
      ['sponsorships', 'sponsorships'],
      ['publication-batches', 'batches'],
      ['publication-slots', 'slots'],
      ['social-publication-jobs', 'jobs']
    ]) {
      if (url.pathname.endsWith('/' + path))
        return route.fulfill({ json: { [key!]: [] } });
    }
    return route.fulfill({ status: 503, json: {} });
  });
}

test('keyboard opens search, traps focus, groups links and restores the opener', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser');
  const trigger = page.locator('[data-og7="admin-search-open"]');
  await trigger.focus();
  await expect(page.locator('[data-og7="admin-search-open"]')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(input(page)).toBeFocused();
  await input(page).fill('FAC-601');
  await expect(dialog(page).getByRole('listitem')).toHaveCount(1);
  await expect(dialog(page).getByRole('link')).toHaveCount(4);
  await page.screenshot({ path: 'test-results/lot6-search-desktop.png' });
  await expect(
    dialog(page).getByRole('link', { name: 'Facture FAC-601' })
  ).toHaveAttribute('href', '/admin/fundraiser/invoices?contributionId=' + id);
  await input(page).press('ArrowDown');
  await expect(
    dialog(page).getByRole('link', { name: 'Commandite', exact: true })
  ).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(
    dialog(page).getByRole('link', { name: /Publication/ })
  ).toBeFocused();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(
      await dialog(page).evaluate((element) =>
        element.contains(document.activeElement)
      )
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog(page)).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Meta+k');
  await expect(input(page)).toHaveValue('');
  await expect(dialog(page).getByRole('link')).toHaveCount(0);
});

test('search debounces into POST bodies and keeps private text out of URLs and storage', async ({
  page
}) => {
  await fixtures(page);
  const requests: { url: string; method: string; body: unknown }[] = [];
  await page.route('**/api/admin/search', (route) => {
    requests.push({
      url: route.request().url(),
      method: route.request().method(),
      body: route.request().postDataJSON()
    });
    return route.fulfill({ json: response() });
  });
  await page.goto('/admin/fundraiser');
  await page.locator('[data-og7="admin-search-open"]').click();
  await input(page).pressSequentially('private@example.invalid', { delay: 10 });
  await expect(dialog(page).getByRole('listitem')).toHaveCount(1);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.method).toBe('POST');
  expect(requests[0]!.body).toEqual({
    query: 'private@example.invalid',
    page: 1,
    pageSize: 10
  });
  expect(new URL(requests[0]!.url).search).toBe('');
  expect(page.url()).not.toContain('private');
  expect(
    await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))
  ).not.toContain('private@example.invalid');
  await dialog(page)
    .getByRole('link', { name: 'Contribution', exact: true })
    .click();
  await expect(page).toHaveURL(
    '/admin/fundraiser/contributions?contributionId=' + id
  );
  await expect(
    page.getByRole('heading', { name: 'Détail de la contribution' })
  ).toBeVisible();
  await expect(page.locator('[data-og7="admin-search-open"]')).toHaveCount(1);
});

test('new input aborts the previous request and late results never replace newer results', async ({
  page
}) => {
  await fixtures(page);
  await page.addInitScript(() => {
    const original = window.fetch;
    (window as unknown as { searchAborted: boolean }).searchAborted = false;
    window.fetch = async (url, options) => {
      if (
        String(url).endsWith('/admin/search') &&
        String(options?.body).includes('Slow')
      ) {
        options?.signal?.addEventListener('abort', () => {
          (window as unknown as { searchAborted: boolean }).searchAborted =
            true;
        });
        // Simulate an adapter that resolves even after abort.
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return new Response(
          JSON.stringify({
            available: true,
            missingSources: [],
            total: 0,
            groups: [],
            page: 1,
            pageSize: 10
          })
        );
      }
      return original(url, options);
    };
  });
  await page.goto('/admin/fundraiser');
  await expect(page.locator('[data-og7="admin-search-open"]')).toBeVisible();
  await page.keyboard.press('Control+k');
  await input(page).fill('Slow');
  await page.waitForTimeout(400);
  await input(page).fill('Acme');
  await expect(
    dialog(page).getByRole('heading', { name: 'Atelier Boréal' })
  ).toBeVisible();
  await page.waitForTimeout(1300);
  await expect(
    dialog(page).getByRole('heading', { name: 'Atelier Boréal' })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { searchAborted: boolean }).searchAborted
    )
  ).toBe(true);
});

test('pagination stays in memory and partial coverage differs from an empty complete search', async ({
  page
}) => {
  await fixtures(page);
  const pages: number[] = [];
  await page.route('**/api/admin/search', (route) => {
    const body = route.request().postDataJSON();
    pages.push(body.page);
    return route.fulfill({
      json:
        body.query === 'Empty'
          ? response([])
          : {
              ...response(
                [group(body.page === 1 ? id : nextId)],
                body.page,
                11
              ),
              missingSources: ['sponsor_publication_drafts']
            }
    });
  });
  await page.goto('/admin/fundraiser');
  await expect(page.locator('[data-og7="admin-search-open"]')).toBeVisible();
  await page.keyboard.press('Control+k');
  await input(page).fill('Atelier');
  await expect(dialog(page).getByText(/Résultats partiels/)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Suivant' }).click();
  await expect(
    dialog(page).getByRole('heading', { name: 'Atelier Rivage' })
  ).toBeVisible();
  expect(pages).toEqual([1, 2]);
  expect(new URL(page.url()).search).toBe('');
  await input(page).fill('Empty');
  await expect(dialog(page).getByText(/Aucun dossier trouvé/)).toBeVisible();
  await expect(dialog(page).getByText(/Résultats partiels/)).toHaveCount(0);
});

for (const [status, message] of [
  [403, 'Vous n’avez pas accès'],
  [429, 'Trop de recherches'],
  [503, 'La recherche a échoué']
] as const) {
  test('search clears private results on HTTP ' + status, async ({ page }) => {
    await fixtures(page);
    await page.goto('/admin/fundraiser');
    await expect(page.locator('[data-og7="admin-search-open"]')).toBeVisible();
    await page.keyboard.press('Control+k');
    await input(page).fill('Acme');
    await expect(dialog(page).getByRole('listitem')).toHaveCount(1);
    await page.route('**/api/admin/search', (route) =>
      route.fulfill({ status, json: {} })
    );
    await input(page).fill('Another');
    await expect(dialog(page).getByRole('alert')).toContainText(message);
    await expect(dialog(page).getByRole('listitem')).toHaveCount(0);
  });
}

test('expired search session clears authentication and redirects to login', async ({
  page
}) => {
  await fixtures(page);
  await page.route('**/api/admin/search', (route) =>
    route.fulfill({ status: 401, json: {} })
  );
  await page.goto('/admin/fundraiser');
  await expect(page.locator('[data-og7="admin-search-open"]')).toBeVisible();
  await page.keyboard.press('Control+k');
  await input(page).fill('private@example.invalid');
  await expect(page).toHaveURL(/\/admin\/login/);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-session-token')
    )
  ).toBeNull();
  expect(page.url()).not.toContain('private');
});

for (const destination of [
  'invoices',
  'contributions',
  'publications'
] as const) {
  test(
    'search opens a new exact object on the same ' + destination + ' page',
    async ({ page }) => {
      await fixtures(page);
      await page.route('**/api/admin/search', (route) =>
        route.fulfill({ json: response([group(nextId)]) })
      );
      const query =
        destination === 'publications'
          ? 'draftId=' + draftId
          : 'contributionId=' + id;
      await page.goto('/admin/fundraiser/' + destination + '?' + query);
      await expect(
        page.locator('[data-og7="admin-search-open"]')
      ).toBeVisible();
      await page.keyboard.press('Control+k');
      await input(page).fill('Rivage');
      const label =
        destination === 'invoices'
          ? 'Facture FAC-602'
          : destination === 'contributions'
            ? 'Contribution'
            : /Publication/;
      await dialog(page)
        .getByRole('link', { name: label, exact: true })
        .click();
      await expect(page).toHaveURL(
        '/admin/fundraiser/' +
          destination +
          '?' +
          (destination === 'publications'
            ? 'draftId=' + nextDraftId
            : 'contributionId=' + nextId)
      );
      if (destination === 'invoices') {
        await expect(
          page.getByRole('heading', { name: 'FAC-602', exact: true })
        ).toBeVisible();
      } else if (destination === 'contributions') {
        await expect(
          page.getByRole('region', { name: 'Détail de la contribution' })
        ).toContainText('Atelier Rivage');
      } else {
        await expect(
          page.locator('#attention-object-' + nextDraftId)
        ).toBeVisible();
        await expect(
          page.locator('#attention-object-' + nextDraftId)
        ).toBeFocused();
      }
    }
  );
}

test('unavailable sources can be retried and closing cancels a pending search', async ({
  page
}) => {
  await fixtures(page);
  let calls = 0;
  await page.route('**/api/admin/search', (route) => {
    calls++;
    return route.fulfill({
      json:
        calls === 1
          ? {
              ...response([]),
              available: false,
              missingSources: ['fund_contributions']
            }
          : response()
    });
  });
  await page.goto('/admin/fundraiser/invoices');
  const opener = page.locator('[data-og7="admin-search-open"]');
  await opener.click();
  await input(page).fill('Acme');
  await expect(
    dialog(page).getByText('La recherche est indisponible pour le moment.')
  ).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Réessayer' }).click();
  await expect(dialog(page).getByRole('listitem')).toHaveCount(1);
  await input(page).fill('Pending private text');
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await page.waitForTimeout(400);
  expect(calls).toBe(2);
  await opener.click();
  await expect(input(page)).toHaveValue('');
  await expect(dialog(page).getByRole('listitem')).toHaveCount(0);
});

test('search remains usable at 320px and is translated into English', async ({
  page
}) => {
  await fixtures(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/admin/fundraiser');
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await page.locator('[data-og7="admin-search-open"]').click();
  await expect(dialog(page)).toHaveAccessibleName('Global search');
  await input(page).fill('Acme');
  await expect(
    dialog(page).getByRole('link', { name: 'Invoice FAC-601' })
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/lot6-search-mobile.png' });
  expect(
    await dialog(page).evaluate(
      (element) => element.scrollWidth <= element.clientWidth
    )
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});
