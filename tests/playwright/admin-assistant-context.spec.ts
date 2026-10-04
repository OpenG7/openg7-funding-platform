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
async function fixtures(page: Page, role?: 'reader' | 'operator' | 'owner') {
  await page.addInitScript((oidc) => {
    sessionStorage.setItem(
      'openg7-admin-session-token',
      oidc ? 'openg7-admin-session.cookie' : 'openg7-admin-session.ui-fixture'
    );
    sessionStorage.setItem(
      'openg7-admin-session-expires-at',
      '2099-01-01T00:00:00Z'
    );
  }, Boolean(role));
  const calls: {
    path: string;
    method: string;
    body: Record<string, unknown> | null;
  }[] = [];
  const options = {
    contextStatus: 200,
    sendStatus: 200,
    queryStatus: 200,
    prepareStatus: 200,
    contextVersion: 'a'.repeat(64),
    role,
    identityId: 'assistant-fixture',
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
    if (url.pathname === '/api/admin/auth/current' && options.role)
      return route.fulfill({
        json: {
          id: options.identityId,
          sessionId: 'assistant-session',
          displayName: 'Assistant fixture',
          role: options.role,
          expiresAt: '2099-01-01T00:00:00Z'
        }
      });
    if (url.pathname === '/api/admin/assistant/context')
      return route.fulfill({
        status: options.contextStatus,
        json: {
          ...response(url.searchParams.get('sponsorshipId') || id),
          conversationMode: options.mode,
          status: options.state,
          context:
            options.state === 'ok'
              ? {
                  ...response(url.searchParams.get('sponsorshipId') || id)
                    .context!,
                  version: options.contextVersion
                }
              : null
        }
      });
    if (url.pathname === '/api/admin/assistant/prepare')
      return route.fulfill({
        status: options.prepareStatus,
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

for (const status of [200, 401]) {
  test(`a late preparation response (${status}) cannot affect a newly selected dossier`, async ({
    page
  }) => {
    await fixtures(page);
    await page.goto(path());
    await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
      'DEMO-301'
    );
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/admin/assistant/prepare', async (route) => {
      await held;
      await route.fulfill({ status, json: proposal });
    });
    const started = page.waitForRequest('**/api/admin/assistant/prepare');
    await page
      .getByRole('button', { name: 'Demander des informations' })
      .click();
    await started;
    await page.evaluate((next) => {
      history.pushState({}, '', next);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, path(secondId));
    await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
      'DEMO-302'
    );
    const finished = page.waitForResponse('**/api/admin/assistant/prepare');
    release();
    await finished;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await expect(page).toHaveURL(path(secondId));
    await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
      'DEMO-302'
    );
    await expect(
      page.locator('[data-og7="assistant-information-form"]')
    ).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Actualiser le contexte' })
    ).toBeEnabled();
  });
}

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

async function sponsorshipFixture(page: Page) {
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
}

