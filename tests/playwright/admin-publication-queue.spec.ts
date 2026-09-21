import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  AdminPublicationBatchRecord,
  AdminPublicationDraftRecord,
  AdminPublicationSlotRecord
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const timestamp = '2030-06-01T14:00:00Z';
const batch = (
  id: string,
  scheduledAt: string | null,
  status: AdminPublicationBatchRecord['status'] = 'scheduled'
): AdminPublicationBatchRecord => ({
  id,
  channel: id === 'first' ? 'linkedin' : 'facebook',
  capacity: 5,
  status,
  slotId: id === 'first' ? 'slot-first' : null,
  scheduledAt,
  publishedAt: status === 'published' ? timestamp : null,
  notes: null,
  assignedDraftIds: id === 'first' ? ['draft-first'] : [],
  capacityUsed: id === 'first' ? 3 : 0,
  capacityAvailable: id === 'first' ? 2 : 5,
  createdAt: timestamp,
  updatedAt: timestamp
});
const batches = [
  batch('undated', null, 'open'),
  batch('third', '2030-06-05T14:00:00Z'),
  batch('published', '2030-06-01T14:00:00Z', 'published'),
  batch('second', '2030-06-04T14:00:00Z'),
  batch('first', '2030-06-03T14:00:00Z'),
  batch('cancelled', '2030-06-01T14:00:00Z', 'cancelled'),
  batch('fourth', '2030-06-06T14:00:00Z'),
  batch('invalid-date', 'invalid', 'scheduled')
];
const draft: AdminPublicationDraftRecord = {
  id: 'draft-first',
  contribution_id: 'contribution-first',
  sponsor_company_name: 'Atelier Boréal',
  sponsor_website_url: null,
  sponsor_logo_url: null,
  sponsor_public_summary: null,
  feed_target: 'openg20',
  channel: 'linkedin',
  title: 'Titre initial',
  body: 'Publication de démonstration',
  disclosure_text: 'Commandite',
  status: 'scheduled',
  public_url: null,
  scheduled_at: '2030-06-03T14:00:00Z',
  approved_at: timestamp,
  published_at: null,
  review_note: null,
  batch_id: 'first',
  slot_id: 'slot-first',
  created_at: timestamp,
  updated_at: timestamp
};
const slot: AdminPublicationSlotRecord = {
  id: 'slot-first',
  feedTarget: 'openg20',
  channel: 'linkedin',
  startsAt: '2030-06-03T14:00:00Z',
  timezone: 'Europe/Paris',
  capacity: 5,
  status: 'scheduled',
  notes: null,
  assignedBatchIds: ['first'],
  assignedDraftIds: ['draft-first'],
  capacityUsed: 3,
  capacityAvailable: 2,
  createdAt: timestamp,
  updatedAt: timestamp
};

async function fixtures(
  page: Page,
  records = batches,
  draftRecords = [draft]
): Promise<string[]> {
  const mutations: string[] = [];
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      'openg7-admin-session.ui-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  });
  await page.route('**/api/**', async (route) => {
    if (route.request().method() !== 'GET') {
      mutations.push(route.request().url());
      return route.fulfill({ status: 405, json: {} });
    }
    const pathname = new URL(route.request().url()).pathname;
    const responses: Record<string, unknown> = {
      '/api/admin/publication-batches': { batches: records },
      '/api/admin/publication-drafts': { drafts: draftRecords },
      '/api/admin/publication-slots': { slots: [slot] },
      '/api/admin/sponsorships': { sponsorships: [] },
      '/api/admin/social-publication-jobs': {
        jobs: [],
        mode: 'disabled',
        configuredChannels: []
      }
    };
    return route.fulfill({
      status: pathname in responses ? 200 : 503,
      json: responses[pathname] ?? {}
    });
  });
  return mutations;
}

