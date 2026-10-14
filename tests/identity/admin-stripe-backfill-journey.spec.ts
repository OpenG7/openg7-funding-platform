import { test, expect, type BrowserContext } from '@playwright/test';

import { startIdentityStack } from './stack.mjs';
import { startIdentityStripeProvider } from './stripe-provider.mjs';
import { openAdminIdentity } from './support/admin-browser.js';

test('admin Stripe backfill: bounded preview, cancellation, stale scope, account change and lost response preserve one financial import', async ({
  playwright
}) => {
  const stripe = await startIdentityStripeProvider();
  let stopStack: (() => Promise<void>) | undefined;
  const contexts: BrowserContext[] = [];
  try {
    const stack = await startIdentityStack({ stripe });
    stopStack = () => stack.stop();
    const owner = await openAdminIdentity(
      playwright.chromium,
      stack.origin,
      '/admin/fundraiser/contributions'
    );
    contexts.push(owner.context);
    const { page } = owner;
    const headers = { Origin: stack.origin };
    const today = new Date().toISOString().slice(0, 10);
    const metadata = {
      projectId: 'openg7',
      publicReference: 'OG7-2026-BACKFILL',
      contributionType: 'personal_support',
      nonCharityAcknowledged: 'true'
    };
    for (const [path, data] of [
      [
        '/__test__/payment-intents',
        {
          id: 'pi_identity_backfill',
          amount: 500,
          fee: 45,
          currency: 'cad',
          metadata
        }
      ],
      [
        '/__test__/checkout-sessions',
        {
          id: 'cs_identity_backfill',
          paymentIntentId: 'pi_identity_backfill',
          amountTotal: 500,
          currency: 'cad',
          metadata
        }
      ]
    ] as const) {
      const seeded = await page.request.post(stripe.origin + path, { data });
      expect(seeded.ok(), await seeded.text()).toBe(true);
    }
    const facts = async () =>
      (
        await stack.pool.query(`SELECT
      (SELECT count(*)::int FROM fund_contributions) contributions,
      (SELECT count(*)::int FROM fund_transactions) transactions,
      (SELECT count(*)::int FROM sponsorship_invoices) invoices,
      (SELECT count(*)::int FROM email_messages) emails,
      (SELECT count(*)::int FROM stripe_events) events`)
      ).rows[0]!;
    const none = {
      contributions: 0,
      transactions: 0,
      invoices: 0,
      emails: 0,
      events: 0
    };
    expect(await facts()).toEqual(none);
    const panel = page.locator('[data-og7="stripe-backfill"]');
    await expect(panel).toBeVisible();
    const dates = panel.locator('input[type=date]');
    await dates.nth(0).fill(today);
    await dates.nth(1).fill(today);
    await panel.locator('input[type=number]').fill('10');
    const preview = async () => {
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/admin/stripe-backfill') &&
          r.request().method() === 'POST'
      );
      await page.locator('[data-og7="stripe-backfill-preview"]').click();
      const received = await response;
      expect(received.status()).toBe(200);
      const { run } = await received.json();
      expect(run).toMatchObject({
        status: 'preview',
        mode: 'test',
        scope: { from: today, to: today, limit: 10 },
        counts: { payments: 1 }
      });
      return run as { id: string; mode: string };
    };
    const execute = page.locator('[data-og7="stripe-backfill-execute"]');
    const first = await preview();
    expect(await facts()).toEqual(none);
    const previewAudit = (
      await stack.pool.query(
        "SELECT actor,metadata FROM admin_audit_log WHERE action='stripe_backfill.preview' AND entity_id=$1",
        [first.id]
      )
    ).rows;
    expect(previewAudit).toHaveLength(1);
    expect(previewAudit[0]!.actor).toMatch(/^admin:/);
    await execute.click();
    await expect(page.getByRole('dialog')).toContainText(
      'acct_identity_fixture'
    );
    await page.keyboard.press('Escape');
    expect(
      (
        await stack.pool.query(
          'SELECT status FROM admin_stripe_backfills WHERE id=$1',
          [first.id]
        )
      ).rows[0]!.status
    ).toBe('preview');
    expect(await facts()).toEqual(none);

    await stack.pool.query(
      "UPDATE admin_stripe_backfills SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
      [first.id]
    );
    await execute.click();
    const expired = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/admin/stripe-backfill') &&
        r.request().method() === 'POST'
    );
    await page.locator('[data-og7="confirm-action"]').click();
    expect((await expired).status()).toBe(409);
    expect(await facts()).toEqual(none);
    await page.locator('[data-og7="stripe-backfill-refresh"]').click();
    const second = await preview();
    stripe.setAccount('acct_identity_changed');
    await execute.click();
    const changed = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/admin/stripe-backfill') &&
        r.request().method() === 'POST'
    );
    await page.locator('[data-og7="confirm-action"]').click();
    const changedResponse = await changed;
    expect(changedResponse.status()).toBe(409);
    expect((await changedResponse.json()).code).toBe('PREVIEW_CHANGED');
    expect(await facts()).toEqual(none);
    stripe.setAccount('acct_identity_fixture');
    await page.locator('[data-og7="stripe-backfill-refresh"]').click();
    const final = await preview();
    expect(final.id).not.toBe(second.id);
    const executions: unknown[] = [];
    page.on('request', (r) => {
      if (
        new URL(r.url()).pathname === '/api/admin/stripe-backfill' &&
        r.method() === 'POST'
      ) {
        const body = r.postDataJSON();
        if (body.action === 'execute') executions.push(body);
      }
    });
    await page.route(
      '**/api/admin/stripe-backfill',
      async (route) => {
        const answer = await route.fetch({ maxRetries: 0 });
        expect(answer.status()).toBe(200);
        expect((await answer.json()).run).toMatchObject({
          id: final.id,
          status: 'completed'
        });
        await route.abort('failed');
      },
      { times: 1 }
    );
    await execute.click();
    await page.locator('[data-og7="confirm-action"]').click();
    await expect(
      page.locator('[data-og7="stripe-backfill-error"]')
    ).toContainText('La réponse n’a pas été reçue');
    await page.reload();
    await expect(
      page.locator('[data-og7="stripe-backfill-result"]')
    ).toContainText('Synchronisation terminée');
    expect(executions).toEqual([
      { action: 'execute', id: final.id, confirmation: 'test:' + final.id }
    ]);
    expect(await facts()).toEqual({
      ...none,
      contributions: 1,
      transactions: 1
    });
    const transaction = (
      await stack.pool.query(
        'SELECT amount::text,fee::text,net::text,currency FROM fund_transactions'
      )
    ).rows;
    expect(transaction).toEqual([
      { amount: '500', fee: '45', net: '455', currency: 'cad' }
    ]);
    const replay = await page.request.post('/api/admin/stripe-backfill', {
      headers,
      data: {
        action: 'execute',
        id: final.id,
        confirmation: 'test:' + final.id
      }
    });
    expect((await replay.json()).run).toMatchObject({
      id: final.id,
      status: 'completed'
    });
    expect(await facts()).toEqual({
      ...none,
      contributions: 1,
      transactions: 1
    });
    expect(
      (
        await stack.pool.query(
          "SELECT action FROM admin_audit_log WHERE entity_id=$1 AND action LIKE 'stripe_backfill.%' ORDER BY created_at",
          [final.id]
        )
      ).rows.map((a) => a.action)
    ).toEqual([
      'stripe_backfill.preview',
      'stripe_backfill.started',
      'stripe_backfill.completed'
    ]);
    for (const role of ['operator', 'reader']) {
      expect(
        (
          await page.request.post('/api/admin/access', {
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
      const other = await openAdminIdentity(
        playwright.chromium,
        stack.origin,
        '/admin/fundraiser/contributions',
        role
      );
      contexts.push(other.context);
      await expect(
        other.page.locator('[data-og7="stripe-backfill-preview"]')
      ).toHaveCount(0);
      expect(
        (
          await other.page.request.post('/api/admin/stripe-backfill', {
            headers,
            data: {
              action: 'preview',
              scope: { from: today, to: today, limit: 10 }
            }
          })
        ).status()
      ).toBe(403);
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    await stopStack?.();
    await stripe.stop();
  }
});
