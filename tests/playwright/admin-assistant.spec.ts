import type { AdminWorkQueueResponse } from '@openg7/funding-core';

import { signInAsAdmin } from './support/admin-auth.js';
import { expect, test } from './support/test.js';

const sponsorshipId = '831af81a-561e-4ec4-9d1c-f91944710116';
const sponsorshipUrl = `/admin/fundraiser/sponsors?sponsorshipId=${sponsorshipId}`;

// Covers the read-only admin assistant page (admin-assistant-page component).
// The deterministic queue is served by the real /admin/attention
// endpoint (it works even when the AI provider is disabled). The conversational
// answer is stubbed so the assertions stay deterministic regardless of whether
// a model provider is configured in the environment under test.

const stubbedAnswer = {
  generatedAt: '2026-07-24T00:00:00.000Z',
  mode: 'mock',
  enabled: true,
  status: 'ok',
  answer: [
    {
      kind: 'facts',
      title: 'Faits (issus des outils)',
      lines: ['2 commandite(s) à réviser.']
    },
    {
      kind: 'interpretation',
      title: 'Interprétation',
      lines: ['Traite les urgents en premier.']
    }
  ],
  links: [{ label: 'Commandite à réviser', adminUrl: sponsorshipUrl }],
  toolInvocations: [
    { tool: 'list_sponsorships_needing_review', resultCount: 2 }
  ],
  limitations: ['Réponses fondées uniquement sur des outils en lecture seule.'],
  provider: { name: 'mock', model: 'mock-router' }
};

test.describe('Docker admin assistant', () => {
  test('renders the deterministic attention summary', async ({ page }) => {
    await signInAsAdmin(page);
    const summaryResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/admin/attention?') &&
        response.url().includes('overview=true')
    );
    await page.goto('/admin/fundraiser/assistant');

    await expect(
      page.getByRole('heading', { name: 'Explorer les éléments à traiter' })
    ).toBeVisible();
    await page.getByText('Résumé financier prudent', { exact: true }).click();
    await expect(
      page.getByText('Montant brut payé', { exact: true })
    ).toBeVisible();

    const response = await summaryResponse;
    expect(response.ok()).toBe(true);
    const summary = (await response.json()) as AdminWorkQueueResponse;
    for (const item of summary.items.filter(
      (item) =>
        item.type === 'sponsorship_needs_info' ||
        item.type === 'sponsorship_needs_review'
    )) {
      expect(item.contributionId).toBeTruthy();
      const expectedUrl = `/admin/fundraiser/sponsors?sponsorshipId=${encodeURIComponent(item.contributionId!)}`;
      expect(item.adminUrl).toBe(expectedUrl);
      await page
        .locator('[data-og7="assistant-items"]')
        .locator(`[data-og7-id="${item.id}"]`)
        .getByRole('button')
        .click();
      const dialog = page.getByRole('dialog', { name: 'Détail de l’élément' });
      const href = await dialog
        .getByRole('link', { name: 'Ouvrir le dossier', exact: true })
        .getAttribute('href');
      expect(href?.split('&returnTo=')[0]).toBe(expectedUrl);
      await page.keyboard.press('Escape');
    }
  });

  test('answers a question and never exposes a financial action button', async ({
    page
  }) => {
    await signInAsAdmin(page);

    await page.route('**/admin/assistant/query', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(stubbedAnswer)
      })
    );

    await page.goto('/admin/fundraiser/assistant');
    await page.route('**/api/admin/assistant/context*', (route) =>
      route.fulfill({
        json: {
          status: 'empty',
          context: null,
          generatedAt: '2026-09-21T14:00:00Z',
          conversationMode: 'mock'
        }
      })
    );
    await page.locator('[data-og7="assistant-question"] summary').click();
    await page
      .getByLabel('Question', { exact: true })
      .fill('Quelles commandites sont à réviser?');
    await page.getByRole('button', { name: 'Demander', exact: true }).click();

    await expect(
      page.getByText('Réponse sur le dossier', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Faits vérifiés', exact: true })
    ).toBeVisible();

    // No automated financial action may ever be offered by the assistant.
    await expect(
      page.getByRole('button', {
        name: /rembourser|approuver|publier|refuser/i
      })
    ).toHaveCount(0);
  });

  test('shows an error state when the summary request fails and recovers on refresh', async ({
    page
  }) => {
    await signInAsAdmin(page);

    await page.route('**/admin/attention?*', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}'
      })
    );
    await page.goto('/admin/fundraiser/assistant');

    await expect(page.locator('[data-og7="assistant-state"]')).toBeVisible();

    await page.unroute('**/admin/attention?*');
    await page
      .getByRole('button', { name: 'Actualiser le contexte', exact: true })
      .click();

    await expect(page.locator('[data-og7="assistant-state"]')).toBeEmpty();
    await expect(
      page.getByRole('heading', { name: 'Explorer les éléments à traiter' })
    ).toBeVisible();
  });

  test('prepares a reminder draft clearly marked non envoyé / non publié', async ({
    page
  }) => {
    await signInAsAdmin(page);

    await page.route('**/admin/attention?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(stubbedQueueWithReminder())
      })
    );
    await page.route('**/admin/assistant/prepare', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(stubbedReminderDraft)
      })
    );

    await page.goto('/admin/fundraiser/assistant');
    await page.locator('[data-og7="assistant-items"] button').first().click();
    await page
      .getByRole('button', { name: 'Préparer une relance', exact: true })
      .click();

    await expect(
      page.getByRole('heading', { name: /Relance — fiche commanditaire/ })
    ).toBeVisible();
    await expect(
      page.getByText('Brouillon non envoyé, non publié et non enregistré.')
    ).toBeVisible();
  });
});

