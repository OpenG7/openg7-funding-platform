import { expect, type Page } from '@playwright/test';

import { ADMIN_TOKEN } from '../fixtures/e2e-fixtures.mjs';

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
  await page.getByLabel(/Recherche/i).fill(companyName);
  await page.getByRole('button', { name: new RegExp(companyName) }).click();
};
