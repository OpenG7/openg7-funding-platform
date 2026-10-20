import { AxeBuilder } from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import type {
  AdminAutomaticRunState,
  AdminCampaignItem,
  AdminCampaignsResponse,
  AdminPreparationReceipt,
  AdminWorkQueueResponse,
  PreparationAssistanceSummary
} from '@openg7/funding-core';

import { expect, sampledFrames, test } from './support/test.js';
import {
  adminController,
  installAdminController
} from './support/admin-controller.js';
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

async function approveReceipt(
  page: Page,
  activation: 'click' | 'Enter' = 'click'
) {
  const button = hook(page, 'approve');
  if (activation === 'click') await button.click();
  else {
    await button.focus();
    await page.keyboard.press(activation);
  }
  const confirmation = page.locator('[data-og7="confirm-action"]');
  await expect(confirmation).toBeVisible();
  await confirmation.click();
}

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
    campaignQueries: [] as URLSearchParams[],
    writes: [] as { pathname: string; body: Record<string, unknown> }[],
    approvalGate: null as Promise<void> | null,
    receiptGate: null as Promise<void> | null,
    receiptFailure: null as { status: number; code: string } | null,
    approvalFailure: null as { status: number; code: string } | null,
    assistance: null as PreparationAssistanceSummary | null,
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
    if (pathname === '/api/admin/campaigns') {
      f.campaignQueries.push(url.searchParams);
      const items: AdminCampaignItem[] = [...f.receipts.values()].flatMap(
        (current) =>
          (current.balance?.obligations ?? []).map((obligation) => ({
            id: obligation.id,
            contributionId: current.contributionId,
            reference: current.reference,
            companyName: `Atelier synthétique ${current.reference}`,
            paidAt: current.payment.confirmedAt ?? observedAt,
            channel: obligation.channel,
            target: obligation.target,
            ordinal: obligation.ordinal,
            quantity:
              current.acceptedOffer?.benefits.find(
                (benefit) => benefit.id === obligation.benefitId
              )?.quantity ?? 1,
            format: obligation.format ?? null,
            obligationState: obligation.state,
            timing: null,
            preparation: {
              status: current.status,
              version: current.version,
              approvedAt: current.approval?.approvedAt ?? null,
              blockers: current.blockers.map((blocker) => blocker.code)
            },
            workflow: {
              obligationId: obligation.id,
              channel: obligation.channel,
              target: obligation.target,
              ordinal: obligation.ordinal,
              state: 'action_required',
              responsibility: 'admin',
              reason: 'publication_draft_missing',
              deliveryId: null,
              scheduledAt: null
            },
            content: null,
            proof: null,
            adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${current.contributionId}&tab=publication`
          }))
      );
      const selected = items.filter(
        (item) =>
          item.contributionId === url.searchParams.get('sponsorshipId') &&
          (!url.searchParams.has('obligationId') ||
            item.id === url.searchParams.get('obligationId'))
      );
      const json: AdminCampaignsResponse = {
        generatedAt: observedAt,
        items: selected,
        pagination: {
          page: 1,
          pageSize: 25,
          totalItems: selected.length,
          totalPages: selected.length ? 1 : 0,
          hasPreviousPage: false,
          hasNextPage: false
        }
      };
      return route.fulfill({ json });
    }
    if (pathname === '/api/admin/sponsorships/preparation') {
      const source = [...f.receipts.values()].find(
        (current) =>
          current.contributionId === url.searchParams.get('sponsorshipId')
      );
      return route.fulfill({
        status: source ? 200 : 404,
        json: source ? { ...source, context: 'dossier' } : {}
      });
    }
    if (
      pathname === '/api/admin/preparation-assistance/summary' &&
      f.assistance
    )
      return route.fulfill({ json: f.assistance });
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
      await approveReceipt(page);
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
    language === 'en'
      ? `Receipt viewed: ${position} / 6`
      : `Bon consulté : ${position} / 6`
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
  const required = [
    ['payment', '[data-og7="preparation-receipt-payment"]'],
    ['offer', '[data-og7="preparation-receipt-offer-details"] > summary'],
    ['summary', '[data-og7="preparation-receipt-summary"]'],
    ['content', '[data-og7="preparation-receipt-content"] > summary'],
    ['scope', '[data-og7="preparation-receipt-approval-scope"]'],
    ['approve', '[data-og7="preparation-receipt-approve"]'],
    ['confirmations', '[data-og7="preparation-receipt-confirmations"]']
  ] as const;
  for (const [name, selector] of required) {
    const target = current.locator(selector);
    await expect(target).toBeVisible();
    await target.evaluate((element) => {
      element.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    await expect
      .poll(
        () =>
          target.evaluate((element) => {
            const doc = element.ownerDocument;
            const view = doc.defaultView!;
            const bounds = element.getBoundingClientRect();
            const content = element.closest<HTMLElement>(
              '[data-og7="admin-guidance-content"]'
            )!;
            const scroller =
              view.getComputedStyle(content).overflowY === 'visible'
                ? element.closest<HTMLElement>(
                    '[data-og7="admin-guidance-panel"]'
                  )!
                : content;
            const clip = scroller.getBoundingClientRect();
            const front = doc.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2
            );
            return {
              reachable:
                bounds.width > 0 &&
                bounds.height > 0 &&
                bounds.top >= Math.max(0, clip.top) - 1 &&
                bounds.bottom <= Math.min(view.innerHeight, clip.bottom) + 1 &&
                bounds.left >= Math.max(0, clip.left) - 1 &&
                bounds.right <= Math.min(view.innerWidth, clip.right) + 1 &&
                !!front &&
                (front === element || element.contains(front)),
              unclipped: element.scrollWidth <= element.clientWidth + 1
            };
          }),
        {
          message: `${name} stays readable and reachable in the Guide scroller`
        }
      )
      .toEqual({ reachable: true, unclipped: true });
  }
  await hook(page, 'approve').evaluate((element) => {
    element.parentElement!.scrollIntoView({
      block: 'center',
      behavior: 'instant'
    });
  });
  await expect
    .poll(() =>
      current.evaluate((element) => {
        const doc = element.ownerDocument;
        const view = doc.defaultView!;
        const content = element.closest<HTMLElement>(
          '[data-og7="admin-guidance-content"]'
        )!;
        const scroller =
          view.getComputedStyle(content).overflowY === 'visible'
            ? element.closest<HTMLElement>('[data-og7="admin-guidance-panel"]')!
            : content;
        const clip = scroller.getBoundingClientRect();
        return ['approval-scope', 'approve'].every((name) => {
          const target = element.querySelector<HTMLElement>(
            `[data-og7="preparation-receipt-${name}"]`
          )!;
          const bounds = target.getBoundingClientRect();
          const front = doc.elementFromPoint(
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2
          );
          return (
            bounds.top >= clip.top - 1 &&
            bounds.bottom <= clip.bottom + 1 &&
            !!front &&
            (front === target || target.contains(front))
          );
        });
      })
    )
    .toBe(true);
  const measurements = await current.evaluate((element) => {
    const doc = element.ownerDocument;
    const view = doc.defaultView!;
    const zoom =
      Number.parseFloat(getComputedStyle(doc.documentElement).zoom) || 1;
    const bounds = element.getBoundingClientRect();
    const content = element.closest<HTMLElement>(
      '[data-og7="admin-guidance-content"]'
    )!;
    const body =
      view.getComputedStyle(content).overflowY === 'visible'
        ? element.closest<HTMLElement>('[data-og7="admin-guidance-panel"]')!
        : content;
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
  expect(measurements.receipt.widthCss).toBeLessThanOrEqual(
    measurements.guideBody.widthCss
  );
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
    await hook(page, 'offer-details').locator(':scope > summary').click();
    await expect(hook(page, 'offer')).toBeVisible();
    await expect(hook(page, 'offer')).toContainText('2');
    await expect(hook(page, 'offer')).toContainText('14');
    await hook(page, 'offer-details').locator(':scope > summary').click();
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
    await approveReceipt(page);
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
  await approveReceipt(page);
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
  await approveReceipt(page);
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
  await hook(page, 'offer-details').locator(':scope > summary').click();
  await expect(
    hook(page, 'offer').getByText(/1\s*×\s*Présentation sur le site Web/i)
  ).toBeVisible();
  await hook(page, 'offer-details').locator(':scope > summary').click();
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
  await expect(hook(page, 'details')).toHaveCount(0);
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
    await page
      .locator('[data-og7="admin-guidance-content"]')
      .evaluate((element) => {
        const view = element.ownerDocument.defaultView!;
        const scroller =
          view.getComputedStyle(element).overflowY === 'visible'
            ? element.closest<HTMLElement>('[data-og7="admin-guidance-panel"]')!
            : element;
        scroller.scrollTop = 0;
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
    await approveReceipt(page, 'Enter');
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

const pilot = (page: Page) =>
  card(page).locator('[data-og7="preparation-pilot"]');
const pilotIssue = (page: Page, code: string) =>
  pilot(page).locator(
    `[data-og7="preparation-issue"][data-og7-id="check:${code}"]`
  );
const pilotAction = (page: Page, id: string) =>
  pilot(page).locator(
    id === 'open'
      ? '[data-og7="preparation-pilot-primary"][data-og7-id="preparation-open"]'
      : `[data-og7="preparation-pilot-action"][data-og7-id="preparation-${id}"]`
  );

test('numbered receipt cards browse independently from the server processing count', async ({
  page
}) => {
  const f = await fixture(page);
  await open(page);
  const slots = carousel(page).locator('[data-og7="preparation-receipt-slot"]');
  await expect(slots).toHaveCount(6);
  await expect(
    carousel(page).locator(
      '[data-og7="preparation-receipt-slot"][aria-current="true"]'
    )
  ).toHaveCount(1);
  await slots.filter({ hasText: '6' }).click();
  await expectPosition(page, 6);
  await expect(hook(page, 'progress')).toContainText('3');
  await expect(slots.filter({ hasText: '6' })).toHaveAttribute(
    'aria-current',
    'true'
  );
  await page.setViewportSize({ width: 320, height: 667 });
  for (const slot of await slots.all()) {
    const size = await slot.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
  expect(f.state.run?.processedCount).toBe(3);
  expect(f.writes).toEqual([]);
});

test('the direct intervention follows an explicitly selected control and keeps a satisfied selection after refresh', async ({
  page
}) => {
  const f = await missingSourcePilot(page);
  const primary = pilot(page).locator('[data-og7="preparation-pilot-primary"]');
  const initialLabel = await primary.innerText();
  await pilotIssue(page, 'moderation_review').click();
  await expect(primary).not.toHaveText(initialLabel);
  await expect(pilotIssue(page, 'moderation_review')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'peek');
  const verified = pilot(page).locator(
    '[data-og7="preparation-issues-verified"]'
  );
  await verified.locator(':scope > summary').click();
  await pilotIssue(page, 'payment_confirmed').click();
  await hook(page, 'refresh').click();
  await expect(pilotIssue(page, 'payment_confirmed')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(verified).toHaveJSProperty('open', true);
  await expect(hook(page, 'approve')).toBeDisabled();
  expect(f.writes).toEqual([]);
});

function pilotReceipt(completed = 0): AdminPreparationReceipt {
  const source = receipt(3);
  const resolved = (index: number) => index < completed;
  const blockers = [
    'commitment_needs_confirmation',
    'presentation_missing',
    'moderation_review_required'
  ];
  return {
    ...source,
    version: `synthetic-pilot-version-${completed}`,
    status: completed === 3 ? 'ready' : 'incomplete',
    canApprove: completed === 3,
    checks: [
      { code: 'accepted_offer', state: resolved(0) ? 'complete' : 'missing' },
      { code: 'content_prepared', state: resolved(1) ? 'complete' : 'missing' }
    ],
    authorizations: [
      { code: 'moderation_review', state: resolved(2) ? 'complete' : 'missing' }
    ],
    blockers: blockers.slice(completed).map((code) => ({
      code,
      adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${source.contributionId}&tab=publication`
    }))
  };
}

