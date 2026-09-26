import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import type {
  PublicationAutomationState,
  PublicationFeedId
} from '@openg7/funding-core';

import { startIdentityStack } from './stack.mjs';
import {
  startSocialProvider,
  type SocialFixtureAccounts
} from './social-provider.mjs';

const endpoint = '/api/admin/publication-automation';
const cockpit = '/admin/fundraiser/publications/automation';
const facebook = 'openg7:facebook',
  linkedin = 'openg7:linkedin',
  witness = 'openg20:facebook';

test('social connections: missing access, wrong account, expiry and provider denial require checked credentials and fresh approval before recovery', async ({
  playwright
}, info) => {
  test.setTimeout(360000);
  const provider = await startSocialProvider();
  const credentials: SocialFixtureAccounts = {
    [linkedin]: {
      accountId: '7002',
      accessToken: 'synthetic-linkedin-initial'
    },
    [witness]: { accountId: '2001', accessToken: 'synthetic-facebook-control' }
  };
  provider.account('synthetic-linkedin-initial', {
    id: '7002',
    channel: 'linkedin',
    checkedId: '9999'
  });
  provider.account('synthetic-facebook-control', {
    id: '2001',
    channel: 'facebook'
  });
  const stack = await startIdentityStack({
    social: { origin: provider.origin, accounts: credentials }
  }).catch(async (error) => {
    await provider.stop();
    throw error;
  });
  const contexts: BrowserContext[] = [];
  const anonymous = await playwright.request.newContext({
    baseURL: stack.origin
  });
  const headers = { Origin: stack.origin };
  const errors: string[] = [];
  const open = async (role: string, width = 1280) => {
    const context = await playwright.chromium.launchPersistentContext(
      await mkdtemp(join(tmpdir(), 'og7-social-access-browser-')),
      {
        baseURL: stack.origin,
        viewport: { width, height: 1000 }
      }
    );
    contexts.push(context);
    context.setDefaultTimeout(10000);
    context.setDefaultNavigationTimeout(15000);
    const page = context.pages()[0]!;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/admin/login?returnUrl=' + encodeURIComponent(cockpit));
    await page.locator('[data-og7="identity-sign-in"]').click();
    await page.getByLabel('Compte de test').selectOption(role);
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page).toHaveURL(cockpit);
    return page;
  };
  const settings = async (page: Page, feedId: PublicationFeedId) => {
    await page.goto(cockpit + '?settings=feeds');
    const [target, channel] = feedId.split(':');
    const card = page.locator('article').filter({
      has: page.getByRole('heading', {
        name: `${target!.toUpperCase()} ${channel === 'facebook' ? 'Facebook' : 'LinkedIn'}`,
        exact: true
      })
    });
    await card.getByRole('button', { name: 'Réglages', exact: true }).click();
    return page.getByRole('dialog', { name: 'Réglages', exact: true });
  };
  const check = async (
    page: Page,
    feedId: PublicationFeedId,
    expected: string
  ) => {
    const drawer = await settings(page, feedId);
    const response = page.waitForResponse(
      (r) => r.url().endsWith(endpoint) && r.request().method() === 'POST'
    );
    await drawer.getByRole('button', { name: 'Vérifier la connexion' }).click();
    expect((await response).status()).toBe(200);
    await expect(drawer.getByRole('status')).toHaveText(expected);
    await drawer.getByRole('button', { name: 'Fermer', exact: true }).click();
  };
  const openJob = async (page: Page, id: string) => {
    await page.goto(cockpit + '?deliveryId=' + id);
    const drawer = page.getByRole('dialog', { name: 'Publication finale' });
    await expect(drawer).toBeVisible();
    return drawer;
  };
  const dateInput = (page: Page, date: Date) =>
    page.evaluate((iso) => {
      const value = new Date(iso);
      return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
    }, date.toISOString());
  const nextDate = () =>
    new Date(Math.ceil((Date.now() + 40000) / 60000) * 60000);
  const edit = async (page: Page, id: string, date: Date) => {
    const drawer = await openJob(page, id);
    await drawer.getByRole('button', { name: 'Modifier', exact: true }).click();
    await drawer
      .locator('input[name="date"]')
      .fill(await dateInput(page, date));
    const response = page.waitForResponse(
      (r) => r.url().endsWith(endpoint) && r.request().method() === 'POST'
    );
    await drawer
      .getByRole('button', { name: 'Enregistrer le brouillon' })
      .click();
    expect((await response).status()).toBe(200);
    return drawer;
  };
  const approve = async (page: Page, id: string) => {
    const drawer = await openJob(page, id);
    const button = drawer.getByRole('button', {
      name: 'Accepter et programmer'
    });
    await expect(button).toBeDisabled();
    await drawer.getByRole('checkbox', { name: /J’approuve/ }).check();
    await expect(button).toBeEnabled();
    const response = page.waitForResponse(
      (r) => r.url().endsWith(endpoint) && r.request().method() === 'POST'
    );
    await button.click();
    expect((await response).status()).toBe(200);
    await expect(drawer).toContainText('Autorisée');
  };
  try {
    await stack.pool.query('UPDATE publication_feeds SET auto_prepare=FALSE');
    const owner = await open('owner');
    const command = async (data: object, status = 200, page = owner) => {
      const response = await page.request.post(endpoint, { headers, data });
      expect(response.status(), await response.text()).toBe(status);
      return response.json();
    };
    const state = async (): Promise<PublicationAutomationState> =>
      (await owner.request.get(endpoint)).json();
    const job = async (id: string) =>
      (await state()).deliveries.find((d) => d.id === id)!;
    const effects = async () =>
      (
        await stack.pool.query(`SELECT
      (SELECT count(*) FROM fund_contributions) AS contributions,
      (SELECT count(*) FROM fund_transactions) AS transactions,
      (SELECT count(*) FROM email_messages) AS emails,
      (SELECT count(*) FROM sponsor_publication_batches) AS batches`)
      ).rows[0];
    const baseline = await effects();
    const ids: Record<string, string> = {};
    const messages = {
      [facebook]: 'Recette locale connexion Facebook',
      [linkedin]: 'Recette locale connexion LinkedIn',
      [witness]: 'Témoin indépendant OpenG20'
    };
    for (const feedId of [facebook, linkedin, witness] as const) {
      ids[feedId] = (
        await command({
          action: 'compose',
          feedId,
          kind: 'news',
          message: messages[feedId],
          scheduledAt: new Date(Date.now() + 86400000).toISOString()
        })
      ).id;
    }
    const beforeFailures = await state();
    await test.step('missing configuration and a mismatched organization fail without publishing or changing drafts', async () => {
      expect((await anonymous.get(endpoint)).status()).toBe(401);
      await check(owner, facebook, 'Connexion en erreur');
      expect(provider.requests).toHaveLength(0);
      await check(owner, linkedin, 'Connexion en erreur');
      expect(provider.requests).toHaveLength(1);
      expect(provider.posts).toHaveLength(0);
      for (const feedId of [facebook, linkedin]) {
        const current = await job(ids[feedId]!);
        expect(
          await command(
            {
              action: 'approve',
              id: current.id,
              version: current.version,
              confirmation: current.id
            },
            409
          )
        ).toMatchObject({ code: 'CONNECTION_REQUIRED' });
      }
      expect((await state()).deliveries).toEqual(beforeFailures.deliveries);
      const readerAccount = await owner.request.post('/api/admin/access', {
        headers,
        data: {
          subject: 'fixture-reader',
          confirmation: 'fixture-reader',
          displayName: 'Lecteur de recette',
          role: 'reader',
          disabled: false
        }
      });
      expect(readerAccount.status()).toBe(200);
      const reader = await open('reader', 390);
      expect(
        await command({ action: 'check', feedId: facebook }, 403, reader)
      ).toBeTruthy();
      expect(
        (
          await owner.request.post(endpoint, {
            headers: { Origin: 'https://foreign.example' },
            data: { action: 'check', feedId: facebook }
          })
        ).status()
      ).toBe(403);
      expect(provider.requests).toHaveLength(1);
      await reader.context().close();
      contexts.splice(contexts.indexOf(reader.context()), 1);
    });
    await test.step('server configuration requires a new check, then exact content approval', async () => {
      credentials[facebook] = {
        accountId: '7001',
        accessToken: 'synthetic-facebook-initial',
        expiresAt: '2099-01-01T00:00:00Z'
      };
      provider.account('synthetic-facebook-initial', {
        id: '7001',
        channel: 'facebook'
      });
      provider.account('synthetic-linkedin-initial', {
        id: '7002',
        channel: 'linkedin'
      });
      await stack.restartSocial(credentials);
      expect(
        (await state()).feeds.find((f) => f.id === facebook)?.connection
      ).toBe('unchecked');
      for (const feedId of [facebook, linkedin, witness] as const) {
        await check(owner, feedId, 'Connexion vérifiée');
        const feed = (await state()).feeds.find((f) => f.id === feedId)!;
        await command({
          action: 'settings',
          settings: { ...feed, paused: false }
        });
      }
      const date = nextDate();
      for (const feedId of [facebook, linkedin, witness]) {
        await edit(owner, ids[feedId]!, date);
        await approve(owner, ids[feedId]!);
      }
      expect(provider.posts).toHaveLength(0);
    });
    await test.step('expiry blocks before dispatch, a provider 403 blocks further attempts, and another destination continues', async () => {
      credentials[facebook]!.expiresAt = '2020-01-01T00:00:00Z';
      provider.account('synthetic-linkedin-initial', {
        id: '7002',
        channel: 'linkedin',
        sendStatus: 403
      });
      await stack.restartSocial(credentials);
      await check(owner, facebook, 'Accès expiré');
      await owner.goto(cockpit);
      const toggle = owner.getByRole('switch', { name: 'Moteur automatique' });
      await toggle.click();
      await expect(owner.locator('[data-og7="confirm-action"]')).toBeVisible();
      await owner.keyboard.press('Escape');
      expect((await state()).workerEnabled).toBe(false);
      await toggle.click();
      await owner.locator('[data-og7="confirm-action"]').click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(
          async () => (await state()).deliveries.map((d) => d.status).sort(),
          { timeout: 130000, intervals: [500] }
        )
        .toEqual(['blocked', 'blocked', 'published']);
      expect(await job(ids[facebook]!)).toMatchObject({
        errorCode: 'CONNECTION_REQUIRED',
        attempts: 1,
        nextAttemptAt: null
      });
      expect(await job(ids[linkedin]!)).toMatchObject({
        errorCode: 'PROVIDER_HTTP_403',
        attempts: 1,
        nextAttemptAt: null
      });
      expect(provider.requests.filter((r) => r.phase === 'send')).toEqual(
        expect.arrayContaining([
          {
            channel: 'linkedin',
            phase: 'send',
            accountId: '7002',
            status: 403
          },
          { channel: 'facebook', phase: 'send', accountId: '2001', status: 201 }
        ])
      );
      expect(provider.requests.filter((r) => r.phase === 'send')).toHaveLength(
        2
      );
      expect(provider.posts).toHaveLength(1);
      await openJob(owner, ids[facebook]!);
      await expect(
        owner.getByRole('dialog', { name: 'Publication finale' })
      ).toContainText('Cet envoi demande une intervention');
    });
    const blocked = [await job(ids[facebook]!), await job(ids[linkedin]!)];
    const publishedControl = await job(ids[witness]!);
    await test.step('renewed credentials and a different account invalidate saved checks without reviving blocked approvals', async () => {
      credentials[facebook] = {
        accountId: '7003',
        accessToken: 'synthetic-facebook-renewed',
        expiresAt: '2099-01-01T00:00:00Z'
      };
      credentials[linkedin] = {
        accountId: '7002',
        accessToken: 'synthetic-linkedin-renewed'
      };
      provider.account('synthetic-facebook-renewed', {
        id: '7003',
        channel: 'facebook'
      });
      provider.account('synthetic-linkedin-renewed', {
        id: '7002',
        channel: 'linkedin'
      });
      await stack.restartSocial(credentials);
      for (const feedId of [facebook, linkedin] as const) {
        expect(
          (await state()).feeds.find((f) => f.id === feedId)?.connection
        ).toBe('unchecked');
        await check(owner, feedId, 'Connexion vérifiée');
        expect(await job(ids[feedId]!)).toEqual(
          blocked.find((d) => d.feedId === feedId)
        );
        const current = await job(ids[feedId]!);
        expect(
          await command(
            {
              action: 'approve',
              id: current.id,
              version: current.version,
              confirmation: current.id
            },
            409
          )
        ).toMatchObject({ code: 'APPROVAL_UNAVAILABLE' });
      }
      expect(provider.requests.filter((r) => r.phase === 'send')).toHaveLength(
        2
      );
      expect(await job(ids[witness]!)).toEqual(publishedControl);
      await owner.setViewportSize({ width: 390, height: 1000 });
      await owner
        .getByRole('button', {
          name: 'Switch administration language to English'
        })
        .click();
      await owner.goto(cockpit + '?settings=feeds');
      await expect(
        owner.locator('[data-og7="publication-feed-settings"]')
      ).toContainText('Connection checked');
      expect(
        await owner.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      ).toBe(true);
      const axe = await new AxeBuilder({ page: owner })
        .include('[data-og7="publication-automation"]')
        .analyze();
      expect(axe.violations).toEqual([]);
      await info.attach('social-recovery-mobile', {
        body: await owner.screenshot(),
        contentType: 'image/png'
      });
      await owner
        .getByRole('button', { name: 'Passer l’administration en français' })
        .click();
      await owner.setViewportSize({ width: 1280, height: 1000 });
      const safeState = JSON.stringify(await state());
      for (const token of [
        'synthetic-facebook-initial',
        'synthetic-linkedin-initial',
        'synthetic-facebook-renewed',
        'synthetic-linkedin-renewed'
      ]) {
        expect(safeState).not.toContain(token);
        expect(await owner.locator('body').innerText()).not.toContain(token);
      }
    });
    await test.step('a fresh reviewed draft binds the new account and sends once after browsers close', async () => {
      const date = nextDate();
      for (const previous of blocked) {
        const drawer = await edit(owner, previous.id, date);
        const current = await job(previous.id);
        expect(current).toMatchObject({ status: 'draft', approvedAt: null });
        if (previous.feedId === facebook) {
          expect(current.accountId).toBe('7003');
          await expect(drawer).toContainText('7003');
        }
        expect(
          await command(
            {
              action: 'approve',
              id: current.id,
              version: previous.version,
              confirmation: current.id
            },
            409
          )
        ).toMatchObject({ code: 'VERSION_CONFLICT' });
        expect(
          await command(
            { action: 'approve', id: current.id, version: current.version },
            400
          )
        ).toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
        await approve(owner, previous.id);
      }
      await owner.context().close();
      contexts.splice(contexts.indexOf(owner.context()), 1);
      await expect
        .poll(
          async () =>
            (
              await stack.pool.query(
                "SELECT count(*)::int AS n FROM publication_deliveries WHERE status='published'"
              )
            ).rows[0].n,
          { timeout: 130000, intervals: [500] }
        )
        .toBe(3);
      expect(provider.posts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            accountId: '7003',
            message: messages[facebook]
          }),
          expect.objectContaining({
            accountId: '7002',
            message: messages[linkedin]
          }),
          expect.objectContaining({
            accountId: '2001',
            message: messages[witness]
          })
        ])
      );
      expect(provider.posts).toHaveLength(3);
      expect(provider.requests.filter((r) => r.phase === 'send')).toHaveLength(
        4
      );
      const checks = provider.requests.filter(
        (r) => r.phase === 'check'
      ).length;
      await stack.pool.query(
        "UPDATE publication_feeds SET checked_at=NOW()-INTERVAL '7 hours' WHERE paused=FALSE"
      );
      await stack.restartSocial(credentials);
      await expect
        .poll(() => provider.requests.filter((r) => r.phase === 'check').length)
        .toBe(checks + 3);
      expect(provider.posts).toHaveLength(3);
      expect(provider.requests.filter((r) => r.phase === 'send')).toHaveLength(
        4
      );
      expect(await effects()).toEqual(baseline);
      const audits = (
        await stack.pool.query(
          "SELECT actor,action,entity_id,metadata FROM admin_audit_log WHERE action LIKE 'publication_automation.%' ORDER BY id"
        )
      ).rows;
      const ownerId = (
        await stack.pool.query(
          "SELECT id FROM admin_accounts WHERE subject='fixture-owner'"
        )
      ).rows[0].id;
      for (const feedId of [facebook, linkedin, witness]) {
        const history = audits.filter((a) => a.entity_id === ids[feedId]);
        const approvals = history.filter(
          (a) => a.action === 'publication_automation.approve'
        );
        expect(approvals).toHaveLength(feedId === witness ? 1 : 2);
        for (const approval of approvals)
          expect(approval).toMatchObject({
            actor: `admin:${ownerId}`,
            metadata: { feedId, mode: 'live' }
          });
        expect(
          history.filter((a) => a.action === 'publication_automation.published')
        ).toEqual([
          expect.objectContaining({
            actor: 'publication-worker',
            metadata: expect.objectContaining({
              feedId,
              externalPostId: provider.posts.find(
                (p) => p.message === messages[feedId as keyof typeof messages]
              )!.id
            })
          })
        ]);
        expect(
          history
            .filter((a) => a.action === 'publication_automation.blocked')
            .map((a) => ({ actor: a.actor, code: a.metadata.code }))
        ).toEqual(
          feedId === witness
            ? []
            : [
                {
                  actor: 'publication-worker',
                  code:
                    feedId === facebook
                      ? 'CONNECTION_REQUIRED'
                      : 'PROVIDER_HTTP_403'
                }
              ]
        );
      }
      expect(JSON.stringify(audits)).not.toContain('synthetic-');
      await info.attach('social-provider-evidence', {
        body: Buffer.from(
          JSON.stringify({
            requests: provider.requests,
            posts: provider.posts,
            audits
          })
        ),
        contentType: 'application/json'
      });
    });
    expect(errors).toEqual([]);
  } finally {
    try {
      await Promise.all(contexts.map((context) => context.close()));
      await anonymous.dispose();
    } finally {
      try {
        await stack.stop();
      } finally {
        await provider.stop();
      }
    }
  }
});
