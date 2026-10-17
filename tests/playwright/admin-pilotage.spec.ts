import { readFile } from 'node:fs/promises';

import type { Locator, Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  AdminContributionsResponse,
  PilotCommand,
  PilotDecision,
  PilotState,
  ProgrammeState
} from '@openg7/funding-core';

import { defaultControllerProfile } from '../../apps/funding-web/src/app/features/funding/components/admin-pilotage/controller-input.js';

import { test, expect } from './support/test.js';
import { moderationFixture, completeModeration } from './support/moderation.js';
import {
  blockAdminReviewWrites,
  captureAdminDesign,
  expectAdminPageFits,
  prepareAdminDesignReview
} from './support/admin-design-review.js';

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

const deckActions = [
  'pilot-home',
  'pilot-previous',
  'pilot-next',
  'pilot-open-record',
  'pilot-deck-queue',
  'pilot-diagnostics'
] as const;

async function expectControllerControlUncovered(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 1 });
  await expect
    .poll(() =>
      control.evaluate((element) => {
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

const adminPalettes = {
  night: { background: 'rgb(11, 23, 39)', sidebar: 'rgb(13, 27, 44)' },
  mineral: { background: 'rgb(245, 247, 251)', sidebar: 'rgb(247, 249, 252)' },
  graphite: { background: 'rgb(25, 27, 31)', sidebar: 'rgb(30, 33, 38)' }
};

test('moderation fixtures reject undeclared subjects and unsupported methods without granting a decision', async ({
  page
}) => {
  const subject = {
    type: 'sponsorship' as const,
    id: '10000000-0000-4000-8000-000000000001'
  };
  await page.route('**/api/admin/moderation/**', async (route) => {
    expect(await moderationFixture(route, [subject])).toBe(true);
  });
  await page.goto('/admin/login');
  const responses = await page.evaluate(async (known) => {
    const query = new URLSearchParams({
      subjectType: known.type,
      subjectId: known.id
    });
    const content = '/api/admin/moderation/content?' + query;
    const requests = [
      fetch(content),
      fetch(content.replace(known.id, '10000000-0000-4000-8000-000000000002')),
      fetch(content.replace('subjectType=sponsorship', 'subjectType=media')),
      fetch(content, { method: 'DELETE' }),
      fetch(content, { method: 'HEAD' }),
      fetch('/api/admin/moderation/unexpected?' + query),
      fetch('/api/admin/moderation/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{'
      }),
      fetch('/api/admin/moderation/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: { ...known, type: 'media' },
          decision: { level: 'N0' }
        })
      })
    ];
    return Promise.all(requests.map(async (request) => (await request).status));
  }, subject);
  expect(responses).toEqual([200, 404, 404, 405, 405, 405, 400, 404]);
});

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

