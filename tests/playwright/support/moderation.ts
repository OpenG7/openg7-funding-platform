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
import type { AdminController } from './admin-controller.js';

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
export async function moderationFixture(
  route: Route,
  subjects: readonly ModerationSubject[]
): Promise<boolean> {
  const url = new URL(route.request().url());
  if (!url.pathname.startsWith('/api/admin/moderation/')) return false;
  const method = route.request().method();
  const read = method === 'GET';
  const resource = url.pathname.slice('/api/admin/moderation/'.length);
  if (
    (read &&
      !['content', 'cases', 'decisions', 'reconsiderations'].includes(
        resource
      )) ||
    (!read &&
      (method !== 'POST' ||
        !['decisions', 'assignment', 'reconsiderations/resolve'].includes(
          resource
        )))
  ) {
    await route.fulfill({ status: 405, json: { code: 'METHOD_NOT_ALLOWED' } });
    return true;
  }
  let payload;
  try {
    payload = read ? undefined : route.request().postDataJSON();
  } catch {
    await route.fulfill({
      status: 400,
      json: { code: 'INVALID_MODERATION_SUBJECT' }
    });
    return true;
  }
  const subject = read
    ? {
        type: url.searchParams.get('subjectType'),
        id: url.searchParams.get('subjectId')
      }
    : payload?.subject;
  if (
    !subjects.some(
      (item) => item.type === subject?.type && item.id === subject?.id
    )
  ) {
    await route.fulfill({
      status: 404,
      json: { code: 'MODERATION_SUBJECT_NOT_FOUND' }
    });
    return true;
  }
  if (url.pathname.endsWith('/content')) {
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
  adverse = false,
  controller?: AdminController
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
      const reason = panel.locator('[data-og7="moderation-primary-reason"]');
      const internal = panel.locator('[data-og7="moderation-internal-reason"]');
      const explanation = panel.locator('[data-og7="moderation-explanation"]');
      if (controller) {
        await controller.select(reason, 'MISLEADING_CLAIM');
        await controller.text(internal, 'Synthetic private rationale');
        await controller.text(explanation, 'Synthetic external explanation');
      } else {
        await reason.selectOption('MISLEADING_CLAIM');
        await internal.fill('Synthetic private rationale');
        await explanation.fill('Synthetic external explanation');
      }
    }
    if (controller) await controller.activate(confirmation);
    else await confirmation.check();
    const submit = panel.locator('[data-og7="moderation-submit"]');
    await expect(submit).toBeEnabled();
    if (controller) await controller.activate(submit);
    else await submit.click();
    // Sequential subjects reuse the panel. Wait for this content's old node,
    // rather than resolving the next subject's newly rendered checkbox.
    await loadedConfirmation!.waitForElementState('hidden');
  } finally {
    await loadedConfirmation?.dispose();
  }
}
