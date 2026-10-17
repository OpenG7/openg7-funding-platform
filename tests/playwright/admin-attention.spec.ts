import type { Page } from '@playwright/test';
import type {
  AdminAttentionItem,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import { dismissContributionToasts } from './support/contribution-toasts.js';
import {
  captureAdminDesign,
  expectAdminPageFits,
  prepareAdminDesignReview
} from './support/admin-design-review.js';

const emailId = '10000000-0000-4000-8000-000000000151';
const contributionId = '10000000-0000-4000-8000-000000000251';
const types = [
  'email_delivery_failed',
  'invoice_missing',
  'stripe_event_failed',
  'publication_slot_upcoming',
  'sponsorship_needs_review'
] as const;
const items: AdminAttentionItem[] = Array.from({ length: 126 }, (_, index) => {
  const type = types[index % types.length]!;
  const id = type === 'email_delivery_failed' ? emailId : contributionId;
  const adminUrl =
    type === 'email_delivery_failed'
      ? `/admin/fundraiser/email-queue?messageId=${id}`
      : type === 'invoice_missing'
        ? `/admin/fundraiser/invoices?contributionId=${id}`
        : type === 'stripe_event_failed'
          ? `/admin/fundraiser/attention?itemId=task-${index}`
          : type === 'publication_slot_upcoming'
            ? `/admin/fundraiser/publications?slotId=${id}`
            : `/admin/fundraiser/sponsors?sponsorshipId=${id}`;
  return {
    id: `task-${index}`,
    type,
    severity: type === 'stripe_event_failed' ? 'urgent' : 'today',
    title: 'Server text must use UI translation',
    explanation: 'Server explanation',
    adminUrl,
    emailQueueId: type === 'email_delivery_failed' ? emailId : undefined,
    detectedAt: '2026-09-15T14:00:00Z',
    facts: { reference: `DEMO-${index}` },
    suggestedActions: []
  };
});

function response(url: URL, source = items): AdminWorkQueueResponse {
  const filtered = source.filter(
    (item) =>
      (!url.searchParams.get('type') ||
        item.type === url.searchParams.get('type')) &&
      (!url.searchParams.get('priority') ||
        item.severity === url.searchParams.get('priority')) &&
      (!url.searchParams.get('itemId') ||
        item.id === url.searchParams.get('itemId'))
  );
  const pageSize = Number(url.searchParams.get('pageSize') || 25);
  const page = Math.min(
    Number(url.searchParams.get('page') || 1),
    Math.max(1, Math.ceil(filtered.length / pageSize))
  );
  return {
    available: true,
    coverage: 'complete',
    missingSources: [],
    generatedAt: '2026-09-15T14:00:00Z',
    timezone: 'America/Toronto',
    total: source.length,
    filteredTotal: filtered.length,
    todayTotal: source.length,
    counts: { urgent: 25, today: 101, this_week: 0, informational: 0 },
    typeCounts: {} as AdminWorkQueueResponse['typeCounts'],
    page,
    pageSize,
    items: filtered.slice((page - 1) * pageSize, page * pageSize)
  };
}

async function fixtures(page: Page): Promise<void> {
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
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/attention')
      return route.fulfill({ json: response(url) });
    if (url.pathname === '/api/admin/email-queue')
      return route.fulfill({
        json: {
          data_source: 'database',
          last_updated_at: '2026-09-15T14:00:00Z',
          summary: {
            queued_count: 0,
            sending_count: 0,
            sent_count: 0,
            failed_count: 1,
            retryable_count: 1,
            last_failed_at: null,
            last_error: null
          },
          messages: [
            {
              id: emailId,
              status: 'failed',
              template_key: 'sponsorship_invoice',
              recipient_email: 'demo@example.invalid',
              subject: 'Démonstration',
              attempts: 5,
              max_attempts: 5,
              next_attempt_at: null,
              sent_at: null,
              last_error: null,
              created_at: '2026-09-15T12:00:00Z',
              updated_at: '2026-09-15T12:00:00Z',
              metadata: {}
            }
          ]
        }
      });
    if (url.pathname === '/api/admin/sponsorship-invoices')
      return route.fulfill({
        json: {
          invoices: [],
          summary: {
            total_count: 0,
            total_amount: 0,
            credit_note_count: 0,
            total_credited: 0,
            failed_email_count: 0,
            currency: 'CAD'
          },
          last_updated_at: '2026-09-15T14:00:00Z'
        }
      });
    return route.fulfill({
      status: 503,
      json: { error: 'Unavailable fixture' }
    });
  });
}

