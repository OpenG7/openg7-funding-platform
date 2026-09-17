import type { Page } from '@playwright/test';
import type {
  AdminAssistantContextResponse,
  AdminAssistantPrepareResponse,
  AdminSponsorshipRecord
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const id = '10000000-0000-4000-8000-000000000301';
const secondId = '10000000-0000-4000-8000-000000000302';
const path = (value = id) =>
  `/admin/fundraiser/assistant?sponsorshipId=${value}`;
const response = (value = id): AdminAssistantContextResponse => ({
  status: 'ok',
  generatedAt: '2026-09-16T14:00:00Z',
  conversationMode: 'disabled',
  context: {
    contributionId: value,
    reference: value === id ? 'DEMO-301' : 'DEMO-302',
    version: 'a'.repeat(64),
    paymentStatus: 'paid',
    refundStatus: 'not_requested',
    reviewStatus: 'pending_review',
    feedStatus: 'not_planned',
    publicConsent: false,
    missingFields: ['photo_presentation'],
    media: { total: 1, approved: 1, pending: 0, rejected: 0 },
    promisedChannels: ['facebook', 'linkedin'],
    coveredChannels: [],
    nextStep: 'complete_information',
    adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${value}`,
    canRequestInformation: true
  }
});
const proposal: AdminAssistantPrepareResponse = {
  status: 'ok',
  message: null,
  draft: {
    type: 'sponsorship_reminder',
    title: 'Relance DEMO-301',
    generatedAt: '2026-09-16T14:00:00Z',
    reference: 'DEMO-301',
    sent: false,
    published: false,
    persisted: false,
    fields: [{ label: 'Objet', value: 'Compléter la fiche' }],
    bodyLines: ['Bonjour,', 'Merci de transmettre une photo.'],
    notice: 'Aucun envoi effectué.',
    limitations: [],
    adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${id}`
  },
  delivery: {
    contributionId: id,
    contextVersion: 'a'.repeat(64),
    recipient: 'demo@example.invalid',
    subject: 'Compléter la fiche',
    body: 'Bonjour,\nMerci de transmettre une photo.'
  }
};
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
    method: string;
    body: Record<string, unknown> | null;
  }[] = [];
  const options = {
    contextStatus: 200,
    sendStatus: 200,
    queryStatus: 200,
    mode: 'disabled' as 'disabled' | 'mock',
    state: 'ok' as AdminAssistantContextResponse['status']
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    calls.push({
      path: url.pathname,
      method: req.method(),
      body: req.postData()
        ? (req.postDataJSON() as Record<string, unknown>)
        : null
    });
    if (url.pathname === '/api/admin/assistant/context')
      return route.fulfill({
        status: options.contextStatus,
        json: {
          ...response(url.searchParams.get('sponsorshipId') || id),
          conversationMode: options.mode,
          status: options.state,
          ...(options.state !== 'ok' ? { context: null } : {})
        }
      });
    if (url.pathname === '/api/admin/assistant/prepare')
      return route.fulfill({
        json:
          req.postDataJSON().language === 'en'
            ? {
                ...proposal,
                draft: {
                  ...proposal.draft,
                  title: 'Information request DEMO-301',
                  fields: [
                    { label: 'Subject', value: 'Complete your profile' }
                  ],
                  notice: 'No email sent.'
                },
                delivery: {
                  ...proposal.delivery,
                  subject: 'Complete your profile',
                  body: 'Hello, please upload a presentation image.'
                }
              }
            : proposal
      });
    if (url.pathname === '/api/admin/sponsorships/request-information')
      return route.fulfill({
        status: options.sendStatus,
        json: { status: 'queued', messageId: secondId }
      });
    if (url.pathname === '/api/admin/assistant/query')
      return route.fulfill({
        status: options.queryStatus,
        json: {
          status: 'ok',
          mode: 'mock',
          enabled: true,
          generatedAt: '2026-09-16T14:00:00Z',
          provider: { name: 'mock', model: null },
          toolInvocations: [],
          links: [],
          answer: [
            {
              kind: 'facts',
              title: 'État constaté',
              lines: ['Paiement confirmé.']
            },
            {
              kind: 'interpretation',
              title: 'Interprétation prudente',
              lines: ['Fiche incomplète.']
            },
            {
              kind: 'recommendation',
              title: 'Action proposée',
              lines: ['Réviser la fiche.']
            }
          ],
          limitations: ['Dossier sélectionné uniquement.']
        }
      });
    return route.fulfill({
      status: 503,
      json: { error: 'Synthetic fixture unavailable' }
    });
  });
  return { calls, options };
}