async function missingSourcePilot(page: Page, language = 'fr-CA') {
  const f = await fixture(page, language);
  f.receipts.set(3, {
    ...pilotReceipt(),
    acceptedOffer: null,
    balance: null,
    checks: [
      { code: 'dossier_examined', state: 'complete' },
      { code: 'payment_confirmed', state: 'complete' },
      { code: 'accepted_offer', state: 'missing' },
      { code: 'content_prepared', state: 'missing' }
    ],
    authorizations: [
      { code: 'public_consent', state: 'complete' },
      { code: 'sponsor_review', state: 'complete' },
      { code: 'moderation_review', state: 'missing' }
    ]
  });
  f.assistance = {
    contributionId: contributionId(3),
    controlCode: 'accepted_offer',
    revision: 'synthetic-source-missing',
    sourceVersion: null,
    commitmentVersion: 1,
    run: null,
    stale: false,
    capabilities: {
      canManageSource: true,
      canRun: true,
      canReview: true,
      canApply: true
    }
  };
  await open(page);
  await expectPilotProgress(page, 4, 7);
  await expect(
    pilot(page).locator('[data-og7="preparation-issue"]')
  ).toHaveCount(7);
  return f;
}

async function expectAttentionLayout(page: Page, layout: 'left' | 'above') {
  await expect
    .poll(() =>
      pilot(page).evaluate((element) => {
        const doc = element.ownerDocument;
        const view = doc.defaultView!;
        const bounds = (selector: string) =>
          element.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        const detail = bounds('[data-og7="preparation-issue-detail"]');
        const list = bounds('[data-og7="preparation-issue-list"]');
        const attention = element.querySelector<HTMLElement>(
          '[data-og7="preparation-issue-attention"]'
        )!;
        const content = element.closest<HTMLElement>(
          '[data-og7="admin-guidance-content"]'
        )!;
        const panel =
          view.getComputedStyle(content).overflowY === 'visible'
            ? element.closest<HTMLElement>('[data-og7="admin-guidance-panel"]')!
            : content;
        const panelBounds = panel.getBoundingClientRect();
        const clip = {
          left: Math.max(0, panelBounds.left),
          right: Math.min(view.innerWidth, panelBounds.right),
          top: Math.max(0, panelBounds.top),
          bottom: Math.min(view.innerHeight, panelBounds.bottom)
        };
        const inside = (target: DOMRect) =>
          target.width > 0 &&
          target.height > 0 &&
          target.left >= clip.left - 1 &&
          target.right <= clip.right + 1 &&
          target.top >= clip.top - 1 &&
          target.bottom <= clip.bottom + 1;
        const attentionBounds = attention.getBoundingClientRect();
        const hit = doc.elementFromPoint(
          attentionBounds.left + attentionBounds.width / 2,
          attentionBounds.top + attentionBounds.height / 2
        );
        return {
          left: detail.right <= list.left + 1,
          above: detail.bottom <= list.top + 1,
          attentionVisible:
            inside(attentionBounds) &&
            !!hit &&
            (hit === attention || attention.contains(hit)),
          listVisible: inside(list),
          overflow:
            doc.documentElement.scrollWidth > view.innerWidth + 1 ||
            panel.scrollWidth > panel.clientWidth + 1 ||
            element.scrollWidth > element.clientWidth + 1
        };
      })
    )
    .toMatchObject({
      [layout]: true,
      attentionVisible: true,
      ...(layout === 'left' ? { listVisible: true } : {}),
      overflow: false
    });
}

