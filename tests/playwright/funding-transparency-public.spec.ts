import { expect, test } from './support/test.js';

// Covers funding-transparency-page.component.ts (/fonds-des-batisseurs
// /transparence), the richest public page: live KPIs from
// GET /api/public/fund-transparency, registry filters, CSV/JSON exports,
// and a personal-contribution checkout widget that shares its mocked-
// checkout machinery with personal-donation-navigation.spec.ts. "Soutenir
// OpenG7" (funding.nav.supportCta) labels two different buttons on this
// page -- a hero button that only scrolls to #support, and the actual
// checkout submit button inside #support -- so every reference below is
// scoped to its container the same way personal-donation-navigation.spec.ts
// already does.

test.describe('Docker funding transparency page', () => {
  test('renders the hero, KPIs, registry, and scrolls to the registry panel', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs/transparence');

    await expect(page.locator('#transparency-title')).toContainText(
      'Bâtisseurs'
    );
    await expect(
      page.getByRole('heading', { name: 'Registre public des mouvements' })
    ).toBeVisible();

    await page
      .locator('.hero-actions')
      .getByRole('button', { name: 'Voir le registre', exact: true })
      .click();
    await expect(page.locator('#public-registry')).toBeInViewport();
  });

  test('downloads the monthly report and filters the public registry', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs/transparence');

    const downloadPromise = page.waitForEvent('download');
    await page
      .locator('.hero-actions')
      .getByRole('button', { name: 'Télécharger le rapport', exact: true })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      'openg7-transparence-fonds-batisseurs.json'
    );

    const registryPanel = page.locator('.registry-panel');
    const allFilter = registryPanel.getByRole('button', {
      name: 'Tous',
      exact: true
    });
    const contributionsFilter = registryPanel.getByRole('button', {
      name: 'Contributions',
      exact: true
    });
    const feesFilter = registryPanel.getByRole('button', {
      name: 'Frais',
      exact: true
    });

    await expect(allFilter).toHaveClass(/active/);
    await contributionsFilter.click();
    await expect(contributionsFilter).toHaveClass(/active/);
    await expect(allFilter).not.toHaveClass(/active/);

    await feesFilter.click();
    await expect(feesFilter).toHaveClass(/active/);

    await allFilter.click();
    await expect(allFilter).toHaveClass(/active/);
  });

  test('exports the registry as CSV from the reports panel', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs/transparence');

    const downloadPromise = page.waitForEvent('download');
    await page
      .locator('.reports-panel')
      .getByRole('button', { name: 'Exporter en CSV', exact: true })
      .click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('openg7-registre-public.csv');
  });

  test('shows the public achievement details and never renders private fields', async ({
    page
  }) => {
    await page.route('**/public/fund-transparency', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data_source: 'database',
          total_received: 250,
          total_fees: 8,
          total_net: 242,
          total_refunded: 0,
          total_payouts: 0,
          current_available_estimate: 242,
          contributions_count: 4,
          currency: 'CAD',
          monthly_summary: [],
          latest_public_allocations: [
            {
              project_name: 'Passerelle de services ouverts',
              public_description: 'Une interface publique pour relier les services.',
              expected_outcome: 'Les communautés peuvent suivre les demandes en ligne.',
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
          last_updated_at: '2026-09-11T12:00:00.000Z'
        })
      })
    );

    await page.goto('/fonds-des-batisseurs/transparence');

    await expect(page.getByText('Passerelle de services ouverts')).toBeVisible();
    await expect(
      page.getByText('Une interface publique pour relier les services.')
    ).toBeVisible();
    await expect(
      page.getByText('Les communautés peuvent suivre les demandes en ligne.')
    ).toBeVisible();
    await expect(page.getByText('En cours', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Démonstration publique/i })
    ).toHaveAttribute('href', 'https://openg7.org/preuve-passerelle');
    await expect(page.locator('body')).not.toContainText(
      /email_private|stripe_payment_intent_id|notes? admin/i
    );
  });

  test('requires non-charity consent, then completes the mocked personal-contribution checkout', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs/transparence');

    const supportSection = page.locator('#support');
    const submitButton = supportSection.getByRole('button', {
      name: 'Soutenir OpenG7',
      exact: true
    });

    await expect(submitButton).toBeDisabled();

    await supportSection
      .getByRole('button', { name: '25 $', exact: true })
      .click();
    await expect(submitButton).toBeDisabled();

    await supportSection
      .getByLabel(/OpenG7 est un projet ind.pendant en d.veloppement/i)
      .check();
    await expect(submitButton).toBeEnabled();

    await submitButton.click();
    await expect(
      page.getByText(/Mode local ?: Stripe n.a pas ouvert de session r.elle/i)
    ).toBeVisible();
  });

  test('shows an error state when the public transparency request fails', async ({
    page
  }) => {
    await page.route('**/public/fund-transparency', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}'
      })
    );
    await page.goto('/fonds-des-batisseurs/transparence');

    await expect(
      page.getByText('Impossible de charger la transparence publique.', {
        exact: true
      })
    ).toBeVisible();
  });
});
