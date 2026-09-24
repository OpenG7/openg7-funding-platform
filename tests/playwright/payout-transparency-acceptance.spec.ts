import { createHash, randomUUID } from 'node:crypto';

import type { Download, Page } from '@playwright/test';
import type {
  AdminSponsorshipInvoicesResponse,
  AdminSponsorshipsResponse,
  AdminTransparencyResponse,
  ContributionActivityResponse,
  FundTransparencyPublicResponse
} from '@openg7/funding-core';

import { ADMIN_TOKEN } from './fixtures/e2e-fixtures.mjs';
import { acceptanceSql } from './support/acceptance-database.js';
import { signInAsAdmin } from './support/admin-auth.js';
import {
  buildChargeUpdatedEvent,
  buildSignedWebhookRequest,
  buildStripeEvent,
  nowUnixSeconds
} from './support/stripe-webhook.js';
import { test, expect } from './support/test.js';

const headers = { 'x-funding-admin-token': ADMIN_TOKEN };
const minor = (value: number) => Math.round(value * 100);
const hook = (page: Page, name: string) => page.locator(`[data-og7="${name}"]`);
async function contents(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

test('250 CAD company: late fees, repeated and failed payouts, replacement and consistent private/public exports', async ({
  page: payer,
  context,
  request
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable simulation only.'
  );
  test.setTimeout(180000);
  context.setDefaultTimeout(15000);
  const stub = process.env.STRIPE_STUB_BASE_URL!;
  const suffix = randomUUID().replaceAll('-', '');
  const email = `payout-${suffix}@simulation.example.test`;
  const company = 'Atelier versements ' + suffix.slice(0, 8);
  const errors: string[] = [];
  payer.on('pageerror', (e) => errors.push(e.message));
  const get = async <T>(url: string, admin = false): Promise<T> => {
    const response = await request.get(url, admin ? { headers } : {});
    expect(response.ok(), url).toBe(true);
    return response.json();
  };
  const summary = () =>
    get<FundTransparencyPublicResponse>('/api/public/fund-transparency');
  const before = await summary();
  const eventIds = new Set<string>();
  const send = async (event: Record<string, unknown>) => {
    eventIds.add(event.id as string);
    const signed = buildSignedWebhookRequest(event);
    const response = await request.post('/api/stripe/webhook', {
      data: signed.body,
      headers: signed.headers
    });
    expect(response.ok(), await response.text()).toBe(true);
  };
  const checkTotals = async (fee: number, payouts: number) => {
    const current = await summary();
    expect(current.currency).toBe('CAD');
    expect(current.data_source).toBe('database');
    expect(current.contributions_count - before.contributions_count).toBe(1);
    expect(minor(current.total_received) - minor(before.total_received)).toBe(
      25000
    );
    expect(minor(current.total_fees) - minor(before.total_fees)).toBe(fee);
    expect(minor(current.total_net) - minor(before.total_net)).toBe(
      25000 - fee
    );
    expect(current.total_refunded).toBe(before.total_refunded);
    expect(
      minor(current.current_available_estimate) -
        minor(before.current_available_estimate)
    ).toBe(25000 - fee);
    expect(minor(current.total_payouts) - minor(before.total_payouts)).toBe(
      payouts
    );
    return current;
  };

  await payer.goto('/fonds-des-batisseurs?intent=sponsorship#support');
  const form = hook(payer, 'contribution-form');
  await form.getByRole('button', { name: '250 $', exact: true }).click();
  await form.getByRole('checkbox').nth(0).check();
  await form.locator('#public-display-name').fill(company);
  await form.getByRole('checkbox').nth(1).uncheck();
  await form.getByRole('checkbox').nth(2).check();
  await form.locator('button[type="submit"]').click();
  await expect(payer).toHaveURL(/\/checkout\/cs_test_/);
  const sessionId = new URL(payer.url()).pathname.split('/').at(-1)!;
  const session = await get<{
    client_reference_id: string;
    payment_intent: string;
    metadata: Record<string, string>;
  }>(stub + '/v1/checkout/sessions/' + sessionId);
  await payer.getByLabel('Courriel simulé').fill(email);
  await payer
    .getByRole('button', { name: 'Confirmer le paiement simulé' })
    .click();
  await expect
    .poll(async () => (await summary()).contributions_count)
    .toBe(before.contributions_count + 1);
  const sponsor = async () =>
    (
      await get<AdminSponsorshipsResponse>(
        '/api/admin/sponsorships?search=' + session.client_reference_id,
        true
      )
    ).items;
  expect(await sponsor()).toHaveLength(1);
  const contribution = (await sponsor())[0]!;
  const invoices = async () =>
    (
      await get<AdminSponsorshipInvoicesResponse>(
        '/api/admin/sponsorship-invoices?contributionId=' + contribution.id,
        true
      )
    ).invoices;
  await expect.poll(async () => (await invoices()).length).toBe(1);
  const invoiceSnapshot = async () =>
    Object.fromEntries(
      Object.entries((await invoices())[0]!).filter(
        ([key]) => !key.startsWith('last_email_')
      )
    );
  const originalInvoice = await invoiceSnapshot();
  const pdfHash = async () => {
    const response = await request.get(
      '/api/admin/sponsorship-invoices/pdf?invoiceId=' +
        (await invoices())[0]!.id,
      { headers }
    );
    expect(response.ok()).toBe(true);
    return createHash('sha256')
      .update(await response.body())
      .digest('hex');
  };
  const originalPdf = await pdfHash();
  expect(
    (await checkTotals(0, 0)).pending_fee_count! - before.pending_fee_count!
  ).toBe(1);

  // A valid payment exists before Stripe makes its fee-bearing balance transaction available.
  const intent = buildStripeEvent(
    'evt_intent_' + suffix,
    'payment_intent.succeeded',
    {
      id: session.payment_intent,
      object: 'payment_intent',
      amount: 25000,
      amount_received: 25000,
      currency: 'cad',
      status: 'succeeded',
      created: nowUnixSeconds(),
      latest_charge: null,
      metadata: session.metadata
    }
  );
  await send(intent);
  expect(
    (await checkTotals(0, 0)).pending_fee_count! - before.pending_fee_count!
  ).toBe(1);
  const registration = await request.post(stub + '/__test__/payment-intents', {
    data: {
      id: session.payment_intent,
      amount: 25000,
      currency: 'cad',
      fee: 755,
      metadata: session.metadata
    }
  });
  expect(registration.ok()).toBe(true);
  const { chargeId, balanceTransactionId } = await registration.json();
  const feeEvent = (id: string) =>
    buildChargeUpdatedEvent({
      eventId: id,
      chargeId,
      balanceTransactionId,
      paymentIntentId: session.payment_intent,
      amountCents: 25000
    });
  const firstFee = feeEvent('evt_fee_' + suffix);
  await send(firstFee);
  expect((await checkTotals(755, 0)).pending_fee_count).toBe(
    before.pending_fee_count
  );
  expect(
    (
      await request.patch(
        stub + '/__test__/balance-transactions/' + balanceTransactionId,
        { data: { fee: 805 } }
      )
    ).ok()
  ).toBe(true);
  await send(feeEvent('evt_fee_corrected_' + suffix));
  await send(firstFee);
  await send(intent);
  await send({ ...firstFee, id: 'evt_old_charge_' + suffix });
  await checkTotals(805, 0);

  const payoutIds = [
    'failed_later',
    'failed_first',
    'replacement',
    'other_month'
  ].map((name) => 'po_' + name + '_' + suffix);
  const payoutEvent = async (
    id: string,
    status: 'paid' | 'failed',
    amount = 10000,
    created = nowUnixSeconds()
  ) => {
    const response = await request.post(stub + '/__test__/payouts', {
      data: { id, amount, currency: 'cad', status, created }
    });
    expect(response.ok()).toBe(true);
    const balanceId = (await response.json()).balanceTransactionId;
    expect(
      (
        await request.patch(
          stub + '/__test__/balance-transactions/' + balanceId,
          { data: { amount: -amount, net: -amount, fee: 0 } }
        )
      ).ok()
    ).toBe(true);
    return buildStripeEvent(
      'evt_payout_' + randomUUID().replaceAll('-', ''),
      'payout.' + status,
      {
        id,
        object: 'payout',
        amount,
        currency: 'cad',
        status,
        created,
        balance_transaction: balanceId,
        destination: 'ba_private_simulation',
        failure_message: status === 'failed' ? 'Synthetic bank rejection' : null
      }
    );
  };
  const paid = await payoutEvent(payoutIds[0]!, 'paid');
  await send(paid);
  await checkTotals(805, 10000);
  const paidRow = await acceptanceSql(
    'SELECT * FROM fund_transactions WHERE stripe_event_id=$1',
    [paid.id]
  );
  await Promise.all([
    send(paid),
    ...Array.from({ length: 3 }, () =>
      send({ ...paid, id: 'evt_repeat_' + randomUUID().replaceAll('-', '') })
    )
  ]);
  await checkTotals(805, 10000);
  const failed = await payoutEvent(payoutIds[0]!, 'failed');
  await send(failed);
  await send(failed);
  await send({ ...paid, id: 'evt_old_paid_' + suffix });
  await checkTotals(805, 0);
  expect(
    await acceptanceSql(
      'SELECT * FROM fund_transactions WHERE stripe_event_id=$1',
      [paid.id]
    )
  ).toEqual(paidRow);

  // Delivery order does not restore a failed transfer. A new transfer has a new identity.
  const oldPaid = await payoutEvent(payoutIds[1]!, 'paid', 7000);
  await send(await payoutEvent(payoutIds[1]!, 'failed', 7000));
  await send(oldPaid);
  await checkTotals(805, 0);
  await send(await payoutEvent(payoutIds[2]!, 'paid'));
  await checkTotals(805, 10000);
  const previousMonthDate = new Date();
  previousMonthDate.setUTCDate(1);
  previousMonthDate.setUTCHours(12, 0, 0, 0);
  previousMonthDate.setUTCMonth(previousMonthDate.getUTCMonth() - 1);
  const previousMonth = previousMonthDate.toISOString().slice(0, 7);
  await send(
    await payoutEvent(
      payoutIds[3]!,
      'paid',
      9000,
      Math.floor(previousMonthDate.getTime() / 1000)
    )
  );
  const final = await checkTotals(805, 19000);
  const oldMonth = final.monthly_summary.find(
    (m) => m.month === previousMonth
  )!;
  const oldMonthBefore = before.monthly_summary.find(
    (m) => m.month === previousMonth
  );
  expect(
    minor(oldMonth.total_payouts) - minor(oldMonthBefore?.total_payouts ?? 0)
  ).toBe(9000);
  expect(oldMonth.contributions_count).toBe(
    oldMonthBefore?.contributions_count ?? 0
  );

  // Every signed event is retained, while the ledger keeps one row per payout outcome.
  const movements = await acceptanceSql<{
    stripe_object_id: string;
    type: string;
    count: number;
  }>(
    'SELECT stripe_object_id,type,count(*)::int AS count FROM fund_transactions WHERE stripe_object_id=ANY($1::text[]) GROUP BY stripe_object_id,type',
    [payoutIds]
  );
  expect(movements).toHaveLength(6);
  expect(movements.every((row) => row.count === 1)).toBe(true);
  const events = await acceptanceSql<{ processing_status: string }>(
    'SELECT processing_status FROM stripe_events WHERE stripe_event_id=ANY($1::text[])',
    [[...eventIds]]
  );
  expect(events).toHaveLength(eventIds.size);
  expect(events.every((row) => row.processing_status === 'processed')).toBe(
    true
  );
  expect(await invoices()).toHaveLength(1);
  expect(await invoiceSnapshot()).toEqual(originalInvoice);
  expect(await pdfHash()).toBe(originalPdf);
  const activity = (
    await get<ContributionActivityResponse>(
      '/api/admin/contribution-activity',
      true
    )
  ).items.filter((item) => item.reference === session.client_reference_id);
  expect(activity).toHaveLength(1);

  const admin = await context.newPage();
  admin.on('pageerror', (e) => errors.push(e.message));
  await signInAsAdmin(admin);
  await admin.goto('/admin/fundraiser/transparency');
  const adminReport = await get<AdminTransparencyResponse>(
    '/api/admin/transparency',
    true
  );
  expect(adminReport.public_summary.total_payouts).toBe(final.total_payouts);
  const displayed = new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD'
  }).format(final.total_payouts);
  const payoutMetric = admin
    .locator('[aria-labelledby="snapshot-title"] dl > div')
    .filter({ has: admin.locator('dt', { hasText: 'Payouts' }) });
  await expect(payoutMetric.locator('dd')).toHaveText(displayed);
  await info.attach('payout-admin.png', {
    body: await admin.screenshot({ fullPage: true }),
    contentType: 'image/png'
  });
  const confidential = [
    email,
    company,
    session.client_reference_id,
    session.payment_intent,
    ...payoutIds,
    'ba_private_simulation',
    'Synthetic bank rejection'
  ];
  for (const locale of [
    { prefix: '', width: 1280 },
    { prefix: '/en', width: 390 }
  ]) {
    await payer.setViewportSize({ width: locale.width, height: 844 });
    await payer.goto(locale.prefix + '/fonds-des-batisseurs/transparence');
    await expect(hook(payer, 'transparency-json')).toBeEnabled();
    const refresh = payer.waitForResponse((r) =>
      r.url().includes('/api/public/fund-transparency')
    );
    await hook(payer, 'transparency-refresh').click();
    expect((await refresh).ok()).toBe(true);
    await hook(payer, 'transparency-period').selectOption('all');
    const download = async (name: string) => {
      const pending = payer.waitForEvent('download');
      await hook(payer, name).focus();
      await payer.keyboard.press('Enter');
      return contents(await pending);
    };
    const allText = await download('transparency-json');
    const all = JSON.parse(allText);
    expect(all.total_received).toBe(final.total_received);
    expect(all.total_fees).toBe(final.total_fees);
    expect(all.total_payouts).toBe(final.total_payouts);
    expect(all.current_available_estimate).toBe(
      final.current_available_estimate
    );
    await hook(payer, 'transparency-period').selectOption(previousMonth);
    const monthText = await download('transparency-json');
    const month = JSON.parse(monthText);
    expect(month.scope).toBe('month');
    expect(month.total_received).toBeUndefined();
    expect(month.monthly_summary).toEqual([oldMonth]);
    const csv = await download('transparency-csv');
    const [heading, ...rows] = csv
      .trim()
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((line) => line.split(','));
    expect(rows).toHaveLength(1);
    expect(rows[0]![heading!.indexOf('month')]).toBe(previousMonth);
    expect(Number(rows[0]![heading!.indexOf('total_payouts')])).toBe(
      oldMonth.total_payouts
    );
    expect(rows[0]![heading!.indexOf('currency')]).toBe('CAD');
    for (const secret of confidential)
      expect(allText + monthText + csv + JSON.stringify(final)).not.toContain(
        secret
      );
    expect(
      await payer.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      )
    ).toBe(true);
    await info.attach(
      `payout-public-${locale.prefix ? 'en-mobile' : 'fr-desktop'}.png`,
      {
        body: await payer.screenshot({ fullPage: true }),
        contentType: 'image/png'
      }
    );
  }
  expect(errors).toEqual([]);
});