for (const width of [1920, 1280, 390]) {
  test(`open dossier reveals and focuses the selected sponsorship details at ${width}px`, async ({
    page
  }) => {
    const { calls } = await fixtures(page);
    await sponsorshipFixture(page);
    await page.setViewportSize({ width, height: 844 });
    const url = `/admin/fundraiser/sponsors?sponsorshipId=${id}`;
    await page.goto(url);
    const open = page
      .locator('[data-og7="assistant-next-step"]')
      .getByText('Ouvrir le dossier', { exact: true });
    const details = page.getByRole('region', {
      name: "Vue d'ensemble",
      exact: true
    });
    await expect(open).toBeVisible();
    await open.click();
    await expect(details).toBeFocused();
    await expect(
      details.getByRole('heading', { name: 'Entreprise & contact' })
    ).toBeInViewport();
    await expect(details).toContainText('Atelier démo');
    await expect(page).toHaveURL(url);

    // Opening the same dossier again must also work from the keyboard.
    await open.focus();
    await open.press('Enter');
    await expect(details).toBeFocused();
    await expect(
      details.getByRole('heading', { name: 'Entreprise & contact' })
    ).toBeInViewport();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

test('selected sponsorship opens its exact Assistant context', async ({
  page
}) => {
  await fixtures(page);
  await sponsorshipFixture(page);
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
  await expect(
    page.getByRole('link', { name: 'Ouvrir l’Assistant pour ce dossier' })
  ).toHaveCount(0);
});

for (const language of ['fr', 'en'] as const) {
  test(`opening the Assistant preserves private edits only for this navigation in ${language}`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    options.mode = 'mock';
    await sponsorshipFixture(page);
    await page.setViewportSize({
      width: language === 'en' ? 390 : 1280,
      height: 844
    });
    await page.goto(
      `/admin/fundraiser/sponsors?sponsorshipId=${id}&tab=overview`
    );
    if (language === 'en')
      await page
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
    const context = page.locator('[data-og7="assistant-context"]');
    const question = context.getByLabel(
      language === 'en'
        ? 'Question about this record'
        : 'Question sur ce dossier',
      { exact: true }
    );
    await question.fill('Que manque-t-il ?');
    await context
      .getByRole('button', {
        name: language === 'en' ? 'Ask question' : 'Poser la question',
        exact: true
      })
      .click();
    await expect(
      context.locator('[data-og7="assistant-answer"]')
    ).toBeVisible();
    await context
      .getByRole('button', {
        name:
          language === 'en'
            ? 'Request information'
            : 'Demander des informations'
      })
      .click();
    await context
      .getByLabel(language === 'en' ? 'Subject' : 'Objet', { exact: true })
      .fill('PRIVATE-SUBJECT-301');
    await context
      .getByLabel('Message', { exact: true })
      .fill('PRIVATE-BODY-301');
    await question.fill('PRIVATE-QUESTION-301');
    const workspace = context.getByRole('link', {
      name:
        language === 'en'
          ? 'Open Assistant for this record'
          : 'Ouvrir l’Assistant pour ce dossier'
    });
    await workspace.focus();
    await workspace.press('Enter');
    await expect(page).toHaveURL(path());
    await expect(
      context.getByLabel(language === 'en' ? 'Subject' : 'Objet', {
        exact: true
      })
    ).toHaveValue('PRIVATE-SUBJECT-301');
    await expect(context.getByLabel('Message', { exact: true })).toHaveValue(
      'PRIVATE-BODY-301'
    );
    await expect(question).toHaveValue('PRIVATE-QUESTION-301');
    await expect(
      context.locator('[data-og7="assistant-answer"]')
    ).toBeVisible();
    await expect(workspace).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(calls.filter((call) => call.path.endsWith('/prepare'))).toHaveLength(
      1
    );
    expect(calls.filter((call) => call.path.endsWith('/query'))).toHaveLength(
      1
    );
    expect(
      calls.some((call) => call.path.endsWith('request-information'))
    ).toBe(false);
    const persisted = await page.evaluate(() =>
      JSON.stringify({
        url: location.href,
        history: history.state,
        local: { ...localStorage },
        session: { ...sessionStorage }
      })
    );
    expect(persisted).not.toContain('PRIVATE-');
    expect(persisted).not.toContain('demo@example.invalid');
    await page.reload();
    await expect(question).toHaveValue('');
    await expect(
      context.locator('[data-og7="assistant-information-form"]')
    ).toHaveCount(0);
    await expect(context.locator('[data-og7="assistant-answer"]')).toHaveCount(
      0
    );
  });
}

test('opening the Assistant invalidates a draft when the dossier version changed', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.mode = 'mock';
  await sponsorshipFixture(page);
  await page.goto(`/admin/fundraiser/sponsors?sponsorshipId=${id}`);
  await page.getByRole('button', { name: 'Demander des informations' }).click();
  await page.getByLabel('Message', { exact: true }).fill('Private stale draft');
  await page
    .getByLabel('Question sur ce dossier', { exact: true })
    .fill('Ma question');
  options.contextVersion = 'b'.repeat(64);
  await page
    .getByRole('link', { name: 'Ouvrir l’Assistant pour ce dossier' })
    .click();
  await expect(page).toHaveURL(path());
  await expect(page.getByRole('alert')).toContainText('Le dossier a changé');
  await expect(
    page.locator('[data-og7="assistant-information-form"]')
  ).toHaveCount(0);
  await expect(
    page.getByLabel('Question sur ce dossier', { exact: true })
  ).toHaveValue('Ma question');
  expect(calls.some((call) => call.path.endsWith('request-information'))).toBe(
    false
  );
});

test('reader can consult and ask without preparation controls', async ({
  page
}) => {
  const { calls, options } = await fixtures(page, 'reader');
  options.mode = 'mock';
  await page.goto(path());
  const context = page.locator('[data-og7="assistant-context"]');
  await expect(context.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-301'
  );
  await expect(
    context.getByRole('button', { name: /Demander des informations|Préparer/ })
  ).toHaveCount(0);
  await context
    .getByLabel('Question sur ce dossier', { exact: true })
    .fill('Que manque-t-il ?');
  await context
    .getByRole('button', { name: 'Poser la question', exact: true })
    .click();
  await expect(context.locator('[data-og7="assistant-answer"]')).toBeVisible();
  expect(
    calls.some(
      (call) =>
        call.path.endsWith('/prepare') ||
        call.path.endsWith('request-information')
    )
  ).toBe(false);
});

for (const readStatus of [200, 403, 401]) {
  test(`action denial rechecks dossier access with read status ${readStatus}`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page, 'operator');
    await page.goto(path());
    await page
      .getByRole('button', { name: 'Demander des informations' })
      .click();
    await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
    options.prepareStatus = 403;
    options.contextStatus = readStatus;
    await page.getByRole('button', { name: 'Préparer la revue' }).click();
    if (readStatus === 200) {
      await expect(page.getByRole('alert')).toContainText(
        'Cette action n’est pas autorisée'
      );
      await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
        'DEMO-301'
      );
      await expect(
        page.getByText('Vous n’avez pas accès à ce dossier.')
      ).toHaveCount(0);
    } else if (readStatus === 403) {
      await expect(
        page.getByText('Vous n’avez pas accès à ce dossier.')
      ).toBeVisible();
      await expect(
        page.locator('[data-og7="assistant-reference"]')
      ).toHaveCount(0);
    } else await expect(page).toHaveURL(/\/admin\/login\?returnUrl=/);
    await expect(
      page.locator('[data-og7="assistant-information-form"]')
    ).toHaveCount(0);
    expect(calls.filter((call) => call.path.endsWith('/context'))).toHaveLength(
      2
    );
    expect(calls.filter((call) => call.path.endsWith('/prepare'))).toHaveLength(
      2
    );
  });
}

