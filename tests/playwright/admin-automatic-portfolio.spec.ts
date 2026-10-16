import type { Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type {
  AdminAutomaticRunEntry,
  AdminAutomaticRunState,
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

/** Built UI only: synthetic API observations, never proof of real financial work. */
async function fixture(page: Page, language = 'fr-CA') {
  const f = {
    state: { run: null, balance: null } as AdminAutomaticRunState,
    entries: [] as AdminAutomaticRunEntry[],
    writes: [] as { pathname: string; body: Record<string, unknown> }[],
    advanceGate: null as Promise<void> | null,
    loseAdvanceResponse: false,
    invalidPaymentFacts: false,
    reportReads: [] as number[],
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
    if (pathname === '/api/admin/automatic-runs')
      return route.fulfill({ json: f.state });
    if (pathname === '/api/admin/automatic-runs/report') {
      const after = Number(url.searchParams.get('after') ?? 0);
      f.reportReads.push(after);
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
    if (pathname === '/api/admin/attention')
      return route.fulfill({
        json: {
          available: true,
          coverage: 'complete',
          missingSources: [],
          generatedAt: now,
          timezone: 'America/Toronto',
          total: 0,
          filteredTotal: 0,
          todayTotal: 0,
          counts: { urgent: 0, today: 0, this_week: 0, informational: 0 },
          typeCounts: {},
          page: 1,
          pageSize: 25,
          items: []
        }
      });
    return route.fulfill({
      status: 503,
      json: { code: 'SYNTHETIC_UI_FIXTURE_UNAVAILABLE' }
    });
  });
  return f;
}

async function open(page: Page, phase = 'review') {
  await page.goto(path);
  const toggle = page.locator('[data-og7="admin-guidance-toggle"]');
  await expect(toggle).toBeVisible();
  const panel = page.locator('[data-og7="admin-guidance-panel"]');
  if (!(await panel.isVisible())) await toggle.click();
  await page.locator('[data-og7="admin-guidance-automatic-mode"]').click();
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', phase);
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
    await hook(page, 'report').locator('summary').click();
    await expect(hook(page, 'report-entry')).toHaveCount(3);
    await expect(hook(page, 'proof')).toHaveCount(1);
    const draft = hook(page, 'report-entry').nth(1);
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
    await expect(hook(page, 'state')).toHaveAttribute(
      'data-og7-id',
      'completed'
    );
    await hook(page, 'report').locator('summary').click();
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
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'paused');
  expect(
    f.writes.filter((write) => write.pathname.endsWith('/advance'))
  ).toHaveLength(1);
});

test('an uncertain response remains visible after reload and never replays a payment dossier', async ({
  page
}) => {
  const f = await fixture(page);
  f.loseAdvanceResponse = true;
  await open(page);
  await hook(page, 'start').click();
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'uncertain');
  await expect(hook(page, 'resume')).toBeDisabled();
  await page.reload();
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'uncertain');
  await expect(hook(page, 'resume')).toHaveCount(0);
  await expect(hook(page, 'start')).toBeDisabled();
  expect(
    f.writes.filter((write) => write.pathname.endsWith('/advance'))
  ).toHaveLength(1);
  await hook(page, 'report').locator('summary').click();
  await expect(hook(page, 'report-entry')).toHaveCount(1);
});

test('an open confirmation dialogue stops the automatic next dossier without confirming or closing it', async ({
  page
}) => {
  const f = await fixture(page);
  await open(page);
  await hook(page, 'start').click();
  await expect(hook(page, 'state')).toHaveAttribute(
    'data-og7-id',
    'explaining'
  );
  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.id = 'synthetic-human-confirmation';
    dialog.textContent = 'Confirmation humaine synthétique';
    document.body.append(dialog);
    dialog.showModal();
  });
  await expect(hook(page, 'state')).toHaveAttribute('data-og7-id', 'paused');
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

test('the durable report loads further pages without an automatic action or a new passage', async ({
  page
}) => {
  const f = await fixture(page);
  f.state = runState(3, 'completed');
  f.entries = Array.from({ length: 51 }, (_, i) => entry(i));
  await open(page, 'completed');
  await hook(page, 'report').locator('summary').click();
  await expect(hook(page, 'report-entry')).toHaveCount(50);
  await hook(page, 'more').click();
  await expect(hook(page, 'report-entry')).toHaveCount(51);
  expect(f.reportReads).toContain(50);
  expect(f.writes).toEqual([]);
});

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
  await hook(page, 'report').locator('summary').click();
  const report = hook(page, 'report-entry').last();
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
  await hook(page, 'report').locator('summary').click();
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