const attentionPalettes = {
  mineral: {
    panel: 'rgb(255, 255, 255)',
    border: 'rgb(216, 224, 236)',
    text: 'rgb(23, 43, 80)',
    muted: 'rgb(82, 98, 123)',
    selected: 'rgb(237, 243, 250)',
    accent: 'rgb(54, 93, 136)',
    focus: 'rgb(53, 106, 159)'
  },
  night: {
    panel: 'rgb(20, 35, 56)',
    border: 'rgb(64, 86, 111)',
    text: 'rgb(241, 245, 252)',
    muted: 'rgb(189, 203, 224)',
    selected: 'rgb(36, 61, 83)',
    accent: 'rgb(158, 218, 255)',
    focus: 'rgb(158, 218, 255)'
  },
  graphite: {
    panel: 'rgb(37, 41, 47)',
    border: 'rgb(86, 97, 110)',
    text: 'rgb(243, 244, 246)',
    muted: 'rgb(196, 203, 213)',
    selected: 'rgb(56, 67, 79)',
    accent: 'rgb(176, 210, 235)',
    focus: 'rgb(194, 227, 255)'
  }
} as const;
type AttentionTheme = keyof typeof attentionPalettes;

async function styleFixtures(
  page: Page,
  language: string,
  width: number,
  theme: AttentionTheme
) {
  await fixtures(page);
  await page.setViewportSize({ width, height: 941 });
  await page.addInitScript(
    ({ language, theme }) => {
      localStorage.setItem('openg7.language', language);
      localStorage.setItem(
        'openg7.pilotage.appearance.v1',
        JSON.stringify({ theme, system: false, density: 'comfortable' })
      );
    },
    { language, theme }
  );
  const mutations: string[] = [];
  await page.route('**/api/**', (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fallback();
    mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    return route.fulfill({ status: 405, json: {} });
  });
  await page.goto('/admin/fundraiser/attention');
  const panel = page.locator('[data-og7="attention-panel"]');
  await expect(panel.locator('[data-og7-id="task-0"]')).toBeVisible();
  return { panel, mutations };
}