async function openSpace(
  page: Page,
  space: 'overview' | 'drafts' | 'batches' | 'calendar'
): Promise<void> {
  const drawer = page.locator('[data-og7="admin-drawer"][open]');
  if (await drawer.count()) await drawer.getByRole('button').first().click();
  const home = page.locator('[data-og7="publications-home"]');
  if (await home.count()) await home.click();
  if (space !== 'overview')
    await page
      .locator('[data-og7="publication-space"][data-og7-id="' + space + '"]')
      .click();
  await expect(page.locator('[data-og7="publications-page"]')).toHaveAttribute(
    'data-og7-view',
    space
  );
}

test('orders active batches across channels and shows capacity, members and the slot timezone', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser/publications');
  const queue = page.locator('[data-og7="publication-queue"]');
  const cards = queue.locator('[data-og7="publication-queue-card"]');
  await expect(cards).toHaveCount(6);
  expect(
    await cards.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-og7-id'))
    )
  ).toEqual(['first', 'second', 'third', 'fourth', 'invalid-date', 'undated']);
  await expect(cards.first()).toContainText('Prochain lot');
  await expect(cards.first()).toContainText('OpenG20');
  await expect(cards.first()).toContainText('3 / 5 commandites');
  await expect(cards.first()).toContainText('Atelier Boréal');
  await expect(cards.first()).toContainText('+ 2 à consulter dans le détail');
  await expect(cards.first()).toContainText('Europe/Paris');
  await expect(cards.first().locator('time')).toHaveText(/16[\s\S]*00/);
  await expect(cards.last()).toContainText('Date à définir');
  await expect(queue.getByRole('status')).toHaveText(
    '4 lot(s) planifié(s) · 2 à planifier'
  );
  // Draft filters live in their own workspace and do not change the overview.
  await openSpace(page, 'drafts');
  await page.getByRole('searchbox').fill('Unrelated draft search');
  await openSpace(page, 'overview');
  await expect(cards).toHaveCount(6);
});

test('supports keyboard navigation, reduced motion and opening details without losing edits', async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const mutations = await fixtures(page);
  await page.goto('/admin/fundraiser/publications');
  const queue = page.locator('[data-og7="publication-queue"]');
  const viewport = page.locator('#publication-queue-viewport');
  const previous = queue.getByRole('button', {
    name: 'Voir les lots précédents'
  });
  const next = queue.getByRole('button', { name: 'Voir les lots suivants' });
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await viewport.focus();
  await viewport.press('ArrowRight');
  await expect(previous).toBeEnabled();
  await viewport.press('End');
  await expect(next).toBeDisabled();
  await viewport.press('Home');
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(previous).toBeDisabled();
  await expect(viewport).toHaveCSS('scroll-behavior', 'auto');

  await openSpace(page, 'drafts');
  await page
    .locator('#attention-object-draft-first')
    .getByRole('button', { name: 'Ouvrir' })
    .click();
  const title = page
    .locator('#attention-object-draft-first')
    .getByLabel('Titre', { exact: true });
  await title.fill('Texte non enregistré à préserver');
  await openSpace(page, 'overview');
  await queue.getByRole('button', { name: 'Voir le lot 1 — LinkedIn' }).click();
  await expect(page.locator('#attention-object-first')).toBeFocused();
  await expect(page).toHaveURL(/\/publications\/batches$/);
  await openSpace(page, 'drafts');
  await expect(title).toHaveValue('Texte non enregistré à préserver');
  expect(mutations).toEqual([]);
});

