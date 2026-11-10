import { AxeBuilder } from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import type {
  AdminAssistantContextResponse,
  AdminAssistantPrepareResponse,
  AdminCampaignItem,
  AdminDossierPreparationReceipt,
  AdminPreflightWorkSession,
  AdminPreflightWorkSessionCommandRequest,
  AdminInformationRequest,
  AdminServicePreparationDecision,
  AdminServicePreparationDecisionRequest,
  AdminServicePreparationReceipt,
  AdminSponsorshipConsent,
  AdminSponsorshipConsentRecordRequest,
  AdminSponsorshipConsentRecordReceipt,
  AdminSponsorshipConsentReceiptResponse,
  PreflightDeskResponse,
  SponsorMediaPreparationAssignment,
  SponsorMediaWorkspaceAsset
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
const endpoint = '/api/admin/sponsorships/preparation/service';
const at = '2026-11-05T14:00:00.000Z';
const dossierId = contributionId(1);
const consentEndpoint = '/api/admin/sponsorships/consent';
const consentScope = 'public_profile_name_and_presentation' as const;
const consentActor = 'Synthetic consent reviewer';
const consentEvidence = 'SYNTHETIC-PRIVATE-AGREEMENT-REFERENCE';
const webBody = 'Présentation privée proposée pour le site Web.';
const obligationIds = [
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002'
] as const;
const hook = (page: Page, name = '') =>
  page.locator(`[data-og7="examination${name ? '-' + name : ''}"]`);

async function expectReadableColor(
  target: Locator,
  property: 'color' | 'outlineColor' | 'borderTopColor' = 'color',
  minimum = 4.5
): Promise<number> {
  await expect(target).toBeVisible();
  const result = await target.evaluate((element, property) => {
    type Color = readonly [number, number, number, number];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Contrast measurement unavailable');
    const parse = (value: string): Color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]! / 255];
    };
    const over = (front: Color, back: Color): Color => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (!alpha) return [0, 0, 0, 0];
      const channel = (index: 0 | 1 | 2) =>
        (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) /
        alpha;
      return [channel(0), channel(1), channel(2), alpha];
    };
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement)
      ancestors.push(node);
    let background: Color = [255, 255, 255, 1];
    let gradient = false;
    for (const node of ancestors.reverse()) {
      const style = getComputedStyle(node);
      const fill = parse(style.backgroundColor);
      if (fill[3] === 1) gradient = false;
      if (style.backgroundImage !== 'none') gradient = true;
      background = over(fill, background);
    }
    const foreground = getComputedStyle(element)[property];
    const rendered = over(parse(foreground), background);
    const luminance = (color: Color) => {
      const linear = (value: number) => {
        const normalized = value / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return (
        0.2126 * linear(color[0]) +
        0.7152 * linear(color[1]) +
        0.0722 * linear(color[2])
      );
    };
    const first = luminance(rendered),
      second = luminance(background);
    return {
      foreground,
      background,
      gradient,
      ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
    };
  }, property);
  expect(
    result.gradient,
    'A flat background is required for this measurement'
  ).toBe(false);
  expect(result.ratio, JSON.stringify(result)).toBeGreaterThanOrEqual(minimum);
  return result.ratio;
}

function service(index: number): AdminCampaignItem {
  const channel = index === 0 ? 'website' : 'facebook';
  return {
    id: obligationIds[index]!,
    contributionId: dossierId,
    reference: 'SYNTHETIC-EXAM-001',
    companyName: 'Atelier synthétique de la Rivière',
    paidAt: at,
    channel,
    target: 'openg7',
    ordinal: 1,
    quantity: 1,
    format: channel === 'facebook' ? 'collective_text' : null,
    obligationState: 'pending',
    timing: null,
    preparation: {
      status: 'ready',
      version: '1'.repeat(64),
      approvedAt: null,
      blockers: []
    },
    workflow: {
      obligationId: obligationIds[index]!,
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
      title: index === 0 ? 'SYNTHETIC WEB TITLE' : 'SYNTHETIC FACEBOOK TITLE',
      body: index === 0 ? webBody : 'Publication privée proposée pour Facebook.'
    },
    proof: null,
    adminUrl: `${base}?view=desk&sponsorshipId=${dossierId}&obligationId=${obligationIds[index]}`
  };
}

