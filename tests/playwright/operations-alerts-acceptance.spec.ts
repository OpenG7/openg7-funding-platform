import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { test, expect } from './support/test.js';
import {
  acceptanceComposeArgs,
  acceptanceSql
} from './support/acceptance-database.js';
import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';

interface Alert {
  eventId: string;
  type: string;
  severity: string;
  firstSeen: string;
  adminUrl: string;
}

test.use({ contextOptions: { baseURL: process.env.PLAYWRIGHT_BASE_URL } });

test('operations alert: signed delivery, refusal, lost response, restart, recurrence and protected admin dossier', async ({
  page,
  context,
  request
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable acceptance stack only.'
  );
  test.setTimeout(120000);
  context.setDefaultTimeout(15000);
  const suffix = randomUUID().replaceAll('-', '');
  const failedId = `evt_operations_failed_${suffix}`;
  const stalledId = `evt_operations_stalled_${suffix}`;
  const [{ id: emailId }] = await acceptanceSql<{
    id: string;
  }>(`INSERT INTO email_messages
    (template_key,recipient_email,from_email,subject,text_body,html_body,status,next_attempt_at)
    VALUES ('operations_acceptance','private-${suffix}@simulation.example.test','sender@simulation.example.test',
    'Private synthetic subject','Private synthetic body','Private synthetic body','failed',now()+interval '1 day') RETURNING id`);
  await acceptanceSql(
    `INSERT INTO stripe_events (stripe_event_id,event_type,payload,processing_status,received_at)
    VALUES ($1,'test.operations_incident','{"private":"synthetic payload"}','failed',now()),
    ($2,'test.operations_incident','{"private":"synthetic payload"}','processing',now()-interval '16 minutes')`,
    [failedId, stalledId]
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const script = await readFile(
      new URL('./fixtures/operations-watch-rehearsal.mjs', import.meta.url),
      'utf8'
    );
    const { stdout } = await promisify(execFile)(
      'docker',
      [
        ...acceptanceComposeArgs(),
        'exec',
        '-T',
        '-e',
        'OPENG7_E2E_ISOLATED=1',
        'api',
        'node',
        '--input-type=module',
        '-e',
        script,
        JSON.stringify({ emailId, failedId, stalledId })
      ],
      { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 }
    );
    const result = JSON.parse(stdout) as {
      transportAttempts: number;
      logicalNotifications: number;
      alerts: Alert[];
    };
    expect(result.transportAttempts).toBe(12);
    expect(result.logicalNotifications).toBe(6);
    expect(new Set(result.alerts.map((alert) => alert.eventId)).size).toBe(6);
    expect(result.alerts.map((alert) => alert.type).sort()).toEqual([
      'email_delivery_failed',
      'email_delivery_failed',
      'stripe_event_failed',
      'stripe_event_failed',
      'stripe_event_stalled',
      'stripe_event_stalled'
    ]);
    await info.attach('signed-operations-alerts', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json'
    });

    // The notification conveys no authority: the page and incident APIs still
    // require an administrative session. Login must preserve the alert link.
    expect((await request.get('/api/admin/attention')).status()).toBe(401);
    const adminUrl = result.alerts[0]!.adminUrl;
    await page.goto(adminUrl);
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.locator('[data-og7="attention-panel"]')).toHaveCount(0);
    await page.getByLabel(/Jeton admin/i).fill(ADMIN_TOKEN);
    await page.getByRole('button', { name: /Se connecter/i }).click();
    await expect(page).toHaveURL(adminUrl);
    await expect(page.locator('[data-og7="attention-panel"]')).toBeVisible();

    await page
      .locator('[data-og7="attention-type"]')
      .selectOption('stripe_event_failed');
    const stripe = page.locator(
      `[data-og7="attention-items"] [data-og7-id="stripe_event_failed:${failedId}"]`
    );
    await expect(stripe).toBeVisible();
    await stripe.getByRole('button', { name: /Stripe/ }).click();
    const inspector = page.getByRole('dialog');
    await expect(inspector).toContainText(failedId);
    await expect(inspector).toContainText('test.operations_incident');
    await expect(inspector).not.toContainText('synthetic payload');
    await page.keyboard.press('Escape');
    await expect(inspector).toBeHidden();
    await stripe.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp('itemId=stripe_event_failed'));
    await expect(page.locator('[data-og7="attention-items"]')).toContainText(
      failedId
    );

    // The same notification also works in the English mobile administration.
    await page
      .getByRole('button', {
        name: 'Switch administration language to English'
      })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(adminUrl);
    await page
      .locator('[data-og7="attention-type"]')
      .selectOption('stripe_event_stalled');
    await expect(
      page.locator(`[data-og7-id="stripe_event_stalled:${stalledId}"]`)
    ).toBeVisible();
    await page
      .locator('[data-og7="attention-type"]')
      .selectOption('email_delivery_failed');
    const email = page
      .locator('[data-og7="attention-items"] li')
      .filter({ hasText: emailId });
    await expect(email).toBeVisible();
    await email.getByRole('link').click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/fundraiser/email-queue\\?messageId=${emailId}`)
    );
    await expect(
      page.getByText('Private synthetic subject', { exact: true })
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      )
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    // Keep the rest of a full acceptance run independent of these incidents.
    await acceptanceSql("UPDATE email_messages SET status='sent' WHERE id=$1", [
      emailId
    ]);
    await acceptanceSql(
      "UPDATE stripe_events SET processing_status='processed' WHERE stripe_event_id=ANY($1::text[])",
      [[failedId, stalledId]]
    );
    await acceptanceSql(
      'UPDATE operations_alerts SET resolved_at=COALESCE(resolved_at,now()) WHERE incident_key=ANY($1::text[])',
      [[`email:${emailId}`, `stripe:${failedId}`, `stripe:${stalledId}`]]
    );
  }
});
