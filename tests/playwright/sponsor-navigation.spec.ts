import { expect, test } from '@playwright/test';

import { SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';

// Covers the public, sponsor-facing side of the business sponsorship journey
// (the admin review side is covered by admin-sponsorship-review.spec.ts):
// funding page tier selection -> mocked checkout -> checkout-return states ->
// sponsorship follow-up page -> public sponsors directory -> support/policy
// pages reachable from that flow. The `directory` fixture is seeded already
// approved so these specs do not depend on run order against the admin spec.

test.describe('Docker corporate sponsor navigation', () => {
  test('selects the business sponsorship tier, sees the benefits update and completes the mocked checkout', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs');

    const sponsorshipCard = page.getByRole('button', {
      name: /Commandite d'entreprise/i
    });
    await sponsorshipCard.click();
    await expect(sponsorshipCard).toHaveAttribute('aria-pressed', 'true');

    const submitButton = page
      .locator('#support')
      .getByRole('button', { name: /Soutenir OpenG7/i });
    await expect(submitButton).toBeDisabled();

    await page.getByRole('button', { name: '500 $', exact: true }).click();
    await expect(
      page
        .locator('.sponsorship-tier-achieved li')
        .filter({ hasText: /LinkedIn/i })
    ).toBeVisible();

    await page
      .getByLabel(/OpenG7 est un projet ind.pendant en d.veloppement/i)
      .check();
    await expect(submitButton).toBeEnabled();

    await submitButton.click();
    await expect(
      page.getByText(/Mode local ?: Stripe n.a pas ouvert de session r.elle/i)
    ).toBeVisible();
  });

  test('arrives at the sponsor follow-up call to action after a successful checkout redirect', async ({
    page
  }) => {
    const followupToken = 'e2e-playwright-checkout-return-deep-link-token-00';

    await page.goto(
      `/fonds-des-batisseurs?checkout=success&contributionType=sponsorship_interest&followup_token=${followupToken}`
    );

    await expect(
      page.getByRole('heading', {
        name: /Commandite re.ue . visibilit. en validation/i
      })
    ).toBeVisible();

    const cta = page.getByRole('link', {
      name: /Compl.ter le suivi commanditaire/i
    });
    await expect(cta).toHaveAttribute(
      'href',
      new RegExp(`/fonds-des-batisseurs/suivi-commandite\\?token=${followupToken}`)
    );
  });

  // Runs before the follow-up resubmission test below: recordSponsorshipDetailsForContribution
  // (apps/funding-api/src/fund-contributions.repository.ts) resets sponsor_review_status back to
  // pending_review on every resubmission, which would otherwise drop this fixture out of the
  // public directory's approved-only listing before this test gets to check it.
  test('lists the approved sponsorship in the public directory reachable from the header navigation', async ({
    page
  }) => {
    const fixture = SPONSORSHIP_FIXTURES.directory;

    await page.goto('/fonds-des-batisseurs');
    await page.locator('nav').getByRole('link', { name: 'Commanditaires' }).click();

    await expect(page).toHaveURL(/\/commanditaires/);
    await expect(
      page.getByRole('heading', { name: /Commanditaires OpenG7/i })
    ).toBeVisible();

    const sponsorRow = page.locator('.sponsors-list li', {
      hasText: fixture.companyName
    });
    await expect(sponsorRow).toBeVisible();
    await expect(
      sponsorRow.getByRole('link', { name: /Site web/i })
    ).toHaveAttribute('href', fixture.websiteUrl);

    await expect(page.locator('body')).not.toContainText(
      /sponsor_contact_email|email_private|stripe_session_id|stripe_payment_intent_id/i
    );
  });

  test('shows the post-approval status and accepts a follow-up resubmission for an approved sponsorship', async ({
    page
  }) => {
    const fixture = SPONSORSHIP_FIXTURES.directory;

    await page.goto(
      `/fonds-des-batisseurs/suivi-commandite?token=${fixture.followupToken}`
    );

    await expect(
      page.getByRole('heading', { name: /Suivi de votre commandite/i })
    ).toBeVisible();
    await expect(page.getByText(fixture.publicReference).first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Commandite accept.e/i })
    ).toBeVisible();

    await page.getByLabel(/Nom de l'entreprise/i).fill(fixture.companyName);
    await page.getByLabel(/Nom du contact/i).fill(fixture.contactName);
    await page.getByLabel(/Courriel du contact/i).fill(fixture.contactEmail);
    await page.getByLabel(/Site web/i).fill(fixture.websiteUrl);

    await page
      .getByRole('button', { name: /Enregistrer les informations/i })
      .click();

    await expect(page.getByText(/Informations enregistr.es/i)).toBeVisible();
  });

  test('reaches the refund policy and support pages referenced during the sponsorship flow', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs');

    await page
      .getByRole('link', {
        name: /Politique d'utilisation et de remboursement/i
      })
      .click();
    await expect(page).toHaveURL(/\/politique-utilisation-remboursement/);
    await expect(
      page.getByRole('heading', {
        name: /Politique d'utilisation et de remboursement/i
      })
    ).toBeVisible();

    await page
      .getByRole('link', { name: /Contacter le support/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/support/);
    await expect(
      page.getByRole('heading', { name: /Construire OpenG7 avec/i })
    ).toBeVisible();
  });
});