function serviceReceipt(index = 0): AdminServicePreparationReceipt {
  const source = preparationReceipt(1);
  const services = [service(0), service(1)];
  const drafts = services.map((item) => ({
    id: 'synthetic-private-draft-' + item.channel,
    kind:
      item.channel === 'website'
        ? ('website' as const)
        : ('publication' as const),
    version: 'synthetic-content-v1',
    title: item.content!.title,
    body: item.content!.body,
    disclosureText: item.channel === 'website' ? '' : 'Commandite synthétique.',
    channel: item.channel,
    target: item.target,
    status: 'private',
    adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${dossierId}&tab=publication`
  }));
  const dossier: AdminDossierPreparationReceipt = {
    context: 'dossier',
    contributionId: dossierId,
    reference: services[0]!.reference,
    version: source.version,
    status: 'ready',
    payment: source.payment,
    acceptedOffer: {
      ...source.acceptedOffer!,
      benefits: [
        ...source.acceptedOffer!.benefits,
        {
          id: 'facebook_batch',
          channel: 'facebook',
          target: 'openg7',
          quantity: 1,
          format: 'collective_text',
          requiredElements: ['company_name', 'approved_presentation'],
          deadlineDays: 14,
          durationDays: null
        }
      ]
    },
    balance: {
      ...source.balance!,
      expected: 2,
      outstanding: 2,
      obligations: services.map((item) => ({
        id: item.id,
        benefitId:
          item.channel === 'website' ? 'website_mention' : 'facebook_batch',
        channel: item.channel,
        target: item.target,
        ordinal: 1,
        state: 'pending',
        version: 1,
        ...(item.format ? { format: item.format } : {})
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
    reference: services[index]!.reference,
    companyName: services[index]!.companyName,
    version: 'a'.repeat(64),
    contentVersion: 'c'.repeat(64),
    status: 'ready',
    service: services[index]!,
    siblings: services,
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
      dossier: `/admin/fundraiser/sponsors?sponsorshipId=${dossierId}&tab=publication`,
      media: `/admin/fundraiser/sponsors?sponsorshipId=${dossierId}&tab=media`,
      edit: `/admin/fundraiser/sponsors?sponsorshipId=${dossierId}&tab=publication`,
      delivery: `/admin/fundraiser/campaigns?sponsorshipId=${dossierId}&obligationId=${obligationIds[index]}`,
      evidence: `/admin/fundraiser/campaigns?sponsorshipId=${dossierId}&obligationId=${obligationIds[index]}`
    }
  };
}

function mediaAsset(
  position: number,
  approved: boolean
): SponsorMediaWorkspaceAsset {
  return {
    id: `40000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
    contributionId: dossierId,
    kind: 'supporting_image',
    reviewStatus: approved ? 'approved' : 'pending_review',
    uploadedBy: 'sponsor',
    originalFilename: `synthetic-photo-${position}.png`,
    originalMimeType: 'image/png',
    originalSizeBytes: 1000,
    processedMimeType: 'image/webp',
    processedSizeBytes: 500,
    width: 1,
    height: 1,
    altText: `Photo synthétique ${position}`,
    sortOrder: position,
    publicUrl: approved
      ? `https://synthetic.invalid/photo-${position}.webp`
      : null,
    reviewedAt: approved ? at : null,
    version: 'synthetic-asset-v1',
    createdAt: at,
    batchId: null,
    usageSource: 'media',
    ruleId: null,
    readiness: {
      state: approved ? 'ready' : 'needs_review',
      reasons: approved ? [] : ['review_required']
    },
    moderation: {
      state: null,
      level: null,
      contentVersion: 1,
      fingerprint: 'synthetic-fingerprint',
      currentDecisionId: null
    },
    websiteSelected: true,
    usage: {
      state: 'confirmed',
      channels: ['website'],
      targets: ['openg7'],
      transformations: ['technical'],
      credit: null,
      restrictions: null
    }
  };
}

function deskResponse(
  receipts: readonly AdminServicePreparationReceipt[]
): PreflightDeskResponse {
  const services = receipts.map((item) => ({
    ...item.service,
    stage:
      item.status === 'approved'
        ? ('to_deliver' as const)
        : ['correction_requested', 'rejected'].includes(item.status)
          ? ('to_prepare' as const)
          : ('to_review' as const),
    blocked: item.blockers.length > 0,
    blockers: item.blockers,
    preparationOrigin: 'funding' as const,
    preflightLink: 'unverified' as const,
    reviewUrl: item.links.delivery!
  }));
  return {
    generatedAt: at,
    summary: {
      total: 2,
      toPrepare: services.filter((item) => item.stage === 'to_prepare').length,
      toReview: services.filter((item) => item.stage === 'to_review').length,
      toDeliver: services.filter((item) => item.stage === 'to_deliver').length,
      delivered: 0,
      excludedAdjusted: 0,
      orders: 1,
      scope: 'recorded_promised_services',
      preflightLink: 'unverified'
    },
    orders: [
      {
        contributionId: dossierId,
        reference: 'SYNTHETIC-EXAM-001',
        companyName: services[0]!.companyName,
        amountMinor: '2500',
        currency: 'CAD',
        commitmentId: '30000000-0000-4000-8000-000000000001',
        commitmentVersion: 1,
        paidAt: at,
        services,
        total: 2,
        delivered: 0,
        adminUrl: receipts[0]!.links.dossier
      }
    ],
    pagination: {
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false
    }
  };
}

async function fixtures(
  page: Page,
  options: {
    language?: 'fr-CA' | 'en';
    role?: 'owner' | 'operator' | 'reader';
    theme?: 'mineral' | 'night' | 'graphite';
  } = {}
) {
  if (options.theme) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((theme) => {
      localStorage.setItem(
        'openg7.pilotage.appearance.v1',
        JSON.stringify({ theme, system: false, density: 'comfortable' })
      );
    }, options.theme);
  } else await prepareAdminDesignReview(page);
  await page.addInitScript(
    (locale) => localStorage.setItem('openg7.language', locale),
    options.language ?? 'fr-CA'
  );
  const state = {
    receipts: [serviceReceipt(0), serviceReceipt(1)],
    reads: [] as URL[],
    writes: [] as {
      path: string;
      body: AdminServicePreparationDecisionRequest;
    }[],
    personalWrites: [] as { path: string; body: Record<string, unknown> }[],
    workSession: null as AdminPreflightWorkSession | null,
    signedIn: true,
    readStatus: 200,
    workspaceStatus: 200,
    decisionStatus: 200,
    decisionCode: '',
    decisionDelay: 0,
    readDelay: new Map<string, number>(),
    settledReads: [] as string[],
    assets: [] as SponsorMediaWorkspaceAsset[],
    preparationAssignments: [] as SponsorMediaPreparationAssignment[],
    consent: {
      contributionId: dossierId,
      version: 'synthetic-consent-v1',
      effectiveConsent: true,
      source: 'checkout',
      scope: consentScope,
      canRecord: false,
      recordBlockers: ['already_granted'],
      ...(options.role !== 'reader'
        ? { recordingActor: consentActor, history: [] }
        : {})
    } as AdminSponsorshipConsent,
    consentReads: [] as URL[],
    settledConsentReads: [] as URL[],
    consentPosts: [] as AdminSponsorshipConsentRecordRequest[],
    consentReceipts: new Map<string, AdminSponsorshipConsentRecordReceipt>(),
    consentReadStatus: 200,
    consentPostStatus: 200,
    consentReceiptStatus: 200,
    consentPostCode: 'CONSENT_UNAVAILABLE',
    consentReadDelay: 0,
    consentPostDelay: 0,
    consentApplyBeforeError: false
  };
  const applyConsent = (
    body: AdminSponsorshipConsentRecordRequest
  ): AdminSponsorshipConsentRecordReceipt => {
    const existing = state.consentReceipts.get(body.requestId);
    if (existing) return existing;
    const receipt: AdminSponsorshipConsentRecordReceipt = {
      requestId: body.requestId,
      contributionId: dossierId,
      recordId: '70000000-0000-4000-8000-000000000001',
      outcome: 'recorded',
      version: 'synthetic-consent-v2',
      effectiveConsent: true,
      publicVisibilityHeld: true,
      invalidatedDeliveryCount: 1,
      recordedAt: at,
      actor: consentActor
    };
    state.consentReceipts.set(body.requestId, receipt);
    state.consent = {
      ...state.consent,
      version: receipt.version,
      effectiveConsent: true,
      source: 'documented_agreement',
      canRecord: false,
      recordBlockers: ['already_granted'],
      history: [
        {
          id: receipt.recordId,
          agreedOn: body.agreedOn,
          evidenceReference: body.evidenceReference,
          recordedAt: at,
          actor: consentActor
        }
      ]
    };
    state.receipts = state.receipts.map((previous) => ({
      ...previous,
      version: 'd'.repeat(64),
      contentVersion: 'e'.repeat(64),
      checks: previous.checks.map((check) =>
        check.code === 'public_consent'
          ? { ...check, state: 'complete' as const }
          : check
      ),
      blockers: previous.blockers.filter(
        (code) => code !== 'public_consent_missing'
      ),
      dossier: {
        ...previous.dossier,
        authorizations: previous.dossier.authorizations.map((check) =>
          check.code === 'public_consent'
            ? { ...check, state: 'complete' as const }
            : check
        )
      }
    }));
    return receipt;
  };
  const sessionEndpoint = '/api/admin/preflight/work-sessions';
  const sessionId = '40000000-0000-4000-8000-000000000011';
  const projectSession = () => {
    if (!state.workSession) return;
    const approved = state.receipts.filter(
      (item) => item.status === 'approved'
    ).length;
    state.workSession = {
      ...state.workSession,
      report: {
        ...state.workSession.report,
        saved: state.workSession.items.filter((item) => item.state === 'saved')
          .length,
        decisions: {
          total: state.receipts.filter((item) => item.decision).length,
          approved,
          correctionRequested: state.receipts.filter(
            (item) => item.status === 'correction_requested'
          ).length,
          rejected: state.receipts.filter((item) => item.status === 'rejected')
            .length
        },
        readyForDelivery: approved
      }
    };
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/admin/auth/config')
      return route.fulfill({ json: { mode: 'oidc' } });
    if (url.pathname === '/api/admin/auth/current')
      return route.fulfill(
        state.signedIn
          ? {
              json: {
                id: 'synthetic-examination-owner',
                sessionId: 'synthetic-examination-session',
                displayName: 'Synthetic reviewer',
                role: options.role ?? 'owner',
                expiresAt: '2099-01-01T00:00:00Z'
              }
            }
          : { status: 401, json: {} }
      );
    if (url.pathname === consentEndpoint && request.method() === 'GET') {
      state.consentReads.push(url);
      const result = structuredClone(state.consent);
      if (state.consentReadDelay)
        await new Promise((resolve) =>
          setTimeout(resolve, state.consentReadDelay)
        );
      state.settledConsentReads.push(url);
      if (state.consentReadStatus === 401) state.signedIn = false;
      return route.fulfill(
        state.consentReadStatus === 200
          ? { json: result }
          : {
              status: state.consentReadStatus,
              json: { code: 'CONSENT_UNAVAILABLE' }
            }
      );
    }
    if (
      url.pathname === consentEndpoint + '/receipt' &&
      request.method() === 'GET'
    ) {
      state.consentReads.push(url);
      if (state.consentReceiptStatus === 401) state.signedIn = false;
      if (state.consentReceiptStatus !== 200)
        return route.fulfill({
          status: state.consentReceiptStatus,
          json: { code: 'CONSENT_UNAVAILABLE' }
        });
      const receipt = state.consentReceipts.get(
        url.searchParams.get('requestId') ?? ''
      );
      const response: AdminSponsorshipConsentReceiptResponse = receipt
        ? { state: 'recorded', receipt }
        : { state: 'not_found' };
      return route.fulfill({ json: response });
    }
    if (
      url.pathname === consentEndpoint + '/record' &&
      request.method() === 'POST'
    ) {
      const body =
        request.postDataJSON() as AdminSponsorshipConsentRecordRequest;
      state.consentPosts.push(body);
      if (state.consentPostDelay)
        await new Promise((resolve) =>
          setTimeout(resolve, state.consentPostDelay)
        );
      if (state.consentPostStatus === 401) state.signedIn = false;
      if (state.consentPostStatus !== 200) {
        if (state.consentApplyBeforeError) applyConsent(body);
        return route.fulfill({
          status: state.consentPostStatus,
          json: { code: state.consentPostCode }
        });
      }
      return route.fulfill({ json: applyConsent(body) });
    }
    if (url.pathname === sessionEndpoint && request.method() === 'GET') {
      projectSession();
      return route.fulfill({
        json: {
          current: state.workSession,
          recent: state.workSession ? [state.workSession] : [],
          command: null
        }
      });
    }
    if (url.pathname === sessionEndpoint && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.personalWrites.push({ path: url.pathname, body });
      state.workSession = {
        id: sessionId,
        revision: 1,
        status: 'active',
        startedAt: at,
        updatedAt: at,
        finishedAt: null,
        lastPosition: 1,
        itemCount: state.receipts.length,
        filters: {},
        items: state.receipts.map((item, index) => ({
          position: index + 1,
          contributionId: dossierId,
          obligationId: item.service.id,
          observedVersion: item.version,
          state: 'pending',
          checkpoint: { pendingDecision: null, reason: '' },
          visitedAt: index === 0 ? at : null,
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
          deferred: 0,
          saved: 0,
          remaining: 2,
          decisions: {
            total: 0,
            approved: 0,
            correctionRequested: 0,
            rejected: 0
          },
          readyForDelivery: 0,
          delivered: 0,
          unavailable: 0,
          toResume: 0,
          attention: []
        }
      };
      return route.fulfill({ json: state.workSession });
    }
    if (
      url.pathname === sessionEndpoint + '/' + sessionId + '/commands' &&
      request.method() === 'POST'
    ) {
      const body =
        request.postDataJSON() as AdminPreflightWorkSessionCommandRequest;
      state.personalWrites.push({
        path: url.pathname,
        body: body as unknown as Record<string, unknown>
      });
      if (
        !state.workSession ||
        body.expectedRevision !== state.workSession.revision
      )
        return route.fulfill({
          status: 409,
          json: { code: 'WORK_SESSION_VERSION_CONFLICT' }
        });
      const position = body.obligationId
        ? obligationIds.indexOf(
            body.obligationId as (typeof obligationIds)[number]
          ) + 1
        : state.workSession.lastPosition;
      state.workSession = {
        ...state.workSession,
        revision: state.workSession.revision + 1,
        lastPosition: position,
        items: state.workSession.items.map((item) =>
          item.position === position
            ? {
                ...item,
                ...(body.checkpoint
                  ? {
                      checkpoint: body.checkpoint,
                      state: 'saved' as const,
                      savedAt: at
                    }
                  : {})
              }
            : item
        )
      };
      projectSession();
      return route.fulfill({ json: state.workSession });
    }
    if (request.method() !== 'GET') {
      const body =
        request.postDataJSON() as AdminServicePreparationDecisionRequest;
      state.writes.push({ path: url.pathname, body });
      if (url.pathname !== endpoint + '/decision')
        return route.fulfill({ status: 405, json: {} });
      if (state.decisionDelay)
        await new Promise((resolve) =>
          setTimeout(resolve, state.decisionDelay)
        );
      if (state.decisionStatus !== 200)
        return route.fulfill({
          status: state.decisionStatus,
          json: {
            code: state.decisionCode,
            error: 'Synthetic decision failure.'
          }
        });
      const index = obligationIds.indexOf(
        body.obligationId as (typeof obligationIds)[number]
      );
      const previous = state.receipts[index]!;
      const decision: AdminServicePreparationDecision = {
        id: 'synthetic-decision-' + body.requestId,
        contributionId: body.contributionId,
        obligationId: body.obligationId,
        draftId: previous.draft!.id,
        draftVersion: previous.draft!.version,
        contentVersion: previous.contentVersion,
        decision: body.decision,
        reason: body.reason ?? null,
        actor: 'synthetic-examination-owner',
        createdAt: at,
        requestId: body.requestId,
        auditReference: 'synthetic-audit-' + body.requestId
      };
      state.receipts[index] = {
        ...previous,
        version: 'b'.repeat(64),
        status: body.decision,
        canApprove: false,
        canDecide: false,
        decision,
        history: [...previous.history, decision]
      };
      return route.fulfill({ json: state.receipts[index] });
    }
    state.reads.push(url);
    if (url.pathname === endpoint) {
      const index = obligationIds.indexOf(
        url.searchParams.get('obligationId') as (typeof obligationIds)[number]
      );
      const result =
        index < 0 || url.searchParams.get('sponsorshipId') !== dossierId
          ? null
          : state.receipts[index];
      const delay = state.readDelay.get(
        url.searchParams.get('obligationId') ?? ''
      );
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      state.settledReads.push(url.searchParams.get('obligationId') ?? '');
      return route.fulfill(
        state.readStatus !== 200
          ? { status: state.readStatus, json: { code: 'RUN_UNAVAILABLE' } }
          : result
            ? { json: result }
            : { status: 404, json: { code: 'PREPARATION_NOT_FOUND' } }
      );
    }
    if (url.pathname === '/api/admin/preflight/desk')
      return route.fulfill({ json: deskResponse(state.receipts) });
    if (url.pathname === '/api/admin/campaigns')
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
    if (url.pathname === '/api/admin/sponsorships/preparation')
      return route.fulfill({ json: state.receipts[0]!.dossier });
    if (url.pathname === '/api/admin/preflight/inbox')
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
    if (url.pathname === '/api/admin/sponsorships/media/workspace') {
      if (state.workspaceStatus !== 200) {
        if (state.workspaceStatus === 401) state.signedIn = false;
        return route.fulfill({ status: state.workspaceStatus, json: {} });
      }
      return route.fulfill({
        json: {
          contributionId: dossierId,
          revision: 'synthetic-media-v1',
          assets: state.assets,
          preparationObligations: state.receipts.map((item) => ({
            id: item.service.id,
            version: 1,
            channel: item.service.channel,
            target: item.service.target,
            ordinal: item.service.ordinal,
            format: item.service.format,
            state: item.service.obligationState,
            acceptsMedia: true
          })),
          preparationAssignments: state.preparationAssignments,
          rules: [],
          batches: [],
          writable: false
        }
      });
    }
    if (url.pathname === '/api/admin/sponsorships/logo')
      return route.fulfill({ status: 404, json: {} });
    if (url.pathname.startsWith('/api/admin/sponsorships/media/content/'))
      return route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZHkAAAAASUVORK5CYII=',
          'base64'
        )
      });
    if (url.pathname === '/api/admin/sponsorships/media')
      return route.fulfill({ json: { items: [], total: 0 } });
    return route.fulfill({ status: 503, json: {} });
  });
  return state;
}

