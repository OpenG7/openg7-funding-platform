import { AxeBuilder } from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import type {
  AdminAutomaticRunState,
  AdminPreparationReceipt,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import { expect, sampledFrames, test } from './support/test.js';
import {
  actor,
  approvedAt,
  contributionId,
  observedAt,
  receipt,
  runId
} from './support/preparation-receipts-fixtures.js';

const receiptPath = '/api/admin/automatic-runs/preparation';
const hook = (page: Page, name: string) =>
  page.locator(`[data-og7="preparation-receipt-${name}"]`);
const carousel = (page: Page) =>
  page.locator('[data-og7="preparation-receipts-carousel"]');
const card = (page: Page) => page.locator('[data-og7="preparation-receipt"]');

function state(): AdminAutomaticRunState {
  return {
    run: {
      id: runId,
      version: 4,
      status: 'paused',
      startedAt: observedAt,
      updatedAt: observedAt,
      observedAt,
      pass: 1,
      cursor: 3,
      dossierCount: 6,
      processedCount: 3,
      balancedCount: 0,
      outstandingCount: 3,
      unknownCount: 0,
      uncoveredCount: 3,
      newPaymentCount: 1,
      currencyTotals: [{ currency: 'CAD', amountMinor: 52500 }],
      latestEntry: null,
      nextContributionId: contributionId(4),
      globalBalanced: false
    },
    balance: null
  };
}

const attention: AdminWorkQueueResponse = {
  available: true,
  coverage: 'complete',
  missingSources: [],
  generatedAt: observedAt,
  timezone: 'America/Toronto',
  total: 0,
  filteredTotal: 0,
  todayTotal: 0,
  counts: { urgent: 0, today: 0, this_week: 0, informational: 0 },
  typeCounts: {
    sponsorship_needs_info: 0,
    sponsorship_needs_review: 0,
    sponsorship_needs_commitment: 0,
    sponsorship_needs_fulfilment: 0,
    sponsorship_refund_followup: 0,
    sponsorship_credit_missing: 0,
    sponsorship_timing_review: 0,
    publication_reliability_incident: 0,
    publication_needs_preparation: 0,
    publication_late: 0,
    email_delivery_failed: 0,
    invoice_missing: 0,
    stripe_event_failed: 0,
    stripe_event_stalled: 0,
    publication_ready: 0,
    publication_slot_upcoming: 0,
    financial_data_warning: 0
  },
  actionCounts: {},
  pendingDossierCount: 0,
  page: 1,
  pageSize: 25,
  items: []
};

/** Built UI and synthetic intercepted responses; no real API, DB or provider. */
async function fixture(page: Page, language = 'fr-CA') {
  const f = {
    receipts: new Map(
      Array.from({ length: 6 }, (_, index) => [index + 1, receipt(index + 1)])
    ),
    state: state(),
    reads: [] as number[],
    writes: [] as { pathname: string; body: Record<string, unknown> }[],
    approvalGate: null as Promise<void> | null,
    receiptGate: null as Promise<void> | null,
    receiptFailure: null as { status: number; code: string } | null,
    approvalFailure: null as { status: number; code: string } | null,
    signedIn: true,
    role: 'owner' as 'owner' | 'reader'
  };
  await page.addInitScript(
    (locale) => localStorage.setItem('openg7.language', locale),
    language
  );
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (request.method() !== 'GET') {
      const body = request.postDataJSON() as Record<string, unknown>;
      f.writes.push({ pathname, body });
      if (pathname === `${receiptPath}/approve`) {
        if (f.approvalGate) await f.approvalGate;
        if (f.approvalFailure)
          return route.fulfill({
            status: f.approvalFailure.status,
            json: {
              code: f.approvalFailure.code,
              message: 'Synthetic private database detail'
            }
          });
        const position = [...f.receipts.values()].find(
          (item) => item.contributionId === body['contributionId']
        )?.position;
        const current = position ? f.receipts.get(position) : undefined;
        if (!current) return route.fulfill({ status: 404, json: {} });
        if (body['expectedVersion'] !== current.version)
          return route.fulfill({
            status: 409,
            json: { code: 'PREPARATION_VERSION_CONFLICT' }
          });
        if (!current.canApprove)
          return route.fulfill({
            status: 409,
            json: { code: 'PREPARATION_INCOMPLETE' }
          });
        const approval: NonNullable<AdminPreparationReceipt['approval']> = {
          id: '10000000-0000-4000-8000-000000001199',
          runId,
          contributionId: current.contributionId,
          version: current.version,
          actor,
          approvedAt,
          requestId: String(body['requestId']),
          auditReference: 'synthetic-preparation-audit-1199'
        };
        const approved: AdminPreparationReceipt = {
          ...current,
          status: 'approved',
          canApprove: false,
          approval,
          approvalHistory: [...current.approvalHistory, approval]
        };
        f.receipts.set(position!, approved);
        return route.fulfill({ json: approved });
      }
      return route.fulfill({
        status: 405,
        json: { code: 'SYNTHETIC_EXTERNAL_WRITE_FORBIDDEN' }
      });
    }
    if (pathname === '/api/admin/auth/config')
      return route.fulfill({ json: { mode: 'oidc' } });
    if (pathname === '/api/admin/auth/current')
      return route.fulfill({
        status: f.signedIn ? 200 : 401,
        json: f.signedIn
          ? {
              id: actor,
              sessionId: 'synthetic-preparation-session',
              displayName: 'Compte de préparation synthétique',
              role: f.role,
              expiresAt: '2099-01-01T00:00:00Z'
            }
          : {}
      });
    if (pathname === '/api/admin/automatic-runs')
      return route.fulfill({ json: f.state });
    if (pathname === '/api/admin/automatic-runs/report')
      return route.fulfill({ json: { entries: [], nextCursor: null } });
    if (pathname === receiptPath) {
      const position = Number(url.searchParams.get('position'));
      f.reads.push(position);
      expect(url.searchParams.get('runId')).toBe(runId);
      const snapshot = f.receipts.get(position);
      const failure = f.receiptFailure;
      if (f.receiptGate) await f.receiptGate;
      if (failure)
        return route.fulfill({
          status: failure.status,
          json: {
            code: failure.code,
            message: 'Synthetic private database detail'
          }
        });
      return route.fulfill({
        status: snapshot ? 200 : 404,
        json: snapshot ?? {}
      });
    }
    if (pathname === '/api/admin/attention')
      return route.fulfill({ json: attention });
    return route.fulfill({
      status: 503,
      json: { code: 'SYNTHETIC_UI_FIXTURE_UNAVAILABLE' }
    });
  });
  return f;
}

