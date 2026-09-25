import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type {
  PilotCommand,
  PilotReceipt,
  ProgrammePlan,
  PublicationAutomationState
} from '@openg7/funding-core';

import { startIdentityStack } from './stack.mjs';

test('weekly programme: preview, discard, stale plan, lost response, renewed approval and expired session', async ({
  playwright
}, info) => {
  const stack = await startIdentityStack();
  const contexts: BrowserContext[] = [];
  const anonymous = await playwright.request.newContext({
    baseURL: stack.origin
  });
  const feedId = 'openg7:facebook';
  const headers = { Origin: stack.origin };
  const endpoint = '/api/admin/publication-automation';
  const programmeUrl = '/api/admin/pilotage/programme';
  const commandUrl = '/api/admin/pilotage/command';
  const open = async (role: string) => {
    const context = await playwright.chromium.launchPersistentContext(
      await mkdtemp(join(tmpdir(), 'og7-programme-browser-')),
      {
        baseURL: stack.origin,
        viewport: { width: 1280, height: 1000 }
      }
    );
    contexts.push(context);
    const page = context.pages()[0]!;
    page.setDefaultTimeout(10000);
    await page.goto('/admin/login?returnUrl=%2Fadmin%2Ffundraiser%2Fpilotage');
    await page.locator('[data-og7="identity-sign-in"]').click();
    await page.getByLabel('Compte de test').selectOption(role);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page).toHaveURL(/\/admin\/fundraiser\/pilotage/);
    return page;
  };
  const programme = (page: Page) =>
    page.locator('[data-og7="editorial-programme"]');
  const calendar = async (page: Page) => {
    await page.locator('[data-og7="open-programme"]').click();
    await expect(programme(page)).toHaveAttribute('aria-busy', 'false');
    await programme(page)
      .getByRole('button', { name: 'Composer la semaine', exact: true })
      .click();
  };
  const propose = async (page: Page) => {
    const response = page.waitForResponse(
      (r) => r.url().endsWith(programmeUrl) && r.request().method() === 'POST'
    );
    await programme(page)
      .getByRole('button', { name: 'Proposer une répartition' })
      .click();
    const received = await response;
    expect(received.status()).toBe(200);
    return received.json() as Promise<{ version: string; plan: ProgrammePlan }>;
  };
  const later = (days: number) =>
    new Date(Date.now() + days * 86400000).toISOString();
  try {
    const owner = await open('owner');
    const mutate = async (data: object) => {
      const response = await owner.request.post(endpoint, { headers, data });
      expect(response.status()).toBe(200);
      return response.json();
    };
    for (const role of ['operator', 'reader']) {
      expect(
        (
          await owner.request.post('/api/admin/access', {
            headers,
            data: {
              subject: 'fixture-' + role,
              confirmation: 'fixture-' + role,
              displayName: role,
              role,
              disabled: false
            }
          })
        ).status()
      ).toBe(200);
    }
    const state = async (): Promise<PublicationAutomationState> =>
      (await owner.request.get(endpoint)).json();
    expect((await state()).workerEnabled).toBe(false);
    for (const id of [feedId, 'openg20:facebook'])
      await mutate({ action: 'check', feedId: id });
    const ids: string[] = [];
    for (const [index, message] of [
      'Actualité fictive A',
      'Actualité fictive B',
      'Témoin autre destination'
    ].entries()) {
      ids.push(
        (
          await mutate({
            action: 'compose',
            feedId: index === 2 ? 'openg20:facebook' : feedId,
            kind: 'news',
            message,
            scheduledAt: later(10 + index)
          })
        ).id
      );
    }
    await mutate({
      action: 'approve',
      id: ids[0],
      version: 1,
      confirmation: ids[0]
    });
    const operator = await open('operator');
    const reader = await open('reader');
    const rows = async () =>
      (
        await stack.pool
          .query(`SELECT id,status,version,message,scheduled_at::text,
      approved_at::text,approved_by,published_at::text FROM publication_deliveries ORDER BY id`)
      ).rows;
    const effects = async () =>
      (
        await stack.pool.query(`SELECT
      (SELECT count(*) FROM admin_command_receipts) AS receipts,
      (SELECT count(*) FROM admin_audit_log) AS audits,
      (SELECT count(*) FROM social_publication_jobs) AS jobs,
      (SELECT count(*) FROM email_messages) AS emails`)
      ).rows[0];
    const original = await rows();
    const baseline = await effects();
    const control = original.find((row) => row.id === ids[2]);
    const commands: PilotCommand[] = [];
    operator.on('request', (request) => {
      if (request.url().endsWith(commandUrl) && request.method() === 'POST')
        commands.push(request.postDataJSON());
    });
    const errors: string[] = [];
    operator.on('pageerror', (error) => errors.push(error.message));

    await test.step('protected, read-only preview and reader boundaries', async () => {
      expect((await anonymous.get(programmeUrl)).status()).toBe(401);
      await calendar(reader);
      await expect(
        programme(reader).getByRole('button', {
          name: 'Proposer une répartition'
        })
      ).toBeDisabled();
      for (const path of [
        programmeUrl,
        stack.apiOrigin + '/admin/pilotage/programme'
      ]) {
        const response = await reader.request.get(path);
        expect(response.status()).toBe(200);
        expect(response.headers()['cache-control']).toContain('no-store');
        expect((await response.json()).writable).toBe(false);
        expect(
          (
            await reader.request.post(path, {
              headers,
              data: { feedId, cadence: 2, includeApproved: true }
            })
          ).status()
        ).toBe(403);
        expect(
          (
            await operator.request.post(path, {
              headers: { Origin: 'https://elsewhere.example.test' },
              data: { feedId, cadence: 2, includeApproved: true }
            })
          ).status()
        ).toBe(403);
      }
      await calendar(operator);
      const proposal = await propose(operator);
      expect(proposal.plan.moves.map((move) => move.id)).toEqual([ids[1]]);
      expect(await rows()).toEqual(original);
      expect(await effects()).toEqual(baseline);
      expect(commands).toHaveLength(0);
    });

    await test.step('include approved content explicitly, rehearse both items, cancel and discard without mutation', async () => {
      await programme(operator).getByRole('checkbox').check();
      const proposal = await propose(operator);
      expect(new Set(proposal.plan.moves.map((move) => move.id))).toEqual(
        new Set(ids.slice(0, 2))
      );
      await expect(
        programme(operator).locator('[data-og7="programme-moves"] li')
      ).toHaveCount(2);
      await programme(operator)
        .getByRole('button', { name: 'Voir le déroulement' })
        .click();
      const rehearsal = programme(operator).locator(
        '[data-og7="programme-rehearsal"]'
      );
      await expect(programme(operator)).toContainText(
        'Simulation visuelle : aucun envoi'
      );
      await expect(rehearsal).toContainText('Actualité fictive A');
      await programme(operator)
        .getByRole('button', { name: 'Publication suivante', exact: true })
        .click();
      await expect(rehearsal).toContainText('Actualité fictive B');
      await programme(operator)
        .getByRole('button', { name: 'Composer la semaine', exact: true })
        .click();
      await programme(operator)
        .getByRole('button', { name: 'Examiner les déplacements' })
        .click();
      await expect(
        programme(operator).locator('[data-og7="programme-confirmation"]')
      ).toContainText('nouvelle approbation');
      await programme(operator)
        .getByRole('button', { name: 'Revenir à la proposition' })
        .click();
      await expect(
        programme(operator).locator('[data-og7="programme-confirmation"]')
      ).toHaveCount(0);
      await programme(operator)
        .getByRole('button', { name: 'Examiner les déplacements' })
        .click();
      await programme(operator)
        .getByRole('button', { name: 'Écarter les déplacements proposés' })
        .click();
      await expect(
        programme(operator).locator('[data-og7="programme-confirmation"]')
      ).toHaveCount(0);
      await expect(
        programme(operator).getByRole('button', {
          name: 'Examiner les déplacements'
        })
      ).toBeDisabled();
      expect(await rows()).toEqual(original);
      expect(await effects()).toEqual(baseline);
      expect(commands).toHaveLength(0);
    });

    await test.step('another operator changes a reviewed item: the whole stale plan is rejected', async () => {
      await propose(operator);
      await programme(operator)
        .getByRole('button', { name: 'Examiner les déplacements' })
        .click();
      const current = (await state()).deliveries.find(
        (row) => row.id === ids[0]
      )!;
      await mutate({
        action: 'edit',
        id: current.id,
        version: current.version,
        message: current.message,
        scheduledAt: later(13),
        mediaId: null
      });
      const updated = await rows();
      const response = operator.waitForResponse((r) =>
        r.url().endsWith(commandUrl)
      );
      await programme(operator)
        .getByRole('button', { name: 'Confirmer l’enregistrement' })
        .click();
      expect(await (await response).json()).toMatchObject({
        status: 'failed',
        code: 'VERSION_CONFLICT'
      });
      await expect(operator.getByRole('alert')).toContainText(
        'Le dossier a changé'
      );
      expect(await rows()).toEqual(updated);
      expect(commands).toHaveLength(1);
    });

    let applied: PilotCommand;
    let persisted: PilotReceipt | undefined;
    await test.step('new plan is applied once, even when its response is lost and the browser reloads', async () => {
      const a = (await state()).deliveries.find((row) => row.id === ids[0])!;
      await mutate({
        action: 'approve',
        id: a.id,
        version: a.version,
        confirmation: a.id
      });
      await calendar(operator);
      await programme(operator).getByRole('checkbox').check();
      const proposal = await propose(operator);
      const prepared: PilotCommand = {
        requestId: randomUUID(),
        action: 'programme.apply',
        targetId: feedId,
        confirmation: feedId,
        version: proposal.version,
        payload: { moves: proposal.plan.moves }
      };
      expect(
        (
          await reader.request.post(commandUrl, { headers, data: prepared })
        ).status()
      ).toBe(403);
      expect(
        (
          await operator.request.post(commandUrl, {
            headers,
            data: { ...prepared, confirmation: '' }
          })
        ).status()
      ).toBe(400);
      const before = await rows();
      await operator.route(
        '**/api/admin/pilotage/command',
        async (route) => {
          const response = await route.fetch({ maxRetries: 0 });
          expect(response.status()).toBe(200);
          persisted = await response.json();
          await route.abort('failed');
        },
        { times: 1 }
      );
      await programme(operator)
        .getByRole('button', { name: 'Examiner les déplacements' })
        .click();
      await programme(operator)
        .getByRole('button', { name: 'Confirmer l’enregistrement' })
        .focus();
      await operator.keyboard.press('Enter');
      await expect(
        operator.getByRole('button', {
          name: 'Vérifier le résultat',
          exact: true
        })
      ).toBeVisible();
      await operator.reload();
      await expect(
        operator.locator('[data-og7="pilot-receipt"]')
      ).toContainText('Brouillon enregistré');
      expect(commands).toHaveLength(2);
      applied = commands[1];
      expect(persisted).toMatchObject({
        status: 'completed',
        requestId: applied.requestId
      });
      const after = await rows();
      for (const move of proposal.plan.moves) {
        const row = after.find((row) => row.id === move.id)!;
        expect(row).toMatchObject({
          status: 'draft',
          version: before.find((row) => row.id === move.id).version + 1,
          approved_at: null,
          approved_by: null,
          published_at: null
        });
        expect(new Date(row.scheduled_at).toISOString()).toBe(move.scheduledAt);
        expect(row.message).toBe(
          before.find((row) => row.id === move.id).message
        );
      }
      expect(after.find((row) => row.id === ids[2])).toEqual(control);
      const postApply = await effects();
      const replay = await operator.request.post(commandUrl, {
        headers,
        data: applied
      });
      expect((await replay.json()).status).toBe('completed');
      expect(await rows()).toEqual(after);
      expect(await effects()).toEqual(postApply);
      const audit = (
        await stack.pool.query(
          "SELECT actor,action,entity_id FROM admin_audit_log WHERE action IN ('pilotage.failed','pilotage.completed') AND metadata->>'command'='programme.apply' ORDER BY created_at"
        )
      ).rows;
      expect(audit).toHaveLength(2);
      const receipts = (
        await stack.pool.query(
          "SELECT request_id,status FROM admin_command_receipts WHERE action='programme.apply' ORDER BY created_at"
        )
      ).rows;
      expect(receipts).toEqual([
        { request_id: commands[0].requestId, status: 'failed' },
        { request_id: applied.requestId, status: 'completed' }
      ]);
      await info.attach('programme-receipts', {
        body: JSON.stringify(receipts),
        contentType: 'application/json'
      });
    });

    await test.step('the changed publication needs a fresh confirmation; session expiry blocks a further plan', async () => {
      const a = (await state()).deliveries.find((row) => row.id === ids[0])!;
      if (
        (await operator
          .locator('[data-og7="pilot-decision"]')
          .getAttribute('data-og7-id')) !==
        'publication:' + a.id
      ) {
        await operator
          .locator('[data-og7="pilot-queue"]')
          .getByRole('button', { name: /Actualité fictive A/ })
          .click();
      }
      await operator.locator('[data-og7="pilot-accept"]').click();
      await expect(
        operator.locator('[data-og7="pilot-panel-confirm"]')
      ).toContainText('Actualité fictive A');
      expect(
        (await state()).deliveries.find((row) => row.id === a.id)?.status
      ).toBe('draft');
      await operator.locator('[data-og7="pilot-confirm"]').click();
      await expect
        .poll(
          async () =>
            (await state()).deliveries.find((row) => row.id === a.id)?.status
        )
        .toBe('approved');
      await calendar(operator);
      await programme(operator)
        .locator('[data-og7="programme-week"]')
        .getByRole('button', { name: /Actualité fictive B/ })
        .click();
      await programme(operator)
        .getByRole('button', { name: '+24 h', exact: true })
        .click();
      await programme(operator)
        .getByRole('button', { name: 'Examiner les déplacements' })
        .click();
      const before = await rows();
      const effectsBefore = await effects();
      const profile = await (
        await operator.request.get('/api/admin/auth/current')
      ).json();
      await stack.pool.query(
        "UPDATE admin_identity_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
        [profile.sessionId]
      );
      const response = operator.waitForResponse((r) =>
        r.url().endsWith(commandUrl)
      );
      await programme(operator)
        .getByRole('button', { name: 'Confirmer l’enregistrement' })
        .click();
      expect((await response).status()).toBe(401);
      await expect(operator.getByRole('alert')).toContainText(
        /session.*expir/i
      );
      expect(await rows()).toEqual(before);
      expect(await effects()).toEqual(effectsBefore);
    });

    await test.step('English mobile rehearsal keeps exact text and performs no dispatch', async () => {
      await owner
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
      await owner.setViewportSize({ width: 390, height: 844 });
      await owner.locator('[data-og7="open-programme"]').click();
      await expect(programme(owner)).toHaveAttribute('aria-busy', 'false');
      await programme(owner)
        .getByRole('button', { name: 'Rehearsal', exact: true })
        .click();
      await programme(owner)
        .getByRole('button', { name: /Actualité fictive A/ })
        .click();
      await expect(
        programme(owner).locator('[data-og7="programme-rehearsal"]')
      ).toContainText('Actualité fictive A');
      expect(
        await owner
          .locator('dialog[open]')
          .evaluate((element) => element.scrollWidth <= element.clientWidth)
      ).toBe(true);
      await info.attach('programme-mobile', {
        body: await owner.screenshot(),
        contentType: 'image/png'
      });
      const final = await state();
      expect(final.workerEnabled).toBe(false);
      expect(final.deliveries.every((row) => !row.publishedAt)).toBe(true);
      expect(final.feeds.every((feed) => feed.paused)).toBe(true);
      const counts = await effects();
      expect(counts.jobs).toBe(baseline.jobs);
      expect(counts.emails).toBe(baseline.emails);
      expect(errors).toEqual([]);
    });
  } finally {
    try {
      await Promise.all(contexts.map((context) => context.close()));
      await anonymous.dispose();
    } finally {
      await stack.stop();
    }
  }
});