async function expectPilotProgress(page: Page, completed: number, total = 3) {
  const progress = pilot(page).locator(
    '[data-og7="preparation-pilot-progress"]'
  );
  await expect(progress).toHaveAttribute(
    'data-og7-completed',
    String(completed)
  );
  await expect(progress).toHaveAttribute('data-og7-total', String(total));
}

for (const language of ['fr-CA', 'en']) {
  test(`preparation pilot selects and inspects prerequisites without executing them in ${language}`, async ({
    page
  }) => {
    const f = await fixture(page, language);
    f.receipts.set(3, pilotReceipt());
    await open(page);
    await expectPilotProgress(page, 0);
    await expect(pilotIssue(page, 'accepted_offer')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'peek');
    await expect(pilotAction(page, 'approve')).toHaveCount(0);

    await pilotIssue(page, 'moderation_review').click();
    await expect(pilotIssue(page, 'moderation_review')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(pilotIssue(page, 'accepted_offer')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    const detail = pilot(page).locator('[data-og7="preparation-issue-detail"]');
    await expect(detail.getByRole('heading')).toHaveText(/\S/);
    await expect(pilotIssue(page, 'moderation_review')).toContainText(
      await detail.getByRole('heading').innerText()
    );
    await expect(pilot(page)).not.toContainText('admin.automatic.');
    expect(f.writes).toEqual([]);

    const actions = pilot(page).locator(
      '[data-og7="preparation-pilot-actions"]'
    );
    await actions.click();
    await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'open');
    await expect(pilotAction(page, 'open')).toBeVisible();
    await expect(pilotAction(page, 'details')).toHaveCount(0);
    await expect(pilotAction(page, 'campaigns')).toBeVisible();
    await expect(hook(page, 'details')).toHaveCount(0);
    expect(f.writes).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'peek');
    await expect(actions).toBeFocused();

    await page.keyboard.press('Space');
    await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'open');
    await pilotAction(page, 'back').click();
    await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'peek');
    await expect(actions).toBeFocused();
    expect(f.writes).toEqual([]);
  });
}

