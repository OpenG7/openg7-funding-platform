import type { Page } from '@playwright/test';
import type {
  SponsorshipCommitmentQualificationRequest,
  SponsorshipHistoricalAuditReviewRequest,
  SponsorMediaBatchPlan,
  SponsorMediaBatchPlanRequest,
  SponsorMediaWorkspaceAsset
} from '@openg7/funding-core';

import { expect, test } from './support/test.js';
import {
  adminController,
  type AdminController
} from './support/admin-controller.js';
import {
  controllerJourneysFixtures,
  controllerId as id,
  controllerAssetId as assetId,
  controllerObligationId as obligationId,
  controllerPath as path
} from './support/controller-journeys.fixtures.js';

test.setTimeout(180_000);
const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);
const writes = (
  state: Awaited<ReturnType<typeof controllerJourneysFixtures>>,
  suffix: string
) => state.commands.filter((command) => command.path.endsWith(suffix));

async function moderation(
  page: Page,
  pad: AdminController,
  adverse = false,
  reason = 'MISLEADING_CLAIM'
) {
  const panel = hook(page, 'moderation-decision');
  await expect(panel).toBeVisible();
  await expect(
    panel.locator('[data-og7="moderation-confirmation"]')
  ).toBeVisible();
  if (adverse) {
    await pad.select(
      panel.locator('[data-og7="moderation-primary-reason"]'),
      reason
    );
    await pad.text(
      panel.locator('[data-og7="moderation-internal-reason"]'),
      'Private test'
    );
    await pad.text(
      panel.locator('[data-og7="moderation-explanation"]'),
      'Please revise'
    );
  }
  await pad.activate(panel.locator('[data-og7="moderation-confirmation"]'));
  await pad.activate(panel.locator('[data-og7="moderation-submit"]'));
  await expect(panel).toHaveCount(0);
}

test('Xbox inputs edit identity, cancel sensitive confirmation and save only after a fresh press', async ({
  page
}) => {
  const state = await controllerJourneysFixtures(page);
  const pad = adminController(page);
  await page.goto(path('identity'));
  await pad.activate(hook(page, 'edit-dossier'));
  const form = hook(page, 'edit-dossier-form');
  const company = form.locator('[name="companyName"]');
  await pad.text(company, 'Atelier test');
  await pad.text(form.locator('[name="contactEmail"]'), 'test@example.test');
  await pad.select(form.locator('[name="reason"]'), 'contact_update');
  const save = form.getByRole('button', { name: 'Save changes', exact: true });
  await pad.reach(save);
  await pad.hold('A');
  await expect(hook(page, 'confirm-action')).toBeVisible();
  expect(writes(state, '/details')).toHaveLength(0);
  await pad.hold('A');
  expect(writes(state, '/details')).toHaveLength(0);
  await pad.release();
  await pad.press('B');
  await expect(hook(page, 'confirm-action')).toHaveCount(0);
  await expect(company).toHaveValue('Atelier test');
  expect(writes(state, '/details')).toHaveLength(0);
  await pad.activate(save);
  await pad.activate(hook(page, 'confirm-action'));
  await expect.poll(() => writes(state, '/details').length).toBe(1);
  expect(writes(state, '/details')[0]!.body).toMatchObject({
    contributionId: id,
    expectedVersion: 'v1',
    confirmed: true,
    companyName: 'Atelier test',
    contactEmail: 'test@example.test',
    reason: 'contact_update'
  });
  await expect(form).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Atelier test', exact: true })
  ).toBeVisible();
});

test('Xbox editor and select cancellation preserve identity and never submit the form', async ({
  page
}) => {
  const state = await controllerJourneysFixtures(page);
  const pad = adminController(page);
  await page.goto(path('identity'));
  await pad.activate(hook(page, 'edit-dossier'));
  const form = hook(page, 'edit-dossier-form');
  const company = form.locator('[name="companyName"]');
  await pad.activate(company);
  await pad.activate(hook(page, 'editor-clear'));
  await pad.activate(page.locator('[data-og7="editor-key"][data-og7-id="x"]'));
  await pad.press('B');
  await expect(hook(page, 'controller-editor')).not.toBeVisible();
  await expect(company).toHaveValue('Xbox fixture');
  const reason = form.locator('[name="reason"]');
  await pad.activate(reason);
  await pad.activate(
    page.locator('[data-og7="controller-select-option"][data-og7-id="1"]')
  );
  await reason.evaluate((element) => {
    (element as HTMLElement).style.visibility = 'hidden';
  });
  await pad.activate(hook(page, 'controller-select-apply'));
  await expect(hook(page, 'controller-select-error')).toBeVisible();
  await expect(reason).toHaveValue('correction');
  await pad.press('B');
  await expect(hook(page, 'controller-select')).toHaveCount(0);
  await reason.evaluate((element) => {
    (element as HTMLElement).style.visibility = '';
  });
  await expect(reason).toHaveValue('correction');
  await pad.press('B');
  await expect(form).toHaveCount(0);
  expect(state.commands).toEqual([]);
});

