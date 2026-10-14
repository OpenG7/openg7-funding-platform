import { test, expect } from '@playwright/test';

import { createSchedulingFixture } from '../integration/support/publication-batch-scheduling-fixture.mjs';

import { startIdentityStack } from './stack.mjs';
import { openAdminIdentity } from './support/admin-browser.js';

test('manual publication calendar persists Toronto replanning across all shared batches, rejects ambiguous times and confirms cancellation', async ({
  playwright
}) => {
  const stack = await startIdentityStack();
  const setup = createSchedulingFixture(stack.pool);
  const fixture = await setup.fixture();
  // Historical overlap is prepared explicitly; editing notes must preserve its exact instant.
  const original = '2030-11-03T05:30:17.123Z';
  await stack.pool.query(
    'UPDATE publication_slots SET starts_at=$2 WHERE id=$1',
    [fixture.slotId, original]
  );
  await stack.pool.query(
    'UPDATE sponsor_publication_batches SET scheduled_at=$2 WHERE slot_id=$1',
    [fixture.slotId, original]
  );
  await stack.pool.query(
    'UPDATE sponsor_publication_drafts SET scheduled_at=$2 WHERE batch_id=ANY($1::uuid[])',
    [fixture.members.map((m) => m.batchId), original]
  );
  const session = await openAdminIdentity(
    playwright.chromium,
    stack.origin,
    '/admin/fundraiser/publications/calendar'
  );
  const { page } = session;
  const open = async () => {
    await page.getByLabel('Choisir un mois').fill('2030-11');
    await page
      .locator(`[data-og7="calendar-entry"][data-og7-id="${fixture.slotId}"]`)
      .click();
    return page.locator(
      `[data-og7="publication-slot"][data-og7-id="${fixture.slotId}"]`
    );
  };
  try {
    let card = await open();
    await expect(card.getByLabel('Date et heure')).toHaveValue(
      '2030-11-03T01:30'
    );
    await card
      .getByLabel('Notes', { exact: true })
      .fill('Replanification synthétique conservée');
    const [saved] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === '/api/admin/publication-slots/update'
      ),
      card.getByRole('button', { name: 'Mettre a jour', exact: true }).click()
    ]);
    expect(saved.ok()).toBe(true);
    expect((await setup.snapshot(fixture)).slot.starts_at.toISOString()).toBe(
      original
    );
    await page.reload();
    card = await open();
    await expect(card.getByLabel('Notes', { exact: true })).toHaveValue(
      'Replanification synthétique conservée'
    );
    // Changing the date into the repeated local hour requires an unambiguous replacement.
    await card.getByLabel('Date et heure').fill('2030-11-03T01:45');
    await card
      .getByRole('button', { name: 'Mettre a jour', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText(
      'les heures absentes ou répétées au changement d’heure sont refusées'
    );
    expect((await setup.snapshot(fixture)).slot.starts_at.toISOString()).toBe(
      original
    );
    await card.getByLabel('Date et heure').fill('2030-11-03T03:30');
    const [replanned] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === '/api/admin/publication-slots/update'
      ),
      card.getByRole('button', { name: 'Mettre a jour', exact: true }).click()
    ]);
    expect(replanned.ok()).toBe(true);
    const snapshot = await setup.snapshot(fixture);
    expect(snapshot.slot.starts_at.toISOString()).toBe(
      '2030-11-03T08:30:00.000Z'
    );
    expect(snapshot.batches.map((b) => b.scheduled_at?.toISOString())).toEqual([
      '2030-11-03T08:30:00.000Z',
      '2030-11-03T08:30:00.000Z'
    ]);
    expect(snapshot.drafts.map((d) => d.scheduled_at?.toISOString())).toEqual([
      '2030-11-03T08:30:00.000Z',
      '2030-11-03T08:30:00.000Z'
    ]);
    await page.reload();
    card = await open();
    await expect(card.getByLabel('Date et heure')).toHaveValue(
      '2030-11-03T03:30'
    );
    await card
      .getByRole('button', { name: 'Annuler le creneau', exact: true })
      .click();
    const confirmation = page.getByRole('dialog', {
      name: 'Confirmer l’action',
      exact: true
    });
    await expect(confirmation).toContainText(fixture.slotId);
    await page.keyboard.press('Escape');
    expect((await setup.snapshot(fixture)).slot.status).toBe('scheduled');
    await card
      .getByRole('button', { name: 'Annuler le creneau', exact: true })
      .click();
    const [cancelled] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === '/api/admin/publication-slots/cancel'
      ),
      confirmation.locator('[data-og7="confirm-action"]').click()
    ]);
    expect(cancelled.ok()).toBe(true);
    expect((await setup.snapshot(fixture)).slot.status).toBe('cancelled');
    expect(
      (
        await stack.pool.query(
          'SELECT count(*)::int AS n FROM publication_deliveries'
        )
      ).rows[0].n
    ).toBe(0);
    expect(
      (
        await stack.pool.query(
          'SELECT count(*)::int AS n FROM social_publication_jobs'
        )
      ).rows[0].n
    ).toBe(0);
  } finally {
    await session.context.close();
    await stack.stop();
  }
});
