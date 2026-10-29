import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from './support/test.js';

const hook = (name: string) => `[data-og7="activity-hub-${name}"]`;
const apiCalls = new WeakMap<Page, string[]>();
const browserErrors = new WeakMap<Page, string[]>();
const rows = (page: Page) => page.locator(hook('activity-row'));
const activity = (page: Page, id: string) =>
  page.locator(`${hook('activity-row')}[data-og7-id="${id}"]`);
const metric = (page: Page, id: string) =>
  page.locator(`${hook('metric')}[data-og7-id="${id}"]`);

async function goSection(page: Page, id: string): Promise<void> {
  const destination = page.locator(`${hook('section')}[data-og7-id="${id}"]`);
  if (!(await destination.isVisible()))
    await page.locator(`${hook('explore')} > summary`).click();
  await destination.click();
}

async function scenario(page: Page, value: string): Promise<void> {
  const select = page.locator(hook('scenario'));
  if (!(await select.isVisible()))
    await page.locator(`${hook('scenarios')} > summary`).click();
  await select.selectOption(value);
}

async function uniqueEntityCount(page: Page): Promise<number> {
  return rows(page).evaluateAll(
    (elements) =>
      new Set(elements.map((element) => element.getAttribute('data-entity-id')))
        .size
  );
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
  await page.goto('/demo/actualites');
  await expect(page.locator(hook('dashboard'))).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(
    apiCalls.get(page),
    'no real administrative API may be requested'
  ).toEqual([]);
  expect(
    browserErrors.get(page),
    'new surfaces must not raise runtime errors'
  ).toEqual([]);
});

test('filtre le journal par période, type, origine, recherche et attention', async ({
  page
}) => {
  await goSection(page, 'journal');
  const period = page.locator(hook('activity-period'));
  const kind = page.locator(hook('activity-kind'));
  const origin = page.locator(hook('activity-origin'));
  const query = page.locator(hook('activity-search'));
  await expect(period).toHaveValue('week');
  await expect(rows(page)).toHaveCount(10);
  await period.selectOption('today');
  await expect(rows(page)).toHaveCount(4);
  await period.selectOption('all');
  await expect(rows(page)).toHaveCount(11);

  await kind.selectOption('media');
  await expect(rows(page)).toHaveCount(4);
  await origin.selectOption('human');
  await expect(rows(page)).toHaveCount(2);
  await page.locator(hook('activity-attention')).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator(hook('activity-empty'))).toBeVisible();
  await page.locator(hook('activity-reset')).click();
  await expect(period).toHaveValue('week');
  await expect(kind).toHaveValue('all');
  await expect(origin).toHaveValue('all');
  await expect(rows(page)).toHaveCount(10);

  await query.fill('DEMO-MEDIA-BOREAL-01');
  await expect(rows(page)).toHaveCount(2);
  await query.fill('');
  const opener = activity(page, 'activity-preparation-rivages-28').locator(
    hook('activity-open')
  );
  const title = await opener.innerText();
  await query.fill(
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
  );
  await expect(rows(page)).toHaveCount(1);
  await expect(activity(page, 'activity-preparation-rivages-28')).toBeVisible();
  await page.locator(hook('activity-reset')).click();
  await page.locator(hook('activity-attention')).click();
  await expect(rows(page)).toHaveCount(5);
});

test('ouvre un événement filtré avec sa provenance, un dossier de démo et son guide contextuel', async ({
  page
}) => {
  await goSection(page, 'journal');
  await page.locator(hook('activity-period')).selectOption('today');
  await page.locator(hook('activity-kind')).selectOption('ready');
  await expect(rows(page)).toHaveCount(1);
  const opener = activity(page, 'activity-ready-boreal-28').locator(
    hook('activity-open')
  );
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  const detail = dialog.locator(hook('activity-detail'));
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('DEMO-DOSSIER-BOREAL');
  await expect(detail).toContainText(/ficti[fv]|démonstration/i);
  await expect(detail.locator('time')).toHaveAttribute(
    'datetime',
    '2026-10-28T13:12:00Z'
  );
  await expect(detail.locator(hook('activity-dossier'))).toHaveAttribute(
    'href',
    '/demo/prestations/dossier/atelier-boreal'
  );
  const hrefs = await detail
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  for (const href of hrefs)
    expect(href).toMatch(
      /^\/demo\/prestations\/dossier\/(atelier-boreal|collectif-rivages|studio-canopée)(?:\/|$)/
    );

  await detail.locator(hook('activity-guide')).click();
  await expect(dialog.locator(hook('detail'))).toHaveAttribute(
    'data-og7-id',
    'guide-services'
  );
  await dialog.locator(hook('back-activity')).click();
  await expect(detail).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await expect(page.locator(hook('activity-period'))).toHaveValue('today');
  await expect(page.locator(hook('activity-kind'))).toHaveValue('ready');
});

