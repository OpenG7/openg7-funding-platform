import type { Locator, Page } from '@playwright/test';
import type { PublicationAutomationCommand } from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  adminController,
  installAdminController
} from './support/admin-controller.js';

type Destination = 'dossier' | 'media' | 'drafts';

interface PublicationNavigationContext {
  host: 'automation' | 'sponsorship';
  open(
    page: Page,
    destination: Destination
  ): Promise<readonly PublicationAutomationCommand[]>;
}

function destinationLink(dialog: Locator, destination: Destination): Locator {
  if (destination === 'dossier')
    return dialog
      .locator('[data-og7="publication-sponsor-review"]')
      .getByRole('link')
      .last();
  return dialog
    .locator(
      `[data-og7="publication-${destination === 'media' ? 'media' : 'content'}-blocker"]`
    )
    .getByRole('link')
    .first();
}

/** The two delivery hosts share the same draft and navigation contract. */
export function registerPublicationNavigationTests(
  context: PublicationNavigationContext
): void {
  for (const language of ['fr-CA', 'en'] as const) {
    for (const destination of ['dossier', 'media', 'drafts'] as const) {
      test(`publication navigation protects unsaved ${context.host} edits before opening ${destination} in ${language}`, async ({
        page
      }) => {
        const english = language === 'en';
        const controllerCancellation =
          context.host === 'automation' && english && destination === 'media';
        if (controllerCancellation) await installAdminController(page);
        await page.addInitScript(
          (locale) => localStorage.setItem('openg7.language', locale),
          language
        );
        const mutations: string[] = [];
        page.on('request', (request) => {
          const pathname = new URL(request.url()).pathname;
          if (
            pathname.startsWith('/api/admin/') &&
            !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
          )
            mutations.push(`${request.method()} ${pathname}`);
        });
        const commands = await context.open(page, destination);
        const dialog = page.getByRole('dialog', {
          name: english ? 'Final publication' : 'Publication finale',
          exact: true
        });
        await dialog
          .getByRole('button', {
            name: english ? 'Edit' : 'Modifier',
            exact: true
          })
          .click();
        const text = dialog.locator('textarea[name="message"]');
        const unsaved = `Synthetic unsaved ${destination} navigation draft.`;
        await text.fill(unsaved);
        const link = destinationLink(dialog, destination);
        const href = await link.getAttribute('href');
        expect(href).toBeTruthy();
        const destinationUrl = new URL(href!, page.url()).href;
        const originalUrl = page.url();
        const confirmation = page.getByRole('dialog').filter({
          has: page.locator('[data-og7="confirm-action"]')
        });

        await link.focus();
        await page.keyboard.press('Enter');
        await expect(confirmation).toBeVisible();
        const initialDecision = confirmation.locator('button:focus');
        await expect(initialDecision).toHaveAccessibleName(
          english ? 'Cancel' : 'Annuler'
        );
        await expect(initialDecision).not.toHaveAttribute(
          'data-og7',
          'confirm-action'
        );
        await expect(page).toHaveURL(originalUrl);
        if (controllerCancellation) await adminController(page).press('B');
        else await page.keyboard.press('Escape');
        await expect(confirmation).toBeHidden();
        await expect(page).toHaveURL(originalUrl);
        await expect(text).toHaveValue(unsaved);
        await expect(link).toBeFocused();
        expect(commands).toEqual([]);
        expect(mutations).toEqual([]);

        await page.keyboard.press('Enter');
        await expect(confirmation).toBeVisible();
        await confirmation.locator('[data-og7="confirm-action"]').click();
        await expect(page).toHaveURL(destinationUrl);
        await expect(confirmation).toBeHidden();
        await expect(dialog).toBeHidden();
        expect(commands).toEqual([]);
        expect(mutations).toEqual([]);
      });
    }
  }
}