test('deterministic dossier facts and recommendation work with conversation disabled', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(path());
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-301'
  );
  await expect(page.locator('[data-og7="assistant-facts"]')).toContainText(
    'Payé'
  );
  await expect(page.locator('[data-og7="assistant-facts"]')).toContainText(
    'Non accordé'
  );
  await expect(page.locator('[data-og7="assistant-next-step"]')).toContainText(
    'Compléter les informations'
  );
  await expect(page.getByText(/Conversation désactivée/)).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Ouvrir le dossier', exact: true })
  ).toHaveAttribute('href', `/admin/fundraiser/sponsors?sponsorshipId=${id}`);
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
  expect(calls.some((call) => call.path.endsWith('/summary'))).toBe(false);
});

test('information draft requires reviewed recipient and explicit confirmation, Escape restores focus', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await page.goto(path());
  await page.getByRole('button', { name: 'Demander des informations' }).click();
  await expect(page.locator('[data-og7="assistant-draft"]')).toContainText(
    'Brouillon non envoyé'
  );
  await expect(page.getByLabel('Destinataire', { exact: true })).toHaveValue(
    'demo@example.invalid'
  );
  expect(
    calls.filter((call) => call.path.endsWith('request-information'))
  ).toHaveLength(0);
  await page
    .getByLabel('Message', { exact: true })
    .fill('Bonjour, merci de compléter la photo.');
  const review = page.getByRole('button', { name: 'Vérifier l’envoi' });
  await review.click();
  await expect(page.getByRole('dialog')).toContainText('demo@example.invalid');
  await expect(page.getByRole('dialog')).toContainText(
    'Bonjour, merci de compléter la photo.'
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(review).toBeFocused();
  expect(
    calls.filter((call) => call.path.endsWith('request-information'))
  ).toHaveLength(0);
  await review.click();
  await page
    .getByRole('button', { name: 'Confirmer l’envoi', exact: true })
    .click();
  await expect(
    page.locator('[data-og7="assistant-delivery-result"]')
  ).toContainText('Demande mise en file');
  expect(
    calls.filter((call) => call.path.endsWith('request-information'))
  ).toHaveLength(1);
  expect(
    calls.find((call) => call.path.endsWith('request-information'))?.body
  ).toMatchObject({
    contributionId: id,
    recipient: 'demo@example.invalid',
    confirmed: true,
    body: 'Bonjour, merci de compléter la photo.'
  });
  await expect(
    page.getByRole('link', { name: 'Suivre le courriel' })
  ).toHaveAttribute(
    'href',
    `/admin/fundraiser/email-queue?messageId=${secondId}`
  );
});

