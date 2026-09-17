import { expect, test } from './support/test.js';
import { signInAsAdmin } from './support/admin-auth.js';

// Real authenticated reads for dashboard, audit and transparency. Only error
// responses are intercepted. Cockpit blocks load independently, so a dashboard
// failure may coexist with successfully loaded metrics and activity.

test.describe('Docker admin dashboard', () => {
  test('renders fund metrics and recent contributions', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser');

    await expect(
      page.getByRole('heading', { name: 'Centre de pilotage' })
    ).toBeVisible();
    await expect(
      page.getByText('Montants encaissés', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('En attente de revue', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Dernières contributions' })
    ).toBeVisible();
  });

  test('shows an error state when the dashboard request fails and recovers on refresh', async ({
    page
  }) => {
    await signInAsAdmin(page);

    await page.route('**/admin/dashboard', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}'
      })
    );
    await page.goto('/admin/fundraiser');

    await expect(
      page.getByText(/Impossible de charger le tableau de bord/i)
    ).toBeVisible();

    await page.unroute('**/admin/dashboard');
    await page.locator('[data-og7="dashboard-refresh"]').click();

    await expect(
      page.getByText(/Impossible de charger le tableau de bord/i)
    ).not.toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Centre de pilotage' })
    ).toBeVisible();
    await expect(
      page.getByText('Montants encaissés', { exact: true })
    ).toBeVisible();
  });
});

test.describe('Docker admin audit log', () => {
  test('lists audit entries and narrows them with the search box', async ({
    page
  }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/audit');

    await expect(
      page.getByRole('heading', { name: 'Journal admin' })
    ).toBeVisible();

    const entryCount = page.locator('.audit-panel header span');
    const initialCountText = (await entryCount.textContent()) ?? '';
    const search = page.getByLabel('Recherche', { exact: true });

    await search.fill('e2e-playwright-audit-search-no-match');
    await expect(
      page.getByRole('heading', { name: 'Aucune entree trouvee' })
    ).toBeVisible();
    await expect(entryCount).toHaveText('0 entree(s)');

    await search.fill('');
    await expect(entryCount).toHaveText(initialCountText);
  });

  test('shows an error state when the audit log request fails and recovers on refresh', async ({
    page
  }) => {
    await signInAsAdmin(page);

    await page.route('**/admin/audit-log', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}'
      })
    );
    await page.goto('/admin/fundraiser/audit');

    await expect(
      page.getByText(/Impossible de charger le journal d'audit/i)
    ).toBeVisible();

    await page.unroute('**/admin/audit-log');
    await page.getByRole('button', { name: 'Actualiser', exact: true }).click();

    await expect(
      page.getByText(/Impossible de charger le journal d'audit/i)
    ).not.toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Journal admin' })
    ).toBeVisible();
  });
});

test.describe('Docker admin transparency snapshot', () => {
  test('renders the summary and published expenses panel', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/transparency');

    await expect(
      page.getByRole('heading', { name: 'Transparence' })
    ).toBeVisible();
    await expect(page.getByText('Total recu', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Alloue publie', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Snapshot public courant' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Depenses visibles publiquement' })
    ).toBeVisible();
  });

  test('shows an error state when the transparency request fails and recovers on refresh', async ({
    page
  }) => {
    await signInAsAdmin(page);

    await page.route('**/admin/transparency', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}'
      })
    );
    await page.goto('/admin/fundraiser/transparency');

    await expect(
      page.getByText(/Impossible de charger la transparence admin/i)
    ).toBeVisible();

    await page.unroute('**/admin/transparency');
    await page.getByRole('button', { name: 'Actualiser', exact: true }).click();

    await expect(
      page.getByText(/Impossible de charger la transparence admin/i)
    ).not.toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Transparence' })
    ).toBeVisible();
    await expect(page.getByText('Total recu', { exact: true })).toBeVisible();
  });
});
