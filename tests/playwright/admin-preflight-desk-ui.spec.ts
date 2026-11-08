import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  AdminDossierPreparationReceipt,
  PreflightDeskOrder,
  PreflightDeskResponse,
  PreflightDeskService,
  PreflightDeskStage
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  captureAdminDesign,
  expectAdminPageFits,
  prepareAdminDesignReview
} from './support/admin-design-review.js';
import {
  contributionId,
  receipt
} from './support/preparation-receipts-fixtures.js';

const base = '/admin/fundraiser/preflight';
const endpoint = '/api/admin/preflight/desk';
const at = '2026-11-04T14:00:00.000Z';
const id = (position: number) =>
  '00000000-0000-4000-8000-' + String(position).padStart(12, '0');
const stageOrder: readonly PreflightDeskStage[] = [
  'to_review',
  'to_deliver',
  'to_prepare',
  'delivered'
];

function order(position: number): PreflightDeskOrder {
  const dossierId = contributionId(position + 1);
  const reference = 'SYNTHETIC-CMD-' + String(position + 1).padStart(3, '0');
  const companyName =
    position === 0 ? 'Synthetic ALPHA' : 'Synthetic BETA ' + position;
  const services: PreflightDeskService[] = (
    ['website', 'facebook'] as const
  ).map((channel, index) => {
    const stage = stageOrder[(position * 2 + index) % stageOrder.length];
    const obligationId = id(1000 + position * 2 + index);
    const delivered = stage === 'delivered';
    const draft =
      stage === 'to_prepare'
        ? null
        : {
            title: 'SYNTHETIC-' + channel.toUpperCase() + '-TITLE',
            body: 'Synthetic prepared content for ' + reference
          };
    return {
      id: obligationId,
      contributionId: dossierId,
      reference,
      companyName,
      paidAt: at,
      channel,
      target: 'openg7',
      ordinal: 1,
      quantity: 1,
      format: channel === 'facebook' ? 'collective_text' : null,
      obligationState: delivered ? 'fulfilled' : 'pending',
      timing: null,
      preparation: {
        status:
          stage === 'to_prepare'
            ? 'incomplete'
            : stage === 'to_review'
              ? 'ready'
              : 'approved',
        version: 'synthetic-preparation-v1',
        approvedAt: ['to_deliver', 'delivered'].includes(stage) ? at : null,
        blockers: stage === 'to_prepare' ? ['SYNTHETIC-INPUT-REQUIRED'] : []
      },
      workflow: {
        obligationId,
        channel,
        target: 'openg7',
        ordinal: 1,
        state: delivered
          ? 'complete'
          : stage === 'to_prepare'
            ? 'blocked'
            : stage === 'to_review'
              ? 'action_required'
              : 'waiting',
        responsibility: delivered ? 'none' : 'admin',
        reason: delivered
          ? 'publication_done'
          : stage === 'to_prepare'
            ? 'identity_missing'
            : stage === 'to_review'
              ? 'publication_preparation_required'
              : 'publication_scheduled',
        deliveryId: delivered ? id(2000 + position) : null,
        scheduledAt: null
      },
      content: draft,
      proof: delivered
        ? {
            id: id(3000 + position),
            obligationId,
            deliveryId: id(2000 + position),
            channel,
            target: 'openg7',
            provenance: 'provider_verified',
            deliveredAt: at,
            externalPostUrl: null,
            visibility: 'visible',
            visibilityObservedAt: at
          }
        : null,
      adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${dossierId}&tab=publication`,
      stage,
      blocked: stage === 'to_prepare',
      blockers: stage === 'to_prepare' ? ['SYNTHETIC-INPUT-REQUIRED'] : [],
      preparationOrigin: 'funding',
      preflightLink: 'unverified',
      reviewUrl: `/admin/fundraiser/campaigns?sponsorshipId=${dossierId}&obligationId=${obligationId}`
    };
  });
  return {
    contributionId: dossierId,
    reference,
    companyName,
    amountMinor: '25000',
    currency: 'CAD',
    commitmentId: id(4000 + position),
    commitmentVersion: 1,
    paidAt: at,
    services,
    delivered: services.filter((service) => service.stage === 'delivered')
      .length,
    total: services.length,
    adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${dossierId}&tab=publication`
  };
}

function projection(
  orders: readonly PreflightDeskOrder[],
  url: URL
): PreflightDeskResponse {
  const search = url.searchParams.get('search')?.toLowerCase() ?? '';
  const universe = orders.filter(
    (item) =>
      !search ||
      (item.reference + ' ' + item.companyName).toLowerCase().includes(search)
  );
  const services = universe.flatMap((item) => item.services);
  const selectedStage = url.searchParams.get('stage') ?? 'all';
  const matching = universe.filter(
    (item) =>
      selectedStage === 'all' ||
      item.services.some((service) => service.stage === selectedStage)
  );
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
  const totalPages = Math.max(1, Math.ceil(matching.length / pageSize));
  return {
    generatedAt: at,
    summary: {
      total: services.length,
      toPrepare: services.filter((service) => service.stage === 'to_prepare')
        .length,
      toReview: services.filter((service) => service.stage === 'to_review')
        .length,
      toDeliver: services.filter((service) => service.stage === 'to_deliver')
        .length,
      delivered: services.filter((service) => service.stage === 'delivered')
        .length,
      excludedAdjusted: 0,
      orders: universe.length,
      scope: 'recorded_promised_services',
      preflightLink: 'unverified'
    },
    orders: matching.slice((page - 1) * pageSize, page * pageSize),
    pagination: {
      page,
      pageSize,
      totalItems: matching.length,
      totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages
    }
  };
}

function dossierReceipt(
  item: PreflightDeskOrder
): AdminDossierPreparationReceipt {
  const source = receipt(1);
  const acceptedOffer = {
    ...source.acceptedOffer!,
    amountMinor: 25000,
    benefits: [
      source.acceptedOffer!.benefits[0],
      {
        id: 'facebook_batch' as const,
        channel: 'facebook' as const,
        target: 'openg7' as const,
        quantity: 1,
        format: 'collective_text' as const,
        requiredElements: ['company_name', 'approved_presentation'] as const,
        deadlineDays: 14,
        durationDays: null
      }
    ]
  };
  return {
    context: 'dossier',
    contributionId: item.contributionId,
    reference: item.reference,
    version: source.version,
    status: 'ready',
    payment: { ...source.payment, amountMinor: 25000 },
    acceptedOffer,
    balance: {
      ...source.balance!,
      contributionId: item.contributionId,
      reference: item.reference,
      amountMinor: 25000,
      expected: 2,
      fulfilled: 0,
      outstanding: 2,
      promisedBenefits: acceptedOffer.benefits,
      obligations: item.services.map((service) => ({
        id: service.id,
        benefitId:
          service.channel === 'website' ? 'website_mention' : 'facebook_batch',
        channel: service.channel,
        target: service.target,
        ordinal: 1,
        state: 'pending',
        version: 1,
        ...(service.format ? { format: service.format } : {})
      }))
    },
    checks: source.checks.filter((check) => check.code !== 'dossier_examined'),
    authorizations: source.authorizations,
    drafts: item.services.map((service) => ({
      id: 'synthetic-draft-' + service.id,
      kind: service.channel === 'website' ? 'website' : 'publication',
      version: 'synthetic-draft-v1',
      title: service.content?.title ?? 'SYNTHETIC-TITLE',
      body: service.content?.body ?? 'SYNTHETIC-BODY',
      disclosureText: 'Synthetic sponsorship preparation.',
      channel: service.channel,
      target: service.target,
      status: 'private',
      adminUrl: service.reviewUrl
    })),
    blockers: [],
    canApprove: false,
    approval: null,
    approvalHistory: []
  };
}

async function fixtures(page: Page, language: 'fr-CA' | 'en' = 'fr-CA') {
  await prepareAdminDesignReview(page);
  await page.addInitScript(
    (locale) => localStorage.setItem('openg7.language', locale),
    language
  );
  const state = {
    orders: [order(0), order(1)],
    signedIn: true,
    deskStatus: 200,
    inboxStatus: 200,
    reads: [] as URL[],
    preparationReads: [] as string[],
    writes: [] as string[]
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      state.writes.push(request.method() + ' ' + url.pathname);
      return route.fulfill({ status: 405, json: {} });
    }
    if (url.pathname === '/api/admin/auth/config')
      return route.fulfill({ json: { mode: 'oidc' } });
    if (url.pathname === '/api/admin/auth/current')
      return route.fulfill(
        state.signedIn
          ? {
              json: {
                id: 'synthetic-desk-reader',
                sessionId: 'synthetic-desk-session',
                displayName: 'Synthetic reader',
                role: 'reader',
                expiresAt: '2099-01-01T00:00:00Z'
              }
            }
          : { status: 401, json: {} }
      );
    if (url.pathname === endpoint) {
      state.reads.push(url);
      return route.fulfill({
        status: state.deskStatus,
        json:
          state.deskStatus === 200
            ? projection(state.orders, url)
            : { error: 'Synthetic desk unavailable.' }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/preparation') {
      const selectedId = url.searchParams.get('sponsorshipId') ?? '';
      state.preparationReads.push(selectedId);
      const item = state.orders.find(
        (item) => item.contributionId === selectedId
      );
      return route.fulfill(
        item ? { json: dossierReceipt(item) } : { status: 404, json: {} }
      );
    }
    if (url.pathname === '/api/admin/preflight/inbox')
      return route.fulfill({
        status: state.inboxStatus,
        json:
          state.inboxStatus === 200
            ? {
                state: 'ready',
                consoleUrl: 'https://preflight.example.test/',
                items: [],
                total: 0,
                page: 1,
                pageSize: 20,
                authority: 'source_application',
                businessDecisionExecuted: false
              }
            : {
                state: 'unavailable',
                consoleUrl: 'https://preflight.example.test/',
                error: 'Synthetic inbox unavailable.'
              }
      });
    if (url.pathname === '/api/admin/preflight/rehearsals')
      return route.fulfill({
        json: {
          enabled: false,
          canLaunch: false,
          consoleUrl: null,
          run: null,
          runs: []
        }
      });
    return route.fulfill({ status: 503, json: {} });
  });
  return state;
}

const desk = (page: Page) => page.locator('[data-og7="preflight-desk"]');
const filter = (page: Page, stage: PreflightDeskStage) =>
  page.locator(`[data-og7="preflight-desk-filter"][data-og7-id="${stage}"]`);
const orderCard = (page: Page, position: number) =>
  page.locator(
    `[data-og7="preflight-desk-order"][data-og7-id="${contributionId(position + 1)}"]`
  );
const refresh = (page: Page) =>
  page.locator('[data-og7="preflight-desk-refresh"]');

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1536]) {
    test(`Preflight desk shows promised services and qualified delivery in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await fixtures(page, language);
      await page.goto(base);
      await expect(desk(page)).toHaveAttribute('data-state', 'ready');
      for (const stage of stageOrder)
        await expect(filter(page, stage).locator('strong')).toHaveText('1');
      await expect(
        orderCard(page, 0).getByText('SYNTHETIC-WEBSITE-TITLE')
      ).toBeVisible();
      await expect(
        orderCard(page, 0).getByText('SYNTHETIC-FACEBOOK-TITLE')
      ).toBeVisible();
      const second = orderCard(page, 1);
      await second
        .getByRole('button', { name: 'SYNTHETIC-CMD-002', exact: true })
        .click();
      const delivered = second.locator(
        '[data-og7="preflight-desk-service"][data-stage="delivered"]'
      );
      await expect(delivered).toContainText(
        language === 'fr-CA'
          ? 'Preuve de livraison Funding'
          : 'Funding delivery evidence'
      );
      await expect(second.getByRole('progressbar')).toHaveAttribute(
        'value',
        '1'
      );
      await expect(second.getByRole('progressbar')).toHaveAttribute('max', '2');
      await expectAdminPageFits(page);
      const axe = await new AxeBuilder({ page })
        .include('[data-og7="preflight-desk"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(axe.violations).toEqual([]);
      if (language === 'fr-CA')
        await captureAdminDesign(
          page,
          testInfo,
          `preflight-desk-${width}px.fr.png`,
          true
        );
    });
  }
}

test('Preflight desk filters groups while retaining the same mutually exclusive summary', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(base);
  await expect(desk(page)).toHaveAttribute('data-state', 'ready');
  const readsBeforeToggle = state.reads.length;
  const toggle = orderCard(page, 0).getByRole('button', {
    name: 'SYNTHETIC-CMD-001',
    exact: true
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(state.reads).toHaveLength(readsBeforeToggle);
  await filter(page, 'to_review').click();
  await expect(filter(page, 'to_review')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.locator('[data-og7="preflight-desk-order"]')).toHaveCount(
    1
  );
  expect(state.reads.at(-1)?.searchParams.get('stage')).toBe('to_review');
  for (const stage of stageOrder)
    await expect(filter(page, stage).locator('strong')).toHaveText('1');
  await expect(
    page.locator('[aria-labelledby="preflight-desk-overview"]')
  ).toContainText('4 prestations enregistrées');
  // A matching dossier retains all its services, including its delivery awaiting authorization.
  await expect(
    orderCard(page, 0).locator('[data-og7="preflight-desk-service"]')
  ).toHaveCount(2);
  expect(state.writes).toEqual([]);
});

test('Preflight desk restores search, status and server pagination in the URL without writes', async ({
  page
}) => {
  const state = await fixtures(page);
  state.orders = Array.from({ length: 21 }, (_, index) => order(index));
  await page.goto(base);
  await expect(page.locator('[data-og7="preflight-desk-order"]')).toHaveCount(
    20
  );
  const search = desk(page).getByRole('searchbox');
  await search.fill('SYNTHETIC-');
  await search.press('Enter');
  await expect
    .poll(() => new URL(page.url()).searchParams.get('deskSearch'))
    .toBe('SYNTHETIC-');
  await page.locator('[data-og7="preflight-desk-next"]').click();
  await expect(page.locator('[data-og7="preflight-desk-order"]')).toHaveCount(
    1
  );
  expect(new URL(page.url()).searchParams.get('deskPage')).toBe('2');
  expect(state.reads.at(-1)?.searchParams.get('page')).toBe('2');
  await page.reload();
  await expect(page.locator('[data-og7="preflight-desk-order"]')).toHaveCount(
    1
  );
  await expect(search).toHaveValue('SYNTHETIC-');
  await filter(page, 'to_review').click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('deskStatus'))
    .toBe('to_review');
  expect(new URL(page.url()).searchParams.get('deskPage')).toBeNull();
  await page.reload();
  await expect(filter(page, 'to_review')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(search).toHaveValue('SYNTHETIC-');
  expect(state.writes).toEqual([]);
});

test('Preflight desk reuses the existing dossier preparation reader and exact owner links', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(base);
  const examine = page.locator('[data-og7="preflight-desk-examine"]').first();
  await examine.focus();
  await page.keyboard.press('Enter');
  const review = page.locator('[data-og7="preflight-desk-review"]');
  await expect(review).toBeVisible();
  await expect(
    review.locator('[data-og7="dossier-preparation"]')
  ).toBeVisible();
  await expect.poll(() => state.preparationReads).toEqual([contributionId(1)]);
  await expect(review).toContainText('SYNTHETIC-WEBSITE-TITLE');
  const service = state.orders[0].services[0];
  await expect(
    review.getByRole('link', {
      name: 'Ouvrir le parcours de cette prestation',
      exact: true
    })
  ).toHaveAttribute('href', service.reviewUrl);
  await expect(
    review.getByRole('link', { name: 'Ouvrir le dossier Funding', exact: true })
  ).toHaveAttribute('href', state.orders[0].adminUrl);
  await page.locator('[data-og7="preflight-desk-close"]').click();
  await expect(review).toHaveCount(0);
  await expect(examine).toBeFocused();
  expect(state.writes).toEqual([]);
});

test('Preflight desk preserves dated server evidence on a temporary 503', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(base);
  await expect(desk(page)).toHaveAttribute('data-state', 'ready');
  state.deskStatus = 503;
  await refresh(page).click();
  await expect(desk(page)).toHaveAttribute('data-state', 'unavailable');
  await expect(desk(page).getByRole('alert')).toContainText(
    'dernières données connues'
  );
  await expect(orderCard(page, 0)).toBeVisible();
  await expect(desk(page)).toContainText('Dernière lecture Funding');
  for (const stage of stageOrder)
    await expect(filter(page, stage).locator('strong')).toHaveText('1');
  expect(state.writes).toEqual([]);
});

for (const status of [401, 403]) {
  test(`Preflight desk removes private records after a ${status} read`, async ({
    page
  }) => {
    const state = await fixtures(page);
    await page.goto(base);
    await expect(orderCard(page, 0)).toBeVisible();
    state.deskStatus = status;
    if (status === 401) state.signedIn = false;
    await refresh(page).click();
    if (status === 401) {
      await expect(page).toHaveURL(/\/admin\/login\?/);
      await expect(desk(page)).toHaveCount(0);
    } else {
      await expect(desk(page)).toHaveAttribute('data-state', 'forbidden');
      await expect(
        page.locator('[data-og7="preflight-desk-order"]')
      ).toHaveCount(0);
    }
    await expect(page.locator('body')).not.toContainText('Synthetic ALPHA');
    expect(state.writes).toEqual([]);
  });
}

test('Preflight inbox outage remains independent from the Funding desk projection', async ({
  page
}) => {
  const state = await fixtures(page);
  state.inboxStatus = 503;
  await page.goto(base);
  await expect(desk(page)).toHaveAttribute('data-state', 'ready');
  await expect(orderCard(page, 0)).toBeVisible();
  await expect(
    page.locator('[data-og7="preflight-service-health"]')
  ).toContainText('Indisponible');
  for (const stage of stageOrder)
    await expect(filter(page, stage).locator('strong')).toHaveText('1');
  expect(state.writes).toEqual([]);
});
