import { randomUUID } from 'node:crypto';

import type {
  AdminSponsorshipInvoiceRecord,
  AdminSponsorshipInvoicesResponse,
  AdminSponsorshipsResponse,
  FundTransparencyPublicResponse
} from '@openg7/funding-core';

import { test, expect } from './support/test.js';
import { acceptDisplayedSponsorshipOffer } from './support/acceptance-offer.js';
import { adminSessionHeaders, signInAsAdmin } from './support/admin-auth.js';
import {
  acceptanceSql,
  restartAcceptanceApi
} from './support/acceptance-database.js';
import {
  buildPaymentIntentSucceededEvent,
  buildSignedWebhookRequest,
  buildStripeEvent
} from './support/stripe-webhook.js';

interface Refund extends Record<string, unknown> {
  id: string;
  status: string;
  metadata: Record<string, string>;
}
interface Operation {
  id: string;
  status: string;
  stripe_refund_id: string | null;
}
interface ProviderReceipt {
  resourceId: string;
  attempts: { created: boolean; response: string }[];
}
const invoiceSnapshot = (invoice: AdminSponsorshipInvoiceRecord) => ({
  id: invoice.id,
  number: invoice.invoice_number,
  issuedAt: invoice.issued_at,
  total: invoice.total,
  currency: invoice.currency,
  items: invoice.line_items,
  notes: invoice.notes
});

