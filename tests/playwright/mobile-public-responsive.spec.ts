import { expect, test } from './support/test.js';

// Mobile responsive smoke for the critical PUBLIC journeys, run on an emulated
// Pixel 5 by the `mobile-chrome` project (playwright.config.ts). Everything
// here is read-only: it navigates public pages and exercises the LOCAL mocked
// checkout, which never opens a real Stripe session and never writes a
// contribution row. Because it writes nothing, it is safe to run on a second
// browser/viewport in addition to the desktop suite -- unlike the admin,
// webhook, accounting and backfill specs, which mutate the shared database and
// therefore stay desktop-only (they carry no @mobile tag).
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

    // Local mock: no real Stripe session, no contribution row written.
    await expect(
      page.getByText(/Mode local ?: Stripe n.a pas ouvert de session r.elle/i)
    ).toBeVisible();
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
