import { expect, test } from '@playwright/test';

import { SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';

// Covers the Facebook/LinkedIn publication batch lifecycle
// (admin-publications-page.component.ts), never exercised in a browser
// before: create a draft for an eligible sponsorship, approve it, create a
// batch, assign the draft, schedule the batch, then publish it. No external
// network call is involved -- scheduling and publishing are both manual
// admin actions recorded in the database only.

test.describe('Docker admin publication batches', () => {
  test('creates a draft, assigns it to a batch, schedules, and publishes the batch', async ({
    page
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.publicationBatch;
    await page.goto('/admin/fundraiser/publications');

    const eligibleCard = page.locator('.eligible-list article', {
      hasText: fixture.companyName
    });
    await expect(eligibleCard).toBeVisible();
    await eligibleCard.getByRole('button', { name: 'Facebook', exact: true }).click();

    const draftCard = page.locator('.draft-card', {
      hasText: fixture.companyName
    });
    await expect(draftCard).toBeVisible();

    await draftCard
      .getByLabel('Titre')
      .fill('E2E Playwright: titre de publication de test.');
    await draftCard
      .getByLabel('Texte')
      .fill('E2E Playwright: texte de publication de test automatise.');
    await draftCard
      .getByLabel('Divulgation')
      .fill('Commandite payante divulguee pour un test automatise.');
    await draftCard.getByRole('button', { name: 'Approuver', exact: true }).click();

    await expect(draftCard.getByText('Approuvee', { exact: true })).toBeVisible();

    await page
      .getByRole('button', { name: 'Creer un lot', exact: true })
      .click();

    const batchCard = page.locator('.batch-card');
    await expect(batchCard).toBeVisible();
    await expect(batchCard).toContainText('Ouvert');
    await expect(batchCard).toContainText('Facebook - 0/5');

    // The <select> wrapped by the "Lot" label wasn't touched yet, so its
    // only option besides the placeholder is this test's own freshly created
    // batch (a fresh CI database has no other fixtures competing for it).
    await draftCard.getByLabel(/^Lot/i).selectOption({ index: 1 });
    await draftCard
      .getByRole('button', { name: 'Assigner au lot', exact: true })
      .click();

    await expect(draftCard.getByText(/Dans un lot \(Ouvert\)/i)).toBeVisible();
    await expect(batchCard).toContainText('Facebook - 1/5');

    const nextAvailability = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 16);
    await batchCard
      .getByLabel('Prochaine disponibilite')
      .fill(nextAvailability);
    await batchCard.getByRole('button', { name: 'Planifier', exact: true }).click();

    await expect(batchCard).toContainText('Planifie');

    await batchCard
      .getByRole('button', { name: 'Publier maintenant', exact: true })
      .click();

    await expect(batchCard).toContainText('Publie');
    await expect(draftCard.getByText(/Dans un lot \(Publie\)/i)).toBeVisible();
  });
});
