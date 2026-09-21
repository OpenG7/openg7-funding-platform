import { expect, test } from './support/test.js';
import { SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin, openFixtureSponsorship } from './support/admin-auth.js';

// Tests for sponsor side rejection state validation
// The admin can reject sponsorships via admin-sponsorship-review.spec.ts,
// but there are NO tests that validate the sponsor sees the rejected state
// on their followup page. This test fills that gap.

test.describe('Sponsor side rejected state validation', () => {
  test('admin rejects a sponsorship and sponsor sees rejected state on followup page', async ({
    page
  }) => {
    // 1. Admin signs in and rejects the sponsorship
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.reject;
    await openFixtureSponsorship(page, fixture.companyName);

    // Admin rejects the sponsorship with an internal reason
    await page.getByRole('button', { name: 'Refuser' }).click();
    await page
      .getByLabel(/Raison interne du refus/i)
      .fill('E2E Playwright: refus de test pour validation sponsor.');
    await page.getByRole('button', { name: /Confirmer le refus/i }).click();

    await expect(
      page.getByText('Action confirmee: commandite refusee.')
    ).toBeVisible();

    // 2. Sponsor visits the followup page and validates rejected state
    await page.goto(
      `/fonds-des-batisseurs/suivi-commandite?token=${fixture.followupToken}`
    );

    // Verify the rejected state is displayed
    await expect(
      page.getByRole('heading', { name: /Commandite refus.e/i })
    ).toBeVisible();
    await expect(
      page
        .locator('.reference-code', { hasText: fixture.publicReference })
        .first()
    ).toBeVisible();

    // The internal refusal reason must remain private on the sponsor page.
    await expect(
      page.getByText('E2E Playwright: refus de test pour validation sponsor.')
    ).toHaveCount(0);

    // Verify the payment status is still paid
    await expect(
      page.locator('[data-og7="followup-summary"]').getByRole('heading', {
        name: 'Confirmé',
        exact: true
      })
    ).toBeVisible();

    // Verify the details form is not available (rejected sponsorships don't allow details submission)
    await expect(
      page.getByRole('button', {
        name: /Soumettre mes informations à l’équipe/i
      })
    ).toBeDisabled();
  });
});
