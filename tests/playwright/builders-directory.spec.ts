import { expect, test } from '@playwright/test';

// Covers builders-page.component.ts (/batisseurs), the only "static" public
// page that actually fetches live data: GET /api/public/fund-transparency
// via FundTransparencyService.getPublicTransparency(). The directory only
// lists rows with a non-null `public_name` (fund_contributions.repository's
// getPublicBuilders query), which scripts/e2e-seed.mjs's sponsorship
// fixtures don't set -- they use sponsor_company_name instead, which feeds
// /commanditaires, not this page. So the populated-vs-empty assertion below
// accepts either branch rather than asserting specific fixture content.

test.describe('Docker builders directory page', () => {
  test('renders the hero and either the populated directory or the empty state', async ({
    page
  }) => {
    await page.goto('/batisseurs');

    await expect(page.locator('#builders-directory-title')).toContainText(
      'Bâtisseurs OpenG7'
    );
    await expect(
      page.locator('.builders-list, .empty-builders')
    ).toBeVisible();
  });

  test('links to the fund support section and the transparency page', async ({
    page
  }) => {
    await page.goto('/batisseurs');
    await page
      .getByRole('link', { name: 'Soutenir OpenG7', exact: true })
      .click();
    await expect(page).toHaveURL(/#support$/);

    await page.goto('/batisseurs');
    await page.getByRole('link', { name: 'Transparence', exact: true }).click();
    await expect(page).toHaveURL(/\/fonds-des-batisseurs\/transparence$/);
  });

  test('renders the English mirror', async ({ page }) => {
    await page.goto('/en/batisseurs');

    await expect(page.locator('#builders-directory-title')).toContainText(
      'OpenG7 Builders'
    );
  });

  test('shows an error state when the public registry request fails', async ({
    page
  }) => {
    await page.route('**/public/fund-transparency', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}'
      })
    );
    await page.goto('/batisseurs');

    await expect(
      page.getByText('Impossible de charger le registre public.', {
        exact: true
      })
    ).toBeVisible();
  });
});