async function open(page: Page, expectedReceipt = true) {
  await page.goto('/admin/fundraiser/attention');
  const toggle = page.locator('[data-og7="admin-guidance-toggle"]');
  await expect(toggle).toBeVisible();
  if (!(await page.locator('[data-og7="admin-guidance-panel"]').isVisible()))
    await toggle.click();
  await page.locator('[data-og7="admin-guidance-automatic-mode"]').click();
  await expect(carousel(page)).toBeVisible();
  if (expectedReceipt) {
    await expect(card(page)).toHaveCount(1);
    await expect(card(page)).toHaveAttribute('data-og7-id', contributionId(3));
  }
  await expect(
    page.locator('[data-og7="automatic-portfolio-processing"]')
  ).toHaveJSProperty('open', false);
}

for (const language of ['fr-CA', 'en']) {
  const failures = [
    {
      code: 'PREPARATION_SCHEMA_INCOMPATIBLE',
      message:
        language === 'en'
          ? 'a database update is required'
          : 'une mise à jour de la base de données est nécessaire'
    },
    {
      code: 'PREPARATION_DATABASE_ACCESS_DENIED',
      message:
        language === 'en'
          ? 'the technical team corrects the permissions'
          : 'la correction des droits par l’équipe technique'
    },
    {
      code: 'PREPARATION_UNAVAILABLE',
      message:
        language === 'en'
          ? 'The receipt is unavailable. Refresh to read current facts.'
          : 'Le bon est indisponible. Actualise pour relire les faits actuels.'
    }
  ];

  for (const failure of failures) {
    test(`carousel receipt read explains ${failure.code} and recovers without a write in ${language}`, async ({
      page
    }) => {
      const f = await fixture(page, language);
      f.receiptFailure = { status: 503, code: failure.code };
      await open(page, false);
      await expect(hook(page, 'error')).toContainText(failure.message);
      await expect(card(page)).toHaveCount(0);
      await expect(carousel(page)).not.toContainText(
        'Synthetic private database detail'
      );
      await expect(carousel(page)).not.toContainText(failure.code);
      expect(f.writes).toEqual([]);

      f.receiptFailure = null;
      await hook(page, 'refresh').click();
      await expectPosition(page, 3, language);
      await expect(hook(page, 'error')).toHaveCount(0);
      await expect(hook(page, 'approve')).toBeEnabled();
      expect(
        f.reads.filter((position) => position === 3).length
      ).toBeGreaterThan(1);
      expect(f.writes).toEqual([]);
    });
  }

  for (const failure of failures.slice(0, 2)) {
    test(`carousel approval explains ${failure.code} and keeps approval blocked until explicit refetch in ${language}`, async ({
      page
    }) => {
      const f = await fixture(page, language);
      f.approvalFailure = { status: 503, code: failure.code };
      await open(page);
      await hook(page, 'approve').click();
      await expect(hook(page, 'error')).toContainText(failure.message);
      await expectPosition(page, 3, language);
      await expect(hook(page, 'refresh')).toBeEnabled();
      await expect(hook(page, 'approve')).toBeDisabled();
      await expect(hook(page, 'stamp')).toHaveCount(0);
      expect(f.receipts.get(3)?.canApprove).toBe(true);
      expect(f.receipts.get(3)?.status).toBe('ready');
      expect(
        f.reads.filter((position) => position === 3).length
      ).toBeGreaterThan(1);
      expect(f.writes).toHaveLength(1);

      f.approvalFailure = null;
      await hook(page, 'refresh').click();
      await expect(hook(page, 'error')).toHaveCount(0);
      await expect(hook(page, 'approve')).toBeEnabled();
      await expect(hook(page, 'stamp')).toHaveCount(0);
      expect(f.writes).toHaveLength(1);
    });
  }
}

