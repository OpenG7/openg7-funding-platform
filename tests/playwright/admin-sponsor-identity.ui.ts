import { AxeBuilder } from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import type { AdminSponsorshipRecord } from '@openg7/funding-core';

import { expect, test } from './support/test.js';

type Language = 'fr-CA' | 'en';
type Role = 'reader' | 'operator' | 'owner';
type IdentityField =
  'organization' | 'email' | 'contact' | 'website' | 'public-name';

interface IdentityTestContext {
  readonly fixtures: (
    page: Page,
    role?: Role
  ) => Promise<{
    readonly calls: readonly {
      readonly method: string;
      readonly url: URL;
      readonly body: Record<string, unknown> | null;
    }[];
    readonly options: {
      readonly edited: Map<string, Partial<AdminSponsorshipRecord>>;
      detailsStatus: number;
      detailsGate: Promise<void> | null;
      listGate: Promise<void> | null;
      listStatus: number;
    };
  }>;
  readonly path: (tab?: string, value?: string) => string;
  readonly id: string;
  readonly date: string;
}

const hook = (page: Page, name: string): Locator =>
  page.locator(`[data-og7="${name}"]`);
const identity = (page: Page): Locator => hook(page, 'dossier-identity');
const field = (page: Page, name: IdentityField): Locator =>
  identity(page).locator(`[data-og7="identity-field"][data-og7-id="${name}"]`);
const tabState = (page: Page): Locator =>
  hook(page, 'dossier-tabs').locator(
    '[data-og7="dossier-tab-state"][data-og7-id="identity"]'
  );

async function appearance(
  page: Page,
  language: Language,
  theme = 'night'
): Promise<void> {
  await page.addInitScript(
    ({ language, theme }) => {
      localStorage.setItem('openg7.language', language);
      localStorage.setItem(
        'openg7.pilotage.appearance.v1',
        JSON.stringify({ theme, system: false })
      );
    },
    { language, theme }
  );
}

async function expectNoOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
  expect(
    await identity(page).evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1
    )
  ).toBe(true);
}

