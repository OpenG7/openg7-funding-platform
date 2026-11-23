import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  AdminAttentionItem,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  expectAdminPageFits,
  prepareAdminDesignReview
} from './support/admin-design-review.js';

const base = '/admin/fundraiser/assistant';
const at = '2026-09-21T14:00:00Z';
const sponsorshipId = '10000000-0000-4000-8000-000000000301';
const sponsorship: AdminAttentionItem = {
  id: 'sponsorship_needs_info:' + sponsorshipId,
  type: 'sponsorship_needs_info',
  severity: 'urgent',
  title: 'Internal title',
  explanation: 'Internal explanation',
  sponsorshipId,
  contributionId: sponsorshipId,
  detectedAt: at,
  adminUrl: '/admin/fundraiser/sponsors?sponsorshipId=' + sponsorshipId,
  facts: {
    reference: 'DEMO-301',
    amount: 50,
    currency: 'CAD',
    daysSincePaid: 12,
    missingFields: 'photo_presentation'
  },
  suggestedActions: [
    {
      actionType: 'prepare_reminder',
      executionMode: 'prepare',
      label: 'Internal label'
    }
  ]
};
const publication: AdminAttentionItem = {
  id: 'publication_late:slot:demo',
  type: 'publication_late',
  severity: 'urgent',
  title: 'Internal title',
  explanation: 'Internal explanation',
  detectedAt: at,
  dueAt: '2026-09-20T14:00:00Z',
  adminUrl: '/admin/fundraiser/publications?slotId=demo',
  facts: { reference: 'DEMO-PUB', channel: 'facebook' },
  suggestedActions: []
};
const emails: AdminAttentionItem[] = Array.from({ length: 127 }, (_, i) => {
  const emailQueueId = '10000000-0000-4000-8000-' + String(i).padStart(12, '0');
  return {
    id: 'email_delivery_failed:' + emailQueueId,
    type: 'email_delivery_failed',
    severity: 'urgent',
    title: 'Internal title',
    explanation: 'Internal explanation',
    detectedAt: at,
    emailQueueId,
    adminUrl: '/admin/fundraiser/email-queue?messageId=' + emailQueueId,
    facts: {
      templateKey: i < 71 ? 'sponsorship_invoice' : 'sponsorship_followup',
      errorCategory: 'autre',
      attempts: 5,
      maxAttempts: 5,
      attemptsExhausted: true
    },
    suggestedActions: []
  };
});
const source = [sponsorship, publication, ...emails];

function response(url: URL, items = source): AdminWorkQueueResponse {
  const params = url.searchParams;
  const filtered = items.filter(
    (item) =>
      (!params.get('type') || item.type === params.get('type')) &&
      (!params.get('priority') || item.severity === params.get('priority')) &&
      (!params.get('itemId') || item.id === params.get('itemId')) &&
      (!params.get('emailTemplate') ||
        item.facts['templateKey'] === params.get('emailTemplate')) &&
      (!params.get('emailError') ||
        item.facts['errorCategory'] === params.get('emailError'))
  );
  const pageSize = Number(params.get('pageSize') || 25);
  const page = Math.min(
    Number(params.get('page') || 1),
    Math.max(1, Math.ceil(filtered.length / pageSize))
  );
  return {
    available: true,
    coverage: 'complete',
    missingSources: [],
    generatedAt: at,
    timezone: 'America/Toronto',
    total: items.length,
    filteredTotal: filtered.length,
    todayTotal: items.length,
    counts: { urgent: items.length, today: 0, this_week: 0, informational: 0 },
    typeCounts: Object.fromEntries(
      [
        'sponsorship_needs_info',
        'publication_late',
        'email_delivery_failed'
      ].map((type) => [type, items.filter((item) => item.type === type).length])
    ) as AdminWorkQueueResponse['typeCounts'],
    page,
    pageSize,
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    ...(params.get('overview') === 'true'
      ? {
          overview: {
            recommendations: items.length
              ? [sponsorship, publication, emails[0]!]
              : [],
            emailGroups: items.length
              ? [
                  {
                    template: 'sponsorship_invoice',
                    error: 'autre',
                    count: 71
                  },
                  {
                    template: 'sponsorship_followup',
                    error: 'autre',
                    count: 56
                  }
                ]
              : []
          }
        }
      : {})
  };
}

