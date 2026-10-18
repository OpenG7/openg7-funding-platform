import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  AdminCampaignItem,
  AdminCampaignsResponse,
  AdminDossierPreparationReceipt
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const path = '/admin/fundraiser/campaigns';
const generatedAt = '2026-10-18T12:00:00Z';
const approvedId = '10000000-0000-4000-8000-000000000801';
const futureId = '10000000-0000-4000-8000-000000000802';
const deliveredId = '10000000-0000-4000-8000-000000000803';
const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);

function promise(
  id: string,
  contributionId: string,
  changes: Partial<AdminCampaignItem> = {}
): AdminCampaignItem {
  return {
    id,
    contributionId,
    reference: `DEMO-${contributionId.slice(-3)}`,
    companyName: 'Atelier à venir',
    paidAt: generatedAt,
    channel: 'facebook',
    target: 'openg7',
    ordinal: 1,
    quantity: 1,
    format: 'collective_text',
    obligationState: 'pending',
    timing: null,
    preparation: {
      status: 'incomplete',
      version: 'synthetic-preparation-v2',
      approvedAt: null,
      blockers: ['company_missing']
    },
    workflow: {
      obligationId: id,
      channel: 'facebook',
      target: 'openg7',
      ordinal: 1,
      state: 'action_required',
      responsibility: 'admin',
      reason: 'publication_draft_missing',
      deliveryId: null,
      scheduledAt: null
    },
    content: null,
    proof: null,
    adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${contributionId}&tab=publication`,
    ...changes
  };
}

function promises(): AdminCampaignItem[] {
  const approved = promise('approved-facebook', approvedId, {
    companyName: 'Atelier approuvé',
    ordinal: 1,
    quantity: 2,
    preparation: {
      status: 'approved',
      version: 'synthetic-preparation-v1',
      approvedAt: generatedAt,
      blockers: []
    },
    content: { title: 'Projet local', body: 'Contenu synthétique à autoriser.' }
  });
  const upcoming = promise('upcoming-website', futureId, {
    channel: 'website',
    workflow: {
      ...approved.workflow,
      obligationId: 'upcoming-website',
      channel: 'website'
    }
  });
  const delivered = promise('delivered-facebook', deliveredId, {
    companyName: 'Atelier livré',
    obligationState: 'fulfilled',
    preparation: {
      status: 'review_required',
      version: 'synthetic-preparation-v3',
      approvedAt: null,
      blockers: []
    },
    workflow: {
      ...approved.workflow,
      obligationId: 'delivered-facebook',
      state: 'complete',
      responsibility: 'none',
      reason: 'fulfilled'
    },
    proof: {
      id: 'qualified-proof',
      obligationId: 'delivered-facebook',
      deliveryId: 'synthetic-delivery',
      channel: 'facebook',
      target: 'openg7',
      provenance: 'provider_verified',
      deliveredAt: generatedAt,
      externalPostUrl: 'https://example.invalid/publication/qualified-proof',
      visibility: 'unknown',
      visibilityObservedAt: null
    }
  });
  return [
    approved,
    promise('approved-second-passage', approvedId, {
      ...approved,
      id: 'approved-second-passage',
      ordinal: 2,
      content: null,
      workflow: {
        ...approved.workflow,
        obligationId: 'approved-second-passage',
        ordinal: 2
      }
    }),
    upcoming,
    delivered
  ];
}

function preparation(row: AdminCampaignItem): AdminDossierPreparationReceipt {
  return {
    context: 'dossier',
    contributionId: row.contributionId,
    reference: row.reference,
    version: row.preparation.version,
    status: row.preparation.status,
    payment: {
      amountMinor: 50000,
      currency: 'CAD',
      status: 'paid',
      confirmedAt: generatedAt
    },
    acceptedOffer: null,
    balance: null,
    checks: [
      { code: 'payment_confirmed', state: 'complete' },
      { code: 'accepted_offer', state: 'not_required' }
    ],
    authorizations: [],
    drafts: [],
    blockers: row.preparation.blockers.map((code) => ({
      code,
      adminUrl: null
    })),
    canApprove: false,
    approval: null,
    approvalHistory: []
  };
}

async function fixtures(page: Page, language = 'fr-CA') {
  await page.addInitScript((locale) => {
    localStorage.setItem('openg7.language', locale);
  }, language);
  const state = {
    status: 200,
    signedIn: true,
    empty: false,
    paginated: false,
    gate: null as Promise<void> | null,
    queries: [] as URLSearchParams[],
    preparations: [] as string[],
    mutations: [] as string[]
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      state.mutations.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({
        status: 405,
        json: { error: 'Read-only fixture' }
      });
    }
    if (url.pathname === '/api/admin/auth/config')
      return route.fulfill({ json: { mode: 'oidc' } });
    if (url.pathname === '/api/admin/auth/current')
      return route.fulfill({
        status: state.signedIn ? 200 : 401,
        json: state.signedIn
          ? {
              id: 'synthetic-campaign-reader',
              sessionId: 'synthetic-campaign-session',
              displayName: 'Lecture synthétique',
              role: 'reader',
              expiresAt: '2099-01-01T00:00:00Z'
            }
          : {}
      });
    if (url.pathname === '/api/admin/campaigns') {
      state.queries.push(url.searchParams);
      if (state.gate) await state.gate;
      if (state.status !== 200)
        return route.fulfill({
          status: state.status,
          json: { error: 'Fixture unavailable' }
        });
      const currentPage = Number(url.searchParams.get('page') ?? 1);
      const rows = state.empty
        ? []
        : state.paginated
          ? Array.from({ length: 26 }, (_, index) => {
              const channel = (url.searchParams.get('channel') ??
                'facebook') as AdminCampaignItem['channel'];
              const target = (url.searchParams.get('target') ??
                'openg7') as AdminCampaignItem['target'];
              const row = promise(`page-promise-${index}`, futureId);
              return {
                ...row,
                ordinal: index + 1,
                quantity: 26,
                channel,
                target,
                workflow: {
                  ...row.workflow,
                  channel,
                  target,
                  ordinal: index + 1,
                  state: (url.searchParams.get('state') ??
                    'action_required') as AdminCampaignItem['workflow']['state']
                }
              };
            })
          : promises();
      const json: AdminCampaignsResponse = {
        generatedAt,
        items: rows.slice((currentPage - 1) * 25, currentPage * 25),
        pagination: {
          page: currentPage,
          pageSize: 25,
          totalItems: rows.length,
          totalPages: Math.ceil(rows.length / 25),
          hasPreviousPage: currentPage > 1,
          hasNextPage: currentPage * 25 < rows.length
        }
      };
      return route.fulfill({ json });
    }
    if (url.pathname === '/api/admin/sponsorships/preparation') {
      const id = url.searchParams.get('sponsorshipId') ?? '';
      state.preparations.push(id);
      const row = promises().find((item) => item.contributionId === id);
      return route.fulfill({
        status: row ? 200 : 404,
        json: row ? preparation(row) : {}
      });
    }
    return route.fulfill({
      status: 503,
      json: { error: 'Unused fixture endpoint' }
    });
  });
  return state;
}

test('campaigns show approved preparation first and upcoming promises without sending publications', async ({
  page
}) => {
  const fixture = await fixtures(page);
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'Campagnes', exact: true })
  ).toBeVisible();
  await expect(hook(page, 'campaign-row')).toHaveCount(4);
  expect(fixture.queries[0]?.get('sort')).toBe('preparation');
  expect(fixture.queries[0]?.get('direction')).toBe('desc');
  await expect(hook(page, 'campaigns-sort')).toHaveValue('preparation');
  await expect(hook(page, 'campaign-row').first()).toHaveAttribute(
    'data-og7-id',
    'approved-facebook'
  );
  await expect(hook(page, 'campaign-row').first()).toContainText('Approuvée');
  await expect(hook(page, 'campaign-row').nth(1)).toContainText(
    'Passage 2 sur 2'
  );
  await expect(page.locator('[data-og7-id="upcoming-website"]')).toBeVisible();
  await expect(page.locator('[data-og7-id="upcoming-website"]')).toContainText(
    'À compléter'
  );
  expect(fixture.preparations).toEqual([]);

  const navigation = page.locator('openg7-admin-nav nav');
  const links = await navigation
    .locator('a[href]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('href')));
  expect(links.indexOf(path)).toBeGreaterThan(
    links.indexOf('/admin/fundraiser/sponsors')
  );
  expect(links.indexOf(path)).toBeLessThan(
    links.indexOf('/admin/fundraiser/publications')
  );

  const delivered = page.locator(
    '[data-og7="campaign-row"][data-og7-id="delivered-facebook"]'
  );
  await delivered.focus();
  await page.keyboard.press('Enter');
  await expect(delivered).toHaveAttribute('aria-pressed', 'true');
  await expect(hook(page, 'campaign-preparation')).toBeVisible();
  await expect(hook(page, 'campaign-detail')).toContainText('Atelier livré');
  await expect(
    hook(page, 'campaign-detail').getByRole('link', {
      name: /Consulter la publication livrée/
    })
  ).toHaveAttribute(
    'href',
    'https://example.invalid/publication/qualified-proof'
  );
  await expect(
    hook(page, 'campaign-detail').getByRole('link', { name: /dossier/i })
  ).toHaveAttribute(
    'href',
    `/admin/fundraiser/sponsors?sponsorshipId=${deliveredId}&tab=publication`
  );
  await expect.poll(() => fixture.preparations).toContain(deliveredId);
  expect(fixture.mutations).toEqual([]);
});

test('campaign filters and pagination are explicit and clear private detail while loading', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(path);
  await expect(hook(page, 'campaign-row')).toHaveCount(4);
  await hook(page, 'campaign-row').first().click();
  await expect(hook(page, 'campaign-detail')).toContainText('Projet local');
  await hook(page, 'campaigns-search').fill('Atelier');
  await hook(page, 'campaigns-channel').selectOption('linkedin');
  await hook(page, 'campaigns-target').selectOption('openg20');
  await hook(page, 'campaigns-state').selectOption('waiting');
  await hook(page, 'campaigns-sort').selectOption('due_at');
  await hook(page, 'campaigns-direction').selectOption('asc');
  expect(fixture.queries).toHaveLength(1);

  let release!: () => void;
  fixture.gate = new Promise<void>((resolve) => (release = resolve));
  fixture.paginated = true;
  await hook(page, 'campaigns-apply').click();
  await expect(hook(page, 'campaigns-loading')).toBeVisible();
  await expect(hook(page, 'campaign-detail')).not.toContainText('Projet local');
  await expect(hook(page, 'campaigns-refresh')).toBeDisabled();
  release();
  fixture.gate = null;
  await expect(hook(page, 'campaign-row')).toHaveCount(25);
  const query = fixture.queries.at(-1)!;
  expect(Object.fromEntries(query)).toMatchObject({
    search: 'Atelier',
    channel: 'linkedin',
    target: 'openg20',
    state: 'waiting',
    sort: 'due_at',
    direction: 'asc',
    page: '1'
  });
  await hook(page, 'campaigns-next').click();
  await expect(hook(page, 'campaign-row')).toHaveCount(1);
  expect(fixture.queries.at(-1)?.get('page')).toBe('2');
  await expect(hook(page, 'campaigns-previous')).toBeEnabled();
  await expect(hook(page, 'campaigns-next')).toBeDisabled();
  expect(fixture.mutations).toEqual([]);
});

test('campaigns distinguish unavailable, empty and forbidden reads without restoring old content', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(path);
  await expect(hook(page, 'campaign-row')).toHaveCount(4);
  await hook(page, 'campaign-row').first().click();
  await expect(hook(page, 'campaign-detail')).toContainText('Projet local');
  fixture.status = 503;
  await hook(page, 'campaigns-refresh').click();
  await expect(hook(page, 'campaigns-list').getByRole('alert')).toBeVisible();
  await expect(hook(page, 'campaigns-empty')).toHaveCount(0);
  await expect(hook(page, 'campaign-detail')).not.toContainText('Projet local');
  fixture.status = 200;
  fixture.empty = true;
  await hook(page, 'campaigns-list')
    .getByRole('button', { name: 'Réessayer', exact: true })
    .click();
  await expect(hook(page, 'campaigns-empty')).toBeVisible();
  fixture.status = 403;
  await hook(page, 'campaigns-refresh').click();
  await expect(hook(page, 'campaigns-list').getByRole('alert')).toBeVisible();
  await expect(hook(page, 'campaign-row')).toHaveCount(0);
  await expect(hook(page, 'campaigns-empty')).toHaveCount(0);
  expect(fixture.mutations).toEqual([]);
});

for (const { language, width, title } of [
  { language: 'fr-CA', width: 1440, title: 'Campagnes' },
  { language: 'en', width: 375, title: 'Campaigns' }
]) {
  test(`campaigns remain accessible in ${language} at ${width}px with keyboard selection`, async ({
    page
  }) => {
    const fixture = await fixtures(page, language);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path);
    await expect(
      page.getByRole('heading', { name: title, exact: true })
    ).toBeVisible();
    await expect(hook(page, 'campaign-row')).toHaveCount(4);
    await hook(page, 'campaigns-grouping').uncheck();
    await expect(hook(page, 'campaign-row').first()).toContainText(
      'Atelier approuvé'
    );
    await hook(page, 'campaign-row').first().focus();
    await page.keyboard.press('Enter');
    await expect(hook(page, 'campaign-detail')).toContainText('Projet local');
    await expect(
      hook(page, 'campaign-preparation').locator(
        '[data-og7="preparation-receipt"]'
      )
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`campaigns-${language}-${width}.png`),
      fullPage: true
    });
    const accessibility = await new AxeBuilder({ page })
      .include('[data-og7="campaigns-page"]')
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      )
    ).toBe(true);
    expect(fixture.mutations).toEqual([]);
  });
}

test('campaigns require a session and preserve their return destination', async ({
  page
}) => {
  const fixture = await fixtures(page);
  fixture.signedIn = false;
  await page.goto(path);
  await expect(page).toHaveURL(/\/admin\/login\?/);
  expect(new URL(page.url()).searchParams.get('returnUrl')).toBe(path);
  expect(fixture.queries).toEqual([]);
  await expect(hook(page, 'campaigns-page')).toHaveCount(0);
});