test('Xbox reviews one media manifest and confirms its exact alternative text and restrictions before approval', async ({
  page
}) => {
  const state = await controllerJourneysFixtures(page);
  let plan: SponsorMediaBatchPlan | null = null;
  let revision = 'media-workspace-v1';
  const workspaceAssets = (): SponsorMediaWorkspaceAsset[] =>
    state.media.map((asset) => ({
      ...asset,
      batchId: null,
      usageSource: 'media',
      ruleId: null,
      websiteSelected: false,
      readiness: {
        state: 'needs_review',
        reasons: [
          'MEDIA_HUMAN_REVIEW_REQUIRED',
          ...(asset.usageRestrictionsReviewed
            ? []
            : ['MEDIA_RESTRICTIONS_REVIEW_REQUIRED'])
        ]
      },
      moderation: {
        state: asset.reviewStatus === 'approved' ? 'approved' : null,
        level: asset.reviewStatus === 'approved' ? 'N0' : null,
        contentVersion: 3,
        fingerprint: 'a'.repeat(64),
        currentDecisionId: null
      }
    }));
  await page.route('**/api/admin/sponsorships/media/workspace*', (route) =>
    route.fulfill({
      json: {
        contributionId: id,
        revision,
        assets: workspaceAssets(),
        rules: [],
        batches: [],
        writable: true
      }
    })
  );
  await page.route('**/api/admin/sponsorships/media/analyses*', (route) =>
    route.fulfill({
      json: {
        contributionId: id,
        capabilities: {
          technical: 'local',
          vision: 'not_configured',
          ocr: 'not_configured'
        },
        runs: []
      }
    })
  );
  await page.route('**/api/admin/sponsorships/media/batch/*', async (route) => {
    const command = route.request().postDataJSON();
    const pathname = new URL(route.request().url()).pathname;
    state.commands.push({ path: pathname, body: command });
    if (pathname.endsWith('/plan')) {
      const request = command as SponsorMediaBatchPlanRequest;
      plan = {
        id: '10000000-0000-4000-8000-000000000405',
        contributionId: id,
        revision,
        action: request.action,
        expiresAt: '2099-01-01T00:00:00Z',
        assets: workspaceAssets().map((asset) => ({
          ...asset,
          altText: request.assets[0]!.altText ?? asset.altText,
          usageRestrictionsReviewed:
            request.assets[0]!.usageRestrictionsConfirmed === true
        })),
        blocked: [],
        effects: ['Private human media review only.']
      };
      return route.fulfill({ json: plan });
    }
    expect(command).toMatchObject({
      planId: plan!.id,
      confirmation: plan!.id,
      humanReviewed: true
    });
    state.media = state.media.map((asset) => ({
      ...asset,
      altText: plan!.assets[0]!.altText,
      reviewStatus: 'approved',
      version: 'v2',
      usageRestrictionsReviewed: true
    }));
    revision = 'media-workspace-v2';
    return route.fulfill({
      json: {
        requestId: command.requestId,
        planId: plan!.id,
        status: 'completed',
        action: 'approve',
        items: [{ id: assetId, version: 'v2', result: 'approved' }]
      }
    });
  });
  const pad = adminController(page);
  await page.goto(path('media'));
  const card = page.locator(
    `[data-og7="media-tile"][data-og7-id="${assetId}"]`
  );
  await pad.activate(card.getByRole('button'));
  const inspector = hook(page, 'media-inspector');
  await pad.activate(
    inspector.getByRole('checkbox', {
      name: 'I reviewed the usage restrictions for this image.'
    })
  );
  await pad.text(hook(page, 'media-inspector-alt'), 'Photo test 2');
  expect(state.media[0]!.altText).toBe('Photo test');
  await pad.activate(hook(page, 'media-inspector-approve'));
  await expect(hook(page, 'media-batch-manifest')).toContainText(
    'Photo test 2'
  );
  const execute = hook(page, 'media-batch-execute');
  await expect(execute).toBeDisabled();
  expect(writes(state, '/media/batch/execute')).toHaveLength(0);
  expect(writes(state, '/media/batch/plan')[0]!.body).toMatchObject({
    action: 'approve',
    contributionId: id,
    assets: [
      {
        id: assetId,
        version: 'v1',
        altText: 'Photo test 2',
        usageRestrictionsConfirmed: true
      }
    ]
  });
  await pad.activate(hook(page, 'media-manifest-confirmation'));
  await pad.reach(execute);
  await pad.hold('A');
  await expect.poll(() => writes(state, '/media/batch/execute').length).toBe(1);
  await pad.hold('A');
  expect(writes(state, '/media/batch/execute')).toHaveLength(1);
  await pad.release();
  expect(state.media[0]).toMatchObject({
    reviewStatus: 'approved',
    altText: 'Photo test 2',
    usageRestrictionsReviewed: true
  });
  expect(writes(state, '/media/review')).toHaveLength(0);
  expect(writes(state, '/moderation/decisions')).toHaveLength(0);
});