async function expectPosition(
  page: Page,
  position: number,
  language = 'fr-CA'
) {
  await expect(card(page)).toHaveCount(1);
  await expect(card(page)).toHaveAttribute(
    'data-og7-id',
    contributionId(position)
  );
  await expect(hook(page, 'position')).toHaveText(
    language === 'en' ? `Receipt ${position} of 6` : `Bon ${position} sur 6`
  );
}

for (const status of [401, 403]) {
  test(`a ${status} carousel read removes private receipt content and preserves the access error`, async ({
    page
  }) => {
    const f = await fixture(page);
    await open(page);
    f.receiptFailure = { status, code: 'PREPARATION_SCHEMA_INCOMPATIBLE' };
    await hook(page, 'refresh').click();
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(
      'Présentation privée du dossier synthétique 3.'
    );
    if (status === 403)
      await expect(hook(page, 'error')).toContainText(
        'Tes droits ne permettent plus cette opération.'
      );
    expect(f.writes).toEqual([]);
  });
}

async function expectInsideViewport(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const result = await target.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const viewport = element.ownerDocument.documentElement.clientWidth;
    return {
      left: bounds.left,
      right: bounds.right,
      viewport,
      width: bounds.width
    };
  });
  expect(result.width).toBeGreaterThan(0);
  expect(result.left).toBeGreaterThanOrEqual(-1);
  expect(result.right).toBeLessThanOrEqual(result.viewport + 1);
}