test('fits mobile, scrolls to later batches and has accessible controls in both languages', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixtures(page);
  await page.goto('/admin/fundraiser/publications');
  const queue = page.locator('[data-og7="publication-queue"]');
  await expect(
    queue.getByRole('heading', { name: 'Les prochains lots' })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  const viewport = page.locator('#publication-queue-viewport');
  await viewport.scrollIntoViewIfNeeded();
  await viewport.evaluate((element) =>
    element.scrollTo({ left: element.scrollWidth })
  );
  await expect(
    queue.getByRole('button', { name: 'Voir les lots suivants' })
  ).toBeDisabled();
  await expect(
    queue.getByRole('button', { name: 'Voir le lot 6 — Facebook' })
  ).toBeInViewport();
  await viewport.evaluate((element) => element.scrollTo({ left: 0 }));
  const accessibility = await new AxeBuilder({ page })
    .include('[data-og7="publication-queue"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await queue.screenshot({
    path: testInfo.outputPath('publication-queue-mobile.png')
  });

  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(
    queue.getByRole('heading', { name: 'Upcoming batches' })
  ).toBeVisible();
  await expect(
    queue.getByRole('button', { name: 'View batch 1 — LinkedIn' })
  ).toBeVisible();
  await expect(queue).not.toContainText('admin.publicationQueue');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await queue.screenshot({
    path: testInfo.outputPath('publication-queue-desktop.png')
  });
});

test('announces loading then an empty queue when only completed batches remain', async ({
  page
}) => {
  await fixtures(
    page,
    batches.filter(
      (item) => item.status === 'published' || item.status === 'cancelled'
    )
  );
  let release!: () => void;
  const loaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/admin/publication-batches', async (route) => {
    await loaded;
    await route.fallback();
  });
  await page.goto('/admin/fundraiser/publications');
  const queue = page.locator('[data-og7="publication-queue"]');
  await expect(queue.getByRole('status')).toHaveText(
    'Chargement des prochains lots…'
  );
  release();
  await expect(queue.getByRole('status')).toContainText('Aucun lot à venir');
  await expect(
    queue.getByRole('button', { name: 'Voir les lots suivants' })
  ).toHaveCount(0);
  await expect(
    queue.locator('[data-og7="publication-queue-card"]')
  ).toHaveCount(0);
});

test('recovers from a failed load and updates navigation when data changes', async ({
  page
}) => {
  await fixtures(page);
  await page.route('**/api/admin/publication-batches', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await page.goto('/admin/fundraiser/publications');
  const queue = page.locator('[data-og7="publication-queue"]');
  await expect(queue.getByRole('alert')).toContainText('indisponible');
  await page.unroute('**/api/admin/publication-batches');
  await queue.getByRole('button', { name: 'Réessayer' }).click();
  await expect(
    queue.locator('[data-og7="publication-queue-card"]')
  ).toHaveCount(6);
  await expect(
    queue.getByRole('button', { name: 'Voir les lots suivants' })
  ).toBeEnabled();
  await page.route('**/api/admin/publication-batches', (route) =>
    route.fulfill({ json: { batches: [batch('only', null, 'open')] } })
  );
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(
    queue.locator('[data-og7="publication-queue-card"]')
  ).toHaveCount(1);
  await expect(
    queue.getByRole('button', { name: 'Voir les lots suivants' })
  ).toBeDisabled();
  await expect(queue.getByText('Prochain lot', { exact: true })).toHaveCount(0);
});

test('opens on a compact hub with three distinct pages and keyboard links', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await fixtures(page);
  await page.goto('/admin/fundraiser/publications');
  const main = page.locator('[data-og7="publications-page"]');
  await expect(
    page.getByRole('heading', { name: 'Publications', exact: true })
  ).toBeVisible();
  await expect(main.locator('input, textarea, select')).toHaveCount(0);
  await expect(main.getByRole('tablist')).toHaveCount(0);
  await expect(main.locator('[data-og7="publication-space"]')).toHaveCount(3);
  await page.screenshot({
    path: testInfo.outputPath('publications-overview-desktop.png')
  });
  const writing = page.locator(
    '[data-og7="publication-space"][data-og7-id="drafts"]'
  );
  await writing.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/publications\/drafts$/);
  await expect(main.locator('h1')).toBeFocused();
  await expect(main.locator('h1')).toHaveText('R\u00e9daction et validation');
  await expect(main.locator('textarea')).toHaveCount(0);
  await expect(main.locator('[data-og7="publication-queue"]')).toHaveCount(0);
  await expect(
    main.locator(
      '[data-og7="publication-batch"], [data-og7="publication-slot"]'
    )
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Préparer une publication', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Commandites pretes' })
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await openSpace(page, 'overview');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('publications-overview-mobile.png'),
    fullPage: true
  });
});

