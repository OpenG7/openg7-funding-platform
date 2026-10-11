import { randomUUID } from 'node:crypto';

import {
  MODERATION_POLICY_VERSION,
  type ModerationContent,
  type ModerationDecisionInput,
  type ModerationDecisionRecord,
  type ModerationSubject
} from '@openg7/funding-core';
import type { APIRequestContext, Page, Route } from '@playwright/test';

import { expect } from './test.js';
import { adminSessionHeaders } from './admin-auth.js';

/** Explicit approval of the current synthetic subject, through the real admin API. */
export async function currentModerationApproval(
  request: APIRequestContext,
  subject: ModerationSubject,
  headers?: Record<string, string>
): Promise<ModerationDecisionInput> {
  const query = new URLSearchParams({
    subjectType: subject.type,
    subjectId: subject.id
  });
  const response = await request.get('/api/admin/moderation/content?' + query, {
    headers: headers ?? (await adminSessionHeaders(request))
  });
  expect(response.ok()).toBe(true);
  const content = (await response.json()) as ModerationContent;
  expect(content.subject).toEqual(subject);
  return {
    requestId: randomUUID(),
    policyVersion: MODERATION_POLICY_VERSION,
    contentVersion: content.contentVersion,
    contentFingerprint: content.fingerprint,
    expectedDecisionId: content.currentDecisionId,
    confirmation: subject.id,
    level: 'N0'
  };
}

export async function approveCurrentModeration(
  request: APIRequestContext,
  subject: ModerationSubject,
  headers?: Record<string, string>
): Promise<ModerationDecisionRecord> {
  const requestHeaders = headers ?? (await adminSessionHeaders(request));
  const decision = await currentModerationApproval(
    request,
    subject,
    requestHeaders
  );
  const response = await request.post('/api/admin/moderation/decisions', {
    headers: requestHeaders,
    data: { subject, decision }
  });
  expect(response.ok(), await response.text()).toBe(true);
  const result = (await response.json()) as {
    decision: ModerationDecisionRecord;
  };
  expect(result.decision).toMatchObject({
    subject,
    level: 'N0',
    state: 'active',
    contentVersion: decision.contentVersion,
    contentFingerprint: decision.contentFingerprint
  });
  return result.decision;
}

/** Subject-bound synthetic content for existing administrative journey fixtures. */
export async function moderationFixture(route: Route): Promise<boolean> {
  const url = new URL(route.request().url());
  if (!url.pathname.startsWith('/api/admin/moderation/')) return false;
  if (url.pathname.endsWith('/content')) {
    const subject = {
      type: url.searchParams.get('subjectType'),
      id: url.searchParams.get('subjectId')
    };
    await route.fulfill({
      json: {
        subject,
        contributionId: null,
        contributionIds: [],
        contentVersion: 3,
        fingerprint: 'a'.repeat(64),
        snapshot: { synthetic: true, subject },
        currentDecisionId: null
      }
    });
  } else if (route.request().method() === 'GET')
    await route.fulfill({ json: { items: [] } });
  else {
    const payload = route.request().postDataJSON();
    await route.fulfill({
      json: {
        decision: {
          ...payload.decision,
          id: '00000000-0000-4000-8000-000000000099',
          subject: payload.subject,
          state:
            payload.decision?.level === 'N4'
              ? 'pending_independent_review'
              : 'active'
        }
      }
    });
  }
  return true;
}

/** These journey tests explicitly complete the shared confirmation before the business action. */
export async function completeModeration(
  page: Page,
  adverse = false
): Promise<void> {
  const panel = page.locator('[data-og7="moderation-decision"]');
  await expect(panel).toBeVisible();
  const confirmation = panel.locator('[data-og7="moderation-confirmation"]');
  // The control exists only once the exact subject's content has loaded.
  await expect(confirmation).toBeVisible();
  await expect(confirmation).not.toBeChecked();
  const loadedConfirmation = await confirmation.elementHandle();
  expect(loadedConfirmation).not.toBeNull();
  try {
    if (adverse) {
      await panel
        .locator('[data-og7="moderation-primary-reason"]')
        .selectOption('MISLEADING_CLAIM');
      await panel
        .locator('[data-og7="moderation-internal-reason"]')
        .fill('Synthetic private rationale');
      await panel
        .locator('[data-og7="moderation-explanation"]')
        .fill('Synthetic external explanation');
    }
    await confirmation.check();
    const submit = panel.locator('[data-og7="moderation-submit"]');
    await expect(submit).toBeEnabled();
    await submit.click();
    // Sequential subjects reuse the panel. Wait for this content's old node,
    // rather than resolving the next subject's newly rendered checkbox.
    await loadedConfirmation!.waitForElementState('hidden');
  } finally {
    await loadedConfirmation?.dispose();
  }
}
