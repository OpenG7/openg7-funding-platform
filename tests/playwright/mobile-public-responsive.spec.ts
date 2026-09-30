import { expect, test } from './support/test.js';

// Mobile responsive smoke for the critical PUBLIC journeys, run on an emulated
// Pixel 5 by the `mobile-chrome` project (playwright.config.ts). The checkout
// uses the configured local simulation and stops before confirming payment.
// It can create a pending contribution on the disposable stack, but never a
// real Stripe session or a paid contribution. Financial mutations stay in the
// desktop-only webhook, accounting and backfill specs (without @mobile).
//
// The @mobile tag is what routes these tests: the mobile-chrome project greps
// for it, and the desktop chromium project greps it out.

// Reports how many pixels the document overflows its own viewport width. A
// small tolerance absorbs sub-pixel rounding; a real horizontal-scroll
// regression on a phone-width layout produces a much larger value.
const horizontalOverflowPx = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });

test.describe('Mobile public responsive', { tag: '@mobile' }, () => {
  test('emulates a phone-width viewport for this project', async ({ page }) => {
    await page.goto('/fonds-des-batisseurs');

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    // Guards that the mobile-chrome project is actually emulating a phone; a
    // desktop viewport here would mean the device profile did not apply.
    expect(viewport!.width).toBeLessThan(500);
  });

  test('renders the funding home without horizontal overflow', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs');

    await expect(
      page.getByRole('heading', { name: /13 outils\./i })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Choisissez votre contribution/i })
    ).toBeVisible();

    expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(2);
  });

  test('completes the mocked personal checkout on a phone viewport', async ({
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

    if (process.env.OPENG7_E2E_ISOLATED === '1') {
      await expect(page).toHaveURL(/\/checkout\/cs_test_/);
      expect(new URL(page.url()).origin).toBe(process.env.STRIPE_STUB_BASE_URL);
      await expect(
        page.getByRole('heading', { name: 'Checkout simulé' })
      ).toBeVisible();
      await expect(page.getByText(/Contribution : 25\.00 CAD/)).toBeVisible();
    } else {
      await expect(
        page.getByText(/Mode local ?: Stripe n.a pas ouvert de session r.elle/i)
      ).toBeVisible();
    }
  });

  test('renders the public sponsors page without private fields or overflow', async ({
    page
  }) => {
    await page.goto('/commanditaires');

    await expect(
      page.getByRole('heading', { name: /Commanditaires OpenG7/i })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Commanditaires publics/i })
    ).toBeVisible();

    await expect(page.locator('body')).not.toContainText(
      /sponsor_contact_email|email_private|stripe_session_id|stripe_payment_intent_id/i
    );

    expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(2);
  });

  test('keeps an invalid sponsorship follow-up token private on mobile', async ({
    page
  }) => {
    await page.goto('/fonds-des-batisseurs/suivi-commandite?token=invalid');

    await expect(
      page.getByRole('heading', { name: /Lien introuvable/i })
    ).toBeVisible();
    await expect(page.getByText(/absent, invalide ou expir/i)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/stripe_session/i);

    expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(2);
  });

  test('redirects a protected admin route to the login page on mobile', async ({
    page
  }) => {
    await page.goto('/admin/fundraiser/sponsors');

    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(
      page.getByRole('heading', { name: /Acces admin/i })
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(
      /Commanditaires \/ partenaires/i
    );

    expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(2);
  });
});
