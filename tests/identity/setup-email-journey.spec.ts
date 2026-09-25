import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type PlaywrightWorkerArgs
} from '@playwright/test';
import type { AdminEmailTestRequest } from '@openg7/funding-core';

import { startDisposableProvider } from '../integration/support/disposable-provider.mjs';
import { createSmtpGate } from '../stripe-stub/smtp-gate.mjs';

import { startIdentityStack } from './stack.mjs';

async function signIn(
  playwright: PlaywrightWorkerArgs['playwright'],
  origin: string,
  contexts: BrowserContext[],
  role = 'owner'
): Promise<Page> {
  const context = await playwright.chromium.launchPersistentContext(
    await mkdtemp(join(tmpdir(), 'og7-setup-browser-')),
    {
      baseURL: origin,
      viewport: { width: 1280, height: 1000 }
    }
  );
  contexts.push(context);
  const page = context.pages()[0]!;
  page.setDefaultTimeout(10000);
  await page.goto('/admin/login?returnUrl=%2Fadmin%2Ffundraiser%2Fsetup');
  await page.locator('[data-og7="identity-sign-in"]').click();
  await page.getByLabel('Compte de test').selectOption(role);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page).toHaveURL(/\/admin\/fundraiser/);
  return page;
}

const result = (page: Page) => page.locator('[data-og7="setup-email-result"]');
const send = (page: Page) =>
  page.getByRole('button', { name: /Envoyer un (nouveau )?test/ });
const testUrl = '/api/admin/email/test';
const setupUrl = '/api/admin/setup-status';

test('setup with SMTP disabled explains the unavailable test and never queues a message', async ({
  playwright
}) => {
  const stack = await startIdentityStack();
  const contexts: BrowserContext[] = [];
  try {
    const page = await signIn(playwright, stack.origin, contexts);
    await expect(send(page)).toBeDisabled();
    const setup = await (await page.request.get(setupUrl)).json();
    expect(setup.database.reachable).toBe(true);
    expect(setup.email.smtp_configured).toBe(false);
    expect(
      (
        await page.request.post(testUrl, {
          headers: { Origin: stack.origin },
          data: { requestId: randomUUID(), to: 'recipient@example.test' }
        })
      ).status()
    ).toBe(400);
    expect(
      (await stack.pool.query('SELECT count(*) FROM email_messages')).rows[0]
        .count
    ).toBe('0');
  } finally {
    try {
      await Promise.all(contexts.map((context) => context.close()));
    } finally {
      await stack.stop();
    }
  }
});

