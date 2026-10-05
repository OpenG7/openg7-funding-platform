import { expect, type Page, type APIRequestContext } from '@playwright/test';

import { ADMIN_TOKEN } from '../fixtures/e2e-fixtures.mjs';

const sessions = new WeakMap<
  APIRequestContext,
  Promise<Record<string, string>>
>();

/** Exercise the same bounded session exchange used by the browser before private API calls. */
export const adminSessionHeaders = (
  request: APIRequestContext
): Promise<Record<string, string>> => {
  let pending = sessions.get(request);
  if (!pending) {
    pending = (async () => {
      const response = await request.post('/api/admin/session', {
        data: { token: ADMIN_TOKEN }
      });
      expect(response.status()).toBe(200);
      const session = await response.json();
      expect(typeof session.sessionToken).toBe('string');
      return { Authorization: `Bearer ${session.sessionToken}` };
    })();
    sessions.set(request, pending);
    pending.catch(() => sessions.delete(request));
  }
  return pending;
};

export const signInAsAdmin = async (page: Page): Promise<void> => {
  await page.goto('/admin/fundraiser/sponsors');
  await expect(page).toHaveURL(/\/admin\/login/);

  await page.getByLabel(/Jeton admin/i).fill(ADMIN_TOKEN);
  await page.getByRole('button', { name: /Se connecter/i }).click();

  await expect(page).toHaveURL(/\/admin\/fundraiser\/sponsors/);
};

// The admin list is backed by the shared local dev database, so it can
// contain more than a page's worth of real sponsorships. Searching for the
// fixture's company name keeps the row lookup independent of pagination and
// sort order.
export const openFixtureSponsorship = async (
  page: Page,
  companyName: string
): Promise<void> => {
  const back = page.locator('[data-og7="dossier-back"]');
  if (
    new URL(page.url()).searchParams.has('sponsorshipId') ||
    (await back.isVisible())
  ) {
    await back.click();
  }
  await page.getByLabel('Recherche', { exact: true }).fill(companyName);
  await page.getByRole('button', { name: new RegExp(companyName) }).click();
};