const stubbedSummaryWithReminder = {
  generatedAt: '2026-07-24T00:00:00.000Z',
  counts: { urgent: 1, today: 0, thisWeek: 0, informational: 0 },
  sponsorships: { needsInfo: 1, needsReview: 0, approved: 0 },
  publications: { needsPreparation: 0, scheduled: 0, late: 0 },
  emails: { failed: 0 },
  financialSummary: {
    grossPaid: 0,
    processingFees: null,
    refunded: 0,
    netReceived: null,
    currency: 'CAD',
    limitations: ['Frais Stripe non inclus.']
  },
  attentionItems: [
    {
      id: `sponsorship_needs_info:${sponsorshipId}`,
      type: 'sponsorship_needs_info',
      severity: 'urgent',
      title: 'Commandite payée sans fiche complète (OG7-CMD-0001)',
      explanation: 'Fiche commanditaire incomplète.',
      sponsorshipId,
      contributionId: sponsorshipId,
      detectedAt: '2026-07-24T00:00:00.000Z',
      adminUrl: sponsorshipUrl,
      facts: { reference: 'OG7-CMD-0001' },
      suggestedActions: [
        {
          actionType: 'prepare_reminder',
          label: 'Préparer une relance',
          executionMode: 'prepare'
        },
        {
          actionType: 'open_sponsorship',
          label: 'Ouvrir la commandite',
          executionMode: 'navigate'
        }
      ]
    }
  ]
};

const stubbedReminderDraft = {
  status: 'ok',
  message: null,
  draft: {
    type: 'sponsorship_reminder',
    generatedAt: '2026-07-24T00:00:00.000Z',
    reference: 'OG7-CMD-0001',
    title: 'Relance — fiche commanditaire OG7-CMD-0001',
    bodyLines: [
      'Bonjour,',
      'Nous confirmons la réception de votre commandite.'
    ],
    fields: [
      {
        label: 'Objet',
        value: 'Complétez votre fiche de commandite (OG7-CMD-0001)'
      }
    ],
    adminUrl: sponsorshipUrl,
    notice: "Ce brouillon n'a pas été envoyé.",
    limitations: ['Personnalisez le nom du contact avant envoi.'],
    sent: false,
    published: false,
    persisted: false
  }
};

function stubbedQueueWithReminder() {
  return {
    available: true,
    coverage: 'complete',
    missingSources: [],
    generatedAt: stubbedSummaryWithReminder.generatedAt,
    timezone: 'America/Toronto',
    total: 1,
    filteredTotal: 1,
    todayTotal: 1,
    counts: { urgent: 1, today: 0, this_week: 0, informational: 0 },
    typeCounts: { sponsorship_needs_info: 1 },
    page: 1,
    pageSize: 15,
    items: stubbedSummaryWithReminder.attentionItems
  };
}

