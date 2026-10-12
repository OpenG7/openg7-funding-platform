import { randomUUID } from 'node:crypto';

import type { Browser, Page } from '@playwright/test';
import type {
  AdminSponsorshipReviewRequest,
  AdminSponsorshipsResponse,
  ModerationContent
} from '@openg7/funding-core';

import {
  withAcceptanceModerationIdentity,
  type AcceptanceModerationIdentity
} from './acceptance-oidc-moderation-identity.js';
import { expect } from './test.js';

type RefundHandling = 'none' | 'manual_completed';
type Dossier = AdminSponsorshipsResponse['items'][number];
type ReadDossier = () => Promise<Dossier>;
const financialState = (record: Dossier) => ({
  amount: record.amount,
  currency: record.currency,
  paymentStatus: record.payment_status,
  refundStatus: record.sponsorship_refund_status,
  refundRequestedAt: record.sponsorship_refund_requested_at,
  refundProcessedAt: record.sponsorship_refund_processed_at,
  refundId: record.sponsorship_refund_id,
  refundAmount: record.sponsorship_refund_amount,
  refundReason: record.sponsorship_refund_reason,
  refundNote: record.sponsorship_refund_note,
  refundError: record.sponsorship_refund_error,
  refundCompletedAt: record.sponsorship_refund_completed_at
});

/** Real OIDC people share only the disposable recipe's DB; token sessions stay separate. */
export async function rejectAcceptanceSponsorship(
  browser: Browser,
  publicReference: string,
  internalReason: string,
  refundHandling: RefundHandling = 'none'
): Promise<void> {
  await withAcceptanceModerationIdentity(browser, async (identity) => {
    const dossier = () => readDossier(identity.author, publicReference);
    const initial = await dossier();
    const input = await submitRejection(
      identity.author,
      initial.id,
      internalReason,
      refundHandling
    );
    const pending = await dossier();
    expect(pending.sponsor_review_status).toBe(initial.sponsor_review_status);
    expect(pending.sponsor_review_status).not.toBe('rejected');
    expect(financialState(pending)).toEqual(financialState(initial));
    expect(input).toMatchObject({
      contributionId: initial.id,
      reviewStatus: 'rejected',
      moderationDecision: {
        level: 'N4',
        confirmation: initial.id,
        contentVersion: expect.any(Number),
        contentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    });
    await confirmIndependentReview(identity, initial.id);
    await expect
      .poll(async () => (await dossier()).sponsor_review_status)
      .toBe('rejected');
    expect(financialState(await dossier())).toEqual(financialState(initial));
    if (refundHandling !== 'none')
      await finalizeManualRefund(identity, input, dossier);
  });
}

async function readDossier(author: Page, publicReference: string) {
  const response = await author.request.get('/api/admin/sponsorships', {
    params: { search: publicReference }
  });
  expect(response.ok()).toBe(true);
  const records = (await response.json()) as AdminSponsorshipsResponse;
  const matching = records.items.filter(
    (record) => record.public_reference === publicReference
  );
  expect(matching).toHaveLength(1);
  return matching[0]!;
}

async function submitRejection(
  author: Page,
  contributionId: string,
  internalReason: string,
  refundHandling: RefundHandling
): Promise<AdminSponsorshipReviewRequest> {
  await author.goto(
    '/admin/fundraiser/sponsors?sponsorshipId=' + contributionId
  );
  const reject = author.getByRole('button', { name: 'Refuser', exact: true });
  await expect(reject).toBeVisible();
  await expect(reject).toBeEnabled();
  await reject.evaluate((button) =>
    button.scrollIntoView({ block: 'center', inline: 'nearest' })
  );
  await reject.click();
  const rejection = author.locator('openg7-admin-sponsor-rejection-panel');
  await expect(rejection).toBeVisible();
  // The legacy draft stays separate from the structured decision's rationale.
  await rejection.getByLabel(/Justification interne/i).fill(internalReason);
  if (refundHandling !== 'none')
    await rejection.getByLabel(/^Remboursement/i).selectOption(refundHandling);
  const confirmRejection = rejection.getByRole('button', {
    name: /Confirmer le refus/i
  });
  await expect(confirmRejection).toBeVisible();
  await expect(confirmRejection).toBeEnabled();
  await confirmRejection.evaluate((button) =>
    button.scrollIntoView({ block: 'center', inline: 'nearest' })
  );
  await confirmRejection.click();
  const panel = author.locator('[data-og7="moderation-decision"]');
  await expect(panel).toBeVisible();
  await panel
    .locator('[data-og7="moderation-primary-reason"]')
    .selectOption('MISLEADING_CLAIM');
  await panel
    .locator('[data-og7="moderation-internal-reason"]')
    .fill(internalReason);
  await panel
    .locator('[data-og7="moderation-explanation"]')
    .fill('Synthetic external explanation');
  await panel.locator('[data-og7="moderation-confirmation"]').check();
  const pendingResponse = author.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/admin/sponsorships/review' &&
      response.request().method() === 'POST'
  );
  await panel.locator('[data-og7="moderation-submit"]').click();
  const pending = await pendingResponse;
  expect(pending.ok(), await pending.text()).toBe(true);
  expect(await pending.json()).toMatchObject({
    decisionState: 'pending_independent_review'
  });
  return pending.request().postDataJSON() as AdminSponsorshipReviewRequest;
}