test('shows one editor at a time and preserves other unsaved drafts through a save and refresh', async ({
  page
}) => {
  const second = {
    ...draft,
    id: 'draft-second',
    sponsor_company_name: 'Atelier Rivage',
    status: 'draft' as const,
    batch_id: null,
    slot_id: null,
    scheduled_at: null
  };
  const records = [draft, second];
  await fixtures(page, batches, records);
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/admin/publication-drafts/update', async (route) => {
    const payload = route.request().postDataJSON();
    writes.push(payload);
    records[1] = { ...second, title: payload.title };
    await route.fulfill({ json: { updated: true, draft: records[1] } });
  });
  await page.goto('/admin/fundraiser/publications');
  await openSpace(page, 'drafts');
  const first = page.locator(
    '[data-og7="publication-draft"][data-og7-id="draft-first"]'
  );
  const other = page.locator(
    '[data-og7="publication-draft"][data-og7-id="draft-second"]'
  );
  await first.getByRole('button', { name: 'Ouvrir' }).click();
  await first
    .getByLabel('Titre', { exact: true })
    .fill('Texte encore en cours');
  await expect(first.getByText('Modifications non enregistrées')).toBeVisible();
  await expect(
    first.getByLabel('URL publique', { exact: true })
  ).not.toBeVisible();
  await other.getByRole('button', { name: 'Ouvrir' }).click();
  await expect(first.getByLabel('Titre', { exact: true })).toHaveCount(0);
  await other.getByLabel('Titre', { exact: true }).fill('Texte prêt');
  await other.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Brouillon enregistré.' })
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]?.title).toBe('Texte prêt');
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Actualiser', exact: true })
  ).toBeEnabled();
  await first.getByRole('button', { name: 'Ouvrir' }).click();
  await expect(first.getByLabel('Titre', { exact: true })).toHaveValue(
    'Texte encore en cours'
  );
  await expect(first.getByText('Modifications non enregistrées')).toBeVisible();
  await first.getByRole('button', { name: 'Fermer' }).click();
  await expect(first.getByRole('button', { name: 'Ouvrir' })).toBeFocused();
});