// Isolated navigation regressions: all admin responses use synthetic records.
test.describe('assistant dossier links', () => {
  const target = {
    id: sponsorshipId,
    version: '2026-07-24T00:00:00.000Z',
    public_reference: 'OG7-CMD-0001',
    contribution_type: 'sponsorship_interest',
    amount: 300,
    currency: 'CAD',
    payment_status: 'paid',
    paid_at: '2026-07-24T00:00:00.000Z',
    public_display_consent: false,
    display_amount_consent: false,
    sponsor_company_name: 'Commandite cible',
    sponsor_contact_email: 'contact@example.test',
    sponsor_review_status: 'pending_review',
    sponsor_feed_channels: [],
    sponsor_feed_status: 'not_planned',
    sponsorship_refund_status: 'not_requested',
    admin_audit_entries: [],
    created_at: '2026-07-24T00:00:00.000Z',
    updated_at: '2026-07-24T00:00:00.000Z'
  };
  const first = {
    ...target,
    id: '028486c4-c006-4201-b7b9-6e0ba72c8d49',
    sponsor_company_name: 'Première commandite'
  };

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'openg7-admin-session-token',
        'openg7-admin-session.test'
      );
      sessionStorage.setItem(
        'openg7-admin-session-expires-at',
        new Date(Date.now() + 3_600_000).toISOString()
      );
    });
    await page.route('**/api/admin/**', async (route) => {
      const url = new URL(route.request().url());
      let response: unknown;
      switch (url.pathname) {
        case '/api/admin/attention':
          response = stubbedQueueWithReminder();
          break;
        case '/api/admin/assistant/context':
          response = {
            status: 'empty',
            context: null,
            generatedAt: '2026-09-21T14:00:00Z',
            conversationMode: 'mock'
          };
          break;
        case '/api/admin/assistant/summary':
          response = stubbedSummaryWithReminder;
          break;
        case '/api/admin/assistant/query':
          response = stubbedAnswer;
          break;
        case '/api/admin/assistant/prepare':
          response = stubbedReminderDraft;
          break;
        case '/api/admin/sponsorships': {
          const search = url.searchParams.get('search');
          // The target is absent from the default first page.
          const items =
            search === sponsorshipId ? [target] : search ? [] : [first];
          response = {
            items,
            pagination: {
              page: 1,
              pageSize: 6,
              totalItems: search ? items.length : 7,
              totalPages: search ? 1 : 2,
              hasPreviousPage: false,
              hasNextPage: !search
            }
          };
          break;
        }
        case '/api/admin/sponsorships/media':
          response = { assets: [] };
          break;
        default:
          await route.abort();
          return;
      }
      await route.fulfill({ json: response });
    });
  });

  for (const source of ['summary', 'draft', 'answer'] as const) {
    test(`${source} opens the specified dossier beyond the first page`, async ({
      page
    }) => {
      await page.goto('/admin/fundraiser/assistant');
      let label = 'Ouvrir le dossier';
      if (source !== 'answer')
        await page
          .locator('[data-og7="assistant-items"] button')
          .first()
          .click();
      if (source === 'draft') {
        await page
          .getByRole('button', { name: 'Préparer une relance', exact: true })
          .click();
        label = 'Ouvrir l’écran pour agir';
      } else if (source === 'answer') {
        await page.locator('[data-og7="assistant-question"] summary').click();
        await page
          .getByLabel('Question', { exact: true })
          .fill('Quelles commandites sont à réviser?');
        await page
          .getByRole('button', { name: 'Demander', exact: true })
          .click();
        label = 'Commandite à réviser';
      }
      const link = page.getByRole('link', { name: label, exact: true });
      expect((await link.getAttribute('href'))?.split('&returnTo=')[0]).toBe(
        sponsorshipUrl
      );
      expect(
        new URL(
          (await link.getAttribute('href'))!,
          'http://localhost'
        ).searchParams.get('returnTo')
      ).toContain('/admin/fundraiser/assistant');
      await link.click();
      await expect(page).toHaveURL(
        new RegExp(`sponsorshipId=${sponsorshipId}`)
      );
      await expect(page.getByLabel('Recherche', { exact: true })).toHaveValue(
        sponsorshipId
      );
      const detail = page.getByRole('complementary', {
        name: 'Dossier commanditaire selectionne'
      });
      await expect(
        detail.getByRole('heading', {
          name: target.sponsor_company_name,
          exact: true
        })
      ).toBeVisible();

      await page.reload();
      await expect(
        detail.getByRole('heading', {
          name: target.sponsor_company_name,
          exact: true
        })
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Reinitialiser', exact: true })
        .click();
      await expect(
        detail.getByRole('heading', {
          name: first.sponsor_company_name,
          exact: true
        })
      ).toBeVisible();
    });
  }

  test('an unknown dossier shows the empty state and can return to the list', async ({
    page
  }) => {
    await page.goto(
      '/admin/fundraiser/sponsors?sponsorshipId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );
    await expect(
      page.getByRole('heading', {
        name: 'Aucune commandite ne correspond aux filtres.'
      })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Fermer le dossier' })
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Reinitialiser les filtres', exact: true })
      .click();
    await expect(
      page.getByRole('heading', {
        name: first.sponsor_company_name,
        exact: true
      })
    ).toBeVisible();
  });
});
