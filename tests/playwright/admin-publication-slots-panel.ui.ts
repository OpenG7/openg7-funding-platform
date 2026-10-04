import type {
  AdminPublicationBatchRecord,
  AdminPublicationDraftRecord,
  AdminPublicationSlotRecord
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  batch,
  draft,
  fixtures,
  openSpace,
  slot
} from './admin-publication-panels.fixtures.js';

export function registerSlotPanelTests(): void {
  test('slot panel filters assignments by destination, channel, status and remaining capacity', async ({
    page
  }) => {
    const availableDraft: AdminPublicationDraftRecord = {
      ...draft,
      id: 'available-draft',
      status: 'approved',
      batch_id: null,
      slot_id: null,
      scheduled_at: null
    };
    const compatible: AdminPublicationBatchRecord = {
      ...batch('compatible-batch', null, 'open'),
      channel: 'linkedin',
      capacityUsed: 2,
      capacityAvailable: 3,
      assignedDraftIds: ['compatible-member']
    };
    const records = [
      compatible,
      {
        ...compatible,
        id: 'oversize-batch',
        capacityUsed: 3,
        capacityAvailable: 2
      },
      {
        ...compatible,
        id: 'other-channel-batch',
        channel: 'facebook' as const
      },
      { ...compatible, id: 'other-slot-batch', slotId: 'another-slot' },
      { ...compatible, id: 'completed-batch', status: 'published' as const },
      {
        ...compatible,
        id: 'other-target-batch',
        assignedDraftIds: ['other-target-member']
      },
      { ...compatible, id: 'already-assigned-batch', slotId: slot.id }
    ];
    const draftRecords = [
      availableDraft,
      { ...availableDraft, id: 'other-target', feed_target: 'openg7' as const },
      { ...availableDraft, id: 'other-channel', channel: 'facebook' as const },
      { ...availableDraft, id: 'unapproved', status: 'draft' as const },
      { ...availableDraft, id: 'other-slot', slot_id: 'another-slot' },
      { ...availableDraft, id: 'compatible-member', batch_id: compatible.id },
      {
        ...availableDraft,
        id: 'other-target-member',
        feed_target: 'openg7' as const,
        batch_id: 'other-target-batch'
      }
    ];
    const mutations = await fixtures(page, records, draftRecords);
    let currentSlot: AdminPublicationSlotRecord = slot;
    await page.route('**/api/admin/publication-slots', (route) =>
      route.fulfill({ json: { slots: [currentSlot] } })
    );
    await page.goto('/admin/fundraiser/publications/calendar');
    const entry = page.locator(
      '[data-og7="calendar-entry"][data-og7-id="slot-first"]'
    );
    await entry.click();
    const drawer = page.getByRole('dialog', { name: 'Détail du créneau' });
    const batchSelection = drawer.getByRole('combobox', {
      name: 'Lot',
      exact: true
    });
    const draftSelection = drawer.getByRole('combobox', {
      name: 'Brouillon',
      exact: true
    });
    await expect(batchSelection.locator('option')).toHaveCount(3);
    expect(
      await batchSelection
        .locator('option')
        .evaluateAll((options) =>
          options.map((option) => option.getAttribute('value'))
        )
    ).toEqual(['', 'compatible-batch', 'already-assigned-batch']);
    await expect(draftSelection.locator('option')).toHaveCount(2);
    await batchSelection.selectOption('compatible-batch');
    await draftSelection.selectOption('available-draft');
    await expect(
      drawer.getByRole('button', { name: 'Assigner le lot', exact: true })
    ).toBeEnabled();
    await expect(
      drawer.getByRole('button', { name: 'Assigner brouillon', exact: true })
    ).toBeEnabled();

    await drawer.getByRole('button', { name: 'Fermer', exact: true }).click();
    await openSpace(page, 'drafts');
    await openSpace(page, 'calendar');
    await entry.click();
    await expect(batchSelection).toHaveValue('compatible-batch');
    await expect(draftSelection).toHaveValue('available-draft');

    // A refresh can invalidate a saved selection; it must not remain actionable.
    await drawer.getByRole('button', { name: 'Fermer', exact: true }).click();
    currentSlot = { ...slot, capacityUsed: 5, capacityAvailable: 0 };
    await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Actualiser', exact: true })
    ).toBeEnabled();
    await entry.click();
    await expect(batchSelection.locator('option')).toHaveCount(2);
    await expect(draftSelection.locator('option')).toHaveCount(1);
    await expect(
      drawer.getByRole('button', { name: 'Assigner le lot', exact: true })
    ).toBeDisabled();
    await expect(
      drawer.getByRole('button', { name: 'Assigner brouillon', exact: true })
    ).toBeDisabled();
    expect(mutations).toEqual([]);
  });

  test('slot panel retries a failed save and retains typing during a response and browser navigation', async ({
    page
  }) => {
    await fixtures(page);
    let currentSlot = slot;
    let reads = 0;
    await page.route('**/api/admin/publication-slots', (route) => {
      reads++;
      return route.fulfill({ json: { slots: [currentSlot] } });
    });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writes: Record<string, unknown>[] = [];
    await page.route('**/api/admin/publication-slots/update', async (route) => {
      const payload = route.request().postDataJSON();
      writes.push(payload);
      if (writes.length === 1) return route.fulfill({ status: 503, json: {} });
      await pending;
      currentSlot = {
        ...slot,
        startsAt: payload.startsAt,
        timezone: payload.timezone,
        capacity: payload.capacity,
        notes: payload.notes
      };
      return route.fulfill({ json: { updated: true, slot: currentSlot } });
    });
    await page.goto('/admin/fundraiser/publications');
    await openSpace(page, 'calendar');
    const entry = page.locator(
      '[data-og7="calendar-entry"][data-og7-id="slot-first"]'
    );
    await entry.focus();
    await entry.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Détail du créneau' });
    const notes = drawer.getByLabel('Notes', { exact: true });
    const startsAt = drawer.getByLabel('Date et heure', { exact: true });
    const timezone = drawer.getByLabel('Fuseau', { exact: true });
    const save = drawer.getByRole('button', {
      name: 'Mettre a jour',
      exact: true
    });
    await startsAt.fill('2030-06-03T15:45');
    await timezone.fill('America/Toronto');
    await notes.fill('Saisie à conserver après échec');
    await save.click();
    await expect(drawer.getByRole('alert')).toBeVisible();
    await expect(notes).toHaveValue('Saisie à conserver après échec');
    await expect(startsAt).toHaveValue('2030-06-03T15:45');
    await expect(timezone).toHaveValue('America/Toronto');
    expect(reads).toBe(1);

    await notes.fill('Texte envoyé au serveur');
    await save.click();
    await expect(save).toBeDisabled();
    await expect(
      drawer.getByRole('button', { name: 'Fermer', exact: true })
    ).toBeDisabled();
    await notes.fill('Saisie pendant la réponse');
    release();
    await expect(save).toBeEnabled();
    await expect(drawer.getByRole('alert')).toHaveCount(0);
    await expect(notes).toHaveValue('Saisie pendant la réponse');
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({
      slotId: 'slot-first',
      timezone: 'America/Toronto',
      capacity: 5,
      notes: 'Texte envoyé au serveur'
    });
    expect(Object.keys(writes[1]).sort()).toEqual(
      ['slotId', 'startsAt', 'timezone', 'capacity', 'notes'].sort()
    );
    expect(reads).toBe(2);

    await notes.press('Escape');
    await expect(drawer).not.toBeVisible();
    await expect(entry).toBeFocused();
    await entry.press('Enter');
    await page.goBack();
    await expect(page).toHaveURL(/\/publications$/);
    await expect(drawer).toHaveCount(0);
    await page.goForward();
    await expect(page).toHaveURL(/\/publications\/calendar$/);
    await expect(drawer).toBeVisible();
    await expect(notes).toHaveValue('Saisie pendant la réponse');
    await expect(timezone).toHaveValue('America/Toronto');
    expect(reads).toBe(2);
  });

  test('slot panel keeps creation inputs across views and languages then selects the server-created slot', async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fixtures(page);
    const slots = [slot];
    const writes: Record<string, unknown>[] = [];
    let releaseCreation!: () => void;
    const creationResponse = new Promise<void>((resolve) => {
      releaseCreation = resolve;
    });
    await page.route('**/api/admin/publication-slots', async (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { slots } });
      const payload = route.request().postDataJSON();
      writes.push(payload);
      if (writes.length === 1) return route.fulfill({ status: 503, json: {} });
      await creationResponse;
      const created: AdminPublicationSlotRecord = {
        ...slot,
        id: 'slot-created',
        feedTarget: payload.feedTarget,
        channel: payload.channel,
        startsAt: payload.startsAt,
        timezone: payload.timezone,
        capacity: payload.capacity,
        capacityUsed: 0,
        capacityAvailable: payload.capacity,
        assignedBatchIds: [],
        assignedDraftIds: [],
        status: 'open',
        notes: payload.notes
      };
      slots.push(created);
      return route.fulfill({ json: { updated: true, slot: created } });
    });
    await page.goto('/admin/fundraiser/publications/calendar');
    await page.getByRole('button', { name: 'Nouveau créneau' }).click();
    const form = page.locator('#new-slot-form');
    await form
      .getByRole('combobox', { name: 'Cible', exact: true })
      .selectOption('openg20');
    await form
      .getByRole('combobox', { name: 'Canal', exact: true })
      .selectOption('linkedin');
    await form
      .getByLabel('Date et heure', { exact: true })
      .fill('2031-01-07T09:30');
    await form.getByLabel('Fuseau', { exact: true }).fill('America/Toronto');
    await form.getByLabel('Capacite', { exact: true }).fill('7');
    await form
      .getByLabel('Notes', { exact: true })
      .fill('Nouveau créneau de test');
    await openSpace(page, 'drafts');
    await openSpace(page, 'calendar');
    await expect(form.getByLabel('Notes', { exact: true })).toHaveValue(
      'Nouveau créneau de test'
    );
    await form
      .getByRole('button', { name: 'Creer un creneau', exact: true })
      .click();
    await expect(form).toBeVisible();
    await expect(form.getByLabel('Date et heure', { exact: true })).toHaveValue(
      '2031-01-07T09:30'
    );
    await page
      .getByRole('button', {
        name: 'Switch administration language to English'
      })
      .click();
    await expect(form.getByLabel('Date and time', { exact: true })).toHaveValue(
      '2031-01-07T09:30'
    );
    await expect(form.getByLabel('Time zone', { exact: true })).toHaveValue(
      'America/Toronto'
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await form
      .getByRole('button', { name: 'Create a slot', exact: true })
      .click();
    await expect.poll(() => writes.length).toBe(2);
    await expect(
      form.getByRole('button', { name: 'Create a slot', exact: true })
    ).toBeDisabled();
    await form
      .getByLabel('Notes', { exact: true })
      .fill(' Notes pendant la création ');
    releaseCreation();
    await expect(form).toHaveCount(0);
    await expect(page.locator('#attention-object-slot-created')).toBeFocused();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual({
      feedTarget: 'openg20',
      channel: 'linkedin',
      startsAt: writes[0].startsAt,
      timezone: 'America/Toronto',
      capacity: 7,
      notes: 'Nouveau créneau de test'
    });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'New slot', exact: true }).click();
    await expect(form.getByLabel('Notes', { exact: true })).toHaveValue(
      ' Notes pendant la création '
    );
  });
}