test('stale context invalidates the draft until it is prepared again', async ({
  page
}) => {
  const { options } = await fixtures(page);
  options.sendStatus = 409;
  await page.goto(path());
  await page.getByRole('button', { name: 'Demander des informations' }).click();
  await page.getByRole('button', { name: 'Vérifier l’envoi' }).click();
  await page
    .getByRole('button', { name: 'Confirmer l’envoi', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('Le dossier a changé');
  await expect(
    page.locator('[data-og7="assistant-information-form"]')
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Actualiser le contexte' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-301'
  );
});

test('conversation scopes its request and separates facts, interpretation and limits', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.mode = 'mock';
  await page.goto(path());
  await page
    .getByLabel('Question sur ce dossier', { exact: true })
    .fill('Que manque-t-il ?');
  await page
    .getByRole('button', { name: 'Poser la question', exact: true })
    .click();
  await expect(
    page.locator('[data-og7="assistant-facts"]').last()
  ).toContainText('Paiement confirmé.');
  await expect(
    page.locator('[data-og7="assistant-interpretation"]')
  ).toContainText('Fiche incomplète');
  await expect(page.locator('[data-og7="assistant-answer"]')).toContainText(
    'Dossier sélectionné uniquement'
  );
  expect(
    calls.find((call) => call.path.endsWith('/query'))?.body?.['sponsorshipId']
  ).toBe(id);
  options.queryStatus = 503;
  await page
    .getByRole('button', { name: 'Poser la question', exact: true })
    .click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('[data-og7="assistant-next-step"]')).toContainText(
    'Compléter les informations'
  );
  expect(calls.some((call) => call.path.endsWith('request-information'))).toBe(
    false
  );
});

for (const [status, text] of [
  ['not_found', 'Commandite introuvable'],
  ['empty', 'Aucune commandite'],
  ['unavailable', 'Vérifiez la configuration']
] as const) {
  test(`context displays ${status} without a substitute dossier`, async ({
    page
  }) => {
    const { options } = await fixtures(page);
    options.state = status;
    await page.goto(path());
    await expect(page.locator('[data-og7="assistant-context"]')).toContainText(
      text
    );
    await expect(page.locator('[data-og7="assistant-reference"]')).toHaveCount(
      0
    );
  });
}

