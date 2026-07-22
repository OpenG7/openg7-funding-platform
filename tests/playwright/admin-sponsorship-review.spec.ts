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

    // Resetting an already-reviewed sponsorship back to pending goes through a
    // native window.confirm() guard (admin-sponsors-page.component.ts); it must
    // be accepted or Playwright auto-dismisses it and the click is a no-op.
    page.once('dialog', (dialog) => void dialog.accept());
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

  test('completes a partial Stripe refund without marking the sponsorship as fully refunded', async ({
    page
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.partialRefund;
    await openFixtureSponsorship(page, fixture.companyName);

    await page.getByRole('button', { name: 'Rembourser Stripe' }).click();

    const refundPanel = page.locator('[aria-label="Remboursement Stripe"]');
    await expect(refundPanel).toBeVisible();

    const partialAmount = fixture.amountCents / 100 / 2;
    await refundPanel
      .getByLabel(/Montant a rembourser/i)
      .fill(String(partialAmount));
    await refundPanel
      .getByLabel(/Texte de confirmation/i)
      .fill(fixture.publicReference);
    await refundPanel
      .getByRole('button', { name: 'Rembourser Stripe' })
      .click();

    await expect(
      page.getByText(/Remboursement Stripe partiel cree:/i)
    ).toBeVisible();
    await expect(page.getByText(/Avoir cree:/i)).toBeVisible();

    // A partial refund must not flip the sponsorship's own payment status to
    // "refunded" -- only a full refund does that
    // (apps/funding-api/src/main.ts calls updateContributionStatusByPaymentIntent
    // only when isFullRefund). Read the isolated "Paiement" definition inside
    // the "Commandite" card rather than substring-checking the whole row: the
    // row's flattened text also contains the unrelated refund *workflow*
    // status ("Remboursement complete"), which itself contains the substring
    // "Rembourse" and would make a naive not.toContainText('Rembourse') fail
    // even though the payment status is correctly still "Paye". The sidebar
    // search filter also has its own "Paye"/"Rembourse" <option> text, which
    // rules out a bare exact-text match too. hasText does a case-insensitive
    // substring match, so an unanchored 'Paiement' also matches the "Date de
    // paiement" term -- anchor it to match only the exact "Paiement" term.
    const paymentStatus = page
      .locator('article', {
        has: page.getByRole('heading', { name: 'Commandite', exact: true })
      })
      .locator('dt', { hasText: /^Paiement$/ })
      .locator('xpath=following-sibling::dd[1]');
    await expect(paymentStatus).toHaveText('Paye');
  });

  test('rejects a sponsorship and marks the refund as already handled manually', async ({
    page
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.rejectRefund;
    await openFixtureSponsorship(page, fixture.companyName);

    await page.getByRole('button', { name: 'Refuser' }).click();
    await page
      .getByLabel(/Raison interne du refus/i)
      .fill('E2E Playwright: refus avec remboursement deja traite.');
    // Distinct code path from the Stripe-guided refund panel tested above:
    // this is a DB-only flag recorded alongside the rejection, no Stripe
    // call involved (apps/funding-api/src/main.ts, isRejection branch of the
    // /admin/sponsorships/review handler). A <label> wrapping a <select>
    // computes its accessible name as the label text plus the select's own
    // name (the currently selected option's text), e.g. "RemboursementNe pas
    // rembourser maintenant" -- so anchor to the start only (^Remboursement,
    // no trailing $) rather than an exact match, which would never match.
    // That start-anchor still excludes "Note remboursement" (starts with
    // "Note", not "Remboursement").
    await page
      .getByLabel(/^Remboursement/i)
      .selectOption('manual_completed');
    await page.getByRole('button', { name: /Confirmer le refus/i }).click();

    await expect(
      page.getByText(/Remboursement marque comme deja traite/i)
    ).toBeVisible();
    await expect(
      page.getByText(/Suivi: Remboursement complete/i)
    ).toBeVisible();
  });

  test('uploads and deletes a sponsorship logo', async ({ page }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.logo;
    await openFixtureSponsorship(page, fixture.companyName);

    await page
      .getByRole('button', { name: 'Identite & logo', exact: true })
      .click();

    // The upload control is a <label> wrapping the file input, not a button.
    await expect(page.getByText('Televerser un logo')).toBeVisible();

    // The API detects the file type from magic bytes, not the declared MIME
    // type (detectSponsorLogoFileType in apps/funding-api/src/main.ts), so
    // this must be real PNG bytes -- a minimal valid 1x1 transparent PNG.
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: 'e2e-playwright-logo.png',
      mimeType: 'image/png',
      buffer: onePixelPng
    });

    await expect(page.getByText(/Logo enregistre/i)).toBeVisible();
    await expect(
      page.getByRole('img', { name: `Logo ${fixture.companyName}` })
    ).toBeVisible();
    await expect(page.getByText('Remplacer le logo')).toBeVisible();

    // Deleting a logo goes through a native window.confirm() guard, the same
    // pattern already hit for the reset-to-pending-review action -- accept it
    // or Playwright auto-dismisses it and the click is a no-op.
    page.once('dialog', (dialog) => void dialog.accept());
    await page
      .getByRole('button', { name: 'Supprimer le logo' })
      .click();

    await expect(page.getByText(/Logo supprime/i)).toBeVisible();
    await expect(page.getByText('Televerser un logo')).toBeVisible();
  });
});
