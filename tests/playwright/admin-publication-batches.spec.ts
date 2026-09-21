import type { Page } from '@playwright/test';

import { expect, test } from './support/test.js';
import { SPONSORSHIP_FIXTURES } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';

// Exercises the real admin API through final content approval. Sending/recovery
// is covered separately with disposable PostgreSQL and synthetic provider responses.

async function openSpace(
  page: Page,
  space: 'drafts' | 'batches' | 'calendar'
): Promise<void> {
  const drawer = page.locator('[data-og7="admin-drawer"][open]');
  if (await drawer.count()) await drawer.getByRole('button').first().click();
  await page.locator('[data-og7="publications-home"]').click();
  await page
    .locator('[data-og7="publication-space"][data-og7-id="' + space + '"]')
    .click();
}

async function openBatch(page: Page, id: string | null): Promise<void> {
  await page
    .locator(
      '[data-og7="calendar-entry"][data-og7-id="' +
        id +
        '"], [data-og7="calendar-undated-entry"][data-og7-id="' +
        id +
        '"]'
    )
    .click();
}

test.describe('Docker admin publication batches', () => {
  test('creates a draft, assigns a calendar slot and authorizes its final content', async ({
    page
  }) => {
    await signInAsAdmin(page);

    const fixture = SPONSORSHIP_FIXTURES.publicationBatch;
    await page.goto('/admin/fundraiser/publications/drafts');
    await page
      .getByRole('button', { name: 'Préparer une publication', exact: true })
      .click();

    const eligibleCard = page.locator('.eligible-list article', {
      hasText: fixture.companyName
    });
    await expect(eligibleCard).toBeVisible();
    await eligibleCard
      .getByRole('button', { name: 'Facebook', exact: true })
      .click();

    const draftCard = page.locator('[data-og7="publication-draft"]', {
      hasText: fixture.companyName
    });
    await expect(draftCard).toBeVisible();

    await draftCard
      .getByLabel('Titre')
      .fill('E2E Playwright: titre de publication de test.');
    await draftCard
      .getByLabel('Texte')
      .fill('E2E Playwright: texte de publication de test automatise.');
    await draftCard
      .getByLabel('Divulgation')
      .fill('Commandite payante divulguee pour un test automatise.');
    await draftCard.getByText('Autres actions', { exact: true }).click();
    await draftCard
      .getByRole('button', { name: 'Approuver', exact: true })
      .click();

    await expect(
      draftCard.getByText('Approuvee', { exact: true })
    ).toBeVisible();

    await openSpace(page, 'batches');
    await page
      .getByRole('button', { name: 'Nouveau lot', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Creer un lot', exact: true })
      .click();

    const batchCard = page.locator('[data-og7="publication-batch"]').first();
    await expect(batchCard).toBeVisible();
    const batchId = await batchCard.getAttribute('data-og7-id');
    await expect(batchCard).toContainText('Ouvert');
    await expect(batchCard).toContainText('Facebook - 0/5');
    await openSpace(page, 'drafts');

    // batchCard becoming visible with the right text only proves the batch
    // list refreshed -- it does not prove the draft's own "Lot" dropdown has
    // picked up the new option yet. getByLabel/getByRole('option') on a
    // closed native <select> reads Chromium's accessibility tree, which does
    // not reliably expose <option> nodes while the dropdown isn't open
    // (confirmed by CI: the option was present in the DOM by teardown time,
    // yet toBeAttached() on the accessible-role locator still timed out) --
    // use a plain DOM locator instead, and select by label so this still
    // works if a retry left a previous attempt's batch behind.
    const lotSelect = draftCard.locator('label.inline select');
    await expect(
      lotSelect.locator('option', { hasText: 'Facebook (0/5)' }).first()
    ).toBeAttached();
    await lotSelect.selectOption({ label: 'Facebook (0/5)' });
    await draftCard
      .getByRole('button', { name: 'Assigner au lot', exact: true })
      .click();

    await expect(draftCard.getByText(/Dans un lot \(Ouvert\)/i)).toBeVisible();
    await openSpace(page, 'batches');
    await openBatch(page, batchId);
    await expect(batchCard).toContainText('Facebook - 1/5');
    await openSpace(page, 'calendar');
    await page
      .getByRole('button', { name: 'Nouveau créneau', exact: true })
      .click();

    const slotStartsAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 16);
    await page
      .locator('.slot-create-form')
      .getByLabel('Date et heure')
      .fill(slotStartsAt);
    await page
      .getByRole('button', { name: 'Creer un creneau', exact: true })
      .click();

    const slotCard = page
      .locator('[data-og7="publication-slot"]', {
        hasText: 'OpenG7 / Facebook'
      })
      .first();
    await expect(slotCard).toBeVisible();
    await expect(slotCard).toContainText('0/5');

    const slotBatchSelect = slotCard.locator('label.inline select').first();
    await expect(
      slotBatchSelect.locator('option', { hasText: 'Facebook (1/5)' }).first()
    ).toBeAttached();
    await slotBatchSelect.selectOption({ label: 'Facebook (1/5)' });
    await slotCard
      .getByRole('button', { name: 'Assigner le lot', exact: true })
      .click();

    await expect(slotCard).toContainText('1/5');
    await openSpace(page, 'batches');
    await page.getByLabel('Choisir un mois').fill(slotStartsAt.slice(0, 7));
    await openBatch(page, batchId);
    await expect(batchCard).toContainText('Planifie');

    await batchCard
      .getByRole('button', { name: 'Préparer l’envoi', exact: true })
      .click();
    const preview = page.getByRole('dialog', { name: 'Publication finale' });
    await expect(preview).toBeVisible();
    await preview.getByRole('button', { name: 'Fermer', exact: true }).click();
    await page
      .locator('[data-og7="publication-feed-settings"] summary')
      .click();
    const feed = page
      .locator('[data-og7="publication-automation"] article')
      .filter({ hasText: 'OPENG7' })
      .filter({ hasText: 'Facebook' });
    await feed.getByRole('button', { name: 'Réglages', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Réglages' });
    await settings
      .getByRole('button', { name: 'Vérifier la connexion', exact: true })
      .click();
    await expect(settings.getByRole('status')).toContainText(
      'Connexion vérifiée'
    );
    await settings.getByRole('button', { name: 'Fermer', exact: true }).click();
    await page
      .locator('[data-og7="publication-automation"] .job')
      .first()
      .click();
    await preview.getByRole('checkbox', { name: /J’approuve/ }).check();
    await preview.getByRole('button', { name: 'Autoriser cet envoi' }).click();
    await expect(preview).toContainText('Autorisée');
    await expect(preview).toContainText('Simulation');
    await preview.getByRole('button', { name: 'Fermer', exact: true }).click();
    await page
      .getByRole('button', { name: 'Programmées', exact: true })
      .click();
    await expect(
      page.locator('[data-og7="publication-automation"] .job')
    ).not.toHaveCount(0);
  });
});