async function confirmIndependentReview(
  { author, reviewer, origin, reviewerId }: AcceptanceModerationIdentity,
  contributionId: string
): Promise<void> {
  const contentResponse = await author.request.get(
    '/api/admin/moderation/content',
    {
      params: { subjectType: 'sponsorship', subjectId: contributionId }
    }
  );
  expect(contentResponse.ok()).toBe(true);
  const { currentDecisionId: decisionId } =
    (await contentResponse.json()) as ModerationContent;
  expect(decisionId).toBeTruthy();
  const selfReview = await author.request.post(
    '/api/admin/moderation/independent-review',
    {
      headers: { Origin: origin },
      data: { decisionId, requestId: randomUUID(), confirmation: decisionId }
    }
  );
  expect(selfReview.status()).toBe(403);
  expect(await selfReview.json()).toMatchObject({
    code: 'MODERATION_INDEPENDENT_REVIEW_REQUIRED'
  });
  await reviewer.goto(
    '/admin/fundraiser/sponsors?sponsorshipId=' + contributionId
  );
  const moderation = reviewer
    .locator('[data-og7="moderation-actions"]')
    .first();
  await moderation.locator('details > summary').click();
  const decision = moderation.locator(
    '[data-og7="moderation-history-decision"][data-og7-id="' + decisionId + '"]'
  );
  await decision.locator('[data-og7="moderation-independent"]').click();
  const confirmation = reviewer.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        '/api/admin/moderation/independent-review' &&
      response.request().method() === 'POST'
  );
  await reviewer.locator('[data-og7="confirm-action"]').click();
  const confirmed = await confirmation;
  expect(confirmed.ok(), await confirmed.text()).toBe(true);
  expect((await confirmed.json()).decision).toMatchObject({
    id: decisionId,
    state: 'active',
    independentReviewer: 'admin:' + reviewerId
  });
}

async function finalizeManualRefund(
  { author, origin }: AcceptanceModerationIdentity,
  input: AdminSponsorshipReviewRequest,
  dossier: ReadDossier
): Promise<void> {
  const current = await dossier();
  const finalized = await author.request.post(
    '/api/admin/sponsorships/review',
    {
      headers: { Origin: origin },
      data: { ...input, expectedVersion: current.version }
    }
  );
  expect(finalized.ok(), await finalized.text()).toBe(true);
  expect(await finalized.json()).toMatchObject({
    reviewStatus: 'rejected',
    refundWorkflowStatus: 'completed'
  });
  await expect
    .poll(async () => (await dossier()).sponsorship_refund_status)
    .toBe('completed');
}