test('reveals creation, history and secondary publication actions only on request', async ({
  page
}) => {
  const mutations = await fixtures(page);
  await page.goto('/admin/fundraiser/publications');
  await openSpace(page, 'batches');
  await expect(page.locator('#new-batch-form')).toHaveCount(0);
  await expect(
    page.locator('[data-og7="calendar-entry"][data-og7-id="published"]')
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Nouveau lot' }).click();
  await expect(
    page.locator('#new-batch-form').getByLabel('Canal')
  ).toBeVisible();
  await page.getByLabel('Inclure les éléments publiés et annulés').check();
  await expect(
    page.locator('[data-og7="calendar-entry"][data-og7-id="published"]')
  ).toBeVisible();
  const first = page.locator(
    '[data-og7="publication-batch"][data-og7-id="first"]'
  );
  await page
    .locator('[data-og7="calendar-entry"][data-og7-id="first"]')
    .click();
  await expect(
    first.getByRole('button', { name: 'Marquer comme publiée manuellement' })
  ).not.toBeVisible();
  await first.getByText('Autres actions', { exact: true }).click();
  await first
    .getByRole('button', { name: 'Marquer comme publiée manuellement' })
    .click();
  await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
  expect(mutations).toEqual([]);
  await page.keyboard.press('Escape');
  await openSpace(page, 'calendar');
  await expect(page.locator('#new-slot-form')).toHaveCount(0);
  await page.getByRole('button', { name: 'Nouveau créneau' }).click();
  await expect(
    page.locator('#new-slot-form').getByLabel('Date et heure')
  ).toBeVisible();
});

test('keeps all workspaces accessible in French and English on mobile', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtures(page);
  await page.goto('/admin/fundraiser/publications');
  for (const language of ['fr', 'en']) {
    if (language === 'en')
      await page
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
    for (const view of ['overview', 'drafts', 'batches', 'calendar'] as const) {
      await openSpace(page, view);
      if (view === 'drafts' && language === 'fr')
        await page
          .locator('[data-og7="publication-draft"]')
          .first()
          .getByRole('button', {
            name: language === 'fr' ? 'Ouvrir' : 'Open',
            exact: true
          })
          .click();
      const result = await new AxeBuilder({ page })
        .include('[data-og7="publications-page"]')
        .analyze();
      expect(result.violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
      await expect(
        page.locator('[data-og7="publications-page"]')
      ).not.toContainText('admin.publications.');
    }
  }
});

test('restores the page and unsaved content through browser back and forward without reloading data', async ({
  page
}) => {
  await fixtures(page);
  const reads: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().includes('/api/admin/publication-') &&
      request.method() === 'GET'
    )
      reads.push(request.url());
  });
  await page.goto('/admin/fundraiser/publications/drafts');
  const draftCard = page.locator('#attention-object-draft-first');
  await draftCard.getByRole('button', { name: 'Ouvrir' }).click();
  await draftCard
    .getByLabel('Titre', { exact: true })
    .fill('Texte à conserver');
  await openSpace(page, 'calendar');
  await expect(page).toHaveURL(/\/publications\/calendar$/);
  await page.goBack();
  await expect(page.locator('h1')).toHaveText('Publications');
  await page.goBack();
  await expect(page).toHaveURL(/\/publications\/drafts$/);
  await expect(draftCard.getByLabel('Titre', { exact: true })).toHaveValue(
    'Texte à conserver'
  );
  await page.goForward();
  await page.goForward();
  await expect(page.locator('h1')).toHaveText('Calendrier éditorial');
  expect(reads).toHaveLength(3);
});

test('opens and refreshes each dedicated URL and rejects unknown publication pages', async ({
  page,
  request
}) => {
  await fixtures(page);
  for (const [space, title] of [
    ['drafts', 'Rédaction et validation'],
    ['batches', 'Lots de publication'],
    ['calendar', 'Calendrier éditorial']
  ]) {
    const response = await page.goto('/admin/fundraiser/publications/' + space);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText(title!);
    await page.reload();
    await expect(page.locator('h1')).toHaveText(title!);
    await expect(page.locator('[data-og7="publications-home"]')).toBeVisible();
    await expect(page.locator('[data-og7="publication-queue"]')).toHaveCount(0);
    await expect(
      page.locator('[data-og7="publications-page"]')
    ).not.toContainText('admin.publications.');
  }
  expect(
    (await request.get('/admin/fundraiser/publications/unknown')).status()
  ).toBe(404);
  expect(
    (
      await request.get('/admin/fundraiser/publications/drafts/unknown')
    ).status()
  ).toBe(404);
});

test('requires an admin session when opening a dedicated publication page', async ({
  page
}) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 401, json: {} })
  );
  await page.goto('/admin/fundraiser/publications/calendar');
  await expect(page).toHaveURL(/\/admin\/login\?returnUrl=/);
  expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(
    '/admin/fundraiser/publications/calendar'
  );
  await expect(page.locator('[data-og7="publications-page"]')).toHaveCount(0);
});