test('Xbox refusal records a reason-bound moderation decision without authorizing a refund', async ({
  page
}) => {
  const state = await controllerJourneysFixtures(page);
  const pad = adminController(page);
  await page.goto(path());
  const tool = page.locator(
    '[data-og7="dossier-tool-panel"][data-og7-id="moderation"]'
  );
  await pad.activate(
    page.locator('[data-og7="dossier-tool-toggle"][data-og7-id="moderation"]')
  );
  await expect(tool).toBeVisible();
  const actions = hook(page, 'moderation-actions').first();
  await pad.select(actions.getByRole('combobox'), 'N4');
  await pad.activate(actions.locator('[data-og7="moderation-open"]'));
  await expect(hook(page, 'moderation-decision')).toBeVisible();
  await pad.press('B');
  await expect(hook(page, 'moderation-decision')).toHaveCount(0);
  await expect(tool).toBeVisible();
  await expect(actions.locator('[data-og7="moderation-open"]')).toBeFocused();
  expect(writes(state, '/moderation/decisions')).toHaveLength(0);
  await pad.activate(actions.locator('[data-og7="moderation-open"]'));
  await moderation(page, pad, true, 'DEHUMANIZATION');
  const decisions = writes(state, '/moderation/decisions');
  expect(decisions).toHaveLength(1);
  expect(decisions[0]!.body).toMatchObject({
    subject: { type: 'sponsorship', id },
    decision: {
      level: 'N4',
      primaryReason: 'DEHUMANIZATION',
      internalReason: 'Private test',
      sponsorExplanation: 'Please revise',
      confirmation: id
    }
  });
  expect(writes(state, '/refund')).toHaveLength(0);
});

test('Xbox reader opens shared dossier help and returns to its exact origin without access or moderation controls', async ({
  page
}) => {
  const state = await controllerJourneysFixtures(page, 'reader');
  const pad = adminController(page);
  const origin = `${path('identity')}#dossier-identity`;
  await page.goto(origin);
  await expect(
    page.locator('[data-og7="dossier-tool-toggle"][data-og7-id="moderation"]')
  ).toHaveCount(0);
  await expect(
    page.locator('[data-og7="dossier-tool-toggle"][data-og7-id="access"]')
  ).toHaveCount(0);
  const help = hook(page, 'dossier-assistant');
  await pad.activate(help);
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/admin/fundraiser/assistant' &&
      url.searchParams.get('sponsorshipId') === id &&
      url.searchParams.get('returnTo') === origin
  );
  const guide = hook(page, 'assistant-dossier-guide').locator(
    '[data-og7="dossier-guide"]'
  );
  await expect(guide).toHaveAttribute('open', '');
  await expect(guide.locator('[data-og7="guide-edit-identity"]')).toHaveCount(
    0
  );
  await expect(guide.locator('[data-og7="guide-followup-access"]')).toHaveCount(
    0
  );
  const summary = guide.locator('summary');
  await pad.activate(summary);
  await expect(guide).not.toHaveAttribute('open', '');
  await expect(summary).toBeFocused();
  await pad.activate(summary);
  await expect(guide).toHaveAttribute('open', '');
  const back = hook(page, 'assistant-dossier-return');
  await expect(back).toHaveAttribute('href', origin);
  await pad.activate(back);
  await expect(page).toHaveURL(origin);
  await expect(help).toBeFocused();
  await expect(hook(page, 'dossier-guide')).toHaveCount(0);
  expect(state.commands).toEqual([]);
});

