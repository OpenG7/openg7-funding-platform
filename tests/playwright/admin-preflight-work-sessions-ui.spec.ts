import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type {
  AdminCampaignItem,
  AdminDossierPreparationReceipt,
  AdminPreflightWorkSession,
  AdminPreflightWorkSessionCommandRequest,
  AdminServicePreparationDecisionRequest,
  AdminServicePreparationReceipt,
  AdminServicePreparationSaveDraftRequest
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  captureAdminDesign,
  expectAdminPageFits,
  prepareAdminDesignReview
} from './support/admin-design-review.js';
import {
  contributionId,
  receipt as preparationReceipt
} from './support/preparation-receipts-fixtures.js';

const base = '/admin/fundraiser/preflight';
const endpoint = '/api/admin/preflight/work-sessions';
const preparation = '/api/admin/sponsorships/preparation/service';
const at = '2026-11-05T14:00:00.000Z';
const dossierId = contributionId(3);
const sessionId = '40000000-0000-4000-8000-000000000001';
const obligations = [
  '20000000-0000-4000-8000-000000000031',
  '20000000-0000-4000-8000-000000000032'
] as const;
const revisedBody =
  'Private human revision saved on the server and retained after explicitly resuming.';
const hook = (page: Page, name: string) => {
  const selector = `[data-og7="${name}"]`;
  return ['work-session-reconcile', 'work-session-retry-draft'].includes(name)
    ? page.locator('[data-og7="work-session-state"]').locator(selector)
    : page.locator(selector);
};

function service(index: number, website = false): AdminCampaignItem {
  const channel =
    website && index === 0 ? 'website' : index === 0 ? 'facebook' : 'linkedin';
  return {
    id: obligations[index]!,
    contributionId: dossierId,
    reference: 'SYNTHETIC-WORK-001',
    companyName: 'Synthetic persistent workshop',
    paidAt: at,
    channel,
    target: 'openg7',
    ordinal: 1,
    quantity: 1,
    format: channel === 'website' ? null : 'collective_text',
    obligationState: 'pending',
    timing: null,
    preparation: {
      status: 'ready',
      version: '1'.repeat(64),
      approvedAt: null,
      blockers: []
    },
    workflow: {
      obligationId: obligations[index]!,
      channel,
      target: 'openg7',
      ordinal: 1,
      state: 'action_required',
      responsibility: 'admin',
      reason: 'publication_preparation_required',
      deliveryId: null,
      scheduledAt: null
    },
    content: {
      title: `SYNTHETIC PRIVATE TITLE ${index + 1}`,
      body: `Original private server body for service ${index + 1}.`
    },
    proof: null,
    adminUrl: `${base}?view=desk&sponsorshipId=${dossierId}&obligationId=${obligations[index]}`
  };
}

