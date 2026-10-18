import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  AdminSponsorshipRecord,
  SponsorMediaAsset
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

interface SponsorProfileTestContext {
  readonly fixtures: (
    page: Page,
    role?: 'reader' | 'operator' | 'owner'
  ) => Promise<{
    readonly calls: readonly { readonly method: string }[];
    readonly options: {
      readonly edited: Map<string, Partial<AdminSponsorshipRecord>>;
      media: SponsorMediaAsset[];
    };
  }>;
  readonly path: (tab?: string, value?: string) => string;
  readonly asset: () => SponsorMediaAsset;
}

const id = '10000000-0000-4000-8000-000000000401';
const date = '2026-09-16T14:00:00Z';
const identity = (page: Page) => page.locator('[data-og7="dossier-identity"]');
const logo = (page: Page) => page.locator('[data-og7="dossier-logo"]');
const media = (page: Page) =>
  page.locator('[data-og7="media-review-workspace"]');

async function useEnglish(page: Page): Promise<void> {
  await page
    .getByRole('button', {
      name: 'Switch administration language to English'
    })
    .click();
}

async function expectResponsiveProfile(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
  for (const panel of [identity(page), logo(page), media(page)]) {
    expect(
      await panel.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1
      )
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-og7="sponsorship-dossier"]')
        .analyze()
    ).violations
  ).toEqual([]);
}