test('a delayed access recheck cannot attach its error to another dossier', async ({
  page
}) => {
  const { options } = await fixtures(page);
  options.prepareStatus = 403;
  await page.goto(path());
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-301'
  );
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
  const recheck = page.waitForRequest(
    `**/assistant/context?sponsorshipId=${id}`
  );
  await page.getByRole('button', { name: 'Demander des informations' }).click();
  await recheck;
  await page.evaluate((next) => {
    history.pushState({}, '', next);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path(secondId));
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-302'
  );
  const finished = page.waitForResponse(
    `**/assistant/context?sponsorshipId=${id}`
  );
  release();
  await finished;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-302'
  );
});

test('navigation cannot restore private edits for a different administrator', async ({
  page
}) => {
  const { options } = await fixtures(page, 'operator');
  options.mode = 'mock';
  await sponsorshipFixture(page);
  await page.goto(`/admin/fundraiser/sponsors?sponsorshipId=${id}`);
  await page.getByRole('button', { name: 'Demander des informations' }).click();
  await page.getByLabel('Message', { exact: true }).fill('Private draft');
  await page
    .getByLabel('Question sur ce dossier', { exact: true })
    .fill('Private question');
  options.identityId = 'another-admin';
  await page
    .getByRole('link', { name: 'Ouvrir l’Assistant pour ce dossier' })
    .click();
  await expect(page).toHaveURL(path());
  await expect(
    page.getByLabel('Question sur ce dossier', { exact: true })
  ).toHaveValue('');
  await expect(
    page.locator('[data-og7="assistant-information-form"]')
  ).toHaveCount(0);
});

test('each return from a dossier reloads the global Assistant queue once without loading optional private panels', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  const queueReads: URL[] = [];
  const overviewReads = () =>
    queueReads.filter((url) => url.searchParams.get('overview') === 'true');
  await page.route('**/api/admin/attention?*', (route) => {
    queueReads.push(new URL(route.request().url()));
    return route.fulfill({
      json: {
        generatedAt: '2026-09-16T14:00:00Z',
        counts: { urgent: 0, today: 0, this_week: 0, informational: 0 },
        available: true,
        coverage: 'complete',
        missingSources: [],
        timezone: 'America/Toronto',
        total: 0,
        filteredTotal: 0,
        todayTotal: 0,
        typeCounts: {},
        page: 1,
        pageSize: 15,
        items: []
      }
    });
  });
  await page.goto(path());
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-301'
  );
  expect(overviewReads()).toHaveLength(0);
  await page
    .getByRole('navigation', { name: 'Navigation admin du fonds' })
    .getByRole('link', { name: 'Assistant', exact: true })
    .click();
  await expect(page).toHaveURL('/admin/fundraiser/assistant');
  await expect(page.locator('[data-og7="assistant-count"]')).toContainText(
    '0 résultat(s) sur 0 intervention(s).'
  );
  expect(overviewReads()).toHaveLength(1);
  await page.evaluate((next) => {
    history.pushState({}, '', next);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path());
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-301'
  );
  await page
    .getByRole('navigation', { name: 'Navigation admin du fonds' })
    .getByRole('link', { name: 'Assistant', exact: true })
    .click();
  await expect(page).toHaveURL('/admin/fundraiser/assistant');
  await expect(page.locator('[data-og7="assistant-count"]')).toContainText(
    '0 résultat(s) sur 0 intervention(s).'
  );
  expect(overviewReads()).toHaveLength(2);
  expect(
    overviewReads().every(
      (url) =>
        url.searchParams.get('pageSize') === '15' &&
        !url.searchParams.has('itemId')
    )
  ).toBe(true);
  expect(
    calls.some(
      (call) => call.path.endsWith('/summary') || call.path.endsWith('/query')
    )
  ).toBe(false);
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});
