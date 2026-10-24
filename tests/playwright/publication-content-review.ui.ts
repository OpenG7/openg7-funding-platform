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
        if ((await local.getAttribute('open')) !== null)
          await local.locator('summary').click();
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
        ).toHaveCount(0);
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
        ).toHaveCount(0);
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
      const expand = hook(page, 'publication-preview-expand');
      await expand.click();
      await expect(hook(page, 'publication-preview')).toHaveAttribute(
        'data-expanded',
        'true'
      );
      await expect(hook(page, 'publication-saved-content')).toContainText(
        saved
      );
      await expect(dialog.locator('form')).toHaveCount(0);
      await expect(page.locator('dialog:modal')).toHaveCount(1);
      await expand.click();
      await expect(expand).toBeFocused();
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
      await expect(hook(page, 'publication-local-preview')).toHaveJSProperty(
        'open',
        true
      );
      await expect(hook(page, 'publication-local-preview')).toContainText(
        entered
      );
      expect(commands).toEqual([]);
    });

    test(`publication review layout preserves the draft and discard guard from its enlarged preview in ${language}`, async ({
      page
    }) => {
      const commands = await context.setup(page, {
        job: { message: saved, version: 17 }
      });
      await locale(page, language);
      await page.goto(path);
      const trigger = page.locator(`[data-og7-id="${id}"]`);
      await trigger.click();
      const dialog = page.getByRole('dialog', {
        name: dialogName,
        exact: true
      });
      await dialog.getByRole('button', { name: editName, exact: true }).click();
      const text = dialog.getByLabel(messageName);
      await text.fill(entered);
      const localPreview = hook(page, 'publication-local-preview');
      await localPreview.locator('summary').click();
      await expect(localPreview).toHaveJSProperty('open', false);
      const expand = hook(page, 'publication-preview-expand');
      await expand.click();
      await expect(localPreview).toHaveJSProperty('open', true);
      await expand.click();
      await expect(localPreview).toHaveJSProperty('open', false);
      await expand.click();
      await expect(hook(page, 'publication-preview')).toBeFocused();
      await page.keyboard.press('Escape');
      const confirmation = page.getByRole('dialog').filter({
        has: hook(page, 'confirm-action')
      });
      await expect(confirmation).toBeVisible();
      await expect(page.locator('dialog:modal')).toHaveCount(2);
      await page.keyboard.press('Escape');
      await expect(confirmation).toBeHidden();
      await expect(hook(page, 'publication-preview')).toHaveAttribute(
        'data-expanded',
        'true'
      );
      await expect(text).toHaveValue(entered);
      expect(commands).toEqual([]);
      await page.keyboard.press('Escape');
      await confirmation.locator('[data-og7="confirm-action"]').click();
      await expect(dialog).toBeHidden();
      await trigger.click();
      await expect(hook(page, 'publication-preview')).toHaveAttribute(
        'data-expanded',
        'false'
      );
      await expect(hook(page, 'publication-saved-content')).toContainText(
        saved
      );
      expect(commands).toEqual([]);
    });

    for (const viewport of [
      { width: 1536, height: 864 },
      { width: 1280, height: 520 },
      { width: 390, height: 844 }
    ]) {
      test(`publication review layout keeps one editor and a reversible preview in ${language} at ${viewport.width} by ${viewport.height}`, async ({
        page
      }, testInfo) => {
        const commands = await context.setup(page, {
          job: { message: saved, version: 17 }
        });
        await locale(page, language);
        await page.setViewportSize(viewport);
        await page.goto(path);
        await page.locator(`[data-og7-id="${id}"]`).click();
        const dialog = page.getByRole('dialog', {
          name: dialogName,
          exact: true
        });
        const editor = hook(page, 'publication-editor');
        const preview = hook(page, 'publication-preview');
        const expand = hook(page, 'publication-preview-expand');
        await expect(preview).toContainText(saved);
        await expect(expand).toHaveAccessibleName(
          en ? 'Enlarge preview' : 'Agrandir l’aperçu'
        );
        await dialog
          .getByRole('button', { name: editName, exact: true })
          .click();
        const text = dialog.getByLabel(messageName);
        await text.fill(entered);
        const originalField = await text.elementHandle();
        await expect(dialog.locator('textarea[name="message"]')).toHaveCount(1);
        await expect(hook(page, 'publication-editor-form')).toHaveCount(1);
        await expect(hook(page, 'publication-save')).toHaveCount(1);
        const savedReference = hook(page, 'publication-saved-reference');
        await savedReference.locator('summary').click();
        await expect(savedReference).toContainText(saved);
        await expect(preview).toContainText(entered);

        const [editorBounds, previewBounds] = await Promise.all([
          editor.boundingBox(),
          preview.boundingBox()
        ]);
        expect(editorBounds).not.toBeNull();
        expect(previewBounds).not.toBeNull();
        if (viewport.width > 960) {
          expect(previewBounds!.x).toBeGreaterThanOrEqual(
            editorBounds!.x + editorBounds!.width
          );
          expect(Math.abs(previewBounds!.y - editorBounds!.y)).toBeLessThan(2);
        } else {
          expect(previewBounds!.y).toBeGreaterThanOrEqual(
            editorBounds!.y + editorBounds!.height
          );
        }

        await expand.focus();
        await page.keyboard.press('Enter');
        await expect(preview).toHaveAttribute('data-expanded', 'true');
        await expect(preview).toBeFocused();
        await expect(editor).toBeHidden();
        await expect(hook(page, 'publication-review-footer')).toBeHidden();
        await expect(text).toHaveValue(entered);
        expect(
          await text.evaluate(
            (element, previous) => element === previous,
            originalField
          )
        ).toBe(true);
        await expect(preview).toContainText(entered);
        await expect(savedReference).toContainText(saved);
        await expect(hook(page, 'publication-content-context')).toContainText(
          '17'
        );
        await expect(page.locator('dialog:modal')).toHaveCount(1);
        expect(commands).toEqual([]);
        expect(
          await dialog.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1
          )
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(
            `review-preview-${language}-${viewport.width}.png`
          ),
          animations: 'disabled'
        });

        await expand.click();
        await expect(expand).toBeFocused();
        await expect(preview).toHaveAttribute('data-expanded', 'false');
        await expect(editor).toBeVisible();
        await expect(text).toHaveValue(entered);
        await expect(hook(page, 'publication-save')).toBeVisible();
        await expect(hook(page, 'publication-save')).toHaveAttribute(
          'form',
          (await hook(page, 'publication-editor-form').getAttribute(
            'id'
          )) as string
        );
        expect(
          (await new AxeBuilder({ page }).include('dialog[open]').analyze())
            .violations
        ).toEqual([]);
        await hook(page, 'publication-save').click();
        await expect(hook(page, 'publication-content-context')).toContainText(
          '18'
        );
        await expect(hook(page, 'publication-saved-content')).toContainText(
          entered
        );
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
  }
}