async function expectCompactReceipt(page: Page) {
  const current = card(page);
  await expect(current.locator('details[open]')).toHaveCount(0);
  await expect(hook(page, 'summary')).toBeVisible();
  await current.focus();
  await expect(current).toBeFocused();
  await current.evaluate((element) => {
    element.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  const geometry = () =>
    current.evaluate((element) => {
      const doc = element.ownerDocument;
      const view = doc.defaultView!;
      const body = element.closest<HTMLElement>(
        '[data-og7="admin-guidance-panel"]'
      )!;
      const bodyBounds = body.getBoundingClientRect();
      const clip = {
        top: Math.max(0, bodyBounds.top),
        bottom: Math.min(view.innerHeight, bodyBounds.bottom),
        left: Math.max(0, bodyBounds.left),
        right: Math.min(view.innerWidth, bodyBounds.right)
      };
      const required = [
        ['payment', '[data-og7="preparation-receipt-payment"]'],
        ['offer', '[data-og7="preparation-receipt-offer"]'],
        ['summary', '[data-og7="preparation-receipt-summary"]'],
        ['content', '[data-og7="preparation-receipt-content"] > summary'],
        ['scope', '[data-og7="preparation-receipt-approval-scope"]'],
        ['approve', '[data-og7="preparation-receipt-approve"]'],
        ['confirmations', '[data-og7="preparation-receipt-confirmations"]']
      ];
      return required.map(([name, selector]) => {
        const target = element.querySelector<HTMLElement>(selector!);
        if (!target) return { name, visibleTogether: false, unclipped: false };
        const bounds = target.getBoundingClientRect();
        const front = doc.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2
        );
        return {
          name,
          visibleTogether:
            bounds.width > 0 &&
            bounds.height > 0 &&
            bounds.top >= clip.top - 1 &&
            bounds.bottom <= clip.bottom + 1 &&
            bounds.left >= clip.left - 1 &&
            bounds.right <= clip.right + 1 &&
            !!front &&
            (front === target || target.contains(front)),
          unclipped: target.scrollWidth <= target.clientWidth + 1
        };
      });
    });
  await expect
    .poll(geometry, {
      message:
        'The collapsed receipt must show payment, promise, preparation and approval together without another scroll.'
    })
    .toEqual(
      [
        'payment',
        'offer',
        'summary',
        'content',
        'scope',
        'approve',
        'confirmations'
      ].map((name) => ({ name, visibleTogether: true, unclipped: true }))
    );
  const measurements = await current.evaluate((element) => {
    const doc = element.ownerDocument;
    const view = doc.defaultView!;
    const zoom =
      Number.parseFloat(getComputedStyle(doc.documentElement).zoom) || 1;
    const bounds = element.getBoundingClientRect();
    const body = element.closest<HTMLElement>(
      '[data-og7="admin-guidance-panel"]'
    )!;
    const bodyBounds = body.getBoundingClientRect();
    return {
      contributionId: element.getAttribute('data-og7-id'),
      zoom,
      viewport: { width: view.innerWidth, height: view.innerHeight },
      receipt: {
        widthCss: bounds.width / zoom,
        heightCss: bounds.height / zoom
      },
      guideBody: {
        widthCss: bodyBounds.width / zoom,
        heightCss: bodyBounds.height / zoom,
        scrollTop: body.scrollTop
      }
    };
  });
  expect(measurements.receipt.heightCss).toBeLessThanOrEqual(560);
  return measurements;
}

for (const language of ['fr-CA', 'en']) {
  test(`preparation approval records the exact receipt and stays on its card in ${language}`, async ({
    page
  }) => {
    const f = await fixture(page, language);
    await open(page);
    await expectPosition(page, 3, language);
    await expect(hook(page, 'payment')).toContainText('125');
    await expect(hook(page, 'payment')).toContainText('CAD');
    await expect(hook(page, 'offer')).toContainText('2');
    await expect(hook(page, 'offer')).toContainText('14');
    const content = hook(page, 'content');
    await content.locator('summary').click();
    await expect(content).toContainText(
      'Présentation privée du dossier synthétique 3.'
    );
    await expect(content).toContainText('Mention de commandite synthétique.');
    expect(f.writes).toEqual([]);

    let releaseApproval!: () => void;
    f.approvalGate = new Promise<void>((resolve) => {
      releaseApproval = resolve;
    });
    await hook(page, 'approve').click();
    await expect(hook(page, 'approve')).toBeDisabled();
    await expect(hook(page, 'stamp')).toHaveCount(0);
    await expect.poll(() => f.writes.length).toBe(1);
    releaseApproval();
    await expect(hook(page, 'stamp')).toBeVisible();
    await expect(hook(page, 'stamp')).toContainText(
      language === 'en' ? 'Preparation approved' : 'Préparation approuvée'
    );
    await expect(hook(page, 'stamp')).toContainText(actor);
    await expect(hook(page, 'stamp')).toContainText(
      receipt(3).version.slice(0, 12)
    );
    await expect(
      hook(page, 'stamp').locator(`time[datetime="${approvedAt}"]`)
    ).toBeVisible();
    await expectPosition(page, 3, language);
    await expect(hook(page, 'approve')).toBeDisabled();
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]).toMatchObject({
      pathname: `${receiptPath}/approve`,
      body: {
        runId,
        contributionId: contributionId(3),
        expectedVersion: receipt(3).version,
        confirmed: true
      }
    });
    expect(f.writes[0]!.body['requestId']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(f.state.run?.processedCount).toBe(3);
    expect(f.state.run?.version).toBe(4);

    await page.reload();
    await expectPosition(page, 3, language);
    await expect(hook(page, 'stamp')).toContainText(actor);
    expect(f.writes).toHaveLength(1);
  });
}