function receipt(
  index: number,
  website = false
): AdminServicePreparationReceipt {
  const source = preparationReceipt(3);
  const siblings = [service(0, website), service(1, website)];
  const drafts = siblings.map((item) => ({
    id: 'synthetic-private-' + item.channel,
    kind:
      item.channel === 'website'
        ? ('website' as const)
        : ('publication' as const),
    version: 'synthetic-saved-v1',
    title: item.content!.title,
    body: item.content!.body,
    disclosureText:
      item.channel === 'website' ? '' : 'Synthetic sponsorship disclosure.',
    channel: item.channel,
    target: item.target,
    status: 'draft',
    adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${dossierId}&tab=publication`
  }));
  const dossier: AdminDossierPreparationReceipt = {
    context: 'dossier',
    contributionId: dossierId,
    reference: 'SYNTHETIC-WORK-001',
    version: source.version,
    status: 'ready',
    payment: source.payment,
    acceptedOffer: source.acceptedOffer,
    balance: {
      ...source.balance!,
      obligations: siblings.map((item) => ({
        id: item.id,
        benefitId:
          item.channel === 'website'
            ? ('website_mention' as const)
            : item.channel === 'facebook'
              ? ('facebook_batch' as const)
              : ('linkedin_batch' as const),
        channel: item.channel,
        target: item.target,
        ordinal: 1,
        state: 'pending' as const,
        version: 1
      }))
    },
    checks: source.checks.filter((check) => check.code !== 'dossier_examined'),
    authorizations: source.authorizations,
    drafts,
    blockers: [],
    canApprove: true,
    approval: null,
    approvalHistory: []
  };
  return {
    context: 'service',
    generatedAt: at,
    contributionId: dossierId,
    reference: dossier.reference,
    companyName: siblings[index]!.companyName,
    version: 'a'.repeat(64),
    contentVersion: 'c'.repeat(64),
    status: 'ready',
    service: siblings[index]!,
    siblings,
    draft: drafts[index]!,
    dossier,
    checks: dossier.checks,
    blockers: [],
    canApprove: true,
    canDecide: true,
    decision: null,
    history: [],
    provenance: {
      origin: 'funding',
      preflightLink: 'unverified',
      preparedAt: at
    },
    links: {
      dossier: drafts[index]!.adminUrl,
      media: `/admin/fundraiser/sponsors?sponsorshipId=${dossierId}&tab=media`,
      edit: drafts[index]!.adminUrl,
      delivery: `/admin/fundraiser/campaigns?sponsorshipId=${dossierId}&obligationId=${obligations[index]}`,
      evidence: `/admin/fundraiser/campaigns?sponsorshipId=${dossierId}&obligationId=${obligations[index]}`
    }
  };
}

function url(index = 0, workSession = false) {
  const query = new URLSearchParams({
    view: 'desk',
    sponsorshipId: dossierId,
    obligationId: obligations[index]!,
    deskStatus: 'to_review',
    deskSearch: 'SYNTHETIC',
    deskPage: '2'
  });
  if (workSession) query.set('workSession', sessionId);
  return `${base}?${query}`;
}

/** Shared synthetic server state: reload and a second tab never create another fixture database. */
async function fixtures(
  page: Page,
  {
    language = 'fr-CA',
    website = false
  }: { language?: 'fr-CA' | 'en'; website?: boolean } = {}
) {
  await prepareAdminDesignReview(page);
  await page
    .context()
    .addInitScript(
      (locale) => localStorage.setItem('openg7.language', locale),
      language
    );
  const state = {
    receipts: [receipt(0, website), receipt(1, website)],
    session: null as AdminPreflightWorkSession | null,
    archivedSessions: [] as AdminPreflightWorkSession[],
    decisionBaseline: new Set<string>(),
    writes: [] as { path: string; body: Record<string, unknown> }[],
    reads: [] as URL[],
    applied: new Set<string>(),
    saveStatus: 200,
    saveGate: null as Promise<void> | null,
    applyBeforeSaveFailure: false,
    signedIn: true
  };
  const report = () => {
    if (!state.session) return;
    const items = state.session.items;
    const approved = state.receipts.filter(
      (item) =>
        item.status === 'approved' &&
        item.decision &&
        !state.decisionBaseline.has(item.decision.id)
    ).length;
    const readyForDelivery = state.receipts.filter(
      (item) => item.status === 'approved'
    ).length;
    state.session = {
      ...state.session,
      report: {
        total: items.length,
        visited: items.filter((item) => item.visitedAt).length,
        saved: items.filter((item) => item.state === 'saved').length,
        deferred: items.filter((item) => item.state === 'deferred').length,
        remaining: state.receipts.filter(
          (item) =>
            !item.decision || state.decisionBaseline.has(item.decision.id)
        ).length,
        decisions: {
          total: approved,
          approved,
          correctionRequested: 0,
          rejected: 0
        },
        readyForDelivery,
        delivered: 0,
        unavailable: 0,
        toResume: items.filter(
          (item, index) =>
            item.state !== 'pending' &&
            (!state.receipts[index]!.decision ||
              state.decisionBaseline.has(state.receipts[index]!.decision!.id))
        ).length,
        attention: []
      }
    };
  };
  const createSession = (selected: string): AdminPreflightWorkSession => ({
    id:
      state.archivedSessions.length === 0
        ? sessionId
        : '40000000-0000-4000-8000-000000000002',
    revision: 1,
    status: 'active',
    startedAt: at,
    updatedAt: at,
    finishedAt: null,
    lastPosition:
      obligations.indexOf(selected as (typeof obligations)[number]) + 1,
    itemCount: 2,
    filters: { deskStatus: 'to_review', deskSearch: 'SYNTHETIC', deskPage: 2 },
    items: state.receipts.map((item, index) => ({
      position: index + 1,
      contributionId: dossierId,
      obligationId: item.service.id,
      observedVersion: item.version,
      state: 'pending',
      checkpoint: { pendingDecision: null, reason: '' },
      visitedAt: item.service.id === selected ? at : null,
      savedAt: null,
      reference: item.reference,
      companyName: item.companyName,
      channel: item.service.channel,
      currentStatus: 'to_review',
      obsolete: false
    })),
    report: {
      total: 2,
      visited: 1,
      saved: 0,
      deferred: 0,
      remaining: 2,
      decisions: { total: 0, approved: 0, correctionRequested: 0, rejected: 0 },
      readyForDelivery: 0,
      delivered: 0,
      unavailable: 0,
      toResume: 0,
      attention: []
    }
  });
  await page.context().route('**/api/**', async (route) => {
    const request = route.request(),
      address = new URL(request.url());
    const path = address.pathname;
    if (path === '/api/admin/auth/config')
      return route.fulfill({ json: { mode: 'oidc' } });
    if (path === '/api/admin/auth/current')
      return route.fulfill(
        state.signedIn
          ? {
              json: {
                id: 'synthetic-workshop-operator',
                sessionId: 'synthetic-login-session',
                displayName: 'Synthetic reviewer',
                role: 'operator',
                expiresAt: '2099-01-01T00:00:00Z'
              }
            }
          : { status: 401, json: {} }
      );
    if (request.method() !== 'GET') {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.writes.push({ path, body });
      if (path === endpoint) {
        if (state.session)
          state.archivedSessions.push(structuredClone(state.session));
        state.decisionBaseline = new Set(
          state.receipts.flatMap((item) =>
            item.decision ? [item.decision.id] : []
          )
        );
        state.session = createSession(String(body.obligationId));
        state.applied.add(String(body.requestId));
        return route.fulfill({ json: state.session });
      }
      if (path === endpoint + '/' + state.session?.id + '/commands') {
        const input =
          body as unknown as AdminPreflightWorkSessionCommandRequest;
        if (!state.session || input.expectedRevision !== state.session.revision)
          return route.fulfill({
            status: 409,
            json: { code: 'WORK_SESSION_VERSION_CONFLICT' }
          });
        const position = input.obligationId
          ? obligations.indexOf(
              input.obligationId as (typeof obligations)[number]
            ) + 1
          : state.session.lastPosition;
        state.session = {
          ...state.session,
          revision: state.session.revision + 1,
          lastPosition: position,
          status:
            input.action === 'finish'
              ? 'finished'
              : input.action === 'pause'
                ? 'paused'
                : input.action === 'resume'
                  ? 'active'
                  : state.session.status,
          finishedAt: input.action === 'finish' ? at : null,
          items: state.session.items.map((item) =>
            item.position === position
              ? {
                  ...item,
                  visitedAt: at,
                  ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
                  ...(input.action === 'defer'
                    ? { state: 'deferred' as const }
                    : input.action === 'checkpoint'
                      ? { state: 'saved' as const, savedAt: at }
                      : {}),
                  ...(input.observedVersion
                    ? { observedVersion: input.observedVersion }
                    : {})
                }
              : item
          )
        };
        state.applied.add(input.requestId);
        report();
        return route.fulfill({ json: state.session });
      }
      if (path === preparation + '/save-draft') {
        const input =
          body as unknown as AdminServicePreparationSaveDraftRequest;
        if (state.saveGate) await state.saveGate;
        const index = obligations.indexOf(
          input.obligationId as (typeof obligations)[number]
        );
        if (
          input.expectedSessionRevision !== state.session?.revision ||
          input.expectedVersion !== state.receipts[index]!.version
        )
          return route.fulfill({
            status: 409,
            json: { code: 'WORK_SESSION_VERSION_CONFLICT' }
          });
        if (state.saveStatus === 200 || state.applyBeforeSaveFailure) {
          const previous = state.receipts[index]!;
          const draft = {
            ...previous.draft!,
            title: input.title,
            body: input.body,
            disclosureText: input.disclosureText,
            version: 'synthetic-saved-v2'
          };
          state.receipts[index] = {
            ...previous,
            draft,
            version: 'd'.repeat(64),
            contentVersion: 'e'.repeat(64),
            service: {
              ...previous.service,
              content: { title: draft.title, body: draft.body }
            }
          };
          state.session = {
            ...state.session!,
            revision: state.session!.revision + 1,
            items: state.session!.items.map((item) =>
              item.obligationId === input.obligationId
                ? {
                    ...item,
                    state: 'saved' as const,
                    savedAt: at,
                    observedVersion: state.receipts[index]!.version
                  }
                : item
            )
          };
          state.applied.add(input.requestId);
          report();
        }
        return route.fulfill(
          state.saveStatus === 200
            ? {
                json: { receipt: state.receipts[index], session: state.session }
              }
            : { status: state.saveStatus, json: { code: 'RUN_UNAVAILABLE' } }
        );
      }
      if (path === preparation + '/decision') {
        const input = body as unknown as AdminServicePreparationDecisionRequest;
        const index = obligations.indexOf(
          input.obligationId as (typeof obligations)[number]
        );
        const previous = state.receipts[index]!;
        const decision = {
          id: 'synthetic-' + input.requestId,
          contributionId: dossierId,
          obligationId: input.obligationId,
          draftId: previous.draft!.id,
          draftVersion: previous.draft!.version,
          contentVersion: previous.contentVersion,
          decision: input.decision,
          reason: input.reason ?? null,
          actor: 'admin:synthetic-workshop-operator',
          createdAt: at,
          requestId: input.requestId,
          auditReference: 'synthetic-audit-' + input.requestId
        };
        state.receipts[index] = {
          ...previous,
          version: 'f'.repeat(64),
          status: input.decision,
          canApprove: false,
          canDecide: false,
          decision,
          history: [...previous.history, decision]
        };
        report();
        return route.fulfill({ json: state.receipts[index] });
      }
      return route.fulfill({ status: 405, json: {} });
    }
    state.reads.push(address);
    if (path === endpoint) {
      report();
      const requestedId = address.searchParams.get('sessionId');
      const sessions = [
        ...(state.session ? [state.session] : []),
        ...state.archivedSessions
      ];
      return route.fulfill({
        json: {
          current: requestedId
            ? (sessions.find((item) => item.id === requestedId) ?? null)
            : state.session,
          recent: sessions,
          command: address.searchParams.has('requestId')
            ? {
                requestId: address.searchParams.get('requestId'),
                status: state.applied.has(
                  address.searchParams.get('requestId')!
                )
                  ? 'applied'
                  : 'not_found'
              }
            : null
        }
      });
    }
    if (path === preparation) {
      const index = obligations.indexOf(
        address.searchParams.get('obligationId') as (typeof obligations)[number]
      );
      return route.fulfill(
        index >= 0 ? { json: state.receipts[index] } : { status: 404, json: {} }
      );
    }
    if (path === '/api/admin/preflight/desk')
      return route.fulfill({
        json: {
          generatedAt: at,
          summary: {
            total: 2,
            toPrepare: 0,
            toReview: 2,
            toDeliver: 0,
            delivered: 0,
            excludedAdjusted: 0,
            orders: 1,
            scope: 'recorded_promised_services',
            preflightLink: 'unverified'
          },
          orders: [],
          pagination: {
            page: 1,
            pageSize: 20,
            totalItems: 0,
            totalPages: 0,
            hasPreviousPage: false,
            hasNextPage: false
          }
        }
      });
    if (path === '/api/admin/preflight/inbox')
      return route.fulfill({
        json: {
          state: 'ready',
          consoleUrl: null,
          items: [],
          total: 0,
          page: 1,
          pageSize: 20,
          authority: 'source_application',
          businessDecisionExecuted: false
        }
      });
    if (path === '/api/admin/preflight/rehearsals')
      return route.fulfill({
        json: {
          enabled: false,
          canLaunch: false,
          consoleUrl: null,
          run: null,
          runs: []
        }
      });
    if (path === '/api/admin/campaigns')
      return route.fulfill({
        json: {
          generatedAt: at,
          items: state.receipts.map((item) => item.service),
          pagination: {
            page: 1,
            pageSize: 25,
            totalItems: 2,
            totalPages: 1,
            hasPreviousPage: false,
            hasNextPage: false
          }
        }
      });
    if (path === '/api/admin/sponsorships/preparation')
      return route.fulfill({ json: state.receipts[0]!.dossier });
    if (path === '/api/admin/sponsorships/media/workspace')
      return route.fulfill({
        json: {
          contributionId: dossierId,
          revision: 'synthetic-media-v1',
          assets: [],
          rules: [],
          batches: [],
          writable: false
        }
      });
    if (path === '/api/admin/sponsorships/media')
      return route.fulfill({ json: { items: [], total: 0 } });
    return route.fulfill({ status: 404, json: {} });
  });
  return state;
}

async function begin(page: Page) {
  await page.goto(url());
  await hook(page, 'work-session-start').click();
  await expect(hook(page, 'work-session-state')).toBeVisible();
}
async function text(page: Page) {
  await page
    .locator('[data-og7="examination-section"][data-og7-id="text"]')
    .click();
}
async function finish(page: Page) {
  await hook(page, 'work-session-finish').click();
  await expect(hook(page, 'work-session-finish-dialog')).toBeVisible();
  await hook(page, 'work-session-save-end').click();
}
const saves = (state: Awaited<ReturnType<typeof fixtures>>) =>
  state.writes.filter((item) => item.path === preparation + '/save-draft');

for (const [language, width] of [
  ['fr-CA', 1536],
  ['en', 390]
] as const) {
  test(`private social draft survives save, next, approval, finish, reload and explicit resume in ${language}`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1100 });
    const state = await fixtures(page, { language });
    await begin(page);
    await text(page);
    await hook(page, 'examination-draft-body').fill(revisedBody);
    await hook(page, 'examination-draft-save').click();
    await expect.poll(() => state.receipts[0]!.draft!.body).toBe(revisedBody);
    await expect(hook(page, 'examination-draft-save')).toBeDisabled();
    await captureAdminDesign(
      page,
      testInfo,
      `work-session-workshop-${language}`,
      true
    );
    await hook(page, 'work-session-next').click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('obligationId'))
      .toBe(obligations[1]);
    await hook(page, 'examination-approve').click();
    await hook(page, 'confirm-action').click();
    await expect.poll(() => state.receipts[1]!.status).toBe('approved');
    await hook(page, 'work-session-finish').click();
    await expect(hook(page, 'work-session-finish-dialog')).toBeVisible();
    await captureAdminDesign(
      page,
      testInfo,
      `work-session-report-${language}`,
      true
    );
    await hook(page, 'work-session-save-end').click();
    await expect.poll(() => state.session!.status).toBe('finished');
    const writesBeforeReload = state.writes.length;
    await page.reload();
    await expect(hook(page, 'work-session-resume')).toBeVisible();
    expect(state.writes).toHaveLength(writesBeforeReload);
    await hook(page, 'work-session-resume').click();
    await expect.poll(() => state.session!.status).toBe('active');
    await hook(page, 'examination-previous').click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('obligationId'))
      .toBe(obligations[0]);
    await text(page);
    await expect(hook(page, 'examination-draft-body')).toHaveValue(revisedBody);
    expect(saves(state)).toHaveLength(1);
    expect(state.receipts[0]!.decision).toBeNull();
    expect(state.session!.report.toResume).toBe(1);
    expect(state.session!.report.decisions.approved).toBe(1);
    expect(state.session!.report.delivered).toBe(0);
    expect(
      state.writes.every(
        (item) =>
          item.path.startsWith(endpoint) ||
          item.path === preparation + '/save-draft' ||
          item.path === preparation + '/decision'
      )
    ).toBe(true);
    await expectAdminPageFits(page);
    const axe = await new AxeBuilder({ page })
      .include('[data-og7="examination"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(axe.violations).toEqual([]);
  });
}

test('pending save counts only after server acknowledgement and blocks another navigation or finish', async ({
  page
}) => {
  const state = await fixtures(page);
  await begin(page);
  await text(page);
  const original = state.receipts[0]!.draft!.body;
  const savedBefore = state.session!.report.saved;
  let release!: () => void;
  state.saveGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await hook(page, 'examination-draft-body').fill(revisedBody);
  await expect(hook(page, 'examination-decision-guidance')).toHaveAttribute(
    'data-reason',
    'dirty'
  );
  await expect(hook(page, 'examination-approve')).toBeDisabled();
  await hook(page, 'examination-guidance-save').click();
  await expect.poll(() => saves(state).length).toBe(1);
  await expect(hook(page, 'examination-decision-guidance')).toHaveAttribute(
    'data-reason',
    'busy'
  );
  expect(state.session!.report.saved).toBe(savedBefore);
  expect(state.receipts[0]!.draft!.body).toBe(original);
  await expect(hook(page, 'work-session-next')).toBeDisabled();
  await expect(hook(page, 'work-session-finish')).toBeDisabled();
  await expect(hook(page, 'examination-draft-save')).toBeDisabled();
  release();
  await expect.poll(() => state.receipts[0]!.draft!.body).toBe(revisedBody);
  await expect(hook(page, 'work-session-next')).toBeEnabled();
  await expect(hook(page, 'examination-approve')).toBeEnabled();
  expect(
    state.writes.filter((item) => item.path === preparation + '/decision')
  ).toHaveLength(0);
});

test('an uncertain save is reconciled by an explicit read without repeating its write', async ({
  page
}) => {
  const state = await fixtures(page);
  state.saveStatus = 503;
  state.applyBeforeSaveFailure = true;
  await begin(page);
  await text(page);
  await hook(page, 'examination-draft-body').fill(revisedBody);
  await hook(page, 'examination-draft-save').click();
  await expect(hook(page, 'work-session-reconcile')).toBeVisible();
  await expect(hook(page, 'work-session-next')).toBeDisabled();
  await expect(hook(page, 'examination-draft-body')).toHaveValue(revisedBody);
  expect(saves(state)).toHaveLength(1);
  await hook(page, 'work-session-reconcile').click();
  await expect
    .poll(() =>
      state.reads.some(
        (address) =>
          address.pathname === endpoint && address.searchParams.has('requestId')
      )
    )
    .toBe(true);
  await expect(hook(page, 'work-session-next')).toBeEnabled();
  expect(saves(state)).toHaveLength(1);
  expect(state.session!.report.saved).toBe(1);
});

test('unsaved navigation and finish require explicit cancel or discard without silently saving', async ({
  page
}) => {
  const state = await fixtures(page);
  await begin(page);
  await text(page);
  const original = state.receipts[0]!.draft!.body;
  await hook(page, 'examination-draft-body').fill(revisedBody);
  await hook(page, 'work-session-next').click();
  await expect(hook(page, 'examination-unsaved-dialog')).toBeVisible();
  await hook(page, 'examination-unsaved-cancel').click();
  await expect(hook(page, 'examination-draft-body')).toHaveValue(revisedBody);
  expect(new URL(page.url()).searchParams.get('obligationId')).toBe(
    obligations[0]
  );
  await hook(page, 'work-session-finish').click();
  await expect(hook(page, 'work-session-finish-dialog')).toBeVisible();
  await hook(page, 'work-session-continue').click();
  await expect(hook(page, 'examination-draft-body')).toHaveValue(revisedBody);
  await hook(page, 'work-session-next').click();
  await hook(page, 'examination-unsaved-discard').click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('obligationId'))
    .toBe(obligations[1]);
  expect(saves(state)).toHaveLength(0);
  expect(state.receipts[0]!.draft!.body).toBe(original);
  await text(page);
  await hook(page, 'examination-draft-body').fill(
    'Another local change deliberately discarded at the end.'
  );
  await hook(page, 'work-session-finish').click();
  await hook(page, 'work-session-discard-end').click();
  await hook(page, 'confirm-action').click();
  await expect.poll(() => state.session!.status).toBe('finished');
  expect(saves(state)).toHaveLength(0);
  expect(state.session!.report.decisions.total).toBe(0);
});

test('an applied save followed by another source revision is acknowledged without overwriting the newer content or losing the local buffer', async ({
  page
}) => {
  const state = await fixtures(page);
  state.saveStatus = 503;
  state.applyBeforeSaveFailure = true;
  await begin(page);
  await text(page);
  await hook(page, 'examination-draft-body').fill(revisedBody);
  await hook(page, 'examination-draft-save').click();
  await expect(hook(page, 'work-session-reconcile')).toBeVisible();
  const previous = state.receipts[0]!;
  const newerBody = 'Another tab saved a later private source revision.';
  state.receipts[0] = {
    ...previous,
    version: '7'.repeat(64),
    contentVersion: '8'.repeat(64),
    draft: {
      ...previous.draft!,
      version: 'synthetic-saved-v3',
      body: newerBody
    },
    service: {
      ...previous.service,
      content: { ...previous.service.content!, body: newerBody }
    }
  };
  await hook(page, 'work-session-reconcile').click();
  await expect(hook(page, 'work-session-source-changed')).toBeVisible();
  await expect(hook(page, 'examination-draft-body')).toHaveValue(revisedBody);
  await expect(hook(page, 'examination')).toContainText(newerBody);
  await expect(hook(page, 'examination-draft-save')).toBeDisabled();
  await expect(hook(page, 'work-session-retry-draft')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('preparationVersion')).toBe(
    'a'.repeat(64)
  );
  expect(saves(state)).toHaveLength(1);
  await hook(page, 'work-session-next').click();
  await expect(hook(page, 'examination-unsaved-dialog')).toBeVisible();
  await hook(page, 'examination-unsaved-cancel').click();
  await expect(hook(page, 'examination-draft-body')).toHaveValue(revisedBody);
  expect(state.receipts[0]!.draft!.body).toBe(newerBody);
  expect(saves(state)).toHaveLength(1);
});

test('a failed save retains the local text and requires reconciliation and confirmation before retrying the same command', async ({
  page
}) => {
  const state = await fixtures(page);
  state.saveStatus = 503;
  await begin(page);
  await text(page);
  const original = state.receipts[0]!.draft!.body;
  await hook(page, 'examination-draft-body').fill(revisedBody);
  await hook(page, 'examination-draft-save').click();
  await expect(hook(page, 'work-session-reconcile')).toBeVisible();
  await expect(hook(page, 'work-session-retry-draft')).toBeDisabled();
  expect(state.receipts[0]!.draft!.body).toBe(original);
  expect(saves(state)).toHaveLength(1);
  await hook(page, 'work-session-reconcile').click();
  await expect(hook(page, 'examination-draft-body')).toHaveValue(revisedBody);
  await expect(hook(page, 'work-session-retry-draft')).toBeEnabled();
  await expect(hook(page, 'work-session-next')).toBeDisabled();
  expect(saves(state)).toHaveLength(1);
  state.saveStatus = 200;
  await hook(page, 'work-session-retry-draft').click();
  await expect(hook(page, 'confirm-action')).toBeVisible();
  expect(saves(state)).toHaveLength(1);
  await hook(page, 'confirm-action').click();
  await expect.poll(() => state.receipts[0]!.draft!.body).toBe(revisedBody);
  expect(saves(state)).toHaveLength(2);
  expect(saves(state)[1]!.body).toEqual(saves(state)[0]!.body);
});

for (const closed of ['approved', 'fulfilled'] as const) {
  test(`a local buffer remains selectable after its acknowledged save and an externally ${closed} service`, async ({
    page
  }) => {
    const state = await fixtures(page);
    state.saveStatus = 503;
    state.applyBeforeSaveFailure = true;
    await begin(page);
    await text(page);
    await hook(page, 'examination-draft-body').fill(revisedBody);
    await hook(page, 'examination-draft-save').click();
    await expect(hook(page, 'work-session-reconcile')).toBeVisible();
    const previous = state.receipts[0]!;
    state.receipts[0] = {
      ...previous,
      version: '7'.repeat(64),
      contentVersion: '8'.repeat(64),
      draft: {
        ...previous.draft!,
        version: 'synthetic-closed-v3',
        status: closed === 'approved' ? 'approved' : 'draft',
        body: 'The current source is closed to ordinary private editing.'
      },
      service: {
        ...previous.service,
        obligationState: closed === 'fulfilled' ? 'fulfilled' : 'pending'
      },
      canApprove: false,
      canDecide: false
    };
    await hook(page, 'work-session-reconcile').click();
    const buffer = hook(page, 'examination-local-buffer-body');
    await expect(buffer).toBeVisible();
    await expect(buffer).toHaveText(revisedBody);
    await buffer.selectText();
    expect(await page.evaluate(() => getSelection()?.toString())).toContain(
      revisedBody
    );
    await expect(hook(page, 'examination-draft-editor')).toHaveCount(0);
    await expect(hook(page, 'examination-draft-save')).toHaveCount(0);
    await expect(hook(page, 'work-session-retry-draft')).toHaveCount(0);
    expect(saves(state)).toHaveLength(1);
  });
}

test('discarding a dirty selection reached without workSession in the URL needs one prompt and never saves its buffer', async ({
  page
}) => {
  const state = await fixtures(page);
  await begin(page);
  await page.goto(url());
  await text(page);
  const original = state.receipts[0]!.draft!.body;
  expect(new URL(page.url()).searchParams.has('workSession')).toBe(false);
  await hook(page, 'examination-draft-body').fill(revisedBody);
  await hook(page, 'work-session-next').click();
  await expect(hook(page, 'examination-unsaved-dialog')).toBeVisible();
  await hook(page, 'examination-unsaved-discard').click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('obligationId'))
    .toBe(obligations[1]);
  expect(new URL(page.url()).searchParams.get('workSession')).toBe(sessionId);
  await expect(hook(page, 'examination-unsaved-dialog')).not.toBeVisible();
  expect(saves(state)).toHaveLength(0);
  expect(state.receipts[0]!.draft!.body).toBe(original);
});

test('saving a dirty draft from a RouterLink departure reaches the requested destination after its acknowledgement', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(url());
  await text(page);
  await hook(page, 'examination-draft-body').fill(revisedBody);
  const document = (await page.locator('html').elementHandle())!;
  await page
    .locator(
      `a[href="/admin/fundraiser/sponsors?sponsorshipId=${dossierId}&tab=publication"]:visible`
    )
    .first()
    .click();
  await expect(hook(page, 'examination-unsaved-dialog')).toBeVisible();
  expect(saves(state)).toHaveLength(0);
  await hook(page, 'examination-unsaved-save').click();
  await expect(page).toHaveURL(/\/admin\/fundraiser\/sponsors\?/);
  expect(new URL(page.url()).searchParams.get('sponsorshipId')).toBe(dossierId);
  expect(new URL(page.url()).searchParams.get('tab')).toBe('publication');
  expect(state.receipts[0]!.draft!.body).toBe(revisedBody);
  expect(saves(state)).toHaveLength(1);
  expect(await document.evaluate((element) => element.isConnected)).toBe(true);
  expect(
    state.writes.every(
      (item) =>
        item.path.startsWith(endpoint) ||
        item.path === preparation + '/save-draft'
    )
  ).toBe(true);
  expect(
    state.writes.filter((item) => item.path === preparation + '/decision')
  ).toHaveLength(0);
});

test('two tabs share the saved draft but a stale tab cannot overwrite the newer session', async ({
  page,
  context
}) => {
  const state = await fixtures(page);
  await begin(page);
  await text(page);
  await hook(page, 'examination-draft-body').fill(
    'First tab local content must survive a stale write rejection.'
  );
  const second = await context.newPage();
  try {
    await second.goto(url(0, true));
    await text(second);
    await hook(second, 'examination-draft-body').fill(revisedBody);
    await hook(second, 'examination-draft-save').click();
    await expect.poll(() => state.receipts[0]!.draft!.body).toBe(revisedBody);
    await hook(page, 'examination-draft-save').click();
    await expect(
      hook(page, 'examination').getByRole('alert').first()
    ).toBeVisible();
    await expect(hook(page, 'examination-draft-body')).toHaveValue(
      'First tab local content must survive a stale write rejection.'
    );
    expect(state.receipts[0]!.draft!.body).toBe(revisedBody);
    expect(state.session!.report.saved).toBe(1);
  } finally {
    await second.close();
  }
});

test('a website preparation remains read only while its human correction checkpoint survives finishing', async ({
  page
}) => {
  const state = await fixtures(page, { website: true });
  await begin(page);
  await text(page);
  await expect(hook(page, 'examination-draft-body')).toHaveCount(0);
  await hook(page, 'examination-correction').click();
  await hook(page, 'examination-reason').fill(
    'A private correction note preserved for the next work session.'
  );
  await finish(page);
  await expect.poll(() => state.session!.status).toBe('finished');
  await page.reload();
  await hook(page, 'work-session-resume').click();
  await expect(hook(page, 'examination-reason')).toHaveValue(
    'A private correction note preserved for the next work session.'
  );
  expect(saves(state)).toHaveLength(0);
  expect(state.session!.report.decisions.total).toBe(0);
});

for (const status of ['paused', 'finished'] as const) {
  test(`opening a ${status} work session cannot decide or invent uncertainty before explicit resume`, async ({
    page
  }) => {
    const state = await fixtures(page);
    await begin(page);
    state.session = {
      ...state.session!,
      status,
      finishedAt: status === 'finished' ? at : null
    };
    const writesBeforeOpen = state.writes.length;
    await page.goto(url(0, true));
    await expect(hook(page, 'work-session-state')).toHaveAttribute(
      'data-state',
      status
    );
    await expect(hook(page, 'examination-approve')).toBeDisabled();
    await expect(hook(page, 'examination-decision-guidance')).toHaveAttribute(
      'data-reason',
      'session-inactive'
    );
    await expect(hook(page, 'examination-guidance-resume')).toBeVisible();
    await expect(hook(page, 'work-session-reconcile')).toHaveCount(0);
    expect(state.writes).toHaveLength(writesBeforeOpen);
    await hook(page, 'examination-guidance-resume').click();
    await expect(hook(page, 'examination-approve')).toBeEnabled();
    expect(
      state.writes.filter((item) => item.path === preparation + '/decision')
    ).toHaveLength(0);
    expect(state.session!.status).toBe('active');
  });
}

test('a social draft already approved by delivery workflow or a fulfilled service has no ordinary editor or approval action', async ({
  page
}) => {
  const state = await fixtures(page);
  const original = state.receipts[0]!;
  for (const closed of [
    {
      ...original,
      draft: { ...original.draft!, status: 'approved' },
      canApprove: false,
      canDecide: false
    },
    {
      ...original,
      service: { ...original.service, obligationState: 'fulfilled' as const },
      canApprove: false,
      canDecide: false
    }
  ]) {
    state.receipts[0] = closed;
    await page.goto(url());
    await text(page);
    await expect(hook(page, 'examination-draft-editor')).toHaveCount(0);
    const approve = hook(page, 'examination-approve');
    if (await approve.count()) await expect(approve).toBeDisabled();
    else await expect(approve).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
  }
});

test('starting a new session after finishing keeps the old activity separate without another business decision', async ({
  page
}) => {
  const state = await fixtures(page);
  await begin(page);
  await hook(page, 'examination-approve').click();
  await hook(page, 'confirm-action').click();
  await expect.poll(() => state.receipts[0]!.status).toBe('approved');
  await finish(page);
  await expect.poll(() => state.session!.status).toBe('finished');
  const finished = structuredClone(state.session!);
  const decision = structuredClone(state.receipts[0]!.decision);
  await page.goto(url(1, true));
  await expect(hook(page, 'work-session-start-new')).toBeVisible();
  const writesBeforeStart = state.writes.length;
  await hook(page, 'work-session-start-new').click();
  await expect.poll(() => state.session!.id).not.toBe(finished.id);
  await expect
    .poll(() => new URL(page.url()).searchParams.get('workSession'))
    .toBe(state.session!.id);
  expect(state.session!.status).toBe('active');
  expect(state.session!.report.decisions.total).toBe(0);
  expect(state.session!.report.readyForDelivery).toBe(1);
  expect(state.archivedSessions[0]).toEqual(finished);
  expect(state.receipts[0]!.decision).toEqual(decision);
  const newWrites = state.writes.slice(writesBeforeStart);
  expect(newWrites.filter((item) => item.path === endpoint)).toHaveLength(1);
  expect(
    newWrites.every(
      (item) =>
        item.path === endpoint ||
        item.path === endpoint + '/' + state.session!.id + '/commands'
    )
  ).toBe(true);
  expect(saves(state)).toHaveLength(0);
});
