import { randomUUID } from 'node:crypto';

import type {
  AdminAuditLogResponse,
  PilotCommand,
  PilotReceipt,
  PilotState,
  PublicationAutomationState
} from '@openg7/funding-core';

import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import { signInAsAdmin } from './support/admin-auth.js';
import { expect, test } from './support/test.js';

// Only the disposable runner supplies this flag and a fresh PostgreSQL database.
// The real API persists these synthetic drafts; social providers remain mocked.
test.skip(
  process.env.OPENG7_E2E_ISOLATED !== '1',
  'Run with yarn test:e2e:acceptance'
);

for (const loseResponse of [false, true]) {
  test(
    loseResponse
      ? 'pilotage recovers a persisted receipt after a lost response without repeating the command'
      : 'pilotage confirmation persists its decision, receipt and audit through the real API',
    async ({ page, request, baseURL }) => {
      expect(new URL(baseURL!).hostname).toBe('127.0.0.1');
      const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
      const automationUrl = '/api/admin/publication-automation';
      const automation = async (): Promise<PublicationAutomationState> => {
        const response = await request.get(automationUrl, { headers });
        expect(response.ok()).toBe(true);
        return response.json();
      };
      const before = await automation();
      expect(before.workerEnabled).toBe(false);
      expect(
        before.feeds.find((feed) => feed.id === 'openg7:facebook')
      ).toMatchObject({
        mode: 'mock',
        paused: true,
        configured: true
      });
      const check = await request.post(automationUrl, {
        headers,
        data: { action: 'check', feedId: 'openg7:facebook' }
      });
      expect(check.ok()).toBe(true);
      const message = `Recette pilotage ${randomUUID()}`;
      const scheduledAt = new Date(Date.now() + 86_400_000).toISOString();
      const composition = await request.post(automationUrl, {
        headers,
        data: {
          action: 'compose',
          feedId: 'openg7:facebook',
          kind: 'news',
          message,
          scheduledAt
        }
      });
      expect(composition.ok()).toBe(true);
      const { id } = (await composition.json()) as { id: string };
      expect(id).toBeTruthy();
      const draft = (await automation()).deliveries.find(
        (delivery) => delivery.id === id
      )!;
      expect(draft).toMatchObject({
        status: 'draft',
        message,
        approvedAt: null,
        publishedAt: null
      });

      await signInAsAdmin(page);
      const commands: PilotCommand[] = [];
      page.on('request', (sent) => {
        if (
          new URL(sent.url()).pathname === '/api/admin/pilotage/command' &&
          sent.method() === 'POST'
        )
          commands.push(sent.postDataJSON() as PilotCommand);
      });
      await page.goto('/admin/fundraiser/pilotage');
      await page
        .locator('[data-og7="pilot-domains"]')
        .getByRole('button', { name: /Publications/ })
        .click();
      const card = page.locator('[data-og7="pilot-decision"]');
      await expect(card).toBeVisible();
      if ((await card.getAttribute('data-og7-id')) !== `publication:${id}`)
        await page
          .locator('[data-og7="pilot-queue"]')
          .getByRole('button', { name: new RegExp(message) })
          .click();
      await expect(card).toHaveAttribute('data-og7-id', `publication:${id}`);
      await expect(card).toContainText(message);

      // Cancelling the first confirmation must leave both the browser and DB unchanged.
      await page.locator('[data-og7="pilot-accept"]').click();
      await expect(
        page.locator('[data-og7="pilot-panel-confirm"]')
      ).toContainText(message);
      await page.keyboard.press('Escape');
      expect(commands).toEqual([]);
      expect(
        (await automation()).deliveries.find((delivery) => delivery.id === id)
          ?.status
      ).toBe('draft');

      let persistedReceipt: PilotReceipt | undefined;
      if (loseResponse) {
        await page.route(
          '**/api/admin/pilotage/command',
          async (route) => {
            // Forward exactly once to the real server, then drop only its response.
            // No API payload or receipt is fabricated by this test.
            const response = await route.fetch({ maxRetries: 0 });
            expect(response.ok()).toBe(true);
            persistedReceipt = (await response.json()) as PilotReceipt;
            await route.abort('failed');
          },
          { times: 1 }
        );
      }
      await page.locator('[data-og7="pilot-accept"]').click();
      const sent = page.waitForRequest(
        (r) =>
          new URL(r.url()).pathname === '/api/admin/pilotage/command' &&
          r.method() === 'POST'
      );
      await page.locator('[data-og7="pilot-confirm"]').click();
      const commandRequest = await sent;
      if (loseResponse) {
        await expect(
          page.getByRole('button', { name: 'Vérifier le résultat' })
        ).toBeVisible();
        await page.reload();
      }
      await expect(page.locator('[data-og7="pilot-receipt"]')).toBeVisible();
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        action: 'publication.approve',
        targetId: id,
        confirmation: id,
        version: String(draft.version)
      });
      // Same browser session/actor: receipt access must pass the real authorization.
      const authorization = commandRequest.headers()['authorization'];
      const sessionHeaders: Record<string, string> = authorization
        ? { Authorization: authorization }
        : {};
      const receiptResponse = await page.request.get(
        `/api/admin/pilotage/receipt?id=${commands[0]!.requestId}`,
        { headers: sessionHeaders }
      );
      expect(receiptResponse.ok()).toBe(true);
      const receipt = (await receiptResponse.json()) as PilotReceipt;
      expect(receipt).toMatchObject({
        requestId: commands[0]!.requestId,
        targetId: id,
        action: 'publication.approve',
        status: 'completed',
        code: 'SCHEDULED'
      });
      if (loseResponse)
        expect(receipt).toEqual({ ...persistedReceipt, reviewedAt: null });

      await page.reload();
      const stateResponse = await page.request.get(
        `/api/admin/pilotage?id=publication:${id}`,
        { headers: sessionHeaders }
      );
      expect(stateResponse.ok()).toBe(true);
      const state = (await stateResponse.json()) as PilotState;
      expect(state.decisions).toEqual([]);
      await expect(
        page.locator(
          `[data-og7="pilot-decision"][data-og7-id="publication:${id}"]`
        )
      ).toHaveCount(0);
      expect(commands).toHaveLength(1);
      const after = await automation();
      expect(after.workerEnabled).toBe(false);
      expect(
        after.feeds.find((feed) => feed.id === 'openg7:facebook')
      ).toMatchObject({ mode: 'mock', paused: true });
      expect(
        after.deliveries.find((delivery) => delivery.id === id)
      ).toMatchObject({
        status: 'approved',
        version: draft.version + 1,
        message,
        scheduledAt,
        approvedAt: expect.any(String),
        publishedAt: null,
        externalPostId: null,
        attempts: 0
      });
      const auditResponse = await request.get('/api/admin/audit-log', {
        headers
      });
      expect(auditResponse.ok()).toBe(true);
      const audit = (await auditResponse.json()) as AdminAuditLogResponse;
      expect(audit.data_source).toBe('database');
      const entries = audit.entries.filter(
        (entry) =>
          entry.entity_id === id &&
          entry.metadata['requestId'] === commands[0]!.requestId
      );
      expect(entries.map((entry) => entry.action).sort()).toEqual([
        'pilotage.completed',
        'pilotage.requested'
      ]);
      expect(entries.every((entry) => entry.actor && entry.created_at)).toBe(
        true
      );
    }
  );
}
