import { expect, test } from '@playwright/test';

import { signInAsAdmin } from './support/admin-auth.js';

// Covers admin-expenses-page.component.ts, the only admin page with real
// create/update mutations (createExpense/updateExpense in
// funding-admin.service.ts) that feed the public transparency page once
// published. There is no delete affordance in the UI, so the lifecycle test
// below uses a project name stamped with Date.now() to stay unique across
// repeated runs instead of relying on a shared fixture row.
//
// "Projet ou fournisseur", "Montant CAD", "Description publique", and
// "Statut" labels each appear three times on this page (the create panel,
// the filters bar, and every expense card's edit form), so every locator
// below is scoped to its containing section/card rather than using a bare
// getByLabel().

test.describe('Docker admin expenses', () => {
  test('renders the expense summary, create panel, and filters', async ({
    page
  }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/expenses');

    await expect(
      page.getByRole('heading', { name: 'Depenses et allocations' })
    ).toBeVisible();
    await expect(page.getByText('Publiees', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Montant publie', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Ajouter une depense ou allocation'
      })
    ).toBeVisible();
  });

  test('creates a draft expense, filters it, then publishes, hides, archives, and edits it', async ({
    page
  }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/expenses');

    const projectName = `E2E Playwright Fixture Expense ${Date.now()}`;
    const createPanel = page.locator('.create-panel');

    await createPanel.getByLabel('Projet ou fournisseur').fill(projectName);
    await createPanel.getByLabel('Montant CAD').fill('42.50');
    await createPanel
      .getByLabel('Description publique')
      .fill('E2E Playwright: depense de test automatisee.');
    await createPanel
      .getByRole('button', { name: 'Ajouter', exact: true })
      .click();

    const card = page.locator('.expense-card', { hasText: projectName });
    const statusBadge = card.locator('header span');
    await expect(card).toBeVisible();
    await expect(statusBadge).toHaveText('Brouillon');

    // The list is shared with every other expense already in this local dev
    // database, so search for this fixture by name before touching the
    // status filter -- otherwise an unrelated published expense could keep
    // a row visible and make the empty-state assertion flaky. The search
    // stays filled for the rest of the test, which also keeps `card`
    // unambiguous while the status changes below.
    const search = page.getByLabel(/Recherche/i);
    const statusFilter = page.locator('.filters').getByLabel('Statut');
    const emptyState = page.getByRole('heading', {
      name: 'Aucune entree trouvee'
    });

    await search.fill(projectName);
    await expect(card).toBeVisible();

    await statusFilter.selectOption({ label: 'Publiee' });
    await expect(emptyState).toBeVisible();

    await statusFilter.selectOption({ label: 'Tous' });
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: 'Publier', exact: true }).click();
    await expect(statusBadge).toHaveText('Publiee');

    await card.getByRole('button', { name: 'Masquer', exact: true }).click();
    await expect(statusBadge).toHaveText('Privee');

    await card.getByRole('button', { name: 'Archiver', exact: true }).click();
    await expect(statusBadge).toHaveText('Archivee');

    await card.getByLabel('Montant CAD').fill('99.99');
    await card
      .getByRole('button', { name: 'Enregistrer', exact: true })
      .click();

    await expect(card.locator('header strong')).toContainText('99,99');
    await expect(statusBadge).toHaveText('Archivee');
  });

  test('shows an error state when the expenses request fails and recovers on refresh', async ({
    page
  }) => {
    await signInAsAdmin(page);

    await page.route('**/admin/expenses', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}'
      })
    );
    await page.goto('/admin/fundraiser/expenses');

    await expect(
      page.getByText(/Impossible de charger ou modifier les depenses/i)
    ).toBeVisible();

    await page.unroute('**/admin/expenses');
    await page
      .getByRole('button', { name: 'Actualiser', exact: true })
      .click();

    await expect(
      page.getByText(/Impossible de charger ou modifier les depenses/i)
    ).not.toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Depenses et allocations' })
    ).toBeVisible();
  });
});
