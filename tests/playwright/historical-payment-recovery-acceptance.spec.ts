import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import type { Download } from '@playwright/test';
import type {
  AdminSponsorshipInvoicesResponse,
  FundTransparencyPublicResponse
} from '@openg7/funding-core';

import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import {
  acceptanceComposeArgs,
  acceptanceSql
} from './support/acceptance-database.js';
import { signInAsAdmin } from './support/admin-auth.js';
import {
  buildPaymentIntentSucceededEvent,
  buildSignedWebhookRequest,
  buildStripeEvent
} from './support/stripe-webhook.js';
import type { StripeBackfillSummary } from './support/stripe-backfill-cli.js';
import { test, expect } from './support/test.js';

const execute = promisify(execFile);
const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
const minor = (amount: number) => Math.round(amount * 100);
async function downloadBytes(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream())
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test('historical Stripe payment: bounded preview, silent recovery, late events and confirmed missing invoice with stable PDF', async ({
  page,
  request
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable simulation only.'
  );
  test.setTimeout(180000);
  const stub = process.env.STRIPE_STUB_BASE_URL!;
  const suffix = randomUUID().replaceAll('-', '');
  const project = 'history-' + suffix;
  const email = `history-${suffix}@simulation.example.test`;
  const reference = 'OG7-2026-' + suffix.slice(0, 8).toUpperCase();
  const sessionId = 'cs_history_' + suffix;
  const intentId = 'pi_history_' + suffix;
  const token = 'synthetic-history-' + suffix;
  const created = Math.floor(Date.parse('2026-08-10T12:00:00Z') / 1000);
  const metadata = {
    projectId: project,
    contributionType: 'sponsorship_interest',
    publicReference: reference,
    publicDisplayConsent: 'true',
    publicDisplayName: 'Atelier historique ' + suffix.slice(0, 8),
    displayAmountConsent: 'false',
    nonCharityAcknowledged: 'true',
    sponsorshipFollowupToken: token,
    sponsorshipFollowupTokenHash: createHash('sha256')
      .update(token)
      .digest('hex')
  };
  const get = async <T>(url: string, admin = false): Promise<T> => {
    const response = await request.get(url, admin ? { headers } : {});
    expect(response.ok(), url).toBe(true);
    return response.json();
  };
  const summary = () =>
    get<FundTransparencyPublicResponse>('/api/public/fund-transparency');
  const before = await summary();
  const registered = await request.post(stub + '/__test__/payment-intents', {
    data: {
      id: intentId,
      amount: 25000,
      fee: 755,
      currency: 'cad',
      created,
      metadata
    }
  });
  expect(registered.ok()).toBe(true);
  const { chargeId } = await registered.json();
  for (const data of [
    {
      id: sessionId,
      paymentIntentId: intentId,
      amountTotal: 25000,
      currency: 'cad',
      created,
      customerEmail: email,
      metadata
    },
    {
      id: 'cs_unmatched_' + suffix,
      amountTotal: 1100,
      currency: 'cad',
      created,
      metadata: { projectId: 'unrelated' }
    },
    {
      id: 'cs_outside_' + suffix,
      amountTotal: 1200,
      currency: 'cad',
      created: created + 172800,
      metadata: { projectId: project }
    }
  ])
    expect(
      (await request.post(stub + '/__test__/checkout-sessions', { data })).ok()
    ).toBe(true);

  const backfill = async (preview = false, limit = 10) => {
    const { stdout } = await execute(
      'docker',
      [
        ...acceptanceComposeArgs(),
        'exec',
        '-T',
        'api',
        'node',
        'dist/apps/funding-api/src/stripe-backfill.cli.js',
        '--project',
        project,
        '--from',
        '2026-08-10',
        '--to',
        '2026-08-10T23:59:59Z',
        '--limit',
        String(limit),
        '--skip-payouts',
        '--skip-refunds',
        '--skip-disputes',
        ...(preview ? ['--dry-run'] : [])
      ],
      { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 }
    );
    return JSON.parse(
      stdout.slice(stdout.indexOf('{'))
    ) as StripeBackfillSummary;
  };
  const contributions = () =>
    acceptanceSql<{
      id: string;
      public_reference: string;
      payment_notification_recorded_at: string | null;
    }>(
      'SELECT id,public_reference,payment_notification_recorded_at FROM fund_contributions WHERE stripe_session_id=ANY($1::text[])',
      [[sessionId, 'cs_unmatched_' + suffix, 'cs_outside_' + suffix]]
    );
  const ledger = () =>
    acceptanceSql(
      'SELECT * FROM fund_transactions WHERE stripe_object_id=$1 ORDER BY id',
      [intentId]
    );
  expect(await contributions()).toHaveLength(0);
  expect((await backfill(true, 1)).checkoutSessions.scanned).toBe(1);
  const preview = await backfill(true);
  expect(preview.checkoutSessions).toMatchObject({
    scanned: 2,
    matched: 1,
    skippedUnmatched: 1,
    upserted: 0,
    dryRunMatched: 1
  });
  expect(preview.paymentIntents.dryRunWouldInsertTransactions).toBe(1);
  expect(await contributions()).toHaveLength(0);
  expect(await ledger()).toHaveLength(0);
  expect((await summary()).total_received).toBe(before.total_received);

  expect((await backfill()).paymentIntents.insertedTransactions).toBe(1);
  const recovered = await contributions();
  expect(recovered).toHaveLength(1);
  const contributionId = recovered[0]!.id;
  expect(recovered[0]!.public_reference).toBe(reference);
  expect(recovered[0]!.payment_notification_recorded_at).toBeTruthy();
  const originalLedger = await ledger();
  expect(originalLedger).toHaveLength(1);
  const invoices = async () =>
    (
      await get<AdminSponsorshipInvoicesResponse>(
        '/api/admin/sponsorship-invoices?contributionId=' + contributionId,
        true
      )
    ).invoices;
  expect(await invoices()).toHaveLength(0);
  const silent = async () => {
    expect(
      await acceptanceSql(
        'SELECT id FROM contribution_activity WHERE contribution_id=$1',
        [contributionId]
      )
    ).toHaveLength(0);
    expect(
      await acceptanceSql(
        'SELECT id FROM email_messages WHERE recipient_email=$1',
        [email]
      )
    ).toHaveLength(0);
    const captured = await get<{ messages: { To: { Address: string }[] }[] }>(
      stub + '/__test__/mail'
    );
    expect(
      captured.messages.filter((m) => m.To.some((to) => to.Address === email))
    ).toHaveLength(0);
  };
  const correctAmounts = async () => {
    const current = await summary();
    expect(minor(current.total_received) - minor(before.total_received)).toBe(
      25000
    );
    expect(minor(current.total_fees) - minor(before.total_fees)).toBe(755);
    expect(
      minor(current.current_available_estimate) -
        minor(before.current_available_estimate)
    ).toBe(24245);
    expect(current.contributions_count - before.contributions_count).toBe(1);
    expect(current.pending_fee_count).toBe(before.pending_fee_count);
    expect(JSON.stringify(current)).not.toContain(email);
    expect(JSON.stringify(current)).not.toContain(reference);
    return current;
  };
  await silent();
  await correctAmounts();
  const send = async (event: Record<string, unknown>) => {
    const signed = buildSignedWebhookRequest(event);
    const response = await request.post('/api/stripe/webhook', {
      data: signed.body,
      headers: signed.headers
    });
    expect(response.ok(), await response.text()).toBe(true);
  };
  const intentEvent = buildPaymentIntentSucceededEvent({
    eventId: 'evt_history_' + suffix,
    paymentIntentId: intentId,
    chargeId,
    amountCents: 25000
  });
  const checkout = await get<Record<string, unknown>>(
    stub + '/v1/checkout/sessions/' + sessionId
  );
  const checkoutEvent = buildStripeEvent(
    'evt_history_checkout_' + suffix,
    'checkout.session.completed',
    checkout
  );
  const rerun = await Promise.all([
    backfill(),
    send(intentEvent),
    send({ ...intentEvent, id: 'evt_history_distinct_' + suffix })
  ]);
  expect(rerun[0].paymentIntents.insertedTransactions).toBe(0);
  await send(checkoutEvent);
  await send(checkoutEvent);
  expect(await ledger()).toEqual(originalLedger);
  expect(await invoices()).toHaveLength(0);
  await silent();
  await correctAmounts();

  const invoiceEndpoint = '/api/admin/sponsorship-invoices/backfill';
  expect(
    (
      await request.post(invoiceEndpoint, {
        data: { contributionId, limit: 1, confirmation: contributionId }
      })
    ).status()
  ).toBe(401);
  for (const confirmation of [undefined, 'another-contribution']) {
    const rejected = await request.post(invoiceEndpoint, {
      headers,
      data: { contributionId, limit: 1, confirmation }
    });
    expect(rejected.status()).toBe(400);
    expect((await rejected.json()).code).toBe('confirmation_required');
  }
  expect(await invoices()).toHaveLength(0);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signInAsAdmin(page);
  await page.goto('/admin/fundraiser/attention?type=invoice_missing');
  const task = page.locator(
    `[data-og7-id="invoice_missing:${contributionId}"]`
  );
  await expect(task).toBeVisible();
  await expect(task.getByRole('link')).toBeVisible();
  await task.getByRole('link').click();
  await expect(
    page.locator('[data-og7="attention-invoice-target"]')
  ).toContainText(contributionId);
  const generate = page.getByRole('button', {
    name: 'Générer la facture de ce dossier'
  });
  await generate.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Annuler', exact: true })
    .last()
    .click();
  expect(await invoices()).toHaveLength(0);
  await generate.click();
  const response = page.waitForResponse((r) =>
    r.url().endsWith(invoiceEndpoint)
  );
  await page.locator('[data-og7="confirm-action"]').click();
  expect((await response).ok()).toBe(true);
  await expect.poll(async () => (await invoices()).length).toBe(1);
  const invoice = (await invoices())[0]!;
  expect(invoice.total).toBe(250);
  expect(invoice.stripe_session_id).toBe(sessionId);
  await page
    .getByRole('button', { name: new RegExp(invoice.invoice_number) })
    .click();
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /T.lecharger PDF/i }).click();
  const bytes = await downloadBytes(await pdfDownload);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const digest = createHash('sha256').update(bytes).digest('hex');
  await silent();
  const repeat = await request.post(invoiceEndpoint, {
    headers,
    data: { contributionId, limit: 1, confirmation: contributionId }
  });
  expect(repeat.ok()).toBe(true);
  expect((await repeat.json()).created_count).toBe(0);
  await backfill();
  await send({ ...checkoutEvent, id: 'evt_history_checkout_late_' + suffix });
  expect(await invoices()).toEqual([invoice]);
  const pdf = await request.get(
    '/api/admin/sponsorship-invoices/pdf?invoiceId=' + invoice.id,
    { headers }
  );
  expect(pdf.ok()).toBe(true);
  expect(
    createHash('sha256')
      .update(await pdf.body())
      .digest('hex')
  ).toBe(digest);
  await silent();
  expect(await ledger()).toEqual(originalLedger);
  const final = await correctAmounts();
  const audit = await acceptanceSql<{
    metadata: { createdCount: number; invoiceIds: string[] };
  }>(
    "SELECT metadata FROM admin_audit_log WHERE action='sponsorship_invoice.backfill' AND metadata->>'contributionId'=$1 ORDER BY created_at",
    [contributionId]
  );
  expect(audit.map((row) => row.metadata.createdCount)).toEqual([1, 0]);
  expect(audit[0]!.metadata.invoiceIds).toEqual([invoice.id]);
  await page.locator('[data-og7="return-to-attention"]').click();
  await expect(task).toHaveCount(0);
  await info.attach('historical-invoice-resolved.png', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png'
  });
  for (const [prefix, width] of [
    ['', 1280],
    ['/en', 390]
  ] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(prefix + '/fonds-des-batisseurs/transparence');
    await page
      .locator('[data-og7="transparency-period"]')
      .selectOption('2026-08');
    const pending = page.waitForEvent('download');
    await page.locator('[data-og7="transparency-json"]').focus();
    await page.keyboard.press('Enter');
    const exported = (await downloadBytes(await pending)).toString('utf8');
    expect(JSON.parse(exported).monthly_summary).toEqual(
      final.monthly_summary.filter((m) => m.month === '2026-08')
    );
    for (const privateValue of [email, reference, token, intentId])
      expect(exported).not.toContain(privateValue);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      )
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
