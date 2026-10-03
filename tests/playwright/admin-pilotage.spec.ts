import { readFile } from 'node:fs/promises';

import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  AdminContributionsResponse,
  PilotCommand,
  PilotDecision,
  PilotState,
  ProgrammeState
} from '@openg7/funding-core';

import { test, expect } from './support/test.js';

function guide(page: Page, id = 'pilotage') {
  return page.locator(`[data-og7="admin-guide"][data-og7-id="${id}"]`);
}
function guideLaunch(page: Page, id = 'pilotage') {
  return page.locator(`[data-og7="guide-launch"][data-og7-id="${id}"]`);
}

function overviewCount(page: Page, label: string) {
  return page
    .locator('[data-og7="pilot-overview"] > div')
    .filter({ has: page.getByRole('term').filter({ hasText: label }) })
    .getByRole('definition')
    .first();
}

const adminPalettes = {
  night: { background: 'rgb(11, 23, 39)', sidebar: 'rgb(13, 27, 44)' },
  mineral: { background: 'rgb(243, 242, 238)', sidebar: 'rgb(233, 232, 226)' },
  graphite: { background: 'rgb(25, 27, 31)', sidebar: 'rgb(30, 33, 38)' }
};

async function expectAdminPalette(
  page: Page,
  theme: keyof typeof adminPalettes
) {
  await expect(page.locator('openg7-admin-layout')).toHaveCSS(
    'background-color',
    adminPalettes[theme].background
  );
  await expect(page.locator('openg7-admin-nav aside')).toHaveCSS(
    'background-color',
    adminPalettes[theme].sidebar
  );
}

for (const theme of ['night', 'mineral', 'graphite'] as const) {
  test(`shared admin appearance ${theme} survives navigation, reload and direct entry`, async ({
    page
  }) => {
    const { commands } = await fixtures(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin/fundraiser/pilotage');
    await page.locator('[data-og7="pilot-appearance"]').click();
    await page.locator(`[data-og7="pilot-theme-${theme}"]`).check();
    await page.keyboard.press('Escape');
    await expectAdminPalette(page, theme);
    const navigation = page.getByRole('navigation', {
      name: 'Navigation admin du fonds'
    });
    await navigation
      .getByRole('link', { name: 'Contributions', exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/fundraiser\/contributions$/);
    await expect(
      page.getByRole('heading', { name: 'Contributions', exact: true })
    ).toBeVisible();
    await expectAdminPalette(page, theme);
    await navigation.getByRole('link', { name: 'Poste de pilotage' }).click();
    await expect(page).toHaveURL(/\/pilotage$/);
    await expectAdminPalette(page, theme);
    await page.locator('[data-og7="pilot-appearance"]').click();
    await expect(
      page.locator(`[data-og7="pilot-theme-${theme}"]`)
    ).toBeChecked();
    await page.keyboard.press('Escape');
    await navigation
      .getByRole('link', { name: 'Contributions', exact: true })
      .click();
    await expect(page).toHaveURL(/\/contributions$/);
    await page.reload();
    await expectAdminPalette(page, theme);
    await page.goto('/admin/fundraiser/contributions');
    await expectAdminPalette(page, theme);
    expect(commands).toEqual([]);
  });
}

test('shared admin appearance follows system changes outside pilotage', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-appearance"]').click();
  await page.locator('[data-og7="pilot-theme-system"]').check();
  await page.keyboard.press('Escape');
  const navigation = page.getByRole('navigation', {
    name: 'Navigation admin du fonds'
  });
  await navigation
    .getByRole('link', { name: 'Contributions', exact: true })
    .click();
  await expect(page).toHaveURL(/\/contributions$/);
  await expectAdminPalette(page, 'mineral');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectAdminPalette(page, 'night');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectAdminPalette(page, 'mineral');
  await page.reload();
  await expectAdminPalette(page, 'mineral');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectAdminPalette(page, 'night');
  await navigation.getByRole('link', { name: 'Poste de pilotage' }).click();
  await expect(page).toHaveURL(/\/pilotage$/);
  await expectAdminPalette(page, 'night');
  await page.locator('[data-og7="pilot-appearance"]').click();
  await expect(page.locator('[data-og7="pilot-theme-system"]')).toBeChecked();
  expect(commands).toEqual([]);
});

for (const theme of ['night', 'mineral', 'graphite']) {
  for (const language of ['fr-CA', 'en']) {
    for (const width of [390, 1440]) {
      test(`appearance ${theme} stays readable in ${language} at ${width}px`, async ({
        page
      }, testInfo) => {
        const { state, commands } = await fixtures(page);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/admin/fundraiser/pilotage');
        if (language === 'en')
          await page
            .getByRole('button', {
              name: 'Switch administration language to English'
            })
            .click();
        const open = page.locator('[data-og7="pilot-appearance"]');
        await open.click();
        await page.locator(`[data-og7="pilot-theme-${theme}"]`).check();
        await expect(page.locator('html')).toHaveAttribute(
          'data-og7-pilot-theme',
          theme
        );
        await page.locator('[data-og7="pilot-density-compact"]').check();
        await expect(page.locator('html')).toHaveAttribute(
          'data-og7-pilot-density',
          'compact'
        );
        await expect(page.getByRole('dialog')).not.toContainText(
          'admin.appearance.'
        );
        if (language === 'fr-CA') {
          const audit = await new AxeBuilder({ page })
            .include('dialog[open]')
            .analyze();
          expect(audit.violations).toEqual([]);
        }
        await page.screenshot({ path: testInfo.outputPath('appearance.png') });
        await page.keyboard.press('Escape');
        await expect(open).toBeFocused();
        await expect(
          page.locator('[data-og7="pilot-decision"]')
        ).toHaveAttribute('data-og7-id', state.decisions[0]!.id);
        await expect(page.locator('[data-og7="pilot-accept"]')).toBeInViewport({
          ratio: 1
        });
        await expect(page.locator('[data-og7="pilot-details"]')).toBeInViewport(
          { ratio: 1 }
        );
        await page.screenshot({ path: testInfo.outputPath('workspace.png') });
        if (language === 'fr-CA') {
          const audit = await new AxeBuilder({ page })
            .include('openg7-admin-pilotage-page')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze();
          expect(audit.violations).toEqual([]);
        }
        await page.locator('[data-og7="pilot-focus"]').click();
        await expect(page.locator('openg7-admin-nav')).toBeHidden();
        await expect(page.locator('[data-og7="pilot-domains"]')).toBeHidden();
        await expect(
          page.locator('[data-og7="pilot-decision"]')
        ).toHaveAttribute('data-og7-id', state.decisions[0]!.id);
        await page.locator('[data-og7="pilot-show-queue"]').click();
        await expect(page.locator('#pilot-following')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('focus.png') });
        await page.locator('[data-og7="pilot-focus"]').click();
        await expect(page.locator('openg7-admin-nav')).toBeVisible();
        await page.reload();
        await open.click();
        await expect(
          page.locator(`[data-og7="pilot-theme-${theme}"]`)
        ).toBeChecked();
        await expect(
          page.locator('[data-og7="pilot-density-compact"]')
        ).toBeChecked();
        expect(commands).toEqual([]);
      });
    }
  }
}

test('system appearance preserves an unfinished edit and synchronizes other tabs', async ({
  page
}) => {
  const { commands, state } = await fixtures(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-appearance"]').click();
  await page.locator('[data-og7="pilot-theme-system"]').check();
  await expect(page.locator('html')).toHaveAttribute(
    'data-og7-pilot-theme',
    'mineral'
  );
  await page.keyboard.press('Escape');
  await page.locator('[data-og7="pilot-edit"]').click();
  const draft = page.getByRole('dialog').locator('textarea').first();
  await draft.fill('Brouillon non enregistré');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute(
    'data-og7-pilot-theme',
    'night'
  );
  await expect(draft).toHaveValue('Brouillon non enregistré');
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'openg7.pilotage.appearance.v1',
        newValue: JSON.stringify({
          theme: 'graphite',
          system: false,
          density: 'compact'
        }),
        storageArea: localStorage
      })
    )
  );
  await expect(page.locator('html')).toHaveAttribute(
    'data-og7-pilot-theme',
    'graphite'
  );
  await expect(draft).toHaveValue('Brouillon non enregistré');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-og7="pilot-decision"]')).toHaveAttribute(
    'data-og7-id',
    state.decisions[0]!.id
  );
  expect(commands).toEqual([]);
});

test('appearance handles invalid and blocked storage without blocking decisions', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.addInitScript(() => {
    localStorage.setItem('openg7.pilotage.appearance.v1', '{invalid');
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'openg7.pilotage.appearance.v1')
        throw new DOMException('Unavailable', 'QuotaExceededError');
      setItem.call(this, key, value);
    };
  });
  await page.goto('/admin/fundraiser/pilotage');
  await expect(page.locator('html')).toHaveAttribute(
    'data-og7-pilot-theme',
    'night'
  );
  await page.locator('[data-og7="pilot-appearance"]').click();
  await page.locator('[data-og7="pilot-theme-mineral"]').check();
  await expect(page.getByRole('dialog')).toContainText(
    'Le navigateur ne permet pas'
  );
  await expect(page.locator('html')).toHaveAttribute(
    'data-og7-pilot-theme',
    'mineral'
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-og7="pilot-accept"]')).toBeEnabled();
  expect(commands).toEqual([]);
});