test('Xbox refund requires exact text and explicit submission, with no call on cancellation', async ({
  page
}) => {
  const state = await controllerJourneysFixtures(page);
  const pad = adminController(page);
  await page.goto(path('refund'));
  await pad.activate(
    page.getByRole('button', { name: 'Refund through Stripe', exact: true })
  );
  const form = hook(page, 'dossier-refund-form');
  await pad.text(form.locator('input[type="number"]'), '2.50');
  const confirm = form.getByRole('button', {
    name: 'Refund through Stripe',
    exact: true
  });
  await expect(confirm).toBeDisabled();
  await pad.text(form.locator('input[type="text"]'), 'XBOX-401');
  const notify = form.locator('input[type="checkbox"]');
  if (await notify.isChecked()) await pad.activate(notify);
  await pad.activate(form.getByRole('button', { name: 'Cancel', exact: true }));
  await expect(form).toHaveCount(0);
  expect(writes(state, '/refund')).toHaveLength(0);
  await pad.activate(
    page.getByRole('button', { name: 'Refund through Stripe', exact: true })
  );
  await expect(form.locator('input[type="text"]')).toHaveValue('XBOX-401');
  await pad.reach(confirm);
  await pad.hold('A');
  await expect.poll(() => writes(state, '/refund').length).toBe(1);
  expect(writes(state, '/refund')[0]!.body).toMatchObject({
    contributionId: id,
    confirmationText: 'XBOX-401',
    amount: 2.5,
    notifySponsor: false
  });
  await pad.hold('A');
  expect(writes(state, '/refund')).toHaveLength(1);
  await pad.release();
});

test('Xbox retries a targeted email once after cancellation and explicit confirmation', async ({
  page
}) => {
  const state = await controllerJourneysFixtures(page);
  const pad = adminController(page);
  await page.goto('/admin/fundraiser/email-queue?messageId=' + assetId);
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await pad.activate(retry);
  await expect(hook(page, 'confirm-action')).toBeVisible();
  await pad.press('B');
  expect(writes(state, '/email-queue/retry')).toHaveLength(0);
  await pad.activate(retry);
  await pad.activate(hook(page, 'confirm-action'));
  await expect.poll(() => writes(state, '/email-queue/retry').length).toBe(1);
  await expect(hook(page, 'email-retry-result')).toHaveText('Message sent.');
  await expect(retry).toBeDisabled();
  expect(writes(state, '/email-queue/retry')[0]!.body.messageId).toBe(assetId);
});

test('Xbox reconciles uncertain mail only with provider evidence and never retries implicitly', async ({
  page
}) => {
  const state = await controllerJourneysFixtures(page);
  state.email = {
    ...state.email,
    status: 'uncertain',
    last_error: 'EMAIL_DELIVERY_UNCERTAIN'
  };
  const pad = adminController(page);
  await page.goto('/admin/fundraiser/email-queue?messageId=' + assetId);
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true })
  ).toBeDisabled();
  await pad.text(hook(page, 'email-delivery-evidence'), 'provider:123');
  await pad.activate(hook(page, 'email-delivery-mark-not-sent'));
  await expect(hook(page, 'confirm-action')).toBeVisible();
  await pad.press('B');
  expect(writes(state, '/email-queue/reconcile')).toHaveLength(0);
  await pad.activate(hook(page, 'email-delivery-mark-not-sent'));
  await pad.activate(hook(page, 'confirm-action'));
  await expect
    .poll(() => writes(state, '/email-queue/reconcile').length)
    .toBe(1);
  expect(writes(state, '/email-queue/reconcile')[0]!.body).toMatchObject({
    messageId: assetId,
    confirmation: assetId,
    outcome: 'not_sent',
    evidenceReference: 'provider:123',
    expectedUpdatedAt: '2026-10-15T12:00:00Z'
  });
  expect(writes(state, '/email-queue/retry')).toHaveLength(0);
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true })
  ).toBeEnabled();
});

