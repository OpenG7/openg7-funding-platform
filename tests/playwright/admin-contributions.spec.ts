import { expect, test } from './support/test.js';

import { SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';

// Covers admin-contributions-page.component.ts: a read-only list (no
// mutating actions) with client-side search/type/status/consent filters and
// a CSV export. The filter scenarios search for one seeded fixture by name
// first, then flip a single filter to a value that fixture doesn't match --
// that isolates the assertion to just that one row regardless of how much
// other data the shared local dev database already holds.

test.describe('Docker admin contributions', () => {
  test('renders the contribution summary and admin list', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/contributions');

    await expect(
      page.getByRole('heading', { name: 'Contributions' })
    ).toBeVisible();
    await expect(page.getByText('Total', { exact: true })).toBeVisible();
    await expect(page.getByText('Payees', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Liste admin' })
    ).toBeVisible();
  });

  test('filters the fixture contribution by search, type, payment status, and public display consent', async ({
    page
  }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/contributions');

    const fixture = SPONSORSHIP_FIXTURES.approve;
    const resultCount = page.locator('.admin-table-panel header span');
    const row = page.locator('tbody tr', { hasText: fixture.companyName });
    const emptyState = page.getByRole('heading', {
      name: 'Aucune contribution trouvee'
    });

    await page.getByLabel(/Recherche/i).fill(fixture.companyName);
    await expect(row).toBeVisible();
    await expect(resultCount).toHaveText('1 resultat(s)');

    // Fixture rows are always seeded as sponsorship_interest/paid/consented
    // (scripts/e2e-seed.mjs), so a mismatched filter value combined with the
    // company-name search deterministically empties the list.
    await page
      .getByLabel('Type')
      .selectOption({ label: 'Contribution personnelle' });
    await expect(emptyState).toBeVisible();

    await page.getByLabel('Type').selectOption({ label: 'Commandite' });
    await expect(row).toBeVisible();

    await page.getByLabel('Statut paiement').selectOption({ label: 'Pending' });
    await expect(emptyState).toBeVisible();

    await page.getByLabel('Statut paiement').selectOption({ label: 'Paid' });
    await expect(row).toBeVisible();

    await page
      .getByLabel('Affichage public')
      .selectOption({ label: 'Non publics' });
    await expect(emptyState).toBeVisible();

    await page
      .getByLabel('Affichage public')
      .selectOption({ label: 'Consentis' });
    await expect(row).toBeVisible();
  });

  test('exports the full contributions list as CSV', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/contributions');
    await expect(
      page.getByRole('heading', { name: 'Contributions' })
    ).toBeVisible();

    // exportCsv() hits /admin/contributions.csv directly with no filter
    // query params, so the download always reflects the full admin list --
    // no need to search/filter first for this assertion to be meaningful.
    const fixture = SPONSORSHIP_FIXTURES.approve;
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('openg7-admin-contributions.csv');

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    const csv = Buffer.concat(chunks).toString('utf-8');
    expect(csv).toContain(fixture.publicReference);
  });

  test('shows an error state when the contributions request fails and recovers on refresh', async ({
    page
  }) => {
    await signInAsAdmin(page);

    await page.route('**/admin/contributions', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}'
      })
    );
    await page.goto('/admin/fundraiser/contributions');

    await expect(
      page.getByText(/Impossible de charger ou exporter les contributions/i)
    ).toBeVisible();

    await page.unroute('**/admin/contributions');
    await page.getByRole('button', { name: 'Actualiser', exact: true }).click();

    await expect(
      page.getByText(/Impossible de charger ou exporter les contributions/i)
    ).not.toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Contributions' })
    ).toBeVisible();
  });
});