test('saved appearance is applied before Angular starts', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'openg7.pilotage.appearance.v1',
      JSON.stringify({ theme: 'graphite', density: 'compact' })
    )
  );
  await page.route('**/main-*.js', (route) => route.abort());
  await page.goto('/admin/fundraiser/pilotage');
  await expect(page.locator('html')).toHaveAttribute(
    'data-og7-pilot-theme',
    'graphite'
  );
  await expect(page.locator('html')).toHaveAttribute(
    'data-og7-pilot-density',
    'compact'
  );
});

test('short screens and enlarged text keep appearance and decisions reachable', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.goto('/admin/fundraiser/pilotage');
  for (const size of [
    { width: 844, height: 390 },
    { width: 320, height: 740 }
  ]) {
    await page.setViewportSize(size);
    await page.locator('[data-og7="pilot-appearance"]').click();
    await page.locator('[data-og7="pilot-theme-mineral"]').check();
    await page.keyboard.press('Escape');
    await page.locator('[data-og7="pilot-details"]').click();
    await expect(
      page.locator('[data-og7="pilot-panel-details"]')
    ).toBeVisible();
    const detailsAudit = await new AxeBuilder({ page })
      .include('dialog[open]')
      .analyze();
    expect(detailsAudit.violations).toEqual([]);
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect
    .poll(() =>
      page
        .locator('[data-og7="pilot-scroll"]')
        .evaluate((el) => el.clientHeight)
    )
    .toBeGreaterThan(80);
  await page.locator('[data-og7="pilot-appearance"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.locator('[data-og7="pilot-accept"]').click();
  await expect(page.locator('[data-og7="pilot-panel-confirm"]')).toBeVisible();
  expect(commands).toEqual([]);
});

test('appearance owns controller input and the stick scrolls the focused workspace', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-appearance"]').click();
  await page.locator('[data-og7="pilot-theme-mineral"]').focus();
  await buttons(page);
  await buttons(page, [0]);
  await expect(page.locator('html')).toHaveAttribute(
    'data-og7-pilot-theme',
    'mineral'
  );
  await page.waitForTimeout(400);
  await expect(
    page.locator('[data-og7="pilot-panel-appearance"]')
  ).toBeVisible();
  expect(commands).toEqual([]);
  await tap(page, 1);
  await expect(page.locator('[data-og7="pilot-appearance"]')).toBeFocused();
  await page.locator('[data-og7="pilot-focus"]').click();
  await page.locator('[data-og7="pilot-scroll"]').evaluate((el) => {
    el.scrollTop = 0;
  });
  await buttons(page);
  await page.evaluate(() => {
    (
      window as unknown as { fixturePad: { axes: number[] } }
    ).fixturePad.axes[3] = 0.9;
  });
  await expect
    .poll(() =>
      page.locator('[data-og7="pilot-scroll"]').evaluate((el) => el.scrollTop)
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    (
      window as unknown as { fixturePad: { axes: number[] } }
    ).fixturePad.axes[3] = 0;
  });
  await expect(page.locator('[data-og7="pilot-focus"]')).toBeInViewport({
    ratio: 1
  });
  await expect(page.locator('[data-og7="pilot-accept"]')).toBeInViewport({
    ratio: 1
  });
  expect(commands).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`right stick reveals the end of a long decision without opening a panel at ${width}px`, async ({
    page
  }) => {
    const { state, commands } = await fixtures(page);
    const marker = 'Fin du contenu à examiner.';
    state.decisions[0]!.publication!.message =
      Array.from(
        { length: 40 },
        (_, index) => 'Paragraphe ' + index + ' du dossier à examiner.'
      ).join('\n') +
      '\n' +
      marker;
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin/fundraiser/pilotage');
    await page.locator('[data-og7="pilot-focus"]').click();
    await expect(page.locator('[data-og7="pilot-decision"]')).toHaveAttribute(
      'data-og7-id',
      state.decisions[0]!.id
    );
    await buttons(page);
    await page.evaluate(() => {
      (
        window as unknown as { fixturePad: { axes: number[] } }
      ).fixturePad.axes[3] = 0.9;
    });
    await expect
      .poll(() =>
        page
          .locator('[data-og7="pilot-decision"]')
          .evaluate((element, ending) => {
            const walker = document.createTreeWalker(
              element,
              NodeFilter.SHOW_TEXT
            );
            let node: Node | null;
            while ((node = walker.nextNode())) {
              const index = node.textContent?.indexOf(ending) ?? -1;
              if (index < 0) continue;
              const range = document.createRange();
              range.setStart(node, index);
              range.setEnd(node, index + ending.length);
              const text = range.getBoundingClientRect();
              const content = node.parentElement!.getBoundingClientRect();
              const frame = element
                .closest('[data-og7="pilot-scroll"]')!
                .getBoundingClientRect();
              return (
                text.top >= Math.max(content.top, frame.top) &&
                text.bottom <= Math.min(content.bottom, frame.bottom)
              );
            }
            return false;
          }, marker)
      )
      .toBe(true);
    await page.evaluate(() => {
      (
        window as unknown as { fixturePad: { axes: number[] } }
      ).fixturePad.axes[3] = -0.9;
    });
    await expect
      .poll(() =>
        page.locator('[data-og7="pilot-scroll"]').evaluate((el) => el.scrollTop)
      )
      .toBe(0);
    await page.evaluate(() => {
      (
        window as unknown as { fixturePad: { axes: number[] } }
      ).fixturePad.axes[3] = 0;
    });
    await expect(page.locator('[data-og7="pilot-accept"]')).toBeInViewport({
      ratio: 1
    });
    await expect(page.locator('[data-og7="pilot-decision"]')).toHaveAttribute(
      'data-og7-id',
      state.decisions[0]!.id
    );
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(commands).toEqual([]);
  });
}

for (const language of ['fr-CA', 'en']) {
  test(`guide keeps the automation indicator inside its scroll viewport in ${language}`, async ({
    page
  }, testInfo) => {
    const { commands } = await fixtures(page);
    await page.addInitScript(
      (lang) => localStorage.setItem('openg7.language', lang),
      language
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/fundraiser/pilotage');
    await guideLaunch(page).click();
    const tour = guide(page);
    for (const size of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
      { width: 390, height: 900 }
    ]) {
      await page.setViewportSize(size);
      await expect(async () => {
        const target = (await page
          .locator('[data-og7="pilot-automation"]')
          .boundingBox())!;
        const frame = (await page
          .locator('[data-og7="pilot-scroll"]')
          .boundingBox())!;
        const ring = (await tour
          .locator('[data-og7="guide-highlight"]')
          .boundingBox())!;
        const card = (await tour
          .locator('[data-og7="guide-card"]')
          .boundingBox())!;
        expect(target.y).toBeGreaterThanOrEqual(frame.y);
        expect(target.y + target.height).toBeLessThanOrEqual(
          frame.y + frame.height
        );
        expect(ring.y).toBeGreaterThanOrEqual(frame.y);
        expect(ring.y + ring.height).toBeLessThanOrEqual(
          frame.y + frame.height
        );
        const overlap =
          target.x < card.x + card.width &&
          target.x + target.width > card.x &&
          target.y < card.y + card.height &&
          target.y + target.height > card.y;
        expect(overlap).toBe(false);
      }).toPass({ timeout: 7000 });
    }
    await page.screenshot({
      path: testInfo.outputPath('visible-guide-target.png')
    });
    await page.locator('[data-og7="pilot-automation"]').evaluate((el) => {
      const frame = el.closest('[data-og7="pilot-scroll"]')!;
      frame.scrollTop +=
        el.getBoundingClientRect().top - frame.getBoundingClientRect().top + 20;
    });
    await expect(async () => {
      const frame = (await page
        .locator('[data-og7="pilot-scroll"]')
        .boundingBox())!;
      const ring = (await tour
        .locator('[data-og7="guide-highlight"]')
        .boundingBox())!;
      expect(ring.y).toBeGreaterThanOrEqual(frame.y);
      expect(ring.y + ring.height).toBeLessThanOrEqual(frame.y + frame.height);
    }).toPass({ timeout: 7000 });
    await page.keyboard.press('Escape');
    await expect(guideLaunch(page)).toBeFocused();
    expect(commands).toEqual([]);
  });
}