test('a receipt read started during approval cannot overwrite its confirmed stamp with an older snapshot', async ({
  page
}) => {
  const f = await fixture(page);
  await open(page);
  let releaseApproval!: () => void;
  f.approvalGate = new Promise<void>((resolve) => {
    releaseApproval = resolve;
  });
  await hook(page, 'approve').click();
  await expect.poll(() => f.writes.length).toBe(1);

  let releaseReceipt!: () => void;
  f.receiptGate = new Promise<void>((resolve) => {
    releaseReceipt = resolve;
  });
  const processing = page.locator(
    '[data-og7="automatic-portfolio-processing"]'
  );
  await processing.locator(':scope > summary').click();
  await expect(processing).toHaveJSProperty('open', true);
  await page.locator('[data-og7="automatic-portfolio-refresh"]').click();
  await expect.poll(() => f.reads.length).toBeGreaterThan(1);
  expect(f.receipts.get(3)?.status).toBe('ready');

  releaseApproval();
  await expect(hook(page, 'stamp')).toContainText(actor);
  await expectPosition(page, 3);
  const lateRead = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === receiptPath &&
      response.request().method() === 'GET'
  );
  releaseReceipt();
  await (await lateRead).finished();
  await sampledFrames(page);
  await expect(hook(page, 'stamp')).toContainText(actor);
  await expect(hook(page, 'approve')).toBeDisabled();
  await expectPosition(page, 3);
  expect(f.writes).toHaveLength(1);
  expect(f.state.run?.processedCount).toBe(3);
});

test('an incomplete preparation names its missing prerequisite and cannot be approved', async ({
  page
}) => {
  const f = await fixture(page);
  await open(page);
  await hook(page, 'previous').click();
  await expectPosition(page, 2);
  await expect(hook(page, 'blockers')).toBeVisible();
  await expect(hook(page, 'blockers')).toContainText(/consentement/i);
  await expect(
    hook(page, 'summary').getByText('À compléter', { exact: true })
  ).toBeVisible();
  await expect(
    hook(page, 'summary').getByText('Autorisée', { exact: true })
  ).toHaveCount(0);
  await expect(hook(page, 'approve')).toBeDisabled();
  await expect(hook(page, 'stamp')).toHaveCount(0);
  expect(f.writes).toEqual([]);
});