async function fixtures(page: Page) {
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
  const calls: {
    path: string;
    search: string;
    method: string;
    body: unknown;
  }[] = [];
  const options = {
    status: 200,
    unavailable: false,
    empty: false,
    mode: 'disabled',
    delay: 0,
    resolved: false,
    prepareStatus: 200,
    draftResponseGate: null as Promise<void> | null,
    privateResponseGate: null as Promise<void> | null
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    calls.push({
      path: url.pathname,
      search: url.search,
      method: request.method(),
      body: request.postData() ? request.postDataJSON() : null
    });
    if (url.pathname === '/api/admin/attention') {
      if (options.delay)
        await new Promise((resolve) => setTimeout(resolve, options.delay));
      const result = response(
        url,
        options.empty || (options.resolved && url.searchParams.has('itemId'))
          ? []
          : source
      );
      return route.fulfill({
        status: options.status,
        json: {
          ...result,
          available: !options.unavailable,
          coverage: options.unavailable ? 'unavailable' : 'complete'
        }
      });
    }
    if (url.pathname === '/api/admin/assistant/context')
      return route.fulfill({
        json: {
          status: 'empty',
          context: null,
          generatedAt: at,
          conversationMode: options.mode
        }
      });
    if (url.pathname === '/api/admin/assistant/prepare') {
      await options.draftResponseGate;
      return route.fulfill({
        status: options.prepareStatus,
        json: {
          status: 'ok',
          message: null,
          draft: {
            type: 'sponsorship_reminder',
            title: 'Relance DEMO-301',
            generatedAt: at,
            reference: 'DEMO-301',
            sent: false,
            published: false,
            persisted: false,
            fields: [],
            bodyLines: ['Message de démonstration.'],
            notice: 'Aucun envoi effectué.',
            limitations: [],
            adminUrl: sponsorship.adminUrl
          }
        }
      });
    }
    if (url.pathname === '/api/admin/email-queue')
      return route.fulfill({
        json: {
          data_source: 'database',
          last_updated_at: at,
          summary: {
            queued_count: 0,
            sending_count: 0,
            sent_count: 0,
            failed_count: 1,
            retryable_count: 1,
            last_failed_at: at,
            last_error: null
          },
          messages: [
            {
              id: url.searchParams.get('messageId'),
              status: 'failed',
              template_key: 'sponsorship_followup',
              recipient_email: 'demo@example.invalid',
              subject: 'Démonstration',
              attempts: 5,
              max_attempts: 5,
              next_attempt_at: null,
              sent_at: null,
              last_error: null,
              created_at: at,
              updated_at: at,
              metadata: {}
            }
          ]
        }
      });
    if (url.pathname === '/api/admin/assistant/summary') {
      await options.privateResponseGate;
      return route.fulfill({
        json: {
          generatedAt: at,
          financialSummary: {
            grossPaid: 50,
            refunded: 0,
            netReceived: null,
            currency: 'CAD',
            limitations: ['Données synthétiques.']
          }
        }
      });
    }
    if (url.pathname === '/api/admin/assistant/query') {
      await options.privateResponseGate;
      return route.fulfill({
        json: {
          generatedAt: at,
          mode: 'mock',
          enabled: true,
          status: 'ok',
          answer: [
            {
              kind: 'facts',
              title: 'Réponse synthétique',
              lines: ['Réponse privée de démonstration.']
            }
          ],
          links: [],
          toolInvocations: [],
          limitations: ['Données simulées.'],
          provider: { name: 'fixture', model: null }
        }
      });
    }
    return route.fulfill({
      status: 503,
      json: { error: 'Unavailable fixture' }
    });
  });
  return { options, calls };
}

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1536]) {
    test(`Assistant focuses on preparation in ${language} at ${width}px`, async ({
      page
    }) => {
      await prepareAdminDesignReview(page);
      const { calls } = await fixtures(page);
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(base);
      const link = page.locator('[data-og7="assistant-full-queue"]');
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', '/admin/fundraiser/attention');
      await expect(page.locator('[data-og7="assistant-items"]')).toHaveCount(0);
      await expect(
        page.locator('[data-og7="assistant-recommendations"]')
      ).toHaveCount(0);
      await expect(
        page.locator('[data-og7="assistant-question"]')
      ).toBeVisible();
      await expect(
        page.locator('[data-og7="assistant-summary"]')
      ).toBeVisible();
      await expectAdminPageFits(page);
      expect(
        calls.filter(
          (call) =>
            call.path === '/api/admin/attention' &&
            new URLSearchParams(call.search).get('pageSize') !== '1'
        )
      ).toEqual([]);
      expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
      const accessibility = await new AxeBuilder({ page })
        .include('[data-og7="assistant-overview"]')
        .analyze();
      expect(accessibility.violations).toEqual([]);
    });
  }
}

