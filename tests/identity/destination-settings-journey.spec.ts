import { test, expect, type BrowserContext } from '@playwright/test';
import type {
  EngineRoomSnapshot,
  PublicationAutomationState
} from '@openg7/funding-core';

import { startIdentityStack } from './stack.mjs';
import { openAdminIdentity } from './support/admin-browser.js';

test('destination settings: mandatory references, concurrent editors, lost response and revoked OIDC session preserve confirmed state', async ({
  playwright
}) => {
  const stack = await startIdentityStack();
  const contexts: BrowserContext[] = [];
  const endpoint = '/api/admin/publication-automation';
  const feedId = 'openg7:facebook';
  const path = '/admin/fundraiser/publications/destinations/' + feedId;
  const headers = { Origin: stack.origin };
  const anonymous = await playwright.request.newContext({
    baseURL: stack.origin
  });
  try {
    const owner = await openAdminIdentity(
      playwright.chromium,
      stack.origin,
      path
    );
    contexts.push(owner.context);
    for (const role of ['operator', 'reader']) {
      const subject = 'fixture-' + role;
      const created = await owner.page.request.post('/api/admin/access', {
        headers,
        data: {
          subject,
          confirmation: subject,
          role,
          displayName: 'Synthetic ' + role,
          disabled: false
        }
      });
      expect(created.status()).toBe(200);
    }
    const editor = await openAdminIdentity(
      playwright.chromium,
      stack.origin,
      path,
      'owner'
    );
    const reader = await openAdminIdentity(
      playwright.chromium,
      stack.origin,
      path,
      'reader'
    );
    contexts.push(editor.context, reader.context);
    const operator = await openAdminIdentity(
      playwright.chromium,
      stack.origin,
      path,
      'operator'
    );
    contexts.push(operator.context);
    const read = async (): Promise<PublicationAutomationState> => {
      const response = await owner.page.request.get(endpoint);
      expect(response.status()).toBe(200);
      return response.json();
    };
    const currentFeed = async () =>
      (await read()).feeds.find((feed) => feed.id === feedId)!;
    const auditCount = async () =>
      (
        await stack.pool.query(
          "SELECT count(*)::int AS total FROM admin_audit_log WHERE action='publication_automation.settings' AND entity_id=$1",
          [feedId]
        )
      ).rows[0].total as number;
    const initial = await currentFeed();
    const [first, second, third] = [1, 2, 3, 4].filter(
      (value) => value !== initial.capacity
    );
    const legacyRequest = { action: 'settings', settings: initial };
    expect(
      (
        await operator.page.request.post(endpoint, {
          headers,
          data: legacyRequest
        })
      ).status()
    ).toBe(403);
    await expect(
      operator.page.locator('[data-og7="destination-save"]')
    ).toHaveCount(0);
    expect(
      (
        await anonymous.post(endpoint, { headers, data: legacyRequest })
      ).status()
    ).toBe(401);
    expect(
      (
        await reader.page.request.post(endpoint, {
          headers,
          data: legacyRequest
        })
      ).status()
    ).toBe(403);
    await expect(
      reader.page.locator('[data-og7="destination-save"]')
    ).toHaveCount(0);
    const before = await auditCount();
    const missing = await owner.page.request.post(endpoint, {
      headers,
      data: legacyRequest
    });
    expect(missing.status()).toBe(428);
    expect((await missing.json()).code).toBe('SETTINGS_PRECONDITION_REQUIRED');
    expect(await auditCount()).toBe(before);

    const ownerCapacity = owner.page.locator('[formControlName="capacity"]');
    const editorCapacity = editor.page.locator('[formControlName="capacity"]');
    await expect(ownerCapacity).toHaveValue(String(initial.capacity));
    await expect(editorCapacity).toHaveValue(String(initial.capacity));
    await editorCapacity.fill(String(second));
    await ownerCapacity.fill(String(first));
    const saved = owner.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === endpoint &&
        response.request().method() === 'POST'
    );
    await owner.page.locator('[data-og7="destination-save"]').click();
    expect((await saved).status()).toBe(200);
    await expect(
      owner.page.locator('[data-og7="destination-settings"] > p[role="status"]')
    ).toContainText('Enregistré');
    const conflict = editor.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === endpoint &&
        response.request().method() === 'POST'
    );
    await editor.page.locator('[data-og7="destination-save"]').click();
    expect((await conflict).status()).toBe(409);
    await expect(editor.page.getByRole('alert')).toContainText(
      'Les réglages ont changé'
    );
    await expect(editorCapacity).toHaveValue(String(second));
    expect((await currentFeed()).capacity).toBe(first);
    expect(await auditCount()).toBe(before + 1);
    await editor.page
      .locator('[data-og7="destination-reload-settings"]')
      .click();
    await editor.page.getByRole('dialog').getByRole('button').last().click();
    await expect(editorCapacity).toHaveValue(String(first));

    let lostResponses = 0;
    await editor.page.route(
      '**/api/admin/publication-automation',
      async (route) => {
        if (route.request().method() !== 'POST' || lostResponses)
          return route.continue();
        const data = route.request().postDataJSON();
        expect(data.action).toBe('settings');
        expect(data.expectedSettings.capacity).toBe(first);
        expect(Object.keys(data.expectedSettings).sort()).toEqual(
          [
            'id',
            'paused',
            'autoPrepare',
            'timezone',
            'weekdays',
            'localTime',
            'capacity',
            'horizonDays'
          ].sort()
        );
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        lostResponses++;
        await route.abort('failed');
      }
    );
    await editorCapacity.fill(String(third));
    await editor.page.locator('[data-og7="destination-save"]').click();
    await expect(
      editor.page.locator(
        '[data-og7="destination-settings"] > p[role="status"]'
      )
    ).toContainText('retrouvés côté serveur');
    expect(lostResponses).toBe(1);
    expect((await currentFeed()).capacity).toBe(third);
    expect(await auditCount()).toBe(before + 2);
    await expect(
      editor.page.locator('[data-og7="destination-reconcile"]')
    ).toHaveCount(0);

    const session = await editor.page.request.get('/api/admin/auth/current');
    const { sessionId } = await session.json();
    const revoked = await owner.page.request.post('/api/admin/access', {
      headers,
      data: { sessionId, confirmation: sessionId }
    });
    expect(revoked.status()).toBe(200);
    await editorCapacity.fill(String(second));
    const refused = editor.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === endpoint &&
        response.request().method() === 'POST'
    );
    await editor.page.locator('[data-og7="destination-save"]').click();
    expect((await refused).status()).toBe(401);
    await expect(editor.page).toHaveURL(/\/admin\/login\?/);
    expect(new URL(editor.page.url()).searchParams.get('returnUrl')).toBe(path);
    await expect(
      editor.page.locator('[data-og7="destination-save"]')
    ).toHaveCount(0);
    expect((await currentFeed()).capacity).toBe(third);
    expect(await auditCount()).toBe(before + 2);
    expect(
      (
        await stack.pool.query(
          'SELECT count(*)::int AS total FROM publication_deliveries'
        )
      ).rows[0].total
    ).toBe(0);

    const observed = owner.page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/admin/engine-room'
    );
    await owner.page
      .locator('[data-og7="destination-settings"] footer a')
      .click();
    const snapshot: EngineRoomSnapshot = await (await observed).json();
    const feed = snapshot.publications.feeds.find(
      (item) => item.id === feedId
    )!;
    expect(feed.capacity).toBe(third);
    expect(feed.connection).toBe(initial.connection);
    await expect(
      owner.page.locator(`[data-og7="engine-feed"][data-og7-id="${feedId}"]`)
    ).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await anonymous.dispose();
    await stack.stop();
  }
});