for (const code of ['fulfilment_unverified', 'obligation_unverified']) {
  test(`a ${code} preparation preserves its accepted offer and names the actual integrity check`, async ({
    page
  }) => {
    const f = await fixture(page);
    const original = f.receipts.get(3)!;
    f.receipts.set(3, {
      ...original,
      status: 'incomplete',
      canApprove: false,
      blockers: [
        {
          code,
          adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${original.contributionId}`
        }
      ]
    });
    await open(page);
    await expect(hook(page, 'offer')).not.toContainText(
      'L’accord d’origine est manquant'
    );
    await expect(hook(page, 'blockers')).toContainText(
      code === 'fulfilment_unverified'
        ? 'preuve de livraison'
        : 'suivi d’un engagement'
    );
    await expect(
      hook(page, 'summary').getByText('Autorisée', { exact: true })
    ).toHaveCount(0);
    await expect(hook(page, 'approve')).toBeDisabled();
    expect(f.writes).toEqual([]);
  });
}

test('cancelled, published and incomplete drafts keep their actual states while preparation authorization remains available', async ({
  page
}) => {
  const f = await fixture(page);
  const original = f.receipts.get(3)!;
  const scenarios = [
    { status: 'cancelled', body: original.drafts[0]!.body, label: 'Annulé' },
    { status: 'published', body: original.drafts[0]!.body, label: 'Publié' },
    { status: 'draft', body: '', label: 'À compléter' }
  ];
  for (const [index, scenario] of scenarios.entries()) {
    f.receipts.set(3, {
      ...original,
      version: ['b', 'c', 'd'][index]!.repeat(64),
      status: 'incomplete',
      canApprove: false,
      checks: original.checks.map((check) =>
        check.code === 'content_prepared'
          ? { ...check, state: 'missing' }
          : check
      ),
      drafts: original.drafts.map((draft) => ({
        ...draft,
        status: scenario.status,
        body: scenario.body
      })),
      blockers: [
        {
          code: 'publication_draft_incomplete',
          adminUrl: original.drafts[0]!.adminUrl
        }
      ]
    });
    if (index === 0) await open(page);
    else await hook(page, 'refresh').click();
    const summary = hook(page, 'summary');
    await expect(summary.getByText('Autorisée', { exact: true })).toBeVisible();
    await expect(
      summary.getByText(scenario.label, { exact: true })
    ).toBeVisible();
    await expect(summary.getByText(/Prêt.*privé/i)).toHaveCount(0);
    await expect(hook(page, 'approve')).toBeDisabled();
    await expect(hook(page, 'stamp')).toHaveCount(0);
  }
  expect(f.writes).toEqual([]);
  expect(f.state.run?.processedCount).toBe(3);
});

test('a stale version reloads the same receipt as À revoir and retains its prior approval history', async ({
  page
}) => {
  const f = await fixture(page);
  await open(page);
  const original = f.receipts.get(3)!;
  const priorApproval: NonNullable<AdminPreparationReceipt['approval']> = {
    id: '10000000-0000-4000-8000-000000001198',
    runId,
    contributionId: original.contributionId,
    version: original.version,
    actor: 'synthetic-previous-operator',
    approvedAt: '2026-10-17T11:00:00.000Z',
    requestId: '10000000-0000-4000-8000-000000001197',
    auditReference: 'synthetic-previous-approval-audit'
  };
  f.receipts.set(3, {
    ...original,
    version: 'a'.repeat(64),
    status: 'review_required',
    approval: null,
    approvalHistory: [priorApproval],
    drafts: original.drafts.map((draft) => ({
      ...draft,
      version: 'synthetic-draft-v2',
      body: 'Texte privé synthétique corrigé après la première lecture.'
    }))
  });
  await hook(page, 'approve').click();
  await expect(card(page)).toContainText('À revoir');
  await expectPosition(page, 3);
  await expect(hook(page, 'stamp')).toHaveCount(0);
  await expect(hook(page, 'error')).toBeVisible();
  await hook(page, 'history').locator('summary').click();
  await expect(hook(page, 'history')).toContainText(priorApproval.actor);
  await hook(page, 'content').locator('summary').click();
  await expect(hook(page, 'content')).toContainText(
    'Texte privé synthétique corrigé après la première lecture.'
  );
  expect(f.reads.filter((position) => position === 3).length).toBeGreaterThan(
    1
  );
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]!.body['expectedVersion']).toBe(original.version);
  expect(f.state.run?.processedCount).toBe(3);
});

test('previous and next only consult the frozen manifest and never advance treatment', async ({
  page
}) => {
  const f = await fixture(page);
  await open(page);
  const initialProgress = await hook(page, 'progress').innerText();
  for (const position of [4, 5, 6]) {
    await hook(page, 'next').click();
    await expectPosition(page, position);
    await expect(hook(page, 'progress')).toHaveText(initialProgress);
  }
  await expect(hook(page, 'next')).toBeDisabled();
  for (const position of [5, 4, 3, 2, 1]) {
    await hook(page, 'previous').click();
    await expectPosition(page, position);
    await expect(hook(page, 'progress')).toHaveText(initialProgress);
  }
  await expect(hook(page, 'previous')).toBeDisabled();
  expect(f.writes).toEqual([]);
  expect(f.reads).toEqual([3, 4, 5, 6, 5, 4, 3, 2, 1]);
  expect(f.state.run?.cursor).toBe(3);
  expect(f.state.run?.status).toBe('paused');
});

test('a historical website offer names its promised presentation and its private preparation visibly', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 960 });
  const f = await fixture(page);
  await open(page);
  await page.evaluate(() => {
    document.documentElement.style.zoom = '1.25';
  });
  await hook(page, 'previous').click();
  await expectPosition(page, 2);
  await hook(page, 'previous').click();
  await expectPosition(page, 1);
  await expect(
    hook(page, 'offer').getByText(/1\s*×\s*Présentation sur le site Web/i)
  ).toBeVisible();
  const summary = hook(page, 'summary');
  await expect(summary).toBeVisible();
  await expect(summary.getByText(/Web/)).toBeVisible();
  await expect(summary.getByText('Autorisée', { exact: true })).toBeVisible();
  await expect(summary.getByText('Brouillon', { exact: true })).toBeVisible();
  await expect(summary.getByText(/Prêt.*Privé/i)).toBeVisible();
  await expect(hook(page, 'approve')).toBeEnabled();
  await expect(hook(page, 'confirmations')).toContainText(
    /publication.*refus.*remboursement.*envoi/i
  );
  await expectCompactReceipt(page);
  await page.screenshot({
    path: testInfo.outputPath('ticket-web-390-125.png'),
    fullPage: false,
    animations: 'disabled'
  });
  await hook(page, 'content').locator('summary').click();
  await expect(hook(page, 'content')).toContainText(
    'Présentation privée du dossier synthétique 1.'
  );
  await hook(page, 'details').locator('summary').click();
  await expect(hook(page, 'details')).toContainText(
    'synthetic-historical-offer-v1'
  );
  expect(f.writes).toEqual([]);
  expect(f.state.run?.processedCount).toBe(3);
});

for (const width of [1440, 390]) {
  test(`receipt commands remain keyboard accessible and readable at 125% in a ${width}px viewport`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    const f = await fixture(page);
    await open(page);
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1.25';
    });
    await expectPosition(page, 3);
    const guide = page.locator('[data-og7="admin-guidance-panel"]');
    await guide.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({
      path: testInfo.outputPath(
        `preparation-receipt-${width}-125-overview.png`
      ),
      fullPage: false,
      animations: 'disabled'
    });
    const measurements = await expectCompactReceipt(page);
    await testInfo.attach(`preparation-receipt-${width}-125-measurements`, {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json'
    });
    await guide.screenshot({
      path: testInfo.outputPath(
        `preparation-receipt-${width}-125-before-approval.png`
      ),
      animations: 'disabled'
    });
    for (const name of ['previous', 'next', 'approve']) {
      const control = hook(page, name);
      await expect(control).toHaveAccessibleName(/\S/);
      await expectInsideViewport(control);
    }
    await expectInsideViewport(card(page));
    const next = hook(page, 'next');
    await next.focus();
    await expect(next).toBeFocused();
    await page.keyboard.press('Enter');
    await expectPosition(page, 4);
    const previous = hook(page, 'previous');
    await previous.focus();
    await page.keyboard.press('Space');
    await expectPosition(page, 3);
    expect(f.writes).toEqual([]);

    const audit = await new AxeBuilder({ page })
      .include('[data-og7="preparation-receipts-carousel"]')
      .analyze();
    expect(audit.violations).toEqual([]);
    await expect(carousel(page)).not.toContainText('admin.automatic.');
    await hook(page, 'approve').focus();
    await page.keyboard.press('Enter');
    await expect(hook(page, 'stamp')).toBeVisible();
    await expect(card(page)).toBeFocused();
    await expect(hook(page, 'stamp')).toContainText(actor);
    await expect(hook(page, 'stamp')).toContainText(
      receipt(3).version.slice(0, 12)
    );
    await expect(
      hook(page, 'stamp').locator(`time[datetime="${approvedAt}"]`)
    ).toBeVisible();
    await expectPosition(page, 3);
    expect(f.writes).toHaveLength(1);
    await hook(page, 'stamp').scrollIntoViewIfNeeded();
    await guide.screenshot({
      path: testInfo.outputPath(
        `preparation-receipt-${width}-125-after-approval.png`
      ),
      animations: 'disabled'
    });
  });
}