for (const language of ['fr-CA', 'en']) {
  test(`the ${language} missing-source attention stays beside the prerequisite list at desktop top and bottom without taking selection focus`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 1536, height: 864 });
    const f = await missingSourcePilot(page, language);
    const guide = page.locator('[data-og7="admin-guidance"]');
    const agreement = pilotIssue(page, 'accepted_offer');
    const content = pilotIssue(page, 'content_prepared');
    const detail = pilot(page).locator('[data-og7="preparation-issue-detail"]');
    const sourceAttention = pilot(page).locator(
      '[data-og7="preparation-issue-attention"]'
    );
    for (const placement of ['top', 'bottom']) {
      if (placement === 'bottom')
        await guide.locator('[data-og7="admin-guidance-move"]').click();
      await expect(guide).toHaveAttribute('data-og7-placement', placement);
      await agreement.click();
      await expect(agreement).toBeFocused();
      await expect(sourceAttention).toContainText(
        language === 'en'
          ? 'No original agreement source saved. Complete the agreement in its usual form.'
          : 'Aucune source de l’accord d’origine enregistrée. Complète l’accord dans son formulaire habituel.'
      );
      await expect(
        pilot(page).locator('[data-og7="preparation-assistance-summary-state"]')
      ).toHaveCount(1);
      await expectAttentionLayout(page, 'left');
      await guide.screenshot({
        path: testInfo.outputPath(`preparation-attention-${placement}.png`),
        animations: 'disabled'
      });
      const agreementTitle = await detail
        .getByRole('heading')
        .first()
        .innerText();

      await page.keyboard.press('ArrowDown');
      await expect(content).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(content).toHaveAttribute('aria-pressed', 'true');
      await expect(content).toBeFocused();
      await expect(detail).toHaveCount(1);
      await expect(detail.getByRole('heading').first()).not.toHaveText(
        agreementTitle
      );
      await expect(
        pilot(page).locator('[data-og7="preparation-assistance-summary"]')
      ).toHaveCount(0);
      await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'peek');

      await page.keyboard.press('ArrowUp');
      await expect(agreement).toBeFocused();
      await page.keyboard.press('Space');
      await expect(agreement).toHaveAttribute('aria-pressed', 'true');
      await expect(agreement).toBeFocused();
      await expect(detail.getByRole('heading').first()).toHaveText(
        agreementTitle
      );
      await expectAttentionLayout(page, 'left');
      const examined = pilotIssue(page, 'dossier_examined');
      const verified = pilot(page).locator(
        '[data-og7="preparation-issues-verified"]'
      );
      if (
        !(await verified.evaluate(
          (element) => (element as HTMLDetailsElement).open
        ))
      )
        await verified.locator(':scope > summary').click();
      await examined.click();
      await expect(examined).toBeFocused();
      await expect(examined).toHaveAttribute('aria-pressed', 'true');
      await expect(sourceAttention).toHaveText(
        language === 'en'
          ? 'This check is satisfied in the version being reviewed.'
          : 'Ce contrôle est satisfait dans la version consultée.'
      );
      await expect(
        pilot(page).locator('[data-og7="preparation-assistance-summary"]')
      ).toHaveCount(0);
      await expectPilotProgress(page, 4, 7);
      expect(f.writes).toEqual([]);
      await expect(page).toHaveURL(/\/admin\/fundraiser\/attention$/);
    }
  });
}

