import type { Page, Route } from '@playwright/test';

import { expect } from './test.js';

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
  await panel.locator('[data-og7="moderation-confirmation"]').check();
  await panel.locator('[data-og7="moderation-submit"]').click();
}