test('Xbox reads a credit note and confirms its resend to a corrected recipient', async ({
  page
}) => {
  const state = await controllerJourneysFixtures(page);
  const pad = adminController(page);
  await page.goto('/admin/fundraiser/invoices?contributionId=' + id);
  const credit = hook(page, 'credit-note');
  await expect(credit).toContainText('CN-XBOX-401');
  await pad.text(
    credit.getByLabel('Credit note recipient', { exact: true }),
    'test@example.test'
  );
  const resend = credit.getByRole('button', {
    name: 'Resend credit note',
    exact: true
  });
  await pad.activate(resend);
  await expect(page.getByRole('dialog')).toContainText('CN-XBOX-401');
  await pad.press('B');
  expect(writes(state, '/sponsorship-credit-notes/resend')).toHaveLength(0);
  await pad.activate(resend);
  await pad.activate(hook(page, 'confirm-action'));
  await expect
    .poll(() => writes(state, '/sponsorship-credit-notes/resend').length)
    .toBe(1);
  expect(
    writes(state, '/sponsorship-credit-notes/resend')[0]!.body
  ).toMatchObject({
    creditNoteId: assetId,
    to: 'test@example.test'
  });
});

test('Xbox follows the floating payment guide across routes and resumes the same dossier after interruption', async ({
  page
}) => {
  const state = await controllerJourneysFixtures(page);
  const pad = adminController(page);
  await page.goto(path() + '&paymentJourney=' + id);
  await expect(hook(page, 'payment-journey-state')).toHaveAttribute(
    'data-og7-id',
    'ready'
  );
  await pad.ready();
  await pad.press('Y');
  await pad.activate(hook(page, 'payment-journey-pause'));
  await pad.activate(
    page.locator('openg7-admin-nav a[href="/admin/fundraiser/email-queue"]')
  );
  await expect(page).toHaveURL(/\/email-queue$/);
  await page.reload();
  await pad.ready();
  await pad.press('Y');
  await pad.activate(hook(page, 'payment-journey-resume'));
  await expect(hook(page, 'payment-journey')).toContainText('XBOX-401');
  await pad.activate(hook(page, 'payment-journey-next'));
  await expect(page).toHaveURL(path());
  expect(state.commands).toEqual([]);
});

