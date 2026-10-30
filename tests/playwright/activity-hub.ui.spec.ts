import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from './support/test.js';

const base = '/demo/actualites';
const apiCalls = new WeakMap<Page, string[]>();
const browserErrors = new WeakMap<Page, string[]>();
const hook = (name: string) => `[data-og7="activity-hub-${name}"]`;
const section = (page: Page, id: string) =>
  page.locator(`${hook('section')}[data-og7-id="${id}"]`);
const card = (page: Page, id: string) =>
  page.locator(`${hook('card')}[data-og7-id="${id}"]`);
async function goSection(page: Page, id: string): Promise<void> {
  const destination = section(page, id);
  if (!(await destination.isVisible()))
    await page.locator(`${hook('explore')} > summary`).click();
  await destination.click();
}

async function browseArchive(page: Page): Promise<void> {
  await page.locator(hook('browse')).click();
  await expect(page.locator(hook('dashboard'))).not.toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Explorer le fil',
      exact: true,
      level: 1
    })
  ).toBeVisible();
}

const conciseViolations = (
  violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']
) =>
  violations.map(({ id, nodes }) => ({
    id,
    nodeCount: nodes.length,
    nodes: nodes.slice(0, 3).map(({ target, failureSummary }) => ({
      target,
      failureSummary
    }))
  }));

test.beforeEach(async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  apiCalls.set(page, requests);
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/\/api(?:\/|$)/, async (route) => {
    requests.push(route.request().url());
    await route.abort();
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('openg7.language'))
      localStorage.setItem('openg7.language', 'fr-CA');
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base);
  await expect(page.locator('[data-og7="activity-hub"]')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(
    apiCalls.get(page),
    'the prototype must not request real data'
  ).toEqual([]);
  expect(
    browserErrors.get(page),
    'the page must not raise runtime errors'
  ).toEqual([]);
});