function examinationUrl(index = 0) {
  const query = new URLSearchParams({
    view: 'desk',
    sponsorshipId: dossierId,
    obligationId: obligationIds[index]!,
    preparationVersion: 'a'.repeat(64),
    deskSearch: 'SYNTHETIC-',
    deskStatus: 'to_review',
    deskPage: '2'
  });
  return `${base}?${query}`;
}

async function chooseSection(page: Page, name: string) {
  await page
    .locator(`[data-og7="examination-section"][data-og7-id="${name}"]`)
    .click();
}

async function confirm(page: Page) {
  const confirmation = page.locator('[data-og7="confirm-action"]');
  await expect(confirmation).toBeVisible();
  await confirmation.click();
}

function missingConsent(
  state: Awaited<ReturnType<typeof fixtures>>,
  role: 'owner' | 'reader' = 'owner',
  index = 0
) {
  state.consent = {
    contributionId: dossierId,
    version: 'synthetic-consent-v1',
    effectiveConsent: false,
    source: 'none',
    scope: consentScope,
    canRecord: role === 'owner',
    recordBlockers: role === 'owner' ? [] : ['permission_required'],
    ...(role === 'owner' ? { recordingActor: consentActor, history: [] } : {})
  };
  state.receipts[index] = {
    ...state.receipts[index]!,
    status: 'blocked',
    canApprove: false,
    canDecide: false,
    dossier: {
      ...state.receipts[index]!.dossier,
      canApprove: false,
      authorizations: state.receipts[index]!.dossier.authorizations.map(
        (check) =>
          ['public_consent', 'sponsor_review', 'moderation_review'].includes(
            check.code
          )
            ? { ...check, state: 'missing' as const }
            : check
      )
    },
    checks: [
      { code: 'payment_confirmed', state: 'complete' },
      { code: 'accepted_offer', state: 'complete' },
      { code: 'public_consent', state: 'missing' },
      { code: 'sponsor_review', state: 'missing' },
      { code: 'moderation_review', state: 'missing' },
      { code: 'draft_moderation_review', state: 'missing' },
      { code: 'service_draft_identified', state: 'complete' }
    ],
    blockers: [
      'public_consent_missing',
      'sponsor_review_required',
      'moderation_review_required',
      'required_media_missing'
    ]
  };
}

const consentControl = (page: Page, name: string) =>
  hook(page, 'consent-' + name);

async function openConsent(page: Page) {
  await hook(page, 'guided-open').click();
  await expect(hook(page, 'guided-preparation')).toBeVisible();
  await hook(page, 'consent-open').click();
  await expect(hook(page, 'consent')).toBeVisible();
}

async function fillConsent(page: Page) {
  await consentControl(page, 'agreement').check();
  await consentControl(page, 'date').fill('2026-11-04');
  await consentControl(page, 'evidence').fill(consentEvidence);
}

