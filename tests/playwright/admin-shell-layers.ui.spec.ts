import type { Locator, Page } from '@playwright/test';

import { expect, test } from './support/test.js';
import {
  controllerJourneysFixtures,
  controllerPath
} from './support/controller-journeys.fixtures.js';

const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);

async function expectUncovered(control: Locator): Promise<void> {
  await expect(control).toBeInViewport();
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        return !!hit && (hit === element || element.contains(hit));
      })
    )
    .toBe(true);
}

for (const language of ['fr-CA', 'en'] as const) {
  for (const viewport of [
    { width: 1536, height: 864 },
    { width: 390, height: 844 }
  ]) {
    test(`nested confirmation owns one Escape gesture and preserves the ${language} edit draft at ${viewport.width}px`, async ({
      page
    }) => {
      const state = await controllerJourneysFixtures(page, 'owner', language, {
        hardware: 'native'
      });
      await page.setViewportSize(viewport);
      await page.goto(controllerPath('identity'));
      const opener = hook(page, 'edit-dossier');
      await opener.focus();
      await page.keyboard.press('Enter');
      const form = hook(page, 'edit-dossier-form');
      const company = form.locator('[name="companyName"]');
      const email = form.locator('[name="contactEmail"]');
      await company.fill('Synthetic unsaved company');
      await email.fill('unsaved@example.test');
      const save = form.getByRole('button', {
        name:
          language === 'en' ? 'Save changes' : 'Enregistrer les modifications',
        exact: true
      });
      await save.focus();
      await page.keyboard.press('Enter');
      const confirm = hook(page, 'confirm-action');
      await expect(confirm).toBeVisible();
      await expect(page.locator('dialog[open]')).toHaveCount(2);
      await expectUncovered(confirm);
      expect(state.commands).toEqual([]);

      try {
        await page.keyboard.down('Escape');
        await expect(confirm).toHaveCount(0);
        await expect(page.locator('dialog[open]')).toHaveCount(1);
        await expect(save).toBeFocused();
        // A held key generates another keydown with repeat=true. It must not
        // turn cancellation of the confirmation into dismissal of its parent.
        await page.keyboard.down('Escape');
        await expect(form).toBeVisible();
        await expect(company).toHaveValue('Synthetic unsaved company');
        await expect(email).toHaveValue('unsaved@example.test');
        await expect(save).toBeFocused();
        expect(state.commands).toEqual([]);
      } finally {
        await page.keyboard.up('Escape');
      }
      await expectUncovered(save);
      await page.keyboard.press('Escape');
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(state.commands).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }
}

for (const { language, viewport } of [
  { language: 'en', viewport: { width: 1536, height: 864 } },
  { language: 'fr-CA', viewport: { width: 390, height: 844 } }
]) {
  test(`a pending ${language} dossier save keeps its drawer and draft through Escape at ${viewport.width}px`, async ({
    page
  }) => {
    await controllerJourneysFixtures(page, 'owner', language, {
      hardware: 'native'
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests: unknown[] = [];
    await page.route('**/api/admin/sponsorships/details', async (route) => {
      requests.push(route.request().postDataJSON());
      await gate;
      await route.fulfill({ status: 503, json: {} });
    });
    await page.setViewportSize(viewport);
    await page.goto(controllerPath('identity'));
    await hook(page, 'edit-dossier').click();
    const form = hook(page, 'edit-dossier-form');
    const company = form.locator('[name="companyName"]');
    await company.fill('Synthetic pending company');
    await form.locator('button[type="submit"]').click();
    const requested = page.waitForRequest('**/api/admin/sponsorships/details');
    await hook(page, 'confirm-action').click();
    await requested;
    const parent = page.locator('dialog[open]');
    try {
      await expect(parent).toHaveCount(1);
      await expect(company).toBeDisabled();
      await expect(parent.locator('header button')).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(form).toBeVisible();
      await expect(company).toHaveValue('Synthetic pending company');
      await page.keyboard.press('Enter');
      expect(requests).toHaveLength(1);
    } finally {
      release();
    }
    await expect(form.getByRole('alert')).toBeVisible();
    await expect(company).toBeEnabled();
    await expect(company).toHaveValue('Synthetic pending company');
    expect(requests).toHaveLength(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(hook(page, 'edit-dossier')).toBeFocused();
  });
}

for (const { language, viewport, zoom } of [
  { language: 'fr-CA', viewport: { width: 390, height: 432 }, zoom: 1 },
  { language: 'en', viewport: { width: 768, height: 432 }, zoom: 1 },
  { language: 'fr-CA', viewport: { width: 1440, height: 864 }, zoom: 1.25 },
  { language: 'en', viewport: { width: 390, height: 844 }, zoom: 1.25 }
]) {
  test(`a long ${language} confirmation keeps its actions reachable at ${zoom * 100}% in a ${viewport.width}px viewport`, async ({
    page
  }, testInfo) => {
    const state = await controllerJourneysFixtures(page, 'owner', language, {
      hardware: 'native'
    });
    await page.setViewportSize(viewport);
    await page.goto(controllerPath('identity'));
    await page.evaluate((scale) => {
      document.documentElement.style.zoom = String(scale);
    }, zoom);
    await hook(page, 'edit-dossier').click();
    const form = hook(page, 'edit-dossier-form');
    await form
      .locator('[name="companyName"]')
      .fill(
        'Synthetic company with a long administrative reference '.repeat(3)
      );
    await form
      .locator('[name="contactEmail"]')
      .fill('synthetic.contact@example.test');
    await form.locator('button[type="submit"]').click();
    const confirm = hook(page, 'confirm-action');
    const confirmation = page.locator('dialog[open]').filter({ has: confirm });
    await expectUncovered(confirmation.locator('header button'));
    await expectUncovered(confirm);
    await expect(confirmation.locator('footer')).toBeInViewport();
    const bounds = await confirmation.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        right: rect.right,
        y: rect.y,
        bottom: rect.bottom,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight
      };
    });
    expect(bounds.x).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth + 1);
    expect(bounds.y).toBeGreaterThanOrEqual(-1);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight + 1);
    if (viewport.width === 390 && viewport.height === 432) {
      const content = confirmation.locator('[data-og7="admin-drawer-content"]');
      expect(
        await content.evaluate(
          (element) => element.scrollHeight > element.clientHeight
        )
      ).toBe(true);
    }
    expect(
      await confirmation.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1
      )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(
        `confirmation-${language}-${viewport.width}-${zoom * 100}.png`
      )
    });
    await page.keyboard.press('Escape');
    await expect(form).toBeVisible();
    expect(state.commands).toEqual([]);
  });
}
