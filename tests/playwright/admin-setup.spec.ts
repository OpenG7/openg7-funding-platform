import { expect, test } from './support/test.js';
import { signInAsAdmin } from './support/admin-auth.js';

// Covers admin-setup-page.component.ts: a read-only operational-readiness
// dashboard (Stripe/Email/Queue/Database), one real write action (the
// "Envoyer un test" email button), and an 8-step guided tour overlay.
//
// getTransactionalEmailConfigStatus() (apps/funding-api/src/services/email
// /email.config.ts) only reports `configured: true` when SMTP_ENABLED is
// true *and* host/user/password are all set. Disposable acceptance configures
// a local SMTP sink; docker-compose.yml defaults SMTP_ENABLED to false.

test.describe('Docker admin setup', () => {
  test('renders the readiness overview and configuration panels', async ({
    page
  }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/setup');

    await expect(
      page.getByRole('heading', { name: 'Configuration et état du système' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Paiements et webhooks' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'SMTP et expediteur' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Envois et retries' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Base et environnement' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Cles a verifier' })
    ).toBeVisible();
  });

  test('matches email test availability to the configured SMTP fixture', async ({
    page
  }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/setup');

    const send = page.getByRole('button', {
      name: 'Envoyer un test',
      exact: true
    });
    const unavailable = page.getByText(
      'Le test demande DATABASE_URL, migration 010, SMTP_ENABLED=true et SMTP_PASSWORD.',
      { exact: true }
    );
    if (process.env.OPENG7_E2E_ISOLATED === '1') {
      await expect(send).toBeEnabled();
      await expect(unavailable).toBeHidden();
    } else {
      await expect(send).toBeDisabled();
      await expect(unavailable).toBeVisible();
    }
  });

  test('walks through the setup guide from start to finish, then reopens it to close via the close button', async ({
    page
  }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/setup');

    const dialog = page.getByRole('dialog');
    const titles = [
      'Vue de controle',
      'Etat rapide',
      'Préparation des accès OIDC',
      'Paiement Stripe',
      'Courriel applicatif',
      'File et retries',
      'Execution',
      'Checklist finale'
    ];

    await page.getByRole('button', { name: 'Guide', exact: true }).click();
    await expect(dialog).toBeVisible();

    for (const [index, title] of titles.entries()) {
      await expect(
        dialog.getByText(`Etape ${index + 1} / ${titles.length}`, {
          exact: true
        })
      ).toBeVisible();
      await expect(dialog.getByRole('heading', { name: title })).toBeVisible();

      if (index === 0) {
        await expect(
          dialog.getByRole('button', { name: 'Retour', exact: true })
        ).toBeDisabled();
      }

      const isLastStep = index === titles.length - 1;
      await dialog
        .getByRole('button', {
          name: isLastStep ? 'Terminer' : 'Suivant',
          exact: true
        })
        .click();
    }

    await expect(dialog).not.toBeVisible();

    await page.getByRole('button', { name: 'Guide', exact: true }).click();
    await expect(dialog).toBeVisible();
    await page
      .getByRole('button', { name: 'Fermer le guide', exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
  });

  test('shows an error state when the setup status request fails and recovers on refresh', async ({
    page
  }) => {
    await signInAsAdmin(page);

    await page.route('**/admin/setup-status', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}'
      })
    );
    await page.goto('/admin/fundraiser/setup');

    await expect(
      page.getByText(/Impossible de charger le setup admin/i)
    ).toBeVisible();

    await page.unroute('**/admin/setup-status');
    await page.getByRole('button', { name: 'Actualiser', exact: true }).click();

    await expect(
      page.getByText(/Impossible de charger le setup admin/i)
    ).not.toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Configuration et état du système' })
    ).toBeVisible();
  });
});
