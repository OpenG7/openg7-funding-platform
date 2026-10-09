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
  if (await drawer.count()) {
    await drawer.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(drawer).toHaveCount(0);
  }
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

    const eligibleCard = page.locator(
      '[data-og7="publication-eligible-sponsor"]',
      {
        hasText: fixture.companyName
      }
    );
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
    const approveDraft = draftCard.getByRole('button', {
      name: 'Approuver',
      exact: true,
      includeHidden: true
    });
    if (await approveDraft.count()) {
      await draftCard.getByText('Autres actions', { exact: true }).click();
      await approveDraft.click();
    } else {
      await draftCard
        .getByRole('button', { name: 'Enregistrer', exact: true })
        .click();
    }

    await expect(
      draftCard.getByText('Approuvee', { exact: true })
    ).toBeVisible();
    await expect(
      draftCard.getByRole('button', { name: 'Enregistrer', exact: true })
    ).toBeEnabled();

    // Creating a draft is idempotent and can return this fixture's previous
    // assignment. Reconcile it before exercising a new batch assignment.
    const removeFromBatch = draftCard.getByRole('button', {
      name: 'Retirer du lot',
      exact: true
    });
    if (await removeFromBatch.count()) {
      await removeFromBatch.click();
      await expect(removeFromBatch).toHaveCount(0);
    }
    const lotSelect = draftCard.getByRole('combobox', {
      name: 'Lot',
      exact: true
    });
    await expect(lotSelect).toBeVisible();

    await openSpace(page, 'batches');
    await page
      .getByRole('button', { name: 'Nouveau lot', exact: true })
      .click();
    const batchCreated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/admin/publication-batches' &&
        response.request().method() === 'POST'
    );
    await page
      .getByRole('button', { name: 'Creer un lot', exact: true })
      .click();

    const batchResponse = await batchCreated;
    expect(batchResponse.status()).toBe(200);
    const batchId = (await batchResponse.json()).batch?.id;
    if (typeof batchId !== 'string')
      throw new Error('Created publication batch id is missing.');
    const batchCard = page.locator(
      '[data-og7="publication-batch"][data-og7-id="' + batchId + '"]'
    );
    await expect(batchCard).toBeVisible();
    await expect(batchCard).toContainText('Ouvert');
    await expect(batchCard).toContainText('Facebook - 0/5');
    await openSpace(page, 'drafts');

    // Use the created batch's id: previous attempts can leave other open
    // batches with the same visible label.
    await expect(
      lotSelect.locator('option[value="' + batchId + '"]')
    ).toHaveText('Facebook (0/5)');
    await lotSelect.selectOption(batchId);
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
    const slotCreated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/admin/publication-slots' &&
        response.request().method() === 'POST'
    );
    await page
      .getByRole('button', { name: 'Creer un creneau', exact: true })
      .click();

    const slotResponse = await slotCreated;
    expect(slotResponse.status()).toBe(200);
    const slotId = (await slotResponse.json()).slot?.id;
    if (typeof slotId !== 'string')
      throw new Error('Created publication slot id is missing.');
    const slotCard = page.locator(
      '[data-og7="publication-slot"][data-og7-id="' + slotId + '"]'
    );
    await expect(slotCard).toBeVisible();
    await expect(slotCard).toContainText('OpenG7 / Facebook');
    await expect(slotCard).toContainText('0/5');

    const slotBatchSelect = slotCard.getByRole('combobox', {
      name: 'Lot',
      exact: true
    });
    await expect(
      slotBatchSelect.locator('option[value="' + batchId + '"]')
    ).toHaveText('Facebook (1/5)');
    await slotBatchSelect.selectOption(batchId);
    await slotCard
      .getByRole('button', { name: 'Assigner le lot', exact: true })
      .click();

    await expect(slotCard).toContainText('1/5');
    await openSpace(page, 'batches');
    await page.getByLabel('Choisir un mois').fill(slotStartsAt.slice(0, 7));
    await openBatch(page, batchId);
    await expect(batchCard).toContainText('Planifie');

    const deliveryPrepared = page.waitForResponse((response) => {
      if (
        new URL(response.url()).pathname !==
          '/api/admin/publication-automation' ||
        response.request().method() !== 'POST'
      )
        return false;
      const command = response.request().postDataJSON();
      return command.action === 'compose' && command.batchId === batchId;
    });
    await batchCard
      .getByRole('button', { name: 'Préparer l’envoi', exact: true })
      .click();
    const deliveryResponse = await deliveryPrepared;
    expect(deliveryResponse.status()).toBe(200);
    const deliveryId = (await deliveryResponse.json()).id;
    if (typeof deliveryId !== 'string')
      throw new Error('Prepared publication delivery id is missing.');
    const deliveryCard = page
      .locator('[data-og7="publication-automation"]')
      .locator('button[data-og7-id="' + deliveryId + '"]');
    const preview = page.getByRole('dialog', { name: 'Publication finale' });
    await expect(preview).toBeVisible();
    await preview.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(preview).not.toBeVisible();
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
    await expect(
      settings.getByRole('status').filter({ hasText: 'Connexion vérifiée' })
    ).toHaveText('Connexion vérifiée');
    await settings.getByRole('button').filter({ hasText: 'Fermer' }).click();
    await expect(settings).not.toBeVisible();
    await deliveryCard.click();
    await preview.getByRole('checkbox', { name: /J’approuve/ }).check();
    await preview
      .getByRole('button', { name: 'Accepter et programmer' })
      .click();
    await expect(preview).toContainText('Autorisée');
    await expect(preview).toContainText('Simulation');
    await preview.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(preview).not.toBeVisible();
    await page
      .getByRole('button', { name: 'Programmées', exact: true })
      .click();
    await expect(deliveryCard).toBeVisible();

    // Revoke only this synthetic sending authorization after verifying it.
    // The next attempt can then reassign the draft without bypassing its guard.
    await deliveryCard.click();
    await preview
      .getByRole('button', { name: 'Annuler cet envoi', exact: true })
      .click();
    const confirmation = page.getByRole('dialog', {
      name: 'Confirmer l’action',
      exact: true
    });
    await expect(confirmation).toContainText(
      'Annuler l’envoi programmé de cette publication ?'
    );
    await expect(confirmation).toContainText('openg7:facebook');
    const deliveryCancelled = page.waitForResponse((response) => {
      if (
        new URL(response.url()).pathname !==
          '/api/admin/publication-automation' ||
        response.request().method() !== 'POST'
      )
        return false;
      const command = response.request().postDataJSON();
      return command.action === 'cancel' && command.id === deliveryId;
    });
    await confirmation.locator('[data-og7="confirm-action"]').click();
    await expect(confirmation).not.toBeVisible();
    const cancelResponse = await deliveryCancelled;
    expect(cancelResponse.status()).toBe(200);
    expect(cancelResponse.request().postDataJSON().confirmation).toBe(
      deliveryId
    );
    await expect(preview).toContainText('Annulée');
    await preview.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(preview).not.toBeVisible();
    await expect(deliveryCard).toHaveCount(0);
  });
});
