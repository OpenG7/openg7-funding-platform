import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  PublicationAutomationCommand,
  PublicationDelivery
} from '@openg7/funding-core';

import { test, expect } from './support/test.js';
import { completeModeration } from './support/moderation.js';
import { capturePublicationReview } from './support/publication-review-capture.js';
import {
  adminController,
  installAdminController
} from './support/admin-controller.js';

interface Context {
  setup(
    page: Page,
    options?: { job?: Partial<PublicationDelivery>; reader?: boolean }
  ): Promise<PublicationAutomationCommand[]>;
}

const id = '11111111-1111-4111-8111-111111111111';

export function registerPublicationContextActionsTests(context: Context): void {
  for (const language of ['fr-CA', 'en'] as const) {
    const en = language === 'en';
    const title = en ? 'Final publication' : 'Publication finale';
    const more = en ? 'Other actions' : 'Autres actions';
    const edit = en ? 'Edit' : 'Modifier';

    async function open(
      page: Page,
      options: { job?: Partial<PublicationDelivery>; reader?: boolean } = {}
    ) {
      const commands = await context.setup(page, options);
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      await page.setViewportSize({ width: en ? 390 : 1536, height: 864 });
      await page.goto('/admin/fundraiser/publications/automation');
      if (options.job?.status === 'approved')
        await page
          .getByRole('button', {
            name: en ? 'Scheduled' : 'Programmées',
            exact: true
          })
          .click();
      await page.locator(`[data-og7-id="${id}"]`).click();
      const dialog = page.getByRole('dialog', { name: title });
      await expect(dialog).toBeVisible();
      return { commands, dialog };
    }

    test(`publication context actions disclose without deciding and Escape restores focus in ${language}`, async ({
      page
    }, testInfo) => {
      const { commands, dialog } = await open(page);
      const disclosure = dialog.locator(
        '[data-og7="publication-more-actions"]'
      );
      const summary = disclosure.locator('summary').first();
      const reject = disclosure.getByRole('button', {
        name: en ? 'Reject' : 'Refuser',
        exact: true
      });
      await expect(summary).toHaveText(more);
      await expect(reject).toBeHidden();
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(reject).toBeVisible();
      await reject.scrollIntoViewIfNeeded();
      await capturePublicationReview(
        page,
        testInfo,
        `context-actions-${language}`,
        {
          language,
          viewport: { width: en ? 390 : 1536, height: 864 },
          access: 'fixture-with-write-controls'
        }
      );
      expect(commands).toEqual([]);
      await reject.focus();
      await page.keyboard.press('Escape');
      await expect(reject).toBeHidden();
      await expect(summary).toBeFocused();
      await expect(dialog).toBeVisible();
      expect(commands).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await page.locator(`[data-og7-id="${id}"]`).click();
      await expect(disclosure).not.toHaveAttribute('open', '');
      expect(commands).toEqual([]);
    });

    test(`publication context actions keep one decision entry while editing preserves local text in ${language}`, async ({
      page
    }) => {
      const { commands, dialog } = await open(page);
      await expect(
        dialog.getByRole('button', {
          name: en ? 'Accept and schedule' : 'Accepter et programmer',
          exact: true
        })
      ).toHaveCount(1);
      await dialog.getByRole('button', { name: edit, exact: true }).click();
      const text = dialog.getByLabel(
        en ? 'Exact text to publish' : 'Texte exact à publier'
      );
      await text.fill(
        'Synthetic local correction retained while reading actions'
      );
      await expect(
        dialog.locator('[data-og7="publication-return-review"]')
      ).toHaveCount(0);
      await expect(
        dialog.getByRole('button', {
          name: en ? 'Accept and schedule' : 'Accepter et programmer',
          exact: true
        })
      ).toHaveCount(0);
      await expect(
        dialog.getByRole('button', {
          name: en ? 'Save draft' : 'Enregistrer le brouillon',
          exact: true
        })
      ).toHaveCount(1);
      const disclosure = dialog.locator(
        '[data-og7="publication-more-actions"]'
      );
      await disclosure.locator('summary').first().click();
      await disclosure
        .getByRole('button', { name: en ? 'Reject' : 'Refuser', exact: true })
        .focus();
      await page.keyboard.press('Escape');
      await expect(text).toHaveValue(
        'Synthetic local correction retained while reading actions'
      );
      await expect(dialog).toBeVisible();
      expect(commands).toEqual([]);
      const result = await new AxeBuilder({ page })
        .include('dialog[open]')
        .analyze();
      expect(result.violations).toEqual([]);
    });

    test(`publication context actions retain moderation and the exact rejection version in ${language}`, async ({
      page
    }) => {
      const { commands, dialog } = await open(page, { job: { version: 17 } });
      const disclosure = dialog.locator(
        '[data-og7="publication-more-actions"]'
      );
      await disclosure.locator('summary').first().click();
      await disclosure
        .getByRole('button', { name: en ? 'Reject' : 'Refuser', exact: true })
        .click();
      await expect(
        page.locator('[data-og7="moderation-decision"]')
      ).toBeVisible();
      expect(commands).toEqual([]);
      await completeModeration(page, true);
      await expect
        .poll(() => commands)
        .toEqual([
          expect.objectContaining({
            action: 'reject',
            id,
            version: 17,
            confirmation: id
          })
        ]);
      await expect(disclosure).toHaveCount(0);
    });

    test(`publication context actions preserve cancellation confirmation in ${language}`, async ({
      page
    }) => {
      const { commands, dialog } = await open(page, {
        job: { status: 'approved', version: 19 }
      });
      const disclosure = dialog.locator(
        '[data-og7="publication-more-actions"]'
      );
      await disclosure.locator('summary').first().click();
      const cancel = disclosure.getByRole('button', {
        name: en ? 'Cancel delivery' : 'Annuler cet envoi',
        exact: true
      });
      await cancel.click();
      const confirmation = page
        .getByRole('dialog')
        .filter({ has: page.locator('[data-og7="confirm-action"]') });
      await expect(confirmation).toBeVisible();
      expect(commands).toEqual([]);
      await confirmation
        .locator('footer')
        .getByRole('button', { name: en ? 'Cancel' : 'Annuler', exact: true })
        .click();
      await expect(confirmation).toBeHidden();
      await expect(cancel).toBeVisible();
      expect(commands).toEqual([]);
      await cancel.click();
      await confirmation.locator('[data-og7="confirm-action"]').click();
      await expect
        .poll(() => commands)
        .toEqual([
          expect.objectContaining({
            action: 'cancel',
            id,
            version: 19,
            confirmation: id
          })
        ]);
    });

    test(`publication context actions require neutral gamepad input before leaving the drawer in ${language}`, async ({
      page
    }) => {
      // Mobile WebKit can spend over 30 s sampling the gamepad animation frames.
      test.setTimeout(60_000);
      await installAdminController(page);
      const { commands, dialog } = await open(page);
      const disclosure = dialog.locator(
        '[data-og7="publication-more-actions"]'
      );
      const summary = disclosure.locator('summary').first();
      await summary.click();
      const reject = disclosure.getByRole('button', {
        name: en ? 'Reject' : 'Refuser',
        exact: true
      });
      const pad = adminController(page);
      await pad.ready();
      await pad.reach(reject);
      await pad.hold('B');
      await expect(reject).toBeHidden();
      await expect(summary).toBeFocused();
      await expect(dialog).toBeVisible();
      await pad.hold('B');
      await expect(dialog).toBeVisible();
      expect(commands).toEqual([]);
      await pad.release();
      await pad.press('B');
      await expect(dialog).toBeHidden();
      expect(commands).toEqual([]);
    });

    test(`publication context actions remain absent for a reader in ${language}`, async ({
      page
    }) => {
      const { commands, dialog } = await open(page, { reader: true });
      await expect(
        dialog.locator('[data-og7="publication-saved-content"]')
      ).toBeVisible();
      await expect(
        dialog.locator('[data-og7="publication-more-actions"]')
      ).toHaveCount(0);
      await expect(
        dialog.getByRole('button', { name: edit, exact: true })
      ).toHaveCount(0);
      expect(commands).toEqual([]);
    });
  }
}
