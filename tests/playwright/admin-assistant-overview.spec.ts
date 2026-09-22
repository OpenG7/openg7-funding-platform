import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  AdminAttentionItem,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

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
  const calls: { path: string; method: string; body: unknown }[] = [];
  const options = {
    status: 200,
    unavailable: false,
    empty: false,
    mode: 'disabled',
    delay: 0,
    resolved: false
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    calls.push({
      path: url.pathname,
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
    if (url.pathname === '/api/admin/assistant/prepare')
      return route.fulfill({
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
    if (url.pathname === '/api/admin/assistant/summary')
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
    return route.fulfill({
      status: 503,
      json: { error: 'Unavailable fixture' }
    });
  });
  return { options, calls };
}

test('bounded overview, server pagination past 100, and email grouping survive reload', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(base);
  await expect(page.locator('[data-og7="assistant-items"] > li')).toHaveCount(
    15
  );
  await expect(
    page.locator('[data-og7="assistant-recommendations"] > li')
  ).toHaveCount(3);
  await page.screenshot({
    path: test.info().outputPath('assistant-desktop.png')
  });
  expect(calls.some((call) => call.path.endsWith('/summary'))).toBe(false);
  await page
    .locator(
      '[data-og7="assistant-categories"] [data-og7-id="email_delivery_failed"]'
    )
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Facture de commandite · Cause à examiner 71'
    })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Suivi de commandite · Cause à examiner 56' })
    .click();
  await expect(page.locator('[data-og7="assistant-count"]')).toContainText(
    '56'
  );
  await expect(page).toHaveURL(/emailTemplate=sponsorship_followup/);
  await page.reload();
  await expect(page.locator('[data-og7="assistant-count"]')).toContainText(
    '56'
  );
  await page
    .getByRole('button', { name: 'Tous les courriels', exact: true })
    .click();
  await page.goto(base + '?type=email_delivery_failed&page=9');
  await expect(page.locator('[data-og7="assistant-items"] > li')).toHaveCount(
    7
  );
  await expect(page.locator('[data-og7="assistant-items"]')).toContainText(
    '00000126'
  );
  await expect(page.getByText('Page 9 sur 9')).toBeVisible();
});

test('exact email link returns to the same filtered page and selected item', async ({
  page
}) => {
  await fixtures(page);
  await page.goto(base + '?type=email_delivery_failed&page=9');
  const row = page.locator('[data-og7="assistant-items"] > li').last();
  await row.getByRole('button').click();
  const selectedUrl = page.url();
  const dialog = page.getByRole('dialog', { name: 'Détail de l’élément' });
  const link = dialog.getByRole('link', { name: 'Ouvrir ce courriel' });
  await expect(link).toHaveAttribute(
    'href',
    /messageId=10000000-0000-4000-8000-000000000126/
  );
  await link.click();
  await page
    .getByRole('link', { name: 'Retour à l’Assistant', exact: true })
    .click();
  await expect(page).toHaveURL(selectedUrl);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('000000000126');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(row.getByRole('button')).toBeFocused();
  await expect(page.getByText('Page 9 sur 9')).toBeVisible();
});

test('drawer keeps focus and scroll, translates missing fields, and only prepares a draft', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(base + '?type=sponsorship_needs_info');
  const button = page
    .locator('[data-og7="assistant-items"]')
    .getByRole('button');
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Détail de l’élément' });
  await expect(
    dialog.getByText('Photo de présentation', { exact: true })
  ).toBeVisible();
  await expect(dialog).not.toContainText('photo_presentation');
  await dialog.getByRole('button', { name: 'Préparer une relance' }).click();
  await expect(
    dialog.getByText('Brouillon non envoyé, non publié et non enregistré.')
  ).toBeVisible();
  expect(
    calls.filter((call) => call.method === 'POST').map((call) => call.path)
  ).toEqual(['/api/admin/assistant/prepare']);
  expect(
    calls.find((call) => call.path.endsWith('/prepare'))?.body
  ).toMatchObject({ reference: sponsorshipId, language: 'fr-CA' });
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await page.goto(base + '?type=email_delivery_failed');
  const last = page
    .locator('[data-og7="assistant-items"] > li')
    .last()
    .getByRole('button');
  await last.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await last.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(last).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(before);
});