test('late context responses cannot overwrite a newly selected dossier', async ({
  page
}) => {
  await fixtures(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/assistant/context?sponsorshipId=${id}`,
    async (route) => {
      await held;
      await route.fulfill({ json: response(id) });
    }
  );
  await page.goto(path());
  await expect(page.getByText('Chargement du contexte…')).toBeVisible();
  await page.evaluate((next) => {
    history.pushState({}, '', next);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path(secondId));
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-302'
  );
  release();
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-302'
  );
  await expect(
    page.getByRole('link', { name: 'Ouvrir le dossier', exact: true })
  ).toHaveAttribute(
    'href',
    `/admin/fundraiser/sponsors?sponsorshipId=${secondId}`
  );
});

test('mobile English context has no horizontal overflow and uses English preparation', async ({
  page
}, testInfo) => {
  const { calls } = await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path());
  await page
    .getByRole('button', { name: 'Switch administration language to English' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Contextual assistant' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Request information' }).click();
  expect(
    calls.find((call) => call.path.endsWith('/prepare'))?.body?.['language']
  ).toBe('en');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('assistant-mobile.png'),
    fullPage: true
  });
});

test('failed context is retryable and forbidden responses clear private drafts', async ({
  page
}) => {
  const { options } = await fixtures(page);
  options.contextStatus = 503;
  await page.goto(path());
  await expect(
    page.getByText('Le contexte est indisponible. Vous pouvez réessayer.')
  ).toBeVisible();
  options.contextStatus = 200;
  await page.getByRole('button', { name: 'Actualiser le contexte' }).click();
  await page.getByRole('button', { name: 'Demander des informations' }).click();
  await expect(page.getByLabel('Destinataire', { exact: true })).toBeVisible();
  options.contextStatus = 403;
  await page.getByRole('button', { name: 'Actualiser le contexte' }).click();
  await expect(
    page.getByText('Vous n’avez pas accès à ce dossier.')
  ).toBeVisible();
  await expect(page.getByLabel('Destinataire', { exact: true })).toHaveCount(0);
});

test('expired session redirects to login without retaining dossier content', async ({
  page
}) => {
  const { options } = await fixtures(page);
  options.contextStatus = 401;
  await page.goto(path());
  await expect(page).toHaveURL(/\/admin\/login\?returnUrl=/);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('openg7-admin-session-token')
    )
  ).toBeNull();
});

test('cockpit contextual recommendation loads independently from dashboard metrics', async ({
  page
}) => {
  await fixtures(page);
  await page.goto('/admin/fundraiser');
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-301'
  );
  await expect(page.locator('[data-og7="assistant-next-step"]')).toBeVisible();
  await expect(page.locator('[data-og7="assistant-facts"]')).not.toBeVisible();
  await page.locator('[data-og7="assistant-context"] summary').click();
  await expect(page.locator('[data-og7="assistant-facts"]')).toBeVisible();
});

test('selected sponsorship opens its exact Assistant context', async ({
  page
}) => {
  await fixtures(page);
  const record: AdminSponsorshipRecord = {
    id,
    version: '2026-09-16T14:00:00Z',
    public_reference: 'DEMO-301',
    contribution_type: 'sponsorship_interest',
    amount: 500,
    currency: 'CAD',
    payment_status: 'paid',
    paid_at: '2026-09-01T14:00:00Z',
    public_name: null,
    public_display_consent: false,
    display_amount_consent: false,
    sponsor_company_name: 'Atelier démo',
    sponsor_contact_name: null,
    sponsor_contact_email: 'demo@example.invalid',
    sponsor_website_url: null,
    sponsor_logo_url: null,
    sponsor_message: null,
    sponsor_details_submitted_at: null,
    sponsor_review_status: 'pending_review',
    sponsor_review_note: null,
    sponsor_reviewed_at: null,
    sponsor_public_slug: null,
    sponsor_public_summary: null,
    sponsor_feed_target: null,
    sponsor_feed_channels: [],
    sponsor_feed_status: 'not_planned',
    sponsor_feed_public_url: null,
    sponsor_feed_notes: null,
    sponsor_visibility_updated_at: null,
    sponsorship_refund_status: 'not_requested',
    sponsorship_refund_requested_at: null,
    sponsorship_refund_processed_at: null,
    sponsorship_refund_completed_at: null,
    sponsorship_refund_id: null,
    sponsorship_refund_amount: null,
    sponsorship_refund_reason: null,
    sponsorship_refund_note: null,
    sponsorship_refund_error: null,
    admin_audit_entries: [],
    created_at: '2026-09-01T14:00:00Z',
    updated_at: '2026-09-16T14:00:00Z'
  };
  await page.route('**/api/admin/sponsorships?*', (route) =>
    route.fulfill({
      json: {
        data_source: 'database',
        items: [record],
        sponsorships: [record],
        pagination: {
          page: 1,
          pageSize: 10,
          totalItems: 1,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false
        },
        last_updated_at: record.updated_at
      }
    })
  );
  await page.goto(`/admin/fundraiser/sponsors?sponsorshipId=${id}`);
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-301'
  );
  await page
    .getByRole('link', { name: 'Ouvrir l’Assistant pour ce dossier' })
    .click();
  await expect(page).toHaveURL(path());
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-301'
  );
});

test('returning from a dossier to the global Assistant reloads its summary', async ({
  page
}) => {
  await fixtures(page);
  await page.route('**/api/admin/assistant/summary', (route) =>
    route.fulfill({
      json: {
        generatedAt: '2026-09-16T14:00:00Z',
        counts: { urgent: 0, today: 0, thisWeek: 0, informational: 0 },
        sponsorships: { needsInfo: 0, needsReview: 0, approved: 0 },
        publications: { needsPreparation: 0, scheduled: 0, late: 0 },
        emails: { failed: 0 },
        attentionItems: []
      }
    })
  );
  await page.goto(path());
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-301'
  );
  await page
    .getByRole('navigation', { name: 'Navigation admin du fonds' })
    .getByRole('link', { name: 'Assistant', exact: true })
    .click();
  await expect(page).toHaveURL('/admin/fundraiser/assistant');
  await expect(
    page.getByRole('heading', { name: 'Aucune action urgente' })
  ).toBeVisible();
});