test('Xbox historical qualification and an explicit waiver preserve accepted terms and versions', async ({
  page
}) => {
  const state = await controllerJourneysFixtures(page);
  state.commitment = {
    id: obligationId,
    contributionId: id,
    offerId: null,
    provenance: 'historical_unverified',
    state: 'needs_confirmation',
    qualificationReason: null,
    version: 1,
    offer: null,
    obligations: []
  };
  const commands: Record<string, unknown>[] = [];
  await page.route('**/api/admin/sponsorship-commitments/**', async (route) => {
    const input = route.request().postDataJSON();
    commands.push(input);
    if (new URL(route.request().url()).pathname.endsWith('/qualify')) {
      const payload = input as SponsorshipCommitmentQualificationRequest;
      state.commitment = {
        ...state.commitment!,
        state: 'active',
        provenance: 'qualified_historical',
        version: 2,
        offerId: assetId,
        offer: payload.offer,
        obligations: payload.offer.benefits.flatMap((benefit) =>
          Array.from({ length: benefit.quantity }, (_, index) => ({
            id: obligationId,
            commitmentId: state.commitment!.id,
            contributionId: id,
            benefitId: benefit.id,
            channel: benefit.channel,
            target: benefit.target,
            ordinal: index + 1,
            state: 'pending' as const,
            format: benefit.format ?? null,
            version: 1,
            blockedReason: null,
            fulfilmentEvidenceId: null
          }))
        )
      };
    } else
      state.commitment = {
        ...state.commitment!,
        version: 3,
        obligations: state.commitment!.obligations.map((obligation) => ({
          ...obligation,
          state: 'adjusted',
          version: 2
        }))
      };
    return route.fulfill({ json: { commitment: state.commitment } });
  });
  const pad = adminController(page);
  await page.goto(path('publication'));
  const panel = hook(page, 'admin-commitments');
  await pad.activate(panel.locator('[data-og7="commitments-add-benefit"]'));
  await pad.select(
    panel.locator('[data-og7="commitments-benefit-channel"]'),
    'website'
  );
  await pad.select(
    panel.locator('[data-og7="commitments-benefit-target"]'),
    'openg7'
  );
  await pad.text(
    panel.locator('[data-og7="commitments-benefit-quantity"]'),
    '1'
  );
  await pad.activate(
    panel.locator('[data-og7="commitments-company-required"]')
  );
  await pad.text(
    panel.locator('[data-og7="commitments-evidence"]'),
    'proof:123'
  );
  await pad.text(
    panel.locator('[data-og7="commitments-reason"]'),
    'Terms verified'
  );
  await pad.text(panel.locator('[data-og7="commitments-confirmation"]'), id);
  await pad.activate(panel.locator('[data-og7="commitments-qualify"]'));
  await expect(
    panel.locator('[data-og7="commitments-accepted-offer"]')
  ).toBeVisible();
  const accepted = structuredClone(commands[0]!.offer);
  expect(commands[0]).toMatchObject({
    contributionId: id,
    expectedVersion: 1,
    confirmation: id,
    evidenceReference: 'proof:123',
    reason: 'Terms verified'
  });
  await pad.activate(panel.locator('[data-og7="commitments-adjust-open"]'));
  await pad.select(
    panel.locator('[data-og7="commitments-adjust-kind"]'),
    'waiver'
  );
  await pad.activate(panel.locator('[data-og7="commitments-waiver-confirm"]'));
  await pad.text(
    panel.locator('[data-og7="commitments-adjust-reason"]'),
    'Explicit waiver'
  );
  await pad.text(
    panel.locator('[data-og7="commitments-adjust-confirmation"]'),
    obligationId
  );
  await pad.activate(panel.locator('[data-og7="commitments-adjust-save"]'));
  await expect(
    panel.locator('[data-og7="commitments-adjust-open"]')
  ).toHaveCount(0);
  expect(commands[1]).toMatchObject({
    obligationId,
    expectedVersion: 1,
    confirmation: obligationId,
    kind: 'waiver',
    reason: 'Explicit waiver'
  });
  expect(state.commitment!.offer).toEqual(accepted);
  expect(writes(state, '/refund')).toHaveLength(0);
});

test('Xbox historical evidence review requires reason, conclusion and current confirmation', async ({
  page
}) => {
  await controllerJourneysFixtures(page);
  const commands: SponsorshipHistoricalAuditReviewRequest[] = [];
  await page.route(
    '**/api/admin/sponsorship-commitments/historical-audit**',
    async (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({
          json: {
            items: [
              {
                evidenceId: assetId,
                obligationId,
                contributionId: id,
                benefitId: 'website_mention',
                channel: 'website',
                target: 'openg7',
                deliveredAt: '2026-10-01T00:00:00Z',
                durationDays: 30,
                requirements: [
                  { element: 'approved_logo', observation: 'missing' }
                ],
                findings: ['duration_unverified', 'required_element_missing'],
                reviewVersion: 0,
                latestReview: null
              }
            ],
            pageSize: 25,
            nextCursor: null,
            asOf: '2026-10-15T12:00:00Z',
            totals: {
              evidence: 1,
              filtered: 1,
              unreviewed: 1,
              durationUnverified: 1,
              requiredElementMissing: 1,
              snapshotIncomplete: 0,
              noIssueDetected: 0
            }
          }
        });
      const payload = route
        .request()
        .postDataJSON() as SponsorshipHistoricalAuditReviewRequest;
      commands.push(payload);
      return route.fulfill({
        json: {
          evidenceId: assetId,
          reviewVersion: 1,
          review: {
            id: obligationId,
            conclusion: payload.conclusion,
            reviewedAt: '2026-10-15T12:00:00Z'
          }
        }
      });
    }
  );
  const pad = adminController(page);
  await page.goto(path('publication'));
  const panel = hook(page, 'historical-evidence-audit');
  await pad.activate(panel.locator('[data-og7-id="historical-audit-load"]'));
  await pad.activate(panel.locator('[data-og7-id="historical-audit-review"]'));
  const form = panel.locator('form');
  const save = form.locator('[data-og7-id="historical-audit-save"]');
  await expect(save).toBeDisabled();
  await pad.text(form.locator('textarea'), 'Proof reviewed');
  await pad.select(form.locator('select'), 'follow_up_required');
  await pad.activate(form.locator('input[type="checkbox"]'));
  await pad.activate(save);
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    evidenceId: assetId,
    expectedVersion: 0,
    confirmation: assetId,
    conclusion: 'follow_up_required',
    reason: 'Proof reviewed'
  });
});

