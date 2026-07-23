import { expect, test } from '@playwright/test';

import { EMAIL_QUEUE_FIXTURE } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';

// Covers admin-email-queue-page.component.ts. Unlike every other admin
// page, "Relancer" (retryMessage) is a real mutating call that attempts an
// actual send -- there is no dev-mode mock for it the way the Stripe refund
// panel has one. scripts/e2e-seed.mjs now seeds one fixture row directly
// into email_messages (status 'queued') so the retry test has a
// deterministic target instead of depending on another spec file having
// already queued something through a real sponsorship action.
//
// The tests run in file order (playwright.config.ts sets fullyParallel:
// false, workers: 1) so the filter test below -- which assumes the fixture
// is still 'queued' -- runs before the retry test flips it to 'failed'.

test.describe('Docker admin email queue', () => {
  test('renders the queue summary and message list', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/email-queue');

    await expect(
      page.getByRole('heading', { name: 'File courriel' })
    ).toBeVisible();
    await expect(
      page
        .getByLabel('Resume file courriel')
        .getByText('En file', { exact: true })
    ).toBeVisible();
    await expect(
      page
        .getByLabel('Resume file courriel')
        .getByText('Echecs', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Derniers courriels' })
    ).toBeVisible();
  });

  test('filters the fixture message by search and status', async ({
    page
  }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/email-queue');

    const row = page.locator('tbody tr', {
      hasText: EMAIL_QUEUE_FIXTURE.recipientEmail
    });
    const emptyState = page.getByText('Aucun courriel trouve.', {
      exact: true
    });

    await page.getByLabel(/Recherche/i).fill(EMAIL_QUEUE_FIXTURE.recipientEmail);
    await expect(row).toBeVisible();

    await page.getByLabel('Statut').selectOption({ label: 'Envoyes' });
    await expect(emptyState).toBeVisible();

    await page.getByLabel('Statut').selectOption({ label: 'En file' });
    await expect(row).toBeVisible();

    await page.getByLabel('Statut').selectOption({ label: 'Tous' });
    await expect(row).toBeVisible();
  });

  test('retries the fixture message and reflects the failed outcome', async ({
    page
  }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/email-queue');

    const row = page.locator('tbody tr', {
      hasText: EMAIL_QUEUE_FIXTURE.recipientEmail
    });
    const statusPill = row.locator('.status-pill');
    const retryButton = row.locator('button.secondary-action');
    const retryResult = row.locator('.retry-message');

    await expect(statusPill).toHaveText('En file');

    await retryButton.click();

    // SMTP is disabled in this environment (see the EMAIL_QUEUE_FIXTURE
    // comment in fixtures/e2e-fixtures.mjs), so the retry always attempts
    // the send and fails the same way.
    await expect(retryResult).toHaveText(
      'Relance tentee, le message reste en echec.'
    );
    await expect(retryResult).toHaveClass(/error/);
    await expect(statusPill).toHaveText('Echec');
    await expect(retryButton).toBeEnabled();
  });

  test('shows an error state when the email queue request fails and recovers on refresh', async ({
    page
  }) => {
    await signInAsAdmin(page);

    await page.route('**/admin/email-queue', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}'
      })
    );
    await page.goto('/admin/fundraiser/email-queue');

    await expect(
      page.getByText('Admin email queue could not be loaded.', {
        exact: true
      })
    ).toBeVisible();

    await page.unroute('**/admin/email-queue');
    await page
      .getByRole('button', { name: 'Actualiser', exact: true })
      .click();

    await expect(
      page.getByText('Admin email queue could not be loaded.', {
        exact: true
      })
    ).not.toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'File courriel' })
    ).toBeVisible();
  });
});
