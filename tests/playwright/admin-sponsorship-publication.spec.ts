import { expect, test } from './support/test.js';

import { SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { openFixtureSponsorship, signInAsAdmin } from './support/admin-auth.js';

// Covers the admin feed-publication editor (OpenG7/OpenG20, Facebook/
// LinkedIn placement). No external network call is involved: the static
// coverage test (tests/funding-sponsorship-e2e-coverage.test.mjs) already
// asserts graph.facebook.com/api.linkedin.com never appear in the source --
// this is a purely internal form + DB round trip, verified here end to end
// through to the public /commanditaires directory.

test.describe('Docker admin sponsorship feed publication', () => {
  test('saves a feed placement and shows it on the public sponsors directory', async ({
    page
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.directory;
    await openFixtureSponsorship(page, fixture.companyName);

    await page
      .getByRole('button', { name: 'Publication', exact: true })
      .click();

    const editor = page.locator('.publication-editor');
    await expect(editor).toBeVisible();

    const slug = 'e2e-playwright-fixture-directory';
    const feedUrl = 'https://example.com/e2e-playwright-fixture-directory-feed';

    await editor.getByLabel(/Slug public/i).fill(slug);
    await editor.getByLabel(/Destination feed/i).selectOption('openg7');
    await editor.getByLabel(/Statut feed/i).selectOption('published');

    // Some tiers force a channel on (isPromisedFeedChannel), which disables
    // the checkbox -- only check the ones this fixture's tier leaves free.
    const facebookCheckbox = editor.getByLabel('Facebook');
    if (await facebookCheckbox.isEnabled()) {
      await facebookCheckbox.check();
    }
    const linkedinCheckbox = editor.getByLabel('LinkedIn');
    if (await linkedinCheckbox.isEnabled()) {
      await linkedinCheckbox.check();
    }

    await editor
      .getByLabel(/Resume public/i)
      .fill('E2E Playwright: resume public de test automatise.');
    await editor.getByLabel(/Lien de publication/i).fill(feedUrl);
    await editor
      .getByLabel(/Notes feed/i)
      .fill('E2E Playwright: note de feed automatisee.');

    await page.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.getByText('Publication enregistree')).toBeVisible();

    // Reload and reopen the same tab to confirm the save actually persisted
    // to the database rather than only updating local component state.
    await page.reload();
    await openFixtureSponsorship(page, fixture.companyName);
    await page
      .getByRole('button', { name: 'Publication', exact: true })
      .click();
    await expect(
      page.locator('.publication-editor').getByLabel(/Slug public/i)
    ).toHaveValue(slug);

    await page.goto('/commanditaires');
    const sponsorRow = page.locator('.sponsors-list li', {
      hasText: fixture.companyName
    });
    await expect(sponsorRow).toBeVisible();
    await expect(
      sponsorRow.getByRole('link', { name: 'Voir la publication' })
    ).toHaveAttribute('href', feedUrl);
  });
});
