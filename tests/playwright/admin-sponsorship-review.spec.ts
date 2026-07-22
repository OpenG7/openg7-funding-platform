import { expect, test, type Page } from '@playwright/test';

import {
  ADMIN_TOKEN,
  SPONSORSHIP_FIXTURES
} from './fixtures/e2e-fixtures.mjs';

const signInAsAdmin = async (page: Page) => {
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
const openFixtureSponsorship = async (
  page: Page,
  companyName: string
): Promise<void> => {
  await page.getByLabel(/Recherche/i).fill(companyName);
  await page.getByRole('button', { name: new RegExp(companyName) }).click();
};

test.describe('Docker admin sponsorship review', () => {
  test('rejects an invalid admin token and stays on the login page', async ({
    page
  }) => {
    await page.goto('/admin/login');

    await page.getByLabel(/Jeton admin/i).fill('not-the-admin-token');
    await page.getByRole('button', { name: /Se connecter/i }).click();

    await expect(page.getByText(/Connexion refusee/i)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('logs in with a valid admin token and lists the seeded sponsorship', async ({
    page
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.approve;
    await page.getByLabel(/Recherche/i).fill(fixture.companyName);
    await expect(
      page.getByRole('button', { name: new RegExp(fixture.companyName) })
    ).toBeVisible();
  });

  test('approves a paid sponsorship from the detail panel', async ({
    page
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.approve;
    await openFixtureSponsorship(page, fixture.companyName);

    await page.getByRole('button', { name: 'Accepter' }).click();

    await expect(
      page.getByText('Action confirmee: commandite acceptee.')
    ).toBeVisible();
  });

  test('rejects a paid sponsorship with an internal reason', async ({
    page
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.reject;
    await openFixtureSponsorship(page, fixture.companyName);

    await page.getByRole('button', { name: 'Refuser' }).click();
    await page
      .getByLabel(/Raison interne du refus/i)
      .fill('E2E Playwright: refus de test automatise.');
    await page.getByRole('button', { name: /Confirmer le refus/i }).click();

    await expect(
      page.getByText('Action confirmee: commandite refusee.')
    ).toBeVisible();
  });
});