for (const outcome of ['pending_success', 'uncertain_failure'] as const) {
  test(`refund ${outcome}: real admin form, restart, authoritative webhook and no duplicate financial effect`, async ({
    page,
    request
  }, info) => {
    test.skip(
      process.env.OPENG7_E2E_ISOLATED !== '1',
      'Disposable acceptance stack only.'
    );
    test.setTimeout(180000);
    page.setDefaultTimeout(15000);
    const stub = process.env.STRIPE_STUB_BASE_URL!;
    const uncertain = outcome === 'uncertain_failure';
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const get = async <T>(url: string, admin = false): Promise<T> => {
      const response = await request.get(
        url,
        admin ? { headers: await adminSessionHeaders(request) } : {}
      );
      expect(response.ok(), url).toBe(true);
      return response.json() as Promise<T>;
    };
    const summary = () =>
      get<FundTransparencyPublicResponse>('/api/public/fund-transparency');
    const before = await summary();
    const deliver = async (event: Record<string, unknown>) => {
      const signed = buildSignedWebhookRequest(event);
      const response = await request.post('/api/stripe/webhook', {
        headers: signed.headers,
        data: signed.body
      });
      expect(response.status(), await response.text()).toBe(200);
    };
    await page.goto('/fonds-des-batisseurs?intent=sponsorship#support');
    const contribution = page.locator('[data-og7="contribution-form"]');
    await contribution
      .getByRole('button', { name: /Commandite d'entreprise/ })
      .click();
    await contribution
      .getByRole('button', { name: '500 $', exact: true })
      .click();
    await contribution.getByRole('checkbox').nth(0).uncheck();
    await contribution.getByRole('checkbox').nth(1).uncheck();
    await contribution.getByRole('checkbox').nth(2).check();
    await acceptDisplayedSponsorshipOffer(contribution);
    await contribution.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/checkout\/cs_test_/);
    const sessionId = new URL(page.url()).pathname.split('/').at(-1)!;
    const session = await get<{
      payment_intent: string;
      client_reference_id: string;
      metadata: Record<string, string>;
    }>(stub + '/v1/checkout/sessions/' + sessionId);
    await page
      .getByLabel('Courriel simulé')
      .fill(`refund-state-${randomUUID()}@simulation.example.test`);
    await page
      .getByRole('button', { name: 'Confirmer le paiement simulé' })
      .click();
    await expect(page.locator('#followup-companyName')).toBeVisible();
    const registered = await request.post(stub + '/__test__/payment-intents', {
      data: {
        id: session.payment_intent,
        amount: 50000,
        currency: 'cad',
        fee: 1000,
        metadata: session.metadata
      }
    });
    expect(registered.ok()).toBe(true);
    const chargeId = (await registered.json()).chargeId as string;
    await deliver(
      buildPaymentIntentSucceededEvent({
        eventId: 'evt_refund_state_payment_' + randomUUID(),
        paymentIntentId: session.payment_intent,
        chargeId,
        amountCents: 50000
      })
    );
    const sponsor = async () => {
      const list = await get<AdminSponsorshipsResponse>(
        '/api/admin/sponsorships?search=' +
          encodeURIComponent(session.client_reference_id),
        true
      );
      expect(list.items).toHaveLength(1);
      return list.items[0]!;
    };
    const id = (await sponsor()).id;
    const invoice = async () => {
      const response = await get<AdminSponsorshipInvoicesResponse>(
        '/api/admin/sponsorship-invoices?contributionId=' + id,
        true
      );
      expect(response.invoices).toHaveLength(1);
      return response.invoices[0]!;
    };
    const originalInvoice = invoiceSnapshot(await invoice());
    const operations = () =>
      acceptanceSql<Operation>(
        'SELECT id::text,status,stripe_refund_id FROM sponsorship_refund_operations WHERE contribution_id=$1 ORDER BY created_at,id',
        [id]
      );
    const ledger = () =>
      acceptanceSql(
        "SELECT id,metadata_json->>'refundId' AS refund_id FROM fund_transactions WHERE type='charge.refunded' AND metadata_json->>'paymentIntentId'=$1 ORDER BY id",
        [session.payment_intent]
      );
    const charge = () =>
      get<
        { amount_refunded: number; refunds: { data: Refund[] } } & Record<
          string,
          unknown
        >
      >(stub + '/v1/charges/' + chargeId);
    const refundedMinor = async () =>
      Math.round(
        ((await summary()).total_refunded - before.total_refunded) * 100
      );
    expect(
      (
        await request.post(stub + '/__test__/payment-operations', {
          data: {
            kind: 'refund',
            paymentIntentId: session.payment_intent,
            response: uncertain ? 'lost' : 'acknowledged',
            refundStatus: 'pending'
          }
        })
      ).ok()
    ).toBe(true);
    await signInAsAdmin(page);
    const path =
      '/admin/fundraiser/sponsors?sponsorshipId=' + id + '&tab=refund';
    const submitRefund = async () => {
      await page.goto(path);
      await page
        .getByRole('button', { name: 'Rembourser Stripe', exact: true })
        .click();
      const panel = page.getByRole('region', { name: 'Remboursement Stripe' });
      await panel.getByLabel(/Montant a rembourser/).fill('500');
      await panel
        .getByLabel(/Texte de confirmation/)
        .fill(session.client_reference_id);
      await panel
        .getByRole('checkbox', {
          name: /Envoyer le courriel de remboursement/i
        })
        .uncheck();
      const response = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === '/api/admin/sponsorships/refund' &&
          r.request().method() === 'POST'
      );
      await panel
        .getByRole('button', { name: 'Rembourser Stripe', exact: true })
        .click();
      const result = await response;
      await expect(panel).toBeHidden();
      return result;
    };
    const first = await submitRefund();
    expect(first.status()).toBe(uncertain ? 502 : 200);
    if (uncertain) {
      expect(await first.json()).toMatchObject({
        code: 'SPONSORSHIP_REFUND_UNCERTAIN'
      });
      await expect(
        page.getByText('Confirmation de Stripe en attente.', { exact: false })
      ).toBeVisible();
    } else
      expect(await first.json()).toMatchObject({
        refunded: false,
        refundStatus: 'pending',
        refundWorkflowStatus: 'processing'
      });
    const operation = (await operations())[0];
    expect(await operations()).toHaveLength(1);
    expect(operation.status).toBe(uncertain ? 'uncertain' : 'pending');
    const receipt = await get<ProviderReceipt>(
      stub +
        '/__test__/payment-operations?kind=refund&operationId=' +
        operation.id
    );
    expect(receipt.attempts.filter((a) => a.created)).toHaveLength(1);
    const pendingRefund = await get<Refund>(
      stub + '/v1/refunds/' + receipt.resourceId
    );
    expect(pendingRefund).toMatchObject({
      status: 'pending',
      metadata: { openg7RefundOperationId: operation.id }
    });
    expect((await charge()).refunds.data).toHaveLength(1);
    expect((await charge()).amount_refunded).toBe(0);
    expect(await sponsor()).toMatchObject({
      payment_status: 'paid',
      sponsorship_refund_status: 'processing'
    });
    expect(await ledger()).toEqual([]);
    expect(await refundedMinor()).toBe(0);
    const initialNotes = (await invoice()).credit_notes;
    expect(initialNotes).toHaveLength(uncertain ? 0 : 1);
    const opener = page.getByRole('button', {
      name: 'Rembourser Stripe',
      exact: true
    });
    await expect(opener).toBeDisabled();
    const current = await sponsor();
    const blocked = await request.post('/api/admin/sponsorships/refund', {
      headers: await adminSessionHeaders(request),
      data: {
        contributionId: id,
        expectedVersion: current.version,
        confirmationText: session.client_reference_id,
        amount: 500
      }
    });
    expect(blocked.status()).toBe(409);
    expect(await operations()).toHaveLength(1);
    expect((await charge()).refunds.data).toHaveLength(1);

    await restartAcceptanceApi();
    await expect
      .poll(
        async () => {
          try {
            return (
              await request.get('/api/admin/dashboard', {
                headers: await adminSessionHeaders(request)
              })
            ).status();
          } catch {
            return 0;
          }
        },
        { timeout: 45000, intervals: [1000] }
      )
      .toBe(200);
    await page.reload();
    await expect(opener).toBeDisabled();
    expect(await operations()).toEqual([operation]);
    const transition = await request.patch(
      stub + '/__test__/refunds/' + pendingRefund.id,
      { data: { status: uncertain ? 'failed' : 'succeeded' } }
    );
    expect(transition.ok()).toBe(true);
    const event = buildStripeEvent(
      'evt_refund_state_' + randomUUID(),
      uncertain ? 'refund.failed' : 'refund.updated',
      pendingRefund
    );
    // The signed event deliberately retains the pending snapshot. Current provider facts decide.
    await deliver(event);
    await deliver(event);
    expect((await operations())[0]).toMatchObject({
      id: operation.id,
      status: uncertain ? 'failed' : 'succeeded',
      stripe_refund_id: pendingRefund.id
    });
    expect(await sponsor()).toMatchObject({
      payment_status: uncertain ? 'paid' : 'refunded',
      sponsorship_refund_status: uncertain ? 'failed' : 'completed'
    });
    expect(await ledger()).toHaveLength(uncertain ? 0 : 1);
    expect(await refundedMinor()).toBe(uncertain ? 0 : 50000);
    expect((await invoice()).credit_notes).toHaveLength(uncertain ? 0 : 1);
    if (!uncertain) {
      expect((await invoice()).credit_notes[0]).toMatchObject({
        id: initialNotes[0].id,
        issued_at: initialNotes[0].issued_at,
        stripe_refund_id: pendingRefund.id
      });
    }
    await page.reload();
    if (uncertain) {
      await expect(opener).toBeEnabled();
      const retry = await submitRefund(); // A new, confirmed action is permitted only after definitive failure.
      expect(retry.status()).toBe(200);
      expect(await retry.json()).toMatchObject({
        refunded: true,
        refundStatus: 'succeeded'
      });
      expect(await operations()).toHaveLength(2);
      expect((await charge()).refunds.data).toHaveLength(2);
      await deliver(
        buildStripeEvent(
          'evt_refund_retry_' + randomUUID(),
          'charge.refunded',
          await charge()
        )
      );
      await deliver(event); // A late failure for the older operation cannot undo the new confirmed refund.
      expect(await ledger()).toHaveLength(1);
      expect((await invoice()).credit_notes).toHaveLength(1);
      expect(await refundedMinor()).toBe(50000);
      expect(await sponsor()).toMatchObject({
        payment_status: 'refunded',
        sponsorship_refund_status: 'completed'
      });
    } else await expect(opener).toBeDisabled();
    expect(invoiceSnapshot(await invoice())).toEqual(originalInvoice);
    const terminal = await get<ProviderReceipt>(
      stub +
        '/__test__/payment-operations?kind=refund&operationId=' +
        operation.id
    );
    expect(terminal).toEqual(receipt); // Webhook recovery never resubmits the external refund.
    expect(
      await acceptanceSql(
        "SELECT id FROM fund_transactions WHERE type='payment_intent.succeeded' AND stripe_object_id=$1",
        [session.payment_intent]
      )
    ).toHaveLength(1);
    expect(
      await acceptanceSql(
        'SELECT id FROM fund_contributions WHERE stripe_session_id=$1',
        [sessionId]
      )
    ).toHaveLength(1);
    await info.attach('refund-status-recovery', {
      contentType: 'application/json',
      body: JSON.stringify({
        providers: 'simulated',
        outcome,
        operationId: operation.id,
        refundId: pendingRefund.id,
        attempts: receipt.attempts,
        finalOperations: await operations(),
        finalLedger: await ledger()
      })
    });
    expect(errors).toEqual([]);
  });
}