for (const language of ['fr-CA', 'en'] as const)
  for (const width of [390, 1536]) {
    test(`attention composition keeps filters and the current queue accessible in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await prepareAdminDesignReview(page);
      const { panel, mutations } = await styleFixtures(
        page,
        language,
        width,
        'mineral'
      );
      await page.setViewportSize({
        width,
        height: width === 1536 ? 864 : 1000
      });
      const task = panel.locator('[data-og7-id="task-0"]');
      const type = panel.locator('[data-og7="attention-type"]');
      const priority = panel.locator('[data-og7="attention-priority"]');
      const summary = panel.locator('[data-og7="attention-summary"]');
      await expect(summary.locator(':scope > div')).toHaveCount(4);
      await expect(summary.locator('[data-priority="urgent"] dd')).toHaveText(
        '25'
      );
      await expect(summary.locator('[data-priority="today"] dd')).toHaveText(
        '101'
      );
      await expect(panel.locator('[data-og7="attention-count"]')).toContainText(
        '126'
      );
      await captureAdminDesign(page, testInfo, `attention-${width}`);
      if (width === 1536) {
        await expect(type).toBeInViewport({ ratio: 1 });
        await expect(task).toBeInViewport({ ratio: 1 });
      }
      await type.focus();
      await page.keyboard.press('Tab');
      await expect(priority).toBeFocused();
      await type.selectOption('invoice_missing');
      await expect(panel.locator('[data-og7-id="task-1"]')).toBeVisible();
      await expect(task).toHaveCount(0);
      await expect(page).toHaveURL(/type=invoice_missing/);
      await page.reload();
      await expect(type).toHaveValue('invoice_missing');
      if (language === 'en') {
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
        });
        await expectAdminPageFits(page);
        await type.selectOption('');
        await expect(task).toBeVisible();
        await expectAdminPageFits(page);
      }
      expect(mutations).toEqual([]);
    });
  }

for (const theme of ['mineral', 'night', 'graphite'] as const) {
  for (const { language, width } of [
    { language: 'fr-CA', width: 390 },
    { language: 'en', width: 1280 }
  ]) {
    test(`attention styles retain ${theme} palettes and dimensions in ${language} at ${width}px`, async ({
      page
    }) => {
      const { panel, mutations } = await styleFixtures(
        page,
        language,
        width,
        theme
      );
      const palette = attentionPalettes[theme];
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('html')).toHaveAttribute(
        'data-og7-pilot-theme',
        theme
      );
      await expect(panel).toHaveCSS('background-color', palette.panel);
      await expect(panel).toHaveCSS('background-image', 'none');
      await expect(panel).toHaveCSS('color', palette.text);
      await expect(panel).toHaveCSS('border-top-color', palette.border);
      await expect(panel).toHaveCSS('border-top-width', '1px');
      const heading = panel.locator('header');
      const count = heading
        .getByRole('heading', { level: 2 })
        .getByText('126', { exact: true });
      await expect(count).toHaveCSS('background-color', palette.selected);
      await expect(count).toHaveCSS('color', palette.accent);
      const task = panel.locator('[data-og7-id="task-0"]');
      await expect(task.locator('p')).toHaveCSS('color', palette.muted);
      await expect(task.locator('small').first()).toHaveCSS(
        'color',
        palette.muted
      );
      await expect(task.locator('small').first()).toHaveCSS(
        'overflow-wrap',
        'anywhere'
      );
      const type = panel.locator('[data-og7="attention-type"]');
      for (const select of [
        type,
        panel.locator('[data-og7="attention-priority"]'),
        panel.locator('[data-og7="attention-due"]')
      ]) {
        await expect(select).toHaveCSS('background-color', palette.panel);
        await expect(select).toHaveCSS('color', palette.text);
        expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await type.focus();
      await expect(type).toHaveCSS('outline-style', 'solid');
      await expect(type).toHaveCSS('outline-width', '3px');
      await expect(type).toHaveCSS('outline-color', palette.focus);
      await page.keyboard.press('Tab');
      await expect(
        panel.locator('[data-og7="attention-priority"]')
      ).toBeFocused();
      const title = page.getByRole('main').getByRole('heading', { level: 1 });
      await expect(title).toHaveCSS('color', palette.text);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      expect(mutations).toEqual([]);
    });
  }
}

test('attention keeps its filters and task actions within resized content', async ({
  page
}) => {
  const { panel, mutations } = await styleFixtures(page, 'en', 601, 'mineral');
  const task = panel.locator('[data-og7-id="task-0"]');
  for (const width of [1536, 1100, 700, 601, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 941 });
    const bounds = (await panel.boundingBox())!;
    for (const control of [
      panel.locator('[data-og7="attention-type"]'),
      panel.locator('[data-og7="attention-priority"]'),
      panel.locator('[data-og7="attention-due"]'),
      task.getByRole('link')
    ]) {
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(
        bounds.x + bounds.width + 1
      );
    }
    await expectAdminPageFits(page);
  }
  expect(mutations).toEqual([]);
});

for (const scenario of [
  { name: 'one toast', ids: ['1'], addDuringDismissal: false },
  { name: 'three toasts', ids: ['1', '2', '3'], addDuringDismissal: false },
  {
    name: 'a toast arriving during dismissal',
    ids: ['1'],
    addDuringDismissal: true
  }
]) {
  test(`invoice action handles delayed toast dismissal: ${scenario.name}`, async ({
    page
  }) => {
    await page.setContent(`
      <style>
        #invoice-action { position: absolute; top: 2rem; left: 2rem; }
        #notifications { position: fixed; inset: 0; z-index: 1; pointer-events: none; }
        [data-og7="contribution-toast"] { width: 18rem; padding: 1rem; background: #eee; pointer-events: auto; }
      </style>
      <button id="invoice-action" type="button">Générer la facture</button>
      <section id="notifications"></section>
      <output id="close-counts">{}</output>
    `);
    await page.evaluate(({ ids, addDuringDismissal }) => {
      const notifications = document.getElementById('notifications')!;
      const counts = document.getElementById('close-counts')!;
      const closeCounts: Record<string, number> = {};
      let added = false;
      const addToast = (id: string) => {
        const toast = document.createElement('article');
        toast.dataset['og7'] = 'contribution-toast';
        toast.dataset['og7Id'] = id;
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Fermer';
        close.onclick = () => {
          closeCounts[id] = (closeCounts[id] ?? 0) + 1;
          counts.textContent = JSON.stringify(closeCounts);
          if (addDuringDismissal && !added) {
            added = true;
            setTimeout(() => addToast('4'), 100);
          }
          // Angular can remove the article after the click promise settles.
          setTimeout(() => toast.remove(), 250);
        };
        toast.append(close);
        notifications.append(toast);
      };
      for (const id of ids) addToast(id);
      document.getElementById('invoice-action')!.onclick = (event) => {
        (event.currentTarget as HTMLElement).dataset['clicked'] = 'true';
      };
    }, scenario);
    const toasts = page.locator('[data-og7="contribution-toast"]');
    const firstToast = toasts.first();
    await page.addLocatorHandler(firstToast, () =>
      dismissContributionToasts(page)
    );
    try {
      await page
        .getByRole('button', { name: 'Générer la facture', exact: true })
        .click();
    } finally {
      await page.removeLocatorHandler(firstToast);
    }
    await expect(toasts).toHaveCount(0);
    await expect(page.locator('#invoice-action')).toHaveAttribute(
      'data-clicked',
      'true'
    );
    const ids = scenario.addDuringDismissal
      ? [...scenario.ids, '4']
      : scenario.ids;
    expect(
      JSON.parse((await page.locator('#close-counts').textContent())!)
    ).toEqual(Object.fromEntries(ids.map((id) => [id, 1])));
  });
}

test('queue pages past 100 results and keeps filters in the URL after reload', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser/attention?page=6');
  await expect(page.locator('[data-og7-id="task-125"]')).toBeVisible();
  await expect(page.locator('[data-og7="attention-count"]')).toHaveText(
    '126 résultat(s) sur 126 intervention(s).'
  );
  await page
    .locator('[data-og7="attention-type"]')
    .selectOption('email_delivery_failed');
  await expect(page).toHaveURL(/type=email_delivery_failed/);
  await expect(page).not.toHaveURL(/page=6/);
  await page.locator('[data-og7="attention-priority"]').selectOption('today');
  await page.locator('[data-og7="attention-due"]').selectOption('undated');
  await expect(page.locator('[data-og7="attention-count"]')).toHaveText(
    '26 résultat(s) sur 126 intervention(s).'
  );
  await page.getByRole('button', { name: 'Suivante', exact: true }).click();
  await page.reload();
  await expect(page.locator('[data-og7="attention-type"]')).toHaveValue(
    'email_delivery_failed'
  );
  await expect(page.locator('[data-og7-id="task-125"]')).toBeVisible();
});

test('an exact email opens beyond the old list cap and return reloads the preserved queue', async ({
  page
}) => {
  await fixtures(page);
  await page.goto(
    '/admin/fundraiser/attention?type=email_delivery_failed&page=2'
  );
  const request = page.waitForRequest((r) =>
    r.url().includes('/api/admin/email-queue?messageId=')
  );
  await page.locator('[data-og7-id="task-125"] a').click();
  expect(new URL((await request).url()).searchParams.get('messageId')).toBe(
    emailId
  );
  await expect(
    page.locator('[data-og7="attention-object-target"]')
  ).toContainText(emailId);
  await page.route('**/api/admin/attention?**', (route) =>
    route.fulfill({
      json: response(
        new URL(route.request().url()),
        items.filter((item) => item.id !== 'task-125')
      )
    })
  );
  await page.locator('[data-og7="return-to-attention"]').click();
  await expect(page).toHaveURL(/type=email_delivery_failed.*page=2/);
  await expect(page.locator('[data-og7="attention-count"]')).toHaveText(
    '25 résultat(s) sur 125 intervention(s).'
  );
  await expect(page.locator('[data-og7-id="task-125"]')).toHaveCount(0);
});

test('invoice action is scoped and requires confirmation, opening is read-only', async ({
  page
}) => {
  await fixtures(page);
  const writes: unknown[] = [];
  await page.route(
    '**/api/admin/sponsorship-invoices/backfill',
    async (route) => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          eligible_count: 1,
          missing_count: 1,
          processed_count: 1,
          created_count: 1,
          failed_count: 0,
          remaining_count: 0,
          skipped_count: 0,
          invoiceIds: [],
          invoices: [],
          errors: []
        }
      });
    }
  );
  await page.goto('/admin/fundraiser/attention?type=invoice_missing');
  await page.locator('[data-og7-id="task-1"] a').click();
  await expect(
    page.locator('[data-og7="attention-invoice-target"]')
  ).toContainText(contributionId);
  expect(writes).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Générer la facture de ce dossier' })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Annuler', exact: true })
    .last()
    .click();
  expect(writes).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Générer la facture de ce dossier' })
    .click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({
    contributionId,
    limit: 1,
    confirmation: contributionId
  });
});

test('queue failures preserve explicitly stale data; access refusal and unavailable storage clear it', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser/attention');
  await expect(page.locator('[data-og7-id="task-0"]')).toBeVisible();
  await page.route('**/api/admin/attention?**', (route) =>
    route.fulfill({ status: 502, json: {} })
  );
  await page.getByRole('button', { name: 'Actualiser les tâches' }).click();
  await expect(
    page.getByText(/Les tâches affichées peuvent avoir changé/)
  ).toBeVisible();
  await expect(page.locator('[data-og7-id="task-0"]')).toBeVisible();
  await page.route('**/api/admin/attention?**', (route) =>
    route.fulfill({ status: 403, json: {} })
  );
  await page.getByRole('button', { name: 'Actualiser les tâches' }).click();
  await expect(page.locator('[data-og7-id="task-0"]')).toHaveCount(0);
  await page.route('**/api/admin/attention?**', (route) =>
    route.fulfill({
      json: {
        ...response(new URL(route.request().url())),
        available: false,
        coverage: 'unavailable',
        items: []
      }
    })
  );
  await page.getByRole('button', { name: 'Actualiser les tâches' }).click();
  await expect(page.getByText(/La file nécessite une base/)).toBeVisible();
  await page.route('**/api/admin/attention?**', (route) =>
    route.fulfill({ json: response(new URL(route.request().url()), []) })
  );
  await page.getByRole('button', { name: 'Actualiser les tâches' }).click();
  await expect(page.locator('[data-og7="attention-empty"]')).toBeVisible();
});

test('today summary remains usable when dashboard metrics fail', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser');
  await expect(
    page.getByRole('heading', { name: /À traiter aujourd’hui/ })
  ).toBeVisible();
  await expect(page.locator('[data-og7="attention-items"] li')).toHaveCount(4);
  await page
    .getByRole('link', { name: 'Voir toutes les tâches du jour' })
    .click();
  await expect(page).toHaveURL(/attention\?due=today/);
});

test('Stripe details use a direct URL, resolved events have an explicit empty state', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser/attention?type=stripe_event_failed');
  await page.locator('[data-og7-id="task-2"] a').click();
  await expect(page).toHaveURL(/itemId=task-2/);
  await expect(page.locator('[data-og7="attention-items"] li')).toHaveCount(1);
  await page.goto('/admin/fundraiser/attention?itemId=resolved');
  await expect(page.locator('[data-og7="attention-empty"]')).toContainText(
    'Cette alerte n’est plus active'
  );
});

test('queue is translated, keyboard usable and fits desktop and narrow mobile', async ({
  page
}, testInfo) => {
  await fixtures(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/admin/fundraiser/attention');
  await expect(page.locator('[data-og7-id="task-0"]')).toBeVisible();
  for (const width of [1672, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 941 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`attention-fr-${width}.png`),
      fullPage: true
    });
  }
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'To do', exact: true }).first()
  ).toBeVisible();
  await expect(page.locator('[data-og7-id="task-0"] h3')).toHaveText(
    'Failed email'
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.locator('[data-og7="attention-type"]').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-og7="attention-priority"]')).toBeFocused();
  expect(errors).toEqual([]);
});

test('queue rejects an expired backend session and preserves return filters at login', async ({
  page
}) => {
  await fixtures(page);
  await page.route('**/api/admin/attention?**', (route) =>
    route.fulfill({ status: 401, json: {} })
  );
  await page.goto('/admin/fundraiser/attention?type=invoice_missing');
  await expect(page).toHaveURL(/admin\/login\?returnUrl=/);
  expect(new URL(page.url()).searchParams.get('returnUrl')).toContain(
    'type=invoice_missing'
  );
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-session-token')
    )
  ).toBeNull();
});

test('direct publication links load and focus the exact slot, batch and draft', async ({
  page
}) => {
  await fixtures(page);
  const now = '2026-09-15T14:00:00Z';
  const base = {
    id: contributionId,
    channel: 'facebook',
    capacity: 5,
    capacityUsed: 0,
    capacityAvailable: 5,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    notes: null
  };
  const slot = {
    ...base,
    feedTarget: 'openg7',
    startsAt: now,
    timezone: 'America/Toronto',
    assignedBatchIds: [],
    assignedDraftIds: []
  };
  const batch = {
    ...base,
    slotId: null,
    scheduledAt: null,
    publishedAt: null,
    assignedDraftIds: []
  };
  const draft = {
    id: contributionId,
    contribution_id: contributionId,
    sponsor_company_name: 'Démonstration',
    feed_target: 'openg7',
    channel: 'facebook',
    title: 'Démonstration',
    body: 'Démonstration',
    disclosure_text: 'Commandite',
    status: 'approved',
    public_url: null,
    scheduled_at: null,
    approved_at: now,
    published_at: null,
    review_note: null,
    batch_id: null,
    slot_id: null,
    created_at: now,
    updated_at: now
  };
  await page.route('**/api/admin/sponsorships**', (route) =>
    route.fulfill({
      json: {
        sponsorships: [],
        pagination: {
          page: 1,
          pageSize: 25,
          totalItems: 0,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false
        }
      }
    })
  );
  await page.route('**/api/admin/social-publication-jobs**', (route) =>
    route.fulfill({ json: { jobs: [] } })
  );
  for (const [kind, record] of [
    ['slot', slot],
    ['batch', batch],
    ['draft', draft]
  ] as const) {
    const requests: string[] = [];
    for (const [plural, queryKind] of [
      ['slots', 'slot'],
      ['batches', 'batch'],
      ['drafts', 'draft']
    ]) {
      await page.route(`**/api/admin/publication-${plural}**`, (route) => {
        const id = new URL(route.request().url()).searchParams.get(
          `${queryKind}Id`
        );
        if (id) requests.push(id);
        return route.fulfill({
          json: {
            [plural]:
              queryKind === kind && id === contributionId ? [record] : [],
            last_updated_at: now
          }
        });
      });
    }
    await page.goto(
      `/admin/fundraiser/publications?${kind}Id=${contributionId}`
    );
    await expect(
      page.locator(`#attention-object-${contributionId}`)
    ).toBeFocused();
    const space =
      kind === 'slot' ? 'calendar' : kind === 'batch' ? 'batches' : 'drafts';
    await expect(page).toHaveURL(
      `/admin/fundraiser/publications/${space}?${kind}Id=${contributionId}`
    );
    expect(requests).toEqual([contributionId]);
  }
});