for (const consent of [false, true]) {
  test(`Xbox website publication preserves consent=${consent} and requires explicit authorization`, async ({
    page
  }) => {
    const state = await controllerJourneysFixtures(page);
    state.sponsor = {
      ...state.sponsor,
      sponsor_review_status: 'approved',
      public_display_consent: consent
    };
    state.progress = {
      ...state.progress,
      amountMinor: 10000,
      reviewStatus: 'approved',
      publicConsent: consent,
      publicEligible: consent,
      publicationCompletion: { done: 0, total: 1 },
      website: {
        visible: false,
        held: true,
        canPublish: consent,
        version: 'site-v1',
        blockers: consent ? [] : ['consent']
      }
    };
    const pad = adminController(page);
    await page.goto(path('publication'));
    const site = hook(page, 'publication-website');
    const publish = site.locator('[data-og7="website-visibility"]');
    await expect(site).toHaveAttribute(
      'data-state',
      consent ? 'hidden' : 'blocked'
    );
    if (consent) {
      await pad.activate(publish);
      await expect(hook(page, 'confirm-action')).toBeVisible();
      await pad.press('B');
      expect(writes(state, '/website-visibility')).toHaveLength(0);
      await pad.activate(publish);
      await pad.activate(hook(page, 'confirm-action'));
      await expect
        .poll(() => writes(state, '/website-visibility').length)
        .toBe(1);
      expect(writes(state, '/website-visibility')[0]!.body).toMatchObject({
        contributionId: id,
        expectedVersion: 'site-v1',
        visible: true
      });
      await expect(site).toHaveAttribute('data-state', 'visible');
    } else {
      await expect(publish).toBeDisabled();
      await pad.press('Y');
      await expect(hook(page, 'admin-guidance')).toBeVisible();
      expect(writes(state, '/website-visibility')).toHaveLength(0);
    }
  });
}

test('Xbox French mobile editor preserves its draft on disconnection and does not submit on reconnection', async ({
  page
}) => {
  const state = await controllerJourneysFixtures(page, 'owner', 'fr-CA');
  const pad = adminController(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path('identity'));
  await pad.activate(hook(page, 'edit-dossier'));
  const company = hook(page, 'edit-dossier-form').locator(
    '[name="companyName"]'
  );
  await pad.activate(company);
  await expect(
    hook(page, 'controller-editor').getByRole('heading', {
      name: 'Saisir avec la manette',
      exact: true
    })
  ).toBeVisible();
  await expect(hook(page, 'editor-apply')).toHaveText('Appliquer la saisie');
  await pad.activate(hook(page, 'editor-clear'));
  await pad.activate(page.locator('[data-og7="editor-key"][data-og7-id="é"]'));
  await pad.connect(false);
  await expect(hook(page, 'editor-preview')).toContainText('é');
  await pad.connect(true);
  await pad.release();
  await expect(hook(page, 'controller-editor')).toBeVisible();
  await page.screenshot({
    path: 'test-results/controller-french-mobile-editor.png'
  });
  await pad.press('B');
  await expect(company).toHaveValue('Xbox fixture');
  await expect(hook(page, 'edit-dossier-form')).toBeVisible();
  await pad.press('B');
  await pad.press('Menu');
  await expect(hook(page, 'controller-menu')).toContainText(
    'La manette vous accompagne'
  );
  await expect(
    page.getByRole('heading', {
      name: 'La manette dans l’administration',
      exact: true
    })
  ).toBeVisible();
  await pad.press('B');
  await pad.activate(
    hook(page, 'dossier-tabs').getByRole('button', {
      name: 'Finances',
      exact: true
    })
  );
  await pad.activate(
    page.getByRole('button', { name: 'Rembourser Stripe', exact: true })
  );
  const amount = hook(page, 'dossier-refund-form').locator(
    'input[type="number"]'
  );
  const originalAmount = await amount.inputValue();
  await pad.activate(amount);
  await expect(hook(page, 'controller-editor')).toContainText(
    'Format attendu : Un nombre ; utilisez un point pour les décimales'
  );
  await expect(page.locator('body')).not.toContainText('{{format}}');
  await expect(page.locator('body')).not.toContainText('admin.controller.');
  await pad.press('B');
  await expect(amount).toHaveValue(originalAmount);
  expect(state.commands).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  ).toBe(true);
});

