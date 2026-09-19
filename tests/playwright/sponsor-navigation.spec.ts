import type {
  PublicSponsorshipsResponse,
  SponsorshipFollowupResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
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

  test('shows a client-side error and blocks checkout for a custom sponsorship amount below the minimum', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs');

    await page
      .getByRole('button', { name: /Commandite d'entreprise/i })
      .click();

    await page.locator('#custom-contribution').fill('10');
    await expect(
      page.getByText(/Le montant minimal pour une commandite est de 50 \$\./i)
    ).toBeVisible();

    await page
      .getByLabel(/OpenG7 est un projet ind.pendant en d.veloppement/i)
      .check();

    await expect(
      page.locator('#support').getByRole('button', { name: /Soutenir OpenG7/i })
    ).toBeDisabled();
  });

  test('opens sponsor follow-up while payment remains pending after the browser redirect', async ({
    page
  }) => {
    const followupToken = 'e2e-playwright-checkout-return-deep-link-token-00';

    await page.goto(
      `/fonds-des-batisseurs?checkout=success&contributionType=sponsorship_interest&followup_token=${followupToken}`
    );

    await expect(
      page.getByRole('heading', {
        name: /Votre paiement est en cours de confirmation/i
      })
    ).toBeVisible();

    const cta = page.getByRole('link', {
      name: /Compl.ter le suivi commanditaire/i
    });
    await expect(cta).toHaveAttribute(
      'href',
      new RegExp(
        `/fonds-des-batisseurs/suivi-commandite\\?token=${followupToken}`
      )
    );
  });

  // This approved fixture is read-only: editing uses its own record below.
  test('lists the approved sponsorship in the public directory reachable from the header navigation', async ({
    page
  }) => {
    const fixture = SPONSORSHIP_FIXTURES.directory;

    await page.goto('/fonds-des-batisseurs');
    await page
      .locator('nav')
      .getByRole('link', { name: 'Commanditaires' })
      .click();

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

  test('persists follow-up changes, returns the approved dossier to review and removes its public listing', async ({
    page,
    request
  }) => {
    const fixture = SPONSORSHIP_FIXTURES.followupEditing;
    const publicProfiles = async () => {
      const response = await request.get('/api/public/sponsorships');
      expect(response.ok()).toBe(true);
      return (await response.json()) as PublicSponsorshipsResponse;
    };
    expect(
      (await publicProfiles()).sponsorships.some(
        (item) => item.company_name === fixture.companyName
      )
    ).toBe(true);

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
    await expect(page).not.toHaveURL(/token=/);
    await expect(page.getByLabel(/Nom de l'entreprise/i)).toBeDisabled();

    await page
      .getByRole('button', { name: /Modifier mes informations/i })
      .click();
    await expect(
      page.getByRole('button', { name: /Enregistrer les informations/i })
    ).toBeDisabled();
    await page
      .getByLabel(/Nom de l'entreprise/i)
      .fill(fixture.companyName + ' - mise a jour');
    await page.getByLabel(/Nom du contact/i).fill(fixture.contactName);
    await page.getByLabel(/Courriel du contact/i).fill(fixture.contactEmail);
    await page.getByLabel(/Site web/i).fill(fixture.websiteUrl);

    await page
      .getByRole('button', { name: /Enregistrer les informations/i })
      .click();

    await expect(
      page.getByRole('status').filter({ hasText: /Informations enregistr.es/i })
    ).toBeVisible();

    // Read persisted facts through the real API, independently of UI signals.
    const response = await request.get('/api/sponsorship-followup', {
      params: { token: fixture.followupToken }
    });
    expect(response.ok()).toBe(true);
    const stored = (await response.json()) as SponsorshipFollowupResponse;
    expect(stored.companyName).toBe(fixture.companyName + ' - mise a jour');
    expect(stored.paymentStatus).toBe('paid');
    expect(stored.reviewStatus).toBe('pending_review');
    expect(stored.detailsSubmitted).toBe(true);
    expect(
      (await publicProfiles()).sponsorships.some((item) =>
        item.company_name?.startsWith(fixture.companyName)
      )
    ).toBe(false);

    await page.reload();
    await expect(page.getByLabel(/Nom de l'entreprise/i)).toHaveValue(
      stored.companyName!
    );
    await expect(
      page.getByRole('button', { name: /Enregistrer les informations/i })
    ).toBeDisabled();
  });

  test('validates empty required fields show error messages and prevent form submission', async ({
    page
  }) => {
    const fixture = SPONSORSHIP_FIXTURES.directory;

    await page.goto(
      `/fonds-des-batisseurs/suivi-commandite?token=${fixture.followupToken}`
    );

    await expect(
      page.getByRole('heading', { name: /Suivi de votre commandite/i })
    ).toBeVisible();

    await page
      .getByRole('button', { name: /Modifier mes informations/i })
      .click();

    await page.getByLabel(/Nom de l'entreprise/i).fill('');
    await page.getByLabel(/Nom du contact/i).fill('');
    await page.getByLabel(/Courriel du contact/i).fill('');

    await page
      .getByRole('button', { name: /Enregistrer les informations/i })
      .click();
    await expect(page.locator('#followup-companyName-error')).toHaveText(
      "Nom de l'entreprise : ce champ est requis."
    );
    await expect(page.locator('#followup-contactName-error')).toHaveText(
      'Nom du contact : ce champ est requis.'
    );
    await expect(page.locator('#followup-contactEmail-error')).toHaveText(
      'Courriel du contact : ce champ est requis.'
    );

    await expect(page.getByLabel(/Nom de l'entreprise/i)).toBeFocused();
  });

  test('validates invalid email format shows error and prevents form submission', async ({
    page
  }) => {
    const fixture = SPONSORSHIP_FIXTURES.directory;

    await page.goto(
      `/fonds-des-batisseurs/suivi-commandite?token=${fixture.followupToken}`
    );

    await expect(
      page.getByRole('heading', { name: /Suivi de votre commandite/i })
    ).toBeVisible();

    await page
      .getByRole('button', { name: /Modifier mes informations/i })
      .click();

    await page.getByLabel(/Nom de l'entreprise/i).fill(fixture.companyName);
    await page.getByLabel(/Nom du contact/i).fill(fixture.contactName);
    await page.getByLabel(/Courriel du contact/i).fill('invalid-email');
    await page.getByLabel(/Site web/i).fill(fixture.websiteUrl);

    await expect(page.locator('#followup-contactEmail-error')).toHaveText(
      'Le courriel du contact doit être valide.'
    );

    await page
      .getByRole('button', { name: /Enregistrer les informations/i })
      .click();
    await expect(page.getByLabel(/Courriel du contact/i)).toBeFocused();
  });

  test('rejects a non-https website and prevents form submission', async ({
    page
  }) => {
    const fixture = SPONSORSHIP_FIXTURES.directory;

    await page.goto(
      `/fonds-des-batisseurs/suivi-commandite?token=${fixture.followupToken}`
    );

    await expect(
      page.getByRole('heading', { name: /Suivi de votre commandite/i })
    ).toBeVisible();

    await page
      .getByRole('button', { name: /Modifier mes informations/i })
      .click();

    await page.getByLabel(/Nom de l'entreprise/i).fill(fixture.companyName);
    await page.getByLabel(/Nom du contact/i).fill(fixture.contactName);
    await page.getByLabel(/Courriel du contact/i).fill(fixture.contactEmail);
    await page.getByLabel(/Site web/i).fill('http://invalid-http-url.com');

    await page
      .getByRole('button', { name: /Enregistrer les informations/i })
      .click();
    await expect(page.locator('#followup-websiteUrl-error')).toHaveText(
      'Site web doit commencer par https://.'
    );

    await expect(page.getByLabel(/Site web/i)).toBeFocused();
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
