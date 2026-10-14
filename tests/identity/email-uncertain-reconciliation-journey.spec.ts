import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test, expect } from '@playwright/test';
import type {
  AdminEmailQueueRetryRequest,
  AdminEmailQueueRetryResult
} from '@openg7/funding-core';

import { startDisposableProvider } from '../integration/support/disposable-provider.mjs';
import { createSmtpGate } from '../stripe-stub/smtp-gate.mjs';

import { startIdentityStack } from './stack.mjs';
import { signInAdminIdentity } from './support/admin-browser.js';

test('email uncertain reconciliation: accepted SMTP is never resent; not-sent evidence requires a fresh version and a separate retry', async ({
  playwright
}) => {
  test.setTimeout(180000);
  const mail = await startDisposableProvider('mail');
  const gate = createSmtpGate({ host: '127.0.0.1', port: mail.ports[1025] });
  gate.server.listen(0, '127.0.0.1');
  await once(gate.server, 'listening');
  const address = gate.server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing local SMTP fixture');
  const stack = await startIdentityStack({ smtpPort: address.port });
  const browser = await playwright.chromium.launchPersistentContext(
    await mkdtemp(join(tmpdir(), 'og7-email-reconciliation-')),
    { baseURL: stack.origin, viewport: { width: 1280, height: 1000 } }
  );
  const page = browser.pages()[0]!;
  page.setDefaultTimeout(10000);
  const retryRequests: AdminEmailQueueRetryRequest[] = [];
  page.on('request', (r) => {
    if (
      new URL(r.url()).pathname === '/api/admin/email-queue/retry' &&
      r.method() === 'POST'
    )
      retryRequests.push(r.postDataJSON());
  });
  const received = async () =>
    (
      await (
        await fetch(`http://127.0.0.1:${mail.ports[8025]}/api/v1/messages`)
      ).json()
    ).messages as { ID: string }[];
  const create = async (status: 'failed' | 'uncertain') =>
    (
      await stack.pool.query(
        `INSERT INTO email_messages(id,template_key,recipient_email,from_email,subject,text_body,html_body,status,attempts,max_attempts,delivery_attempt_id)
     VALUES($1,'synthetic_reconciliation','recipient@example.test','sender@example.test','Synthetic reconciliation',
       'Private synthetic body','<p>Private synthetic body</p>',$2,1,5,gen_random_uuid()) RETURNING id`,
        [randomUUID(), status]
      )
    ).rows[0]!.id as string;
  const state = async (id: string) =>
    (
      await stack.pool.query(
        'SELECT status,attempts,max_attempts,updated_at::text FROM email_messages WHERE id=$1',
        [id]
      )
    ).rows[0]!;
  const open = async (id: string) => {
    await page.goto('/admin/fundraiser/email-queue?messageId=' + id);
    const row = page
      .getByRole('row')
      .filter({ hasText: 'recipient@example.test' });
    await expect(row).toBeVisible();
    return row;
  };
  try {
    await signInAdminIdentity(page, '/admin/fundraiser/email-queue', 'owner');
    await expect(page).toHaveURL(/\/admin\/fundraiser/);
    const acceptedId = await create('failed');
    await stack.pool
      .query(`CREATE FUNCTION fail_email_finish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.status='sent' THEN RAISE EXCEPTION 'synthetic finalization outage'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_email_finish BEFORE UPDATE ON email_messages FOR EACH ROW EXECUTE FUNCTION fail_email_finish()`);
    let row = await open(acceptedId);
    await row.getByRole('button', { name: 'Relancer', exact: true }).click();
    const failedFinalization = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/admin/email-queue/retry') &&
        r.request().method() === 'POST'
    );
    await page.locator('[data-og7="confirm-action"]').click();
    expect((await failedFinalization).status()).toBe(503);
    expect((await state(acceptedId)).status).toBe('uncertain');
    expect(await received()).toHaveLength(1);
    await stack.pool.query(
      'DROP TRIGGER fail_email_finish ON email_messages; DROP FUNCTION fail_email_finish()'
    );
    row = await open(acceptedId);
    await expect(
      row.getByRole('button', { name: 'Relancer', exact: true })
    ).toBeDisabled();
    const ordinary = await page.request.post('/api/admin/email-queue/retry', {
      headers: { Origin: stack.origin },
      data: { messageId: acceptedId, requestId: randomUUID() }
    });
    expect(ordinary.status()).toBe(409);
    expect((await ordinary.json()).code).toBe(
      'EMAIL_DELIVERY_RECONCILIATION_REQUIRED'
    );
    await row
      .locator('[data-og7="email-delivery-evidence"]')
      .fill('mailpit:' + (await received())[0]!.ID);
    const markSent = row.locator('[data-og7="email-delivery-mark-sent"]');
    await markSent.click();
    await expect(page.getByRole('dialog')).toContainText(acceptedId);
    await page.keyboard.press('Escape');
    expect((await state(acceptedId)).status).toBe('uncertain');
    await markSent.click();
    const reconciled = page.waitForResponse((r) =>
      r.url().endsWith('/api/admin/email-queue/reconcile')
    );
    await page.locator('[data-og7="confirm-action"]').click();
    expect((await reconciled).status()).toBe(200);
    expect((await state(acceptedId)).status).toBe('sent');
    expect(await received()).toHaveLength(1);
    expect(gate.snapshot().connections).toBe(1);

    const absentId = await create('uncertain');
    row = await open(absentId);
    await row
      .locator('[data-og7="email-delivery-evidence"]')
      .fill('mailpit:no-acceptance');
    await row.locator('[data-og7="email-delivery-mark-not-sent"]').click();
    await stack.pool.query(
      'UPDATE email_messages SET updated_at=clock_timestamp() WHERE id=$1',
      [absentId]
    );
    const conflict = page.waitForResponse((r) =>
      r.url().endsWith('/api/admin/email-queue/reconcile')
    );
    await page.locator('[data-og7="confirm-action"]').click();
    expect((await conflict).status()).toBe(409);
    expect((await state(absentId)).status).toBe('uncertain');
    expect(await received()).toHaveLength(1);
    row = await open(absentId);
    await row
      .locator('[data-og7="email-delivery-evidence"]')
      .fill('mailpit:no-acceptance');
    await row.locator('[data-og7="email-delivery-mark-not-sent"]').click();
    const notSent = page.waitForResponse((r) =>
      r.url().endsWith('/api/admin/email-queue/reconcile')
    );
    await page.locator('[data-og7="confirm-action"]').click();
    expect((await notSent).status()).toBe(200);
    const after = await state(absentId);
    expect(after.status).toBe('failed');
    expect(after.attempts).toBe(after.max_attempts);
    expect(await received()).toHaveLength(1);
    let delivered: AdminEmailQueueRetryResult | undefined;
    let finishDrop!: () => void;
    const responseDropped = new Promise<void>((resolve) => {
      finishDrop = resolve;
    });
    await page.route('**/api/admin/email-queue/retry', async (route) => {
      const response = await route.fetch({ maxRetries: 0 });
      expect(response.status()).toBe(200);
      delivered = (await response.json()) as AdminEmailQueueRetryResult;
      await route.abort('failed');
      finishDrop();
    });
    await row.getByRole('button', { name: 'Relancer', exact: true }).click();
    await page.locator('[data-og7="confirm-action"]').click();
    await expect.poll(() => delivered?.sent).toBe(1);
    await responseDropped;
    await page.unroute('**/api/admin/email-queue/retry');
    expect((await state(absentId)).status).toBe('sent');
    expect(await received()).toHaveLength(2);
    expect(gate.snapshot().connections).toBe(2);
    expect(retryRequests).toHaveLength(2);
    for (const request of retryRequests)
      expect(request.requestId).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
      );
    const replay = await page.request.post('/api/admin/email-queue/retry', {
      headers: { Origin: stack.origin },
      data: retryRequests[1]
    });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({
      requestId: retryRequests[1]!.requestId,
      replayed: true,
      attempted: 1,
      sent: 1,
      message: { id: absentId, status: 'sent' }
    });
    expect(await received()).toHaveLength(2);
    expect(gate.snapshot().connections).toBe(2);
    row = await open(absentId);
    await expect(
      row.getByRole('button', { name: 'Relancer', exact: true })
    ).toBeDisabled();
    const audits = (
      await stack.pool.query(
        "SELECT actor,entity_id,metadata FROM admin_audit_log WHERE action='email_queue.reconcile' ORDER BY created_at"
      )
    ).rows;
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => a.metadata.outcome)).toEqual(['sent', 'not_sent']);
    expect(audits.every((a) => /^admin:/.test(a.actor))).toBe(true);
    expect(JSON.stringify(audits)).not.toContain('Private synthetic body');
    const retryAudit = (
      await stack.pool.query(
        "SELECT actor,action,entity_id,metadata FROM admin_audit_log WHERE action LIKE 'email_queue.retry%' ORDER BY created_at"
      )
    ).rows;
    const intentions = retryAudit.filter(
      (a) => a.action === 'email_queue.retry'
    );
    expect(intentions).toHaveLength(2);
    expect(intentions.map((a) => a.entity_id)).toEqual([acceptedId, absentId]);
    expect(intentions.map((a) => a.metadata.requestId)).toEqual(
      retryRequests.map((r) => r.requestId)
    );
    expect(
      intentions.every(
        (a) => /^admin:/.test(a.actor) && a.metadata.result === 'requested'
      )
    ).toBe(true);
    const results = retryAudit.filter(
      (a) => a.action === 'email_queue.retry.result'
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.metadata).toMatchObject({
      requestId: retryRequests[1]!.requestId,
      result: { sent: 1, sentMessageIds: [absentId] }
    });
    for (const privateValue of [
      'recipient@example.test',
      'Private synthetic body',
      'synthetic-fixture'
    ])
      expect(JSON.stringify(retryAudit)).not.toContain(privateValue);
  } finally {
    await browser.close();
    await stack.stop();
    await gate.close();
    await mail.stop();
  }
});