test('ouvre les entités uniques qui composent chacun des quatre compteurs de la semaine', async ({
  page
}) => {
  for (const [kind, count] of [
    ['ready', 3],
    ['media', 3],
    ['rules', 2],
    ['preparation', 1]
  ] as const) {
    if (!(await page.locator(hook('dashboard')).isVisible()))
      await goSection(page, 'overview');
    await expect(metric(page, kind).locator('strong')).toHaveText(
      String(count)
    );
    await metric(page, kind).click();
    await expect(page.locator(hook('activity-period'))).toHaveValue('week');
    await expect(page.locator(hook('activity-kind'))).toHaveValue(kind);
    await expect(page.locator(hook('activity-kind'))).toBeDisabled();
    await expect(rows(page)).toHaveCount(count);
    expect(await uniqueEntityCount(page)).toBe(count);
  }

  await goSection(page, 'overview');
  await metric(page, 'media').click();
  await expect(activity(page, 'activity-media-boreal-28')).toBeVisible();
  await expect(activity(page, 'activity-media-boreal-27')).toHaveCount(0);
  // Origin applies after choosing the latest event per entity. An earlier
  // human event must not reappear when its latest event is automatic.
  await page.locator(hook('activity-origin')).selectOption('human');
  await expect(rows(page)).toHaveCount(1);
  await expect(activity(page, 'activity-media-canopee-26')).toBeVisible();
});

test('compose Mon briefing avec une date de visite simulée, les lectures et les favoris non lus', async ({
  page
}) => {
  await page.locator(hook('browse')).click();
  const workshop = page.locator(
    `${hook('card')}[data-og7-id="shared-workshop"]`
  );
  await workshop.locator(hook('save')).click();
  await goSection(page, 'briefing');
  const briefing = page.locator(hook('briefing'));
  const visit = page.locator(hook('visit'));
  const counts = page.locator(hook('briefing-counts')).locator('dd');
  await expect(briefing).toHaveAttribute('data-og7-id', 'morning');
  await expect(visit).toHaveValue('morning');
  await expect(counts).toHaveText(['0', '14', '14']);
  await expect(briefing.getByRole('status')).toContainText(/\b7\b/);
  await expect(page.locator(hook('briefing-open'))).toHaveCount(3);
  await expect(page.locator(hook('briefing-guide'))).toHaveCount(4);
  await visit.selectOption('current');
  await expect(page.locator(hook('briefing-new-empty'))).toBeVisible();
  await expect(page.locator(hook('briefing-open'))).toHaveCount(0);
  await visit.selectOption('previous-day');
  await expect(briefing.getByRole('status')).toContainText(/\b11\b/);
  await visit.selectOption('morning');

  const saved = page.locator(
    `${hook('briefing-saved-open')}[data-og7-id="shared-workshop"]`
  );
  await expect(saved).toBeVisible();
  await saved.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator(hook('briefing-saved-open'))).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#admin-main')).toBeFocused();
  await expect(counts).toHaveText(['1', '14', '13']);
  await expect(briefing.getByRole('status')).toContainText(/\b6\b/);
  await expect(page.locator(hook('briefing-saved-empty'))).toBeVisible();
  await goSection(page, 'saved');
  await expect(workshop).toBeVisible();
  await expect(workshop.locator(hook('save'))).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('distingue vide, chargement, données partielles et indisponibilité sans inventer un zéro', async ({
  page
}) => {
  const status = page.locator(hook('data-status'));
  await expect(status).toHaveAttribute('role', 'status');
  await expect(page.locator(hook('last-refresh'))).toHaveAttribute(
    'datetime',
    '2026-10-28T18:15:00Z'
  );
  await scenario(page, 'empty');
  for (const kind of ['ready', 'media', 'rules', 'preparation'])
    await expect(metric(page, kind).locator('strong')).toHaveText('0');
  await goSection(page, 'journal');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator(hook('activity-empty'))).toBeVisible();

  await scenario(page, 'normal');
  await page.locator(hook('activity-kind')).selectOption('rules');
  await page.locator(hook('activity-origin')).selectOption('human');
  await expect(rows(page)).toHaveCount(1);
  await scenario(page, 'partial');
  await expect(page.locator(hook('activity-kind'))).toHaveValue('rules');
  await expect(page.locator(hook('activity-origin'))).toHaveValue('human');
  await expect(rows(page)).toHaveCount(1);
  const journal = page.getByRole('region', {
    name: 'Journal de l’activité',
    exact: true
  });
  await page.locator(hook('activity-kind')).selectOption('media');
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator(hook('activity-unavailable'))).toBeVisible();
  await expect(page.locator(hook('activity-empty'))).toHaveCount(0);
  await expect(journal).not.toContainText(
    /\b0\s+(?:événements|éléments|entités)/
  );
  await page.locator(hook('activity-kind')).selectOption('all');
  await page.locator(hook('activity-origin')).selectOption('all');
  await expect(rows(page)).toHaveCount(6);
  await expect(journal.getByRole('status').first()).toContainText(/disponibl/i);
  await goSection(page, 'overview');
  await expect(metric(page, 'media').locator('strong')).toHaveText(
    'Indisponible'
  );
  await expect(metric(page, 'ready').locator('strong')).toHaveText('3');
  await page.locator(hook('retry')).click();
  await expect(metric(page, 'media').locator('strong')).toHaveText('3');

  for (const state of ['loading', 'unavailable']) {
    await scenario(page, state);
    for (const kind of ['ready', 'media', 'rules', 'preparation'])
      await expect(metric(page, kind).locator('strong')).not.toHaveText('0');
    await expect(status).toContainText(
      state === 'loading' ? /chargement/i : /indisponible/i
    );
    await goSection(page, 'journal');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator(hook('activity-unavailable'))).toBeVisible();
    await expect(page.locator(hook('activity-empty'))).toHaveCount(0);
    await expect(journal).not.toContainText(
      /\b0\s+(?:événements|éléments|entités)/
    );
    await page.locator(hook('retry')).click();
    await goSection(page, 'overview');
    await expect(metric(page, 'ready').locator('strong')).toHaveText('3');
  }
  await scenario(page, 'unavailable');
  await goSection(page, 'briefing');
  await expect(page.locator(hook('briefing-open'))).toHaveCount(3);
  await expect(page.locator(hook('briefing-counts')).locator('dd')).toHaveText([
    '0',
    '14',
    '14'
  ]);
});

