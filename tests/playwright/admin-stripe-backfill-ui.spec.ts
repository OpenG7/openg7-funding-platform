import type { Page } from '@playwright/test';
import type { AdminStripeBackfillRun } from '@openg7/funding-core';

import { test, expect } from './support/test.js';

async function setup(page: Page, role = 'owner', authMode = 'oidc') {
  if (authMode === 'token') {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'openg7-admin-session-token',
        'openg7-admin-session.synthetic-owner'
      );
      sessionStorage.setItem(
        'openg7-admin-session-expires-at',
        '2099-01-01T00:00:00Z'
      );
    });
  }
  const scope = { from: '2026-09-01', to: '2026-09-27', limit: 100 };
  const state = {
    current: null as AdminStripeBackfillRun | null,
    posts: [] as Record<string, unknown>[],
    contributionReads: 0,
    failExecute: false,
    signedIn: true,
    executeStatus: 200,
    previewStatus: 200,
    previewCode: 'INVALID_SCOPE',
    mode: 'test' as 'test' | 'live'
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/config'))
      return route.fulfill({ json: { mode: authMode } });
    if (path.endsWith('/auth/current'))
      return route.fulfill(
        state.signedIn && authMode === 'oidc'
          ? {
              json: {
                id: 'owner',
                sessionId: 'owner-session',
                displayName: 'Synthetic owner',
                role,
                expiresAt: '2099-01-01T00:00:00Z'
              }
            }
          : { status: 401, json: {} }
      );
    if (path.endsWith('/contributions')) {
      state.contributionReads++;
      return route.fulfill({
        json: {
          data_source: 'database',
          contributions: [],
          summary: {
            total_count: 0,
            paid_count: 0,
            sponsorship_count: 0,
            total_received: 0,
            currency: 'cad'
          }
        }
      });
    }
    if (path.endsWith('/stripe-backfill')) {
      if (request.method() === 'POST') {
        const input = request.postDataJSON();
        state.posts.push(input);
        if (input.action === 'preview') {
          if (state.previewStatus !== 200)
            return route.fulfill({
              status: state.previewStatus,
              json: { code: state.previewCode }
            });
          state.current = {
            id: '10000000-0000-4000-8000-000000000805',
            status: 'preview',
            mode: state.mode,
            accountId: 'acct_synthetic',
            projectId: 'openg7',
            scope: input.scope ?? scope,
            expiresAt: '2099-01-01T00:00:00Z',
            counts: {
              scanned: 1,
              matched: 1,
              payments: 1,
              refunds: 0,
              disputes: 0,
              missingFees: 0
            }
          };
        } else {
          if (state.executeStatus !== 200) {
            if (state.executeStatus === 401) state.signedIn = false;
            return route.fulfill({
              status: state.executeStatus,
              json: { code: 'REFUSED' }
            });
          }
          state.current = { ...state.current!, status: 'completed' };
          if (state.failExecute) return route.abort('failed');
        }
      }
      return route.fulfill({ json: { run: state.current } });
    }
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto('/admin/fundraiser/contributions');
  return state;
}