/** All profile and media data is synthetic and every endpoint is intercepted. */
export function registerSponsorProfileTests({
  fixtures,
  path,
  asset
}: SponsorProfileTestContext): void {
  test('profile media keeps keyboard previews available to a reader while mutations remain disabled', async ({
    page
  }) => {
    const { calls, options } = await fixtures(page, 'reader');
    options.media = [asset()];
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(path('media'));
    const tile = media(page)
      .locator('[data-og7="media-tile"]')
      .first()
      .getByRole('button');
    await tile.focus();
    await tile.press('Enter');
    await expect(
      media(page).locator('[data-og7="media-full-preview"] img')
    ).toBeVisible();
    await expect(
      media(page).locator('[data-og7="media-inspector-alt"]')
    ).toBeDisabled();
    await expect(
      media(page).locator('[data-og7="media-inspector-approve"]')
    ).toBeDisabled();
    await expect(
      media(page).locator('[data-og7="media-upload-files"]')
    ).toBeDisabled();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  for (const locale of ['fr-CA', 'en'] as const) {
    const english = locale === 'en';

    for (const width of [390, 1280]) {
      test(`profile zone separates coordinates, submission and empty media in ${locale} at ${width}px`, async ({
        page
      }) => {
        const { calls, options } = await fixtures(page, 'reader');
        const publicName = 'Synthetic public sponsor name';
        const website = `https://example.invalid/${'synthetic-reference-'.repeat(8)}`;
        const email = `${'synthetic.contact.'.repeat(3)}team@example.invalid`;
        options.edited.set(id, {
          public_name: publicName,
          public_display_consent: true,
          sponsor_contact_email: email,
          sponsor_website_url: website
        });
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path('identity'));
        if (english) await useEnglish(page);

        await expect(
          identity(page).locator('[data-og7="identity-coordinates-state"]')
        ).toHaveAttribute('data-state', 'complete');
        await expect(
          identity(page).locator('[data-og7="identity-submission-state"]')
        ).toHaveAttribute('data-state', 'submitted');
        for (const state of ['coordinates', 'submission']) {
          await expect(
            identity(page).locator(`[data-og7="identity-${state}-state"]`)
          ).not.toBeEmpty();
        }
        await expect(
          identity(page).locator('[data-og7="identity-coordinates-status"]')
        ).toHaveText(
          english
            ? 'The company name and contact email are present.'
            : 'Le nom de l’entreprise et le courriel du contact sont renseignés.'
        );
        await expect(
          identity(page).locator('[data-og7="identity-submission-status"]')
        ).toHaveText(
          english
            ? 'The sponsor has submitted their form.'
            : 'Le commanditaire a transmis son formulaire.'
        );
        await expect(identity(page).locator('time[datetime]')).toHaveAttribute(
          'datetime',
          date
        );
        await expect(identity(page).locator('time')).not.toBeEmpty();
        for (const value of [publicName, website, email]) {
          await expect(
            identity(page).getByText(value, { exact: true })
          ).toHaveCount(1);
          await expect(logo(page)).not.toContainText(value);
        }
        await expect(
          identity(page).locator('[data-og7="identity-edit"]')
        ).toHaveCount(0);
        await expect(logo(page).getByRole('img')).toHaveCount(0);
        await expect(logo(page)).toContainText(
          english ? 'No logo available.' : 'Aucun logo disponible.'
        );
        await expect(
          logo(page).getByRole('button', {
            name: english ? 'Delete logo' : 'Supprimer le logo',
            exact: true
          })
        ).toHaveCount(0);
        await expect(logo(page).locator('input[type="file"]')).toHaveCount(0);
        await expect(
          media(page).locator('[data-og7="media-tile"]')
        ).toHaveCount(0);
        await expect(
          media(page).locator('[data-og7="media-batch-approve"]')
        ).toHaveCount(0);
        await expectResponsiveProfile(page);
        if ((!english && width === 1280) || (english && width === 390)) {
          await page.locator('[data-og7="sponsorship-dossier"]').screenshot({
            path: `test-results/admin-profile-empty-${locale}-${width}.png`
          });
        }
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
      });
    }

    test(`profile zone preserves missing coordinates and pending sponsor submission in ${locale}`, async ({
      page
    }) => {
      const { calls, options } = await fixtures(page, 'reader');
      options.edited.set(id, {
        public_name: 'Synthetic unconsented public name',
        public_display_consent: false,
        sponsor_company_name: null,
        sponsor_contact_email: null,
        sponsor_details_submitted_at: null
      });
      await page.setViewportSize({ width: english ? 390 : 1280, height: 900 });
      await page.goto(path('identity'));
      if (english) await useEnglish(page);

      await expect(
        identity(page).locator('[data-og7="identity-coordinates-state"]')
      ).toHaveAttribute('data-state', 'missing');
      await expect(
        identity(page).locator('[data-og7="identity-submission-state"]')
      ).toHaveAttribute('data-state', 'pending');
      await expect(
        identity(page).locator('[data-og7="identity-submission-status"]')
      ).toHaveText(
        english
          ? 'Waiting for the sponsor to submit their form.'
          : 'En attente de la transmission du formulaire par le commanditaire.'
      );
      await expect(identity(page).locator('time')).toHaveCount(0);
      await expect(identity(page)).not.toContainText(
        'Synthetic unconsented public name'
      );
      await expect(
        identity(page).locator('[data-og7="identity-submission-required"]')
      ).toBeVisible();
      await expectResponsiveProfile(page);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });

    test(`profile zone restores keyboard focus after canceling identity edits in a narrow desktop container in ${locale}`, async ({
      page
    }) => {
      const { calls } = await fixtures(page, 'operator');
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(path('identity'));
      if (english) await useEnglish(page);
      const dossier = page.locator('[data-og7="sponsorship-dossier"]');
      await dossier.evaluate((element) => {
        const panel = element as HTMLElement;
        panel.style.inlineSize = '560px';
        panel.style.maxInlineSize = '560px';
      });
      expect((await dossier.boundingBox())!.width).toBeLessThanOrEqual(560);
      await expectResponsiveProfile(page);

      const edit = identity(page).locator('[data-og7="identity-edit"]');
      await edit.focus();
      await edit.press('Enter');
      const form = page.locator('[data-og7="edit-dossier-form"]');
      await expect(form).toBeVisible();
      await form
        .getByLabel(english ? 'Company name' : 'Nom de l’entreprise', {
          exact: true
        })
        .fill('Synthetic unsaved company');
      const cancel = form.getByRole('button', {
        name: english ? 'Cancel' : 'Annuler',
        exact: true
      });
      await cancel.focus();
      await cancel.press('Enter');
      await expect(form).toHaveCount(0);
      await expect(edit).toBeFocused();
      await expect(identity(page)).toContainText('Atelier Boréal');
      await expect(identity(page)).not.toContainText(
        'Synthetic unsaved company'
      );
      await expectResponsiveProfile(page);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });

    test(`profile media keeps private previews and prevents approval without confirmed usage in ${locale}`, async ({
      page
    }) => {
      const { calls, options } = await fixtures(page, 'operator');
      options.media = [
        {
          ...asset(),
          usage: {
            state: 'needs_confirmation',
            channels: [],
            targets: [],
            transformations: [],
            credit: null,
            restrictions: null
          }
        }
      ];
      await page.setViewportSize({ width: english ? 390 : 1280, height: 900 });
      await page.goto(path('media'));
      if (english) await useEnglish(page);
      const tile = media(page).locator('[data-og7="media-tile"]').first();
      await tile.scrollIntoViewIfNeeded();
      await expect(tile.getByRole('img')).toHaveAttribute('src', /^blob:/);
      await tile.getByRole('button').click();
      await expect(
        media(page).locator('[data-og7="media-full-preview"] img')
      ).toHaveAttribute('src', /^blob:/);
      await expect(
        media(page).locator('[data-og7="media-inspector-approve"]')
      ).toBeDisabled();
      await expectResponsiveProfile(page);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }
}
