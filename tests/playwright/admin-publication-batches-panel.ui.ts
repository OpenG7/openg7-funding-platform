import type { AdminPublicationBatchRecord } from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  batch,
  draft,
  fixtures,
  openSpace
} from './admin-publication-panels.fixtures.js';

export function registerBatchPanelTests(): void {
  test('batch creation preserves inputs after failure and confirms selection only after the server response', async ({
    page
  }) => {
    const records = [batch('existing', null, 'open')];
    await fixtures(page, records);
    const writes: Record<string, unknown>[] = [];
    let release!: () => void;
    const response = new Promise<void>((resolve) => {
      release = resolve;
    });
    const created: AdminPublicationBatchRecord = {
      ...batch('created', null, 'open'),
      channel: 'linkedin',
      capacity: 7,
      capacityAvailable: 7
    };
    await page.route('**/api/admin/publication-batches', async (route) => {
      if (route.request().method() === 'GET') return route.fallback();
      writes.push(route.request().postDataJSON());
      if (writes.length === 1) return route.fulfill({ status: 503, json: {} });
      await response;
      records.push(created);
      return route.fulfill({ json: { created: true, batch: created } });
    });
    await page.goto('/admin/fundraiser/publications/batches');
    await page
      .getByRole('button', { name: 'Nouveau lot', exact: true })
      .click();
    const form = page.locator('#new-batch-form');
    await form
      .getByRole('combobox', { name: 'Canal', exact: true })
      .selectOption('linkedin');
    await form.getByLabel('Capacite', { exact: true }).fill('7');
    const submit = form.getByRole('button', {
      name: 'Creer un lot',
      exact: true
    });
    await submit.click();
    await expect(page.getByRole('alert').first()).toContainText(
      'Impossible de charger'
    );
    await expect(submit).toBeEnabled();
    await openSpace(page, 'overview');
    await openSpace(page, 'batches');
    await expect(
      form.getByRole('combobox', { name: 'Canal', exact: true })
    ).toHaveValue('linkedin');
    await expect(form.getByLabel('Capacite', { exact: true })).toHaveValue('7');
    await submit.click();
    await expect(submit).toBeDisabled();
    await expect(page.locator('[data-og7="admin-drawer"][open]')).toHaveCount(
      0
    );
    await expect.poll(() => writes.length).toBe(2);
    expect(writes).toEqual([
      { channel: 'linkedin', capacity: 7 },
      { channel: 'linkedin', capacity: 7 }
    ]);
    await form
      .getByRole('combobox', { name: 'Canal', exact: true })
      .selectOption('facebook');
    await form.getByLabel('Capacite', { exact: true }).fill('11');
    release();
    await expect(form).toHaveCount(0);
    await expect(page.locator('#attention-object-created')).toBeFocused();
    await expect(page.locator('#attention-object-created')).toContainText('7');
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Nouveau lot', exact: true })
      .click();
    await expect(
      form.getByRole('combobox', { name: 'Canal', exact: true })
    ).toHaveValue('facebook');
    await expect(form.getByLabel('Capacite', { exact: true })).toHaveValue(
      '11'
    );
  });

  test('batch schedule edits survive workspace changes, refresh and a failed request before retry', async ({
    page
  }) => {
    const records = [batch('first', '2030-06-03T14:00:00Z')];
    await fixtures(page, records);
    const writes: Record<string, unknown>[] = [];
    await page.route(
      '**/api/admin/publication-batches/schedule',
      async (route) => {
        const payload = route.request().postDataJSON();
        writes.push(payload);
        if (writes.length === 1)
          return route.fulfill({ status: 503, json: {} });
        records[0] = { ...records[0], scheduledAt: payload.scheduledAt };
        return route.fulfill({ json: { scheduled: true, batch: records[0] } });
      }
    );
    await page.goto('/admin/fundraiser/publications/batches');
    const entry = page.locator(
      '[data-og7="calendar-entry"][data-og7-id="first"]'
    );
    await entry.click();
    const editor = page.locator('#attention-object-first');
    const schedule = editor.getByLabel('Prochaine disponibilite', {
      exact: true
    });
    const editedSchedule = '2030-06-10T09:45';
    await schedule.fill(editedSchedule);
    await openSpace(page, 'overview');
    await openSpace(page, 'batches');
    await entry.click();
    await expect(schedule).toHaveValue(editedSchedule);
    await editor
      .getByRole('button', { name: 'Planifier', exact: true })
      .click();
    await expect(
      editor.getByRole('button', { name: 'Planifier', exact: true })
    ).toBeEnabled();
    await expect(page.getByRole('alert').last()).toContainText(
      'Impossible de charger'
    );
    await expect(schedule).toHaveValue(editedSchedule);
    await page.keyboard.press('Escape');
    await expect(entry).toBeFocused();
    await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Actualiser', exact: true })
    ).toBeEnabled();
    await entry.click();
    await expect(schedule).toHaveValue(editedSchedule);
    await editor
      .getByRole('button', { name: 'Planifier', exact: true })
      .click();
    const expectedTimestamp = await page.evaluate(
      (value) => new Date(value).toISOString(),
      editedSchedule
    );
    await expect.poll(() => writes.length).toBe(2);
    expect(writes).toEqual([
      { batchId: 'first', scheduledAt: expectedTimestamp },
      { batchId: 'first', scheduledAt: expectedTimestamp }
    ]);
    await expect(schedule).toHaveValue(editedSchedule);
  });

  test('preparing a social batch navigates to automation with its target and preserves the return workspace', async ({
    page
  }) => {
    const mutations = await fixtures(
      page,
      [batch('first', '2030-06-03T14:00:00Z')],
      [draft]
    );
    await page.goto('/admin/fundraiser/publications/batches?batchId=first');
    const editor = page.locator('#attention-object-first');
    await expect(editor).toBeVisible();
    await editor
      .getByRole('button', { name: 'Préparer l’envoi', exact: true })
      .click();
    await expect(page).toHaveURL(
      /\/publications\/automation\?batchId=first&feedId=openg20(?::|%3A)linkedin$/
    );
    expect(mutations).toEqual([]);
    await page.goBack();
    await expect(page).toHaveURL(/\/publications\/batches\?batchId=first$/);
    await expect(editor).toBeVisible();
    expect(mutations).toEqual([]);
  });

  for (const action of [
    {
      endpoint: 'publish',
      label: 'Marquer comme publiée manuellement',
      message: 'Confirmer la publication de cet élément ?',
      status: 'published' as const
    },
    {
      endpoint: 'cancel',
      label: 'Annuler le lot',
      message: 'Annuler cette publication ?',
      status: 'cancelled' as const
    }
  ]) {
    test(`batch ${action.endpoint} requires confirmation and waits for the server before refresh`, async ({
      page
    }) => {
      const records = [batch('first', '2030-06-03T14:00:00Z')];
      const unhandledMutations = await fixtures(page, records);
      const writes: Record<string, unknown>[] = [];
      let reads = 0;
      await page.route('**/api/admin/publication-batches**', (route) => {
        if (route.request().method() === 'GET') reads += 1;
        return route.fallback();
      });
      let release!: () => void;
      const response = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(
        '**/api/admin/publication-batches/' + action.endpoint,
        async (route) => {
          writes.push(route.request().postDataJSON());
          await response;
          records[0] = { ...records[0], status: action.status };
          return route.fulfill({
            json: {
              [action.endpoint === 'publish' ? 'published' : 'cancelled']: true,
              batch: records[0]
            }
          });
        }
      );
      await page.goto('/admin/fundraiser/publications/batches?batchId=first');
      const editor = page.locator('#attention-object-first');
      await expect(editor).toBeVisible();
      await editor.getByText('Autres actions', { exact: true }).click();
      const trigger = editor.getByRole('button', {
        name: action.label,
        exact: true
      });
      await trigger.click();
      const confirmation = page.getByRole('dialog', {
        name: 'Confirmer l’action',
        exact: true
      });
      await expect(confirmation).toContainText(action.message);
      await expect(confirmation).toContainText('first');
      expect(writes).toEqual([]);
      await confirmation
        .getByRole('button', { name: 'Annuler', exact: true })
        .last()
        .click();
      await expect(confirmation).not.toBeVisible();
      await expect(trigger).toBeFocused();
      expect(writes).toEqual([]);
      const readsBeforeMutation = reads;
      await trigger.click();
      await confirmation
        .getByRole('button', { name: 'Confirmer', exact: true })
        .click();
      await expect.poll(() => writes.length).toBe(1);
      await expect(trigger).toBeDisabled();
      expect(writes).toEqual([{ batchId: 'first' }]);
      expect(reads).toBe(readsBeforeMutation);
      await expect(
        editor.getByLabel('Prochaine disponibilite', { exact: true })
      ).toBeVisible();
      release();
      await expect.poll(() => reads).toBeGreaterThan(readsBeforeMutation);
      await expect(trigger).toHaveCount(0);
      await expect(editor).toBeVisible();
      expect(unhandledMutations).toEqual([]);
    });
  }
}
