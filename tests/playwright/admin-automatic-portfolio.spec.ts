import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  AdminAutomaticRunEntry,
  AdminAutomaticRunState,
  AdminPaymentJourney,
  AdminWorkQueueResponse,
  ResponsibilityBalance
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  adminController,
  installAdminController
} from './support/admin-controller.js';

const path = '/admin/fundraiser/attention';
const runId = '10000000-0000-4000-8000-000000000911';
const paymentIds = [1, 2, 3].map(
  (n) => `10000000-0000-4000-8000-00000000092${n}`
);
const now = '2026-10-15T12:00:00Z';
const hook = (page: Page, name: string) =>
  page.locator(`[data-og7="automatic-portfolio-${name}"]`);
const highlighted = '[data-og7-guidance-highlight]';
type ReadingStep = 'scope' | 'dossier' | 'result' | 'summary';

function entry(index: number): AdminAutomaticRunEntry {
  const contributionId = paymentIds[index % paymentIds.length]!;
  const balanceStatus = (['balanced', 'action_required', 'unknown'] as const)[
    index % 3
  ]!;
  const fulfilled = balanceStatus === 'balanced';
  const obligationId = `10000000-0000-4000-8000-00000000093${index % 3}`;
  const balance: ResponsibilityBalance = {
    contributionId,
    reference: `DEMO-BALANCE-${index + 1}`,
    contributionType: 'sponsorship_interest',
    amountMinor: 5000,
    currency: index % 2 ? 'USD' : 'CAD',
    paymentStatus: 'paid',
    version: 'synthetic-observation',
    status: balanceStatus,
    expected: 1,
    fulfilled: fulfilled ? 1 : 0,
    waived: 0,
    outstanding: fulfilled ? 0 : 1,
    unknown: balanceStatus === 'unknown' ? 1 : 0,
    reasons: fulfilled
      ? ['delivery_late']
      : [
          balanceStatus === 'unknown'
            ? 'fulfilment_evidence_missing'
            : 'publication_pending'
        ],
    promisedBenefits: [
      {
        id: 'facebook_batch',
        channel: 'facebook',
        target: 'openg7',
        quantity: 1,
        format: 'individual_portrait',
        requiredElements: [
          'company_name',
          'approved_logo',
          'approved_presentation'
        ],
        deadlineDays: 14,
        durationDays: null
      }
    ],
    obligations: [
      {
        id: obligationId,
        benefitId: 'facebook_batch',
        channel: 'facebook',
        target: 'openg7',
        ordinal: 1,
        state: fulfilled ? 'fulfilled' : 'pending',
        version: 1,
        format: 'individual_portrait',
        timing: {
          version: 1,
          deadlineDays: 14,
          durationDays: null,
          originAt: '2026-10-01T00:00:00Z',
          originProvenance: 'activation',
          dueAt: '2026-10-15T00:00:00Z',
          overdue: !fulfilled,
          durationState: 'not_required',
          startObservation: null
        },
        ...(fulfilled
          ? {
              evidence: {
                id: '10000000-0000-4000-8000-000000000941',
                obligationId,
                contributionId,
                obligationVersion: 1,
                channel: 'facebook' as const,
                target: 'openg7' as const,
                provenance: 'provider_acknowledged' as const,
                deliveredAt: now,
                externalPostUrl: 'https://example.test/synthetic-delivery'
              }
            }
          : {})
      }
    ],
    next: fulfilled
      ? null
      : {
          reason: 'publication_pending',
          adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${contributionId}`,
          target: 'sponsorship-dossier'
        }
  };
  return {
    seq: index + 1,
    runId,
    pass: 1,
    contributionId,
    reference: balance.reference,
    balanceStatus,
    reasonCodes: balance.reasons,
    actions:
      index === 1
        ? [
            {
              kind: 'draft_prepared',
              targetId: 'synthetic-private-draft',
              channel: 'facebook',
              target: 'openg7',
              created: true,
              auditReference: 'synthetic-draft-audit'
            }
          ]
        : [],
    beforeBalance: balance,
    balance,
    createdAt: now,
    actor: 'synthetic-operator',
    requestId: `10000000-0000-4000-8000-00000000095${index % 10}`,
    auditReference: `synthetic-observation-${index + 1}`
  };
}

function runState(
  processed = 0,
  status: NonNullable<AdminAutomaticRunState['run']>['status'] = 'running'
): AdminAutomaticRunState {
  const latestEntry = processed ? entry(processed - 1) : null;
  return {
    run: {
      id: runId,
      version: processed + 1,
      status,
      startedAt: now,
      updatedAt: now,
      observedAt: processed ? now : null,
      pass: 1,
      cursor: processed,
      dossierCount: 3,
      processedCount: processed,
      balancedCount: processed ? 1 : 0,
      outstandingCount: Math.max(0, processed - 1),
      unknownCount: processed === 3 ? 1 : 0,
      uncoveredCount: 3 - processed,
      newPaymentCount: processed === 3 ? 1 : 0,
      currencyTotals: [
        { currency: 'CAD', amountMinor: 10000 },
        { currency: 'USD', amountMinor: 5000 }
      ],
      latestEntry,
      nextContributionId:
        status === 'completed' ? null : (paymentIds[processed] ?? null),
      globalBalanced: false
    },
    balance: latestEntry?.balance ?? null
  };
}

function paymentJourney(contributionId: string): AdminPaymentJourney {
  const index = paymentIds.indexOf(contributionId);
  const dossier = entry(index);
  const adminUrl = `/admin/fundraiser/sponsors?sponsorshipId=${contributionId}`;
  return {
    contributionId,
    reference: dossier.reference,
    contributionType: dossier.balance.contributionType,
    amountMinor: dossier.balance.amountMinor,
    currency: dossier.balance.currency,
    paymentStatus: 'paid',
    state: 'action_required',
    completed: 1,
    total: 2,
    steps: [
      {
        id: 'payment',
        state: 'complete',
        reason: 'payment_recorded',
        adminUrl: `/admin/fundraiser/contributions?contributionId=${contributionId}`
      },
      {
        id: 'publication',
        state: 'pending',
        reason: 'publication_pending',
        adminUrl,
        target: 'sponsorship-dossier'
      }
    ],
    next: {
      reason: 'publication_pending',
      adminUrl,
      target: 'sponsorship-dossier'
    }
  };
}

/** Built UI only: synthetic API observations, never proof of real financial work. */
async function fixture(page: Page, language = 'fr-CA') {
  const f = {
    language,
    state: { run: null, balance: null } as AdminAutomaticRunState,
    entries: [] as AdminAutomaticRunEntry[],
    writes: [] as { pathname: string; body: Record<string, unknown> }[],
    readGate: null as Promise<void> | null,
    advanceGate: null as Promise<void> | null,
    loseAdvanceResponse: false,
    invalidPaymentFacts: false,
    reportReads: [] as number[],
    reportSeedCount: 0,
    reportGate: null as Promise<void> | null,
    journeyReads: [] as string[],
    journeyGate: null as Promise<void> | null,
    journeyStatus: 200,
    queueActionCounts: {} as AdminWorkQueueResponse['actionCounts'],
    queuePendingDossierCount:
      0 as AdminWorkQueueResponse['pendingDossierCount'],
    queueTotal: 0,
    queueInformational: 0,
    queueAvailable: true,
    queueCoverage: 'complete' as 'complete' | 'unavailable' | 'partial',
    queueStatus: 200,
    queueReads: 0,
    signedIn: true
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
      if (pathname === '/api/admin/automatic-runs') {
        if (f.invalidPaymentFacts)
          return route.fulfill({
            status: 503,
            json: { code: 'RUN_INVALID_PAYMENT_FACTS' }
          });
        f.state = runState();
        f.entries = [];
        return route.fulfill({ json: f.state });
      }
      if (pathname === '/api/admin/automatic-runs/advance') {
        if (f.advanceGate) await f.advanceGate;
        const processed = (f.state.run?.processedCount ?? 0) + 1;
        f.entries.push(entry(processed - 1));
        f.state = runState(
          processed,
          f.loseAdvanceResponse
            ? 'uncertain'
            : processed === 3
              ? 'completed'
              : 'running'
        );
        if (processed === 3 && f.reportSeedCount > 0)
          f.entries = Array.from({ length: f.reportSeedCount }, (_, index) =>
            entry(index)
          );
        if (f.loseAdvanceResponse) return route.abort('failed');
        return route.fulfill({ json: f.state });
      }
      if (pathname === '/api/admin/automatic-runs/control' && f.state.run) {
        f.state = {
          ...f.state,
          run: {
            ...f.state.run,
            version: f.state.run.version + 1,
            status: ['pause', 'reconcile'].includes(String(body['action']))
              ? 'paused'
              : 'running'
          }
        };
        return route.fulfill({ json: f.state });
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
              id: 'portfolio-synthetic-owner',
              sessionId: 'portfolio-synthetic-session',
              displayName: 'Compte synthétique',
              role: 'owner',
              expiresAt: '2099-01-01T00:00:00Z'
            }
          : {}
      });
    if (pathname === '/api/admin/automatic-runs') {
      if (f.readGate) await f.readGate;
      return route.fulfill({ json: f.state });
    }
    if (pathname === '/api/admin/payment-journey') {
      const contributionId = url.searchParams.get('contributionId')!;
      f.journeyReads.push(contributionId);
      if (f.journeyGate) await f.journeyGate;
      if (f.journeyStatus !== 200)
        return route.fulfill({
          status: f.journeyStatus,
          json: { code: 'SYNTHETIC_PREVIEW_UNAVAILABLE' }
        });
      return route.fulfill({
        json: {
          status: 'ok',
          generatedAt: now,
          journey: paymentJourney(contributionId)
        }
      });
    }
    if (pathname === '/api/admin/automatic-runs/report') {
      const after = Number(url.searchParams.get('after') ?? 0);
      f.reportReads.push(after);
      if (after > 0 && f.reportGate) await f.reportGate;
      const entries = f.entries.filter((item) => item.seq > after).slice(0, 50);
      return route.fulfill({
        json: {
          entries,
          nextCursor: f.entries.some(
            (item) => item.seq > (entries.at(-1)?.seq ?? after)
          )
            ? (entries.at(-1)?.seq ?? null)
            : null
        }
      });
    }
    if (pathname === '/api/admin/attention') {
      f.queueReads++;
      if (f.queueStatus !== 200)
        return route.fulfill({
          status: f.queueStatus,
          json: { code: 'SYNTHETIC_ATTENTION_UNAVAILABLE' }
        });
      return route.fulfill({
        json: {
          available: f.queueAvailable,
          coverage: f.queueCoverage,
          missingSources:
            f.queueCoverage === 'complete' ? [] : ['synthetic-source'],
          generatedAt: now,
          timezone: 'America/Toronto',
          total: f.queueTotal,
          filteredTotal: 0,
          todayTotal: 0,
          counts: {
            urgent: 0,
            today: 0,
            this_week: 0,
            informational: f.queueInformational
          },
          typeCounts: {},
          actionCounts: f.queueActionCounts,
          pendingDossierCount: f.queuePendingDossierCount,
          page: 1,
          pageSize: 25,
          items: []
        }
      });
    }
    return route.fulfill({
      status: 503,
      json: { code: 'SYNTHETIC_UI_FIXTURE_UNAVAILABLE' }
    });
  });
  return f;
}

async function expandProcessing(page: Page) {
  const processing = hook(page, 'processing');
  await expect(processing).toBeVisible();
  if ((await processing.getAttribute('open')) === null)
    await processing.locator(':scope > summary').click();
  await expect(processing).toHaveJSProperty('open', true);
}

async function open(page: Page, phase = 'review', expand = true) {
  await page.goto(path);
  const toggle = page.locator('[data-og7="admin-guidance-toggle"]');
  await expect(toggle).toBeVisible();
  const panel = page.locator('[data-og7="admin-guidance-panel"]');
  if (!(await panel.isVisible())) await toggle.click();
  await page.locator('[data-og7="admin-guidance-automatic-mode"]').click();
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', phase);
  if (expand) await expandProcessing(page);
}

async function expectReading(page: Page, step: ReadingStep) {
  await expect(hook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'awaiting_approval'
  );
  await expect(hook(page, 'processing')).toHaveJSProperty('open', true);
  await expect(hook(page, 'reading')).toHaveAttribute('data-og7-id', step);
  await expect(hook(page, 'approve')).toBeEnabled();
  const target = hook(page, step === 'result' ? 'latest' : step);
  await expect(target).toHaveAttribute('data-og7-guidance-highlight', '');
}

async function approveReading(page: Page, step: ReadingStep) {
  await expectReading(page, step);
  const approval = hook(page, 'approve');
  const reviewId = await approval.getAttribute('data-og7-id');
  expect(reviewId).toMatch(/^\d+$/);
  await approval.click();
  await expect(
    page.locator(
      `[data-og7="automatic-portfolio-approve"][data-og7-id="${reviewId}"]`
    )
  ).toHaveCount(0);
}

type PortfolioFixture = Awaited<ReturnType<typeof fixture>>;
const advances = (f: PortfolioFixture) =>
  f.writes.filter((write) => write.pathname.endsWith('/advance'));

async function expectProgress(page: Page, processed: number, total = 3) {
  const progress = hook(page, 'progress');
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute('value', String(processed));
  await expect(progress).toHaveAttribute('max', String(Math.max(total, 1)));
}

/** Each call is an explicit test gesture, never an API-fixture approval. */
async function readDossiers(page: Page, f: PortfolioFixture, firstIndex = 0) {
  for (let index = firstIndex; index < paymentIds.length; ++index) {
    await expectReading(page, 'dossier');
    await expectProgress(page, index);
    await expect(hook(page, 'dossier')).toContainText(
      `DEMO-BALANCE-${index + 1}`
    );
    expect(advances(f)).toHaveLength(index);
    expect(f.journeyReads.at(-1)).toBe(paymentIds[index]);
    await approveReading(page, 'dossier');
    await expectReading(page, 'result');
    await expect(hook(page, 'latest')).toContainText(
      `DEMO-BALANCE-${index + 1}`
    );
    await expectProgress(page, index + 1);
    const status = entry(index).balanceStatus;
    const statusLabel = {
      balanced: f.language === 'en' ? 'Balanced' : 'Équilibré',
      action_required: f.language === 'en' ? 'Your action' : 'À toi',
      waiting: f.language === 'en' ? 'Waiting' : 'En attente',
      blocked: f.language === 'en' ? 'Blocked' : 'Bloqué',
      unknown: f.language === 'en' ? 'To clarify' : 'À clarifier'
    }[status];
    await expect(hook(page, 'dossier-status')).toHaveAttribute(
      'data-og7-id',
      status
    );
    await expect(hook(page, 'dossier-status')).toHaveText(statusLabel);
    expect(advances(f)).toHaveLength(index + 1);
    await approveReading(page, 'result');
  }
  await expectReading(page, 'summary');
  await expectProgress(page, paymentIds.length);
  await expect(hook(page, 'state')).toContainText(
    f.language === 'en' ? 'Your review' : 'À toi de lire'
  );
  await expect(hook(page, 'completion')).toHaveCount(0);
}

async function completePassage(page: Page, f: PortfolioFixture) {
  await expectReading(page, 'scope');
  await expectProgress(page, 0);
  await expect(hook(page, 'progress')).toHaveAccessibleName(
    f.language === 'en' ? 'Checked dossiers' : 'Dossiers vérifiés'
  );
  expect(advances(f)).toHaveLength(0);
  await approveReading(page, 'scope');
  await readDossiers(page, f);
  await approveReading(page, 'summary');
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'completed');
  await expect(page.locator(highlighted)).toHaveCount(0);
}

for (const [language, width] of [
  ['fr-CA', 1440],
  ['en', 390]
] as const) {
  test(`the header starts a responsibility passage from the closed guide in ${language}`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await fixture(page, language);
    f.queueActionCounts = undefined;
    await page.goto(path);
    const shortcut = page.locator(
      '[data-og7="admin-automatic-portfolio-start"]'
    );
    await expect(shortcut).toBeVisible();
    await expect(shortcut).toHaveAccessibleName(
      language === 'en' ? 'Start a new passage' : 'Démarrer un nouveau passage'
    );
    await expect(shortcut).toHaveAccessibleDescription(
      language === 'en' ? 'Dossiers to process: 0' : 'Dossiers à traiter : 0'
    );
    await expect(
      page.locator('[data-og7="admin-automatic-portfolio-count"]')
    ).toHaveText('0');
    await expect(
      page.locator('[data-og7="admin-automatic-portfolio-bell"]')
    ).toHaveAttribute('data-og7-id', 'inactive');
    await expect(page.locator('[data-og7="admin-guidance-panel"]')).toHaveCount(
      0
    );
    await page
      .locator('header')
      .filter({ has: shortcut })
      .screenshot({
        path: test.info().outputPath(`header-${language}.png`),
        animations: 'disabled'
      });
    expect(f.writes).toEqual([]);
    await shortcut.click();
    await completePassage(page, f);
    await expect(hook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      'completed'
    );
    expect(
      f.writes.filter((write) => write.pathname === '/api/admin/automatic-runs')
    ).toHaveLength(1);
    expect(
      f.writes.filter((write) => write.pathname.endsWith('/advance'))
    ).toHaveLength(3);
    await expect(
      page.locator('[data-og7="admin-guidance-automatic-mode"]')
    ).toHaveAttribute('aria-pressed', 'true');
    const shortcutBounds = await shortcut.boundingBox();
    expect(shortcutBounds).not.toBeNull();
    expect(shortcutBounds!.x).toBeGreaterThanOrEqual(0);
    expect(shortcutBounds!.x + shortcutBounds!.width).toBeLessThanOrEqual(
      width
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    const writesBeforeReload = f.writes.length;
    await page.reload();
    await expandProcessing(page);
    await expect(hook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      'completed'
    );
    expect(f.writes).toHaveLength(writesBeforeReload);
  });
}

for (const [language, width] of [
  ['fr-CA', 1440],
  ['en', 390]
] as const) {
  test(`passage reading stays illuminated until a separate human approval for every step in ${language}`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const f = await fixture(page, language);
    let releaseAdvance!: () => void;
    f.advanceGate = new Promise<void>((resolve) => {
      releaseAdvance = resolve;
    });
    await page.goto(path);
    await page.locator('[data-og7="admin-automatic-portfolio-start"]').click();
    await expectReading(page, 'scope');
    const approval = hook(page, 'approve');
    await expect(approval).toHaveAccessibleName(
      language === 'en' ? 'I’ve read it, continue' : 'J’ai lu, continuer'
    );
    const scope = hook(page, 'scope');
    const help = hook(page, 'help');
    await expect(help).toBeVisible();
    await expect(hook(page, 'resume')).toBeHidden();
    await expect(help).toHaveJSProperty('open', false);
    await expect(hook(page, 'state')).toContainText(
      language === 'en' ? 'Your review' : 'À toi de lire'
    );
    await expectProgress(page, 0);
    const writesBeforeHelp = f.writes.length;
    const helpToggle = help.locator('summary');
    await helpToggle.focus();
    await helpToggle.press('Enter');
    await expect(help).toHaveJSProperty('open', true);
    await helpToggle.press('Enter');
    await expect(help).toHaveJSProperty('open', false);
    await expectReading(page, 'scope');
    expect(f.writes).toHaveLength(writesBeforeHelp);
    await page.locator('[data-og7="admin-guidance-panel"]').screenshot({
      path: test.info().outputPath(`compact-scope-${language}.png`),
      animations: 'disabled'
    });
    const scopeElement = (await scope.elementHandle())!;
    expect(
      await scope.evaluate((element) =>
        element.getAnimations().map((animation) => ({
          continuous: animation.effect?.getTiming().iterations === Infinity,
          running: animation.playState === 'running',
          changesLayout: (animation.effect as KeyframeEffect)
            .getKeyframes()
            .some(
              (frame) =>
                frame.transform !== undefined || frame.width !== undefined
            )
        }))
      )
    ).toEqual([{ continuous: true, running: true, changesLayout: false }]);
    await page.clock.install();
    await page.clock.fastForward(12000);
    await expectReading(page, 'scope');
    expect(advances(f)).toHaveLength(0);
    expect(f.journeyReads).toEqual([]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect
      .poll(() => scope.evaluate((element) => element.getAnimations().length))
      .toBe(0);
    await expect(scope).toHaveAttribute('data-og7-guidance-highlight', '');
    await expect(scope).toHaveCSS('outline-style', 'solid');
    await expect(scope).toHaveCSS('outline-width', '3px');
    await approval.focus();
    await expect(approval).toBeFocused();
    await approval.press('Enter');
    await expectReading(page, 'dossier');
    await expect(
      page.locator(
        '[data-og7="automatic-portfolio-scope"][data-og7-guidance-highlight]'
      )
    ).toHaveCount(0);
    await expect
      .poll(() =>
        scopeElement.evaluate((element) => ({
          marker: element.getAttribute('data-og7-guidance-highlight'),
          animations: element.getAnimations().length
        }))
      )
      .toEqual({ marker: null, animations: 0 });
    expect(advances(f)).toHaveLength(0);
    expect(f.journeyReads).toEqual([paymentIds[0]]);
    await expect(hook(page, 'dossier')).toContainText('DEMO-BALANCE-1');
    await hook(page, 'approve').evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
    await expect(hook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      'advancing'
    );
    await expect.poll(() => advances(f).length).toBe(1);
    await expect(hook(page, 'approve')).toHaveCount(0);
    releaseAdvance();
    await expectReading(page, 'result');
    await page.clock.fastForward(12000);
    await expectReading(page, 'result');
    expect(advances(f)).toHaveLength(1);
    await expect(hook(page, 'latest')).toContainText('DEMO-BALANCE-1');
    await expectProgress(page, 1);
    await hook(page, 'pause').click();
    await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'paused');
    await expect(page.locator(highlighted)).toHaveCount(0);
    await expect(hook(page, 'approve')).toHaveCount(0);
    await page.clock.fastForward(12000);
    expect(advances(f)).toHaveLength(1);
  });
}

for (const language of ['fr-CA', 'en']) {
  test(`an empty durable passage keeps a valid zero progress indicator without starting work in ${language}`, async ({
    page
  }) => {
    const f = await fixture(page, language);
    const state = runState(0, 'completed');
    f.state = {
      ...state,
      run: {
        ...state.run!,
        dossierCount: 0,
        uncoveredCount: 0,
        nextContributionId: null,
        currencyTotals: []
      }
    };
    await open(page, 'completed');
    await expectProgress(page, 0, 0);
    await expect(hook(page, 'progress')).toHaveAccessibleName(
      language === 'en' ? 'Checked dossiers' : 'Dossiers vérifiés'
    );
    await expect(hook(page, 'reading')).toHaveCount(0);
    await expect(hook(page, 'dossier-status')).toHaveCount(0);
    expect(f.writes).toEqual([]);
  });
}

for (const language of ['fr-CA', 'en']) {
  test(`the header counts unique pending dossiers and activates its bell in ${language}`, async ({
    page
  }) => {
    await page.setViewportSize({
      width: language === 'en' ? 390 : 1440,
      height: 900
    });
    const f = await fixture(page, language);
    f.queueActionCounts = {
      sponsorship_needs_review: 2,
      publication_needs_preparation: 3
    };
    f.queuePendingDossierCount = 2;
    f.queueTotal = 14;
    f.queueInformational = 9;
    await page.goto(path);
    const shortcut = page.locator(
      '[data-og7="admin-automatic-portfolio-start"]'
    );
    await expect(
      page.locator('[data-og7="admin-automatic-portfolio-count"]')
    ).toHaveText('2');
    await expect(
      page.locator('[data-og7="admin-automatic-portfolio-bell"]')
    ).toHaveAttribute('data-og7-id', 'active');
    await expect(shortcut).toHaveAccessibleName(
      language === 'en' ? 'Start a new passage' : 'Démarrer un nouveau passage'
    );
    await expect(shortcut).toHaveAttribute(
      'aria-describedby',
      'admin-new-passage-count-description'
    );
    await expect(shortcut).toHaveAccessibleDescription(
      language === 'en' ? 'Dossiers to process: 2' : 'Dossiers à traiter : 2'
    );
    await page
      .locator('header')
      .filter({ has: shortcut })
      .screenshot({
        path: test.info().outputPath(`header-active-${language}.png`),
        animations: 'disabled'
      });
    const accessibility = await new AxeBuilder({ page })
      .include('header')
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(
      page.locator('[data-og7="admin-automatic-portfolio-bell"]')
    ).toHaveCSS('animation-name', 'none');
    expect(f.writes).toEqual([]);
  });
}

for (const queueState of [
  'unavailable',
  'partial',
  'forbidden',
  'missing_dossier_count'
] as const) {
  test(`the header shows an unknown count with an inactive bell for a ${queueState} queue`, async ({
    page
  }) => {
    const language = queueState === 'forbidden' ? 'en' : 'fr-CA';
    const f = await fixture(page, language);
    f.queueActionCounts = { sponsorship_needs_review: 5 };
    f.queuePendingDossierCount = 5;
    await page.goto(path);
    const shortcut = page.locator(
      '[data-og7="admin-automatic-portfolio-start"]'
    );
    const count = page.locator('[data-og7="admin-automatic-portfolio-count"]');
    await expect(count).toHaveText('5');
    if (queueState === 'unavailable') {
      f.queueAvailable = false;
      f.queueCoverage = 'unavailable';
    } else if (queueState === 'partial') f.queueCoverage = 'partial';
    else if (queueState === 'forbidden') f.queueStatus = 403;
    else f.queuePendingDossierCount = undefined;
    await page
      .locator('[data-og7="attention-panel"]')
      .getByRole('button', {
        name: language === 'en' ? 'Refresh tasks' : 'Actualiser les tâches',
        exact: true
      })
      .click();
    await expect(shortcut).toBeVisible();
    await expect(count).toHaveText('—');
    await expect(
      page.locator('[data-og7="admin-automatic-portfolio-bell"]')
    ).toHaveAttribute('data-og7-id', 'inactive');
    await expect(shortcut).toHaveAccessibleDescription(
      language === 'en'
        ? 'Dossier count unavailable.'
        : 'Compteur des dossiers indisponible.'
    );
    expect(f.writes).toEqual([]);
  });
}

test('finishing a passage refreshes the server count and deactivates the header bell when no dossiers remain', async ({
  page
}) => {
  const f = await fixture(page);
  f.queueActionCounts = { sponsorship_needs_review: 5 };
  f.queuePendingDossierCount = 5;
  await page.goto(path);
  const count = page.locator('[data-og7="admin-automatic-portfolio-count"]');
  await expect(count).toHaveText('5');
  const readsBeforePassage = f.queueReads;
  await page.locator('[data-og7="admin-automatic-portfolio-start"]').click();
  await approveReading(page, 'scope');
  await readDossiers(page, f);
  await expect(count).toHaveText('5');
  f.queueActionCounts = {};
  f.queuePendingDossierCount = 0;
  await approveReading(page, 'summary');
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'completed');
  await expect.poll(() => f.queueReads).toBeGreaterThan(readsBeforePassage);
  await expect(count).toHaveText('0');
  await expect(
    page.locator('[data-og7="admin-automatic-portfolio-bell"]')
  ).toHaveAttribute('data-og7-id', 'inactive');
});

test('the header shortcut supports the keyboard and suppresses another start while loading', async ({
  page
}) => {
  const f = await fixture(page);
  let releaseRead!: () => void;
  f.readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  await page.goto(path);
  const shortcut = page.locator('[data-og7="admin-automatic-portfolio-start"]');
  await expect(shortcut).toBeEnabled();
  await shortcut.focus();
  await expect(shortcut).toBeFocused();
  await shortcut.press('Enter');
  await expect(shortcut).toBeDisabled();
  await shortcut.press('Enter');
  expect(f.writes).toEqual([]);
  releaseRead();
  await completePassage(page, f);
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'completed');
  expect(
    f.writes.filter((write) => write.pathname === '/api/admin/automatic-runs')
  ).toHaveLength(1);
});

test('closing the guide cancels a header start while its current passage is loading', async ({
  page
}) => {
  const f = await fixture(page);
  let releaseRead!: () => void;
  f.readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  await page.goto(path);
  const shortcut = page.locator('[data-og7="admin-automatic-portfolio-start"]');
  await expect(shortcut).toBeEnabled();
  await shortcut.click();
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'loading');
  const toggle = page.locator('[data-og7="admin-guidance-toggle"]');
  await toggle.click();
  await expect(page.locator('[data-og7="admin-guidance-panel"]')).toHaveCount(
    0
  );
  const readResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/admin/automatic-runs'
  );
  releaseRead();
  await (await readResponse).finished();
  await expect(shortcut).toBeEnabled();
  expect(f.writes).toEqual([]);
  await toggle.click();
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'review');
  await expect(hook(page, 'start')).toBeEnabled();
  expect(f.writes).toEqual([]);
});

test('a new session reads its own passage before a suspended previous session returns', async ({
  page
}) => {
  const f = await fixture(page);
  const oldEntry = { ...entry(2), reference: 'SESSION-A-PRIVATE-REPORT' };
  const oldState = runState(3, 'completed');
  const stateA: AdminAutomaticRunState = {
    ...oldState,
    run: { ...oldState.run!, latestEntry: oldEntry }
  };
  const newEntry = { ...entry(0), reference: 'SESSION-B-CURRENT-REPORT' };
  const newState = runState(1, 'paused');
  const stateB: AdminAutomaticRunState = {
    ...newState,
    run: {
      ...newState.run!,
      id: '10000000-0000-4000-8000-000000000912',
      latestEntry: newEntry
    }
  };
  let owner: 'A' | 'B' = 'A';
  let releaseA!: () => void;
  const gateA = new Promise<void>((resolve) => {
    releaseA = resolve;
  });
  const reads: string[] = [];
  await page.route('**/api/admin/auth/current', (route) =>
    route.fulfill({
      status: f.signedIn ? 200 : 401,
      json: f.signedIn
        ? {
            id: `portfolio-owner-${owner}`,
            sessionId: `portfolio-session-${owner}`,
            displayName: `Compte synthétique ${owner}`,
            role: 'owner',
            expiresAt: '2099-01-01T00:00:00Z'
          }
        : {}
    })
  );
  await page.route('**/api/admin/automatic-runs', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const session = owner;
    reads.push(session);
    if (session === 'A') await gateA;
    return route.fulfill({ json: session === 'A' ? stateA : stateB });
  });
  await open(page, 'loading');
  await expect.poll(() => reads).toEqual(['A']);
  const pageDocument = (await page.locator('html').elementHandle())!;

  f.signedIn = false;
  f.queueStatus = 401;
  const rejectedSession = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/admin/auth/current' &&
      response.status() === 401
  );
  const refreshTasks = page
    .locator('[data-og7="attention-panel"]')
    .getByRole('button', { name: 'Actualiser les tâches', exact: true });
  await refreshTasks.focus();
  await refreshTasks.press('Enter');
  await expect(page).toHaveURL(/\/admin\/login(?:\?|$)/);
  await (await rejectedSession).finished();
  await expect(page.locator(highlighted)).toHaveCount(0);
  await page.locator('[data-og7="identity-setup-link"]').click();
  await expect(page).toHaveURL(/\/admin\/oidc-setup$/);

  owner = 'B';
  f.signedIn = true;
  f.queueStatus = 200;
  f.state = stateB;
  f.entries = [newEntry];
  await page
    .locator('[data-og7="identity-setup-page"] footer a[href="/admin/login"]')
    .click();
  await expect(page).toHaveURL(/\/admin\/fundraiser$/);
  await expect(
    page.getByText('Compte synthétique B', { exact: false })
  ).toBeVisible();
  // Router links keep the root service alive; a document reload would hide the cache bug.
  expect(await pageDocument.evaluate((element) => element.isConnected)).toBe(
    true
  );
  await page.locator('[data-og7="admin-automatic-portfolio-start"]').click();
  await expect.poll(() => reads).toEqual(['A', 'B']);
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'paused');
  await expandProcessing(page);
  await expect(hook(page, 'latest')).toContainText(newEntry.reference);
  await expect(hook(page, 'report')).toContainText(stateB.run!.id);

  const oldResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/admin/automatic-runs' &&
      response.request().method() === 'GET'
  );
  releaseA();
  await (await oldResponse).finished();
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'paused');
  await expect(hook(page, 'latest')).toContainText(newEntry.reference);
  await expect(
    page.locator('[data-og7="automatic-portfolio"]')
  ).not.toContainText(oldEntry.reference);
  await hook(page, 'refresh').click();
  await expect.poll(() => reads).toEqual(['A', 'B', 'B']);
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'paused');
  expect(f.writes).toEqual([]);
});

for (const interruption of ['close', 'navigation', 'session'] as const) {
  test(`${interruption} removes a pending reading halo and cannot approve or advance the old passage`, async ({
    page
  }) => {
    const f = await fixture(page);
    await open(page);
    await hook(page, 'start').click();
    await expectReading(page, 'scope');
    const region = (await hook(page, 'scope').elementHandle())!;
    const previousApproval = (await hook(page, 'approve').elementHandle())!;
    if (interruption === 'close') {
      await page.locator('[data-og7="admin-guidance-toggle"]').click();
      await expect(
        page.locator('[data-og7="admin-guidance-panel"]')
      ).toHaveCount(0);
    } else if (interruption === 'navigation') {
      await page
        .locator('a[href="/admin/fundraiser/contributions"]')
        .first()
        .click();
      await expect(page).toHaveURL(
        (url) => url.pathname === '/admin/fundraiser/contributions'
      );
    } else {
      f.signedIn = false;
      f.queueStatus = 401;
      const refreshTasks = page
        .locator('[data-og7="attention-panel"]')
        .getByRole('button', {
          name: 'Actualiser les tâches',
          exact: true
        });
      await refreshTasks.focus();
      await expect(refreshTasks).toBeFocused();
      await refreshTasks.press('Enter');
      await expect(page).toHaveURL(/\/admin\/login(?:\?|$)/);
    }
    await expect(page.locator(highlighted)).toHaveCount(0);
    await expect(hook(page, 'approve')).toHaveCount(0);
    await expect
      .poll(() =>
        region.evaluate((element) => ({
          marker: element.getAttribute('data-og7-guidance-highlight'),
          animations: element.getAnimations().length
        }))
      )
      .toEqual({ marker: null, animations: 0 });
    await previousApproval.evaluate((element) =>
      (element as HTMLButtonElement).click()
    );
    expect(advances(f)).toHaveLength(0);
    expect(
      f.writes.filter((write) => write.pathname === '/api/admin/automatic-runs')
    ).toHaveLength(1);
  });
}

test('pausing a pending dossier preview discards its late result and requires a fresh reading when resumed', async ({
  page
}) => {
  const f = await fixture(page);
  let releaseJourney!: () => void;
  f.journeyGate = new Promise<void>((resolve) => {
    releaseJourney = resolve;
  });
  await open(page);
  await hook(page, 'start').click();
  await approveReading(page, 'scope');
  await expect.poll(() => f.journeyReads.length).toBe(1);
  await expect(hook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'explaining'
  );
  await expect(hook(page, 'approve')).toHaveCount(0);
  await hook(page, 'pause').click();
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'paused');
  await expect(hook(page, 'resume')).toBeEnabled();
  releaseJourney();
  f.journeyGate = null;
  await hook(page, 'resume').click();
  await expectReading(page, 'scope');
  await approveReading(page, 'scope');
  await expectReading(page, 'dossier');
  expect(f.journeyReads).toEqual([paymentIds[0], paymentIds[0]]);
  expect(advances(f)).toHaveLength(0);
  await hook(page, 'pause').click();
  await expect(page.locator(highlighted)).toHaveCount(0);
});

test('an unavailable dossier preview stops reading without an uncertain financial result or a replay', async ({
  page
}) => {
  const f = await fixture(page);
  f.journeyStatus = 503;
  await open(page);
  await hook(page, 'start').click();
  await approveReading(page, 'scope');
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'error');
  await expect(hook(page, 'state')).toContainText(
    'Le rapport n’est pas disponible.'
  );
  await expect(hook(page, 'approve')).toHaveCount(0);
  await expect(hook(page, 'reconcile')).toHaveCount(0);
  await expect(page.locator(highlighted)).toHaveCount(0);
  expect(advances(f)).toHaveLength(0);
  expect(f.journeyReads).toEqual([paymentIds[0]]);
});

for (const status of ['running', 'paused', 'uncertain'] as const) {
  test(`the header reveals a ${status} passage without starting or resuming it`, async ({
    page
  }) => {
    const f = await fixture(page);
    f.state = runState(1, status);
    f.entries = [entry(0)];
    await page.goto(path);
    const shortcut = page.locator(
      '[data-og7="admin-automatic-portfolio-start"]'
    );
    await expect(shortcut).toBeEnabled();
    await shortcut.click();
    await expect(hook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      status === 'running' ? 'review' : status
    );
    await expandProcessing(page);
    await expect(shortcut).toBeDisabled();
    await expect(hook(page, 'start')).toBeDisabled();
    if (status === 'uncertain') {
      await expect(hook(page, 'reconcile')).toBeVisible();
      await expect(hook(page, 'resume')).toHaveCount(0);
    } else {
      await expect(hook(page, 'resume')).toBeEnabled();
    }
    expect(f.writes).toEqual([]);
    await page.reload();
    await expandProcessing(page);
    await expect(hook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      status === 'running' ? 'review' : status
    );
    expect(f.writes).toEqual([]);
  });
}

for (const [language, width] of [
  ['fr-CA', 1440],
  ['en', 390]
] as const) {
  test(`automatic responsibilities traverse multiple dossiers and preserve the honest server report after reload in ${language}`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await fixture(page, language);
    await open(page);
    await hook(page, 'start').click();
    await completePassage(page, f);
    await expect(hook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      'completed'
    );
    await expect(hook(page, 'completion')).toHaveAttribute(
      'data-og7-id',
      'outstanding'
    );
    expect(
      f.writes.filter((write) => write.pathname.endsWith('/advance'))
    ).toHaveLength(3);
    expect(
      f.writes.every((write) =>
        write.pathname.startsWith('/api/admin/automatic-runs')
      )
    ).toBe(true);
    await expect(hook(page, 'currencies')).toContainText('CAD');
    await expect(hook(page, 'currencies')).toContainText('USD');
    await expect(hook(page, 'new-payments')).toBeVisible();
    await hook(page, 'report').locator(':scope > summary').click();
    await expect(hook(page, 'report-entry')).toHaveCount(3);
    await expect(hook(page, 'proof')).toHaveCount(1);
    const draft = hook(page, 'report-entry').nth(1);
    await draft
      .locator('[data-og7="automatic-portfolio-entry-details"] > summary')
      .click();
    await expect(draft).toContainText(
      language === 'en' ? 'Private draft prepared' : 'Brouillon privé préparé'
    );
    await expect(draft).toContainText(
      language === 'en'
        ? 'delivered with evidence: 0'
        : 'réalisés avec preuve : 0'
    );
    await expect(
      draft.locator('[data-og7="automatic-portfolio-proof"]')
    ).toHaveCount(0);
    const promise = draft.locator('[data-og7="automatic-portfolio-promise"]');
    await expect(promise).toContainText(
      language === 'en' ? 'Individual portrait' : 'Portrait individuel'
    );
    await expect(promise).toContainText(
      language === 'en' ? 'Approved logo' : 'Logo approuvé'
    );
    await expect(promise).toContainText(
      language === 'en' ? 'Approved presentation' : 'Présentation approuvée'
    );
    await expect(promise).toContainText(
      language === 'en' ? '14 days' : '14 jours'
    );
    await expect(promise).toContainText(
      language === 'en' ? 'OpenG7' : 'OpenG7'
    );
    await expect(
      draft.locator('[data-og7="automatic-portfolio-due"]')
    ).toBeVisible();
    await expect(hook(page, 'report-entry').first()).toContainText(
      language === 'en'
        ? 'Delivered after the promised deadline'
        : 'Réalisé après l’échéance promise'
    );
    await expect(
      page.locator('[data-og7="automatic-portfolio"]')
    ).not.toContainText('admin.automatic.');
    const audit = await new AxeBuilder({ page })
      .include('[data-og7="automatic-portfolio"]')
      .analyze();
    expect(audit.violations).toEqual([]);
    const beforeReload = f.writes.length;
    await page.reload();
    await expandProcessing(page);
    await expect(hook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      'completed'
    );
    await hook(page, 'report').locator(':scope > summary').click();
    await expect(hook(page, 'report-entry')).toHaveCount(3);
    expect(f.writes).toHaveLength(beforeReload);
  });
}

test('automatic responsibilities pause immediately during a pending dossier and persist with its actual returned version', async ({
  page
}) => {
  const f = await fixture(page);
  let release!: () => void;
  f.advanceGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await open(page);
  await hook(page, 'start').click();
  await approveReading(page, 'scope');
  await approveReading(page, 'dossier');
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'advancing');
  await hook(page, 'pause').click();
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'paused');
  release();
  await expect
    .poll(
      () =>
        f.writes.filter((write) => write.pathname.endsWith('/control')).length
    )
    .toBe(1);
  expect(
    f.writes.filter((write) => write.pathname.endsWith('/advance'))
  ).toHaveLength(1);
  expect(
    f.writes.find((write) => write.pathname.endsWith('/control'))?.body
  ).toMatchObject({ action: 'pause', expectedVersion: 2 });
  await expect(hook(page, 'latest')).toContainText('DEMO-BALANCE-1');
  await page.reload();
  await expandProcessing(page);
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'paused');
  expect(
    f.writes.filter((write) => write.pathname.endsWith('/advance'))
  ).toHaveLength(1);
});

test('pausing the last result resumes its reading and summary without checking a completed dossier again', async ({
  page
}) => {
  const f = await fixture(page);
  await open(page);
  await hook(page, 'start').click();
  await approveReading(page, 'scope');
  for (let index = 0; index < paymentIds.length; ++index) {
    await approveReading(page, 'dossier');
    await expectReading(page, 'result');
    expect(advances(f)).toHaveLength(index + 1);
    if (index < paymentIds.length - 1) await approveReading(page, 'result');
  }
  await expect(hook(page, 'latest')).toContainText('DEMO-BALANCE-3');
  await expect(hook(page, 'completion')).toHaveCount(0);
  expect(f.state.run?.status).toBe('completed');
  await hook(page, 'pause').click();
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'paused');
  await expect(page.locator(highlighted)).toHaveCount(0);
  await expect(hook(page, 'completion')).toHaveCount(0);
  await hook(page, 'resume').click();
  await approveReading(page, 'scope');
  await expectReading(page, 'result');
  await expect(hook(page, 'latest')).toContainText('DEMO-BALANCE-3');
  await approveReading(page, 'result');
  await expectReading(page, 'summary');
  await expect(hook(page, 'completion')).toHaveCount(0);
  await approveReading(page, 'summary');
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'completed');
  expect(advances(f)).toHaveLength(3);
  expect(f.journeyReads).toEqual(paymentIds);
  expect(
    f.writes.filter((write) => write.pathname.endsWith('/control'))
  ).toEqual([]);
});

test('an uncertain response remains visible after reload and never replays a payment dossier', async ({
  page
}) => {
  const f = await fixture(page);
  f.loseAdvanceResponse = true;
  await open(page);
  await hook(page, 'start').click();
  await approveReading(page, 'scope');
  await approveReading(page, 'dossier');
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'uncertain');
  await expect(hook(page, 'resume')).toBeDisabled();
  await page.reload();
  await expandProcessing(page);
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'uncertain');
  await expect(hook(page, 'resume')).toHaveCount(0);
  await expect(hook(page, 'start')).toBeDisabled();
  expect(
    f.writes.filter((write) => write.pathname.endsWith('/advance'))
  ).toHaveLength(1);
  await hook(page, 'report').locator(':scope > summary').click();
  await expect(hook(page, 'report-entry')).toHaveCount(1);
});

test('an open confirmation dialogue stops the automatic next dossier without confirming or closing it', async ({
  page
}) => {
  const f = await fixture(page);
  await open(page);
  await hook(page, 'start').click();
  await expectReading(page, 'scope');
  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.id = 'synthetic-human-confirmation';
    dialog.textContent = 'Confirmation humaine synthétique';
    document.body.append(dialog);
    dialog.showModal();
  });
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'paused');
  await expect(page.locator(highlighted)).toHaveCount(0);
  await expect(hook(page, 'approve')).toHaveCount(0);
  expect(
    f.writes.filter((write) => write.pathname.endsWith('/advance'))
  ).toHaveLength(0);
  await expect(page.locator('#synthetic-human-confirmation')).toBeVisible();
  await page.evaluate(() =>
    document.getElementById('synthetic-human-confirmation')?.remove()
  );
});

test('reconciliation requires a separate human confirmation and never resumes or replays work by itself', async ({
  page
}) => {
  const f = await fixture(page);
  f.state = runState(1, 'uncertain');
  f.entries = [entry(0)];
  await open(page, 'uncertain');
  await hook(page, 'reconcile').click();
  await expect(hook(page, 'reconciliation')).toBeVisible();
  expect(f.writes).toEqual([]);
  await hook(page, 'reconcile-confirm').click();
  await expect(hook(page, 'reconciliation')).not.toBeVisible();
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'paused');
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]?.body['action']).toBe('reconcile');
  await expect(hook(page, 'resume')).toBeEnabled();
  expect(
    f.writes.filter((write) => write.pathname.endsWith('/advance'))
  ).toHaveLength(0);
});

test('the summary reading keeps its approval and halo while all report pages are loaded without advancing', async ({
  page
}) => {
  const f = await fixture(page);
  f.reportSeedCount = 120;
  let releaseReport!: () => void;
  f.reportGate = new Promise<void>((resolve) => {
    releaseReport = resolve;
  });
  await open(page);
  await hook(page, 'start').click();
  await approveReading(page, 'scope');
  await readDossiers(page, f);
  await hook(page, 'report').locator(':scope > summary').click();
  await expect(hook(page, 'report-entry')).toHaveCount(50);
  await expect(hook(page, 'more')).toBeEnabled();
  const approval = hook(page, 'approve');
  const reviewId = await approval.getAttribute('data-og7-id');
  const writesBeforeReading = f.writes.length;
  await hook(page, 'more').click();
  await expect.poll(() => f.reportReads.includes(50)).toBe(true);
  await expect(approval).toBeDisabled();
  await expect(hook(page, 'more')).toBeDisabled();
  await expect(hook(page, 'reading')).toHaveAttribute('data-og7-id', 'summary');
  await expect(approval).toHaveAttribute('data-og7-id', reviewId!);
  await expect(hook(page, 'summary')).toHaveAttribute(
    'data-og7-guidance-highlight',
    ''
  );
  expect(advances(f)).toHaveLength(3);
  expect(f.writes).toHaveLength(writesBeforeReading);
  f.reportGate = null;
  releaseReport();
  await expect(hook(page, 'report-entry')).toHaveCount(100);
  await expectReading(page, 'summary');
  await expect(approval).toHaveAttribute('data-og7-id', reviewId!);
  await hook(page, 'more').click();
  await expect(hook(page, 'report-entry')).toHaveCount(120);
  await expect(hook(page, 'more')).toHaveCount(0);
  await expectReading(page, 'summary');
  await expect(approval).toHaveAttribute('data-og7-id', reviewId!);
  expect(f.reportReads).toContain(100);
  expect(advances(f)).toHaveLength(3);
  expect(f.writes).toHaveLength(writesBeforeReading);
  expect(
    f.writes.filter((write) => write.pathname.endsWith('/control'))
  ).toEqual([]);
  await approveReading(page, 'summary');
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'completed');
  await expect(page.locator(highlighted)).toHaveCount(0);
});

test('the durable report loads further pages without an automatic action or a new passage', async ({
  page
}) => {
  const f = await fixture(page);
  f.state = runState(3, 'completed');
  f.entries = Array.from({ length: 51 }, (_, i) => entry(i));
  await open(page, 'completed');
  await hook(page, 'report').locator(':scope > summary').click();
  await expect(hook(page, 'report-entry')).toHaveCount(50);
  await hook(page, 'more').click();
  await expect(hook(page, 'report-entry')).toHaveCount(51);
  expect(f.reportReads).toContain(50);
  expect(f.writes).toEqual([]);
});

for (const [language, width] of [
  ['fr-CA', 1440],
  ['en', 390]
] as const) {
  test(`batch progress stays visible and report dossiers open with the keyboard without mutations in ${language}`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await fixture(page, language);
    f.state = runState(3, 'completed');
    f.entries = [entry(0), entry(1), entry(2)];
    await open(page, 'completed', false);
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1.25';
    });

    const processing = hook(page, 'processing');
    const processingToggle = processing.locator(':scope > summary');
    await expect(processing).toHaveJSProperty('open', false);
    await expect(hook(page, 'state')).toBeVisible();
    await expectProgress(page, 3);
    await expect(
      processing.getByRole('progressbar', {
        name: language === 'en' ? 'Checked dossiers' : 'Dossiers vérifiés'
      })
    ).toBeVisible();
    await expect(hook(page, 'start')).toBeHidden();
    await processing.screenshot({
      path: testInfo.outputPath('suivi-du-lot-replie.png')
    });
    await processingToggle.focus();
    await processingToggle.press('Enter');
    await expect(processing).toHaveJSProperty('open', true);

    const report = hook(page, 'report');
    const reportToggle = report.locator(':scope > summary');
    await expect(report).toHaveJSProperty('open', false);
    await reportToggle.focus();
    await reportToggle.press('Space');
    await expect(report).toHaveJSProperty('open', true);
    const dossiers = hook(page, 'entry-details');
    await expect(dossiers).toHaveCount(3);
    for (const dossier of await dossiers.all())
      await expect(dossier).toHaveJSProperty('open', false);
    await page.locator('[data-og7="admin-guidance-panel"]').screenshot({
      path: testInfo.outputPath('suivi-du-lot-rapport.png')
    });

    const delivered = dossiers.first();
    const deliveredToggle = delivered.locator(':scope > summary');
    await expect(deliveredToggle).toContainText('DEMO-BALANCE-1');
    await expect(deliveredToggle).toContainText(
      language === 'en' ? 'Balanced' : 'Équilibré'
    );
    await expect(hook(page, 'before').first()).toBeHidden();
    await expect(hook(page, 'proof')).toBeHidden();
    await deliveredToggle.focus();
    await deliveredToggle.press('Enter');
    await expect(delivered).toHaveJSProperty('open', true);
    await expect(hook(page, 'before').first()).toBeVisible();
    await expect(hook(page, 'after').first()).toBeVisible();
    await expect(hook(page, 'proof')).toBeVisible();
    await expect(
      delivered.getByRole('link', {
        name: language === 'en' ? 'View the evidence' : 'Consulter la preuve'
      })
    ).toHaveAttribute('href', 'https://example.test/synthetic-delivery');
    await expect(delivered).toContainText('synthetic-observation-1');

    const draft = dossiers.nth(1);
    await draft.locator(':scope > summary').focus();
    await draft.locator(':scope > summary').press('Space');
    await expect(draft).toHaveJSProperty('open', true);
    await expect(
      draft.locator('[data-og7="automatic-portfolio-due"]')
    ).toBeVisible();
    await expect(draft).toContainText('synthetic-draft-audit');
    for (const region of [processing, report, delivered, draft]) {
      const bounds = await region.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          viewport: element.ownerDocument.documentElement.clientWidth,
          overflow: element.scrollWidth - element.clientWidth
        };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(-1);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
      expect(bounds.overflow).toBeLessThanOrEqual(1);
    }

    await deliveredToggle.focus();
    await deliveredToggle.press('Space');
    await expect(delivered).toHaveJSProperty('open', false);
    await expect(deliveredToggle).toBeFocused();
    await expect(hook(page, 'proof')).toBeHidden();
    await processingToggle.focus();
    await processingToggle.press('Enter');
    await expect(processing).toHaveJSProperty('open', false);
    await expect(processingToggle).toBeFocused();
    await expect(hook(page, 'state')).toBeVisible();
    await expectProgress(page, 3);
    expect(f.writes).toEqual([]);
    expect(f.state.run?.processedCount).toBe(3);
  });
}

test('a report can hand off its exact payment to the existing preparation tool without turning a completed journey into qualified benefit evidence', async ({
  page
}) => {
  const f = await fixture(page);
  f.state = runState(3, 'completed');
  f.entries = [entry(0), entry(1), entry(2)];
  const requested: string[] = [];
  await page.route(
    (url) => url.pathname === '/api/admin/payment-journey',
    async (route) => {
      const contributionId = new URL(route.request().url()).searchParams.get(
        'contributionId'
      )!;
      requested.push(contributionId);
      return route.fulfill({
        json: {
          status: 'ok',
          generatedAt: now,
          journey: {
            contributionId,
            reference: 'DEMO-BALANCE-3',
            contributionType: 'sponsorship_interest',
            amountMinor: 5000,
            currency: 'CAD',
            paymentStatus: 'paid',
            state: 'complete',
            completed: 1,
            total: 1,
            steps: [
              {
                id: 'payment',
                state: 'complete',
                reason: 'payment_recorded',
                adminUrl: `/admin/fundraiser/contributions?contributionId=${contributionId}`
              }
            ],
            next: null
          }
        }
      });
    }
  );
  await open(page, 'completed');
  await hook(page, 'latest')
    .locator('[data-og7="automatic-portfolio-human"]')
    .click();
  await expect(page.locator('[data-og7="automatic-state"]')).toHaveAttribute(
    'data-og7-id',
    'complete'
  );
  expect(requested).toContain(paymentIds[2]);
  await expect(hook(page, 'completion')).toHaveAttribute(
    'data-og7-id',
    'outstanding'
  );
  expect(f.writes).toEqual([]);
  expect(f.state.run?.globalBalanced).toBe(false);
  expect(f.state.balance?.status).toBe('unknown');
});

test('a missing obligation keeps the accepted offer visible with its quantity and duration while the report remains unresolved', async ({
  page
}) => {
  const f = await fixture(page);
  const original = entry(2);
  const balance: ResponsibilityBalance = {
    ...original.balance,
    expected: 2,
    fulfilled: 0,
    outstanding: 2,
    reasons: ['promised_obligation_missing'],
    promisedBenefits: [
      {
        ...original.balance.promisedBenefits[0]!,
        quantity: 2,
        durationDays: 30
      }
    ],
    obligations: []
  };
  const missing: AdminAutomaticRunEntry = {
    ...original,
    reasonCodes: balance.reasons,
    beforeBalance: balance,
    balance
  };
  const state = runState(3, 'completed');
  f.state = { ...state, run: { ...state.run!, latestEntry: missing }, balance };
  f.entries = [entry(0), entry(1), missing];
  await open(page, 'completed');
  await hook(page, 'report').locator(':scope > summary').click();
  const report = hook(page, 'report-entry').last();
  await report
    .locator('[data-og7="automatic-portfolio-entry-details"] > summary')
    .click();
  await expect(report).toContainText('quantité promise : 2');
  await expect(report).toContainText('Durée promise : 30 jours');
  await expect(report).toContainText(
    'Un avantage de l’offre acceptée est absent'
  );
  await expect(report).toContainText('réalisés avec preuve : 0');
  await expect(hook(page, 'completion')).toHaveAttribute(
    'data-og7-id',
    'outstanding'
  );
  await expect(
    report.locator('[data-og7="automatic-portfolio-proof"]')
  ).toHaveCount(0);
  expect(f.writes).toEqual([]);
});

test('an invalid confirmed payment explicitly rejects starting without uncertainty, replay or reconciliation of the old report', async ({
  page
}) => {
  const f = await fixture(page);
  f.state = runState(3, 'completed');
  f.entries = [entry(0), entry(1), entry(2)];
  f.invalidPaymentFacts = true;
  await open(page, 'completed');
  await hook(page, 'start').click();
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'error');
  await expect(hook(page, 'state')).toContainText(
    'Un paiement confirmé contient un montant ou une devise à vérifier. Le passage n’a pas démarré.'
  );
  await expect(hook(page, 'reconcile')).toHaveCount(0);
  await expect(hook(page, 'completion')).toHaveCount(0);
  await hook(page, 'report').locator(':scope > summary').click();
  await expect(hook(page, 'report-entry')).toHaveCount(3);
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]?.pathname).toBe('/api/admin/automatic-runs');
  expect(f.state.run).toMatchObject({
    id: runId,
    status: 'completed',
    processedCount: 3
  });
});

test('the shared Xbox controls can start and pause a responsibility passage', async ({
  page
}) => {
  await installAdminController(page);
  const f = await fixture(page);
  let release!: () => void;
  f.advanceGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await open(page);
  const controller = adminController(page);
  await controller.ready();
  await controller.activate(hook(page, 'start'));
  await expectReading(page, 'scope');
  await controller.activate(hook(page, 'approve'));
  await expectReading(page, 'dossier');
  await controller.activate(hook(page, 'approve'));
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'advancing');
  await controller.activate(hook(page, 'pause'));
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'paused');
  release();
  await expect
    .poll(
      () =>
        f.writes.filter((write) => write.pathname.endsWith('/control')).length
    )
    .toBe(1);
  expect(
    f.writes.filter((write) => write.pathname.endsWith('/advance'))
  ).toHaveLength(1);
});
