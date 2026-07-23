import { expect, test } from './support/test.js';

// Covers the individual/personal contribution path (the default tier on
// /fonds-des-batisseurs). It shares the same mocked-checkout and consent
// machinery as the business sponsorship flow already covered by
// sponsor-navigation.spec.ts, but returns without a sponsor follow-up token.

test.describe('Docker personal donation navigation', () => {
  test('selects the personal contribution tier and completes the mocked checkout', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs');

    const personalCard = page.getByRole('button', {
      name: /Contribution personnelle/i
    });
    await personalCard.click();
    await expect(personalCard).toHaveAttribute('aria-pressed', 'true');

    const submitButton = page
      .locator('#support')
      .getByRole('button', { name: /Soutenir OpenG7/i });
    await expect(submitButton).toBeDisabled();

    await page.getByRole('button', { name: '25 $', exact: true }).click();

    await page
      .getByLabel(/OpenG7 est un projet ind.pendant en d.veloppement/i)
      .check();
    await expect(submitButton).toBeEnabled();

    await submitButton.click();
    await expect(
      page.getByText(/Mode local ?: Stripe n.a pas ouvert de session r.elle/i)
    ).toBeVisible();
  });

  test('arrives at the personal contribution success state without a sponsor follow-up token', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs?checkout=success');

    await expect(
      page.getByRole('heading', {
        name: /Le coffre des B.tisseurs vient de recevoir votre contribution/i
      })
    ).toBeVisible();

    // The sponsor follow-up stage only renders when a followup_token query
    // param is present -- confirms the two checkout=success states stay
    // distinct (apps/funding-web funding-page.component.ts showSponsorFollowUp).
    await expect(
      page.getByRole('link', { name: /Compl.ter le suivi commanditaire/i })
    ).toHaveCount(0);
  });
});
