import type { Locator, Page } from '@playwright/test';
import type {
  AdminAssistantContextResponse,
  AdminAssistantPrepareResponse,
  AdminInformationRequest,
  AdminSponsorshipProgressResponse,
  AdminSponsorshipRecord
} from '@openg7/funding-core';

import { expect, sampledFrames, test } from './support/test.js';
import {
  blockAdminReviewWrites,
  captureAdminDesign,
  expectAdminPageFits,
  prepareAdminDesignReview
} from './support/admin-design-review.js';

const id = '10000000-0000-4000-8000-000000000301';
const secondId = '10000000-0000-4000-8000-000000000302';
const path = (value = id) =>
  `/admin/fundraiser/assistant?sponsorshipId=${value}`;
const dossierPath = (tab = 'overview', fragment?: string) =>
  `/admin/fundraiser/sponsors?sponsorshipId=${id}&tab=${tab}${fragment ? `#${fragment}` : ''}`;
const assistantLocation = (url: URL) => ({
  pathname: url.pathname,
  query: Object.fromEntries(url.searchParams),
  fragment: url.hash
});
const contextualAssistantLocation = (origin: string) => ({
  pathname: '/admin/fundraiser/assistant',
  query: { sponsorshipId: id, returnTo: origin },
  fragment: ''
});
async function expectAssistantLinkOrigin(link: Locator, origin: string) {
  await expect
    .poll(async () => {
      const href = await link.getAttribute('href');
      return href ? assistantLocation(new URL(href, 'http://127.0.0.1')) : null;
    })
    .toEqual(contextualAssistantLocation(origin));
}
async function expectAssistantPageOrigin(page: Page, origin: string) {
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/admin/fundraiser/assistant' &&
      url.searchParams.size === 2 &&
      url.searchParams.get('sponsorshipId') === id &&
      url.searchParams.get('returnTo') === origin &&
      url.hash === ''
  );
}
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
  let informationRequest: AdminInformationRequest | null = null;
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
    receiptStatus: 200,
    receiptFound: false,
    receiptDeliveryStatus: 'queued' as
      'queued' | 'sending' | 'sent' | 'failed' | 'uncertain',
    receiptMismatch: false,
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
    if (url.pathname === '/api/admin/assistant/prepare') {
      const currentProposal = {
        ...proposal,
        delivery: {
          ...proposal.delivery!,
          contextVersion: options.contextVersion
        }
      };
      return route.fulfill({
        status: options.prepareStatus,
        json:
          req.postDataJSON().language === 'en'
            ? {
                ...currentProposal,
                draft: {
                  ...proposal.draft,
                  title: 'Information request DEMO-301',
                  fields: [
                    { label: 'Subject', value: 'Complete your profile' }
                  ],
                  notice: 'No email sent.'
                },
                delivery: {
                  ...currentProposal.delivery,
                  subject: 'Complete your profile',
                  body: 'Hello, please upload a presentation image.'
                }
              }
            : currentProposal
      });
    }
    if (url.pathname === '/api/admin/sponsorships/request-information') {
      informationRequest = req.postDataJSON() as AdminInformationRequest;
      return route.fulfill({
        status: options.sendStatus,
        json: {
          status: 'queued',
          messageId: secondId,
          requestId: informationRequest.requestId,
          acceptedAt: '2026-10-19T20:00:00.000Z',
          deliveryStatus: 'queued',
          sentAt: null
        }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/information-request-receipt')
      return route.fulfill({
        status: options.receiptStatus,
        json: {
          requestId: options.receiptMismatch
            ? secondId
            : url.searchParams.get('requestId'),
          contributionId: url.searchParams.get('contributionId'),
          found: options.receiptFound,
          ...(options.receiptFound
            ? {
                messageId: secondId,
                acceptedAt: '2026-10-19T20:00:00.000Z',
                deliveryStatus: options.receiptDeliveryStatus,
                sentAt:
                  options.receiptDeliveryStatus === 'sent'
                    ? '2026-10-19T20:01:00.000Z'
                    : null
              }
            : {})
        }
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

for (const language of ['fr-CA', 'en'] as const)
  for (const width of [390, 1536]) {
    test(`context composition keeps confirmed facts and its next step readable in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await prepareAdminDesignReview(page);
      await fixtures(page, 'reader');
      const writes = await blockAdminReviewWrites(page);
      await page.addInitScript((locale) => {
        localStorage.setItem('openg7.language', locale);
      }, language);
      await page.setViewportSize({
        width,
        height: width === 1536 ? 864 : 1000
      });
      await page.goto(path());
      const context = page.locator('[data-og7="assistant-context"]');
      const facts = context.locator('[data-og7="assistant-facts"]');
      const next = context.locator('[data-og7="assistant-next-step"]');
      await expect(
        context.locator('[data-og7="assistant-reference"]')
      ).toHaveText('DEMO-301');
      await expect(facts).toContainText(language === 'en' ? 'Paid' : 'Payé');
      await expect(facts).toContainText(
        language === 'en' ? 'Not granted' : 'Non accordé'
      );
      await expect(next.getByRole('link')).toHaveAttribute(
        'href',
        `/admin/fundraiser/sponsors?sponsorshipId=${id}`
      );
      await captureAdminDesign(page, testInfo, `assistant-context-${width}`);
      if (width === 1536) {
        await expect(next.getByRole('heading')).toBeInViewport({ ratio: 1 });
      }
      const disclosure = facts.locator('..').locator('summary');
      await disclosure.focus();
      await page.keyboard.press('Enter');
      await expect(facts).toBeHidden();
      await page.keyboard.press('Enter');
      await expect(facts).toBeVisible();
      if (language === 'en') {
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
        });
        await expectAdminPageFits(page);
        await expect(next.getByRole('link')).toBeVisible();
      }
      expect(writes).toEqual([]);
    });
  }

for (const sample of [
  {
    theme: 'mineral',
    language: 'fr-CA',
    width: 390,
    panel: 'rgb(255, 255, 255)',
    raised: 'rgb(240, 244, 249)',
    background: 'rgb(245, 247, 251)',
    text: 'rgb(23, 43, 80)'
  },
  {
    theme: 'night',
    language: 'en',
    width: 1280,
    panel: 'rgb(20, 35, 56)',
    raised: 'rgb(27, 45, 68)',
    background: 'rgb(11, 23, 39)',
    text: 'rgb(241, 245, 252)'
  },
  {
    theme: 'graphite',
    language: 'fr-CA',
    width: 390,
    panel: 'rgb(37, 41, 47)',
    raised: 'rgb(50, 56, 65)',
    background: 'rgb(25, 27, 31)',
    text: 'rgb(243, 244, 246)'
  }
]) {
  test(`context facts and cancelled delivery review remain readable with ${sample.theme} in ${sample.language}`, async ({
    page
  }) => {
    const { calls } = await fixtures(page);
    await page.addInitScript(({ language, theme }) => {
      localStorage.setItem('openg7.language', language);
      localStorage.setItem(
        'openg7.pilotage.appearance.v1',
        JSON.stringify({ theme, system: false })
      );
    }, sample);
    await page.setViewportSize({ width: sample.width, height: 950 });
    await page.goto(path());
    const english = sample.language === 'en';
    const context = page.locator('[data-og7="assistant-context"]');
    const facts = context.locator('[data-og7="assistant-facts"]').first();
    await expect(
      context.locator('[data-og7="assistant-reference"]')
    ).toHaveText('DEMO-301');
    await expect(context).toHaveCSS('background-color', sample.panel);
    await expect(context.locator('[data-og7="assistant-next-step"]')).toHaveCSS(
      'background-color',
      sample.raised
    );
    const confirmedFacts = await facts.innerText();
    await page
      .getByRole('button', {
        name: english ? 'Request information' : 'Demander des informations',
        exact: true
      })
      .click();
    const recipient = page.getByLabel(english ? 'Recipient' : 'Destinataire', {
      exact: true
    });
    await expect(recipient).toHaveValue('demo@example.invalid');
    await expect(recipient).toHaveAttribute('readonly', '');
    const message = page.getByLabel('Message', { exact: true });
    await expect(message).toHaveCSS('background-color', sample.background);
    await expect(message).toHaveCSS('color', sample.text);
    await message.fill('Message synthétique pour une revue annulée.');
    const review = page.getByRole('button', {
      name: english ? 'Review delivery' : 'Vérifier l’envoi',
      exact: true
    });
    await review.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('background-color', sample.panel);
    await expect(dialog).toContainText('demo@example.invalid');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(review).toBeFocused();
    expect(await facts.innerText()).toBe(confirmedFacts);
    expect(
      calls.filter((call) => call.path.endsWith('request-information'))
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    ).toBe(true);
  });
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
  ).toContainText('Demande enregistrée');
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

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1536]) {
    test(`uncertain information delivery blocks changed requests and survives reload in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize({ width, height: 864 });
      await page.addInitScript((locale) => {
        localStorage.setItem('openg7.language', locale);
      }, language);
      const { calls, options } = await fixtures(page);
      options.sendStatus = 503;
      const english = language === 'en';
      await page.goto(path());
      await page
        .getByRole('button', {
          name: english ? 'Request information' : 'Demander des informations',
          exact: true
        })
        .click();
      await page
        .getByRole('button', {
          name: english ? 'Review delivery' : 'Vérifier l’envoi',
          exact: true
        })
        .click();
      await page
        .getByRole('button', {
          name: english ? 'Confirm delivery' : 'Confirmer l’envoi',
          exact: true
        })
        .click();
      const warning = page.locator(
        '[data-og7="assistant-information-uncertain"]'
      );
      await expect(warning).toBeVisible();
      await expect(
        page.getByLabel(english ? 'Subject' : 'Objet', { exact: true })
      ).toBeDisabled();
      await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
      await expect(
        page.getByRole('button', {
          name: english ? 'Review delivery' : 'Vérifier l’envoi',
          exact: true
        })
      ).toBeDisabled();
      const link = warning.getByRole('link');
      await expect(link).toHaveAttribute(
        'href',
        '/admin/fundraiser/email-queue'
      );
      await link.focus();
      await expect(link).toBeFocused();
      await captureAdminDesign(
        page,
        testInfo,
        `assistant-information-uncertain-${width}`
      );
      await page.reload();
      await expect(warning).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: english ? 'Request information' : 'Demander des informations',
          exact: true
        })
      ).toHaveCount(0);
      expect(
        calls.filter((call) => call.path.endsWith('request-information'))
      ).toHaveLength(1);
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem(
            'openg7-assistant-information-pending:' +
              '10000000-0000-4000-8000-000000000301'
          )
        )
      ).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
      if (width === 1536) {
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
        });
        await expectAdminPageFits(page);
      }
    });
  }
}

