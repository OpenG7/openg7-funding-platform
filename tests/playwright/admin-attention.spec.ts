import type { Page } from '@playwright/test';
import type {
  AdminAttentionItem,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

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
  expect(writes[0]).toEqual({ contributionId, limit: 1 });
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
    route.fulfill({ json: { sponsorships: [] } })
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
