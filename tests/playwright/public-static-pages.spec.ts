import { expect, test } from './support/test.js';

// Covers the informational public pages that have no dynamic behavior at
// all: no signals, no HTTP calls, just translated static content and links
// (funding-about-page, ecosystem-page, boutique-page, music-page
// components). French copy in this codebase uses a curly apostrophe (’),
// so text assertions below match around it with a `.` wildcard instead of
// hardcoding the character.

test.describe('Docker funding about page', () => {
  test('renders the hero and links to the ecosystem and home sections', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs/a-propos');

    await expect(page.locator('#about-title')).toContainText('OpenG7');
    await expect(
      page.getByText('Une vision ouverte. Des fondations partagées.')
    ).toBeVisible();

    await page
      .getByRole('link', { name: 'Découvrir OpenG7', exact: true })
      .click();
    await expect(page).toHaveURL(/\/ecosystem$/);

    await page.goto('/fonds-des-batisseurs/a-propos');
    await page
      .getByRole('link', { name: 'Comprendre le fonds', exact: true })
      .click();
    await expect(page).toHaveURL(/#funding-purpose$/);

    await page.goto('/fonds-des-batisseurs/a-propos');
    await page
      .getByRole('link', { name: 'Soutenir le projet', exact: true })
      .click();
    await expect(page).toHaveURL(/#support$/);
  });

  test('renders the English mirror', async ({ page }) => {
    await page.goto('/en/fonds-des-batisseurs/a-propos');

    await expect(
      page.getByText('An open vision. Shared foundations.')
    ).toBeVisible();
  });
});

test.describe('Docker ecosystem page', () => {
  test('renders the hero and jumps to the platforms, connections, and support sections', async ({
    page
  }) => {
    await page.goto('/ecosystem');

    await expect(page.locator('#ecosystem-title')).toContainText(/écosystème/i);

    // "Explorer les plateformes"/"Voir les connexions" also appear in a
    // repeated CTA block further down the page, hence .first().
    await page
      .getByRole('link', { name: 'Explorer les plateformes', exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/ecosystem#platforms$/);

    await page.goto('/ecosystem');
    await page
      .getByRole('link', { name: 'Voir les connexions', exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/ecosystem#connections$/);

    await page.goto('/ecosystem');
    await page
      .getByRole('link', { name: /Soutenir l.écosystème/i })
      .first()
      .click();
    await expect(page).toHaveURL(/#support$/);
  });

  test('exposes a platform repository link in a new tab', async ({ page }) => {
    await page.goto('/ecosystem');

    const repositoryLink = page
      .getByRole('link', { name: 'Explorer', exact: true })
      .first();
    await expect(repositoryLink).toHaveAttribute('href', /github\.com\/OpenG7/);
    await expect(repositoryLink).toHaveAttribute('target', '_blank');
  });
});

test.describe('Docker boutique page', () => {
  test('renders the coming-soon hero and links out to the NorthDragon store', async ({
    page
  }) => {
    await page.goto('/boutique');

    await expect(page.locator('#boutique-title')).toContainText('NorthDragon');

    const storeLink = page.locator('main a[href*="northdragon.org"]').first();
    await expect(storeLink).toBeVisible();
    await expect(storeLink).toHaveAttribute('href', /northdragon\.org/);
    await expect(storeLink).toHaveAttribute('target', '_blank');
  });
});

test.describe('Docker music page', () => {
  test('renders the coming-soon hero with a disabled listen button', async ({
    page
  }) => {
    await page.goto('/music');

    await expect(page.locator('#music-title')).toContainText(
      'Chants du Dragon'
    );
    await expect(
      page.getByRole('button', { name: /.couter l.album/i })
    ).toBeDisabled();
  });

  test('the home and ecosystem links stay on the French locale', async ({
    page
  }) => {
    await page.goto('/music');
    await page.getByRole('link', { name: /Retour . l.accueil/i }).click();
    await expect(page).toHaveURL(/\/(fonds-des-batisseurs)?$/);

    await page.goto('/music');
    await page.getByRole('link', { name: /D.couvrir l.écosystème/i }).click();
    await expect(page).toHaveURL(/\/ecosystem$/);
  });

  // Regression coverage for a bug this suite caught: the home/ecosystem
  // CTAs used to hard-code routerLink="/" and routerLink="/ecosystem"
  // instead of the i18n-aware path helpers every other public page uses
  // (see funding-about-page's homePath()/ecosystemPath() above), which
  // dropped the "en/" prefix on the English mirror. Fixed in
  // music-page.component.ts alongside this test.
  test('the home and ecosystem links keep the English locale prefix on the English mirror', async ({
    page
  }) => {
    await page.goto('/en/music');
    await page.getByRole('link', { name: 'Return home', exact: true }).click();
    await expect(page).toHaveURL(/\/en(\/fonds-des-batisseurs)?$/);

    await page.goto('/en/music');
    await page
      .getByRole('link', { name: 'Discover the ecosystem', exact: true })
      .click();
    await expect(page).toHaveURL(/\/en\/ecosystem$/);
  });
});
