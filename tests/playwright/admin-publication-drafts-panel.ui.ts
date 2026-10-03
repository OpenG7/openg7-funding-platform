import type { AdminPublicationDraftRecord } from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  batch,
  batches,
  draft,
  fixtures,
  openSpace
} from './admin-publication-panels.fixtures.js';

export function registerDraftPanelTests(): void {
  test('draft panel keeps a failed save retryable and announces success after the server response', async ({
    page
  }) => {
    const records: AdminPublicationDraftRecord[] = [
      {
        ...draft,
        status: 'draft',
        batch_id: null,
        slot_id: null,
        scheduled_at: null
      }
    ];
    await fixtures(page, batches, records);
    const writes: Record<string, unknown>[] = [];
    let releaseSave: () => void = () => undefined;
    const serverResponse = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await page.route(
      '**/api/admin/publication-drafts/update',
      async (route) => {
        const payload = route.request().postDataJSON();
        writes.push(payload);
        if (writes.length === 1)
          return route.fulfill({ status: 503, json: {} });
        await serverResponse;
        records[0] = { ...records[0]!, title: payload.title };
        return route.fulfill({ json: { updated: true, draft: records[0] } });
      }
    );
    await page.goto('/admin/fundraiser/publications/drafts');
    const card = page.locator('#attention-object-draft-first');
    await card.getByRole('button', { name: 'Ouvrir', exact: true }).click();
    await card
      .getByLabel('Titre', { exact: true })
      .fill('Révision à reprendre');
    await card
      .getByRole('button', { name: 'Enregistrer', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText(
      'Impossible de charger'
    );
    await expect(card.getByLabel('Titre', { exact: true })).toHaveValue(
      'Révision à reprendre'
    );
    await expect(
      card.getByText('Modifications non enregistrées')
    ).toBeVisible();
    await expect(
      page.getByText('Brouillon enregistré.', { exact: true })
    ).toHaveCount(0);

    await card
      .getByRole('button', { name: 'Enregistrer', exact: true })
      .click();
    await expect.poll(() => writes.length).toBe(2);
    await expect(card.getByLabel('Titre', { exact: true })).toBeDisabled();
    await expect(
      page.getByText('Brouillon enregistré.', { exact: true })
    ).toHaveCount(0);
    await openSpace(page, 'batches');
    await openSpace(page, 'drafts');
    await expect(card.getByLabel('Titre', { exact: true })).toHaveValue(
      'Révision à reprendre'
    );
    releaseSave();
    await expect(
      page.getByRole('status').filter({ hasText: 'Brouillon enregistré.' })
    ).toBeVisible();
    await expect(card.getByLabel('Titre', { exact: true })).toBeEnabled();
    await expect(card.getByText('Modifications non enregistrées')).toHaveCount(
      0
    );
    expect(writes.map((payload) => payload.title)).toEqual([
      'Révision à reprendre',
      'Révision à reprendre'
    ]);
    expect(writes[1]).toEqual({
      draftId: draft.id,
      title: 'Révision à reprendre',
      body: draft.body,
      disclosureText: draft.disclosure_text,
      publicUrl: '',
      scheduledAt: null,
      reviewNote: ''
    });
  });

  test('draft panel retains dirty input when a refresh temporarily omits its record', async ({
    page
  }) => {
    const records = [{ ...draft }];
    await fixtures(page, batches, records);
    await page.goto('/admin/fundraiser/publications/drafts');
    const card = page.locator('#attention-object-draft-first');
    await card.getByRole('button', { name: 'Ouvrir', exact: true }).click();
    await card
      .getByLabel('Titre', { exact: true })
      .fill('Texte local conservé');
    records.splice(0);
    await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Actualiser', exact: true })
    ).toBeEnabled();
    await openSpace(page, 'calendar');
    await openSpace(page, 'drafts');
    records.push({ ...draft, title: 'Titre reçu après réconciliation' });
    await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
    await expect(card.getByLabel('Titre', { exact: true })).toHaveValue(
      'Texte local conservé'
    );
    await expect(
      card.getByText('Modifications non enregistrées')
    ).toBeVisible();
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(/\/publications\/calendar$/);
    await page.goForward();
    await page.goForward();
    await expect(card.getByLabel('Titre', { exact: true })).toHaveValue(
      'Texte local conservé'
    );
    await card.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(
      card.getByRole('button', { name: 'Ouvrir', exact: true })
    ).toBeFocused();
  });

  test('draft panel preserves local copy and batch selection through view changes and assignment failures', async ({
    page
  }) => {
    const records: AdminPublicationDraftRecord[] = [
      {
        ...draft,
        status: 'approved',
        batch_id: null,
        slot_id: null,
        scheduled_at: null
      }
    ];
    const openBatch = {
      ...batch('draft-open-batch', null, 'open'),
      channel: 'linkedin' as const
    };
    await fixtures(page, [openBatch], records);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as Window & { copiedDraftText?: string }).copiedDraftText =
              text;
          }
        }
      });
    });
    const writes: Record<string, unknown>[] = [];
    await page.route(
      '**/api/admin/publication-batches/assign',
      async (route) => {
        const payload = route.request().postDataJSON();
        writes.push(payload);
        if (writes.length === 1)
          return route.fulfill({ status: 503, json: {} });
        records[0] = { ...records[0]!, batch_id: payload.batchId };
        return route.fulfill({ json: { assigned: true } });
      }
    );
    await page.goto('/admin/fundraiser/publications/drafts');
    const card = page.locator('#attention-object-draft-first');
    const statusFilter = page.getByRole('combobox', {
      name: 'Statut',
      exact: true
    });
    await statusFilter.selectOption('approved');
    await card.getByRole('button', { name: 'Ouvrir', exact: true }).click();
    await card.getByLabel('Titre', { exact: true }).fill('Titre à copier');
    await card
      .getByRole('combobox', { name: 'Lot', exact: true })
      .selectOption(openBatch.id);
    await openSpace(page, 'batches');
    await openSpace(page, 'drafts');
    await expect(statusFilter).toHaveValue('approved');
    await expect(
      card.getByRole('combobox', { name: 'Lot', exact: true })
    ).toHaveValue(openBatch.id);
    await card.getByRole('button', { name: 'Copier', exact: true }).click();
    await expect(page.getByText('Texte copié.', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as Window & { copiedDraftText?: string }).copiedDraftText
      )
    ).toBe(['Titre à copier', draft.body, draft.disclosure_text].join('\n\n'));
    await card
      .getByRole('button', { name: 'Assigner au lot', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText(
      'Impossible de charger'
    );
    await expect(
      card.getByRole('combobox', { name: 'Lot', exact: true })
    ).toHaveValue(openBatch.id);
    await card
      .getByRole('button', { name: 'Assigner au lot', exact: true })
      .click();
    await expect(
      card.getByRole('button', { name: 'Retirer du lot', exact: true })
    ).toBeVisible();
    await expect(card.getByLabel('Titre', { exact: true })).toHaveValue(
      'Titre à copier'
    );
    expect(writes).toEqual([
      { draftId: draft.id, batchId: openBatch.id },
      { draftId: draft.id, batchId: openBatch.id }
    ]);
  });
}
