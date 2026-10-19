import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  AdminCampaignItem,
  AdminCampaignsResponse,
  AdminDossierPreparationReceipt,
  AdminDossierPreparationApproveRequest
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';

const path = '/admin/fundraiser/campaigns';
const generatedAt = '2026-10-18T12:00:00Z';
const approvedId = '10000000-0000-4000-8000-000000000801';
const futureId = '10000000-0000-4000-8000-000000000802';
const deliveredId = '10000000-0000-4000-8000-000000000803';
const obligationId = (ordinal: number) =>
  `10000000-0000-4000-8000-${String(5000 + ordinal).padStart(12, '0')}`;
const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);

async function navigate(page: Page, destination: string) {
  await page
    .locator('openg7-admin-nav nav')
    .locator(`a[href="${destination}"]`)
    .click();
  await expect(page).toHaveURL(destination);
}

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
    rows: promises(),
    identity: {
      id: 'synthetic-campaign-reader',
      sessionId: 'synthetic-campaign-session',
      role: 'reader' as 'reader' | 'operator' | 'owner'
    },
    allowPreparationApproval: false,
    receipts: new Map<string, AdminDossierPreparationReceipt>(),
    approvals: [] as AdminDossierPreparationApproveRequest[],
    gate: null as Promise<void> | null,
    queries: [] as URLSearchParams[],
    completedReads: 0,
    preparations: [] as string[],
    mutations: [] as string[]
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      state.mutations.push(`${request.method()} ${url.pathname}`);
      if (
        state.allowPreparationApproval &&
        url.pathname === '/api/admin/sponsorships/preparation/approve' &&
        request.method() === 'POST'
      ) {
        const body =
          request.postDataJSON() as AdminDossierPreparationApproveRequest;
        state.approvals.push(body);
        const current = state.receipts.get(body.contributionId);
        if (
          !current?.canApprove ||
          body.expectedVersion !== current.version ||
          body.confirmed !== true
        )
          return route.fulfill({
            status: 409,
            json: { code: 'PREPARATION_VERSION_CONFLICT' }
          });
        const approval = {
          id: body.requestId,
          requestId: body.requestId,
          contributionId: current.contributionId,
          runId: null,
          version: current.version,
          actor: state.identity.id,
          approvedAt: generatedAt,
          auditReference: 'synthetic-campaign-preparation-audit'
        };
        const receipt: AdminDossierPreparationReceipt = {
          ...current,
          status: 'approved',
          canApprove: false,
          approval,
          approvalHistory: [...current.approvalHistory, approval]
        };
        state.receipts.set(current.contributionId, receipt);
        state.rows = state.rows.map((row) =>
          row.contributionId === current.contributionId
            ? {
                ...row,
                preparation: {
                  ...row.preparation,
                  status: 'approved',
                  approvedAt: generatedAt
                }
              }
            : row
        );
        return route.fulfill({ json: receipt });
      }
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
              id: state.identity.id,
              sessionId: state.identity.sessionId,
              displayName: 'Lecture synthétique',
              role: state.identity.role,
              expiresAt: '2099-01-01T00:00:00Z'
            }
          : {}
      });
    if (url.pathname === '/api/admin/campaigns') {
      state.queries.push(url.searchParams);
      const status = state.status;
      const gate = state.gate;
      const currentPage = Number(url.searchParams.get('page') ?? 1);
      const rows = state.empty
        ? []
        : state.paginated
          ? Array.from({ length: 26 }, (_, index) => {
              const channel = (url.searchParams.get('channel') ??
                'facebook') as AdminCampaignItem['channel'];
              const target = (url.searchParams.get('target') ??
                'openg7') as AdminCampaignItem['target'];
              const row = promise(obligationId(index + 1), futureId);
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
          : state.rows;
      const scopedRows = rows.filter(
        (row) =>
          (!url.searchParams.has('sponsorshipId') ||
            row.contributionId === url.searchParams.get('sponsorshipId')) &&
          (!url.searchParams.has('obligationId') ||
            row.id === url.searchParams.get('obligationId'))
      );
      const json: AdminCampaignsResponse = {
        generatedAt,
        items: scopedRows.slice((currentPage - 1) * 25, currentPage * 25),
        pagination: {
          page: currentPage,
          pageSize: 25,
          totalItems: scopedRows.length,
          totalPages: Math.ceil(scopedRows.length / 25),
          hasPreviousPage: currentPage > 1,
          hasNextPage: currentPage * 25 < scopedRows.length
        }
      };
      if (gate) await gate;
      await route.fulfill({
        status,
        json: status === 200 ? json : { error: 'Fixture unavailable' }
      });
      state.completedReads += 1;
      return;
    }
    if (url.pathname === '/api/admin/sponsorships/preparation') {
      const id = url.searchParams.get('sponsorshipId') ?? '';
      state.preparations.push(id);
      const row = state.rows.find((item) => item.contributionId === id);
      const receipt = state.receipts.get(id) ?? (row ? preparation(row) : null);
      return route.fulfill({
        status: receipt ? 200 : 404,
        json: receipt ?? {}
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
  const agreement = hook(page, 'campaign-preparation').locator(
    '[data-og7="preparation-receipt-details"]'
  );
  await expect(agreement).toHaveJSProperty('open', false);
  await agreement.locator('summary').click();
  await expect(agreement).toHaveJSProperty('open', true);
  await expect(agreement).toContainText('synthetic-preparation-v3');
  await expect(agreement).toContainText('Version complète');
  expect(fixture.mutations).toEqual([]);
});

for (const language of ['fr-CA', 'en'] as const) {
  for (const viewport of [
    { width: 1536, height: 864 },
    { width: 390, height: 844 }
  ]) {
    test(`campaign evidence keeps delivery, observation and exact scope distinct in ${language} at ${viewport.width}px`, async ({
      page
    }, testInfo) => {
      const fixture = await fixtures(page, language);
      const delivered = fixture.rows.find(
        (row) => row.id === 'delivered-facebook'
      )!;
      const historicalProof = delivered.proof!;
      const observedAt = '2026-10-19T15:42:00Z';
      const preparationVersion = 'synthetic-current-preparation-v7';
      const declaredUrl = 'https://example.invalid/declared-publication';
      fixture.rows = [
        {
          ...delivered,
          preparation: {
            ...delivered.preparation,
            version: preparationVersion
          },
          proof: {
            ...historicalProof,
            visibility: 'changed',
            visibilityObservedAt: observedAt
          }
        },
        promise('observed-unknown', futureId, {
          obligationState: 'fulfilled',
          workflow: {
            ...delivered.workflow,
            obligationId: 'observed-unknown'
          },
          proof: {
            ...historicalProof,
            id: 'qualified-proof-unknown',
            obligationId: 'observed-unknown',
            deliveryId: 'synthetic-delivery-unknown',
            visibility: 'unknown',
            visibilityObservedAt: observedAt
          }
        }),
        promise('delivered-website', approvedId, {
          channel: 'website',
          obligationState: 'fulfilled',
          workflow: {
            ...delivered.workflow,
            obligationId: 'delivered-website',
            channel: 'website',
            deliveryId: null
          },
          proof: {
            ...historicalProof,
            id: 'qualified-proof-website',
            obligationId: 'delivered-website',
            deliveryId: null,
            channel: 'website',
            provenance: 'website_verified',
            externalPostUrl: null,
            visibility: 'unknown',
            visibilityObservedAt: null
          }
        }),
        promise('declared-only', '10000000-0000-4000-8000-000000000804', {
          content: {
            title: language === 'en' ? 'Declared URL' : 'URL déclarée',
            body: declaredUrl
          },
          preparation: {
            ...delivered.preparation,
            status: 'approved',
            version: preparationVersion,
            approvedAt: generatedAt
          }
        })
      ];
      await page.setViewportSize(viewport);
      await page.goto(path);
      await expect(hook(page, 'campaign-row')).toHaveCount(4);
      const select = async (id: string) => {
        const row = page.locator(
          `[data-og7="campaign-row"][data-og7-id="${id}"]`
        );
        await row.focus();
        await page.keyboard.press('Enter');
        await expect(row).toHaveAttribute('aria-pressed', 'true');
      };
      await select('delivered-facebook');
      const proof = hook(page, 'campaign-proof');
      await expect(hook(page, 'campaign-proof-reference')).toHaveText(
        historicalProof.id
      );
      await expect(hook(page, 'campaign-proof-obligation')).toHaveText(
        historicalProof.obligationId
      );
      await expect(hook(page, 'campaign-proof-delivery')).toHaveText(
        historicalProof.deliveryId!
      );
      await expect(hook(page, 'campaign-proof-channel')).toHaveText('Facebook');
      await expect(hook(page, 'campaign-proof-target')).toHaveText('OpenG7');
      await expect(hook(page, 'campaign-proof-source')).toHaveText(
        language === 'en'
          ? 'Delivery verified with the provider'
          : 'Livraison vérifiée auprès du fournisseur'
      );
      await expect(hook(page, 'campaign-proof-delivered-at')).toHaveAttribute(
        'datetime',
        generatedAt
      );
      await expect(hook(page, 'campaign-proof-observed-at')).toHaveAttribute(
        'datetime',
        observedAt
      );
      await expect(hook(page, 'campaign-proof-observed-at')).not.toHaveText(
        await hook(page, 'campaign-proof-delivered-at').innerText()
      );
      await expect(hook(page, 'campaign-proof-visibility')).toHaveText(
        language === 'en'
          ? 'Publication changed since delivery'
          : 'Publication modifiée depuis la livraison'
      );
      await expect(hook(page, 'campaign-proof-agreement-scope')).toHaveText(
        language === 'en'
          ? 'Agreement version associated with this evidence: not specified.'
          : 'Version de l’accord associée à cette preuve : non renseignée.'
      );
      await expect(proof).not.toContainText(preparationVersion);
      await expect(proof.getByRole('link')).toHaveAttribute(
        'href',
        historicalProof.externalPostUrl!
      );
      await proof.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(
          `campaign-evidence-${language}-${viewport.width}.png`
        ),
        animations: 'disabled'
      });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        )
        .toBe(true);

      await select('observed-unknown');
      await expect(hook(page, 'campaign-proof-visibility')).toHaveText(
        language === 'en'
          ? 'Current visibility needs verification'
          : 'Visibilité actuelle à vérifier'
      );
      await expect(hook(page, 'campaign-proof-observed-at')).toHaveAttribute(
        'datetime',
        observedAt
      );
      await expect(hook(page, 'campaign-proof-no-observation')).toHaveCount(0);

      await select('delivered-website');
      await expect(hook(page, 'campaign-proof-source')).toHaveText(
        language === 'en'
          ? 'Website fulfilment attested'
          : 'Réalisation Web attestée'
      );
      await expect(hook(page, 'campaign-proof-delivery')).toHaveText(
        language === 'en' ? 'No linked delivery' : 'Aucune livraison liée'
      );
      await expect(hook(page, 'campaign-proof-reference')).toHaveText(
        'qualified-proof-website'
      );
      await expect(hook(page, 'campaign-proof-no-observation')).toHaveText(
        language === 'en'
          ? 'No dated observation is available. Current visibility still needs verification.'
          : 'Aucune observation datée disponible. La visibilité actuelle reste à vérifier.'
      );
      await expect(hook(page, 'campaign-proof-observed-at')).toHaveCount(0);
      await expect(hook(page, 'campaign-proof-delivered-at')).toHaveAttribute(
        'datetime',
        generatedAt
      );
      await expect(proof.getByRole('link')).toHaveCount(0);

      await select('declared-only');
      await expect(hook(page, 'campaign-content')).toContainText(declaredUrl);
      await expect(proof).toContainText(
        language === 'en'
          ? 'No qualified evidence for this promised service.'
          : 'Aucune preuve qualifiée pour cette prestation.'
      );
      await expect(hook(page, 'campaign-proof-reference')).toHaveCount(0);
      await expect(hook(page, 'campaign-proof-observation')).toHaveCount(0);
      await expect(proof.getByRole('link')).toHaveCount(0);
      expect(fixture.mutations).toEqual([]);
    });
  }
}

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