test('owner diagnoses SMTP, sends once, recovers a lost response and retries a failed message through the queue', async ({
  playwright
}, info) => {
  const mail = await startDisposableProvider('mail');
  const contexts: BrowserContext[] = [];
  const gate = createSmtpGate({ host: '127.0.0.1', port: mail.ports[1025] });
  let stack: Awaited<ReturnType<typeof startIdentityStack>> | undefined;
  const mailUrl = `http://127.0.0.1:${mail.ports[8025]}`;
  const received = async () =>
    (await (await fetch(mailUrl + '/api/v1/messages')).json()).messages as {
      ID: string;
    }[];
  try {
    gate.server.listen(0, '127.0.0.1');
    await once(gate.server, 'listening');
    const address = gate.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing local SMTP port');
    stack = await startIdentityStack({ smtpPort: address.port });
    const { pool, origin, apiOrigin } = stack;
    const headers = { Origin: origin, 'Content-Type': 'application/json' };
    const owner = await signIn(playwright, origin, contexts);
    const requests: AdminEmailTestRequest[] = [];
    const errors: string[] = [];
    owner.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === testUrl
      )
        requests.push(request.postDataJSON());
    });
    owner.on('pageerror', (error) => errors.push(error.message));
    const messages = async () =>
      (
        await pool.query(
          'SELECT id,status,attempts,last_error,recipient_email FROM email_messages ORDER BY created_at'
        )
      ).rows;
    const audits = async () =>
      (
        await pool.query(
          "SELECT actor,action,entity_id,metadata FROM admin_audit_log WHERE action='email.test.queued' ORDER BY created_at"
        )
      ).rows;
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
    const operator = await signIn(playwright, origin, contexts, 'operator');
    const reader = await signIn(playwright, origin, contexts, 'reader');
    const anonymous = await playwright.request.newContext({ baseURL: origin });
    try {
      await test.step('configuration and tests are private owner operations, with validated input', async () => {
        const setup = await owner.request.get(setupUrl);
        expect(setup.status()).toBe(200);
        expect(setup.headers()['cache-control']).toContain('no-store');
        expect((await setup.json()).email.smtp_configured).toBe(true);
        expect(await setup.text()).not.toContain('synthetic-fixture');
        for (const path of [testUrl, apiOrigin + '/admin/email/test']) {
          const data = { requestId: randomUUID(), to: 'admin@example.test' };
          expect((await anonymous.post(path, { headers, data })).status()).toBe(
            401
          );
          for (const page of [operator, reader]) {
            expect((await page.request.get(setupUrl)).status()).toBe(403);
            expect(
              (await page.request.post(path, { headers, data })).status()
            ).toBe(403);
            expect(
              (
                await page.request.get(path + '?requestId=' + data.requestId)
              ).status()
            ).toBe(403);
          }
          expect(
            (
              await owner.request.post(path, {
                headers: { Origin: 'https://elsewhere.example.test' },
                data
              })
            ).status()
          ).toBe(403);
          for (const invalid of [
            null,
            [],
            { to: data.to },
            { ...data, requestId: 'wrong' },
            { ...data, to: {} },
            { ...data, to: 'not-an-address' },
            { ...data, from: 'forged@example.test' }
          ])
            expect(
              (
                await owner.request.post(path, { headers, data: invalid })
              ).status()
            ).toBe(400);
          expect(
            (
              await owner.request.post(path, {
                headers: { ...headers, 'Content-Type': 'text/plain' },
                data: JSON.stringify(data)
              })
            ).status()
          ).toBe(415);
        }
        expect(await messages()).toEqual([]);
        expect(await audits()).toEqual([]);
      });

      await test.step('a held SMTP exchange cannot be submitted twice or falsely reported as sent', async () => {
        gate.setMode('hold');
        await owner
          .getByRole('textbox', { name: 'Courriel de test', exact: true })
          .fill('recipient@example.test');
        await send(owner).focus();
        await owner.keyboard.press('Enter');
        await expect.poll(() => gate.snapshot().held).toBe(1);
        await expect(
          owner.getByRole('button', { name: /Envoi/ })
        ).toBeDisabled();
        await expect(
          owner.getByRole('textbox', { name: 'Courriel de test', exact: true })
        ).toBeDisabled();
        expect(await received()).toHaveLength(0);
        expect(await messages()).toMatchObject([
          { status: 'sending', attempts: 1 }
        ]);
        const duplicate = await owner.request.post(testUrl, {
          headers,
          data: requests[0]
        });
        expect(await duplicate.json()).toMatchObject({
          sent: false,
          status: 'sending'
        });
        expect(
          (
            await owner.request.post(testUrl, {
              headers,
              data: { ...requests[0], to: 'changed@example.test' }
            })
          ).status()
        ).toBe(409);
        expect(gate.snapshot().connections).toBe(1);
        gate.setMode('allow');
        await expect(result(owner)).toContainText(
          'accepté par le serveur SMTP'
        );
        await expect.poll(async () => (await received()).length).toBe(1);
        const accepted = await messages();
        expect(accepted).toMatchObject([
          {
            status: 'sent',
            attempts: 1,
            recipient_email: 'recipient@example.test'
          }
        ]);
        expect(
          (
            await owner.request.post(testUrl, { headers, data: requests[0] })
          ).status()
        ).toBe(200);
        expect(await messages()).toEqual(accepted);
        expect(await audits()).toHaveLength(1);
        expect(gate.snapshot().connections).toBe(1);
        const mime = await (
          await fetch(mailUrl + '/api/v1/message/' + (await received())[0].ID)
        ).json();
        expect(mime.Subject).toBe('Test courriel OpenG7');
        expect(mime.From.Address).toBe('sender@example.test');
        expect(mime.To[0].Address).toBe('recipient@example.test');
        expect(mime.Text).toContain('OpenG7');
        expect(mime.HTML).toContain('OpenG7');
      });

      await test.step('only the response is lost: refresh and reload reconcile the existing request without another send', async () => {
        await owner.route(
          '**/api/admin/email/test',
          async (route) => {
            const answer = await route.fetch({ maxRetries: 0 });
            expect((await answer.json()).status).toBe('sent');
            await route.abort('failed');
          },
          { times: 1 }
        );
        await send(owner).click();
        await expect(result(owner)).toContainText('Résultat non confirmé');
        await expect(send(owner)).toBeDisabled();
        await owner
          .getByRole('button', { name: 'Actualiser', exact: true })
          .click();
        await expect(result(owner)).toContainText('Résultat non confirmé');
        await owner.reload();
        await expect(result(owner)).toContainText(
          'accepté par le serveur SMTP'
        );
        expect(requests).toHaveLength(2);
        expect(await messages()).toHaveLength(2);
        expect(await received()).toHaveLength(2);
        expect(await audits()).toHaveLength(2);
        const stored = await owner.evaluate(() =>
          Object.entries(sessionStorage).filter(([key]) =>
            key.startsWith('openg7-email-test:')
          )
        );
        expect(stored).toHaveLength(1);
        expect(stored[0][1]).toBe(requests[1].requestId);
      });

      await test.step('a definite SMTP failure remains visible and opens the exact queue message for a confirmed retry', async () => {
        gate.setMode('reject');
        await send(owner).click();
        await expect(result(owner)).toContainText('a échoué');
        await expect(owner.getByRole('alert')).toContainText(
          'Consultez le message'
        );
        await owner
          .getByRole('button', { name: 'Actualiser', exact: true })
          .click();
        await expect(owner.getByRole('alert')).toContainText(
          'Consultez le message'
        );
        const failed = (await messages())[2];
        expect(failed).toMatchObject({ status: 'failed', attempts: 1 });
        expect(failed.last_error).toMatch(/^EMAIL_/);
        const connections = gate.snapshot().connections;
        // Even after backoff, repeating a test request must not act as a retry.
        await pool.query(
          "UPDATE email_messages SET next_attempt_at=now()-interval '1 second' WHERE id=$1",
          [failed.id]
        );
        expect(
          (
            await (
              await owner.request.post(testUrl, { headers, data: requests[2] })
            ).json()
          ).status
        ).toBe('failed');
        expect(gate.snapshot().connections).toBe(connections);
        await owner.locator('[data-og7="setup-email-queue"]').click();
        await expect(owner).toHaveURL(new RegExp('messageId=' + failed.id));
        await expect(owner.locator('tbody tr')).toHaveCount(1);
        const retry = owner.getByRole('button', {
          name: 'Relancer',
          exact: true
        });
        await retry.click();
        await owner
          .getByRole('dialog')
          .getByRole('button', { name: 'Annuler', exact: true })
          .filter({ hasText: 'Annuler' })
          .click();
        expect(gate.snapshot().connections).toBe(connections);
        gate.setMode('allow');
        await retry.click();
        await owner
          .getByRole('dialog')
          .getByRole('button', { name: 'Confirmer', exact: true })
          .click();
        await expect(
          owner.locator('[data-og7="email-retry-result"]')
        ).toContainText(/envoy/i);
        expect((await messages())[2]).toMatchObject({
          status: 'sent',
          attempts: 2,
          id: failed.id
        });
        expect(await received()).toHaveLength(3);
        await owner.goto('/admin/fundraiser/setup');
        await expect(result(owner)).toContainText(
          'accepté par le serveur SMTP'
        );
      });

      await test.step('an expired session clears private configuration and cannot create another email', async () => {
        const before = await messages();
        const current = await (
          await owner.request.get('/api/admin/auth/current')
        ).json();
        await pool.query(
          "UPDATE admin_identity_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",
          [current.sessionId]
        );
        await send(owner).click();
        await expect(owner.getByRole('alert')).toContainText(/session.*expir/i);
        await expect(
          owner.getByRole('textbox', { name: 'Courriel de test', exact: true })
        ).toHaveCount(0);
        expect(await messages()).toEqual(before);
        expect(await audits()).toHaveLength(3);
      });

      await test.step('English mobile setup remains accessible and exposes no SMTP credential', async () => {
        const page = await signIn(playwright, origin, contexts);
        await page
          .getByRole('button', {
            name: 'Switch administration language to English'
          })
          .click();
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(
          page.getByRole('button', { name: 'Send test', exact: true })
        ).toBeEnabled();
        expect(await page.locator('body').innerText()).not.toContain(
          'synthetic-fixture'
        );
        expect(
          (
            await new AxeBuilder({ page })
              .include('openg7-admin-setup-page')
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
              .analyze()
          ).violations
        ).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true);
        await page.locator('[data-og7="setup-configuration-table"]').focus();
        await page.keyboard.press('ArrowRight');
        await expect
          .poll(() =>
            page
              .locator('[data-og7="setup-configuration-table"]')
              .evaluate((element) => element.scrollLeft)
          )
          .toBeGreaterThan(0);
        await info.attach('setup-mobile', {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png'
        });
        expect(
          (await pool.query('SELECT count(*) FROM fund_contributions')).rows[0]
            .count
        ).toBe('0');
        expect(
          (await pool.query('SELECT count(*) FROM publication_deliveries'))
            .rows[0].count
        ).toBe('0');
        expect(errors).toEqual([]);
        await info.attach('setup-test-audit', {
          body: JSON.stringify(await audits()),
          contentType: 'application/json'
        });
      });
    } finally {
      await anonymous.dispose();
    }
  } finally {
    try {
      await Promise.all(contexts.map((context) => context.close()));
    } finally {
      try {
        await stack?.stop();
      } finally {
        try {
          await gate.close();
        } finally {
          await mail.stop();
        }
      }
    }
  }
});
