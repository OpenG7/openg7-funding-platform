import { signInAsAdmin } from './support/admin-auth.js';
import { expect, test } from './support/test.js';

// Covers the read-only admin assistant page (admin-assistant-page component).
// The deterministic summary is served by the real /admin/assistant/summary
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
  links: [
    { label: 'Commandite à réviser', adminUrl: '/admin/fundraiser/sponsors' }
  ],
  toolInvocations: [
    { tool: 'list_sponsorships_needing_review', resultCount: 2 }
  ],
  limitations: ['Réponses fondées uniquement sur des outils en lecture seule.'],
  provider: { name: 'mock', model: 'mock-router' }
};

test.describe('Docker admin assistant', () => {
  test('renders the deterministic attention summary', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/fundraiser/assistant');

    await expect(
      page.getByRole('heading', { name: 'Que faut-il traiter?' })
    ).toBeVisible();
    await expect(page.getByText('Urgent', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Fiches commanditaires incomplètes' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Résumé financier prudent' })
    ).toBeVisible();
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

    await page
      .getByLabel('Question')
      .fill('Quelles commandites sont à réviser?');
    await page.getByRole('button', { name: 'Demander', exact: true }).click();

    await expect(
      page.getByText('Réponse fondée sur les outils.')
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Faits (issus des outils)' })
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

    await page.route('**/admin/assistant/summary', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}'
      })
    );
    await page.goto('/admin/fundraiser/assistant');

    await expect(
      page.getByText(/Impossible de charger le résumé de l'assistant/i)
    ).toBeVisible();

    await page.unroute('**/admin/assistant/summary');
    await page.getByRole('button', { name: 'Actualiser', exact: true }).click();

    await expect(
      page.getByText(/Impossible de charger le résumé de l'assistant/i)
    ).not.toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Que faut-il traiter?' })
    ).toBeVisible();
  });

  test('prepares a reminder draft clearly marked non envoyé / non publié', async ({
    page
  }) => {
    await signInAsAdmin(page);

    await page.route('**/admin/assistant/summary', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(stubbedSummaryWithReminder)
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

    await page
      .getByRole('button', { name: 'Préparer une relance', exact: true })
      .click();

    await expect(
      page.getByRole('heading', { name: /Relance — fiche commanditaire/ })
    ).toBeVisible();
    await expect(page.getByText('Non envoyé · non publié')).toBeVisible();
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
      id: 'sponsorship_needs_info:c-1',
      type: 'sponsorship_needs_info',
      severity: 'urgent',
      title: 'Commandite payée sans fiche complète (OG7-CMD-0001)',
      explanation: 'Fiche commanditaire incomplète.',
      sponsorshipId: 'c-1',
      contributionId: 'c-1',
      detectedAt: '2026-07-24T00:00:00.000Z',
      adminUrl: '/admin/fundraiser/sponsors',
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
    adminUrl: '/admin/fundraiser/sponsors',
    notice: "Ce brouillon n'a pas été envoyé.",
    limitations: ['Personnalisez le nom du contact avant envoi.'],
    sent: false,
    published: false,
    persisted: false
  }
};