const informationMarker = 'openg7-assistant-information-pending:' + id;
async function loseInformationResponse(page: Page, language: 'fr-CA' | 'en') {
  const english = language === 'en';
  await page.goto(path());
  await page
    .getByRole('button', {
      name: english ? 'Request information' : 'Demander des informations',
      exact: true
    })
    .click();
  await page
    .getByRole('button', {
      name: english ? 'Review delivery' : 'Vérifier l’envoi',
      exact: true
    })
    .click();
  await page
    .getByRole('button', {
      name: english ? 'Confirm delivery' : 'Confirmer l’envoi',
      exact: true
    })
    .click();
  await expect(
    page.locator('[data-og7="assistant-information-uncertain"]')
  ).toBeVisible();
  return page.evaluate((key) => sessionStorage.getItem(key), informationMarker);
}

for (const language of ['fr-CA', 'en'] as const)
  for (const width of [390, 1536]) {
    test(`information receipt resolves after reload without another command in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize({ width, height: 864 });
      await page.addInitScript(
        (locale) => localStorage.setItem('openg7.language', locale),
        language
      );
      const { calls, options } = await fixtures(page);
      options.sendStatus = 503;
      options.receiptFound = true;
      const requestId = await loseInformationResponse(page, language);
      expect(requestId).toMatch(
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/
      );
      await page.reload();
      expect(
        calls.filter((c) => c.path.endsWith('information-request-receipt'))
      ).toHaveLength(0);
      const receiptResponse = page.waitForResponse((r) =>
        r.url().includes('/information-request-receipt?')
      );
      const check = page.locator(
        '[data-og7="assistant-information-receipt-check"]'
      );
      await check.focus();
      await check.press('Enter');
      const url = new URL((await receiptResponse).url());
      expect(Object.fromEntries(url.searchParams)).toEqual({
        requestId,
        contributionId: id
      });
      const receipt = page.locator(
        '[data-og7="assistant-information-receipt"]'
      );
      await expect(receipt).toBeVisible();
      await expect(receipt).toBeFocused();
      await expect(receipt.getByRole('link')).toHaveAttribute(
        'href',
        `/admin/fundraiser/email-queue?messageId=${secondId}`
      );
      expect(
        await page.evaluate(
          (key) => sessionStorage.getItem(key),
          informationMarker
        )
      ).toBeNull();
      expect(
        calls.filter((c) => c.path.endsWith('request-information'))
      ).toHaveLength(1);
      await expectAdminPageFits(page);
      if (
        (language === 'fr-CA' && width === 390) ||
        (language === 'en' && width === 1536)
      )
        await page.screenshot({
          path: testInfo.outputPath(
            `information-receipt-${language}-${width}.png`
          ),
          fullPage: true
        });
    });
  }

for (const failure of ['absent', 'unavailable', 'mismatch'] as const)
  test(`information receipt ${failure} keeps the retained command blocked`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    options.sendStatus = 503;
    options.receiptFound = failure !== 'absent';
    options.receiptStatus = failure === 'unavailable' ? 503 : 200;
    options.receiptMismatch = failure === 'mismatch';
    const requestId = await loseInformationResponse(page, 'fr-CA');
    await page
      .locator('[data-og7="assistant-information-receipt-check"]')
      .click();
    await expect(
      page.locator('[data-og7="assistant-information-receipt-error"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-og7="assistant-information-receipt"]')
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        (key) => sessionStorage.getItem(key),
        informationMarker
      )
    ).toBe(requestId);
    await page.reload();
    await expect(
      page.locator('[data-og7="assistant-information-uncertain"]')
    ).toBeVisible();
    expect(
      calls.filter((c) => c.path.endsWith('request-information'))
    ).toHaveLength(1);
  });

test('information sending and uncertain receipts retain one command until delivery resolves', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('openg7.language', 'en'));
  const { calls, options } = await fixtures(page);
  options.sendStatus = 503;
  options.receiptFound = true;
  options.receiptDeliveryStatus = 'sending';
  const requestId = await loseInformationResponse(page, 'en');
  const check = page.locator(
    '[data-og7="assistant-information-receipt-check"]'
  );
  const receipt = page.locator('[data-og7="assistant-information-receipt"]');
  await check.click();
  await expect(receipt).toBeFocused();
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), informationMarker)
  ).toBe(requestId);
  await page.reload();
  options.receiptDeliveryStatus = 'uncertain';
  await check.click();
  await expect(receipt).toBeFocused();
  await expect(check).toBeEnabled();
  options.receiptDeliveryStatus = 'sent';
  await check.click();
  await expect(check).toHaveCount(0);
  await expect(receipt).toBeFocused();
  expect(
    await page.evaluate((key) => sessionStorage.getItem(key), informationMarker)
  ).toBeNull();
  expect(
    calls.filter((c) => c.path.endsWith('request-information'))
  ).toHaveLength(1);
  expect(
    calls.filter((c) => c.path.endsWith('information-request-receipt'))
  ).toHaveLength(3);
});

for (const language of ['fr-CA', 'en'] as const)
  test(`legacy information marker remains blocked without an invented receipt in ${language}`, async ({
    page
  }) => {
    await page.addInitScript(
      ({ locale, key }) => {
        localStorage.setItem('openg7.language', locale);
        sessionStorage.setItem(key, 'pending');
      },
      { locale: language, key: informationMarker }
    );
    const { calls } = await fixtures(page);
    await page.goto(path());
    await expect(
      page.locator('[data-og7="assistant-information-uncertain"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-og7="assistant-information-receipt-check"]')
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        (key) => sessionStorage.getItem(key),
        informationMarker
      )
    ).toBe('pending');
    expect(
      calls.filter(
        (c) =>
          c.path.includes('information-request-receipt') ||
          c.path.endsWith('request-information')
      )
    ).toHaveLength(0);
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
  const reads: string[] = [];
  let record: AdminSponsorshipRecord = {
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
  await page.route('**/api/admin/sponsorships?*', (route) => {
    reads.push(route.request().url());
    return route.fulfill({
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
    });
  });
  return {
    reads,
    renameCompany(name: string) {
      record = { ...record, sponsor_company_name: name };
    }
  };
}

for (const language of ['fr-CA', 'en'] as const) {
  for (const source of ['dossier', 'shell'] as const) {
    test(`Assistant returns to its ${source} origin with the dossier tab, fragment and focus in ${language}`, async ({
      page
    }) => {
      const { calls } = await fixtures(page, 'reader');
      const { reads, renameCompany } = await sponsorshipFixture(page);
      await page.addInitScript((locale) => {
        localStorage.setItem('openg7.language', locale);
      }, language);
      await page.setViewportSize({
        width: language === 'en' ? 390 : 1280,
        height: 844
      });
      const tab = source === 'dossier' ? 'identity' : 'audit';
      const origin = dossierPath(tab, `dossier-${tab}`);
      await page.goto(origin);
      const trigger = page.locator(
        `[data-og7="${source === 'dossier' ? 'dossier-assistant' : 'admin-shell-assistant'}"]`
      );
      await expectAssistantLinkOrigin(trigger, origin);
      await trigger.focus();
      await trigger.press('Enter');
      await expectAssistantPageOrigin(page, origin);
      await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
        'DEMO-301'
      );
      const back = page.locator('[data-og7="assistant-dossier-return"]');
      await expect(back).toHaveAccessibleName(
        language === 'en' ? 'Back to the dossier' : 'Retour au dossier'
      );
      await expect(back).toHaveAttribute('href', origin);
      await expect(
        page.locator('[data-og7="assistant-next-step"]').getByRole('link')
      ).toHaveAttribute(
        'href',
        `/admin/fundraiser/sponsors?sponsorshipId=${id}`
      );
      const initialReads = reads.length;
      renameCompany('Atelier reloaded');
      await back.focus();
      await back.press('Enter');
      await expect(page).toHaveURL(origin);
      await expect.poll(() => reads.length).toBe(initialReads + 1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Atelier reloaded'
      );
      await expect(
        page.locator('[data-og7="dossier-tabs"] [aria-current="page"]')
      ).toHaveAccessibleName(
        source === 'dossier'
          ? language === 'en'
            ? 'Profile & media'
            : 'Fiche et médias'
          : language === 'en'
            ? 'History'
            : 'Historique'
      );
      await expect(page.locator(`#dossier-${tab}`)).toBeVisible();
      await expect(trigger).toBeFocused();
      await expect(page.locator('[data-og7="assistant-context"]')).toHaveCount(
        0
      );
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  }

  test(`Assistant keeps its dossier return when its context read fails in ${language}`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page, 'reader');
    options.contextStatus = 503;
    await sponsorshipFixture(page);
    await page.addInitScript((locale) => {
      localStorage.setItem('openg7.language', locale);
    }, language);
    const origin = dossierPath('identity', 'dossier-identity');
    await page.goto(origin);
    const trigger = page.locator('[data-og7="dossier-assistant"]');
    await trigger.focus();
    await trigger.press('Enter');
    await expectAssistantPageOrigin(page, origin);
    await expect(page.locator('[data-og7="assistant-reference"]')).toHaveCount(
      0
    );
    await expect(page.locator('[data-og7="assistant-context"]')).toContainText(
      language === 'en'
        ? 'Context is unavailable. Please try again.'
        : 'Le contexte est indisponible. Vous pouvez réessayer.'
    );
    const back = page.locator('[data-og7="assistant-dossier-return"]');
    await expect(back).toHaveAttribute('href', origin);
    await back.focus();
    await back.press('Enter');
    await expect(page).toHaveURL(origin);
    await expect(trigger).toBeFocused();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

test('direct Assistant entry without an origin keeps only its canonical dossier action after reload', async ({
  page
}) => {
  const { calls } = await fixtures(page, 'reader');
  await sponsorshipFixture(page);
  await page.goto(path());
  const back = page.locator('[data-og7="assistant-dossier-return"]');
  const reference = page.locator('[data-og7="assistant-reference"]');
  await expect(reference).toHaveText('DEMO-301');
  await expect(back).toHaveCount(0);
  await page.reload();
  await expect(reference).toHaveText('DEMO-301');
  await expect(back).toHaveCount(0);
  const open = page
    .locator('[data-og7="assistant-next-step"]')
    .getByRole('link', { name: 'Ouvrir le dossier', exact: true });
  await expect(open).toHaveAttribute(
    'href',
    `/admin/fundraiser/sponsors?sponsorshipId=${id}`
  );
  await open.focus();
  await open.press('Enter');
  await expect(page).toHaveURL(
    `/admin/fundraiser/sponsors?sponsorshipId=${id}`
  );
  await expect(
    page.locator('[data-og7="sponsorship-dossier"]')
  ).toHaveAttribute('data-og7-id', id);
  await expect(
    page.locator('[data-og7="dossier-assistant"]')
  ).not.toBeFocused();
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

for (const [name, origin] of [
  [
    'another dossier',
    `/admin/fundraiser/sponsors?sponsorshipId=${secondId}&tab=identity#dossier-identity`
  ],
  [
    'an external site',
    `https://external.example.invalid/admin/fundraiser/sponsors?sponsorshipId=${id}&tab=identity#dossier-identity`
  ]
] as const) {
  test(`Assistant rejects a return origin targeting ${name}`, async ({
    page
  }) => {
    const { calls } = await fixtures(page, 'reader');
    await page.goto(`${path()}&returnTo=${encodeURIComponent(origin)}`);
    await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
      'DEMO-301'
    );
    await expect(
      page.locator('[data-og7="assistant-dossier-return"]')
    ).toHaveCount(0);
    await expect(
      page.locator('[data-og7="assistant-next-step"]').getByRole('link')
    ).toHaveAttribute('href', `/admin/fundraiser/sponsors?sponsorshipId=${id}`);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

test('Assistant reconstructs its dossier origin without private or nested query values', async ({
  page
}) => {
  const { calls } = await fixtures(page, 'reader');
  await sponsorshipFixture(page);
  const origin = dossierPath('identity', 'dossier-identity');
  const unsafeOrigin =
    `/admin/fundraiser/sponsors?sponsorshipId=${id}&tab=identity` +
    '&recipient=PRIVATE-RECIPIENT&message=PRIVATE-MESSAGE' +
    '&returnTo=' +
    encodeURIComponent('https://external.example.invalid/PRIVATE-NESTED') +
    '#dossier-identity';
  await page.goto(unsafeOrigin);
  const trigger = page.locator('[data-og7="dossier-assistant"]');
  await expectAssistantLinkOrigin(trigger, origin);
  await trigger.focus();
  await trigger.press('Enter');
  await expectAssistantPageOrigin(page, origin);
  const back = page.locator('[data-og7="assistant-dossier-return"]');
  await expect(back).toHaveAttribute('href', origin);
  await page.goto(`${path()}&returnTo=${encodeURIComponent(unsafeOrigin)}`);
  await expect(back).toHaveAttribute('href', origin);
  await page.reload();
  await expect(back).toHaveAttribute('href', origin);
  await back.focus();
  await back.press('Enter');
  await expect(page).toHaveURL(origin);
  await expect(page.locator('#dossier-identity')).toBeFocused();
  await expect(
    page.locator('[data-og7="dossier-assistant"]')
  ).not.toBeFocused();
  expect(page.url()).not.toContain('PRIVATE-');
  expect(calls.every((call) => call.method === 'GET')).toBe(true);
});

test('Assistant return does not take focus back after a tab change during a pending dossier read', async ({
  page
}) => {
  const { calls } = await fixtures(page, 'reader');
  await sponsorshipFixture(page);
  const projection: AdminSponsorshipProgressResponse = {
    status: 'ok',
    generatedAt: '2026-09-16T14:00:00Z',
    dossier: {
      contributionId: id,
      reference: 'DEMO-301',
      companyName: 'Atelier démo',
      version: 'a'.repeat(64),
      amountMinor: 50000,
      currency: 'CAD',
      paymentStatus: 'paid',
      reviewStatus: 'pending_review',
      publicConsent: false,
      publicEligible: false,
      feedStatus: 'not_planned',
      milestones: [],
      next: {
        reason: 'complete_information',
        tab: 'identity',
        adminUrl: dossierPath('identity', 'dossier-identity')
      },
      documents: [],
      publications: [],
      refund: {
        workflow: 'not_requested',
        state: 'not_required',
        confirmedAmountMinor: 0,
        creditMissing: false,
        hasError: false
      },
      failedEmails: [],
      failedStripeEvents: []
    }
  };
  let blocked = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/admin/sponsorships/progress?*', async (route) => {
    if (blocked) await gate;
    return route.fulfill({ json: projection });
  });
  try {
    const origin = dossierPath('identity', 'dossier-identity');
    await page.goto(origin);
    const progress = page.locator('[data-og7="sponsorship-progress"]');
    await expect(progress).toHaveAttribute('aria-busy', 'false');
    const trigger = page.locator('[data-og7="dossier-assistant"]');
    await trigger.focus();
    await trigger.press('Enter');
    await expectAssistantPageOrigin(page, origin);
    blocked = true;
    const pendingRead = page.waitForRequest(
      '**/api/admin/sponsorships/progress?*'
    );
    const back = page.locator('[data-og7="assistant-dossier-return"]');
    await back.focus();
    await back.press('Enter');
    await pendingRead;
    await expect(progress).toHaveAttribute('aria-busy', 'true');
    const finances = page
      .locator('[data-og7="dossier-tabs"]')
      .getByRole('button', { name: 'Finances', exact: true });
    await finances.focus();
    await finances.press('Enter');
    await expect(page).toHaveURL(dossierPath('billing'));
    await expect(finances).toHaveAttribute('aria-current', 'page');
    await expect(finances).toBeFocused();
    const completedRead = page.waitForResponse(
      '**/api/admin/sponsorships/progress?*'
    );
    release();
    await (await completedRead).finished();
    await expect(progress).toHaveAttribute('aria-busy', 'false');
    await sampledFrames(page);
    await expect(page).toHaveURL(dossierPath('billing'));
    await expect(finances).toHaveAttribute('aria-current', 'page');
    await expect(finances).toBeFocused();
    await expect(trigger).not.toBeFocused();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  } finally {
    release();
  }
});

for (const width of [1920, 1280, 390]) {
  test(`sponsor overview keeps its facts without loading an inline Assistant at ${width}px`, async ({
    page
  }) => {
    const { calls } = await fixtures(page);
    await sponsorshipFixture(page);
    await page.setViewportSize({ width, height: 844 });
    const url = `/admin/fundraiser/sponsors?sponsorshipId=${id}`;
    await page.goto(url);
    const details = page.getByRole('region', {
      name: "Vue d'ensemble",
      exact: true
    });
    const summary = details.locator('[data-og7="dossier-overview-summary"]');
    await expect(
      summary.getByRole('heading', { name: 'Commandite', exact: true })
    ).toBeVisible();
    await expect(summary.locator('code')).toHaveText('DEMO-301');
    await expect(
      summary.getByRole('button', {
        name: 'Consulter la fiche et les médias',
        exact: true
      })
    ).toBeVisible();
    await expect(page.locator('[data-og7="assistant-context"]')).toHaveCount(0);
    await expect(page.locator('[data-og7="assistant-next-step"]')).toHaveCount(
      0
    );
    const assistant = page.locator('[data-og7="dossier-assistant"]');
    await expectAssistantLinkOrigin(assistant, dossierPath());
    await expect(assistant).toBeVisible();
    await expect(page).toHaveURL(url);
    expect(
      calls.some((call) => call.path.startsWith('/api/admin/assistant/'))
    ).toBe(false);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

test('selected sponsorship opens its exact Assistant context', async ({
  page
}) => {
  const { calls } = await fixtures(page);
  await sponsorshipFixture(page);
  await page.goto(`/admin/fundraiser/sponsors?sponsorshipId=${id}`);
  await expect(
    page.locator('[data-og7="dossier-overview-summary"]')
  ).toBeVisible();
  const assistant = page.locator('[data-og7="dossier-assistant"]');
  await expectAssistantLinkOrigin(assistant, dossierPath());
  await expect(page.locator('[data-og7="assistant-context"]')).toHaveCount(0);
  expect(calls.some((call) => call.path.endsWith('/assistant/context'))).toBe(
    false
  );
  await assistant.focus();
  await assistant.press('Enter');
  await expectAssistantPageOrigin(page, dossierPath());
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-301'
  );
  await expect(
    page.getByRole('link', { name: 'Ouvrir l’Assistant pour ce dossier' })
  ).toHaveCount(0);
});

for (const width of [1280, 390]) {
  test(`dossier refresh leaves Assistant loading to its dedicated workspace at ${width}px`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    await sponsorshipFixture(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/admin/fundraiser/sponsors?sponsorshipId=${id}`);
    const context = page.locator('[data-og7="assistant-context"]');
    await expect(
      page.locator('[data-og7="dossier-overview-summary"]')
    ).toBeVisible();
    await expect(context).toHaveCount(0);
    const refresh = page.locator('[data-og7="dossier-refresh"]');
    await expect(refresh).toHaveAccessibleName('Actualiser le dossier');
    await expect(
      page.getByRole('button', {
        name: /Actualiser le dossier|Actualiser le contexte/
      })
    ).toHaveCount(1);
    const contextReads = () =>
      calls.filter((call) => call.path === '/api/admin/assistant/context')
        .length;
    options.contextStatus = 503;
    const listResponse = page.waitForResponse('**/api/admin/sponsorships?*');
    await refresh.click();
    await listResponse;
    await expect(refresh).toBeEnabled();
    await expect(context).toHaveCount(0);
    expect(contextReads()).toBe(0);

    await page.locator('[data-og7="dossier-assistant"]').click();
    await expectAssistantPageOrigin(page, dossierPath());
    await expect(context).toContainText(
      'Le contexte est indisponible. Vous pouvez réessayer.'
    );
    expect(contextReads()).toBe(1);
    options.contextStatus = 200;
    await context
      .getByRole('button', { name: 'Actualiser le contexte' })
      .click();
    await expect(
      context.locator('[data-og7="assistant-reference"]')
    ).toHaveText('DEMO-301');
    expect(contextReads()).toBe(2);
    await expect(
      context.getByRole('button', { name: 'Actualiser le contexte' })
    ).toBeVisible();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
}

for (const language of ['fr', 'en'] as const) {
  test(`leaving the Assistant for a dossier clears private edits before reopening it in ${language}`, async ({
    page
  }) => {
    const { calls, options } = await fixtures(page);
    options.mode = 'mock';
    await sponsorshipFixture(page);
    await page.setViewportSize({
      width: language === 'en' ? 390 : 1280,
      height: 844
    });
    await page.goto(path());
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
    const dossierLink = context.getByRole('link', {
      name: language === 'en' ? 'Open record' : 'Ouvrir le dossier',
      exact: true
    });
    await dossierLink.focus();
    await dossierLink.press('Enter');
    await expect(page).toHaveURL(
      `/admin/fundraiser/sponsors?sponsorshipId=${id}`
    );
    await expect(context).toHaveCount(0);
    const workspace = page.locator('[data-og7="dossier-assistant"]');
    await expectAssistantLinkOrigin(workspace, dossierPath());
    await workspace.focus();
    await workspace.press('Enter');
    await expectAssistantPageOrigin(page, dossierPath());
    await expect(
      context.locator('[data-og7="assistant-reference"]')
    ).toHaveText('DEMO-301');
    await expect(question).toHaveValue('');
    await expect(
      context.locator('[data-og7="assistant-information-form"]')
    ).toHaveCount(0);
    await expect(context.locator('[data-og7="assistant-answer"]')).toHaveCount(
      0
    );
    await expect(page.locator('dialog[open]')).toHaveCount(0);
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

test('returning from a dossier prepares a fresh Assistant draft against its current version', async ({
  page
}) => {
  const { calls, options } = await fixtures(page);
  options.mode = 'mock';
  await sponsorshipFixture(page);
  await page.goto(path());
  await page.getByRole('button', { name: 'Demander des informations' }).click();
  await page.getByLabel('Message', { exact: true }).fill('Private stale draft');
  await page
    .getByLabel('Question sur ce dossier', { exact: true })
    .fill('Ma question');
  await page
    .getByRole('link', { name: 'Ouvrir le dossier', exact: true })
    .click();
  await expect(
    page.locator('[data-og7="dossier-overview-summary"]')
  ).toBeVisible();
  options.contextVersion = 'b'.repeat(64);
  await page.locator('[data-og7="dossier-assistant"]').click();
  await expectAssistantPageOrigin(page, dossierPath());
  await expect(page.locator('[data-og7="assistant-reference"]')).toHaveText(
    'DEMO-301'
  );
  await expect(
    page.locator('[data-og7="assistant-information-form"]')
  ).toHaveCount(0);
  await expect(
    page.getByLabel('Question sur ce dossier', { exact: true })
  ).toHaveValue('');
  await page.getByRole('button', { name: 'Demander des informations' }).click();
  expect(calls.filter((call) => call.path.endsWith('/prepare'))).toHaveLength(
    2
  );
  expect(
    calls.filter((call) => call.path.endsWith('/prepare'))[1]?.body
  ).toMatchObject({ reference: id, type: 'sponsorship_reminder' });
  expect(calls.some((call) => call.path.endsWith('request-information'))).toBe(
    false
  );
  await page.getByRole('button', { name: 'Vérifier l’envoi' }).click();
  await page
    .getByRole('button', { name: 'Confirmer l’envoi', exact: true })
    .click();
  await expect(
    page.locator('[data-og7="assistant-delivery-result"]')
  ).toBeVisible();
  expect(
    calls.find((call) => call.path.endsWith('request-information'))?.body
  ).toMatchObject({ contextVersion: 'b'.repeat(64), contributionId: id });
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
  await page.goto(path());
  await page.getByRole('button', { name: 'Demander des informations' }).click();
  await page.getByLabel('Message', { exact: true }).fill('Private draft');
  await page
    .getByLabel('Question sur ce dossier', { exact: true })
    .fill('Private question');
  await page
    .getByRole('link', { name: 'Ouvrir le dossier', exact: true })
    .click();
  await expect(
    page.locator('[data-og7="dossier-overview-summary"]')
  ).toBeVisible();
  options.identityId = 'another-admin';
  await page.locator('[data-og7="dossier-assistant"]').click();
  await expectAssistantPageOrigin(page, dossierPath());
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
