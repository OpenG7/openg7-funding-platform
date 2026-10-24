import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  PublicationAutomationCommand,
  PublicationDelivery
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

interface Context {
  setup(
    page: Page,
    options?: {
      conflict?: boolean;
      reader?: boolean;
      job?: Partial<PublicationDelivery>;
    }
  ): Promise<PublicationAutomationCommand[]>;
}

const id = '11111111-1111-4111-8111-111111111111';
const path = '/admin/fundraiser/publications/automation';
const saved =
  'Texte enregistré de recette.\nDeuxième ligne <b>en texte brut</b>.';
const entered =
  'Texte local de recette.\nVersion corrigée <b>en texte brut</b>.';
const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);

async function locale(page: Page, language: string) {
  await page.addInitScript(
    (value) => localStorage.setItem('openg7.language', value),
    language
  );
}

export function registerPublicationContentReviewTests(context: Context): void {
  for (const language of ['fr-CA', 'en'] as const) {
    const en = language === 'en';
    const dialogName = en ? 'Final publication' : 'Publication finale';
    const messageName = en ? 'Exact text to publish' : 'Texte exact à publier';
    const editName = en ? 'Edit' : 'Modifier';
    const saveName = en ? 'Save draft' : 'Enregistrer le brouillon';

    for (const width of [1536, 390]) {
      test(`publication content review distinguishes the saved version and local text in ${language} at ${width}px`, async ({
        page
      }, testInfo) => {
        const commands = await context.setup(page, {
          job: { message: saved, version: 17 }
        });
        await locale(page, language);
        await page.setViewportSize({ width, height: 864 });
        await page.goto(path);
        await page.locator(`[data-og7-id="${id}"]`).click();
        const dialog = page.getByRole('dialog', { name: dialogName });
        const contentContext = hook(page, 'publication-content-context');
        await expect(contentContext).toContainText('17');
        await expect(contentContext).toContainText(
          en ? 'No local changes' : 'Aucune modification locale'
        );
        await expect(hook(page, 'publication-saved-content')).toContainText(
          saved
        );
        await expect(
          hook(page, 'publication-saved-content').locator('b')
        ).toHaveCount(0);
        await dialog
          .getByRole('button', { name: editName, exact: true })
          .click();
        await dialog.getByLabel(messageName).fill(entered);
        await expect(contentContext).toContainText(
          en ? 'Unsaved changes' : 'Modifications non enregistrées'
        );
        const local = hook(page, 'publication-local-preview');
        const reference = hook(page, 'publication-saved-reference');
        await local.locator('summary').focus();
        await page.keyboard.press('Enter');
        await expect(local).toHaveAttribute('open', '');
        await expect(local).toContainText(entered);
        await expect(local.locator('b')).toHaveCount(0);
        await reference.locator('summary').click();
        await expect(reference).toContainText(saved);
        await expect(reference).not.toContainText(entered);
        await expect(reference).toContainText('17');
        await expect(reference.locator('time')).toHaveAttribute(
          'datetime',
          '2030-06-03T14:00:00Z'
        );
        await expect(hook(page, 'publication-save-help')).toContainText(
          en ? 'Saving does not publish.' : 'La sauvegarde ne publie pas.'
        );
        await expect(
          dialog.getByRole('checkbox', { name: /J’approuve|I approve/ })
        ).toBeDisabled();
        expect(commands).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        ).toBe(true);
        expect(
          (await new AxeBuilder({ page }).include('dialog[open]').analyze())
            .violations
        ).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(`content-review-${language}-${width}.png`),
          animations: 'disabled'
        });
        await dialog
          .getByRole('button', { name: saveName, exact: true })
          .click();
        await expect(contentContext).toContainText('18');
        await expect(contentContext).toContainText(
          en ? 'No local changes' : 'Aucune modification locale'
        );
        await expect(hook(page, 'publication-saved-content')).toContainText(
          entered
        );
        await expect(
          dialog.getByRole('checkbox', { name: /J’approuve|I approve/ })
        ).not.toBeChecked();
        expect(commands).toEqual([
          expect.objectContaining({
            action: 'edit',
            id,
            version: 17,
            message: entered
          })
        ]);
      });
    }

    for (const failure of ['conflict', 'unavailable'] as const) {
      test(`publication content review retains local and saved text after ${failure} in ${language}`, async ({
        page
      }) => {
        const commands = await context.setup(page, {
          conflict: failure === 'conflict',
          job: { message: saved, version: 17 }
        });
        if (failure === 'unavailable')
          await page.route('**/api/admin/publication-automation', (route) => {
            if (route.request().method() === 'GET') return route.fallback();
            commands.push(
              route.request().postDataJSON() as PublicationAutomationCommand
            );
            return route.fulfill({
              status: 503,
              json: { code: 'UNAVAILABLE' }
            });
          });
        await locale(page, language);
        await page.goto(path);
        await page.locator(`[data-og7-id="${id}"]`).click();
        const dialog = page.getByRole('dialog', { name: dialogName });
        await dialog
          .getByRole('button', { name: editName, exact: true })
          .click();
        await dialog.getByLabel(messageName).fill(entered);
        await dialog
          .getByRole('button', { name: saveName, exact: true })
          .click();
        await expect(dialog.getByRole('alert')).toBeVisible();
        await expect(dialog.getByLabel(messageName)).toHaveValue(entered);
        await expect(hook(page, 'publication-content-context')).toContainText(
          '17'
        );
        await hook(page, 'publication-saved-reference')
          .locator('summary')
          .click();
        await expect(hook(page, 'publication-saved-reference')).toContainText(
          saved
        );
        await expect(
          dialog.getByRole('checkbox', { name: /J’approuve|I approve/ })
        ).toBeDisabled();
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatchObject({
          action: 'edit',
          version: 17,
          message: entered
        });
      });
    }

    test(`publication content review preserves read-only access in ${language}`, async ({
      page
    }) => {
      const commands = await context.setup(page, {
        reader: true,
        job: { message: saved, version: 17 }
      });
      await locale(page, language);
      await page.goto(path);
      await expect(
        page.getByRole('button', {
          name: en ? 'New publication' : 'Nouvelle publication',
          exact: true
        })
      ).toHaveCount(0);
      await page.locator(`[data-og7-id="${id}"]`).click();
      const dialog = page.getByRole('dialog', { name: dialogName });
      await expect(hook(page, 'publication-content-context')).toContainText(
        '17'
      );
      await expect(hook(page, 'publication-saved-content')).toContainText(
        saved
      );
      await expect(
        dialog.getByRole('button', { name: editName, exact: true })
      ).toHaveCount(0);
      await expect(hook(page, 'publication-local-preview')).toHaveCount(0);
      await expect(dialog.getByRole('checkbox')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      expect(commands).toEqual([]);
    });

    test(`publication content review identifies a new composition without a saved version in ${language}`, async ({
      page
    }) => {
      const commands = await context.setup(page);
      await locale(page, language);
      await page.goto(path);
      await page
        .getByRole('button', {
          name: en ? 'New publication' : 'Nouvelle publication',
          exact: true
        })
        .click();
      const dialog = page.getByRole('dialog', { name: dialogName });
      await expect(hook(page, 'publication-content-context')).toHaveText(
        en ? 'New unsaved draft' : 'Nouveau brouillon non enregistré'
      );
      await expect(hook(page, 'publication-saved-reference')).toHaveCount(0);
      await dialog.getByLabel(messageName).fill(entered);
      await hook(page, 'publication-local-preview').locator('summary').click();
      await expect(hook(page, 'publication-local-preview')).toContainText(
        entered
      );
      expect(commands).toEqual([]);
    });
  }
}