test('initial login redirect retains queue filters and pagination', async ({
  page
}) => {
  await page.goto('/admin/fundraiser/attention?type=invoice_missing&page=3');
  await expect(page).toHaveURL(/admin\/login\?returnUrl=/);
  expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(
    '/admin/fundraiser/attention?type=invoice_missing&page=3'
  );
});

for (const type of ['stripe_event_failed', 'stripe_event_stalled'] as const) {
  test(`a targeted ${type} keeps its exact Stripe inspector accessible`, async ({
    page
  }) => {
    await fixtures(page);
    const eventId = 'evt_guidance_targeted_701';
    const item: AdminAttentionItem = {
      ...items[2]!,
      id: `${type}:${eventId}`,
      type,
      facts: { reference: eventId },
      adminUrl: `/admin/fundraiser/attention?itemId=${encodeURIComponent(`${type}:${eventId}`)}`
    };
    const reads: string[] = [];
    const mutations: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        url.pathname.startsWith('/api/') &&
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
      )
        mutations.push(request.method() + ' ' + url.pathname);
    });
    await page.route('**/api/admin/attention**', (route) =>
      route.fulfill({ json: response(new URL(route.request().url()), [item]) })
    );
    await page.route('**/api/admin/stripe-event?**', (route) => {
      reads.push(
        new URL(route.request().url()).searchParams.get('eventId') ?? ''
      );
      return route.fulfill({
        json: {
          available: true,
          event: {
            id: eventId,
            type: 'payment_intent.succeeded',
            status: type === 'stripe_event_failed' ? 'failed' : 'processing',
            receivedAt: '2026-10-15T12:00:00Z',
            processedAt: null,
            error: type === 'stripe_event_failed' ? 'processing_failed' : null
          }
        }
      });
    });
    await page.goto(item.adminUrl!);
    const inspector = page.locator('[data-og7="attention-stripe-inspect"]');
    await expect(inspector).toBeVisible();
    await inspector.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog');
    await expect(drawer).toContainText(eventId);
    await expect(drawer).toContainText('payment_intent.succeeded');
    expect(reads).toEqual([eventId]);
    expect(mutations).toEqual([]);
  });
}