test('actualise une seule fois les activités, les compteurs et l’horodatage local', async ({
  page
}) => {
  await goSection(page, 'journal');
  await expect(rows(page)).toHaveCount(10);
  const refresh = page.locator(hook('refresh'));
  await refresh.evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(rows(page)).toHaveCount(11);
  await expect(activity(page, 'activity-media-canopee-refresh')).toBeVisible();
  await expect(refresh).toBeDisabled();
  await expect(page.locator(hook('last-refresh'))).toHaveAttribute(
    'datetime',
    '2026-10-28T18:30:00Z'
  );
  await goSection(page, 'overview');
  await expect(metric(page, 'media').locator('strong')).toHaveText('4');
  await metric(page, 'media').click();
  await expect(rows(page)).toHaveCount(4);
  expect(await uniqueEntityCount(page)).toBe(4);
  await page.reload();
  await expect(metric(page, 'media').locator('strong')).toHaveText('3');
  await expect(page.locator(hook('last-refresh'))).toHaveAttribute(
    'datetime',
    '2026-10-28T18:15:00Z'
  );
});

test('reste accessible au clavier et sans débordement sur les nouvelles surfaces FR et EN', async ({
  page
}, testInfo) => {
  for (const section of ['journal', 'briefing']) {
    await goSection(page, section);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1
        )
      )
      .toBe(true);
    const audit = await new AxeBuilder({ page })
      .include('[data-og7="activity-hub"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(conciseViolations(audit.violations)).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`activity-hub-${section}.png`),
      fullPage: true
    });
  }
  await page.locator(hook('language')).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator(hook('briefing'))).not.toContainText(
    'activityHubBriefing.'
  );
  await goSection(page, 'journal');
  await expect(page.locator(hook('activity-list'))).not.toContainText(
    'activityHubJournal.'
  );
  await activity(page, 'activity-ready-boreal-28')
    .locator(hook('activity-open'))
    .click();
  const audit = await new AxeBuilder({ page })
    .include('dialog[open]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(conciseViolations(audit.violations)).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('activity-hub-activity-detail-en.png'),
    fullPage: true
  });
  await page.keyboard.press('Escape');
});