test('calendar places batches by Toronto date, navigates months and filters channels', async ({
  page
}, testInfo) => {
  await page.clock.setFixedTime(new Date('2030-06-01T12:00:00Z'));
  await page.setViewportSize({ width: 1600, height: 1200 });
  const mutations = await fixtures(page, [
    ...batches,
    batch('late-night', '2030-06-04T02:00:00Z')
  ]);
  await page.goto('/admin/fundraiser/publications/batches');
  const calendar = page.locator('[data-og7="publication-calendar"]');
  await expect(page.locator('[data-og7="calendar-month"]')).toHaveText(
    'juin 2030'
  );
  await expect(calendar.locator('[data-og7-date]')).toHaveCount(42);
  const monday = calendar.locator('[data-og7-date="2030-06-03"]');
  await expect(monday.locator('[data-og7="calendar-entry"]')).toHaveCount(2);
  await expect(monday.locator('[data-og7-id="first"]')).toContainText(
    /10\s*h\s*00/
  );
  await expect(monday.locator('[data-og7-id="late-night"]')).toContainText(
    /22\s*h\s*00/
  );
  await expect(calendar).toContainText('America/Toronto');
  await expect(
    calendar.locator('[data-og7="calendar-undated-entry"]')
  ).toHaveCount(2);
  await expect(page.locator('[data-og7="publication-batch"]')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('publication-calendar-desktop.png'),
    fullPage: true
  });

  await calendar.getByRole('button', { name: 'LinkedIn', exact: true }).click();
  await expect(calendar.locator('[data-og7="calendar-entry"]')).toHaveCount(1);
  await calendar
    .getByRole('button', { name: 'Tous les canaux', exact: true })
    .click();
  await calendar.getByRole('button', { name: 'Mois suivant' }).click();
  await expect(page.locator('[data-og7="calendar-month"]')).toHaveText(
    'juillet 2030'
  );
  await expect(calendar.getByRole('status')).toContainText(
    'Aucune publication'
  );
  await calendar.getByRole('button', { name: 'Mois précédent' }).click();
  await calendar.getByLabel('Choisir un mois').fill('2030-12');
  await calendar.getByRole('button', { name: 'Mois suivant' }).click();
  await expect(page.locator('[data-og7="calendar-month"]')).toHaveText(
    'janvier 2031'
  );
  await calendar.getByRole('button', { name: 'Aujourd’hui' }).click();
  await expect(page.locator('#publication-day-2030-06-01')).toHaveAttribute(
    'aria-current',
    'date'
  );
  expect(mutations).toEqual([]);
});

test('calendar expands busy days and opens a single detail drawer with restored focus', async ({
  page
}, testInfo) => {
  const extra = Array.from({ length: 4 }, (_, index) =>
    batch('extra-' + index, `2030-06-03T${15 + index}:00:00Z`)
  );
  const mutations = await fixtures(page, [...batches, ...extra]);
  await page.goto('/admin/fundraiser/publications/batches');
  const monday = page.locator('[data-og7-date="2030-06-03"]');
  await expect(monday.locator('[data-og7="calendar-entry"]')).toHaveCount(3);
  await monday.getByRole('button', { name: '+ 2 autres' }).click();
  await expect(page.locator('#publication-day-agenda')).toBeFocused();
  await expect(page.locator('[data-og7="calendar-agenda-entry"]')).toHaveCount(
    5
  );
  const opener = page.locator(
    '[data-og7="calendar-agenda-entry"][data-og7-id="extra-3"]'
  );
  await opener.click();
  const drawer = page.getByRole('dialog', { name: 'Détail du lot' });
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('[data-og7-id="extra-3"]')).toBeVisible();
  await expect(page.locator('[data-og7="publication-batch"]')).toHaveCount(1);
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-og7="admin-drawer"][open]')
        .analyze()
    ).violations
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('publication-calendar-detail.png')
  });
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await expect(opener).toBeFocused();
  expect(mutations).toEqual([]);
});