test('présente le tableau de bord Découvrir, ses guides et les archives fictives', async ({
  page
}) => {
  await expect(
    page.getByRole('heading', {
      name: 'Découvrir',
      exact: true,
      level: 1
    })
  ).toBeVisible();
  await expect(page.locator(hook('notice'))).toContainText(
    /démo|démonstration/i
  );
  await expect(page.locator(hook('summary'))).toBeVisible();
  await expect(page.locator(hook('dashboard'))).toBeVisible();
  await expect(page.locator(hook('hero'))).toBeVisible();
  await expect(page.locator(hook('diary')).getByRole('listitem')).toHaveCount(
    4
  );
  await expect(
    page.locator(hook('takeaways')).locator(hook('takeaway'))
  ).toHaveCount(3);
  await expect(page.locator(hook('quote'))).toBeVisible();
  await expect(
    page.locator(hook('resource-guides')).locator(hook('guide'))
  ).toHaveCount(4);
  await expect(
    page.getByRole('banner').getByRole('link', {
      name: 'Administration',
      exact: true
    })
  ).toBeVisible();
  await expect(page.locator(hook('card'))).toHaveCount(0);
  await expect(section(page, 'overview')).toHaveAttribute(
    'aria-current',
    'page'
  );

  await expect(page.locator(hook('explore'))).not.toHaveAttribute('open', '');
  const guide = page.locator(
    `${hook('guide')}[data-og7-id="guide-exceptions"]`
  );
  await guide
    .getByRole('button', { name: 'Revue média par exceptions', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Revue média par exceptions');
  await expect(dialog.locator(hook('detail'))).toHaveAttribute(
    'data-og7-id',
    'guide-exceptions'
  );
  await dialog
    .getByRole('button', { name: 'Garder en favori', exact: true })
    .click();
  await page.keyboard.press('Escape');
  await goSection(page, 'saved');
  await expect(card(page, 'guide-exceptions')).toBeVisible();
  await expect(page.locator(hook('card'))).toHaveCount(1);
  await goSection(page, 'overview');
  await browseArchive(page);
  await expect(page.locator(hook('card'))).toHaveCount(14);
  await goSection(page, 'journal');
  await expect(page.locator(hook('activity-list'))).toBeVisible();
  for (const id of ['inspirations', 'news', 'resources']) {
    await goSection(page, id);
    await expect(section(page, id)).toHaveAttribute('aria-current', 'page');
    expect(await page.locator(hook('card')).count()).toBeGreaterThan(0);
  }
  await goSection(page, 'overview');
  await expect(page.locator(hook('dashboard'))).toBeVisible();
  await expect(page.locator(hook('card'))).toHaveCount(0);
});

test('combine recherche sans accents, thème, absence de résultat et réinitialisation', async ({
  page
}) => {
  await browseArchive(page);
  const featured = card(page, 'shared-workshop');
  const title = await featured.locator(hook('open')).innerText();
  const normalizedTitle = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  await page.locator(hook('search')).fill(normalizedTitle);
  await expect(page.locator(hook('card'))).toHaveCount(1);
  await expect(featured).toBeVisible();

  await page.locator(hook('search')).fill('contenu-inexistant-synthetique-123');
  await expect(page.locator(hook('card'))).toHaveCount(0);
  await expect(page.locator(hook('reset'))).toBeVisible();
  await page.locator(hook('reset')).click();
  await expect(page.locator(hook('search'))).toHaveValue('');
  await expect(page.locator(hook('card'))).toHaveCount(14);

  await page.locator(hook('theme')).selectOption('community');
  const filteredCount = await page.locator(hook('card')).count();
  expect(filteredCount).toBeGreaterThan(0);
  expect(filteredCount).toBeLessThan(14);
  await page.locator(hook('search')).fill('contenu-inexistant-synthetique-123');
  await expect(page.locator(hook('card'))).toHaveCount(0);

  await goSection(page, 'resources');
  await expect(page.locator(hook('search'))).toHaveValue('');
  await expect(page.locator(hook('theme'))).toHaveValue('all');
  await expect(page.locator(hook('unread'))).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  expect(await page.locator(hook('card')).count()).toBeGreaterThan(0);
});

test('ouvre la lecture au clavier, marque lu et restaure le focus après Échap', async ({
  page
}) => {
  await goSection(page, 'inspirations');
  const featured = card(page, 'shared-workshop');
  const opener = featured.locator(hook('open'));
  const title = await opener.innerText();
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(title);
  await expect(
    dialog.getByRole('button', { name: 'Fermer', exact: true })
  ).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(
    dialog.getByRole('button', { name: 'Fermer', exact: true })
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();

  await page.locator(hook('unread')).click();
  await expect(page.locator(hook('unread'))).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(featured).toHaveCount(0);
  await page.locator(hook('unread')).click();
  await expect(featured).toBeVisible();
});

test('conserve les favoris pendant la navigation et le changement de langue', async ({
  page
}) => {
  await browseArchive(page);
  const featured = card(page, 'shared-workshop');
  await featured.locator(hook('save')).click();
  await expect(featured.locator(hook('save'))).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await goSection(page, 'saved');
  await expect(page.locator(hook('card'))).toHaveCount(1);
  await expect(featured).toBeVisible();

  await page.locator(hook('language')).click();
  await expect(
    page.getByRole('heading', {
      name: 'Explore the feed',
      exact: true,
      level: 1
    })
  ).toBeVisible();
  await expect(featured.locator(hook('save'))).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await goSection(page, 'journal');
  await goSection(page, 'saved');
  await expect(featured).toBeVisible();

  // The locale persists; content preferences remain local to this visit.
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'Discover',
      exact: true,
      level: 1
    })
  ).toBeVisible();
  await goSection(page, 'saved');
  await expect(page.locator(hook('card'))).toHaveCount(0);
});