async function consentRequestFixtures(
  page: Page,
  state: Awaited<ReturnType<typeof fixtures>>,
  language: 'fr-CA' | 'en' = 'fr-CA'
) {
  const english = language === 'en';
  const recipient = 'synthetic-consent-contact@example.invalid';
  const subject = english
    ? 'Public profile consent — SYNTHETIC-EXAM-001'
    : 'Consentement au profil public — SYNTHETIC-EXAM-001';
  const body = english
    ? 'Hello, please reply explicitly to confirm whether you agree to the public use of your organization name and presentation. No agreement is assumed without your reply.'
    : 'Bonjour, merci de répondre explicitement pour nous indiquer si vous acceptez l’utilisation publique du nom et de la présentation de votre organisation. Aucun accord n’est présumé sans votre réponse.';
  const context: AdminAssistantContextResponse = {
    status: 'ok',
    generatedAt: at,
    conversationMode: 'disabled',
    context: {
      contributionId: dossierId,
      reference: 'SYNTHETIC-EXAM-001',
      version: 'a'.repeat(64),
      paymentStatus: 'paid',
      refundStatus: 'not_requested',
      reviewStatus: 'approved',
      feedStatus: 'not_planned',
      publicConsent: false,
      missingFields: [],
      media: { total: 1, approved: 1, pending: 0, rejected: 0 },
      promisedChannels: ['facebook'],
      coveredChannels: [],
      nextStep: 'confirm_consent',
      adminUrl: `/admin/fundraiser/sponsors?sponsorshipId=${dossierId}`,
      canRequestInformation: false
    }
  };
  const proposal: AdminAssistantPrepareResponse = {
    status: 'ok',
    message: null,
    draft: {
      type: 'sponsorship_consent_request',
      title: subject,
      generatedAt: at,
      reference: 'SYNTHETIC-EXAM-001',
      sent: false,
      published: false,
      persisted: false,
      fields: [{ label: english ? 'Subject' : 'Objet', value: subject }],
      bodyLines: [body],
      notice: english ? 'No email sent.' : 'Aucun courriel envoyé.',
      limitations: [],
      adminUrl: context.context!.adminUrl
    },
    delivery: {
      contributionId: dossierId,
      contextVersion: context.context!.version,
      recipient,
      subject,
      body,
      purpose: 'public_consent'
    }
  };
  const requests = {
    contextReads: [] as URL[],
    preparations: [] as Record<string, unknown>[],
    posts: [] as AdminInformationRequest[],
    receiptReads: [] as URL[],
    prepareStatus: 200,
    sendStatus: 200,
    receiptFound: false
  };
  await page.route('**/api/admin/assistant/context?*', async (route) => {
    requests.contextReads.push(new URL(route.request().url()));
    return route.fulfill({ json: context });
  });
  await page.route('**/api/admin/assistant/prepare', async (route) => {
    requests.preparations.push(
      route.request().postDataJSON() as Record<string, unknown>
    );
    return route.fulfill({
      status: requests.prepareStatus,
      json: requests.prepareStatus === 200 ? proposal : { code: 'UNAVAILABLE' }
    });
  });
  const receipt = (requestId: string) => ({
    requestId,
    contributionId: dossierId,
    found: true,
    messageId: '80000000-0000-4000-8000-000000000001',
    acceptedAt: at,
    deliveryStatus: 'queued',
    sentAt: null
  });
  await page.route(
    '**/api/admin/sponsorships/request-information',
    async (route) => {
      const input = route.request().postDataJSON() as AdminInformationRequest;
      requests.posts.push(input);
      return route.fulfill({
        status: requests.sendStatus,
        json:
          requests.sendStatus === 200
            ? { ...receipt(input.requestId), status: 'queued' }
            : { code: 'INFORMATION_REQUEST_UNAVAILABLE' }
      });
    }
  );
  await page.route(
    '**/api/admin/sponsorships/information-request-receipt?*',
    async (route) => {
      const url = new URL(route.request().url());
      requests.receiptReads.push(url);
      const requestId = url.searchParams.get('requestId') ?? '';
      return route.fulfill({
        json: requests.receiptFound
          ? receipt(requestId)
          : { requestId, contributionId: dossierId, found: false }
      });
    }
  );
  return Object.assign(requests, {
    context,
    proposal,
    state,
    recipient,
    subject,
    body
  });
}

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1024, 1536]) {
    test(`Preflight examination exposes real prepared content and accessible review in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const state = await fixtures(page, { language });
      await page.goto(examinationUrl());
      await expect(hook(page)).toBeVisible();
      await expect(hook(page)).toContainText(
        'Atelier synthétique de la Rivière'
      );
      await expect(hook(page, 'provenance')).toContainText('Funding');
      await expect(hook(page, 'preview')).toContainText(webBody);
      for (const view of [
        'text',
        'media',
        'checks',
        'details',
        'history',
        'preview'
      ])
        await chooseSection(page, view);
      await expectAdminPageFits(page);
      const axe = await new AxeBuilder({ page })
        .include('[data-og7="examination"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(axe.violations).toEqual([]);
      expect(state.writes).toEqual([]);
      if (language === 'fr-CA')
        await captureAdminDesign(
          page,
          testInfo,
          `preflight-examination-${width}px.fr`,
          true
        );
    });
  }
}

for (const status of [401, 403]) {
  test(`Examiner removes private content when its media library denies access with ${status}`, async ({
    page
  }) => {
    const state = await fixtures(page, { role: 'reader' });
    state.workspaceStatus = status;
    await page.goto(examinationUrl());
    if (status === 401) {
      await expect(page).toHaveURL(/\/admin\/login(?:\?|$)/);
      await expect(
        page.getByRole('status').filter({
          hasText: 'Votre session a expiré ou a été révoquée.'
        })
      ).toContainText('Reconnectez-vous pour continuer.');
    } else {
      await expect(hook(page, 'error')).toBeVisible();
      await expect(hook(page, 'error')).toContainText(
        'Vous n’avez pas accès à cette prestation.'
      );
    }
    await expect(hook(page, 'preview')).toHaveCount(0);
    await expect(page.getByText(webBody, { exact: true })).toHaveCount(0);
    await expect(
      page.locator('[data-og7="examination-assigned-asset"]')
    ).toHaveCount(0);
    expect(state.writes).toEqual([]);
  });
}

test('Preflight examination survives reload, navigates exact sibling services and preserves desk context on return', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(examinationUrl());
  await expect(hook(page, 'preview')).toContainText(webBody);
  await page.reload();
  await expect(hook(page, 'preview')).toContainText(webBody);
  await hook(page, 'next').click();
  await expect(hook(page, 'preview')).toContainText('SYNTHETIC FACEBOOK TITLE');
  expect(new URL(page.url()).searchParams.get('obligationId')).toBe(
    obligationIds[1]
  );
  await hook(page, 'previous').click();
  await expect(hook(page, 'preview')).toContainText(webBody);
  await hook(page, 'back').click();
  await expect(hook(page)).toHaveCount(0);
  const params = new URL(page.url()).searchParams;
  expect(params.get('deskSearch')).toBe('SYNTHETIC-');
  expect(params.get('deskStatus')).toBe('to_review');
  expect(params.get('deskPage')).toBe('2');
  expect(params.get('sponsorshipId')).toBeNull();
  expect(params.get('obligationId')).toBeNull();
  expect(state.writes).toEqual([]);
});

test('Preflight examination changes actual preview widths and provides enlarged keyboard-accessible rendering', async ({
  page
}) => {
  await page.setViewportSize({ width: 1536, height: 1100 });
  await fixtures(page);
  await page.goto(examinationUrl());
  await expect(hook(page, 'preview')).toContainText(webBody);
  const widths: number[] = [];
  const content = hook(page, 'preview')
    .locator('[data-og7="preflight-preview-content"]')
    .first();
  for (const viewport of ['desktop', 'tablet', 'mobile']) {
    const control = page.locator(
      `[data-og7="examination-viewport"][data-og7-id="${viewport}"]`
    );
    await control.click();
    await expect(control).toHaveAttribute('aria-pressed', 'true');
    await expect(
      hook(page, 'preview').locator('[data-og7-viewport]')
    ).toHaveAttribute('data-og7-viewport', viewport);
    if (viewport === 'mobile')
      await expect
        .poll(async () => (await content.boundingBox())?.width ?? Infinity)
        .toBeLessThan(widths[1]!);
    widths.push((await content.boundingBox())!.width);
  }
  expect(widths[2]).toBeLessThan(widths[1]!);
  expect(widths[1]).toBeLessThanOrEqual(widths[0]!);
  await hook(page, 'enlarge').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(hook(page, 'enlarge')).toBeFocused();
});

test('Preflight examination approval confirms one exact version without publication or false delivery', async ({
  page
}) => {
  const state = await fixtures(page);
  state.decisionDelay = 250;
  await page.goto(examinationUrl());
  await expect(hook(page, 'approve')).toBeEnabled();
  await expect(hook(page, 'decision-guidance')).toHaveCount(0);
  await expect(hook(page, 'guidance-profile-help')).toHaveCount(0);
  await hook(page, 'approve').focus();
  await page.keyboard.press('Enter');
  // A second activation delivered before confirmation must not create another command.
  await hook(page, 'approve').dispatchEvent('click');
  await confirm(page);
  await expect.poll(() => state.writes.length).toBe(1);
  await expect(hook(page, 'approve')).toBeDisabled();
  expect(state.writes[0]!.path).toBe(endpoint + '/decision');
  expect(state.writes[0]!.body).toMatchObject({
    contributionId: dossierId,
    obligationId: obligationIds[0],
    expectedVersion: 'a'.repeat(64),
    decision: 'approved',
    confirmed: true
  });
  expect(state.writes[0]!.body.requestId).toBeTruthy();
  await chooseSection(page, 'history');
  await expect(hook(page)).toContainText('synthetic-examination-owner');
  await hook(page, 'back').click();
  await expect(
    page.locator(
      '[data-og7="preflight-desk-filter"][data-og7-id="delivered"] strong'
    )
  ).toHaveText('0');
  expect(state.writes).toHaveLength(1);
});

for (const decision of ['correction_requested', 'rejected'] as const) {
  test(`Preflight examination ${decision} requires a reason and keeps the promised service active`, async ({
    page
  }) => {
    const state = await fixtures(page);
    await page.goto(examinationUrl());
    await hook(page, decision === 'rejected' ? 'reject' : 'correction').click();
    await hook(page, 'submit').click();
    expect(state.writes).toEqual([]);
    await hook(page, 'reason').fill(
      'Ajuster le visuel et préciser le texte préparé.'
    );
    await hook(page, 'submit').click();
    await confirm(page);
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0]!.body).toMatchObject({
      contributionId: dossierId,
      obligationId: obligationIds[0],
      decision,
      reason: 'Ajuster le visuel et préciser le texte préparé.'
    });
    expect(state.receipts[0]!.service.obligationState).toBe('pending');
    expect(state.receipts[0]!.service.proof).toBeNull();
    await chooseSection(page, 'history');
    await expect(hook(page)).toContainText(
      'Ajuster le visuel et préciser le texte préparé.'
    );
    await hook(page, 'back').click();
    await expect(
      page.locator(
        '[data-og7="preflight-desk-filter"][data-og7-id="to_prepare"] strong'
      )
    ).toHaveText('1');
    await expect(
      page.locator(
        '[data-og7="preflight-desk-filter"][data-og7-id="delivered"] strong'
      )
    ).toHaveText('0');
    expect(
      state.writes.every((write) => write.path === endpoint + '/decision')
    ).toBe(true);
  });
}

test('Preflight examination reader can inspect content without decision controls becoming actionable', async ({
  page
}) => {
  const state = await fixtures(page, { role: 'reader' });
  await page.goto(examinationUrl());
  await expect(hook(page, 'preview')).toContainText(webBody);
  for (const name of ['approve', 'correction', 'reject'])
    await expect(hook(page, name)).toBeDisabled();
  await expect(hook(page, 'decision-guidance')).toHaveAttribute(
    'data-reason',
    'readonly'
  );
  await expect(hook(page, 'decision-guidance')).toContainText(
    /consultation|lecteur|lecture seule/i
  );
  await expect(hook(page, 'approve')).toHaveAttribute(
    'aria-describedby',
    'examination-approval-guidance'
  );
  await expect(hook(page, 'guidance-save')).toHaveCount(0);
  await expect(hook(page, 'guidance-resume')).toHaveCount(0);
  await chooseSection(page, 'text');
  await expect(hook(page)).toContainText(
    'Présentation privée proposée pour le site Web.'
  );
  expect(state.writes).toEqual([]);
  expect(state.personalWrites).toEqual([]);
});

test('Preflight examination blocks approval when server checks are incomplete', async ({
  page
}) => {
  const state = await fixtures(page);
  state.receipts[0] = {
    ...state.receipts[0]!,
    status: 'blocked',
    canApprove: false,
    blockers: ['public_consent_missing'],
    checks: [{ code: 'public_consent', state: 'missing' }]
  };
  await page.goto(examinationUrl());
  await expect(hook(page, 'approve')).toBeDisabled();
  await expect(hook(page, 'decision-guidance')).toHaveAttribute(
    'data-reason',
    'incomplete'
  );
  await hook(page, 'guidance-prerequisites').locator('summary').click();
  await expect(
    hook(page, 'approval-reasons').locator(
      '[data-og7-id="public_consent_missing"]'
    )
  ).toContainText(/consentement/i);
  await chooseSection(page, 'checks');
  await expect(hook(page)).toBeVisible();
  expect(state.writes).toEqual([]);
});

for (const [language, width] of [
  ['fr-CA', 390],
  ['en', 1536]
] as const) {
  test(`Preflight explains exact missing preparation conditions beside disabled approval and links its dossier in ${language}`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1100 });
    const state = await fixtures(page, { language });
    const previous = state.receipts[1]!;
    const blockers = [
      'public_consent_missing',
      'sponsor_review_required',
      'moderation_review_required',
      'company_missing',
      'presentation_missing',
      'required_media_missing',
      'service_draft_missing',
      'obligation_blocked'
    ];
    state.receipts[1] = {
      ...previous,
      status: 'not_ready',
      draft: null,
      companyName: null,
      service: {
        ...previous.service,
        companyName: null,
        content: null,
        obligationState: 'blocked'
      },
      dossier: {
        ...previous.dossier,
        drafts: previous.dossier.drafts.filter(
          (draft) => draft.channel !== 'facebook'
        )
      },
      canApprove: false,
      canDecide: false,
      checks: [
        { code: 'payment_confirmed', state: 'complete' },
        { code: 'accepted_offer', state: 'complete' },
        { code: 'public_consent', state: 'missing' },
        { code: 'sponsor_review', state: 'missing' },
        { code: 'moderation_review', state: 'missing' },
        { code: 'draft_moderation_review', state: 'missing' },
        { code: 'service_draft_identified', state: 'missing' }
      ],
      blockers
    };
    await page.goto(examinationUrl(1));
    const decision = page.locator(
      'section[aria-labelledby="examination-decision-title"]'
    );
    const guidance = decision.locator(
      '[data-og7="examination-decision-guidance"]'
    );
    await expect(
      decision.locator('[data-og7="examination-approve"]')
    ).toBeDisabled();
    await expect(guidance).toBeVisible();
    await expect(guidance).toHaveAttribute('data-reason', 'missing-draft');
    await expect(hook(page, 'approve')).toHaveAttribute(
      'aria-describedby',
      'examination-approval-guidance'
    );
    const reasons = guidance.locator(
      '[data-og7="examination-approval-reasons"]'
    );
    const prerequisites = guidance.locator(
      '[data-og7="examination-guidance-prerequisites"]'
    );
    const summary = prerequisites.locator('summary');
    await expect(prerequisites).toHaveJSProperty('open', false);
    await expect(reasons).not.toBeVisible();
    await expect(summary).toContainText(String(blockers.length));
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(prerequisites).toHaveJSProperty('open', true);
    await expect(reasons.locator('li')).toHaveCount(blockers.length);
    const concepts =
      language === 'fr-CA'
        ? [
            /consentement/i,
            /commandit|métier/i,
            /modération|éditorial/i,
            /nom|entreprise|organisation/i,
            /présentation|résumé/i,
            /média|visuel/i,
            /brouillon|proposition/i,
            /prestation.*bloqu|bloqu.*prestation/i
          ]
        : [
            /consent/i,
            /sponsor|business/i,
            /moderation|editorial/i,
            /name|company|organisation/i,
            /presentation|summary/i,
            /media|image/i,
            /draft|proposal/i,
            /service.*blocked|blocked.*service/i
          ];
    for (const [index, code] of blockers.entries()) {
      const reason = reasons.locator(`[data-og7-id="${code}"]`);
      await expect(reason).toBeVisible();
      await expect(reason).toContainText(concepts[index]!);
      await expect(reason).not.toContainText(code);
    }
    await summary.press('Enter');
    await expect(prerequisites).toHaveJSProperty('open', false);
    await expect(reasons).not.toBeVisible();
    const complete = guidance.locator(
      '[data-og7="examination-guidance-dossier"]'
    );
    await expect(complete).toBeVisible();
    await expect(complete).toHaveText(
      language === 'fr-CA' ? /Compléter le dossier/ : /Complete.*dossier/i
    );
    const dossierTarget = new URL(
      previous.links.dossier,
      'https://synthetic.invalid'
    );
    dossierTarget.searchParams.set('tab', 'identity');
    await expect(complete).toHaveAttribute(
      'href',
      dossierTarget.pathname + dossierTarget.search
    );
    const profileHelp = guidance.locator(
      '[data-og7="examination-guidance-profile-help"]'
    );
    await expect(profileHelp).toBeVisible();
    await expect(profileHelp).toContainText(
      language === 'fr-CA' ? /enregistr/i : /sav/i
    );
    await expect(profileHelp).toContainText(
      language === 'fr-CA' ? 'Soumettre mes informations à l’équipe' : /submi/i
    );
    if (language === 'fr-CA')
      await expect(profileHelp).toContainText('ne remplace pas');
    const prepare = guidance.locator(
      '[data-og7="examination-guidance-publication"]'
    );
    await expect(prepare).toHaveAttribute('href', previous.links.delivery!);
    expect(state.writes).toEqual([]);
    expect(state.personalWrites).toEqual([]);
    await expectAdminPageFits(page);
    const axe = await new AxeBuilder({ page })
      .include('[data-og7="examination"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(axe.violations).toEqual([]);
    await captureAdminDesign(
      page,
      testInfo,
      `approval-guidance-${language}`,
      true
    );
  });
}

test('Preflight examination previews qualified website media and links to its single management library', async ({
  page
}) => {
  const state = await fixtures(page, { role: 'reader' });
  state.assets = [mediaAsset(1, true), mediaAsset(2, false)];
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('synthetic.invalid'))
      remoteRequests.push(request.url());
  });
  await page.goto(examinationUrl());
  const image = hook(page, 'preview').getByRole('img', {
    name: 'Photo synthétique 1'
  });
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', /^blob:/);
  expect(
    state.reads
      .filter((url) => url.pathname.includes('/media/content/'))
      .map((url) => url.pathname)
  ).toEqual(['/api/admin/sponsorships/media/content/' + state.assets[0]!.id]);
  await chooseSection(page, 'media');
  await expect(page.locator('[data-og7="media-review-workspace"]')).toHaveCount(
    0
  );
  await expect(page.locator('[data-og7="media-tile"]')).toHaveCount(0);
  await expect(
    page.locator('[data-og7="examination-no-assignment"]')
  ).toBeVisible();
  await expect(
    page.locator('[data-og7="examination-library-asset"]')
  ).toHaveCount(2);
  await expect(page.locator('[data-og7="examination-library"]')).toContainText(
    'synthetic-photo-2.png'
  );
  await expect(
    page.locator('[data-og7="examination-media-owner"]')
  ).toBeVisible();
  expect(remoteRequests).toEqual([]);
  expect(state.writes).toEqual([]);
});

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1536]) {
    test(`Examiner shares exact private gallery assignments, versions and return navigation in ${language} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 960 });
      const state = await fixtures(page, { role: 'reader', language });
      state.receipts[1] = {
        ...state.receipts[1]!,
        service: {
          ...state.receipts[1]!.service,
          format: 'individual_portrait'
        }
      };
      state.assets = Array.from({ length: 20 }, (_, index) => ({
        ...mediaAsset(index + 1, true),
        websiteSelected: false,
        publicUrl: null,
        usage: {
          ...mediaAsset(index + 1, true).usage!,
          channels: ['website', 'facebook'],
          transformations: ['technical', 'portrait']
        }
      }));
      state.preparationAssignments = [0, 1].map((index) => ({
        id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        obligationId: obligationIds[index]!,
        obligationVersion: 1,
        assetId: state.assets[index]!.id,
        assetVersion: state.assets[index]!.version,
        actor: 'synthetic-gallery-reviewer',
        createdAt: at,
        stale: false
      }));
      const remoteRequests: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('synthetic.invalid'))
          remoteRequests.push(request.url());
      });
      await page.goto(examinationUrl());
      await expect(
        hook(page, 'preview').getByRole('img', { name: 'Photo synthétique 1' })
      ).toBeVisible();
      expect(
        state.reads
          .filter((url) => url.pathname.includes('/media/content/'))
          .map((url) => url.pathname.split('/').at(-1))
      ).toEqual([state.assets[0]!.id]);
      await chooseSection(page, 'media');
      await expect(
        page.locator('[data-og7="examination-library-asset"]')
      ).toHaveCount(8);
      await expect(
        page.locator('[data-og7="examination-library-count"]')
      ).toContainText('20');
      await expect(
        page.locator('[data-og7="examination-assigned-asset"]')
      ).toHaveCount(1);
      await expect(
        page.locator('[data-og7="examination-assigned-asset"]')
      ).toHaveAttribute('data-og7-id', state.assets[0]!.id);
      await expect(
        page.locator('[data-og7="media-review-workspace"]')
      ).toHaveCount(0);
      await expectAdminPageFits(page);
      await page.locator('[data-og7="examination-media-owner"]').click();
      await expect(page).toHaveURL(
        new RegExp(
          `/admin/fundraiser/sponsors\\?sponsorshipId=${dossierId}&tab=media#dossier-media-gallery$`
        )
      );
      await page.goBack();
      await expect(hook(page)).toBeVisible();
      await expect(
        hook(page, 'preview').getByRole('img', { name: 'Photo synthétique 1' })
      ).toBeVisible();
      await page.goto(examinationUrl(1));
      await expect(
        hook(page, 'preview').getByRole('img', { name: 'Photo synthétique 2' })
      ).toBeVisible();
      await chooseSection(page, 'media');
      await expect(
        page.locator('[data-og7="examination-assigned-asset"]')
      ).toHaveCount(1);
      await expect(
        page.locator('[data-og7="examination-assigned-asset"]')
      ).toHaveAttribute('data-og7-id', state.assets[1]!.id);
      state.preparationAssignments[0] = {
        ...state.preparationAssignments[0]!,
        stale: true
      };
      await page.goto(examinationUrl());
      await expect(hook(page, 'preview').getByRole('img')).toHaveCount(0);
      await expect(
        page.locator('[data-og7="preflight-preview-media-error"]')
      ).toBeVisible();
      await chooseSection(page, 'media');
      await expect(
        page.locator('[data-og7="examination-assigned-asset"]')
      ).toContainText(
        language === 'en' ? 'Outdated assignment' : 'Affectation obsolète'
      );
      const allowed = new Set(state.assets.map((asset) => asset.id));
      const privateReads = state.reads
        .filter((url) => url.pathname.includes('/media/content/'))
        .map((url) => url.pathname.split('/').at(-1)!);
      expect(privateReads.length).toBeGreaterThan(0);
      expect(privateReads.every((id) => allowed.has(id))).toBe(true);
      expect(remoteRequests).toEqual([]);
      expect(state.writes).toEqual([]);
      expect(state.personalWrites).toEqual([]);
    });
  }
}

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1536]) {
    test(`Examiner browses the complete dossier media library without a service assignment in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize({ width, height: 960 });
      const state = await fixtures(page, {
        role: width === 390 ? 'reader' : 'owner',
        language
      });
      state.assets = Array.from({ length: 20 }, (_, index) => ({
        ...mediaAsset(index + 1, index % 2 === 0),
        websiteSelected: false,
        publicUrl: null
      }));
      const foreign = {
        ...mediaAsset(99, true),
        contributionId: '30000000-0000-4000-8000-000000000099'
      };
      state.assets.push(foreign);
      await page.goto(examinationUrl());
      await expect(hook(page, 'preview').getByRole('img')).toHaveCount(0);
      await chooseSection(page, 'media');
      const library = page.locator('[data-og7="preflight-service-preview"]');
      const cards = library.locator('[data-og7="examination-library-asset"]');
      const count = library.locator('[data-og7="examination-library-count"]');
      await expect(cards).toHaveCount(8);
      await expect(count).toContainText('20');
      await expect(library).toContainText('synthetic-photo-2.png');
      await expect(
        library.locator('[data-og7="examination-no-assignment"]')
      ).toBeVisible();
      await expect(
        library.locator('[data-og7="examination-assigned-asset"]')
      ).toHaveCount(0);
      await expect(
        page.locator('[data-og7="media-review-workspace"]')
      ).toHaveCount(0);
      await expectAdminPageFits(page);
      const axe = await new AxeBuilder({ page })
        .include('[data-og7="examination"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(axe.violations).toEqual([]);
      if (language === 'fr-CA')
        await captureAdminDesign(
          page,
          testInfo,
          `examination-dossier-library-${width}px.fr`,
          true
        );
      await library
        .locator('[data-og7="examination-library-page-size"]')
        .selectOption('25');
      await expect(cards).toHaveCount(20);
      await expect(library).not.toContainText('synthetic-photo-99.png');
      await library
        .locator('[data-og7="examination-library-page-size"]')
        .selectOption('8');
      await library.locator('[data-og7="examination-library-next"]').click();
      await library.locator('[data-og7="examination-library-next"]').click();
      await expect(cards).toHaveCount(4);
      await expect(cards.first()).toHaveAttribute(
        'data-og7-id',
        state.assets[16]!.id
      );
      await library
        .locator('[data-og7="examination-library-search"]')
        .fill('synthetic-photo-20');
      await expect(cards).toHaveCount(1);
      await expect(cards).toHaveAttribute('data-og7-id', state.assets[19]!.id);
      await expect(
        library.locator('[data-og7="examination-library-previous"]')
      ).toBeDisabled();
      await chooseSection(page, 'preview');
      await expect(hook(page, 'preview').getByRole('img')).toHaveCount(0);
      expect(
        state.reads.some((url) => url.pathname.endsWith('/' + foreign.id))
      ).toBe(false);
      expect(state.writes).toEqual([]);
      expect(state.personalWrites).toEqual([]);
    });
  }
}

for (const status of [401, 403]) {
  test(`Examiner purges a previously visible dossier library when access changes to ${status}`, async ({
    page
  }) => {
    const state = await fixtures(page, { role: 'reader' });
    state.assets = [mediaAsset(1, false), mediaAsset(2, true)];
    await page.goto(examinationUrl());
    await chooseSection(page, 'media');
    await expect(
      page.locator('[data-og7="examination-library-asset"]')
    ).toHaveCount(2);
    state.workspaceStatus = status;
    await chooseSection(page, 'preview');
    if (status === 401) await expect(page).toHaveURL(/\/admin\/login(?:\?|$)/);
    else await expect(hook(page, 'error')).toBeVisible();
    await expect(
      page.locator('[data-og7="examination-library-asset"]')
    ).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(
      'synthetic-photo-1.png'
    );
    expect(state.writes).toEqual([]);
    expect(state.personalWrites).toEqual([]);
  });
}

for (const theme of ['mineral', 'night', 'graphite'] as const) {
  for (const { language, width } of [
    { language: 'en', width: 390 },
    { language: 'fr-CA', width: 1536 }
  ] as const) {
    test(`Examiner preserves readable contrast across media, decisions and errors in ${theme} at ${width}px`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const state = await fixtures(page, { language, theme });
      const previous = state.receipts[1]!;
      state.receipts[1] = {
        ...previous,
        status: 'not_ready',
        companyName: null,
        draft: null,
        service: { ...previous.service, companyName: null, content: null },
        dossier: {
          ...previous.dossier,
          drafts: previous.dossier.drafts.filter(
            (draft) => draft.channel !== 'facebook'
          )
        },
        blockers: ['service_draft_missing', 'company_missing'],
        checks: [
          { code: 'payment_confirmed', state: 'complete' },
          { code: 'accepted_offer', state: 'complete' },
          { code: 'service_draft_identified', state: 'missing' }
        ],
        canApprove: false,
        canDecide: false
      };
      state.assets = [
        mediaAsset(1, true),
        mediaAsset(2, false),
        mediaAsset(3, true)
      ];
      await page.goto(examinationUrl(1));
      await expect(page.locator('html')).toHaveAttribute(
        'data-og7-pilot-theme',
        theme
      );
      await expect(hook(page, 'approve')).toBeDisabled();
      const ratios: Record<string, number> = {};
      ratios.title = await expectReadableColor(
        hook(page).getByRole('heading', { level: 1 })
      );
      ratios.organization = await expectReadableColor(
        hook(page).locator('header').first().locator('p').first()
      );
      ratios.back = await expectReadableColor(hook(page, 'back'));
      const summary = page.locator(
        'section[aria-labelledby="examination-summary-title"]'
      );
      ratios.summary = await expectReadableColor(summary.locator('p').first());
      ratios.status = await expectReadableColor(hook(page, 'status'));
      ratios.guidance = await expectReadableColor(
        hook(page, 'decision-guidance').locator('p').first()
      );
      await chooseSection(page, 'media');
      const library = page.locator('[data-og7="preflight-service-preview"]');
      await expect(
        library.locator('[data-og7="examination-library-asset"]')
      ).toHaveCount(3);
      ratios.libraryHelp = await expectReadableColor(
        library.locator('p').first()
      );
      ratios.libraryCount = await expectReadableColor(
        library.locator('[data-og7="examination-library-count"]')
      );
      const firstAsset = library
        .locator('[data-og7="examination-library-asset"]')
        .first();
      ratios.filename = await expectReadableColor(firstAsset.locator('strong'));
      ratios.metadata = await expectReadableColor(
        firstAsset.locator('p').first()
      );
      const search = library.locator('[data-og7="examination-library-search"]');
      await search.fill('synthetic-photo-2');
      ratios.input = await expectReadableColor(search);
      ratios.inputBorder = await expectReadableColor(
        search,
        'borderTopColor',
        3
      );
      await search.focus();
      await expect(search).toBeFocused();
      await expect(search).toHaveCSS('outline-style', 'solid');
      await expect(search).toHaveCSS('outline-width', '3px');
      ratios.inputFocus = await expectReadableColor(search, 'outlineColor', 3);
      await expectAdminPageFits(page);
      const mediaAxe = await new AxeBuilder({ page })
        .include('[data-og7="examination"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(mediaAxe.violations).toEqual([]);
      await captureAdminDesign(
        page,
        testInfo,
        `examination-contrast-${theme}-${width}`,
        true
      );
      await page.goto(examinationUrl());
      await expect(hook(page, 'approve')).toBeEnabled();
      for (const action of ['approve', 'correction', 'reject'])
        ratios[action] = await expectReadableColor(hook(page, action));
      const publicCard = page.locator('openg7-sponsor-presentation-card');
      await expect(publicCard).toHaveCSS(
        'background-color',
        'rgb(255, 255, 255)'
      );
      await expect(publicCard).toHaveCSS('color', 'rgb(23, 43, 80)');
      await expect(publicCard).toHaveCSS('color-scheme', 'light');
      const readyAxe = await new AxeBuilder({ page })
        .include('[data-og7="examination"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(readyAxe.violations).toEqual([]);
      state.readStatus = 503;
      await page.goto(examinationUrl());
      await expect(hook(page, 'error')).toBeVisible();
      ratios.errorTitle = await expectReadableColor(
        hook(page, 'error').getByRole('heading')
      );
      ratios.errorText = await expectReadableColor(
        hook(page, 'error').locator('p').first()
      );
      await testInfo.attach('rendered-contrast', {
        body: Buffer.from(JSON.stringify({ theme, width, language, ratios })),
        contentType: 'application/json'
      });
      expect(state.writes).toEqual([]);
      expect(state.personalWrites).toEqual([]);
    });
  }
}

test('Preflight examination keeps a failed decision uncertain and never automatically repeats it', async ({
  page
}) => {
  const state = await fixtures(page);
  state.decisionStatus = 503;
  state.decisionCode = 'RUN_UNAVAILABLE';
  await page.goto(examinationUrl());
  await hook(page, 'approve').click();
  await confirm(page);
  await expect(hook(page).getByRole('alert').first()).toBeVisible();
  await expect(hook(page, 'approve')).toBeDisabled();
  await expect(hook(page, 'decision-guidance')).toHaveAttribute(
    'data-reason',
    'uncertain'
  );
  await expect(hook(page, 'guidance-refresh')).toBeVisible();
  await hook(page, 'guidance-refresh').click();
  await expect(hook(page, 'approve')).toBeDisabled();
  await chooseSection(page, 'history');
  await expect(hook(page, 'history-entry')).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.receipts[0]!.status).toBe('ready');
});

test('Preflight examination rejects a stale decision and refreshes explicitly before another decision', async ({
  page
}) => {
  const state = await fixtures(page);
  state.decisionStatus = 409;
  state.decisionCode = 'PREPARATION_VERSION_CONFLICT';
  await page.goto(examinationUrl());
  await hook(page, 'approve').click();
  await confirm(page);
  await expect.poll(() => state.writes.length).toBe(1);
  await expect(hook(page).getByRole('alert').first()).toBeVisible();
  await expect(hook(page, 'approve')).toBeDisabled();
  await expect(hook(page, 'decision-guidance')).toHaveAttribute(
    'data-reason',
    'stale'
  );
  state.receipts[0] = {
    ...state.receipts[0]!,
    version: 'd'.repeat(64),
    contentVersion: 'e'.repeat(64),
    status: 'review_required'
  };
  state.decisionStatus = 200;
  await hook(page, 'guidance-refresh').click();
  await expect(hook(page, 'approve')).toBeEnabled();
  await hook(page, 'approve').click();
  await confirm(page);
  await expect.poll(() => state.writes.length).toBe(2);
  expect(state.writes[1]!.body.expectedVersion).toBe('d'.repeat(64));
});

for (const status of [401, 403, 404, 503]) {
  test(`Preflight examination handles a ${status} read without displaying another service or writing`, async ({
    page
  }) => {
    const state = await fixtures(page);
    state.readStatus = status;
    await page.goto(examinationUrl());
    if (status === 401) await expect(page).toHaveURL(/\/admin\/login\?/);
    else await expect(hook(page).getByRole('alert').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('SYNTHETIC WEB TITLE');
    expect(state.writes).toEqual([]);
  });
}

test('Preflight examination never substitutes another obligation for an unknown exact identifier', async ({
  page
}) => {
  const state = await fixtures(page);
  await page.goto(
    examinationUrl().replace(
      obligationIds[0],
      '20000000-0000-4000-8000-999999999999'
    )
  );
  await expect(hook(page).getByRole('alert').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('SYNTHETIC WEB TITLE');
  expect(state.writes).toEqual([]);
});

test('Preflight examination ignores a late receipt from a previously selected obligation', async ({
  page
}) => {
  const state = await fixtures(page);
  state.readDelay.set(obligationIds[0], 700);
  await page.goto(examinationUrl());
  await expect
    .poll(() => state.reads.some((url) => url.pathname === endpoint))
    .toBe(true);
  await page.evaluate((destination) => {
    history.pushState({}, '', destination);
    dispatchEvent(new PopStateEvent('popstate'));
  }, examinationUrl(1));
  await expect(hook(page, 'preview')).toContainText('SYNTHETIC FACEBOOK TITLE');
  await expect.poll(() => state.settledReads.length).toBe(2);
  await expect(hook(page, 'preview')).toContainText('SYNTHETIC FACEBOOK TITLE');
  await expect(page.locator('body')).not.toContainText(webBody);
  expect(state.writes).toEqual([]);
});

test('Preflight examination requires an explicit refresh for a version changed since its link was opened', async ({
  page
}) => {
  const state = await fixtures(page);
  state.receipts[0] = {
    ...state.receipts[0]!,
    version: 'f'.repeat(64),
    contentVersion: 'e'.repeat(64),
    status: 'review_required'
  };
  await page.goto(examinationUrl());
  await expect(hook(page, 'stale')).toBeVisible();
  await expect(hook(page, 'approve')).toBeDisabled();
  await hook(page, 'refresh').click();
  await expect(hook(page, 'approve')).toBeEnabled();
  expect(new URL(page.url()).searchParams.get('preparationVersion')).toBe(
    'f'.repeat(64)
  );
  expect(state.writes).toEqual([]);
});

test('Preflight examination rejects incomplete or malformed identifiers locally without reading or deciding a service', async ({
  page
}) => {
  const state = await fixtures(page);
  const incomplete = new URL(examinationUrl(), 'http://127.0.0.1');
  incomplete.searchParams.delete('obligationId');
  const malformed = new URL(examinationUrl(), 'http://127.0.0.1');
  malformed.searchParams.set('sponsorshipId', 'invalid-sponsorship');
  for (const destination of [incomplete, malformed]) {
    await page.goto(destination.pathname + destination.search);
    await expect(hook(page)).toHaveAttribute('data-state', 'not_found');
    await expect(hook(page).getByRole('alert').first()).toBeVisible();
    await expect(hook(page, 'approve')).toHaveCount(0);
  }
  expect(state.reads.filter((url) => url.pathname === endpoint)).toEqual([]);
  expect(state.writes).toEqual([]);
});

for (const language of ['fr-CA', 'en'] as const) {
  for (const width of [390, 1536]) {
    test(`Guided preparation records only documented public-profile consent after validation and confirmation in ${language} at ${width}px`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1100 });
      const graphite = language === 'en' && width === 1536;
      const state = await fixtures(page, {
        language,
        ...(graphite ? { theme: 'graphite' as const } : {})
      });
      missingConsent(state);
      state.consentPostDelay = 150;
      await page.goto(examinationUrl());
      await openConsent(page);
      await expect(consentControl(page, 'scope')).toContainText(
        language === 'fr-CA' ? /nom.*présentation/i : /name.*presentation/i
      );
      await expect(consentControl(page, 'actor')).toContainText(consentActor);
      await expect(consentControl(page, 'submit')).toBeDisabled();
      await consentControl(page, 'agreement').check();
      await expect(consentControl(page, 'submit')).toBeDisabled();
      await consentControl(page, 'date').fill('2026-11-04');
      await expect(consentControl(page, 'submit')).toBeDisabled();
      await consentControl(page, 'evidence').fill('   ');
      await expect(consentControl(page, 'submit')).toBeDisabled();
      await consentControl(page, 'evidence').fill(consentEvidence);
      await consentControl(page, 'date').fill('2099-01-01');
      await expect(consentControl(page, 'submit')).toBeDisabled();
      await consentControl(page, 'date').fill('2026-11-04');
      await expect(consentControl(page, 'submit')).toBeEnabled();
      expect(state.consentPosts).toEqual([]);
      expect(state.writes).toEqual([]);
      if (graphite) {
        const ratios = {
          scopeTitle: await expectReadableColor(
            consentControl(page, 'scope').getByRole('heading')
          ),
          scopeText: await expectReadableColor(
            consentControl(page, 'scope').locator('p').first()
          ),
          actor: await expectReadableColor(consentControl(page, 'actor')),
          date: await expectReadableColor(consentControl(page, 'date')),
          evidence: await expectReadableColor(consentControl(page, 'evidence')),
          inputBorder: await expectReadableColor(
            consentControl(page, 'evidence'),
            'borderTopColor',
            3
          )
        };
        await testInfo.attach('documented-consent-graphite-contrast', {
          body: Buffer.from(JSON.stringify(ratios, null, 2)),
          contentType: 'application/json'
        });
      }
      await expectAdminPageFits(page);
      const consentAxe = await new AxeBuilder({ page })
        .include('[data-og7="examination-consent"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(consentAxe.violations).toEqual([]);
      await captureAdminDesign(
        page,
        testInfo,
        `documented-consent-filled-${language}-${width}`,
        true
      );
      await consentControl(page, 'submit').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-og7="confirm-action"]')).toBeVisible();
      expect(state.consentPosts).toEqual([]);
      await consentControl(page, 'submit').dispatchEvent('click');
      await confirm(page);
      await expect.poll(() => state.consentPosts.length).toBe(1);
      const command = state.consentPosts[0]!;
      expect(command).toEqual({
        contributionId: dossierId,
        expectedVersion: 'synthetic-consent-v1',
        requestId: expect.stringMatching(
          /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
        ),
        agreementReceived: true,
        scope: consentScope,
        agreedOn: '2026-11-04',
        evidenceReference: consentEvidence,
        confirmed: true
      });
      await expect
        .poll(() =>
          state.consentReads.some(
            (url) =>
              url.pathname === consentEndpoint + '/receipt' &&
              url.searchParams.get('sponsorshipId') === dossierId &&
              url.searchParams.get('requestId') === command.requestId
          )
        )
        .toBe(true);
      await expect
        .poll(() => new URL(page.url()).searchParams.get('preparationVersion'))
        .toBe('d'.repeat(64));
      await expect(hook(page, 'approve')).toBeDisabled();
      const checks = hook(page, 'guided-preparation');
      await expect(
        checks.locator(
          '[data-og7="examination-guided-check"][data-og7-id="public_consent"]'
        )
      ).toHaveAttribute('data-state', 'complete');
      for (const code of [
        'sponsor_review',
        'moderation_review',
        'draft_moderation_review'
      ])
        await expect(
          checks.locator(
            `[data-og7="examination-guided-check"][data-og7-id="${code}"]`
          )
        ).toHaveAttribute('data-state', 'missing');
      expect(state.consentPosts).toHaveLength(1);
      expect(state.consentReceipts.get(command.requestId)).toMatchObject({
        publicVisibilityHeld: true,
        effectiveConsent: true
      });
      expect(state.writes).toEqual([]);
      expect(state.personalWrites).toEqual([]);
      await expectAdminPageFits(page);
      await captureAdminDesign(
        page,
        testInfo,
        `guided-consent-${language}-${width}`,
        true
      );
    });
  }
}

for (const [language, width] of [
  ['fr-CA', 390],
  ['en', 1536]
] as const) {
  test(`Guided preparation keeps exact source checks and native owner destinations in ${language}`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const state = await fixtures(page, { language });
    missingConsent(state, 'owner', 1);
    const original = state.receipts[1]!;
    const exactDraft = {
      ...original.draft!,
      id: '60000000-0000-4000-8000-000000000001'
    };
    state.receipts[1] = {
      ...original,
      draft: exactDraft,
      dossier: {
        ...original.dossier,
        drafts: original.dossier.drafts.map((draft) =>
          draft.id === original.draft!.id ? exactDraft : draft
        )
      }
    };
    await page.goto(examinationUrl(1));
    await hook(page, 'guided-open').click();
    const guided = hook(page, 'guided-preparation');
    await expect(guided).toBeVisible();
    for (const check of state.receipts[1]!.checks) {
      const row = guided.locator(
        `[data-og7="examination-guided-check"][data-og7-id="${check.code}"]`
      );
      await expect(row).toHaveCount(1);
      await expect(row).toHaveAttribute('data-state', check.state);
      await expect(row).not.toContainText(check.code);
    }
    for (const [code, tab, fragment] of [
      ['payment_confirmed', 'billing', 'dossier-billing'],
      ['accepted_offer', 'publication', 'dossier-agreement'],
      ['sponsor_review', 'overview', 'dossier-review'],
      ['moderation_review', 'overview', 'dossier-review']
    ]) {
      const action = guided.locator(
        `[data-og7="examination-check-action"][data-og7-id="${code}"]`
      );
      const href = await action.getAttribute('href');
      expect(href).toBeTruthy();
      const target = new URL(href!, page.url());
      expect(target.pathname).toBe('/admin/fundraiser/sponsors');
      expect(target.searchParams.get('sponsorshipId')).toBe(dossierId);
      expect(target.searchParams.get('tab')).toBe(tab);
      expect(target.hash).toBe('#' + fragment);
    }
    await guided
      .locator(
        '[data-og7="examination-check-action"][data-og7-id="draft_moderation_review"]'
      )
      .click();
    await expect(hook(page, 'text-review')).toBeVisible();
    await expect(hook(page, 'text-review')).toHaveAttribute(
      'data-og7-id',
      exactDraft.id
    );
    expect(state.writes).toEqual([]);
    expect(state.consentPosts).toEqual([]);
    await expectAdminPageFits(page);
  });

  test(`Guided preparation reader sees missing consent without recording controls or private evidence in ${language}`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const state = await fixtures(page, { language, role: 'reader' });
    missingConsent(state, 'reader');
    await page.goto(examinationUrl());
    await openConsent(page);
    await expect(consentControl(page, 'scope')).toBeVisible();
    await expect(consentControl(page, 'agreement')).toHaveCount(0);
    await expect(consentControl(page, 'submit')).toHaveCount(0);
    await expect(consentControl(page, 'actor')).toHaveCount(0);
    await expect(consentControl(page, 'history')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(consentEvidence);
    await expect(page.locator('body')).not.toContainText(consentActor);
    await expect(hook(page, 'approve')).toBeDisabled();
    expect(state.consentPosts).toEqual([]);
    expect(state.writes).toEqual([]);
  });
}

test('Documented consent conflict requires an explicit refresh and a newly confirmed exact version', async ({
  page
}) => {
  const state = await fixtures(page);
  missingConsent(state);
  state.consentPostStatus = 409;
  state.consentPostCode = 'CONSENT_VERSION_CONFLICT';
  await page.goto(examinationUrl());
  await openConsent(page);
  await fillConsent(page);
  await consentControl(page, 'submit').click();
  const readsBefore = state.consentReads.length;
  await confirm(page);
  await expect(consentControl(page, 'notice')).toBeVisible();
  await expect(consentControl(page, 'refresh')).toBeVisible();
  expect(state.consentPosts).toHaveLength(1);
  expect(state.consentReads).toHaveLength(readsBefore);
  await expect(consentControl(page, 'evidence')).toHaveValue(consentEvidence);
  state.consent = {
    ...state.consent,
    version: 'synthetic-consent-conflict-v2'
  };
  state.consentPostStatus = 200;
  await consentControl(page, 'refresh').click();
  await expect
    .poll(() => state.consentReads.length)
    .toBeGreaterThan(readsBefore);
  await expect(consentControl(page, 'submit')).toBeEnabled();
  expect(state.consentPosts).toHaveLength(1);
  await consentControl(page, 'submit').click();
  expect(state.consentPosts).toHaveLength(1);
  await confirm(page);
  await expect.poll(() => state.consentPosts.length).toBe(2);
  expect(state.consentPosts[1]!.expectedVersion).toBe(
    'synthetic-consent-conflict-v2'
  );
  expect(state.consentPosts[1]!.requestId).not.toBe(
    state.consentPosts[0]!.requestId
  );
  expect(state.writes).toEqual([]);
});

test('Documented consent reconciles a 503 after application through an explicit receipt read without repeating POST', async ({
  page
}) => {
  const state = await fixtures(page);
  missingConsent(state);
  state.consentPostStatus = 503;
  state.consentApplyBeforeError = true;
  await page.goto(examinationUrl());
  await openConsent(page);
  await fillConsent(page);
  await consentControl(page, 'submit').click();
  await confirm(page);
  await expect(consentControl(page, 'check-receipt')).toBeVisible();
  expect(state.consentPosts).toHaveLength(1);
  expect(
    state.consentReads.filter((url) => url.pathname.endsWith('/receipt'))
  ).toEqual([]);
  const requestId = state.consentPosts[0]!.requestId;
  expect(state.consentReceipts.has(requestId)).toBe(true);
  await consentControl(page, 'check-receipt').click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('preparationVersion'))
    .toBe('d'.repeat(64));
  const reconciliation = state.consentReads.filter((url) =>
    url.pathname.endsWith('/receipt')
  );
  expect(reconciliation).toHaveLength(1);
  expect(reconciliation[0]!.searchParams.get('sponsorshipId')).toBe(dossierId);
  expect(reconciliation[0]!.searchParams.get('requestId')).toBe(requestId);
  expect(state.consentPosts).toHaveLength(1);
  await expect(hook(page, 'approve')).toBeDisabled();
  expect(state.writes).toEqual([]);
});

for (const status of [401, 403]) {
  for (const phase of ['read', 'record', 'receipt'] as const) {
    test(`Documented consent purges private form and service content after ${phase} denies access with ${status}`, async ({
      page
    }) => {
      const state = await fixtures(page);
      missingConsent(state);
      if (phase === 'read') state.consentReadStatus = status;
      await page.goto(examinationUrl());
      if (phase !== 'read') {
        await openConsent(page);
        await fillConsent(page);
        state.consentPostStatus = phase === 'record' ? status : 503;
        state.consentReceiptStatus = status;
        await consentControl(page, 'submit').click();
        await confirm(page);
        if (phase === 'receipt')
          await consentControl(page, 'check-receipt').click();
      } else {
        await hook(page, 'guided-open').click();
        await hook(page, 'consent-open').click();
      }
      if (status === 401) await expect(page).toHaveURL(/\/admin\/login\?/);
      else await expect(hook(page)).toHaveAttribute('data-state', 'forbidden');
      await expect(consentControl(page, 'evidence')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(consentEvidence);
      await expect(page.locator('body')).not.toContainText(
        'SYNTHETIC WEB TITLE'
      );
      expect(state.consentPosts).toHaveLength(phase === 'read' ? 0 : 1);
      expect(state.writes).toEqual([]);
    });
  }
}

for (const blocker of [
  'operation_processing',
  'operation_uncertain'
] as const) {
  test(`Documented consent respects the server ${blocker} hold without authorizing a retry`, async ({
    page
  }) => {
    const state = await fixtures(page);
    missingConsent(state);
    state.consent = {
      ...state.consent,
      canRecord: false,
      recordBlockers: [blocker]
    };
    await page.goto(examinationUrl());
    await openConsent(page);
    await expect(hook(page, 'consent')).toContainText(
      blocker === 'operation_processing' ? /en cours/i : /incertain/i
    );
    await expect(
      page.locator('[data-og7="examination-consent-submit"]:enabled')
    ).toHaveCount(0);
    await expect(hook(page, 'approve')).toBeDisabled();
    expect(state.consentPosts).toEqual([]);
    expect(state.writes).toEqual([]);
  });
}

test('Documented consent ignores a late private response after leaving its exact dossier', async ({
  page
}) => {
  const state = await fixtures(page);
  missingConsent(state);
  state.consentReadDelay = 700;
  state.consent = {
    ...state.consent,
    version: 'synthetic-consent-v2',
    effectiveConsent: true,
    source: 'documented_agreement',
    canRecord: false,
    recordBlockers: ['already_granted'],
    history: [
      {
        id: '70000000-0000-4000-8000-000000000002',
        agreedOn: '2026-11-04',
        evidenceReference: consentEvidence,
        recordedAt: at,
        actor: consentActor
      }
    ]
  };
  await page.goto(examinationUrl());
  await hook(page, 'guided-open').click();
  await hook(page, 'consent-open').click();
  await expect.poll(() => state.consentReads.length).toBe(1);
  await page.evaluate(
    (destination) => {
      history.pushState({}, '', destination);
      dispatchEvent(new PopStateEvent('popstate'));
    },
    examinationUrl().replace(dossierId, contributionId(2))
  );
  await expect(hook(page)).toHaveAttribute('data-state', 'not_found');
  await expect.poll(() => state.settledConsentReads.length).toBe(1);
  await expect(hook(page, 'consent')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(consentEvidence);
  await expect(page.locator('body')).not.toContainText(consentActor);
  expect(state.consentPosts).toEqual([]);
  expect(state.writes).toEqual([]);
});

for (const [language, width, role] of [
  ['fr-CA', 390, 'owner'],
  ['en', 1536, 'operator']
] as const) {
  test(`Public consent request requires reviewed delivery and leaves consent missing in ${language} at ${width}px`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const state = await fixtures(page, { language, role });
    missingConsent(state);
    const requests = await consentRequestFixtures(page, state, language);
    const english = language === 'en';
    await page.goto(examinationUrl());
    await hook(page, 'guided-open').click();
    const opener = hook(page, 'consent-request-open');
    await opener.focus();
    await page.keyboard.press('Enter');
    const panel = hook(page, 'consent-request');
    const drawer = page.getByRole('dialog', {
      name: english
        ? 'Request public consent'
        : 'Demander le consentement public',
      exact: true
    });
    await expect(panel).toBeVisible();
    const form = panel.locator('[data-og7="assistant-information-form"]');
    await expect(form).toBeVisible();
    expect(
      requests.contextReads.map((url) => url.searchParams.get('sponsorshipId'))
    ).toEqual([dossierId]);
    expect(requests.preparations).toEqual([
      { type: 'sponsorship_consent_request', reference: dossierId, language }
    ]);
    const recipient = form.getByLabel(english ? 'Recipient' : 'Destinataire', {
      exact: true
    });
    await expect(recipient).toHaveValue(requests.recipient);
    await expect(recipient).toHaveAttribute('readonly', '');
    await expect(form.getByLabel('Message', { exact: true })).toHaveValue(
      requests.body
    );
    expect(requests.posts).toEqual([]);
    expect(state.consentPosts).toEqual([]);
    const customMessage = english
      ? 'Synthetic request: do you agree to the public use of your organization name and presentation? Please reply explicitly.'
      : 'Demande synthétique : acceptez-vous l’utilisation publique du nom et de la présentation de votre organisation ? Merci de répondre explicitement.';
    await form.getByLabel('Message', { exact: true }).fill(customMessage);
    const review = form.getByRole('button', {
      name: english ? 'Review delivery' : 'Vérifier l’envoi',
      exact: true
    });
    await review.focus();
    await page.keyboard.press('Enter');
    const confirmation = page.getByRole('dialog', {
      name: english
        ? 'Confirm information request'
        : 'Confirmer la demande d’informations',
      exact: true
    });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(requests.recipient);
    await expect(confirmation).toContainText(customMessage);
    expect(requests.posts).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(confirmation).not.toBeVisible();
    await expect(drawer).toBeVisible();
    await expect(review).toBeFocused();
    expect(requests.posts).toEqual([]);
    await review.click();
    await confirmation
      .getByRole('button', {
        name: english ? 'Confirm delivery' : 'Confirmer l’envoi',
        exact: true
      })
      .click();
    await expect(
      panel.locator('[data-og7="assistant-information-receipt"]')
    ).toBeVisible();
    expect(requests.posts).toEqual([
      {
        contributionId: dossierId,
        contextVersion: 'a'.repeat(64),
        recipient: requests.recipient,
        subject: requests.subject,
        body: customMessage,
        purpose: 'public_consent',
        requestId: expect.stringMatching(
          /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
        ),
        confirmed: true
      }
    ]);
    await expectAdminPageFits(page);
    const accessibility = await new AxeBuilder({ page })
      .include('[data-og7="examination-consent-request"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await drawer
      .getByRole('button', {
        name: english ? 'Close' : 'Fermer',
        exact: true
      })
      .click();
    await expect(panel).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(
      hook(page, 'guided-preparation').locator(
        '[data-og7="examination-guided-check"][data-og7-id="public_consent"]'
      )
    ).toHaveAttribute('data-state', 'missing');
    await expect(hook(page, 'approve')).toBeDisabled();
    expect(state.consent.effectiveConsent).toBe(false);
    expect(state.consentPosts).toEqual([]);
    expect(state.writes).toEqual([]);
    expect(state.personalWrites).toEqual([]);
  });
}

test('Public consent request reconciles an uncertain delivery through its receipt without repeating POST', async ({
  page
}) => {
  const state = await fixtures(page);
  missingConsent(state);
  const requests = await consentRequestFixtures(page, state);
  requests.sendStatus = 503;
  requests.receiptFound = true;
  await page.goto(examinationUrl());
  await hook(page, 'guided-open').click();
  await hook(page, 'consent-request-open').click();
  const panel = hook(page, 'consent-request');
  await panel
    .getByRole('button', { name: 'Vérifier l’envoi', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirmer l’envoi', exact: true })
    .click();
  await expect(
    panel.locator('[data-og7="assistant-information-uncertain"]')
  ).toBeVisible();
  expect(requests.posts).toHaveLength(1);
  expect(requests.receiptReads).toEqual([]);
  await expect(
    panel.getByRole('button', { name: 'Vérifier l’envoi', exact: true })
  ).toBeDisabled();
  await panel
    .locator('[data-og7="assistant-information-receipt-check"]')
    .click();
  const receipt = panel.locator('[data-og7="assistant-information-receipt"]');
  await expect(receipt).toBeVisible();
  await expect(receipt).toBeFocused();
  expect(requests.receiptReads).toHaveLength(1);
  expect(requests.receiptReads[0]!.searchParams.get('requestId')).toBe(
    requests.posts[0]!.requestId
  );
  expect(requests.receiptReads[0]!.searchParams.get('contributionId')).toBe(
    dossierId
  );
  expect(requests.posts).toHaveLength(1);
  expect(state.consentPosts).toEqual([]);
  expect(state.consent.effectiveConsent).toBe(false);
  expect(state.writes).toEqual([]);
});

test('Public consent request preparation failure exposes no sending form or consent mutation', async ({
  page
}) => {
  const state = await fixtures(page);
  missingConsent(state);
  const requests = await consentRequestFixtures(page, state);
  requests.prepareStatus = 503;
  await page.goto(examinationUrl());
  await hook(page, 'guided-open').click();
  await hook(page, 'consent-request-open').click();
  const panel = hook(page, 'consent-request');
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(
    panel.locator('[data-og7="assistant-information-form"]')
  ).toHaveCount(0);
  expect(requests.posts).toEqual([]);
  expect(state.consentPosts).toEqual([]);
  expect(state.writes).toEqual([]);
});

test('Public consent contact action is absent for readers', async ({
  page
}) => {
  const state = await fixtures(page, { role: 'reader' });
  missingConsent(state, 'reader');
  const requests = await consentRequestFixtures(page, state);
  await page.goto(examinationUrl());
  await hook(page, 'guided-open').click();
  await expect(hook(page, 'consent-open')).toBeVisible();
  await expect(hook(page, 'consent-request-open')).toHaveCount(0);
  expect(requests.contextReads).toEqual([]);
  expect(requests.preparations).toEqual([]);
  expect(requests.posts).toEqual([]);
  expect(state.consentPosts).toEqual([]);
});

test('Public consent contact action is absent when consent is already recorded', async ({
  page
}) => {
  const state = await fixtures(page);
  state.receipts[0] = {
    ...state.receipts[0]!,
    checks: [
      ...state.receipts[0]!.checks,
      { code: 'public_consent', state: 'complete' }
    ]
  };
  const requests = await consentRequestFixtures(page, state);
  await page.goto(examinationUrl());
  await hook(page, 'guided-open').click();
  await expect(hook(page, 'consent-open')).toBeVisible();
  await expect(hook(page, 'consent-request-open')).toHaveCount(0);
  expect(requests.contextReads).toEqual([]);
  expect(requests.preparations).toEqual([]);
  expect(requests.posts).toEqual([]);
  expect(state.consentPosts).toEqual([]);
});