test('selecting promised publications reveals missing-source attention above the prerequisite list on mobile without horizontal scrolling', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await missingSourcePilot(page);
  const agreement = pilotIssue(page, 'accepted_offer');
  await agreement.click();
  await expect(agreement).toBeFocused();
  await expect(
    pilot(page).locator('[data-og7="preparation-issue-attention"]')
  ).toContainText('Aucune source de l’accord d’origine enregistrée.');
  await expectAttentionLayout(page, 'above');
  await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'peek');
  await page.locator('[data-og7="admin-guidance"]').screenshot({
    path: testInfo.outputPath('preparation-attention-mobile.png'),
    animations: 'disabled'
  });
  expect(f.writes).toEqual([]);
  await expect(page).toHaveURL(/\/admin\/fundraiser\/attention$/);
});

test('preparation keyboard navigation selects a prerequisite and only Actions opens its controller', async ({
  page
}) => {
  const f = await fixture(page);
  f.receipts.set(3, pilotReceipt());
  await open(page);
  const issues = pilot(page).locator('[data-og7="preparation-issue"]');
  await issues.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(issues.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(issues.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'peek');
  await page.keyboard.press('ArrowUp');
  await expect(issues.first()).toBeFocused();
  await page.keyboard.press('Space');
  await expect(issues.first()).toHaveAttribute('aria-pressed', 'true');
  expect(f.writes).toEqual([]);
  const actions = pilot(page).locator('[data-og7="preparation-pilot-actions"]');
  await actions.focus();
  await page.keyboard.press('Enter');
  await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'open');
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();
  expect(f.writes).toEqual([]);
});

