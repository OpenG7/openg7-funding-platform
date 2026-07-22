import { expect, test } from '@playwright/test';

import { SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { openFixtureSponsorship, signInAsAdmin } from './support/admin-auth.js';

test.describe('Docker admin sponsorship review', () => {
  test('rejects an invalid admin token and stays on the login page', async ({
    page
  }) => {
    await page.goto('/admin/login');

    await page.getByLabel(/Jeton admin/i).fill('not-the-admin-token');
    await page.getByRole('button', { name: /Se connecter/i }).click();

    await expect(page.getByText(/Connexion refusee/i)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('logs in with a valid admin token and lists the seeded sponsorship', async ({
    page
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.approve;
    await page.getByLabel(/Recherche/i).fill(fixture.companyName);
    await expect(
      page.getByRole('button', { name: new RegExp(fixture.companyName) })
    ).toBeVisible();
  });

  test('approves a paid sponsorship from the detail panel', async ({
    page
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.approve;
    await openFixtureSponsorship(page, fixture.companyName);

    await page.getByRole('button', { name: 'Accepter' }).click();

    await expect(
      page.getByText('Action confirmee: commandite acceptee.')
    ).toBeVisible();
  });

  test('rejects a paid sponsorship with an internal reason', async ({
    page
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.reject;
    await openFixtureSponsorship(page, fixture.companyName);

    await page.getByRole('button', { name: 'Refuser' }).click();
    await page
      .getByLabel(/Raison interne du refus/i)
      .fill('E2E Playwright: refus de test automatise.');
    await page.getByRole('button', { name: /Confirmer le refus/i }).click();

    await expect(
      page.getByText('Action confirmee: commandite refusee.')
    ).toBeVisible();
  });

  test('resets an approved sponsorship back to pending review', async ({
    page
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.approve;
    await openFixtureSponsorship(page, fixture.companyName);

    await page.getByRole('button', { name: 'Remettre en attente' }).click();

    await expect(
      page.getByText('Action confirmee: commandite remise en attente.')
    ).toBeVisible();
  });

  test('generates missing sponsorship invoices and downloads the invoice PDF', async ({
    page
  }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/invoices');

    await page
      .getByRole('button', { name: /Generer factures manquantes/i })
      .click();

    const fixture = SPONSORSHIP_FIXTURES.approve;
    await page
      .getByRole('button', { name: new RegExp(fixture.companyName) })
      .click();

    const downloadPromise = page.waitForEvent('download');
    await page
      .locator('.detail-header')
      .getByRole('button', { name: /Telecharger PDF/i })
      .click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^openg7-.*\.pdf$/);
  });

  // Depends on the invoice backfill from the previous test having already
  // created a sponsorship_invoices row for this fixture: the credit note the
  // dev-mode refund mock generates is only attached to an existing invoice
  // (apps/funding-api/src/sponsorship-invoices.repository.ts).
  test('completes a Stripe refund and downloads the generated credit note PDF', async ({
    page
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.refund;
    await openFixtureSponsorship(page, fixture.companyName);

    await page.getByRole('button', { name: 'Rembourser Stripe' }).click();

    const refundPanel = page.locator('[aria-label="Remboursement Stripe"]');
    await expect(refundPanel).toBeVisible();
    await refundPanel
      .getByLabel(/Texte de confirmation/i)
      .fill(fixture.publicReference);
    await refundPanel
      .getByRole('button', { name: 'Rembourser Stripe' })
      .click();

    await expect(page.getByText(/Avoir cree:/i)).toBeVisible();

    await page.goto('/admin/fundraiser/invoices');
    await page
      .getByRole('button', { name: new RegExp(fixture.companyName) })
      .click();

    const downloadPromise = page.waitForEvent('download');
    await page
      .locator('.credit-note-card')
      .getByRole('button', { name: /Telecharger PDF/i })
      .click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^openg7-.*\.pdf$/);
  });
});