for (const theme of ['night', 'mineral', 'graphite'] as const) {
  for (const language of ['fr-CA', 'en']) {
    for (const width of [390, 1536]) {
      test(`appearance ${theme} stays readable in ${language} at ${width}px`, async ({
        page
      }, testInfo) => {
        const { state, commands } = await fixtures(page);
        await page.setViewportSize({
          width,
          height: width === 1536 ? 760 : 900
        });
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
        await expect(page.getByRole('dialog')).toHaveCSS('position', 'fixed');
        await expect(page.getByRole('dialog')).toHaveCSS(
          'background-color',
          adminPalettes[theme].background
        );
        const themeCard = page
          .locator(`[data-og7="pilot-theme-${theme}"]`)
          .locator('..')
          .locator('..');
        for (const choice of [
          themeCard,
          page.locator('[data-og7="pilot-density-compact"]').locator('..')
        ]) {
          const bounds = (await choice.boundingBox())!;
          expect(bounds.height).toBeGreaterThanOrEqual(44);
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        }
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

for (const language of ['fr-CA', 'en']) {
  for (const width of [390, 1536]) {
    test(`Pilotage composition keeps decisions, following queue and commands accessible in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await prepareAdminDesignReview(page);
      const { state, commands } = await fixtures(page);
      const writes = await blockAdminReviewWrites(page);
      await page.addInitScript((language) => {
        localStorage.setItem('openg7.language', language);
      }, language);
      await page.setViewportSize({ width, height: 864 });
      await page.goto('/admin/fundraiser/pilotage');
      const decision = page.locator('[data-og7="pilot-decision"]');
      const title = decision.getByRole('heading', {
        name: state.decisions[0]!.title,
        exact: true
      });
      const frame = page.locator('[data-og7="pilot-scroll"]');
      const queue = page.locator('aside[data-og7="pilot-queue"]');
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(decision).toHaveAttribute(
        'data-og7-id',
        state.decisions[0]!.id
      );
      await expect(queue.getByRole('button')).toHaveCount(3);
      await expect(frame).toBeVisible();
      await expectAdminPageFits(page);
      expect(
        await frame.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
      ).toBe(true);
      const actions = page.locator(
        '[data-og7="context-controller-actions"] button'
      );
      await expect(actions).toHaveCount(4);
      for (const action of await actions.all()) {
        expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(action).toBeInViewport({ ratio: 1 });
      }
      if (width === 1536) {
        await expect(title).toBeInViewport({ ratio: 1 });
        await expect(queue.getByRole('button').first()).toBeInViewport({
          ratio: 1
        });
      } else {
        await title.scrollIntoViewIfNeeded();
        await expect(title).toBeInViewport({ ratio: 1 });
      }
      await captureAdminDesign(
        page,
        testInfo,
        `pilotage-composition-${language}-${width}`
      );
      if (language === 'en') {
        await page.addStyleTag({
          content: 'html { font-size: 200% !important; }'
        });
        await expectAdminPageFits(page);
        expect(
          await frame.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
        ).toBe(true);
        // At 200%, a heading may be taller than the reserved reading area.
        // Both ends must remain reachable without cropping the heading itself.
        for (const block of ['start', 'end'] as const) {
          // Container queries can settle after the first scroll following text
          // enlargement. Retry the native scroll against its resulting bounds.
          await expect(async () => {
            await title.evaluate(
              (el, block) => el.scrollIntoView({ block, behavior: 'instant' }),
              block
            );
            const headingBounds = (await title.boundingBox())!;
            const frameBounds = (await frame.boundingBox())!;
            const top = Math.max(0, frameBounds.y);
            const bottom = Math.min(
              page.viewportSize()!.height,
              frameBounds.y + frameBounds.height
            );
            expect(
              Math.min(headingBounds.y + headingBounds.height, bottom) -
                Math.max(headingBounds.y, top)
            ).toBeGreaterThan(0);
            if (block === 'start') {
              expect(headingBounds.y).toBeGreaterThanOrEqual(frameBounds.y - 1);
            } else {
              expect(
                headingBounds.y + headingBounds.height
              ).toBeLessThanOrEqual(frameBounds.y + frameBounds.height + 1);
            }
          }).toPass({ timeout: 7000 });
          await expect(title).toBeInViewport();
        }
        for (const action of await actions.all()) {
          // Center the native scroll so fractional rem borders at 200% remain visible.
          await action.evaluate((element) =>
            element.scrollIntoView({
              block: 'center',
              inline: 'nearest',
              behavior: 'instant'
            })
          );
          await expect(action).toBeInViewport({ ratio: 1 });
        }
        await captureAdminDesign(page, testInfo, `pilotage-text-200-${width}`);
      }
      expect(writes).toEqual([]);
      expect(commands).toEqual([]);
    });
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
    'mineral'
  );
  await page.locator('[data-og7="pilot-appearance"]').click();
  await page.locator('[data-og7="pilot-theme-graphite"]').check();
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

for (const appearance of [
  {
    name: 'fresh browser',
    stored: null,
    theme: 'mineral',
    density: 'comfortable'
  },
  {
    name: 'invalid storage',
    stored: '{invalid',
    theme: 'mineral',
    density: 'comfortable'
  },
  {
    name: 'saved choice',
    stored: JSON.stringify({ theme: 'graphite', density: 'compact' }),
    theme: 'graphite',
    density: 'compact'
  }
]) {
  test(`appearance is applied before Angular starts: ${appearance.name}`, async ({
    page
  }) => {
    await page.addInitScript((stored) => {
      if (stored === null)
        localStorage.removeItem('openg7.pilotage.appearance.v1');
      else localStorage.setItem('openg7.pilotage.appearance.v1', stored);
    }, appearance.stored);
    await page.route('**/main-*.js', (route) => route.abort());
    await page.goto('/admin/fundraiser/pilotage');
    await expect(page.locator('html')).toHaveAttribute(
      'data-og7-pilot-theme',
      appearance.theme
    );
    await expect(page.locator('html')).toHaveAttribute(
      'data-og7-pilot-density',
      appearance.density
    );
  });
}

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
  await controllerClock(page);
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
  await page.clock.runFor(400);
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
    await controllerClock(page);
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
    // Sample each controller repeat: the content end can pass through the
    // reading area before the following review panel reaches the scroll end.
    await expect
      .poll(
        async () => {
          await page.clock.runFor(150);
          return page
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
                const hit = document.elementFromPoint(
                  text.left + text.width / 2,
                  text.top + text.height / 2
                );
                return (
                  text.top >= Math.max(content.top, frame.top) &&
                  text.bottom <= Math.min(content.bottom, frame.bottom) &&
                  node.parentElement!.contains(hit)
                );
              }
              return false;
            }, marker);
        },
        { intervals: [50] }
      )
      .toBe(true);
    await page.evaluate(() => {
      (
        window as unknown as { fixturePad: { axes: number[] } }
      ).fixturePad.axes[3] = -0.9;
    });
    await expect
      .poll(
        async () => {
          await page.clock.runFor(150);
          return page
            .locator('[data-og7="pilot-scroll"]')
            .evaluate((el) => el.scrollTop);
        },
        { intervals: [50] }
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

for (const scenario of [
  { language: 'fr-CA', width: 1440, kind: 'publication_ready' },
  { language: 'en', width: 390, kind: 'publication_late' }
]) {
  test(`publication attention cards preserve dossier navigation without offering delivery moderation in ${scenario.language} at ${scenario.width}px`, async ({
    page
  }) => {
    const { state, commands } = await fixtures(page, 1);
    const delivery = state.decisions[0]!;
    const contributionId = '33333333-3333-4333-8333-333333333333';
    const draftId = '44444444-4444-4444-8444-444444444444';
    const attention: PilotDecision = {
      id: `${scenario.kind}:draft:${draftId}`,
      targetId: contributionId,
      version: '1',
      domain: 'publications',
      kind: scenario.kind,
      title: 'Dossier de publication synthétique',
      severity: 'today',
      dueAt: null,
      detailsUrl: `/admin/fundraiser/publications?draftId=${draftId}`,
      facts: [{ label: 'kind', value: 'draft' }],
      actions: [],
      sponsor: {
        id: contributionId,
        name: 'Commanditaire synthétique',
        status: 'approved',
        presentationId: null,
        presentationApproved: false
      }
    };
    state.decisions = [attention, delivery];
    state.total = 2;
    state.domains.publications = 2;
    const moderationRequests: {
      method: string;
      path: string;
      subjectType: string | null;
      subjectId: string | null;
    }[] = [];
    await page.route('**/api/admin/moderation/**', async (route) => {
      const url = new URL(route.request().url());
      const request = {
        method: route.request().method(),
        path: url.pathname,
        subjectType: url.searchParams.get('subjectType'),
        subjectId: url.searchParams.get('subjectId')
      };
      moderationRequests.push(request);
      // Only the real delivery in this fixture owns this moderation subject.
      // A contribution, slot, batch or draft UUID must not match it by accident.
      if (
        request.method !== 'GET' ||
        request.path !== '/api/admin/moderation/content' ||
        request.subjectType !== 'publication_delivery' ||
        request.subjectId !== delivery.targetId
      )
        return route.fulfill({
          status: 404,
          json: { code: 'MODERATION_SUBJECT_NOT_FOUND' }
        });
      await moderationFixture(route, [
        { type: 'publication_delivery', id: delivery.targetId }
      ]);
    });
    await page.addInitScript(
      (language) => localStorage.setItem('openg7.language', language),
      scenario.language
    );
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await page.goto('/admin/fundraiser/pilotage');
    const card = page.locator('[data-og7="pilot-decision"]');
    await expect(card).toHaveAttribute('data-og7-id', attention.id);
    await expect(page.locator('[data-og7="moderation-open"]')).toHaveCount(0);
    expect(moderationRequests).toEqual([]);
    await page.locator('[data-og7="pilot-details"]').click();
    const footer = page.locator('[data-og7="pilot-details-footer"]');
    await expect(footer.getByRole('link')).toBeVisible();
    await expect(footer.getByRole('link')).toHaveAttribute(
      'href',
      attention.detailsUrl
    );
    await page.keyboard.press('Escape');
    await page
      .locator('aside[data-og7="pilot-queue"]')
      .getByRole('button', { name: new RegExp(delivery.title) })
      .click();
    await expect(card).toHaveAttribute('data-og7-id', delivery.id);
    await page.locator('[data-og7="moderation-open"]').click();
    const panel = page.locator('[data-og7="moderation-decision"]');
    await expect(
      panel.locator('[data-og7="moderation-confirmation"]')
    ).toBeVisible();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(
      panel.locator('[data-og7="moderation-submit"]')
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    expect(moderationRequests).toEqual([
      {
        method: 'GET',
        path: '/api/admin/moderation/content',
        subjectType: 'publication_delivery',
        subjectId: delivery.targetId
      }
    ]);
    expect(commands).toEqual([]);
  });
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

test('a reopened calendar keeps its latest snapshot after an older request fails', async ({
  page
}) => {
  const f = await fixtures(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  await page.route('**/api/admin/publication-automation', async (route) => {
    if (++reads !== 1) return route.fallback();
    await gate;
    await route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/admin/fundraiser/pilotage');
  const calendar = page.locator('[data-og7="pilot-calendar"]');
  await calendar.click();
  await expect(
    page.locator('[data-og7="publication-calendar"]')
  ).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape');
  await expect(calendar).toBeFocused();
  await calendar.click();
  await expect(
    page.locator('[data-og7="publication-calendar"]')
  ).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('[data-og7="calendar-month"]')).not.toBeEmpty();
  const previousResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/publication-automation') &&
      response.status() === 503
  );
  release();
  await previousResponse;
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
  await expect(
    page.locator('[data-og7="publication-calendar"]')
  ).toHaveAttribute('aria-busy', 'false');
  expect(reads).toBe(2);
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
    await completeModeration(page);
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
    payload: {
      approveSponsors: [],
      moderationDecision: expect.objectContaining({
        level: 'N0',
        contentVersion: 3,
        contentFingerprint: 'a'.repeat(64),
        confirmation: '11111111-1111-4111-8111-000000000001'
      })
    }
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
    await completeModeration(page);
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

for (const { width, height } of [
  { width: 1920, height: 1080 },
  { width: 1536, height: 760 },
  { width: 1536, height: 600 },
  { width: 1280, height: 720 },
  { width: 1279, height: 720 },
  { width: 1280, height: 649 },
  { width: 390, height: 844 }
]) {
  test(`context controller actions stay reachable without covering the dossier at ${width}x${height}`, async ({
    page
  }, testInfo) => {
    const { commands, state } = await fixtures(page);
    await page.setViewportSize({ width, height });
    await page.goto('/admin/fundraiser/pilotage');
    const card = page.locator('[data-og7="pilot-decision"]');
    const controller = page.locator('[data-og7="context-controller"]');
    const toggle = controller.locator('[data-og7="context-controller-toggle"]');
    const deck = page.locator('[data-og7="bottom-command-deck"]');
    await expect(card).toHaveAttribute('data-og7-id', state.decisions[0]!.id);
    await expect(controller).toBeVisible();
    await captureAdminDesign(
      page,
      testInfo,
      `context-controller-${width}x${height}`
    );
    if (width >= 1440 && height >= 700) await expect(toggle).toBeVisible();
    else await expect(toggle).toBeHidden();
    if (width >= 1280 && height >= 650) {
      await expect(deck).toBeVisible();
      await expect(deck).toHaveAttribute('data-controller-zone', 'bottom');
      await expect(deck.getByRole('button')).toHaveCount(6);
      for (const action of deckActions)
        await expectControllerControlUncovered(
          deck.locator(`[data-og7="${action}"]`)
        );
      // The deck reserves a row below both the reading surface and the sidebar.
      // Test the rendered rectangles rather than any particular grid/CSS recipe.
      const reserved = await deck.evaluate((element) => {
        const deck = element.getBoundingClientRect();
        const intersects = (other: Element) => {
          const rect = other.getBoundingClientRect();
          return (
            Math.min(deck.right, rect.right) - Math.max(deck.left, rect.left) >
              1 &&
            Math.min(deck.bottom, rect.bottom) - Math.max(deck.top, rect.top) >
              1
          );
        };
        return {
          insideSlot: !!element.closest('[data-og7="controller-deck-slot"]'),
          overlapsReading: intersects(
            document.querySelector('[data-og7="pilot-scroll"]')!
          ),
          overlapsSidebar: intersects(
            document.querySelector('openg7-admin-nav aside')!
          )
        };
      });
      expect(reserved).toEqual({
        insideSlot: true,
        overlapsReading: false,
        overlapsSidebar: false
      });
    } else await expect(deck).toBeHidden();
    await expect(controller).toHaveAttribute('data-controller-zone', 'radial');
    await expect(
      page.locator(
        '[data-og7="controller-radial-slot"] [data-og7="context-controller"]'
      )
    ).toHaveCount(1);
    await expectAdminPageFits(page);
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
        await expectControllerControlUncovered(button);
        const coversDossier = await button.evaluate((element) => {
          const dossier = document
            .querySelector('[data-og7="pilot-decision"]')!
            .getBoundingClientRect();
          const scroll = document
            .querySelector('[data-og7="pilot-scroll"]')!
            .getBoundingClientRect();
          const control = element.getBoundingClientRect();
          const overlapWidth =
            Math.min(dossier.right, scroll.right, control.right) -
            Math.max(dossier.left, scroll.left, control.left);
          const overlapHeight =
            Math.min(dossier.bottom, scroll.bottom, control.bottom) -
            Math.max(dossier.top, scroll.top, control.top);
          return overlapWidth > 1 && overlapHeight > 1;
        });
        expect(coversDossier).toBe(false);
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

test('context controller rejects a mouse gesture when the selected dossier changes before release', async ({
  page
}) => {
  const { commands, state } = await fixtures(page);
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  const accept = page.locator('[data-og7="pilot-accept"]');
  await expect(accept).toBeEnabled();
  const bounds = (await accept.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  );
  await page.mouse.down();
  await page.keyboard.press(']');
  await expect(page.locator('[data-og7="pilot-decision"]')).toHaveAttribute(
    'data-og7-id',
    state.decisions[1]!.id
  );
  await page.mouse.up();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(commands).toEqual([]);
  await accept.click();
  await expect(page.locator('[data-og7="pilot-panel-confirm"]')).toContainText(
    state.decisions[1]!.title
  );
  await page.keyboard.press('Escape');
  expect(commands).toEqual([]);
});

test('context controller reflects a remapped Xbox profile without changing decision safeguards', async ({
  page
}) => {
  await controllerClock(page);
  const { commands } = await fixtures(page);
  const profile = defaultControllerProfile();
  profile.bindings = { primary: 2, secondary: 0, edit: 1, details: 3 };
  await page.addInitScript(
    (profile) =>
      localStorage.setItem('og7-controller-profile', JSON.stringify(profile)),
    profile
  );
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  await buttons(page);
  await expect(page.locator('[data-og7="pilot-accept"] kbd')).toHaveText('X');
  await expect(page.locator('[data-og7="pilot-reject"] kbd')).toHaveText('A');
  await tap(page, 2);
  await expect(page.locator('[data-og7="pilot-panel-confirm"]')).toBeVisible();
  await page.clock.runFor(600);
  expect(commands).toEqual([]);
  await page.keyboard.press('Escape');
  expect(commands).toEqual([]);
});

test('controller surfaces show configured shortcuts without a connected gamepad', async ({
  page
}) => {
  const { commands, state } = await fixtures(page);
  const profile = defaultControllerProfile();
  profile.bindings = { primary: 2, secondary: 0, edit: 1, details: 3 };
  await page.addInitScript((profile) => {
    localStorage.setItem('og7-controller-profile', JSON.stringify(profile));
    (
      window as unknown as { fixturePad: { connected: boolean } }
    ).fixturePad.connected = false;
  }, profile);
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  for (const [action, shortcut] of [
    ['accept', 'X'],
    ['reject', 'A'],
    ['edit', 'B'],
    ['details', 'Y']
  ])
    await expect(page.locator(`[data-og7="pilot-${action}"] kbd`)).toHaveText(
      shortcut!
    );
  await expect(page.locator('[data-og7="pilot-home"]')).toBeEnabled();
  await expect(page.locator('[data-og7="pilot-diagnostics"]')).toBeEnabled();
  await page.locator('[data-og7="pilot-diagnostics"]').click();
  await expect(page.getByRole('dialog')).toContainText('Diagnostic');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-og7="pilot-diagnostics"]')).toBeFocused();
  await expect(page.locator('[data-og7="pilot-decision"]')).toHaveAttribute(
    'data-og7-id',
    state.decisions[0]!.id
  );
  expect(commands).toEqual([]);
});

test('bottom deck arrows move native keyboard focus without changing the dossier', async ({
  page
}) => {
  const { commands, state } = await fixtures(page);
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  const decision = page.locator('[data-og7="pilot-decision"]');
  const previous = page.locator('[data-og7="pilot-previous"]');
  const next = page.locator('[data-og7="pilot-next"]');
  await previous.focus();
  await page.keyboard.press('ArrowRight');
  await expect(next).toBeFocused();
  await expect(decision).toHaveAttribute('data-og7-id', state.decisions[0]!.id);
  await page.keyboard.press('ArrowLeft');
  await expect(previous).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(
    page.locator('[data-controller-zone="radial"] :focus')
  ).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-og7="pilot-home"]')).toBeFocused();
  // Native tabbing remains available between the controls and out of the deck.
  await next.focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-og7="pilot-open-record"]')).toBeFocused();
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(decision).toHaveAttribute('data-og7-id', state.decisions[1]!.id);
  await previous.focus();
  await page.keyboard.press('Enter');
  await expect(decision).toHaveAttribute('data-og7-id', state.decisions[0]!.id);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(commands).toEqual([]);
});

test('bottom deck discards a pointer gesture captured for a different selected dossier', async ({
  page
}) => {
  const { commands, state } = await fixtures(page);
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  const next = page.locator('[data-og7="pilot-next"]');
  const bounds = (await next.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  );
  await page.mouse.down();
  await page.keyboard.press(']');
  await expect(page.locator('[data-og7="pilot-decision"]')).toHaveAttribute(
    'data-og7-id',
    state.decisions[1]!.id
  );
  await page.mouse.up();
  await expect(page.locator('[data-og7="pilot-decision"]')).toHaveAttribute(
    'data-og7-id',
    state.decisions[1]!.id
  );
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(commands).toEqual([]);
});

test('bottom deck owns Xbox focus, returns to radial with B and preserves bumper navigation', async ({
  page
}) => {
  await controllerClock(page);
  const { commands, state } = await fixtures(page);
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  const decision = page.locator('[data-og7="pilot-decision"]');
  const previous = page.locator('[data-og7="pilot-previous"]');
  const next = page.locator('[data-og7="pilot-next"]');
  await previous.focus();
  await tap(page, 15);
  await expect(next).toBeFocused();
  await expect(decision).toHaveAttribute('data-og7-id', state.decisions[0]!.id);
  await tap(page, 0);
  await expect(decision).toHaveAttribute('data-og7-id', state.decisions[1]!.id);
  await next.focus();
  await tap(page, 1);
  await expect(
    page.locator('[data-controller-zone="radial"] :focus')
  ).toHaveCount(1);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await next.focus();
  await tap(page, 4);
  await expect(decision).toHaveAttribute('data-og7-id', state.decisions[0]!.id);
  await tap(page, 5);
  await expect(decision).toHaveAttribute('data-og7-id', state.decisions[1]!.id);
  // A selected bottom control must never fall through to primary approval.
  await page.locator('[data-og7="pilot-diagnostics"]').focus();
  await tap(page, 0);
  await expect(page.getByRole('dialog')).toContainText('Diagnostic');
  await tap(page, 1);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(commands).toEqual([]);
});

test('a confirmation keeps input ownership over both controller surfaces', async ({
  page
}) => {
  await controllerClock(page);
  const { commands, state } = await fixtures(page);
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-accept"]').click();
  const panel = page.locator('[data-og7="pilot-panel-confirm"]');
  await expect(panel).toBeVisible();
  for (const button of [5, 4, 9, 8, 3]) {
    await tap(page, button);
    await expect(panel).toBeVisible();
    await expect(page.locator('[data-og7="pilot-decision"]')).toHaveAttribute(
      'data-og7-id',
      state.decisions[0]!.id
    );
  }
  await panel.getByRole('button', { name: /Annuler/ }).focus();
  await tap(page, 0);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('[data-og7="pilot-accept"]')).toBeFocused();
  expect(commands).toEqual([]);
});

test('bottom deck opens the selected record and queue through existing navigation', async ({
  page
}) => {
  const { commands, state } = await fixtures(page);
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-focus"]').click();
  await expect(page.locator('aside[data-og7="pilot-queue"]')).toBeHidden();
  await page
    .locator('[data-og7="bottom-command-deck"] [data-og7="pilot-deck-queue"]')
    .click();
  await expect(page.locator('aside[data-og7="pilot-queue"]')).toBeVisible();
  await expect(
    page.locator('#pilot-following:focus, #pilot-following :focus')
  ).toHaveCount(1);
  await page.locator('[data-og7="pilot-open-record"]').click();
  await expect(page).toHaveURL(state.decisions[0]!.detailsUrl);
  expect(commands).toEqual([]);
});

test('empty controller keeps workspace commands available and dossier commands disabled', async ({
  page
}) => {
  const { commands } = await fixtures(page, 0);
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  const deck = page.locator('[data-og7="bottom-command-deck"]');
  for (const action of ['pilot-home', 'pilot-diagnostics'])
    await expect(deck.locator(`[data-og7="${action}"]`)).toBeEnabled();
  for (const action of [
    'pilot-previous',
    'pilot-next',
    'pilot-open-record',
    'pilot-deck-queue'
  ])
    await expect(deck.locator(`[data-og7="${action}"]`)).toBeDisabled();
  await deck.locator('[data-og7="pilot-diagnostics"]').click();
  await expect(page.getByRole('dialog')).toContainText('Diagnostic');
  await page.keyboard.press('Escape');
  await expect(deck.locator('[data-og7="pilot-diagnostics"]')).toBeFocused();
  await deck.locator('[data-og7="pilot-home"]').click();
  await expect(page).toHaveURL(/\/admin\/fundraiser$/);
  expect(commands).toEqual([]);
});

test('sandbox simulation panel takes the controller space and restores it when closed', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.route('**/openg7-sandbox.json', (route) =>
    route.fulfill({
      json: { version: 1, enabled: true, stripeBasePath: '/__sandbox/stripe' }
    })
  );
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  const deck = page.locator('[data-og7="bottom-command-deck"]');
  const open = page.locator('[data-og7="sandbox-controller-open"]');
  await expect(deck).toBeVisible();
  await open.click();
  await expect(page.locator('[data-og7="virtual-controller"]')).toBeVisible();
  await expect(deck).toBeHidden();
  await open.click();
  await expect(page.locator('[data-og7="virtual-controller"]')).toBeHidden();
  await expect(deck).toBeVisible();
  await expectControllerControlUncovered(
    deck.locator('[data-og7="pilot-diagnostics"]')
  );
  expect(commands).toEqual([]);
});

test('narrowing the viewport restores focus from the hidden deck to a visible radial action', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  const diagnostics = page.locator('[data-og7="pilot-diagnostics"]');
  await diagnostics.focus();
  await expect(diagnostics).toBeFocused();
  await page.setViewportSize({ width: 1279, height: 720 });
  await expect(page.locator('[data-og7="bottom-command-deck"]')).toBeHidden();
  const focused = page.locator('[data-controller-zone="radial"] :focus');
  await expect(focused).toHaveCount(1);
  await expectControllerControlUncovered(focused);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(commands).toEqual([]);
});

test('opening the sandbox while the deck owns focus restores a visible native control', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.route('**/openg7-sandbox.json', (route) =>
    route.fulfill({
      json: { version: 1, enabled: true, stripeBasePath: '/__sandbox/stripe' }
    })
  );
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  const open = page.locator('[data-og7="sandbox-controller-open"]');
  await expect(open).toBeVisible();
  await page.locator('[data-og7="pilot-diagnostics"]').focus();
  await expect(page.locator('[data-og7="pilot-diagnostics"]')).toBeFocused();
  // Trigger the shipped toggle without moving focus to it first. This also
  // covers layout changes caused by a controller command or other UI surface.
  await open.dispatchEvent('click');
  await expect(page.locator('[data-og7="virtual-controller"]')).toBeVisible();
  await expect(page.locator('[data-og7="bottom-command-deck"]')).toBeHidden();
  const focused = page.locator('[data-controller-zone="radial"] :focus');
  await expect(focused).toHaveCount(1);
  await expectControllerControlUncovered(focused);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(commands).toEqual([]);
});

test('context controller night presentation stays readable without continuous animation', async ({
  page
}, testInfo) => {
  const { commands } = await fixtures(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() =>
    localStorage.setItem(
      'openg7.pilotage.appearance.v1',
      JSON.stringify({ theme: 'night', system: false })
    )
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/admin/fundraiser/pilotage');
  await expect(page.locator('[data-og7="pilot-accept"]')).toBeEnabled();
  await captureAdminDesign(page, testInfo, 'context-controller-night');
  const results = await new AxeBuilder({ page })
    .include('[data-og7="context-controller"]')
    .include('[data-og7="bottom-command-deck"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  expect(
    await page
      .locator(
        '[data-og7="context-controller"], [data-og7="bottom-command-deck"]'
      )
      .evaluateAll(
        (elements) =>
          elements.flatMap((element) =>
            element
              .getAnimations({ subtree: true })
              .filter((animation) => animation.playState === 'running')
          ).length
      )
  ).toBe(0);
  expect(commands).toEqual([]);
});

test('context controller collapses by keyboard, keeps focus and restores actions without a command', async ({
  page
}) => {
  const { commands, state } = await fixtures(page);
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  const controller = page.locator('[data-og7="context-controller"]');
  const toggle = controller.locator('[data-og7="context-controller-toggle"]');
  const actions = controller.locator('[data-og7="context-controller-actions"]');
  const decision = page.locator('[data-og7="pilot-decision"]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(actions).toBeHidden();
  await expect(controller.getByRole('button')).toHaveCount(1);
  const deck = page.locator('[data-og7="bottom-command-deck"]');
  await expect(deck).toBeVisible();
  for (const action of deckActions)
    await expectControllerControlUncovered(
      deck.locator(`[data-og7="${action}"]`)
    );
  await page.keyboard.press('Tab');
  expect(
    await actions.evaluateAll((containers) =>
      containers.some((element) => element.contains(document.activeElement))
    )
  ).toBe(false);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-og7="pilot-details"]')).toBeVisible();
  await page.locator('[data-og7="pilot-details"]').click();
  await expect(page.locator('[data-og7="pilot-panel-details"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-og7="pilot-details"]')).toBeFocused();
  await expect(decision).toHaveAttribute('data-og7-id', state.decisions[0]!.id);
  expect(commands).toEqual([]);
});

test('context controller restores classical actions when a collapsed palette becomes narrow', async ({
  page
}) => {
  const { commands } = await fixtures(page);
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  const toggle = page.locator('[data-og7="context-controller-toggle"]');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(toggle).toBeHidden();
  for (const action of ['accept', 'reject', 'edit', 'details'])
    await expect(page.locator(`[data-og7="pilot-${action}"]`)).toBeVisible();
  const accept = page.locator('[data-og7="pilot-accept"]');
  await expect(accept).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-og7="pilot-panel-confirm"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(accept).toBeFocused();
  expect(commands).toEqual([]);
});

test('context controller keeps reader decisions disabled and dossier details accessible', async ({
  page
}) => {
  const { commands, state } = await fixtures(page);
  state.writable = false;
  for (const decision of state.decisions)
    for (const action of decision.actions) action.blocked = 'READ_ONLY';
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  const controller = page.locator('[data-og7="context-controller"]');
  for (const action of ['accept', 'reject', 'edit'])
    await expect(
      controller.locator(`[data-og7="pilot-${action}"]`)
    ).toBeDisabled();
  const details = controller.locator('[data-og7="pilot-details"]');
  await expect(details).toBeEnabled();
  await details.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-og7="pilot-panel-details"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(details).toBeFocused();
  expect(commands).toEqual([]);
});

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
  await controllerClock(page);
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
  await page.clock.runFor(600);
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
    if (
      await moderationFixture(
        route,
        state.decisions.flatMap((d) => [
          ...(d.sponsor
            ? [{ type: 'sponsorship' as const, id: d.sponsor.id }]
            : []),
          ...(d.publication
            ? [
                { type: 'publication_delivery' as const, id: d.publication.id },
                ...d.publication.sponsors.map((s) => ({
                  type: 'sponsorship' as const,
                  id: s.id
                }))
              ]
            : [])
        ])
      )
    )
      return;
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
const controllerClocks = new WeakSet<Page>();

async function controllerClock(page: Page): Promise<void> {
  await page.clock.install();
  controllerClocks.add(page);
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
  // The controller samples on RAF. Process both the transition and a following
  // frame before returning, including the neutral frames that arm the input.
  if (controllerClocks.has(page)) {
    await page.clock.runFor(32);
  } else {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );
  }
}
async function tap(page: Page, button: number): Promise<void> {
  await buttons(page);
  await buttons(page, [button]);
  await buttons(page);
}

test('controller approval is contextual, requires release and processes twenty decisions without the portal', async ({
  page
}) => {
  await controllerClock(page);
  const { commands } = await fixtures(page, 20);
  await page.setViewportSize({ width: 1536, height: 760 });
  await page.goto('/admin/fundraiser/pilotage');
  await expect(page.locator('[data-og7="pilot-decision"]')).toBeVisible();
  await buttons(page);
  await buttons(page, [0]);
  await expect(page.locator('[data-og7="pilot-panel-confirm"]')).toBeVisible();
  await page.clock.runFor(600);
  expect(commands).toHaveLength(0);
  await buttons(page);
  await buttons(page, [0]);
  await expect(page.locator('[data-og7="moderation-decision"]')).toBeVisible();
  await page.clock.runFor(600);
  expect(commands).toHaveLength(0);
  await completeModeration(page);
  await expect(page.locator('[data-og7="pilot-receipt"]')).toBeVisible();
  await page.clock.runFor(400);
  expect(commands).toHaveLength(1);
  for (let i = 1; i < 20; i++) {
    await tap(page, 5);
    await tap(page, 0);
    await expect(
      page.locator('[data-og7="pilot-panel-confirm"]')
    ).toBeVisible();
    await tap(page, 0);
    await completeModeration(page);
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

for (const control of ['cancel', 'close'] as const) {
  test(`controller A activates the focused ${control} control without confirming a Pilotage decision`, async ({
    page
  }) => {
    await controllerClock(page);
    const { commands } = await fixtures(page);
    await page.goto('/admin/fundraiser/pilotage');
    await expect(page.locator('[data-og7="pilot-decision"]')).toBeVisible();
    await tap(page, 0);
    const panel = page.locator('[data-og7="pilot-panel-confirm"]');
    await expect(panel).toBeVisible();
    await expect(page.locator('[data-og7="pilot-confirm"]')).toBeFocused();
    const target =
      control === 'cancel'
        ? panel.getByRole('button', { name: /Annuler/ })
        : page.getByRole('dialog').getByRole('button').first();
    for (let move = 0; move < 8; move++) {
      if (
        await target.evaluate((element) => element === document.activeElement)
      )
        break;
      await tap(page, 4);
    }
    await expect(target).toBeFocused();
    await tap(page, 0);
    await expect(panel).toHaveCount(0);
    await expect(page.locator('[data-og7="moderation-decision"]')).toHaveCount(
      0
    );
    expect(commands).toEqual([]);
  });
}

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
  await completeModeration(page, true);
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
  await completeModeration(page);
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
test('an uncertain recovered receipt survives the slower initial projection without a replay', async ({
  page
}) => {
  const f = await fixtures(page);
  f.uncertain();
  f.fail();
  await page.goto('/admin/fundraiser/pilotage');
  await page.locator('[data-og7="pilot-accept"]').click();
  await page.locator('[data-og7="pilot-confirm"]').click();
  await completeModeration(page);
  await expect(
    page.getByRole('button', { name: 'Vérifier le résultat' })
  ).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/admin/pilotage?*', async (route) => {
    if (new URL(route.request().url()).searchParams.has('id'))
      return route.fallback();
    await gate;
    await route.fallback();
  });
  const recovery = page.waitForResponse('**/api/admin/pilotage/receipt?*');
  await page.reload();
  expect(await (await recovery).json()).toMatchObject({ status: 'uncertain' });
  await expect(
    page.locator('[data-og7="pilot-domains"]').getByRole('button').first()
  ).toBeEnabled();
  release();
  await expect(
    page.getByRole('button', { name: 'Examiner cet incident' })
  ).toBeVisible();
  await expect(page.locator('[data-og7="pilot-accept"]')).toBeDisabled();
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
  await completeModeration(page);
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

test('shared navigation and search own Xbox input and suppress pilotage decisions until controller release', async ({
  page
}) => {
  await controllerClock(page);
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
  await expect(page).toHaveURL(/\/pilotage$/);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await tap(page, 0);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page).toHaveURL(/\/contributions$/);
  expect(commands).toEqual([]);
  await page.goto('/admin/fundraiser/pilotage');
  await expect(decision).toBeVisible();
  await page.keyboard.press('Control+k');
  const search = page.locator('[data-og7="admin-search"]');
  await expect(search).toBeVisible();
  await tap(page, 0);
  const editor = page.locator('[data-og7="controller-editor"]');
  await expect(editor).toBeVisible();
  await expect(
    page.locator('[data-og7="pilot-panel-confirm"]')
  ).not.toBeVisible();
  await tap(page, 1);
  await expect(editor).not.toBeVisible();
  await expect(search).toBeVisible();
  await tap(page, 1);
  await expect(search).not.toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(search).toBeVisible();
  for (const button of [3, 9]) await tap(page, button);
  await tap(page, 5);
  await expect(search.locator('header button')).toBeFocused();
  await expect(
    page.locator('[data-og7="pilot-panel-confirm"]')
  ).not.toBeVisible();
  await buttons(page, [0]);
  await expect(search).not.toBeVisible();
  await page.locator('#admin-main').focus();
  await page.clock.runFor(350);
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
  await controllerClock(page);
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
  await page.clock.runFor(500);
  expect(f.commands).toHaveLength(1);
  expect(f.commands[0]!.action).toBe('programme.apply');
  expect(f.commands[0]!.payload!.moves).toHaveLength(2);
  await buttons(page);
});

test('refreshing the rehearsal replaces private media and ignores the old in-flight preview', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  const selected = f.programme.deliveries[0]!;
  const oldMedia = '10000000-0000-4000-8000-000000000601';
  const newMedia = '10000000-0000-4000-8000-000000000602';
  selected.mediaId = oldMedia;
  let releaseOld!: () => void;
  const oldRequest = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  const previews: string[] = [];
  const photo = await readFile(
    'apps/funding-web/src/assets/openg7-social-communautes-connectees-canada-960.webp'
  );
  await page.route(
    '**/api/admin/sponsorships/media/content/**',
    async (route) => {
      const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
      previews.push(id);
      if (id === oldMedia) await oldRequest;
      await route.fulfill({ contentType: 'image/webp', body: photo });
    }
  );
  try {
    await f.open();
    const programme = page.locator('[data-og7="editorial-programme"]');
    await programme
      .getByRole('button', { name: 'Répétition générale', exact: true })
      .click();
    await expect.poll(() => previews).toEqual([oldMedia]);
    selected.version++;
    selected.mediaId = newMedia;
    await programme
      .getByRole('button', { name: 'Actualiser', exact: true })
      .click();
    await expect.poll(() => previews).toEqual([oldMedia, newMedia]);
    const image = programme.locator('[data-og7="programme-rehearsal"] img');
    await expect(image).toBeVisible();
    const currentSource = await image.getAttribute('src');
    const lateResponse = page.waitForResponse((response) =>
      response.url().endsWith('/' + oldMedia)
    );
    releaseOld();
    await (await lateResponse).finished();
    await page.waitForLoadState('networkidle');
    await expect(image).toHaveAttribute('src', currentSource!);
    expect(f.commands).toHaveLength(0);
  } finally {
    releaseOld();
  }
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

test('weekly selection shares one confirmation and keeps editorial dates separate from proposed moves', async ({
  page
}) => {
  const f = await programmeFixtures(page);
  await f.open();
  const programme = page.locator('[data-og7="editorial-programme"]');
  await programme
    .getByRole('button', { name: 'Composer la semaine', exact: true })
    .click();
  await programme
    .getByRole('button', { name: 'Proposer une répartition' })
    .click();
  await programme
    .getByRole('button', { name: 'Examiner les déplacements' })
    .click();
  await expect(
    programme.locator('[data-og7="programme-confirmation"]')
  ).toHaveCount(1);
  await programme
    .getByRole('button', { name: 'Variante de texte', exact: true })
    .click();
  await expect(
    programme.locator('[data-og7="programme-confirmation"]')
  ).toHaveCount(0);
  await programme
    .getByRole('button', { name: 'Ton neutre', exact: true })
    .click();
  await programme
    .getByRole('button', { name: 'Examiner cette variante' })
    .click();
  await expect(
    programme.locator('[data-og7="programme-confirmation"]')
  ).toHaveCount(1);
  const selected = f.programme.deliveries[1]!;
  await programme
    .getByRole('combobox', { name: 'Publication', exact: true })
    .selectOption(selected.id);
  await expect(
    programme.locator('[data-og7="programme-confirmation"]')
  ).toHaveCount(0);
  await expect(
    programme.locator('[data-og7="programme-comparison"]')
  ).toHaveCount(0);
  await programme
    .getByRole('button', { name: 'Ton neutre', exact: true })
    .click();
  await programme
    .getByRole('button', { name: 'Examiner cette variante' })
    .click();
  expect(f.commands).toHaveLength(0);
  await programme
    .getByRole('button', { name: 'Confirmer l’enregistrement' })
    .click();
  await expect.poll(() => f.commands.length).toBe(1);
  expect(f.commands[0]!.action).toBe('publication.edit');
  expect(f.commands[0]!.targetId).toBe(selected.id);
  expect(f.commands[0]!.payload!.scheduledAt).toBe(selected.scheduledAt);
  expect(f.commands[0]!.payload!.mediaId).toBe(selected.mediaId);
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
