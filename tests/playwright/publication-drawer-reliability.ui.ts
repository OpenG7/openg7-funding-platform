import type { Page } from '@playwright/test';
import type {
  PublicationAutomationCommand,
  PublicationDelivery
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

interface Context {
  setup(
    page: Page,
    job: Partial<PublicationDelivery>
  ): Promise<PublicationAutomationCommand[]>;
}

const id = '11111111-1111-4111-8111-111111111111';
const path = '/admin/fundraiser/publications/automation';

export function registerPublicationDrawerReliabilityTests(
  context: Context
): void {
  test.describe('publication drawer reliability', () => {
    test.use({ timezoneId: 'America/Toronto' });

    for (const language of ['fr-CA', 'en'] as const) {
      const en = language === 'en';
      const dialogName = en ? 'Final publication' : 'Publication finale';
      const editName = en ? 'Edit' : 'Modifier';
      const saveName = en ? 'Save draft' : 'Enregistrer le brouillon';
      const messageName = en
        ? 'Exact text to publish'
        : 'Texte exact à publier';
      const dateName = en
        ? 'Date and time (America/Toronto)'
        : 'Date et heure (America/Toronto)';

      const prepare = async (page: Page, job: Partial<PublicationDelivery>) => {
        const commands = await context.setup(page, job);
        await page.addInitScript(
          (value) => localStorage.setItem('openg7.language', value),
          language
        );
        await page.setViewportSize({ width: en ? 390 : 1536, height: 864 });
        await page.goto(path);
        return commands;
      };

      test(`unchanged repeated delivery time keeps its exact instant in ${language}`, async ({
        page
      }) => {
        const scheduledAt = '2030-11-03T06:30:45.123Z';
        const commands = await prepare(page, { scheduledAt, version: 17 });
        await page.locator(`[data-og7-id="${id}"]`).click();
        const dialog = page.getByRole('dialog', { name: dialogName });
        await dialog
          .getByRole('button', { name: editName, exact: true })
          .click();
        await expect(dialog.getByLabel(dateName, { exact: true })).toHaveValue(
          '2030-11-03T01:30'
        );
        await dialog
          .getByLabel(messageName)
          .fill('Synthetic corrected content');
        await dialog
          .getByRole('button', { name: saveName, exact: true })
          .click();
        await expect
          .poll(() => commands)
          .toEqual([
            expect.objectContaining({
              action: 'edit',
              id,
              version: 17,
              scheduledAt,
              message: 'Synthetic corrected content'
            })
          ]);
        await expect(
          page.locator('[data-og7="publication-content-context"]')
        ).toContainText('18');
        await expect(
          dialog.getByRole('checkbox', { name: /J’approuve|I approve/ })
        ).not.toBeChecked();
      });

      for (const [name, invalid] of [
        ['missing', '2030-03-10T02:30'],
        ['repeated', '2030-11-03T01:30']
      ] as const) {
        test(`${name} delivery time is rejected without losing the draft in ${language}`, async ({
          page
        }) => {
          const commands = await prepare(page, {});
          await page.locator(`[data-og7-id="${id}"]`).click();
          const dialog = page.getByRole('dialog', { name: dialogName });
          await dialog
            .getByRole('button', { name: editName, exact: true })
            .click();
          const date = dialog.getByLabel(dateName, { exact: true });
          await dialog
            .getByLabel(messageName)
            .fill('Synthetic retained correction');
          await date.fill(invalid);
          const save = dialog.getByRole('button', {
            name: saveName,
            exact: true
          });
          for (const attempt of [1, 2]) {
            if (attempt === 2) {
              await dialog
                .locator('[data-og7="admin-drawer-content"]')
                .evaluate((body) => {
                  body.scrollTop = body.scrollHeight;
                });
              await save.focus();
              await expect(save).toBeFocused();
            }
            await save.click();
            await expect(
              page.locator('[data-og7="publication-schedule-error"]')
            ).toHaveText(
              en
                ? 'Check the date and timezone. Choose a time that occurs once in that timezone; missing or repeated times during a clock change are rejected.'
                : 'Vérifiez la date et le fuseau. Choisissez une heure qui existe une seule fois dans ce fuseau; les heures absentes ou répétées au changement d’heure sont refusées.'
            );
            await expect(date).toHaveAttribute('aria-invalid', 'true');
            await expect(date).toHaveAccessibleDescription(
              /missing or repeated|heures absentes ou répétées/
            );
            await expect(date).toBeFocused();
            await expect
              .poll(() =>
                dialog
                  .locator('[data-og7="publication-schedule-error"]')
                  .evaluate((error) => {
                    const body = error.closest(
                      '[data-og7="admin-drawer-content"]'
                    )!;
                    const field = body.querySelector('input[name="date"]')!;
                    const bounds = body.getBoundingClientRect();
                    const visible = (element: Element) => {
                      const rect = element.getBoundingClientRect();
                      return (
                        rect.top >= Math.max(0, bounds.top) &&
                        rect.bottom <= Math.min(innerHeight, bounds.bottom) &&
                        rect.left >= Math.max(0, bounds.left) &&
                        rect.right <= Math.min(innerWidth, bounds.right)
                      );
                    };
                    return { field: visible(field), message: visible(error) };
                  })
              )
              .toEqual({ field: true, message: true });
            await expect(date).toHaveValue(invalid);
            await expect(dialog.getByLabel(messageName)).toHaveValue(
              'Synthetic retained correction'
            );
            expect(commands).toEqual([]);
          }
          await date.fill('2030-03-10T03:30');
          await expect(
            page.locator('[data-og7="publication-schedule-error"]')
          ).toHaveCount(0);
          await dialog
            .getByRole('button', { name: saveName, exact: true })
            .click();
          await expect
            .poll(() => commands)
            .toEqual([
              expect.objectContaining({
                action: 'edit',
                scheduledAt: '2030-03-10T07:30:00.000Z',
                message: 'Synthetic retained correction'
              })
            ]);
        });
      }

      for (const [status, mode, hasUrl, visible] of [
        ['published', 'mock', true, false],
        ['published', 'live', true, true],
        ['published', 'live', false, false],
        ['approved', 'live', true, false],
        ['uncertain', 'live', true, false]
      ] as const) {
        test(`public result link for ${status}/${mode}/${hasUrl ? 'URL' : 'no URL'} is truthful in ${language}`, async ({
          page
        }) => {
          const url = 'https://social.example.test/synthetic-publication';
          const commands = await prepare(page, {
            status,
            mode,
            externalPostUrl: hasUrl ? url : null
          });
          await page
            .getByRole('button', {
              name:
                status === 'published'
                  ? en
                    ? 'History'
                    : 'Historique'
                  : status === 'approved'
                    ? en
                      ? 'Scheduled'
                      : 'Programmées'
                    : en
                      ? 'Needs attention'
                      : 'À résoudre',
              exact: true
            })
            .click();
          await page.locator(`[data-og7-id="${id}"]`).click();
          const dialog = page.getByRole('dialog', { name: dialogName });
          const link = dialog.getByRole('link', {
            name: en ? 'View publication' : 'Voir la publication',
            exact: true
          });
          if (visible) {
            await expect(link).toHaveAttribute('href', url);
            await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
          } else await expect(link).toHaveCount(0);
          if (mode === 'mock') await expect(dialog).toContainText('Simulation');
          expect(commands).toEqual([]);
        });
      }
    }
  });
}
