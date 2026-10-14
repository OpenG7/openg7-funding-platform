import { randomUUID } from 'node:crypto';

import type { FundTransparencyPublicResponse } from '@openg7/funding-core';

import { navigatePublicPageAfterNetworkChange } from '../support/public-navigation.mjs';

import { test, expect } from './support/test.js';
import { adminSessionHeaders } from './support/admin-auth.js';
import { prepareCheckoutGate } from './support/acceptance-checkout-gate.js';
import {
  acceptanceSql,
  restartAcceptanceApi
} from './support/acceptance-database.js';
import {
  buildPaymentIntentSucceededEvent,
  buildSignedWebhookRequest
} from './support/stripe-webhook.js';

interface Operation {
  id: string;
  state: string;
  has_result: boolean;
}
interface Receipt {
  resourceId: string;
  attempts: { created: boolean; response: string }[];
}
interface Session {
  id: string;
  payment_intent: string;
  client_reference_id: string;
  metadata: Record<string, string>;
}

test('accepted Checkout survives lost provider responses, API restart and browser reload with one session and payment', async ({
  page,
  request
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Disposable acceptance stack only.'
  );
  test.setTimeout(180000);
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(30000);
  const stub = process.env.STRIPE_STUB_BASE_URL!;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const posts: { idempotencyKey: string }[] = [];
  let gate: Awaited<ReturnType<typeof prepareCheckoutGate>> | undefined;
  let operationId: string | undefined;
  let bodyFailed = false;
  const get = async <T>(url: string): Promise<T> => {
    const response = await request.get(url);
    expect(response.ok(), url).toBe(true);
    return response.json() as Promise<T>;
  };
  const summary = () =>
    get<FundTransparencyPublicResponse>('/api/public/fund-transparency');
  const before = await summary();
  await page.route('**/api/checkout-sessions', async (route) => {
    posts.push(route.request().postDataJSON());
    if (posts.length === 1)
      gate = await prepareCheckoutGate(posts[0].idempotencyKey);
    // This is a real API request. Only its preparation gate is controlled;
    // no application or provider response is manufactured in the browser.
    await route.continue();
  });
  try {
    await page.goto('/fonds-des-batisseurs#support');
    const form = page.locator('[data-og7="contribution-form"]');
    await form
      .getByRole('button', { name: /Contribution personnelle/i })
      .click();
    await form.getByRole('button', { name: '25 $', exact: true }).click();
    await form.getByRole('checkbox').nth(0).uncheck();
    await form.getByRole('checkbox').nth(1).uncheck();
    await form.getByRole('checkbox').nth(2).check();
    const firstResponse = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/checkout-sessions' &&
        r.request().method() === 'POST',
      { timeout: 30000 }
    );
    await form.locator('button[type="submit"]').click();
    await expect.poll(() => Boolean(gate)).toBe(true);
    const operations = () =>
      acceptanceSql<Operation>(
        'SELECT id::text,state,provider_result IS NOT NULL AS has_result FROM checkout_operations WHERE key_hash=$1',
        [gate!.keyHash]
      );
    await expect.poll(async () => (await operations()).length).toBe(1);
    const prepared = (await operations())[0];
    operationId = prepared.id;
    expect(prepared).toMatchObject({ state: 'prepared', has_result: false });
    expect(
      (
        await request.post(stub + '/__test__/payment-operations', {
          data: { kind: 'checkout', operationId, response: 'lost' }
        })
      ).ok()
    ).toBe(true);
    await gate!.release();
    const refused = await firstResponse;
    expect(refused.status()).toBe(502);
    expect(await refused.json()).toMatchObject({
      code: 'CHECKOUT_PROVIDER_UNAVAILABLE'
    });
    await expect(form.getByRole('alert')).toBeVisible();
    const receipt = () =>
      get<Receipt>(
        stub +
          '/__test__/payment-operations?kind=checkout&operationId=' +
          operationId
      );
    const accepted = await receipt();
    expect(accepted.attempts.length).toBeGreaterThanOrEqual(2);
    expect(accepted.attempts.filter((a) => a.created)).toHaveLength(1);
    expect(accepted.attempts.every((a) => a.response === 'lost')).toBe(true);
    expect(await operations()).toEqual([
      { id: operationId, state: 'uncertain', has_result: false }
    ]);
    const session = await get<Session>(
      stub + '/v1/checkout/sessions/' + accepted.resourceId
    );
    expect(
      await acceptanceSql(
        'SELECT id FROM fund_contributions WHERE stripe_session_id=$1',
        [session.id]
      )
    ).toEqual([]);
    expect((await summary()).total_received).toBe(before.total_received);
    const retained = await page.evaluate(() =>
      localStorage.getItem('openg7.checkout-attempts.v2')
    );
    expect(retained).toContain(posts[0].idempotencyKey);

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
    expect(await operations()).toEqual([
      { id: operationId, state: 'uncertain', has_result: false }
    ]);
    await navigatePublicPageAfterNetworkChange(
      page,
      page.url(),
      async () => {
        // The form is prerendered: visible HTML alone does not prove that
        // its lazy JavaScript loaded and Angular attached the handlers.
        const component = page.locator('openg7-funding-contribution-form');
        await expect(component).toBeVisible({ timeout: 10000 });
        await expect(component).not.toHaveAttribute('ngh', { timeout: 10000 });
        await expect(
          form.getByRole('button', { name: /Contribution personnelle/i })
        ).toBeVisible({ timeout: 10000 });
      },
      { navigation: 'reload' }
    );
    expect(
      await page.evaluate(() =>
        localStorage.getItem('openg7.checkout-attempts.v2')
      )
    ).toContain(posts[0].idempotencyKey);
    expect(posts).toHaveLength(1);
    expect(
      (
        await request.post(stub + '/__test__/payment-operations', {
          data: { kind: 'checkout', operationId, response: 'acknowledged' }
        })
      ).ok()
    ).toBe(true);
    await form
      .getByRole('button', { name: /Contribution personnelle/i })
      .click();
    await form.getByRole('button', { name: '25 $', exact: true }).click();
    await form.getByRole('checkbox').nth(2).check();
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(new RegExp('/checkout/' + session.id + '$'));
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(await operations()).toEqual([
      { id: operationId, state: 'completed', has_result: true }
    ]);
    const recovered = await receipt();
    expect(recovered.resourceId).toBe(session.id);
    expect(recovered.attempts.filter((a) => a.created)).toHaveLength(1);
    expect(recovered.attempts.at(-1)?.response).toBe('acknowledged');
    expect(
      await acceptanceSql(
        'SELECT id FROM fund_contributions WHERE stripe_session_id=$1',
        [session.id]
      )
    ).toHaveLength(1);

    await page
      .getByLabel('Courriel simulé')
      .fill(`checkout-${randomUUID()}@simulation.example.test`);
    await page
      .getByRole('button', { name: 'Confirmer le paiement simulé' })
      .click();
    await expect(page).toHaveURL(/checkout=success/);
    const registered = await request.post(stub + '/__test__/payment-intents', {
      data: {
        id: session.payment_intent,
        amount: 2500,
        currency: 'cad',
        fee: 73,
        metadata: session.metadata
      }
    });
    expect(registered.ok()).toBe(true);
    const signed = buildSignedWebhookRequest(
      buildPaymentIntentSucceededEvent({
        eventId: 'evt_checkout_recovered_' + randomUUID(),
        paymentIntentId: session.payment_intent,
        chargeId: (await registered.json()).chargeId,
        amountCents: 2500
      })
    );
    for (let attempt = 0; attempt < 2; attempt++)
      expect(
        (
          await request.post('/api/stripe/webhook', {
            data: signed.body,
            headers: signed.headers
          })
        ).status()
      ).toBe(200);
    expect(
      await acceptanceSql(
        "SELECT id FROM fund_transactions WHERE type='payment_intent.succeeded' AND stripe_object_id=$1",
        [session.payment_intent]
      )
    ).toHaveLength(1);
    expect(
      await acceptanceSql(
        "SELECT id FROM fund_contributions WHERE stripe_session_id=$1 AND status='paid'",
        [session.id]
      )
    ).toHaveLength(1);
    const after = await summary();
    expect(
      Math.round((after.total_received - before.total_received) * 100)
    ).toBe(2500);
    expect(after.contributions_count - before.contributions_count).toBe(1);
    await info.attach('checkout-response-recovery', {
      contentType: 'application/json',
      body: JSON.stringify({
        providers: 'simulated',
        operationId,
        sessionId: session.id,
        attempts: recovered.attempts,
        browserRequestCount: posts.length
      })
    });
    expect(errors).toEqual([]);
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    const cleanup = await Promise.allSettled([
      operationId
        ? request
            .post(stub + '/__test__/payment-operations', {
              data: { kind: 'checkout', operationId, response: 'acknowledged' },
              timeout: 5000
            })
            .then((response) => expect(response.ok()).toBe(true))
        : Promise.resolve(),
      gate?.close()
    ]);
    const failures = cleanup
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (!bodyFailed && failures.length)
      throw new AggregateError(failures, 'Checkout fixture cleanup failed.');
  }
});