test('a campaign deep link selects its exact twenty-sixth obligation before pagination and keeps agreement details keyboard accessible', async ({
  page
}) => {
  const fixture = await fixtures(page);
  fixture.paginated = true;
  const selectedId = obligationId(26);
  await page.goto(
    `${path}?sponsorshipId=${futureId}&obligationId=${selectedId}`
  );
  await expect(hook(page, 'campaign-row')).toHaveCount(1);
  await expect(hook(page, 'campaign-row')).toHaveAttribute(
    'data-og7-id',
    selectedId
  );
  await expect(hook(page, 'campaign-row')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(Object.fromEntries(fixture.queries[0]!)).toMatchObject({
    sponsorshipId: futureId,
    obligationId: selectedId,
    page: '1'
  });
  await expect.poll(() => fixture.preparations).toContain(futureId);
  const agreement = hook(page, 'campaign-preparation').locator(
    '[data-og7="preparation-receipt-details"]'
  );
  await agreement.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(agreement).toHaveJSProperty('open', true);
  await expect(agreement).toContainText('synthetic-preparation-v2');
  expect(fixture.mutations).toEqual([]);
});

test('a campaign dossier link offers an explicit choice for multiple promises and selects its sole promise', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(`${path}?sponsorshipId=${approvedId}`);
  await expect(hook(page, 'campaign-row')).toHaveCount(2);
  await expect(hook(page, 'campaign-row').first()).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await expect(hook(page, 'campaign-row').nth(1)).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await expect(hook(page, 'campaign-preparation')).toHaveCount(0);
  expect(fixture.preparations).toEqual([]);
  await hook(page, 'campaign-row').nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(hook(page, 'campaign-row').nth(1)).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect.poll(() => fixture.preparations).toContain(approvedId);

  await page.goto(`${path}?sponsorshipId=${futureId}`);
  await expect(hook(page, 'campaign-row')).toHaveCount(1);
  await expect(hook(page, 'campaign-row')).toHaveAttribute(
    'data-og7-id',
    'upcoming-website'
  );
  await expect(hook(page, 'campaign-row')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect.poll(() => fixture.preparations).toContain(futureId);
  expect(fixture.mutations).toEqual([]);
});

for (const targetId of [obligationId(404), obligationId(1)]) {
  test(`an unavailable campaign target ${targetId} never selects a different promise`, async ({
    page
  }) => {
    const fixture = await fixtures(page);
    fixture.rows[2] = {
      ...fixture.rows[2]!,
      id: obligationId(1)
    };
    await page.goto(
      `${path}?sponsorshipId=${approvedId}&obligationId=${targetId}`
    );
    await expect(hook(page, 'campaigns-empty')).toBeVisible();
    await expect(hook(page, 'campaign-row')).toHaveCount(0);
    await expect(hook(page, 'campaign-preparation')).toHaveCount(0);
    expect(fixture.preparations).toEqual([]);
    expect(fixture.mutations).toEqual([]);
  });
}

test('malformed or orphan campaign links block reads and recover explicitly to the global list', async ({
  page
}) => {
  const fixture = await fixtures(page);
  for (const query of [
    'sponsorshipId=not-a-dossier',
    `obligationId=${obligationId(1)}`
  ]) {
    const readsBeforeArrival = fixture.queries.length;
    await page.goto(`${path}?${query}`);
    const alert = hook(page, 'campaigns-destination-error');
    await expect(alert).toBeVisible();
    await expect(hook(page, 'campaign-row')).toHaveCount(0);
    await expect(hook(page, 'campaign-preparation')).toHaveCount(0);
    expect(fixture.queries).toHaveLength(readsBeforeArrival);
    await alert.getByRole('button').click();
    await expect(page).toHaveURL(path);
    await expect(alert).toHaveCount(0);
    await expect(hook(page, 'campaign-row')).toHaveCount(4);
    expect(fixture.queries).toHaveLength(readsBeforeArrival + 1);
    expect(fixture.queries.at(-1)?.has('sponsorshipId')).toBe(false);
    expect(fixture.queries.at(-1)?.has('obligationId')).toBe(false);
  }
  expect(fixture.preparations).toEqual([]);
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

test('a confirmed preparation approval refreshes the active campaigns query from the API', async ({
  page
}) => {
  const fixture = await fixtures(page);
  fixture.identity.role = 'operator';
  fixture.allowPreparationApproval = true;
  fixture.rows = fixture.rows.map((row) =>
    row.id === 'upcoming-website'
      ? {
          ...row,
          preparation: {
            status: 'ready',
            version: 'synthetic-ready-preparation-v1',
            approvedAt: null,
            blockers: []
          }
        }
      : row
  );
  const ready = fixture.rows.find((row) => row.id === 'upcoming-website')!;
  fixture.receipts.set(ready.contributionId, {
    ...preparation(ready),
    canApprove: true,
    acceptedOffer: {
      version: 'synthetic-campaign-offer-v1',
      amountMinor: 50000,
      currency: 'CAD',
      benefits: [
        {
          id: 'website_mention',
          channel: 'website',
          target: 'openg7',
          quantity: 1,
          requiredElements: ['company_name', 'approved_presentation'],
          deadlineDays: null,
          durationDays: null
        }
      ]
    },
    checks: [
      { code: 'payment_confirmed', state: 'complete' },
      { code: 'accepted_offer', state: 'complete' },
      { code: 'content_prepared', state: 'complete' }
    ],
    authorizations: [
      { code: 'public_consent', state: 'complete' },
      { code: 'sponsor_review', state: 'complete' },
      { code: 'moderation_review', state: 'complete' }
    ]
  });
  await page.goto(path);
  await expect(hook(page, 'campaign-row')).toHaveCount(4);
  await hook(page, 'campaigns-search').fill('Atelier');
  await hook(page, 'campaigns-sort').selectOption('paid_at');
  await hook(page, 'campaigns-apply').click();
  await expect.poll(() => fixture.queries.at(-1)?.get('sort')).toBe('paid_at');
  const selected = page.locator(
    '[data-og7="campaign-row"][data-og7-id="upcoming-website"]'
  );
  await selected.click();
  const approve = hook(page, 'campaign-preparation').locator(
    '[data-og7="preparation-receipt-approve"]'
  );
  await expect(approve).toBeEnabled();
  const readsBeforeApproval = fixture.queries.length;
  await approve.click();
  await expect(hook(page, 'confirm-action')).toBeVisible();
  expect(fixture.approvals).toEqual([]);
  await hook(page, 'confirm-action').click();
  await expect.poll(() => fixture.approvals.length).toBe(1);
  await expect
    .poll(() => fixture.queries.length)
    .toBeGreaterThan(readsBeforeApproval);
  await expect(selected).toContainText('Approuvée');
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await expect(hook(page, 'campaigns-search')).toHaveValue('Atelier');
  await expect(hook(page, 'campaigns-sort')).toHaveValue('paid_at');
  expect(Object.fromEntries(fixture.queries.at(-1)!)).toMatchObject({
    search: 'Atelier',
    sort: 'paid_at',
    page: '1'
  });
  expect(fixture.approvals[0]).toMatchObject({
    contributionId: ready.contributionId,
    expectedVersion: ready.preparation.version,
    confirmed: true
  });
  expect(fixture.mutations).toEqual([
    'POST /api/admin/sponsorships/preparation/approve'
  ]);
});

test('a role change outside campaigns purges its view and a late old refusal cannot clear the new session', async ({
  page
}) => {
  const fixture = await fixtures(page);
  await page.goto(path);
  await expect(hook(page, 'campaign-row')).toHaveCount(4);
  await hook(page, 'campaigns-search').fill('Atelier');
  await hook(page, 'campaigns-apply').click();
  await expect
    .poll(() => fixture.queries.at(-1)?.get('search'))
    .toBe('Atelier');
  await hook(page, 'campaign-row').first().click();
  await expect(hook(page, 'campaign-detail')).toContainText('Projet local');
  let release!: () => void;
  fixture.gate = new Promise<void>((resolve) => (release = resolve));
  fixture.status = 401;
  const beforeRefresh = fixture.queries.length;
  await hook(page, 'campaigns-refresh').click();
  await expect.poll(() => fixture.queries.length).toBe(beforeRefresh + 1);
  await expect(hook(page, 'campaigns-loading')).toBeVisible();
  await navigate(page, '/admin/fundraiser/invoices');
  await expect(hook(page, 'campaigns-page')).toHaveCount(0);

  fixture.identity.role = 'owner';
  await navigate(page, '/admin/fundraiser/attention');
  fixture.identity.role = 'reader';
  fixture.status = 200;
  fixture.gate = null;
  fixture.rows = [
    promise('new-session-website', futureId, {
      companyName: 'Lecture après changement de rôle',
      channel: 'website'
    })
  ];
  await navigate(page, path);
  await expect(hook(page, 'campaign-row')).toHaveCount(1);
  await expect(hook(page, 'campaigns-search')).toHaveValue('');
  expect(fixture.queries.at(-1)?.get('search')).toBeNull();
  await expect(hook(page, 'campaign-row')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await expect(hook(page, 'campaign-detail')).not.toContainText('Projet local');

  const completedBeforeRelease = fixture.completedReads;
  release();
  await expect
    .poll(() => fixture.completedReads)
    .toBe(completedBeforeRelease + 1);
  await expect(page).toHaveURL(path);
  await expect(hook(page, 'campaign-row')).toHaveAttribute(
    'data-og7-id',
    'new-session-website'
  );
  await expect(hook(page, 'campaigns-list')).toContainText(
    'Lecture après changement de rôle'
  );
  await expect(hook(page, 'campaign-detail')).not.toContainText('Projet local');
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
    const agreement = hook(page, 'campaign-preparation').locator(
      '[data-og7="preparation-receipt-details"]'
    );
    await expect(agreement).toHaveJSProperty('open', false);
    await agreement.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(agreement).toHaveJSProperty('open', true);
    await expect(agreement).toContainText('synthetic-preparation-v1');
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
