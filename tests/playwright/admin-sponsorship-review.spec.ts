import type { APIRequestContext, Page } from '@playwright/test';
import type {
  AdminSponsorshipRecord,
  AdminSponsorshipsResponse,
  SponsorshipMediaResponse
} from '@openg7/funding-core';

import { rejectAcceptanceSponsorship } from './support/acceptance-oidc-moderation.js';
import { expect, test } from './support/test.js';
import { SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import {
  adminSessionHeaders,
  openFixtureSponsorship,
  signInAsAdmin
} from './support/admin-auth.js';
import {
  approveCurrentModeration,
  completeModeration
} from './support/moderation.js';

const independentReviewMessage =
  'Cette décision nécessite la confirmation d’une autre personne habilitée. Les restrictions restent en place pendant cette revue indépendante.';

const financialState = (record: AdminSponsorshipRecord) => ({
  amount: record.amount,
  currency: record.currency,
  paymentStatus: record.payment_status,
  refundStatus: record.sponsorship_refund_status,
  refundRequestedAt: record.sponsorship_refund_requested_at,
  refundProcessedAt: record.sponsorship_refund_processed_at,
  refundId: record.sponsorship_refund_id,
  refundAmount: record.sponsorship_refund_amount,
  refundReason: record.sponsorship_refund_reason,
  refundNote: record.sponsorship_refund_note,
  refundError: record.sponsorship_refund_error,
  refundCompletedAt: record.sponsorship_refund_completed_at
});

async function storedSponsorship(
  request: APIRequestContext,
  reference: string
): Promise<AdminSponsorshipRecord> {
  const response = await request.get(
    '/api/admin/sponsorships?search=' + encodeURIComponent(reference),
    { headers: await adminSessionHeaders(request) }
  );
  expect(response.ok(), await response.text()).toBe(true);
  const records = (await response.json()) as AdminSponsorshipsResponse;
  const exact = records.items.filter(
    (item) => item.public_reference === reference
  );
  expect(exact).toHaveLength(1);
  return exact[0]!;
}

async function confirmPendingRejection(
  page: Page,
  request: APIRequestContext,
  before: AdminSponsorshipRecord
): Promise<void> {
  const reviewed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/admin/sponsorships/review') &&
      response.request().method() === 'POST' &&
      response.request().postDataJSON().contributionId === before.id
  );
  await completeModeration(page, true);
  const response = await reviewed;
  expect(response.ok(), await response.text()).toBe(true);
  expect(await response.json()).toMatchObject({
    decisionState: 'pending_independent_review',
    reviewStatus: before.sponsor_review_status
  });
  expect(response.request().postDataJSON()).toMatchObject({
    contributionId: before.id,
    reviewStatus: 'rejected',
    moderationDecision: { level: 'N4', confirmation: before.id }
  });
  await expect(page.getByText(independentReviewMessage)).toBeVisible();
  const after = await storedSponsorship(request, before.public_reference!);
  expect(after.sponsor_review_status).toBe(before.sponsor_review_status);
  expect(financialState(after)).toEqual(financialState(before));
}

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
    await page
      .getByLabel('Recherche', { exact: true })
      .fill(fixture.companyName);
    await expect(
      page.getByRole('button', { name: new RegExp(fixture.companyName) })
    ).toBeVisible();
  });

  test('approves a paid sponsorship from the detail panel', async ({
    page,
    request
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.approve;
    const seeded = await storedSponsorship(request, fixture.publicReference);
    const mediaResponse = await request.get(
      '/api/admin/sponsorships/media?contributionId=' + seeded.id,
      { headers: await adminSessionHeaders(request) }
    );
    expect(mediaResponse.ok()).toBe(true);
    const presentation = (
      (await mediaResponse.json()) as SponsorshipMediaResponse
    ).assets.filter((asset) => asset.kind === 'supporting_image');
    expect(presentation).toHaveLength(1);
    await approveCurrentModeration(request, {
      type: 'media',
      id: presentation[0]!.id
    });
    await openFixtureSponsorship(page, fixture.companyName);

    await page.getByRole('button', { name: 'Accepter' }).click();
    await completeModeration(page);

    await expect(
      page.getByText('Action confirmee: commandite acceptee.')
    ).toBeVisible();
  });

  test('proposes a paid sponsorship rejection pending independent review without changing financial facts', async ({
    page,
    request
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.reject;
    const before = await storedSponsorship(request, fixture.publicReference);
    await openFixtureSponsorship(page, fixture.companyName);

    await page.getByRole('button', { name: 'Refuser' }).click();
    await page
      .getByLabel(/Justification interne/i)
      .fill('E2E Playwright: refus de test automatise.');
    await page.getByRole('button', { name: /Confirmer le refus/i }).click();
    await confirmPendingRejection(page, request, before);
  });

  test('places an approved sponsorship under editorial hold without changing financial facts', async ({
    page,
    request
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.approve;
    const before = await storedSponsorship(request, fixture.publicReference);
    await openFixtureSponsorship(page, fixture.companyName);

    // Confirm the reviewed administrative action in the shared dialog.
    await page.getByRole('button', { name: 'Remettre en attente' }).click();
    await page.locator('[data-og7="confirm-action"]').click();
    const reviewed = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/sponsorships/review') &&
        response.request().method() === 'POST' &&
        response.request().postDataJSON().contributionId === before.id
    );
    await completeModeration(page, true);
    const response = await reviewed;
    expect(response.ok(), await response.text()).toBe(true);
    expect(await response.json()).toMatchObject({
      decisionState: 'active',
      reviewStatus: before.sponsor_review_status
    });
    expect(response.request().postDataJSON()).toMatchObject({
      reviewStatus: 'pending_review',
      moderationDecision: { level: 'N2', confirmation: before.id }
    });

    await expect(
      page.getByText('Action confirmee: commandite remise en attente.')
    ).toBeVisible();
    const after = await storedSponsorship(request, fixture.publicReference);
    expect(after.sponsor_review_status).toBe(before.sponsor_review_status);
    expect(financialState(after)).toEqual(financialState(before));
  });

  test('generates missing sponsorship invoices and downloads the invoice PDF', async ({
    page
  }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/invoices');

    await page
      .getByRole('button', { name: /Generer factures manquantes/i })
      .click();
    await page.locator('[data-og7="confirm-action"]').click();

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
    await page.getByRole('button', { name: 'Finances', exact: true }).click();

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
    await page.getByRole('button', { name: 'Finances', exact: true }).click();

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

    await page.getByRole('button', { name: 'Aperçu', exact: true }).click();
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

  test('a proposed rejection cannot mark a manual refund completed before independent review', async ({
    page,
    request
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.rejectRefund;
    const before = await storedSponsorship(request, fixture.publicReference);
    await openFixtureSponsorship(page, fixture.companyName);

    await page.getByRole('button', { name: 'Refuser' }).click();
    await page
      .getByLabel(/Justification interne/i)
      .fill('E2E Playwright: refus avec remboursement deja traite.');
    // Choosing a manual refund outcome cannot finalize a pending N4 decision
    // or write financial facts without the required independent review.
    await page.getByLabel(/^Remboursement/i).selectOption('manual_completed');
    await page.getByRole('button', { name: /Confirmer le refus/i }).click();

    await confirmPendingRejection(page, request, before);
  });

  test('an identified rejection becomes effective only after independent review without changing financial facts', async ({
    browser,
    request
  }) => {
    const fixture = SPONSORSHIP_FIXTURES.independentReject;
    const before = await storedSponsorship(request, fixture.publicReference);
    await rejectAcceptanceSponsorship(
      browser,
      fixture.publicReference,
      'Synthetic independently confirmed rejection.'
    );
    const after = await storedSponsorship(request, fixture.publicReference);
    expect(after.sponsor_review_status).toBe('rejected');
    expect(financialState(after)).toEqual(financialState(before));
  });

  test('an independently confirmed rejection records the separately confirmed manual refund outcome', async ({
    page,
    browser,
    request
  }) => {
    const fixture = SPONSORSHIP_FIXTURES.independentRejectRefund;
    const before = await storedSponsorship(request, fixture.publicReference);
    await rejectAcceptanceSponsorship(
      browser,
      fixture.publicReference,
      'Synthetic rejection with a separately confirmed manual refund.',
      'manual_completed'
    );
    const after = await storedSponsorship(request, fixture.publicReference);
    expect(after).toMatchObject({
      sponsor_review_status: 'rejected',
      payment_status: before.payment_status,
      amount: before.amount,
      currency: before.currency,
      sponsorship_refund_status: 'completed'
    });
    await signInAsAdmin(page);
    await openFixtureSponsorship(page, fixture.companyName);
    const header = page.locator('openg7-admin-sponsor-detail-header');
    await expect(
      header.getByRole('heading', { name: fixture.companyName, exact: true })
    ).toBeVisible();
    await expect(
      header.getByText('Remboursement complete', { exact: true })
    ).toBeVisible();
  });

  test('uploads and deletes a sponsorship logo', async ({ page }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.logo;
    await openFixtureSponsorship(page, fixture.companyName);

    await page
      .getByRole('button', { name: 'Fiche et médias', exact: true })
      .click();
    const media = page.locator('openg7-admin-sponsor-detail-media');

    // The upload control is a <label> wrapping the file input, not a button.
    await expect(media.getByText('Televerser un logo')).toBeVisible();

    // The API detects the file type from magic bytes, not the declared MIME
    // type (detectSponsorLogoFileType in apps/funding-api/src/main.ts), so
    // this must be real PNG bytes -- a minimal valid 1x1 transparent PNG.
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    );
    await media.locator('input[type="file"]').setInputFiles({
      name: 'e2e-playwright-logo.png',
      mimeType: 'image/png',
      buffer: onePixelPng
    });

    await expect(media.getByText(/Logo enregistre/i)).toBeVisible();
    await expect(
      media.getByRole('img', { name: `Logo ${fixture.companyName}` })
    ).toBeVisible();
    await expect(media.getByText('Remplacer le logo')).toBeVisible();

    await media.getByRole('button', { name: 'Supprimer le logo' }).click();
    await page.locator('[data-og7="confirm-action"]').click();

    await expect(
      media.getByText('Logo supprime.', { exact: true })
    ).toBeVisible();
    await expect(media.getByText('Televerser un logo')).toBeVisible();
  });
});