test('errors remain visible, refresh recovers, and missing sources never look empty', async ({
  page
}) => {
  const { options } = await fixtures(page);
  options.status = 502;
  await page.goto(base);
  await expect(page.locator('[data-og7="assistant-state"]')).toContainText(
    'Impossible'
  );
  options.status = 200;
  await page
    .getByRole('button', { name: 'Actualiser le contexte', exact: true })
    .click();
  await expect(page.locator('[data-og7="assistant-items"] > li')).toHaveCount(
    15
  );
  options.status = 502;
  await page
    .getByRole('button', { name: 'Actualiser le contexte', exact: true })
    .click();
  await expect(page.locator('[data-og7="assistant-state"]')).not.toBeEmpty();
  await expect(
    page.locator('[data-og7="assistant-items"] button').first()
  ).toBeDisabled();
  options.status = 200;
  options.unavailable = true;
  await page
    .getByRole('button', { name: 'Actualiser le contexte', exact: true })
    .click();
  await expect(page.locator('[data-og7="assistant-items"]')).toHaveCount(0);
  await expect(page.locator('[data-og7="assistant-state"]')).not.toBeEmpty();
  options.unavailable = false;
  options.empty = true;
  await page
    .getByRole('button', { name: 'Actualiser le contexte', exact: true })
    .click();
  await expect(page.locator('[data-og7="assistant-count"]')).toContainText('0');
});

test('access denial and an expired session do not expose the previous queue', async ({
  page
}) => {
  const { options } = await fixtures(page);
  options.status = 403;
  await page.goto(base);
  await expect(page.locator('[data-og7="assistant-state"]')).not.toBeEmpty();
  await expect(page.locator('[data-og7="assistant-items"]')).toHaveCount(0);
  options.status = 401;
  await page
    .getByRole('button', { name: 'Actualiser le contexte', exact: true })
    .click();
  await expect(page).toHaveURL(/admin\/login/);
});

test('a resolved item has an explicit state and a delayed response cannot reopen a closed drawer', async ({
  page
}) => {
  const { options } = await fixtures(page);
  options.resolved = true;
  await page.goto(base + '?selected=' + encodeURIComponent(sponsorship.id));
  const dialog = page.getByRole('dialog', { name: 'Détail de l’élément' });
  await expect(dialog).toContainText(/plus active/);
  await page.keyboard.press('Escape');
  options.resolved = false;
  options.delay = 500;
  await page.locator('[data-og7="assistant-items"] button').first().click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page).not.toHaveURL(/selected=/);
});

test('optional question and financial panels load on demand', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(base);
  await page.locator('[data-og7="assistant-question"] summary').click();
  await expect(page.locator('[data-og7="assistant-question"]')).toContainText(
    /désactivé/
  );
  await expect(
    page.locator('[data-og7="assistant-question"] input')
  ).toHaveCount(0);
  await page.getByText('Résumé financier prudent', { exact: true }).click();
  await expect(page.getByText('Données synthétiques.')).toBeVisible();
  expect(calls.some((call) => call.path.endsWith('/summary'))).toBe(true);
  expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
});

test('French and English remain accessible at desktop and mobile widths', async ({
  page
}) => {
  await fixtures(page);
  await page.goto(base);
  await expect(page.locator('[data-og7="assistant-items"] > li')).toHaveCount(
    15
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Where to start?' })
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
    )
    .toBe(true);
  await page.locator('[data-og7="assistant-items"] button').first().click();
  await expect(
    page.getByRole('dialog', { name: 'Item details' })
  ).toBeVisible();
  await expect(
    page.getByText('Presentation image', { exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('assistant-mobile.png')
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
