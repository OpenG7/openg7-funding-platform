import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { AdminSponsorshipsResponse } from '@openg7/funding-core';

import { acceptanceComposeArgs } from './acceptance-database.js';
import { expect } from './test.js';

const execute = promisify(execFile);

async function login(page: Page, account: 'owner' | 'operator'): Promise<void> {
  await page.goto(
    '/admin/login?returnUrl=' + encodeURIComponent('/admin/fundraiser/sponsors')
  );
  await page.locator('[data-og7="identity-sign-in"]').click();
  await page.getByLabel('Compte de test').selectOption(account);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page).toHaveURL(/\/admin\/fundraiser\/sponsors/);
}

/** Real OIDC people share only the disposable recipe's DB; token sessions stay separate. */
export async function rejectAcceptanceSponsorship(
  browser: Browser,
  publicReference: string,
  internalReason: string,
  refundHandling: 'none' | 'manual_completed' = 'none'
): Promise<void> {
  acceptanceComposeArgs();
  const origin = process.env.MODERATION_WEB_BASE_URL;
  if (!origin || new URL(origin).hostname !== '127.0.0.1')
    throw new Error(
      'Independent review requires the disposable OIDC Web origin.'
    );
  const contexts: BrowserContext[] = [];
  let bodyFailed = false;
  try {
    const ownerContext = await browser.newContext({ baseURL: origin });
    contexts.push(ownerContext);
    const authorContext = await browser.newContext({ baseURL: origin });
    contexts.push(authorContext);
    const reviewer = await ownerContext.newPage();
    const author = await authorContext.newPage();
    const available = async () => {
      try {
        const response = await reviewer.request.get('/api/admin/auth/config');
        return response.ok() && (await response.json()).mode === 'oidc';
      } catch {
        return false;
      }
    };
    if (!(await available()))
      await execute(
        'docker',
        [
          ...acceptanceComposeArgs(),
          'exec',
          '-T',
          '-d',
          'api',
          'node',
          '/app/tests/identity/docker-moderation-server.mjs'
        ],
        { windowsHide: true, timeout: 30000 }
      );
    await expect.poll(available, { timeout: 30000 }).toBe(true);
    await login(reviewer, 'owner');
    const access = await reviewer.request.post('/api/admin/access', {
      headers: { Origin: origin },
      data: {
        subject: 'fixture-operator',
        confirmation: 'fixture-operator',
        displayName: 'Independent acceptance operator',
        role: 'operator',
        disabled: false
      }
    });
    expect(access.ok(), await access.text()).toBe(true);
    await login(author, 'operator');
    const authorCurrent = await author.request.get('/api/admin/auth/current');
    const reviewerCurrent = await reviewer.request.get(
      '/api/admin/auth/current'
    );
    expect(authorCurrent.status()).toBe(200);
    expect(reviewerCurrent.status()).toBe(200);
    const authorProfile = await authorCurrent.json();
    const reviewerProfile = await reviewerCurrent.json();
    expect(authorProfile.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(authorProfile.role).toBe('operator');
    expect(reviewerProfile.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(reviewerProfile.role).toBe('owner');
    expect(reviewerProfile.id).not.toBe(authorProfile.id);
    const dossier = async () => {
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
    };
    const initial = await dossier();
    const contributionId = initial.id;
    await author.goto(
      '/admin/fundraiser/sponsors?sponsorshipId=' + contributionId
    );
    await author.getByRole('button', { name: 'Refuser', exact: true }).click();
    const rejection = author.locator('openg7-admin-sponsor-rejection-panel');
    await expect(rejection).toBeVisible();
    // The legacy form still requires this draft; the structured decision owns
    // the persisted rationale and does not rewrite the dossier's old reviewNote.
    await rejection.getByLabel(/Justification interne/i).fill(internalReason);
    if (refundHandling !== 'none')
      await rejection
        .getByLabel(/^Remboursement/i)
        .selectOption(refundHandling);
    await rejection
      .getByRole('button', { name: /Confirmer le refus/i })
      .click();
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
    expect((await dossier()).sponsor_review_status).not.toBe('rejected');
    expect((await dossier()).sponsorship_refund_status).toBe(
      initial.sponsorship_refund_status
    );
    const input = pending.request().postDataJSON();
    const contentResponse = await author.request.get(
      '/api/admin/moderation/content',
      {
        params: { subjectType: 'sponsorship', subjectId: contributionId }
      }
    );
    expect(contentResponse.ok()).toBe(true);
    const { currentDecisionId: decisionId } = await contentResponse.json();
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
      '[data-og7="moderation-history-decision"][data-og7-id="' +
        decisionId +
        '"]'
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
      independentReviewer: 'admin:' + reviewerProfile.id
    });
    await expect
      .poll(async () => (await dossier()).sponsor_review_status)
      .toBe('rejected');
    if (refundHandling !== 'none') {
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
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    // Attempt every owned cleanup, including when the second creation failed.
    // A cleanup error must not replace the original journey failure.
    const closed = await Promise.allSettled(
      contexts.map((context) => context.close())
    );
    const failures = closed
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected'
      )
      .map((result) => result.reason);
    if (!bodyFailed && failures.length)
      throw new AggregateError(failures, 'Moderation context cleanup failed.');
  }
}