/** Exercises the real Identity view with intercepted, synthetic dossier facts. */
export function registerSponsorIdentityTests({
  fixtures,
  path,
  id,
  date
}: IdentityTestContext): void {
  test.describe('Identity redesign', () => {
    for (const language of ['fr-CA', 'en'] as const) {
      for (const coordinatesComplete of [false, true]) {
        for (const submitted of [false, true]) {
          test(`identity steps remain independent in ${language}: coordinates ${coordinatesComplete}, submitted ${submitted}`, async ({
            page
          }, testInfo) => {
            const representative =
              language === 'fr-CA' && !coordinatesComplete && !submitted;
            const { calls, options } = await fixtures(
              page,
              representative ? 'owner' : 'reader'
            );
            options.edited.set(id, {
              sponsor_company_name: coordinatesComplete
                ? 'Atelier Boréal'
                : null,
              sponsor_contact_email: coordinatesComplete
                ? 'identity@example.invalid'
                : null,
              sponsor_contact_name: null,
              sponsor_website_url: null,
              sponsor_details_submitted_at: submitted ? date : null,
              public_name: 'Synthetic unconsented public name',
              public_display_consent: false
            });
            await appearance(page, language);
            if (representative)
              await page.setViewportSize({ width: 1920, height: 1080 });
            await page.goto(path('identity'));
            await expect(identity(page)).toBeVisible();
            await expect(hook(page, 'identity-step')).toHaveCount(2);
            await expect(hook(page, 'identity-role-help')).toHaveCount(1);
            await expect(
              hook(page, 'identity-coordinates-state')
            ).toHaveAttribute(
              'data-state',
              coordinatesComplete ? 'complete' : 'missing'
            );
            await expect(
              hook(page, 'identity-submission-state')
            ).toHaveAttribute(
              'data-state',
              submitted ? 'submitted' : 'pending'
            );
            await expect(
              hook(page, 'identity-submission-status')
            ).not.toBeEmpty();
            await expect(identity(page)).not.toContainText('admin.dossier.');
            await expect(identity(page)).not.toContainText(
              'Synthetic unconsented public name'
            );
            await expect(field(page, 'public-name')).toHaveAttribute(
              'data-state',
              'unconsented'
            );
            for (const name of ['organization', 'email'] as const) {
              await expect(field(page, name)).toHaveAttribute(
                'data-required',
                'true'
              );
              await expect(field(page, name)).toHaveAttribute(
                'data-state',
                coordinatesComplete ? 'present' : 'missing'
              );
            }
            for (const name of ['contact', 'website'] as const) {
              await expect(field(page, name)).toHaveAttribute(
                'data-required',
                'false'
              );
              await expect(field(page, name)).toHaveAttribute(
                'data-state',
                'optional'
              );
            }
            await expect(field(page, 'public-name')).toHaveAttribute(
              'data-required',
              'false'
            );
            await expect(identity(page).locator('time')).toHaveCount(
              submitted ? 1 : 0
            );
            if (submitted)
              await expect(identity(page).locator('time')).toHaveAttribute(
                'datetime',
                date
              );
            if (coordinatesComplete && submitted) {
              await expect(tabState(page)).toHaveCount(0);
              // Another domain's recommendation remains reachable.
              await expect(hook(page, 'dossier-worklist')).toBeVisible();
            } else {
              await expect(tabState(page)).toHaveAttribute(
                'data-state',
                coordinatesComplete ? 'pending' : 'blocked'
              );
              // Identity explains its own work once, without a second self-link.
              await expect(hook(page, 'dossier-worklist')).toHaveCount(0);
              await expect(
                identity(page).locator('a[href*="tab=identity"]')
              ).toHaveCount(0);
            }
            await expect(
              hook(page, 'identity-submission-required')
            ).toHaveCount(0);
            await expect(identity(page).locator('details')).toHaveCount(0);
            if (representative) {
              await identity(page).screenshot({
                path: testInfo.outputPath('identity-reference-fr-CA-1920.png'),
                animations: 'disabled'
              });
              await hook(page, 'sponsorship-dossier').screenshot({
                path: testInfo.outputPath(
                  'identity-dossier-reference-fr-CA-1920.png'
                ),
                animations: 'disabled'
              });
            }
            expect(calls.every((call) => call.method === 'GET')).toBe(true);
          });
        }
      }
    }

    for (const language of ['fr-CA', 'en'] as const) {
      test(`admin completion finishes Identity while sponsor submission stays pending in ${language}`, async ({
        page
      }, testInfo) => {
        const { calls, options } = await fixtures(page, 'reader');
        options.edited.set(id, {
          sponsor_company_name: 'Organisation complétée',
          sponsor_contact_email: 'admin.completed@example.invalid',
          sponsor_details_submitted_at: null,
          sponsor_details_admin_completed_at: date
        });
        await appearance(page, language);
        await page.setViewportSize({
          width: language === 'en' ? 390 : 1920,
          height: 900
        });
        await page.goto(path('identity'));
        const state = hook(page, 'identity-coordinates-state');
        await expect(state).toHaveAttribute('data-state', 'admin-completed');
        await expect(state).toHaveText(
          language === 'fr-CA' ? 'Complété par l’admin' : 'Completed by admin'
        );
        await expect(hook(page, 'identity-submission-state')).toHaveAttribute(
          'data-state',
          'pending'
        );
        await expect(hook(page, 'identity-submission-state')).toHaveText(
          language === 'fr-CA' ? 'En attente' : 'Pending'
        );
        await expect(tabState(page)).toHaveCount(0);
        await expect(identity(page)).not.toContainText('admin.dossier.');
        await expectNoOverflow(page);
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-og7="dossier-identity"]')
              .analyze()
          ).violations
        ).toEqual([]);
        await identity(page).screenshot({
          path: testInfo.outputPath(`identity-admin-completed-${language}.png`),
          animations: 'disabled'
        });
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
      });
    }

    test('an admin completion marker cannot complete missing coordinates', async ({
      page
    }) => {
      const { options } = await fixtures(page, 'reader');
      options.edited.set(id, {
        sponsor_contact_email: null,
        sponsor_details_submitted_at: null,
        sponsor_details_admin_completed_at: date
      });
      await page.goto(path('identity'));
      await expect(hook(page, 'identity-coordinates-state')).toHaveAttribute(
        'data-state',
        'missing'
      );
      await expect(hook(page, 'identity-submission-state')).toHaveAttribute(
        'data-state',
        'pending'
      );
      await expect(tabState(page)).toHaveAttribute('data-state', 'blocked');
      await expect(hook(page, 'identity-coordinates-state')).not.toContainText(
        'Complété par l’admin'
      );
    });

    test('a real sponsor submission takes precedence over prior admin completion', async ({
      page
    }) => {
      const { options } = await fixtures(page, 'reader');
      options.edited.set(id, {
        sponsor_details_submitted_at: date,
        sponsor_details_admin_completed_at: date
      });
      await page.goto(path('identity'));
      await expect(hook(page, 'identity-coordinates-state')).toHaveAttribute(
        'data-state',
        'complete'
      );
      await expect(hook(page, 'identity-submission-state')).toHaveAttribute(
        'data-state',
        'submitted'
      );
      await expect(tabState(page)).toHaveCount(0);
      await expect(hook(page, 'identity-coordinates-state')).not.toContainText(
        'Complété par l’admin'
      );
    });

    test('admin completion without field changes waits for the server and survives reload', async ({
      page
    }) => {
      const { calls, options } = await fixtures(page, 'operator');
      options.edited.set(id, {
        sponsor_details_submitted_at: null,
        sponsor_details_admin_completed_at: null
      });
      await page.goto(path('identity'));
      await hook(page, 'identity-edit').click();
      const form = hook(page, 'edit-dossier-form');
      const save = form.getByRole('button', {
        name: 'Enregistrer les modifications'
      });
      await expect(save).toBeEnabled();
      let release!: () => void;
      options.detailsGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await save.click();
        await hook(page, 'confirm-action').click();
        await expect
          .poll(() => calls.filter((call) => call.method === 'POST').length)
          .toBe(1);
        await expect(hook(page, 'identity-coordinates-state')).toHaveAttribute(
          'data-state',
          'complete'
        );
        await expect(tabState(page)).toHaveAttribute('data-state', 'pending');
        expect(
          options.edited.get(id)?.sponsor_details_admin_completed_at
        ).toBeNull();
      } finally {
        release();
      }
      await expect(form).toBeHidden();
      await expect(hook(page, 'identity-coordinates-state')).toHaveAttribute(
        'data-state',
        'admin-completed'
      );
      await expect(tabState(page)).toHaveCount(0);
      expect(options.edited.get(id)?.sponsor_details_submitted_at).toBeNull();
      const writes = calls.filter((call) => call.method === 'POST');
      expect(writes).toHaveLength(1);
      expect(writes[0]?.body).not.toHaveProperty(
        'sponsor_details_submitted_at'
      );
      expect(writes[0]?.body).not.toHaveProperty('public_display_consent');
      await page.reload();
      await expect(hook(page, 'identity-coordinates-state')).toHaveAttribute(
        'data-state',
        'admin-completed'
      );
      await expect(hook(page, 'identity-submission-state')).toHaveAttribute(
        'data-state',
        'pending'
      );
      await expect(tabState(page)).toHaveCount(0);
    });

    for (const role of ['reader', 'operator', 'owner'] as const) {
      test(`identity correction and private access retain the ${role} permissions`, async ({
        page
      }) => {
        const { calls } = await fixtures(page, role);
        await page.goto(path('identity'));
        await expect(identity(page)).toBeVisible();
        await expect(hook(page, 'identity-edit')).toHaveCount(
          role === 'reader' ? 0 : 1
        );
        await expect(hook(page, 'identity-followup-access')).toHaveCount(
          role === 'owner' ? 1 : 0
        );
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
      });
    }

    for (const submitted of [false, true]) {
      test(`identity CTA refreshes corrected coordinates without submitting the sponsor form: ${submitted}`, async ({
        page
      }) => {
        const { calls, options } = await fixtures(page, 'operator');
        options.edited.set(id, {
          sponsor_company_name: null,
          sponsor_contact_email: null,
          sponsor_details_submitted_at: submitted ? date : null,
          public_name: 'Unconsented stored name',
          public_display_consent: false
        });
        await page.goto(path('identity'));
        const edit = hook(page, 'identity-edit');
        await edit.focus();
        await edit.press('Enter');
        const form = hook(page, 'edit-dossier-form');
        await expect(form).toBeVisible();
        await form
          .getByLabel('Nom de l’entreprise', { exact: true })
          .fill('Identité corrigée');
        await form
          .getByLabel('Courriel du contact', { exact: true })
          .fill('corrected.identity@example.invalid');
        await form
          .getByRole('button', { name: 'Enregistrer les modifications' })
          .click();
        expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
        await hook(page, 'confirm-action').click();
        await expect(form).toBeHidden();
        await expect(field(page, 'organization')).toContainText(
          'Identité corrigée'
        );
        await expect(field(page, 'email')).toContainText(
          'corrected.identity@example.invalid'
        );
        await expect(hook(page, 'identity-coordinates-state')).toHaveAttribute(
          'data-state',
          submitted ? 'complete' : 'admin-completed'
        );
        await expect(hook(page, 'identity-submission-state')).toHaveAttribute(
          'data-state',
          submitted ? 'submitted' : 'pending'
        );
        await expect(field(page, 'public-name')).toHaveAttribute(
          'data-state',
          'unconsented'
        );
        await expect(identity(page)).not.toContainText(
          'Unconsented stored name'
        );
        const writes = calls.filter((call) => call.method === 'POST');
        expect(writes).toHaveLength(1);
        expect(writes[0]?.url.pathname).toBe('/api/admin/sponsorships/details');
        expect(writes[0]?.body).toMatchObject({
          contributionId: id,
          expectedVersion: 'v1',
          confirmed: true,
          companyName: 'Identité corrigée',
          contactEmail: 'corrected.identity@example.invalid'
        });
        expect(writes[0]?.body).not.toHaveProperty(
          'sponsor_details_submitted_at'
        );
        expect(writes[0]?.body).not.toHaveProperty('public_display_consent');
        expect(options.edited.get(id)?.sponsor_details_submitted_at).toBe(
          submitted ? date : null
        );
        expect(options.edited.get(id)?.public_display_consent).toBe(false);
        await expect
          .poll(
            () =>
              calls.filter(
                (call) =>
                  call.method === 'GET' &&
                  call.url.pathname.endsWith('/progress')
              ).length
          )
          .toBeGreaterThan(1);
        await expect(tabState(page)).toHaveCount(0);
        await edit.click();
        await expect(
          form.getByLabel('Courriel du contact', { exact: true })
        ).toHaveValue('corrected.identity@example.invalid');
        await page.keyboard.press('Escape');
        await expect(edit).toBeFocused();
      });
    }

    test('identity correction failure preserves the draft and persisted step states', async ({
      page
    }) => {
      const { calls, options } = await fixtures(page, 'operator');
      options.edited.set(id, {
        sponsor_contact_email: null,
        sponsor_details_submitted_at: null
      });
      options.detailsStatus = 503;
      await page.goto(path('identity'));
      await hook(page, 'identity-edit').click();
      const form = hook(page, 'edit-dossier-form');
      const email = form.getByLabel('Courriel du contact', { exact: true });
      await email.fill('retry.identity@example.invalid');
      await form
        .getByRole('button', { name: 'Enregistrer les modifications' })
        .click();
      await hook(page, 'confirm-action').click();
      await expect(form.getByRole('alert')).toContainText(
        'Vos saisies sont conservées'
      );
      await expect(email).toHaveValue('retry.identity@example.invalid');
      await expect(hook(page, 'identity-coordinates-state')).toHaveAttribute(
        'data-state',
        'missing'
      );
      await expect(hook(page, 'identity-submission-state')).toHaveAttribute(
        'data-state',
        'pending'
      );
      await page.keyboard.press('Escape');
      await expect(hook(page, 'identity-edit')).toBeFocused();
      expect(options.edited.get(id)?.sponsor_contact_email).toBeNull();
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });

    for (const submitted of [false, true]) {
      test(`identity private access opens its existing tool without resending and restores focus: ${submitted}`, async ({
        page
      }) => {
        const { calls, options } = await fixtures(page, 'owner');
        options.edited.set(id, {
          sponsor_details_submitted_at: submitted ? date : null
        });
        await page.goto(path('identity'));
        const access = hook(page, 'identity-followup-access');
        await access.focus();
        await access.press('Enter');
        const panel = page.locator(
          '[data-og7="dossier-tool-panel"][data-og7-id="access"]'
        );
        await expect(panel).toBeVisible();
        await expect(
          panel
            .locator('[data-og7="admin-followup-access"]')
            .getByRole('button')
        ).toBeFocused();
        await expect(page).toHaveURL(path('identity'));
        await expect(page.locator('dialog[open]')).toHaveCount(0);
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        await expect(access).toBeFocused();
      });
    }

    for (const { language, theme, width, role } of [
      { language: 'fr-CA', theme: 'night', width: 1920, role: 'owner' },
      { language: 'en', theme: 'night', width: 390, role: 'owner' },
      { language: 'fr-CA', theme: 'mineral', width: 1920, role: 'reader' },
      { language: 'en', theme: 'mineral', width: 1280, role: 'operator' },
      { language: 'en', theme: 'graphite', width: 1920, role: 'owner' },
      { language: 'fr-CA', theme: 'graphite', width: 390, role: 'reader' }
    ] as const) {
      test(`identity layout is readable and keyboard accessible with ${theme} in ${language} at ${width}px`, async ({
        page
      }, testInfo) => {
        const { calls, options } = await fixtures(page, role);
        options.edited.set(id, {
          sponsor_company_name: 'Organisation de démonstration',
          sponsor_contact_email: `${'synthetic.contact.'.repeat(3)}team@example.invalid`,
          sponsor_contact_name: null,
          sponsor_website_url: `https://example.invalid/${'synthetic-reference-'.repeat(8)}`,
          public_name: null,
          public_display_consent: false,
          sponsor_details_submitted_at: null
        });
        await appearance(page, language, theme);
        await page.setViewportSize({
          width,
          height: width === 1920 ? 1080 : 900
        });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(path('identity'));
        await expect(identity(page)).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        await expect(hook(page, 'identity-field')).toHaveCount(5);
        await expect(identity(page)).not.toContainText('admin.dossier.');
        await expectNoOverflow(page);
        const fields = await hook(page, 'identity-field').all();
        if (width === 1920) {
          const first = (await fields[0].boundingBox())!;
          const last = (await fields[4].boundingBox())!;
          expect(last.y).toBeCloseTo(first.y, 0);
          expect(last.x).toBeGreaterThan(first.x);
        }
        if (width === 390) {
          for (const control of await identity(page)
            .getByRole('button')
            .all()) {
            const box = (await control.boundingBox())!;
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.width).toBeGreaterThanOrEqual(44);
          }
        }
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-og7="dossier-identity"]')
              .analyze()
          ).violations
        ).toEqual([]);
        if (role !== 'reader') {
          const edit = hook(page, 'identity-edit');
          await edit.focus();
          await edit.press('Enter');
          const form = hook(page, 'edit-dossier-form');
          await expect(form).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(edit).toBeFocused();
        }
        if (theme === 'night' || (theme === 'mineral' && role === 'reader')) {
          await identity(page).screenshot({
            path: testInfo.outputPath(
              `identity-${theme}-${language}-${width}.png`
            ),
            animations: 'disabled'
          });
        }
        expect(calls.every((call) => call.method === 'GET')).toBe(true);
      });
    }

    test('identity does not show invented coordinates while dossier data is loading', async ({
      page
    }) => {
      const { options } = await fixtures(page, 'owner');
      let release!: () => void;
      options.listGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await page.goto(path('identity'));
        await expect(identity(page)).toHaveCount(0);
        await expect(hook(page, 'identity-edit')).toHaveCount(0);
      } finally {
        release();
      }
      await expect(identity(page)).toBeVisible();
      await expect(hook(page, 'identity-coordinates-state')).toHaveAttribute(
        'data-state',
        'complete'
      );
    });

    test('identity remains absent after a server read failure and recovers from server data', async ({
      page
    }) => {
      const { options } = await fixtures(page, 'owner');
      options.listStatus = 503;
      await page.goto(path('identity'));
      await expect(page.getByRole('alert').first()).toBeVisible();
      await expect(identity(page)).toHaveCount(0);
      options.listStatus = 200;
      await page.reload();
      await expect(identity(page)).toBeVisible();
      await expect(hook(page, 'identity-coordinates-state')).toHaveAttribute(
        'data-state',
        'complete'
      );
    });
  });
}