test('calendar supports keyboard dates, mobile day agenda and English without overflow', async ({
  page
}, testInfo) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser/publications/batches');
  await page.getByLabel('Choisir un mois').fill('2030-12');
  await page.locator('#publication-day-2030-12-31').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#publication-day-2031-01-01')).toBeFocused();
  await expect(page.locator('[data-og7="calendar-month"]')).toHaveText(
    'janvier 2031'
  );
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#publication-day-2030-12-25')).toBeFocused();
  await page.getByLabel('Choisir un mois').fill('2030-06');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#publication-day-2030-06-03').click();
  await expect(
    page.locator('[data-og7="calendar-agenda-entry"][data-og7-id="first"]')
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('publication-calendar-mobile.png'),
    fullPage: true
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-og7="publications-page"]')
        .analyze()
    ).violations
  ).toEqual([]);
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(page.locator('[data-og7="calendar-month"]')).toHaveText(
    'June 2030'
  );
  await expect(
    page.getByRole('button', { name: 'Previous month' })
  ).toBeVisible();
  await expect(
    page.locator('[data-og7="publication-calendar"]')
  ).not.toContainText('admin.publicationCalendar.');
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-og7="publications-page"]')
        .analyze()
    ).violations
  ).toEqual([]);
});

test('editorial calendar opens slot assignments and calendar failures can be retried', async ({
  page
}) => {
  const mutations = await fixtures(page);
  await page.route('**/api/admin/publication-slots', (route) =>
    route.fulfill({ status: 503, json: {} })
  );
  await page.goto('/admin/fundraiser/publications/calendar');
  const calendar = page.locator('[data-og7="publication-calendar"]');
  await expect(calendar.getByRole('alert')).toContainText('indisponible');
  await page.unroute('**/api/admin/publication-slots');
  await calendar.getByRole('button', { name: 'Réessayer' }).click();
  await calendar
    .locator('[data-og7="calendar-entry"][data-og7-id="slot-first"]')
    .click();
  const drawer = page.getByRole('dialog', { name: 'Détail du créneau' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Europe/Paris');
  await expect(drawer).toContainText(/16\s*h\s*00/);
  await expect(
    drawer.getByRole('button', { name: 'Assigner le lot', exact: true })
  ).toBeDisabled();
  await drawer.getByRole('button', { name: 'Fermer', exact: true }).click();
  expect(mutations).toEqual([]);
});

test('calendar moves a batch only after a confirmed schedule and keeps failed changes retryable in the drawer', async ({
  page
}) => {
  const records = [batch('moving', '2030-06-03T14:00:00Z')];
  await fixtures(page, records);
  let attempts = 0;
  await page.route(
    '**/api/admin/publication-batches/schedule',
    async (route) => {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 503, json: {} });
      const payload = route.request().postDataJSON();
      records[0] = {
        ...records[0]!,
        scheduledAt: payload.scheduledAt,
        status: 'scheduled'
      };
      return route.fulfill({ json: { updated: true, batch: records[0] } });
    }
  );
  await page.goto('/admin/fundraiser/publications/batches');
  await page
    .locator('[data-og7="calendar-entry"][data-og7-id="moving"]')
    .click();
  const drawer = page.getByRole('dialog', { name: 'Détail du lot' });
  await drawer.locator('input[type="datetime-local"]').fill('2030-07-15T12:00');
  await drawer.getByRole('button', { name: 'Planifier', exact: true }).click();
  await expect(drawer.getByRole('alert')).toBeVisible();
  await expect(page.locator('[data-og7="calendar-month"]')).toHaveText(
    'juin 2030'
  );
  await expect(drawer.locator('input[type="datetime-local"]')).toHaveValue(
    '2030-07-15T12:00'
  );
  await drawer.getByRole('button', { name: 'Planifier', exact: true }).click();
  await expect(drawer.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-og7="calendar-month"]')).toHaveText(
    'juillet 2030'
  );
  await drawer.getByRole('button', { name: 'Fermer', exact: true }).click();
  await expect(
    page.locator('[data-og7-date="2030-07-15"] [data-og7-id="moving"]')
  ).toBeVisible();
  expect(attempts).toBe(2);
});