test('Xbox mobile navigation reveals a control covered by the guide and requires a new press after an invisible target', async ({
  page
}) => {
  const state = await controllerJourneysFixtures(page);
  const pad = adminController(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/admin/fundraiser/email-queue?paymentJourney=${id}`);
  await expect(hook(page, 'payment-journey-state')).toHaveAttribute(
    'data-og7-id',
    'ready'
  );
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await pad.reach(retry);
  const visible = () =>
    retry.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      return !!hit && (hit === element || element.contains(hit));
    });
  await expect.poll(visible).toBe(true);
  // A browser/viewport interruption can move a previously focused control.
  // This changes only the viewport; focus and actions still come from Gamepad.
  await retry.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    window.scrollTo(0, Math.max(0, scrollY + rect.top - innerHeight - 100));
  });
  await expect.poll(visible).toBe(false);
  await pad.press('A');
  await expect(hook(page, 'confirm-action')).toHaveCount(0);
  expect(writes(state, '/email-queue/retry')).toHaveLength(0);
  await expect.poll(visible).toBe(true);
  await pad.press('A');
  await expect(hook(page, 'confirm-action')).toBeVisible();
  await pad.press('B');
  expect(writes(state, '/email-queue/retry')).toHaveLength(0);
});

test('a same-route session expiry purges the Xbox editor before its private draft can be applied', async ({
  page
}) => {
  const state = await controllerJourneysFixtures(page);
  const pad = adminController(page);
  await page.goto(path('identity') + '&paymentJourney=' + id);
  await expect(hook(page, 'payment-journey-state')).toHaveAttribute(
    'data-og7-id',
    'ready'
  );
  await pad.ready();
  await pad.press('Y');
  let release!: () => void;
  let seen!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    seen = resolve;
  });
  await page.route('**/api/admin/payment-journey**', async (route) => {
    seen();
    await gate;
    await route.fulfill({
      status: 401,
      json: { error: 'Synthetic session expired' }
    });
  });
  let sessionExpired = false;
  const privateReadsAfterExpiry: string[] = [];
  page.on('response', (response) => {
    if (
      new URL(response.url()).pathname === '/api/admin/payment-journey' &&
      response.status() === 401
    )
      sessionExpired = true;
  });
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      sessionExpired &&
      request.method() === 'GET' &&
      pathname.startsWith('/api/admin/')
    )
      privateReadsAfterExpiry.push(pathname);
  });
  try {
    await pad.activate(hook(page, 'payment-journey-refresh'));
    await pending;
    // The request remains attached to this session after its guide is reduced.
    // Its late 401 must purge the editor without reviving or navigating the guide.
    await pad.activate(hook(page, 'admin-guidance-toggle'));
    await expect(hook(page, 'admin-guidance-panel')).not.toBeVisible();
    await pad.activate(hook(page, 'edit-dossier'));
    await pad.activate(
      hook(page, 'edit-dossier-form').locator('[name="companyName"]')
    );
    await pad.activate(hook(page, 'editor-clear'));
    await pad.activate(
      page.locator('[data-og7="editor-key"][data-og7-id="x"]')
    );
    await expect(hook(page, 'editor-preview')).toContainText('x');
    const sameUrl = page.url();
    release();
    await expect(hook(page, 'controller-editor')).not.toBeVisible();
    await expect(hook(page, 'editor-preview')).toHaveText('|');
    expect(page.url()).toBe(sameUrl);
    await pad.press('A');
    expect(state.commands).toEqual([]);
    expect(sessionExpired).toBe(true);
    expect(privateReadsAfterExpiry).toEqual([]);
  } finally {
    release();
  }
});
