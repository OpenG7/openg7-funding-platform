import { writeFile } from 'node:fs/promises';

import type { Locator, Page, TestInfo } from '@playwright/test';
import type {
  PublicationAutomationCommand,
  PublicationDelivery
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  adminController,
  installAdminController
} from './support/admin-controller.js';

interface Context {
  setup(
    page: Page,
    options?: { job?: Partial<PublicationDelivery> }
  ): Promise<PublicationAutomationCommand[]>;
}

const id = '11111111-1111-4111-8111-111111111111';
const path = '/admin/fundraiser/publications/automation';
const saved =
  'Texte enregistré de recette transverse.\nRéférence <b>en texte brut</b>.';
const local =
  'Texte local de recette transverse.\nCorrection <b>en texte brut</b>.';
const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);

async function prepare(page: Page, language: string) {
  await page.addInitScript(
    (value) => localStorage.setItem('openg7.language', value),
    language
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
      new URL(request.url()).pathname.startsWith('/api/admin/')
    )
      mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  return mutations;
}

async function tabTo(
  page: Page,
  dialog: Locator,
  target: Locator,
  backwards = false
) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await target.evaluate((element) => document.activeElement === element))
      return;
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement)
      )
    ).toBe(true);
  }
  await expect(target).toBeFocused();
}

async function expectFocusedControlInsideViewport(control: Locator) {
  await expect(control).toBeFocused();
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const x = bounds.left + bounds.width / 2;
        const y = bounds.top + bounds.height / 2;
        const hit = document.elementFromPoint(x, y);
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.left >= -1 &&
          bounds.top >= -1 &&
          bounds.right <= innerWidth + 1 &&
          bounds.bottom <= innerHeight + 1 &&
          !!hit &&
          (hit === element || element.contains(hit))
        );
      })
    )
    .toBe(true);
}

async function expectNoHorizontalOverflow(page: Page, dialog: Locator) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1
    )
  ).toBe(true);
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
  dialog: Locator,
  action: Locator
) {
  const measurements = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const active = document.activeElement;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      dialog: {
        modal: element.matches(':modal'),
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop
      },
      focus: {
        inside: element.contains(active),
        tag: active?.tagName,
        name: active?.getAttribute('aria-label') ?? active?.textContent?.trim()
      }
    };
  });
  const measurementPath = testInfo.outputPath(`${name}-measurements.json`);
  await writeFile(
    measurementPath,
    JSON.stringify(
      {
        ...measurements,
        action: await action.boundingBox(),
        qualification: 'CSS viewport only; no physical controller or OS scaling'
      },
      null,
      2
    ),
    'utf8'
  );
  await testInfo.attach(`${name}-measurements`, {
    path: measurementPath,
    contentType: 'application/json'
  });
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: false,
    animations: 'disabled'
  });
}