test('optional question and financial panels load on demand', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(base);
  expect(
    calls.some(
      (call) => call.path.endsWith('/summary') || call.path.endsWith('/context')
    )
  ).toBe(false);
  await page.locator('[data-og7="assistant-question"] summary').click();
  await expect(page.locator('[data-og7="assistant-question"]')).toContainText(
    /désactivé/
  );
  await expect(
    page.locator('[data-og7="assistant-question"] input')
  ).toHaveCount(0);
  await page.locator('[data-og7="assistant-summary"] summary').click();
  await expect(page.getByText('Données synthétiques.')).toBeVisible();
  expect(calls.some((call) => call.path.endsWith('/summary'))).toBe(true);
  expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
});

test('an exact intervention link still opens its preparation without a general queue', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(base + '?selected=' + encodeURIComponent(sponsorship.id));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('DEMO-301');
  await dialog.getByRole('button', { name: /Préparer/ }).click();
  await expect(dialog).toContainText('Relance DEMO-301');
  expect(calls.filter((call) => call.path.endsWith('/prepare'))).toHaveLength(
    1
  );
  expect(
    calls.filter(
      (call) =>
        call.path === '/api/admin/attention' &&
        new URLSearchParams(call.search).get('pageSize') !== '1'
    )
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-og7="assistant-full-queue"]')).toBeFocused();
});

test('general questions remain available without browsing interventions', async ({
  page
}) => {
  const { options, calls } = await fixtures(page);
  options.mode = 'mock';
  await page.goto(base);
  const question = page.locator('[data-og7="assistant-question"]');
  await question.locator('summary').click();
  await question
    .getByRole('textbox')
    .fill('Quels dossiers demandent une préparation?');
  await question.getByRole('button', { name: 'Demander', exact: true }).click();
  await expect(question).toContainText('Données simulées.');
  expect(calls.filter((call) => call.path.endsWith('/query'))).toHaveLength(1);
  expect(
    calls.filter(
      (call) => call.method === 'POST' && !call.path.endsWith('/query')
    )
  ).toEqual([]);
});

for (const status of [403, 503]) {
  test(`exact intervention handles ${status} without showing a substitute dossier`, async ({
    page
  }) => {
    const { options } = await fixtures(page);
    options.status = status;
    await page.goto(base + '?selected=' + encodeURIComponent(sponsorship.id));
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-og7="assistant-detail"]')).toHaveCount(
      0
    );
    await expect(dialog.getByRole('button', { name: /Préparer/ })).toHaveCount(
      0
    );
  });
}