for (const locale of ['fr', 'en']) {
  for (const width of [390, 1280]) {
    test(`Stripe recovery preview, cancellation, confirmation and refresh in ${locale} at ${width}px`, async ({
      page
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const state = await setup(page);
      if (locale === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      const preview = page.locator('[data-og7="stripe-backfill-preview"]');
      const execute = page.locator('[data-og7="stripe-backfill-execute"]');
      const result = page.locator('[data-og7="stripe-backfill-result"]');
      await expect(execute).toHaveCount(0);
      await preview.click();
      await expect(result).toContainText('acct_synthetic');
      await expect(result).toContainText(
        locale === 'en' ? 'Test mode' : 'Mode test'
      );
      expect(state.posts).toHaveLength(1);
      await execute.click();
      await expect(page.locator('dialog[open]')).toContainText('openg7');
      await page.keyboard.press('Escape');
      await expect(execute).toBeFocused();
      expect(state.posts).toHaveLength(1);
      await page
        .locator('[data-og7="stripe-backfill"] input[type=number]')
        .fill('50');
      await expect(result).toHaveCount(0);
      await preview.click();
      await execute.click();
      const accept = page.locator('[data-og7="confirm-action"]');
      await accept.focus();
      await page.keyboard.press('Enter');
      await expect(result).toContainText(
        locale === 'en' ? 'Sync completed' : 'Synchronisation terminée'
      );
      expect(state.posts.filter((post) => post.action === 'execute')).toEqual([
        {
          action: 'execute',
          id: state.current!.id,
          confirmation: 'test:' + state.current!.id
        }
      ]);
      await expect.poll(() => state.contributionReads).toBeGreaterThan(1);
      await expect(execute).toHaveCount(0);
      await page.locator('[data-og7="stripe-backfill-refresh"]').click();
      expect(
        state.posts.filter((post) => post.action === 'execute')
      ).toHaveLength(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
    });
  }
}

test('Stripe recovery reconciles a lost response without sending another mutation', async ({
  page
}) => {
  const state = await setup(page);
  state.failExecute = true;
  await page.locator('[data-og7="stripe-backfill-preview"]').click();
  await page.locator('[data-og7="stripe-backfill-execute"]').click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(
    page.locator('[data-og7="stripe-backfill-error"]')
  ).toContainText('La réponse n’a pas été reçue');
  await expect(
    page.locator('[data-og7="stripe-backfill-preview"]')
  ).toBeDisabled();
  await page.locator('[data-og7="stripe-backfill-refresh"]').click();
  await expect(
    page.locator('[data-og7="stripe-backfill-result"]')
  ).toContainText('Synchronisation terminée');
  expect(state.posts.filter((post) => post.action === 'execute')).toHaveLength(
    1
  );
});

test('Stripe live mode is explicit and validation and expiration remain visible', async ({
  page
}) => {
  const state = await setup(page);
  state.previewStatus = 400;
  await page.locator('[data-og7="stripe-backfill-preview"]').click();
  await expect(
    page.locator('[data-og7="stripe-backfill-error"]')
  ).toContainText('Vérifiez les dates');
  state.previewStatus = 200;
  state.mode = 'live';
  await page.locator('[data-og7="stripe-backfill-preview"]').click();
  await expect(
    page.locator('[data-og7="stripe-backfill-result"]')
  ).toContainText('données financières réelles');
  state.current = { ...state.current!, expiresAt: '2000-01-01T00:00:00Z' };
  await page.locator('[data-og7="stripe-backfill-refresh"]').click();
  await expect(
    page.locator('[data-og7="stripe-backfill-execute"]')
  ).toBeDisabled();
  await expect(
    page.locator('[data-og7="stripe-backfill-result"]')
  ).toContainText('Cet aperçu a expiré');
});

for (const authMode of ['oidc', 'token']) {
  for (const locale of ['fr', 'en']) {
    test(`Stripe recovery distinguishes an origin refusal from owner permissions in ${locale} with ${authMode}`, async ({
      page
    }) => {
      const state = await setup(page, 'owner', authMode);
      if (locale === 'en')
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
      state.previewStatus = 403;
      state.previewCode = 'ORIGIN_FORBIDDEN';
      const preview = page.locator('[data-og7="stripe-backfill-preview"]');
      const error = page.locator('[data-og7="stripe-backfill-error"]');
      const ownerMessage =
        locale === 'en' ? 'Only the owner' : 'réservée au propriétaire';
      await preview.click();
      await expect(error).toContainText(
        locale === 'en' ? 'address used to open' : 'L’adresse utilisée'
      );
      await expect(error).not.toContainText(ownerMessage);
      await expect(page).toHaveURL(/\/admin\/fundraiser\/contributions/);
      expect(state.posts).toHaveLength(1);
      state.previewCode = 'FORBIDDEN';
      await preview.click();
      await expect(error).toContainText(ownerMessage);
      state.previewStatus = 200;
      await preview.click();
      await expect(
        page.locator('[data-og7="stripe-backfill-result"]')
      ).toContainText('acct_synthetic');
      expect(state.posts.every((post) => post.action === 'preview')).toBe(true);
    });
  }
}

for (const role of ['reader', 'operator']) {
  test(`Stripe recovery offers no mutations to ${role}`, async ({ page }) => {
    const state = await setup(page, role);
    await expect(page.locator('[data-og7="stripe-backfill"]')).toContainText(
      'réservée au propriétaire'
    );
    await expect(
      page.locator('[data-og7="stripe-backfill-preview"]')
    ).toHaveCount(0);
    expect(state.posts).toHaveLength(0);
  });
}

test('Stripe recovery clears its private preview when the session expires', async ({
  page
}) => {
  const state = await setup(page);
  await page.locator('[data-og7="stripe-backfill-preview"]').click();
  state.executeStatus = 401;
  await page.locator('[data-og7="stripe-backfill-execute"]').click();
  await page.locator('[data-og7="confirm-action"]').click();
  await expect(page.locator('[data-og7="stripe-backfill-result"]')).toHaveCount(
    0
  );
  await expect(page).toHaveURL(/\/admin\/login/);
});