test('preparation progress comes from refreshed server facts, retains the chosen control and enables approval only at three completed checks', async ({
  page
}) => {
  const f = await fixture(page);
  f.receipts.set(3, pilotReceipt());
  await open(page);
  await expectPilotProgress(page, 0);
  await pilotIssue(page, 'accepted_offer').click();
  await pilot(page).locator('[data-og7="preparation-pilot-actions"]').click();
  await expect(pilotAction(page, 'approve')).toHaveCount(0);
  await page.keyboard.press('Escape');

  f.receipts.set(3, pilotReceipt(1));
  await expectPilotProgress(page, 0);
  await hook(page, 'refresh').click();
  await expectPilotProgress(page, 1);
  await expect(pilotIssue(page, 'accepted_offer')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(pilotIssue(page, 'content_prepared')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  expect(f.writes).toEqual([]);

  f.receipts.set(3, pilotReceipt(3));
  await hook(page, 'refresh').click();
  await expectPilotProgress(page, 3);
  await pilot(page).locator('[data-og7="preparation-pilot-actions"]').click();
  await expect(hook(page, 'approve')).toBeVisible();
  await expect(hook(page, 'approve')).toBeEnabled();
  await expect(pilotAction(page, 'approve')).toHaveCount(0);
  await expect(pilotAction(page, 'open')).toHaveCount(1);
  await expect(pilotIssue(page, 'accepted_offer')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(f.writes).toEqual([]);
});

test('a prerequisite primary action opens its owning dossier without a preparation or batch mutation', async ({
  page
}) => {
  const f = await fixture(page);
  f.receipts.set(3, pilotReceipt());
  await open(page);
  const primary = pilot(page).locator('[data-og7="preparation-pilot-primary"]');
  await expect(primary).toBeVisible();
  await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'peek');
  await primary.click();
  await expect(page).toHaveURL(
    new RegExp(`sponsors\\?sponsorshipId=${contributionId(3)}&tab=publication`)
  );
  expect(f.writes).toEqual([]);
});

for (const language of ['fr-CA', 'en']) {
  test(`the Guide sends its current dossier to Campaigns without choosing among several services in ${language}`, async ({
    page
  }) => {
    const f = await fixture(page, language);
    await open(page);
    await expect(hook(page, 'details')).toHaveCount(0);
    await pilot(page).locator('[data-og7="preparation-pilot-actions"]').click();
    await expect(pilotAction(page, 'details')).toHaveCount(0);
    const action = pilotAction(page, 'campaigns');
    await expect(action).toHaveAccessibleName(
      language === 'en'
        ? /View services in Campaigns/
        : /Voir les prestations dans Campagnes/
    );
    await action.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      `/admin/fundraiser/campaigns?sponsorshipId=${contributionId(3)}`
    );
    const rows = page.locator('[data-og7="campaign-row"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'false');
    await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-og7="campaign-preparation"]')).toHaveCount(
      0
    );
    expect(f.campaignQueries[0]?.get('sponsorshipId')).toBe(contributionId(3));
    expect(f.campaignQueries[0]?.has('obligationId')).toBe(false);
    expect(f.writes).toEqual([]);
  });
}