export function registerPublicationTransverseAcceptanceTests(
  context: Context
): void {
  for (const language of ['fr-CA', 'en'] as const) {
    const en = language === 'en';
    const dialogName = en ? 'Final publication' : 'Publication finale';
    const closeName = en ? 'Close' : 'Fermer';
    const saveName = en ? 'Save draft' : 'Enregistrer le brouillon';
    const messageName = en ? 'Exact text to publish' : 'Texte exact à publier';

    for (const viewport of [
      { width: 1536, height: 864 },
      { width: 1280, height: 520 },
      // Available CSS space equivalent to 200% of a 1536 by 864 viewport.
      // This does not qualify actual browser zoom or Windows display scaling.
      { width: 768, height: 432 }
    ]) {
      test(`publication transverse acceptance keeps keyboard actions reachable in ${language} at ${viewport.width} by ${viewport.height}`, async ({
        page
      }, testInfo) => {
        const commands = await context.setup(page, {
          job: { message: saved, version: 17 }
        });
        const mutations = await prepare(page, language);
        await page.setViewportSize(viewport);
        await page.goto(path);
        const trigger = page.locator(`[data-og7-id="${id}"]`);
        await trigger.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', {
          name: dialogName,
          exact: true
        });
        await expect(dialog).toBeVisible();
        await expect(page.locator('dialog:modal')).toHaveCount(1);
        const close = dialog
          .getByRole('button', { name: closeName, exact: true })
          .first();
        await expect(close).toBeFocused();
        // A native modal makes background controls inert even without an
        // explicit inert attribute on the surrounding Angular layout.
        await trigger.evaluate((element: HTMLElement) => element.focus());
        await expect(close).toBeFocused();
        const edit = dialog.getByRole('button', {
          name: en ? 'Edit' : 'Modifier',
          exact: true
        });
        await tabTo(page, dialog, edit);
        await expectFocusedControlInsideViewport(edit);
        await page.keyboard.press('Enter');
        const text = dialog.getByLabel(messageName);
        await tabTo(page, dialog, text);
        await text.fill(local);
        const localPreview = hook(page, 'publication-local-preview');
        const reference = hook(page, 'publication-saved-reference');
        const localSummary = localPreview.locator('summary');
        if ((await localPreview.getAttribute('open')) !== null)
          await localSummary.click();
        await tabTo(page, dialog, localSummary);
        await page.keyboard.press('Enter');
        await expect(localPreview).toHaveJSProperty('open', true);
        await expect(localPreview).toContainText(local);
        await expect(localPreview.locator('b')).toHaveCount(0);
        await page.keyboard.press('Enter');
        await expect(localPreview).toHaveJSProperty('open', false);
        await page.keyboard.press('Space');
        await expect(localPreview).toHaveJSProperty('open', true);
        const referenceSummary = reference.locator('summary');
        await page.keyboard.press('Tab');
        await expect(referenceSummary).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(reference).toHaveJSProperty('open', true);
        await expect(reference).toContainText(saved);
        await expect(reference).not.toContainText(local);
        await expect(reference).toContainText('17');
        const save = dialog.getByRole('button', {
          name: saveName,
          exact: true
        });
        await tabTo(page, dialog, save);
        await expectFocusedControlInsideViewport(save);
        await expectNoHorizontalOverflow(page, dialog);
        const prefix = `publication-transverse-${language}-${viewport.width}x${viewport.height}`;
        await capture(page, testInfo, `${prefix}-editor`, dialog, save);
        await tabTo(page, dialog, referenceSummary, true);
        await page.keyboard.press('Enter');
        await expect(reference).toHaveJSProperty('open', false);
        await page.keyboard.press('Enter');
        await expect(reference).toHaveJSProperty('open', true);
        await expect(text).toHaveValue(local);
        await page.keyboard.press('Escape');
        const confirmation = page.getByRole('dialog').filter({
          has: hook(page, 'confirm-action')
        });
        await expect(confirmation).toBeVisible();
        // Both dialogs retain native modal state; only the top one is active.
        await expect(page.locator('dialog:modal')).toHaveCount(2);
        const cancellationButtons = confirmation.getByRole('button', {
          name: en ? 'Cancel' : 'Annuler',
          exact: true
        });
        const initialCancel = cancellationButtons.first();
        const cancel = cancellationButtons.last();
        await expect(initialCancel).toBeFocused();
        await text.evaluate((element: HTMLElement) => element.focus());
        await expect(initialCancel).toBeFocused();
        const discard = confirmation.locator('[data-og7="confirm-action"]');
        await tabTo(page, confirmation, discard);
        await expectFocusedControlInsideViewport(discard);
        await page.keyboard.press('Shift+Tab');
        await expect(cancel).toBeFocused();
        await expectFocusedControlInsideViewport(cancel);
        await expectNoHorizontalOverflow(page, confirmation);
        await capture(
          page,
          testInfo,
          `${prefix}-confirmation`,
          confirmation,
          cancel
        );
        await page.keyboard.press('Escape');
        await expect(confirmation).toBeHidden();
        await expect(page.locator('dialog:modal')).toHaveCount(1);
        await expect(dialog).toBeVisible();
        await expect(text).toHaveValue(local);
        await expect(referenceSummary).toBeFocused();
        expect(commands).toEqual([]);
        expect(mutations).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(confirmation).toBeVisible();
        await tabTo(page, confirmation, discard);
        await expectFocusedControlInsideViewport(discard);
        await page.keyboard.press('Enter');
        await expect(confirmation).toBeHidden();
        await expect(dialog).toBeHidden();
        await expect(page.locator('dialog:modal')).toHaveCount(0);
        await expect(trigger).toBeFocused();
        expect(commands).toEqual([]);
        expect(mutations).toEqual([]);
      });
    }

    test(`publication transverse acceptance requires neutral gamepad input above an unsaved draft in ${language}`, async ({
      page
    }, testInfo) => {
      const commands = await context.setup(page, {
        job: { message: saved, version: 17 }
      });
      const mutations = await prepare(page, language);
      await installAdminController(page);
      await page.setViewportSize({ width: 1280, height: 520 });
      await page.goto(path);
      await page.locator(`[data-og7-id="${id}"]`).click();
      const dialog = page.getByRole('dialog', {
        name: dialogName,
        exact: true
      });
      await dialog
        .getByRole('button', { name: en ? 'Edit' : 'Modifier', exact: true })
        .click();
      const text = dialog.getByLabel(messageName);
      await text.fill(local);
      const pad = adminController(page);
      await pad.ready();
      const close = dialog
        .getByRole('button', { name: closeName, exact: true })
        .first();
      await pad.reach(close);
      await pad.hold('A');
      const confirmation = page.getByRole('dialog').filter({
        has: hook(page, 'confirm-action')
      });
      await expect(confirmation).toBeVisible();
      await pad.hold('A');
      await expect(confirmation).toBeVisible();
      await expect(dialog).toBeVisible();
      expect(commands).toEqual([]);
      expect(mutations).toEqual([]);
      const cancel = confirmation
        .getByRole('button', {
          name: en ? 'Cancel' : 'Annuler',
          exact: true
        })
        .first();
      await expectFocusedControlInsideViewport(cancel);
      await capture(
        page,
        testInfo,
        `publication-transverse-${language}-simulated-controller`,
        confirmation,
        cancel
      );
      await pad.release();
      await pad.press('B');
      await expect(confirmation).toBeHidden();
      await expect(dialog).toBeVisible();
      await expect(text).toHaveValue(local);
      await expect(close).toBeFocused();
      expect(commands).toEqual([]);
      expect(mutations).toEqual([]);
    });
  }
}