for (const language of ['fr-CA', 'en']) {
  for (const width of [390, 1280]) {
    test(`detail panel keeps context and navigation visible in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      const { state, commands } = await fixtures(page);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/admin/fundraiser/pilotage');
      if (language === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const open = page.locator('[data-og7="pilot-details"]');
      await expect(
        page.locator('[data-og7="pilot-decision"] img')
      ).toBeVisible();
      await open.click();
      const dialog = page.getByRole('dialog');
      const body = dialog.locator('[data-og7="admin-drawer-content"]');
      const footer = dialog.locator('[data-og7="pilot-details-footer"]');
      await expect(dialog).toContainText('OpenG7 · Facebook');
      await expect(
        dialog.getByText('Simulation', {
          exact: true
        })
      ).toBeVisible();
      await expect(dialog).not.toContainText('openg7:facebook');
      await expect(
        dialog.getByRole('complementary', {
          name: language === 'en' ? 'If you accept' : 'Si vous acceptez'
        })
      ).toBeVisible();
      await expect(dialog).toContainText('America/Toronto');
      await dialog.screenshot({ path: testInfo.outputPath('details.png') });
      const a11y = await new AxeBuilder({ page })
        .include('dialog[open]')
        .analyze();
      expect(a11y.violations).toEqual([]);
      const close = dialog
        .getByRole('button', {
          name: language === 'en' ? 'Close' : 'Fermer',
          exact: true
        })
        .first();
      await close.focus();
      await page.keyboard.press('Shift+Tab');
      await expect(footer.getByRole('link')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(body).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(open).toBeFocused();

      state.decisions[0]!.publication!.message = Array.from(
        { length: 24 },
        (_, i) =>
          'Paragraphe ' +
          i +
          ' — Texte synthétique à examiner avant publication.'
      ).join('\n\n');
      await page.reload();
      await open.click();
      await expect(footer.getByRole('link')).toBeInViewport();
      await expect(footer.getByRole('button')).toBeInViewport();
      await body.focus();
      await page.keyboard.press('End');
      await expect
        .poll(() => body.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      await expect(footer.getByRole('link')).toBeInViewport();
      await body.evaluate((el) => {
        el.scrollTop = 0;
      });
      await buttons(page);
      await page.evaluate(() => {
        (
          window as unknown as { fixturePad: { axes: number[] } }
        ).fixturePad.axes[3] = 0.9;
      });
      await expect
        .poll(() => body.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      await page.evaluate(() => {
        (
          window as unknown as { fixturePad: { axes: number[] } }
        ).fixturePad.axes[3] = 0;
      });
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)
      ).toBe(true);
      await tap(page, 1);
      await expect(open).toBeFocused();
      expect(commands).toEqual([]);
    });
  }
}

async function emailDetailFixtures(page: Page) {
  const f = await fixtures(page, 1);
  const original = f.state.decisions[0]!;
  const decision: PilotDecision = {
    id: 'email:' + original.targetId,
    targetId: original.targetId,
    version: '1',
    domain: 'email',
    kind: 'email_failed',
    title: 'Courriel synthétique à examiner',
    dueAt: null,
    severity: 'today',
    detailsUrl: '/admin/fundraiser/email-queue',
    facts: [],
    actions: [{ id: 'email.retry', blocked: null }]
  };
  f.state.decisions = [decision];
  f.state.domains.publications = 0;
  f.state.domains.email = 1;
  return { ...f, decision };
}

test('email details require an explicit reread of a changed version and retain the confirmation flow', async ({
  page
}) => {
  const f = await emailDetailFixtures(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const email = {
    subject: 'Objet du courriel synthétique',
    recipient: 'fixture@example.invalid',
    text: 'Contenu privé de test.'
  };
  await page.route('**/api/admin/pilotage?*', async (route) => {
    if (!new URL(route.request().url()).searchParams.has('id'))
      return route.fallback();
    if (++reads === 1) await gate;
    await route.fulfill({
      json: { ...f.state, decisions: [{ ...f.decision, version: '2', email }] }
    });
  });
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-details"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('status')).toContainText(
    'Chargement du courriel'
  );
  await expect(dialog).not.toContainText(email.recipient);
  release();
  await expect(dialog.getByRole('alert')).toContainText('Le dossier a changé');
  await expect(dialog).not.toContainText(email.subject);
  await dialog
    .getByRole('button', { name: 'Charger la version à jour' })
    .click();
  await expect(dialog).toContainText(email.subject);
  await expect(dialog).toContainText(email.recipient);
  await expect(dialog).toContainText(email.text);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(
    dialog.locator('[data-og7="admin-drawer-content"]')
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-og7="pilot-accept"]')).toBeEnabled();
  await page.locator('[data-og7="pilot-accept"]').click();
  await expect(page.locator('[data-og7="pilot-panel-confirm"]')).toContainText(
    email.text
  );
  await page.keyboard.press('Escape');
  expect(reads).toBe(3);
  expect(f.commands).toEqual([]);
});

for (const status of [503, 403, 401]) {
  test(`email detail hides cached content after a ${status} response`, async ({
    page
  }) => {
    const f = await emailDetailFixtures(page);
    let failure = 0;
    const email = {
      subject: 'Objet privé synthétique',
      recipient: 'private@example.invalid',
      text: 'Corps privé synthétique'
    };
    await page.route('**/api/admin/pilotage?*', async (route) => {
      if (!new URL(route.request().url()).searchParams.has('id'))
        return route.fallback();
      await route.fulfill(
        failure
          ? { status: failure, json: {} }
          : { json: { ...f.state, decisions: [{ ...f.decision, email }] } }
      );
    });
    await page.goto('/admin/fundraiser/pilotage');
    await page.locator('[data-og7="pilot-details"]').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(email.subject);
    await page.keyboard.press('Escape');
    failure = status;
    await page.locator('[data-og7="pilot-details"]').click();
    await expect(dialog.getByRole('alert')).toContainText(
      status === 503
        ? 'n’a pas pu être chargé'
        : status === 403
          ? 'plus accès'
          : 'session a expiré'
    );
    await expect(dialog).not.toContainText(email.subject);
    await expect(dialog).not.toContainText(email.text);
    await expect(dialog).not.toContainText(email.recipient);
    if (status === 503) {
      failure = 0;
      await dialog.getByRole('button', { name: 'Réessayer' }).click();
      await expect(dialog).toContainText(email.subject);
    } else {
      await expect(
        dialog.locator('[data-og7="pilot-details-reload"]')
      ).toHaveCount(0);
    }
    expect(f.commands).toEqual([]);
  });
}

test('a closed email request cannot overwrite a reopened preview, and a missing email is explicit', async ({
  page
}) => {
  const f = await emailDetailFixtures(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  let missing = false;
  const email = {
    subject: 'Aperçu courant',
    recipient: 'current@example.invalid',
    text: 'Contenu synthétique courant'
  };
  await page.route('**/api/admin/pilotage?*', async (route) => {
    if (!new URL(route.request().url()).searchParams.has('id'))
      return route.fallback();
    if (++reads === 1) {
      await gate;
      return route.fulfill({ status: 503, json: {} });
    }
    await route.fulfill({
      json: { ...f.state, decisions: missing ? [] : [{ ...f.decision, email }] }
    });
  });
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-details"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('status')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('[data-og7="pilot-details"]').click();
  await expect(dialog).toContainText(email.subject);
  const previousResponse = page.waitForResponse(
    (r) => r.url().includes('/api/admin/pilotage?id=') && r.status() === 503
  );
  release();
  await previousResponse;
  await expect(dialog).toContainText(email.subject);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape');
  missing = true;
  await page.locator('[data-og7="pilot-details"]').click();
  await expect(dialog.getByRole('alert')).toContainText(
    'n’est plus disponible'
  );
  await expect(dialog).not.toContainText(email.subject);
  await expect(
    dialog.locator('[data-og7="pilot-details-footer"] a')
  ).toBeInViewport();
  expect(f.commands).toEqual([]);
});

test('detail media failures have a readable fallback and never approve the dossier', async ({
  page
}) => {
  const f = await fixtures(page);
  await page.route('**/api/admin/**/media/content/**', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-details"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('status')).toContainText('Aperçu indisponible');
  await expect(dialog.locator('img')).toHaveCount(0);
  expect(f.commands).toEqual([]);
});

test('sponsor details remain consultative for a reader and explain the private preview', async ({
  page
}) => {
  const f = await fixtures(page, 1);
  const original = f.state.decisions[0]!;
  f.state.writable = false;
  f.state.domains.publications = 0;
  f.state.domains.sponsors = 1;
  f.state.decisions = [
    {
      ...original,
      id: 'sponsor:' + original.targetId,
      domain: 'sponsors',
      kind: 'sponsor_review_pending',
      title: 'Atelier de test',
      publication: undefined,
      sponsor: {
        id: original.targetId,
        name: 'Atelier de test',
        status: 'pending_review',
        presentationId: null,
        presentationApproved: false
      },
      facts: [],
      actions: [{ id: 'sponsor.approve', blocked: 'READ_ONLY' }]
    }
  ];
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-details"]').click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Atelier de test' })
  ).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText(
    'Aucun visuel associé'
  );
  await expect(dialog).toContainText(
    'Visuel présenté pour la revue du dossier.'
  );
  await expect(dialog).toContainText('la fiche reste privée');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-og7="pilot-accept"]')).toBeDisabled();
  expect(f.commands).toEqual([]);
});

test('project details show the public description and expected outcome once', async ({
  page
}) => {
  const f = await fixtures(page, 1);
  const original = f.state.decisions[0]!;
  const outcome = 'Résultat public synthétique';
  f.state.decisions = [
    {
      ...original,
      id: 'project:' + original.targetId,
      domain: 'projects',
      kind: 'project_review',
      title: 'Projet de test',
      publication: undefined,
      facts: [{ label: 'outcome', value: outcome }],
      actions: [{ id: 'project.publish', blocked: null }],
      project: {
        id: original.targetId,
        project_name: 'Projet de test',
        public_description: 'Description publique à examiner.',
        expected_outcome: outcome,
        progress_status: 'planned',
        proof_url: null,
        proof_source: null,
        proof_published_at: null,
        amount_allocated: 10000,
        currency: 'CAD',
        status: 'draft',
        published_at: null,
        created_at: '2026-09-01T12:00:00Z',
        updated_at: '2026-09-01T12:00:00Z'
      }
    }
  ];
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-details"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Description publique à examiner.');
  await expect(dialog.getByText(outcome, { exact: true })).toHaveCount(1);
  await expect(
    dialog.getByRole('complementary', { name: 'Si vous acceptez' })
  ).toBeVisible();
  expect(f.commands).toEqual([]);
});

test('overview counts confirmed decisions and opened details for this visit only', async ({
  page
}) => {
  const { commands, hold } = await fixtures(page);
  await page.goto('/admin/fundraiser/pilotage');
  const pending = overviewCount(page, 'À examiner');
  const done = overviewCount(page, 'décisions traitées');
  const details = overviewCount(page, 'dossiers ouverts');
  await expect(pending).toHaveText('4');
  await expect(done).toHaveText('0');
  await expect(details).toHaveText('0');
  await page.locator('[data-og7="pilot-details"]').click();
  await expect(details).toHaveText('1');
  await page.keyboard.press('Escape');
  await page.locator('[data-og7="pilot-accept"]').click();
  await expect(page.locator('[data-og7="pilot-panel-confirm"]')).toBeVisible();
  await expect(done).toHaveText('0');
  await page.keyboard.press('Escape');
  expect(commands).toHaveLength(0);
  await expect(pending).toHaveText('4');
  await page.locator('[data-og7="pilot-accept"]').click();
  const release = hold();
  try {
    await page.locator('[data-og7="pilot-confirm"]').click();
    await expect.poll(() => commands.length).toBe(1);
    await expect(page.locator('[data-og7="pilot-confirm"]')).toBeDisabled();
    await expect(done).toHaveText('0');
    await expect(pending).toHaveText('4');
  } finally {
    release();
  }
  await expect(done).toHaveText('1');
  await expect(pending).toHaveText('3');
  expect(commands).toHaveLength(1);
  expect(commands[0]).toEqual({
    requestId: expect.any(String),
    action: 'publication.approve',
    targetId: '11111111-1111-4111-8111-000000000001',
    version: '1',
    confirmation: '11111111-1111-4111-8111-000000000001',
    payload: { approveSponsors: [] }
  });
  await page.reload();
  await expect(pending).toHaveText('3');
  await expect(done).toHaveText('0');
  await expect(details).toHaveText('0');
  expect(commands).toHaveLength(1);
});

for (const status of ['failed', 'uncertain'] as const) {
  test(`overview never counts a ${status} receipt as a processed decision`, async ({
    page
  }) => {
    const f = await fixtures(page);
    f.result(status);
    await page.goto('/admin/fundraiser/pilotage');
    await page.locator('[data-og7="pilot-accept"]').click();
    const response = page.waitForResponse('**/api/admin/pilotage/command');
    await page.locator('[data-og7="pilot-confirm"]').click();
    expect(await (await response).json()).toMatchObject({ status });
    await expect(
      page.locator('[data-og7="pilot-panel-confirm"]')
    ).not.toBeVisible();
    if (status === 'uncertain')
      await expect(
        page.getByRole('button', { name: 'Examiner cet incident' })
      ).toBeVisible();
    else {
      await expect(page.locator('[data-og7="pilot-accept"]')).toBeEnabled();
      await expect(page.getByRole('alert')).toBeVisible();
    }
    await expect(page.locator('[data-og7="pilot-receipt"]')).not.toBeVisible();
    await expect(overviewCount(page, 'décisions traitées')).toHaveText('0');
    await expect(overviewCount(page, 'À examiner')).toHaveText('4');
    expect(f.commands).toHaveLength(1);
  });
}

test('empty overview and unavailable actions remain clear in French and English', async ({
  page
}) => {
  const { commands } = await fixtures(page, 0);
  await page.goto('/admin/fundraiser/pilotage');
  await expect(overviewCount(page, 'À examiner')).toHaveText('0');
  await expect(overviewCount(page, 'décisions traitées')).toHaveText('0');
  await expect(overviewCount(page, 'dossiers ouverts')).toHaveText('0');
  await page.evaluate(() => localStorage.setItem('openg7.language', 'en'));
  await page.reload();
  await expect(overviewCount(page, 'To review')).toHaveText('0');
  await expect(overviewCount(page, 'decisions processed')).toHaveText('0');
  await expect(overviewCount(page, 'details opened')).toHaveText('0');
  await expect(page.locator('[data-og7="pilot-decision"]')).toHaveCount(0);
  await page.locator('[data-og7="pilot-focus"]').click();
  await expect(page.locator('[data-og7="pilot-show-queue"]')).toHaveCount(0);
  for (const action of ['accept', 'reject', 'edit', 'details'])
    await expect(page.locator(`[data-og7="pilot-${action}"]`)).toBeDisabled();
  expect(commands).toEqual([]);
});

for (const width of [390, 1512]) {
  test(`actions stay reachable while scrolling and preserve keyboard confirmation at ${width}px`, async ({
    page
  }) => {
    const { commands, state } = await fixtures(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/admin/fundraiser/pilotage');
    const card = page.locator('[data-og7="pilot-decision"]');
    await expect(card).toHaveAttribute('data-og7-id', state.decisions[0]!.id);
    for (const progress of [0, 0.5, 1]) {
      await page
        .locator('[data-og7="pilot-scroll"]')
        .evaluate((element, fraction) => {
          element.scrollTop =
            (element.scrollHeight - element.clientHeight) * fraction;
        }, progress);
      await page.evaluate(
        (fraction) =>
          window.scrollTo({
            top:
              (document.documentElement.scrollHeight - innerHeight) * fraction,
            behavior: 'instant'
          }),
        progress
      );
      for (const action of ['accept', 'reject', 'edit', 'details']) {
        const button = page.locator(`[data-og7="pilot-${action}"]`);
        await expect(button).toBeInViewport({ ratio: 1 });
        // Visibility alone does not detect another sticky surface covering it.
        await expect
          .poll(() =>
            button.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return element.contains(
                document.elementFromPoint(
                  rect.x + rect.width / 2,
                  rect.y + rect.height / 2
                )
              );
            })
          )
          .toBe(true);
      }
    }
    const accept = page.locator('[data-og7="pilot-accept"]');
    await accept.focus();
    for (const action of ['reject', 'edit', 'details']) {
      await page.keyboard.press('Tab');
      await expect(page.locator(`[data-og7="pilot-${action}"]`)).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await expect(
      page.locator('[data-og7="pilot-panel-details"]')
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-og7="pilot-details"]')).toBeFocused();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+Tab');
    await expect(accept).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.locator('[data-og7="pilot-panel-confirm"]')
    ).toContainText(state.decisions[0]!.title);
    expect(commands).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(accept).toBeFocused();
    await expect(card).toHaveAttribute('data-og7-id', state.decisions[0]!.id);
  });
}

test('reduced motion keeps the mobile overview, preview and actions accessible', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtures(page);
  await page.goto('/admin/fundraiser/pilotage');
  const pilotage = page.locator('[data-og7="pilotage"]');
  await expect(page.locator('[data-og7="pilot-decision"] img')).toBeVisible();
  expect(
    await pilotage.evaluate(
      (element) =>
        element
          .getAnimations({ subtree: true })
          .filter(
            (animation) =>
              animation.playState === 'running' &&
              Number(animation.effect?.getComputedTiming().activeDuration) > 1
          ).length
    )
  ).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  const results = await new AxeBuilder({ page })
    .include('[data-og7="pilotage"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.locator('[data-og7="pilot-details"]').click();
  await expect(page.locator('[data-og7="pilot-panel-details"]')).toBeVisible();
});

test('guide explains real targets, resumes after reload and remembers completion without commands', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.setViewportSize({ width: 1512, height: 930 });
  await page.goto('/admin/fundraiser/pilotage');
  const tour = guide(page);
  await expect(tour).not.toBeVisible();
  await guideLaunch(page).click();
  await expect(
    tour.getByRole('button', { name: 'Précédent', exact: true })
  ).toBeDisabled();
  await expect(tour.locator('[data-og7="guide-highlight"]')).toHaveAttribute(
    'data-og7-id',
    'pilot-automation'
  );
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'automation'
  );
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour.locator('[data-og7="guide-highlight"]')).toHaveAttribute(
    'data-og7-id',
    'pilot-decision'
  );
  await tour.getByRole('button', { name: 'Précédent', exact: true }).click();
  await tour.getByRole('button', { name: 'Quitter le guide' }).click();
  await expect(guideLaunch(page)).toBeFocused();
  await expect(guideLaunch(page)).toHaveText(/Reprendre le guide/);
  await page.reload();
  await expect(tour).not.toBeVisible();
  await guideLaunch(page).click();
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'domains'
  );
  for (let i = 0; i < 8; i++)
    await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'J’ai compris' }).click();
  await expect(tour).not.toBeVisible();
  await page.reload();
  await expect(guideLaunch(page)).toHaveText(/Revoir le guide/);
  await guideLaunch(page).click();
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'automation'
  );
  expect(commands).toHaveLength(0);
});

test('guide owns controller shortcuts, requires release and traps keyboard focus', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.goto('/admin/fundraiser/pilotage');
  await guideLaunch(page).click();
  const tour = guide(page);
  await buttons(page);
  await buttons(page, [0]);
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'domains'
  );
  await page.waitForTimeout(600);
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'domains'
  );
  await tap(page, 2);
  await tap(page, 3);
  await page.keyboard.press('c');
  await expect(page.locator('[data-og7="admin-drawer"][open]')).toHaveCount(0);
  await tap(page, 5);
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'decision'
  );
  await tap(page, 4);
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'domains'
  );
  await page.keyboard.press('Tab');
  await expect(
    tour.getByRole('button', { name: 'Quitter le guide' })
  ).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    tour.getByRole('button', { name: 'Suivant', exact: true })
  ).toBeFocused();
  await tap(page, 1);
  await expect(tour).not.toBeVisible();
  await expect(guideLaunch(page)).toBeFocused();
  await expect(
    page.locator('[data-og7="pilot-panel-confirm"]')
  ).not.toBeVisible();
  expect(commands).toHaveLength(0);
});

test('weekly guide opens each workspace, preserves unfinished edits and resumes inside its drawer', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  await f.open();
  const programme = page.locator('[data-og7="editorial-programme"]');
  await programme
    .getByRole('button', { name: 'Variante de texte', exact: true })
    .click();
  await programme
    .locator('[data-og7="programme-instruction"]')
    .fill('Mon intention en cours');
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/api/'))
      mutations.push(request.url());
  });
  await guideLaunch(page, 'programme').click();
  const tour = guide(page, 'programme');
  await expect(tour.locator('[data-og7="guide-highlight"]')).toHaveAttribute(
    'data-og7-id',
    'programme-brief'
  );
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour.locator('[data-og7="guide-highlight"]')).toHaveAttribute(
    'data-og7-id',
    'programme-compose'
  );
  await page.keyboard.press('Escape');
  await expect(tour).not.toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Ma semaine', exact: true })
  ).toBeVisible();
  await expect(
    programme.locator('[data-og7="programme-instruction"]')
  ).toHaveValue('Mon intention en cours');
  await expect(guideLaunch(page, 'programme')).toBeFocused();
  await page.keyboard.press('Escape');
  await f.open();
  await expect(guideLaunch(page, 'programme')).toHaveText(/Reprendre le guide/);
  await guideLaunch(page, 'programme').click();
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'calendar'
  );
  for (const id of ['rehearsal', 'editorial', 'memory', 'incidents']) {
    await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
    await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
      'data-og7-id',
      id
    );
    await expect(tour.locator('[data-og7="guide-highlight"]')).toBeVisible();
  }
  await tour.getByRole('button', { name: 'J’ai compris' }).click();
  await expect(programme).toBeVisible();
  expect(mutations).toEqual([]);
  expect(f.commands).toEqual([]);
});

test('guide is translated, accessible and stays in the viewport on mobile and resize', async ({
  page
}) => {
  await fixtures(page);
  await page.addInitScript(() => localStorage.setItem('openg7.language', 'en'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/fundraiser/pilotage');
  await guideLaunch(page).click();
  const tour = guide(page);
  await expect(
    tour.getByRole('heading', { name: 'Check what the machine is preparing' })
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include('[data-og7="admin-guide"][open]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1512, height: 930 }
  ]) {
    await page.setViewportSize(size);
    const card = tour.locator('[data-og7="guide-card"]');
    await expect(async () => {
      const box = (await card.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    }).toPass();
    await tour.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(tour.locator('[data-og7="guide-highlight"]')).toBeVisible();
  }
  await page.screenshot({ path: 'test-results/guide-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(async () => {
    const target = (await page
      .locator('[data-og7="pilot-summary"]')
      .boundingBox())!;
    const ring = (await tour
      .locator('[data-og7="guide-highlight"]')
      .boundingBox())!;
    expect(Math.abs(ring.y - Math.max(6, target.y - 5))).toBeLessThan(2);
    expect(target.y).toBeGreaterThanOrEqual(0);
    expect(target.y).toBeLessThan(400);
  }).toPass();
  await page.screenshot({ path: 'test-results/guide-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(guideLaunch(page)).toBeFocused();
});

test('guide handles empty readonly state, unavailable storage and stale saved step', async ({
  page
}) => {
  const f = await fixtures(page, 0);
  f.state.writable = false;
  await page.addInitScript(() => {
    localStorage.setItem(
      'og7-admin-guide:v1:token:pilotage',
      JSON.stringify({ step: 'removed-step', completed: false })
    );
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('og7-admin-guide:'))
        throw new DOMException('Storage disabled', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.goto('/admin/fundraiser/pilotage');
  await expect(guideLaunch(page)).toHaveText(/Guide pas à pas/);
  await guideLaunch(page).click();
  const tour = guide(page);
  await expect(tour).toContainText(
    'Le navigateur ne permet pas de sauvegarder'
  );
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(tour).toContainText('Cet élément n’est pas affiché');
  await expect(tour.locator('[data-og7="guide-highlight"]')).not.toBeVisible();
  await page.keyboard.press('Escape');
  await guideLaunch(page).click();
  await expect(tour.locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'decision'
  );
  expect(f.commands).toEqual([]);
});

test('guide progress is isolated between named administrator accounts', async ({
  page
}) => {
  const f = await fixtures(page);
  f.state.writable = false;
  await page.addInitScript(() =>
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.cookie'
    )
  );
  let account = 'guide-reader-a';
  await page.route('**/admin/auth/current', (route) =>
    route.fulfill({
      json: {
        id: account,
        displayName: 'Guide reader',
        role: 'reader',
        expiresAt: '2099-01-01T00:00:00Z'
      }
    })
  );
  await page.goto('/admin/fundraiser/pilotage');
  await guideLaunch(page).click();
  await guide(page)
    .getByRole('button', { name: 'Suivant', exact: true })
    .click();
  await page.keyboard.press('Escape');
  account = 'guide-reader-b';
  await page.reload();
  await expect(guideLaunch(page)).toHaveText(/Guide pas à pas/);
  await guideLaunch(page).click();
  await expect(guide(page).locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'automation'
  );
  await page.keyboard.press('Escape');
  account = 'guide-reader-a';
  await page.reload();
  await expect(guideLaunch(page)).toHaveText(/Reprendre le guide/);
  await guideLaunch(page).click();
  await expect(guide(page).locator('[data-og7="guide-card"]')).toHaveAttribute(
    'data-og7-id',
    'domains'
  );
  expect(f.commands).toEqual([]);
});

async function fixtures(page: Page, count = 4) {
  const commands: PilotCommand[] = [];
  const state: PilotState = {
    generatedAt: '2026-09-21T12:00:00Z',
    coverage: 'complete',
    missingSources: [],
    total: count,
    page: 1,
    pageSize: 30,
    domains: {
      publications: count,
      sponsors: 0,
      email: 0,
      invoices: 0,
      contributions: 0,
      projects: 0,
      operations: 0
    },
    feeds: [],
    workerEnabled: true,
    writable: true,
    decisions: []
  };
  state.decisions = Array.from({ length: count }, (_, i): PilotDecision => {
    const id = `11111111-1111-4111-8111-${String(i + 1).padStart(12, '0')}`;
    return {
      id: 'publication:' + id,
      domain: 'publications',
      kind: 'publication_draft',
      targetId: id,
      version: '1',
      title: i
        ? 'Un avenir commun — projet ' + (i + 1)
        : 'Ensemble, bâtissons les projets de demain.',
      severity: 'this_week',
      dueAt: '2030-09-22T13:00:00Z',
      detailsUrl: '/admin/fundraiser/publications/automation?deliveryId=' + id,
      facts: [{ label: 'destination', value: 'openg7:facebook' }],
      actions: [
        { id: 'publication.approve', blocked: null },
        { id: 'publication.reject', blocked: null },
        { id: 'publication.edit', blocked: null }
      ],
      publication: {
        id,
        feedId: 'openg7:facebook',
        kind: 'news',
        batchId: null,
        message: i
          ? 'Le projet ' + (i + 1) + ' vous remercie.'
          : 'Ensemble, bâtissons les projets de demain.\nMerci aux entreprises qui font avancer nos communautés.',
        scheduledAt: '2030-09-22T13:00:00Z',
        mediaId: '22222222-2222-4222-8222-222222222222',
        mediaUrl: null,
        mediaAlt: 'Communautés connectées au Canada',
        accountId: 'fixture-page',
        mode: 'mock',
        autoManaged: true,
        sponsors: [],
        version: 1,
        status: 'draft',
        attempts: 0,
        nextAttemptAt: null,
        externalPostId: null,
        externalPostUrl: null,
        errorCode: null,
        approvedAt: null,
        publishedAt: null
      }
    };
  });
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.ui-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
    const pad = {
      id: 'Test standard controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })),
      axes: [0, 0, 0, 0]
    };
    (window as unknown as { fixturePad: typeof pad }).fixturePad = pad;
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
  });
  const photo = await readFile(
    'apps/funding-web/src/assets/openg7-social-communautes-connectees-canada-960.webp'
  );
  const results = new Map<string, object>();
  let fail = false;
  let commandGate: Promise<void> | undefined;
  let status: 'completed' | 'failed' | 'uncertain' = 'completed';
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/media/content/'))
      return route.fulfill({ contentType: 'image/webp', body: photo });
    if (url.pathname.endsWith('/pilotage/receipt')) {
      if (route.request().method() === 'POST') {
        const c = route.request().postDataJSON() as { requestId: string };
        const reviewed = {
          ...results.get(c.requestId),
          reviewedAt: new Date().toISOString()
        };
        results.set(c.requestId, reviewed);
        return route.fulfill({ json: reviewed });
      }
      return route.fulfill({
        json: results.get(url.searchParams.get('id')!) ?? {}
      });
    }
    if (url.pathname.endsWith('/pilotage/command')) {
      const c = route.request().postDataJSON() as PilotCommand;
      commands.push(c);
      await commandGate;
      const r = {
        requestId: c.requestId,
        action: c.action,
        targetId: c.targetId,
        status,
        code:
          status !== 'completed'
            ? 'RESULT_UNKNOWN'
            : c.action === 'publication.approve'
              ? 'SCHEDULED'
              : c.action === 'publication.reject'
                ? 'REJECTED'
                : 'SAVED'
      };
      results.set(c.requestId, r);
      if (status === 'completed' && c.action === 'publication.edit') {
        const d = state.decisions.find((d) => d.targetId === c.targetId)!;
        d.version = String(Number(d.version) + 1);
        d.title = c.payload!.message!;
        d.publication!.message = c.payload!.message!;
        d.publication!.scheduledAt = c.payload!.scheduledAt!;
      } else if (status === 'completed')
        state.decisions = state.decisions.filter(
          (d) => d.targetId !== c.targetId
        );
      state.total = state.decisions.length;
      state.domains.publications = state.total;
      if (fail) return route.abort('failed');
      return route.fulfill({ json: r });
    }
    if (url.pathname.endsWith('/pilotage'))
      return route.fulfill({
        json: {
          ...state,
          decisions: state.decisions.filter(
            (d) =>
              (!url.searchParams.get('id') ||
                d.id === url.searchParams.get('id')) &&
              (!url.searchParams.get('domain') ||
                d.domain === url.searchParams.get('domain'))
          )
        }
      });
    if (url.pathname.endsWith('/publication-automation'))
      return route.fulfill({
        json: {
          workerEnabled: true,
          workerVersion: 1,
          feeds: [],
          deliveries: state.decisions.map((d) => d.publication),
          summary: {
            awaitingApproval: state.total,
            scheduled: 0,
            exceptions: 0,
            publishedToday: 0
          }
        }
      });
    if (url.pathname.endsWith('/contributions')) {
      const response: AdminContributionsResponse = {
        data_source: 'database',
        summary: {
          total_count: 0,
          paid_count: 0,
          pending_count: 0,
          sponsorship_count: 0,
          public_display_count: 0,
          total_received: 0,
          total_refunded: 0,
          total_disputed: 0,
          currency: 'CAD'
        },
        contributions: [],
        last_updated_at: state.generatedAt
      };
      return route.fulfill({ json: response });
    }
    if (url.pathname.endsWith('/stripe-backfill'))
      return route.fulfill({ json: { run: null } });
    return route.fulfill({ status: 503, json: {} });
  });
  return {
    state,
    commands,
    hold: () => {
      let release!: () => void;
      commandGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    uncertain: () => {
      status = 'uncertain';
    },
    result: (value: typeof status) => {
      status = value;
    },
    fail: () => {
      fail = true;
    }
  };
}
async function buttons(page: Page, pressed: number[] = []): Promise<void> {
  await page.evaluate((indices) => {
    const pad = (
      window as unknown as {
        fixturePad: { buttons: { value: number; pressed: boolean }[] };
      }
    ).fixturePad;
    pad.buttons.forEach((b, i) => {
      b.value = indices.includes(i) ? 1 : 0;
      b.pressed = !!b.value;
    });
  }, pressed);
  await page.waitForTimeout(70);
}
async function tap(page: Page, button: number): Promise<void> {
  await buttons(page);
  await buttons(page, [button]);
  await buttons(page);
}

test('controller approval is contextual, requires release and processes twenty decisions without the portal', async ({
  page
}) => {
  const { commands } = await fixtures(page, 20);
  await page.goto('/admin/fundraiser/pilotage');
  await expect(page.locator('[data-og7="pilot-decision"]')).toBeVisible();
  await buttons(page);
  await buttons(page, [0]);
  await expect(page.locator('[data-og7="pilot-panel-confirm"]')).toBeVisible();
  await page.waitForTimeout(600);
  expect(commands).toHaveLength(0);
  await buttons(page);
  await buttons(page, [0]);
  await expect(page.locator('[data-og7="pilot-receipt"]')).toBeVisible();
  await page.waitForTimeout(400);
  expect(commands).toHaveLength(1);
  for (let i = 1; i < 20; i++) {
    await tap(page, 5);
    await tap(page, 0);
    await expect(
      page.locator('[data-og7="pilot-panel-confirm"]')
    ).toBeVisible();
    await tap(page, 0);
    await expect.poll(() => commands.length).toBe(i + 1);
    await expect(page.locator('[data-og7="pilot-receipt"]')).toBeVisible();
  }
  expect(new Set(commands.map((c) => c.targetId)).size).toBe(20);
  expect(new Set(commands.map((c) => c.requestId)).size).toBe(20);
  expect(
    commands.every(
      (c) => c.action === 'publication.approve' && c.confirmation === c.targetId
    )
  ).toBe(true);
  await expect(page).toHaveURL(/\/pilotage$/);
});
test('details, edit, rejection, calendar chord and return preserve decision context', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.goto('/admin/fundraiser/pilotage');
  const card = page.locator('[data-og7="pilot-decision"]');
  await expect(card).toBeVisible();
  const id = await card.getAttribute('data-og7-id');
  await tap(page, 3);
  await expect(page.locator('[data-og7="pilot-panel-details"]')).toBeVisible();
  await tap(page, 1);
  await expect(card).toHaveAttribute('data-og7-id', id!);
  await tap(page, 2);
  await page
    .locator('[data-og7="pilot-message"]')
    .fill('Texte révisé avant envoi.');
  await page.getByRole('button', { name: '+ 30 min', exact: true }).click();
  await page.locator('[data-og7="pilot-save"]').click();
  await expect(page.locator('[data-og7="pilot-receipt"]')).toBeVisible();
  expect(commands[0]!.payload?.message).toBe('Texte révisé avant envoi.');
  expect(commands[0]!.payload?.scheduledAt).toBe('2030-09-22T13:30:00.000Z');
  await page.getByRole('button', { name: /Relire le dossier/ }).click();
  await expect(card).toContainText('Texte révisé');
  await buttons(page);
  await buttons(page, [6, 3]);
  await expect(page.locator('[data-og7="pilot-panel-calendar"]')).toBeVisible();
  await buttons(page, [3]);
  await buttons(page);
  await tap(page, 1);
  await tap(page, 1);
  await expect(page.locator('[data-og7="pilot-panel-confirm"]')).toBeVisible();
  await tap(page, 0);
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1]!.action).toBe('publication.reject');
});
test('lost response recovers its receipt without replaying a command, including after reload', async ({
  page
}) => {
  const f = await fixtures(page);
  f.fail();
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-accept"]').click();
  await page.locator('[data-og7="pilot-confirm"]').click();
  await expect(
    page.getByRole('button', { name: 'Vérifier le résultat' })
  ).toBeVisible();
  await expect(page.locator('#admin-main')).toBeFocused();
  expect(f.commands).toHaveLength(1);
  await page.reload();
  await expect(page.locator('[data-og7="pilot-receipt"]')).toBeVisible();
  expect(f.commands).toHaveLength(1);
  await expect(overviewCount(page, 'décisions traitées')).toHaveText('1');
  await expect(overviewCount(page, 'À examiner')).toHaveText('3');
  await expect(page.locator('[data-og7="pilot-decision"]')).toBeVisible();
  await page.reload();
  await expect(overviewCount(page, 'décisions traitées')).toHaveText('0');
  expect(f.commands).toHaveLength(1);
});
test('stable snapshot blocks stale decisions; focus, accessibility and narrow screen remain usable', async ({
  page
}) => {
  const { state, commands } = await fixtures(page);
  await page.setViewportSize({ width: 1512, height: 930 });
  await page.clock.install();
  await page.goto('/admin/fundraiser/pilotage');
  await expect(page.locator('[data-og7="pilot-decision"] img')).toBeVisible();
  // Let the entrance animation finish before freezing the visual evidence.
  await page.clock.runFor(500);
  await page.screenshot({
    path: 'test-results/pilotage-desktop.png',
    fullPage: true
  });
  const results = await new AxeBuilder({ page })
    .include('[data-og7="pilotage"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.locator('[data-og7="pilot-details"]').click();
  await expect(page.locator('[data-og7="pilot-panel-details"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-og7="pilot-details"]')).toBeFocused();
  state.decisions[0]!.version = '2';
  state.decisions[0]!.title = 'Changed after review started';
  await page.clock.fastForward(31000);
  await expect(
    page.getByRole('button', { name: 'Relire le dossier' })
  ).toBeVisible();
  await expect(page.locator('[data-og7="pilot-decision"]')).not.toContainText(
    'Changed after review started'
  );
  await expect(page.locator('[data-og7="pilot-accept"]')).toBeDisabled();
  expect(commands).toHaveLength(0);
  await page.getByRole('button', { name: 'Relire le dossier' }).click();
  await expect(page.locator('[data-og7="pilot-decision"]')).toContainText(
    'Changed after review started'
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/pilotage-mobile.png',
    fullPage: true
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});

test('uncertain command is acknowledged after investigation without another mutation', async ({
  page
}) => {
  const f = await fixtures(page);
  f.uncertain();
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-accept"]').click();
  await page.locator('[data-og7="pilot-confirm"]').click();
  await page.getByRole('button', { name: 'Examiner cet incident' }).click();
  const save = page.getByRole('button', {
    name: 'Consigner mon constat et reprendre le pilotage'
  });
  await expect(save).toBeDisabled();
  await page
    .getByLabel('Constat après vérification du dossier et de l’audit')
    .fill(
      'Dossier et audit vérifiés, aucune publication externe supplémentaire.'
    );
  await save.click();
  await expect(
    page.getByRole('button', { name: 'Vérifier le résultat' })
  ).toHaveCount(0);
  expect(f.commands).toHaveLength(1);
  await tap(page, 5);
  await expect(page.locator('[data-og7="pilot-accept"]')).toBeEnabled();
});

for (const width of [390, 1512]) {
  test(`shared navigation and local pilotage filters stay distinct at ${width}px`, async ({
    page
  }) => {
    const { commands, state } = await fixtures(page);
    state.workerEnabled = false;
    const mutations: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/') && request.method() !== 'GET')
        mutations.push(request.url());
    });
    await page.setViewportSize({ width, height: 930 });
    await page.goto('/admin/fundraiser/pilotage');
    const navigation = page.getByRole('navigation', {
      name: 'Navigation admin du fonds'
    });
    const openMenu = async () => {
      if (width === 390)
        await page
          .getByRole('button', { name: 'Ouvrir le menu', exact: true })
          .click();
      await expect(navigation).toBeVisible();
    };
    await openMenu();
    const links = await navigation.getByRole('link').evaluateAll((items) =>
      items.map((item) => ({
        text: item.textContent,
        href: item.getAttribute('href')
      }))
    );
    await expect(
      navigation.getByRole('link', { name: 'Poste de pilotage' })
    ).toHaveAttribute('aria-current', 'page');
    await navigation
      .getByRole('link', { name: 'Tableau de bord', exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/fundraiser$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Centre de pilotage'
    );
    await openMenu();
    expect(
      await navigation.getByRole('link').evaluateAll((items) =>
        items.map((item) => ({
          text: item.textContent,
          href: item.getAttribute('href')
        }))
      )
    ).toEqual(links);
    await navigation.getByRole('link', { name: 'Poste de pilotage' }).click();
    await expect(page).toHaveURL(/\/pilotage$/);
    await expect(page.getByRole('main')).toHaveCount(1);
    const spaces = page.getByRole('group', { name: 'Espaces de pilotage' });
    const invoices = spaces.getByRole('button', { name: /^Factures/ });
    await invoices.focus();
    await page.keyboard.press('Enter');
    await expect(invoices).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-og7="pilot-decision"]')).toHaveCount(0);
    await expect(page).toHaveURL(/\/pilotage$/);
    await spaces.getByRole('button', { name: /^Publications/ }).click();
    await expect(page.locator('[data-og7="pilot-decision"]')).toBeVisible();
    await expect(page.locator('[data-og7="pilot-automation"]')).toContainText(
      'Activez le moteur dans les réglages.'
    );
    await page
      .getByRole('button', {
        name: 'Switch administration language to English'
      })
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Control desk'
    );
    await expect(
      page.getByRole('group', { name: 'Control areas' })
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    const shortcut = page.getByRole('link', { name: /Open settings/ });
    await expect(shortcut).toContainText(
      'Turn on automatic processing in settings.'
    );
    await shortcut.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/publications\/automation\?settings=feeds$/);
    await expect(
      page.locator('[data-og7="publication-feed-settings"]')
    ).toHaveAttribute('open', '');
    await page.goBack();
    state.workerEnabled = true;
    await page.reload();
    await expect(shortcut).toContainText('Automatic processing active');
    await shortcut.click();
    await expect(
      page.locator('[data-og7="publication-feed-settings"]')
    ).toHaveAttribute('open', '');
    expect(mutations).toEqual([]);
    expect(commands).toEqual([]);
  });
}

test('shared navigation and search suppress pilotage shortcuts until controller release', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.goto('/admin/fundraiser/pilotage');
  const decision = page.locator('[data-og7="pilot-decision"]');
  await expect(decision).toBeVisible();
  const navigation = page.getByRole('navigation', {
    name: 'Navigation admin du fonds'
  });
  await navigation
    .getByRole('link', { name: 'Contributions', exact: true })
    .focus();
  await page.keyboard.press('a');
  await tap(page, 0);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page).toHaveURL(/\/pilotage$/);
  await page.keyboard.press('Control+k');
  const search = page.locator('[data-og7="admin-search"]');
  await expect(search).toBeVisible();
  for (const button of [0, 1, 2, 3, 5, 9]) await tap(page, button);
  await expect(search).toBeVisible();
  await expect(
    page.locator('[data-og7="pilot-panel-confirm"]')
  ).not.toBeVisible();
  await buttons(page, [0]);
  await page.keyboard.press('Escape');
  await page.locator('#admin-main').focus();
  await page.waitForTimeout(350);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await buttons(page);
  await tap(page, 0);
  await expect(page.locator('[data-og7="pilot-panel-confirm"]')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(commands).toEqual([]);
});

test('settings validate remapping and unknown controller input remains inert', async ({
  page
}) => {
  const f = await fixtures(page);
  await page.goto('/admin/fundraiser/pilotage');
  await page
    .locator('[data-og7="pilotage"]')
    .getByRole('button', { name: 'Réglages de la manette' })
    .click();
  await page.getByLabel('Accepter / sélectionner').selectOption({ label: 'B' });
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('bouton distinct');
  await page
    .getByRole('button', { name: 'Rétablir le profil initial' })
    .click();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.evaluate(() => {
    (
      window as unknown as { fixturePad: { mapping: string } }
    ).fixturePad.mapping = '';
  });
  await buttons(page, [0]);
  await buttons(page);
  expect(f.commands).toHaveLength(0);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: /Calibration requise/ })
  ).toBeVisible();
});

async function programmeFixtures(page: Page) {
  const fixture = await fixtures(page, 3);
  const date = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(13, 0, 0, 0);
    return d.toISOString();
  };
  fixture.state.decisions.forEach((d, i) => {
    d.publication!.scheduledAt = date(i + 1);
    d.publication!.message =
      'Merci à Atelier ' +
      (i + 1) +
      '\n\nLe projet avance. Ensemble, nous avançons.\n\nCommandite rémunérée.';
  });
  const programme: ProgrammeState = {
    generatedAt: new Date().toISOString(),
    version: 'programme-v1',
    complete: true,
    writable: true,
    feeds: [
      {
        id: 'openg7:facebook',
        paused: true,
        autoPrepare: true,
        timezone: 'America/Toronto',
        weekdays: [1, 4],
        localTime: '09:00',
        capacity: 5,
        horizonDays: 14,
        mode: 'mock',
        accountId: 'fixture',
        configured: true,
        connection: 'ready',
        checkedAt: null,
        expiresAt: null
      }
    ],
    profiles: [
      {
        feedId: 'openg7:facebook',
        version: 1,
        preferences: [],
        observations: { neutral: 3 }
      }
    ],
    deliveries: fixture.state.decisions.map((d) => d.publication!),
    issues: [],
    briefing: { ready: 3, scheduled: 0, blocked: 0, coveredUntil: null }
  };
  await page.route('**/pilotage/programme', async (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill({
        json: {
          version: programme.version,
          plan: {
            moves: programme.deliveries.slice(0, 2).map((d, i) => ({
              id: d.id,
              version: d.version,
              scheduledAt: date(i + 5)
            })),
            warnings: [],
            emptySlots: []
          }
        }
      });
    return route.fulfill({ json: programme });
  });
  await page.route('**/pilotage/variant', async (route) => {
    const input = route.request().postDataJSON();
    const d = programme.deliveries.find((d) => d.id === input.id)!;
    if (!['neutral', 'Ton neutre'].includes(input.instruction))
      return route.fulfill({
        status: 400,
        json: { code: 'INTENT_NOT_SUPPORTED' }
      });
    return route.fulfill({
      json: {
        intent: 'neutral',
        before: d.message,
        after: d.message.replace('Merci à', 'Partenaire :'),
        deliveryId: d.id,
        version: d.version,
        feedId: d.feedId
      }
    });
  });
  await page.goto('/admin/fundraiser/pilotage');
  await expect(page.locator('[data-og7="pilot-decision"]')).toBeVisible();
  const open = async () => {
    await page.locator('[data-og7="open-programme"]').click();
    await expect(
      page.locator('[data-og7="editorial-programme"]')
    ).toBeVisible();
  };
  return { ...fixture, programme, open };
}

test('weekly briefing starts and resumes a five-minute session without mutating publications', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  await f.open();
  await expect(
    page.getByRole('heading', { name: 'Les décisions qui comptent maintenant' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'J’ai cinq minutes' }).click();
  await expect(page.getByText(/Session de cinq minutes/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Session de cinq minutes/)).toBeVisible();
  expect(f.commands).toHaveLength(0);
  await page.getByRole('button', { name: 'Terminer la session' }).click();
  await expect(page.getByText(/Session de cinq minutes/)).toHaveCount(0);
});

test('discarding a staged weekly programme also removes its pending confirmation', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  await f.open();
  await page
    .getByRole('button', { name: 'Composer la semaine', exact: true })
    .click();
  await page.getByRole('button', { name: 'Proposer une répartition' }).click();
  await page.getByRole('button', { name: 'Examiner les déplacements' }).click();
  await expect(
    page.locator('[data-og7="programme-confirmation"]')
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Écarter les déplacements proposés' })
    .click();
  await expect(page.locator('[data-og7="programme-confirmation"]')).toHaveCount(
    0
  );
  await expect(page.locator('[data-og7="programme-moves"] li')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Examiner les déplacements' })
  ).toBeDisabled();
  expect(f.commands).toHaveLength(0);
});

test('a failed programme replacement clears the old plan and failed refresh clears private proposals', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  await f.open();
  await page
    .getByRole('button', { name: 'Composer la semaine', exact: true })
    .click();
  await page.getByRole('button', { name: 'Proposer une répartition' }).click();
  await expect(page.locator('[data-og7="programme-moves"] li')).toHaveCount(2);
  await page.route('**/pilotage/programme', (route) =>
    route.fulfill({ status: 503, json: { code: 'PROGRAMME_UNAVAILABLE' } })
  );
  await page.getByRole('button', { name: 'Proposer une répartition' }).click();
  const programme = page.locator('[data-og7="editorial-programme"]');
  await expect(programme.getByRole('alert')).toContainText(
    'Le programme est indisponible'
  );
  await expect(page.locator('[data-og7="programme-moves"] li')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Examiner les déplacements' })
  ).toBeDisabled();
  await programme
    .getByRole('button', { name: 'Actualiser', exact: true })
    .click();
  await expect(programme.getByRole('alert')).toContainText(
    'Le programme est indisponible'
  );
  await expect(page.locator('[data-og7="programme-week"]')).toHaveCount(0);
  expect(f.commands).toHaveLength(0);
});

test('weekly calendar and rehearsal show proposed changes before a controller confirmation', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  await f.open();
  await page
    .getByRole('button', { name: 'Composer la semaine', exact: true })
    .click();
  await buttons(page);
  await page.evaluate(() => {
    document.querySelector('dialog[open]')!.scrollTop = 0;
    (
      window as unknown as { fixturePad: { axes: number[] } }
    ).fixturePad.axes[3] = 0.9;
  });
  await expect
    .poll(() => page.locator('dialog[open]').evaluate((d) => d.scrollTop))
    .toBeGreaterThan(0);
  await page.evaluate(() => {
    (
      window as unknown as { fixturePad: { axes: number[] } }
    ).fixturePad.axes[3] = 0;
  });
  await page.getByRole('button', { name: 'Proposer une répartition' }).click();
  await expect(page.locator('[data-og7="programme-moves"] li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Voir le déroulement' }).click();
  await expect(page.locator('[data-og7="programme-rehearsal"]')).toContainText(
    'Merci à Atelier'
  );
  await page
    .getByRole('button', { name: 'Publication suivante', exact: true })
    .click();
  expect(f.commands).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Composer la semaine', exact: true })
    .click();
  await page.getByRole('button', { name: 'Examiner les déplacements' }).click();
  await expect(
    page.locator('[data-og7="programme-confirmation"]')
  ).toContainText('nouvelle approbation');
  await page
    .getByRole('button', { name: 'Confirmer l’enregistrement' })
    .focus();
  await buttons(page);
  await buttons(page, [0]);
  await page.waitForTimeout(500);
  expect(f.commands).toHaveLength(1);
  expect(f.commands[0]!.action).toBe('programme.apply');
  expect(f.commands[0]!.payload!.moves).toHaveLength(2);
  await buttons(page);
});

test('weekly variants require review and recover a lost command response without a replay', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  await f.open();
  await page
    .getByRole('button', { name: 'Variante de texte', exact: true })
    .click();
  await page.getByRole('button', { name: 'Ton neutre', exact: true }).click();
  await expect(page.locator('[data-og7="programme-comparison"]')).toContainText(
    'Partenaire : Atelier'
  );
  expect(f.commands).toHaveLength(0);
  await page.getByRole('button', { name: 'Examiner cette variante' }).click();
  f.fail();
  await page
    .getByRole('button', { name: 'Confirmer l’enregistrement' })
    .click();
  await expect.poll(() => f.commands.length).toBe(1);
  await page.reload();
  await expect(page.locator('[data-og7="pilot-receipt"]')).toBeVisible();
  expect(f.commands).toHaveLength(1);
  expect(f.commands[0]!.payload!.editorialIntent).toBe('neutral');
});

test('changing an editorial instruction discards the previous comparison and confirmation', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  await f.open();
  const programme = page.locator('[data-og7="editorial-programme"]');
  await programme
    .getByRole('button', { name: 'Variante de texte', exact: true })
    .click();
  await programme
    .getByRole('textbox', { name: 'Mon intention' })
    .fill('Ton neutre');
  await programme
    .getByRole('button', { name: 'Préparer la variante', exact: true })
    .click();
  await programme
    .getByRole('button', { name: 'Examiner cette variante' })
    .click();
  await expect(
    programme.locator('[data-og7="programme-confirmation"]')
  ).toBeVisible();
  await programme
    .getByRole('textbox', { name: 'Mon intention' })
    .fill('Raccourcir');
  await expect(
    programme.locator('[data-og7="programme-confirmation"]')
  ).toHaveCount(0);
  await expect(
    programme.locator('[data-og7="programme-comparison"]')
  ).toHaveCount(0);
  await expect(
    programme.getByRole('button', { name: 'Préparer la variante', exact: true })
  ).toBeEnabled();
  expect(f.commands).toHaveLength(0);
});

test('weekly memory and incident solutions remain explicit reviewed commands', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  const d = f.programme.deliveries[2]!;
  f.programme.issues = [
    {
      deliveryId: d.id,
      codes: ['CONSENT_WITHDRAWN'],
      excludedSponsorIds: ['withdrawn'],
      repair: {
        version: 'repair-v1',
        message: 'Merci au commanditaire admissible.\n\nCommandite rémunérée.',
        scheduledAt: d.scheduledAt,
        sponsors: [{ id: 'retained', name: 'Atelier admissible' }],
        removed: ['withdrawn'],
        added: []
      }
    }
  ];
  await f.open();
  await page.getByRole('button', { name: 'Préférences', exact: true }).click();
  await expect(
    page.getByText('Cette correction revient régulièrement.', { exact: false })
  ).toBeVisible();
  await page.getByRole('checkbox', { name: 'Ton neutre' }).check();
  expect(f.commands).toHaveLength(0);
  await page.getByRole('button', { name: 'Examiner mes préférences' }).click();
  await page
    .getByRole('button', { name: 'Confirmer l’enregistrement' })
    .click();
  await expect.poll(() => f.commands.length).toBe(1);
  expect(f.commands[0]!.action).toBe('editorial.preferences');
  await f.open();
  await page
    .getByRole('button', { name: 'Résoudre les incidents', exact: true })
    .click();
  await expect(
    page.getByText('Le consentement de publication a été retiré.')
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Examiner cette recomposition' })
    .click();
  await page
    .getByRole('button', { name: 'Confirmer l’enregistrement' })
    .click();
  await expect.poll(() => f.commands.length).toBe(2);
  expect(f.commands[1]!.action).toBe('publication.repair');
});

test('weekly views expose errors, readonly coverage and accessible responsive calendar', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  await f.open();
  await page
    .getByRole('button', { name: 'Variante de texte', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Mon intention' })
    .fill('Publier sans revue');
  await page
    .getByRole('button', { name: 'Préparer la variante', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('quatre transformations');
  await page
    .getByRole('button', { name: 'Composer la semaine', exact: true })
    .click();
  await page.screenshot({
    path: 'test-results/programme-desktop.png',
    fullPage: true
  });
  const axe = await new AxeBuilder({ page })
    .include('[data-og7="editorial-programme"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/programme-mobile.png',
    fullPage: true
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  f.programme.complete = false;
  f.programme.writable = false;
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(
    page.getByText('La projection est incomplète.', { exact: false })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Proposer une répartition' })
  ).toBeDisabled();
  expect(f.commands).toHaveLength(0);
});