test('Gamepad X sends the Guide receipt with a sole service to its Campaigns preparation without a mutation', async ({
  page
}) => {
  await installAdminController(page);
  const f = await fixture(page);
  await open(page);
  await hook(page, 'previous').click();
  await expectPosition(page, 2);
  await hook(page, 'previous').click();
  await expectPosition(page, 1);
  await expect(hook(page, 'details')).toHaveCount(0);
  await pilot(page).locator('[data-og7="preparation-pilot-actions"]').click();
  const pad = adminController(page);
  await pad.release();
  await pad.press('X');
  await expect(page).toHaveURL(
    `/admin/fundraiser/campaigns?sponsorshipId=${contributionId(1)}`
  );
  const rows = page.locator('[data-og7="campaign-row"]');
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveAttribute('aria-pressed', 'true');
  const selected = page.locator('[data-og7="campaign-preparation"]');
  await expect(
    selected.locator('[data-og7="preparation-receipt"]')
  ).toHaveAttribute('data-og7-id', contributionId(1));
  await expect(
    selected.locator('[data-og7="preparation-receipt-details"]')
  ).toHaveCount(1);
  expect(f.campaignQueries[0]?.get('sponsorshipId')).toBe(contributionId(1));
  expect(f.writes).toEqual([]);
});

test('the shared preparation approval asks for confirmation and cancellation sends nothing', async ({
  page
}) => {
  const f = await fixture(page);
  f.receipts.set(3, pilotReceipt(3));
  await open(page);
  await hook(page, 'approve').click();
  const confirmation = page.locator('[data-og7="confirm-action"]');
  await expect(confirmation).toBeVisible();
  expect(f.writes).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(hook(page, 'stamp')).toHaveCount(0);
  expect(f.writes).toEqual([]);

  await hook(page, 'approve').click();
  await confirmation.click();
  await expect(hook(page, 'stamp')).toContainText(actor);
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({
    pathname: `${receiptPath}/approve`,
    body: {
      contributionId: contributionId(3),
      runId,
      expectedVersion: pilotReceipt(3).version,
      confirmed: true
    }
  });
});

test('the incomplete preparation controller remains accessible in the effective 1536 by 864 desktop viewport with the guide at top and bottom', async ({
  page
}) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  const f = await fixture(page);
  f.receipts.set(3, pilotReceipt());
  await open(page);
  const guide = page.locator('[data-og7="admin-guidance"]');
  for (const placement of ['top', 'bottom']) {
    if (placement === 'bottom')
      await guide.locator('[data-og7="admin-guidance-move"]').click();
    await expect(guide).toHaveAttribute('data-og7-placement', placement);
    const actions = pilot(page).locator(
      '[data-og7="preparation-pilot-actions"]'
    );
    await actions.click();
    await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'open');
    for (const id of ['open', 'campaigns', 'history', 'back']) {
      const control = pilotAction(page, id);
      await expect(control).toHaveAccessibleName(/\S/);
      await expectInsideViewport(control);
      await expect
        .poll(() =>
          control.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const hit = element.ownerDocument.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2
            );
            return !!hit && (hit === element || element.contains(hit));
          })
        )
        .toBe(true);
    }
    expect(
      await guide.evaluate(
        (element) => element.scrollWidth - element.clientWidth
      )
    ).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'peek');
    await expect(actions).toBeFocused();
    expect(f.writes).toEqual([]);
  }
});