test('redonne le focus au contenu quand la lecture retire une carte du filtre non lus', async ({
  page
}) => {
  await goSection(page, 'inspirations');
  await page.locator(hook('unread')).click();
  const featured = card(page, 'shared-workshop');
  await featured.locator(hook('open')).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(featured).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#admin-main')).toBeFocused();
  await expect(page.locator(hook('unread'))).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('garde un point de reprise après réinitialisation, retrait du dernier favori et départ du journal', async ({
  page
}) => {
  await browseArchive(page);
  const main = page.locator('#admin-main');
  await page.locator(hook('search')).fill('contenu-inexistant-synthetique-123');
  const reset = page.locator(hook('reset'));
  await reset.focus();
  await page.keyboard.press('Enter');
  await expect(reset).toHaveCount(0);
  await expect(main).toBeFocused();
  await expect(page.locator(hook('card'))).toHaveCount(14);

  const featured = card(page, 'shared-workshop');
  await featured.locator(hook('save')).click();
  await goSection(page, 'saved');
  await expect(page.locator(hook('card'))).toHaveCount(1);
  await featured.locator(hook('save')).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(hook('card'))).toHaveCount(0);
  await expect(main).toBeFocused();

  await goSection(page, 'overview');
  const openJournal = page.getByRole('button', {
    name: 'Voir toute l’activité',
    exact: true
  });
  await openJournal.focus();
  await page.keyboard.press('Enter');
  await expect(openJournal).toHaveCount(0);
  await expect(section(page, 'journal')).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(main).toBeFocused();
});

test('ajoute deux nouvelles entrées une seule fois lors de l’actualisation simulée', async ({
  page
}) => {
  const refresh = page.locator(hook('refresh'));
  await refresh.evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(refresh).toBeDisabled();
  await expect(page.locator(hook('dashboard'))).toBeVisible();
  await expect(page.locator(hook('diary')).getByRole('listitem')).toHaveCount(
    5
  );
  await browseArchive(page);
  await expect(page.locator(hook('card'))).toHaveCount(16);
  await expect(card(page, 'community-questions')).toBeVisible();
  await expect(card(page, 'reading-checklist')).toBeVisible();

  await goSection(page, 'journal');
  await expect(page.locator(hook('activity-list'))).toBeVisible();
  await goSection(page, 'resources');
  await expect(card(page, 'reading-checklist')).toBeVisible();
  await page.reload();
  await expect(page.locator(hook('dashboard'))).toBeVisible();
  await expect(refresh).toBeEnabled();
  await browseArchive(page);
  await expect(page.locator(hook('card'))).toHaveCount(14);
});

test('réduit et rouvre le guide puis permet de le placer en bas et en haut', async ({
  page
}) => {
  const collapse = page.locator(hook('collapse'));
  const dock = page.locator(hook('dock'));
  const dashboard = page.locator(hook('dashboard'));
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expect(dock).toHaveAttribute('aria-pressed', 'false');
  await collapse.click();
  await expect(collapse).toHaveAttribute('aria-expanded', 'false');
  await expect(collapse).toHaveAccessibleName('Ouvrir le guide');
  await expect(dashboard).not.toBeVisible();
  await collapse.click();
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await expect(dashboard).toBeVisible();
  await dock.click();
  await expect(dock).toHaveAttribute('aria-pressed', 'true');
  await expect(dock).toHaveAccessibleName('Replacer en haut');
  await expect(dashboard).toBeVisible();
  await dock.click();
  await expect(dock).toHaveAttribute('aria-pressed', 'false');
  await expect(dock).toHaveAccessibleName('Placer en bas');
  await expect(dashboard).toBeVisible();
});

test('garde une mise en page accessible sans débordement sur ordinateur et mobile', async ({
  page
}, testInfo) => {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      )
    )
    .toBe(true);
  const overview = await new AxeBuilder({ page })
    .include('[data-og7="activity-hub"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(conciseViolations(overview.violations)).toEqual([]);
  const viewport = page.viewportSize();
  if (viewport && viewport.width >= 1500) {
    const hero = await page.locator(hook('hero')).boundingBox();
    const guides = await page.locator(hook('resource-guides')).boundingBox();
    expect(hero).not.toBeNull();
    expect(guides).not.toBeNull();
    // Keep the daily briefing and resource row together as in the reference.
    expect(hero!.height).toBeLessThan(230);
    expect(guides!.y + guides!.height).toBeLessThanOrEqual(
      viewport.height + 20
    );
  }
  await page.screenshot({
    path: testInfo.outputPath('activity-hub.png'),
    fullPage: true
  });
  await browseArchive(page);
  const archive = await new AxeBuilder({ page })
    .include('[data-og7="activity-hub"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(conciseViolations(archive.violations)).toEqual([]);
  await card(page, 'shared-workshop').locator(hook('open')).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const detail = await new AxeBuilder({ page })
    .include('dialog[open]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(conciseViolations(detail.violations)).toEqual([]);
});

test('sert le chemin exact avec slash et préserve les 404 des routes inconnues', async ({
  page
}) => {
  await page.goto(base + '/');
  await expect(page.locator('[data-og7="activity-hub"]')).toBeVisible();
  await expect(page.locator(hook('dashboard'))).toBeVisible();
  for (const path of [
    `${base}/inconnu`,
    `${base}-inconnu`,
    `${base}/resources`,
    `${base}.json`
  ]) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(404);
  }
});