test('Gamepad first selects an unfocused prerequisite and the controller toggle closes without opening its primary action', async ({
  page
}) => {
  await installAdminController(page);
  const f = await fixture(page);
  f.receipts.set(3, pilotReceipt());
  await open(page);
  const pad = adminController(page);
  const issue = pilotIssue(page, 'moderation_review');
  await issue.focus();
  await pad.release();
  await pad.press('A');
  await expect(issue).toHaveAttribute('aria-pressed', 'true');
  await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'peek');
  expect(f.writes).toEqual([]);
  await expect(page).toHaveURL(/\/admin\/fundraiser\/attention$/);

  await pad.press('A');
  await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'open');
  const toggle = pilot(page).locator('[data-og7="context-controller-toggle"]');
  await toggle.focus();
  await pad.press('A');
  await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'peek');
  await expect(
    pilot(page).locator('[data-og7="preparation-pilot-actions"]')
  ).toBeFocused();
  await expect(page).toHaveURL(/\/admin\/fundraiser\/attention$/);
  expect(f.writes).toEqual([]);
});

test('Gamepad Y opens the existing preparation history without executing a mutation', async ({
  page
}) => {
  await installAdminController(page);
  const f = await fixture(page);
  const current = pilotReceipt(3);
  f.receipts.set(3, {
    ...current,
    approvalHistory: [
      {
        id: 'synthetic-previous-preparation-approval',
        runId,
        contributionId: current.contributionId,
        version: 'synthetic-previous-version',
        actor,
        approvedAt,
        requestId: 'synthetic-previous-request',
        auditReference: 'synthetic-previous-preparation-audit'
      }
    ]
  });
  await open(page);
  const pad = adminController(page);
  const actions = pilot(page).locator('[data-og7="preparation-pilot-actions"]');
  await actions.click();
  await expect(pilotAction(page, 'campaigns')).toBeFocused();
  await expect(hook(page, 'details')).toHaveCount(0);
  await expect(pilotAction(page, 'details')).toHaveCount(0);
  await pad.release();
  await pad.press('Y');
  await expect(hook(page, 'history')).toHaveJSProperty('open', true);
  await expect(hook(page, 'history').locator('summary')).toBeFocused();
  expect(f.writes).toEqual([]);
});

test('Gamepad opens the preparation controller through the same native actions, with a fresh press required for confirmation', async ({
  page
}) => {
  await installAdminController(page);
  const f = await fixture(page);
  f.receipts.set(3, pilotReceipt(3));
  await open(page);
  const pad = adminController(page);
  const actions = pilot(page).locator('[data-og7="preparation-pilot-actions"]');
  await actions.focus();
  await pad.release();
  await pad.press('A');
  await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'open');
  expect(f.writes).toEqual([]);
  await pad.press('B');
  await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'peek');
  await expect(actions).toBeFocused();
  await pad.release();
  await pad.press('A');
  await expect(pilot(page)).toHaveAttribute('data-og7-mode', 'open');
  await hook(page, 'approve').focus();
  await expect(hook(page, 'approve')).toBeFocused();
  // Focus changes invalidate held input. Observe neutral after the final target
  // has acquired focus before starting the distinct approval gesture.
  await pad.release();
  await pad.hold('A');
  const confirmation = page.locator('[data-og7="confirm-action"]');
  await expect(confirmation).toBeVisible();
  await sampledFrames(page);
  expect(f.writes).toEqual([]);
  await pad.release();
  await pad.press('B');
  await expect(confirmation).toHaveCount(0);
  expect(f.writes).toEqual([]);
});
