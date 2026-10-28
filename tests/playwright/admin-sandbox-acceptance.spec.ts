import type {
  AdminContributionsResponse,
  AdminEmailQueueResponse,
  AdminPaymentJourney,
  AdminPaymentJourneyResponse,
  ContributionActivityResponse,
  CheckoutRequest
} from '@openg7/funding-core';

import { sandboxRead } from './support/sandbox-database.js';
import { expectPaymentJourneyComplete } from './support/payment-journey.js';
import { expect, test } from './support/test.js';
import {
  virtualController,
  virtualHook as hook
} from './support/virtual-controller.js';

test('isolated mouse controller: ordinary Checkout, signed confirmation, unique paid dossier and resumed admin completion', async ({
  page
}, info) => {
  test.skip(
    process.env.OPENG7_E2E_ISOLATED !== '1',
    'Requires the dedicated disposable sandbox launcher.'
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const origin = process.env.PLAYWRIGHT_BASE_URL!;
  expect(new URL(origin).hostname).toBe('127.0.0.1');
  const capability = await page.request.get('/openg7-sandbox.json');
  expect(capability.status()).toBe(200);
  expect(await capability.json()).toEqual({
    version: 1,
    enabled: true,
    stripeBasePath: '/__sandbox/stripe'
  });
  await page.addInitScript(() => localStorage.setItem('openg7.language', 'en'));
  await page.goto(
    '/admin/login?returnUrl=' +
      encodeURIComponent('/admin/fundraiser/contributions')
  );
  await hook(page, 'identity-sign-in').click();
  await page.getByLabel('Compte de test').selectOption('owner');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page).toHaveURL(origin + '/admin/fundraiser/contributions');
  const current = await page.request.get('/api/admin/auth/current');
  expect(current.status()).toBe(200);
  expect(await current.json()).toMatchObject({ role: 'owner' });
  const contributions = async () => {
    const response = await page.request.get('/api/admin/contributions');
    expect(response.status()).toBe(200);
    return response.json() as Promise<AdminContributionsResponse>;
  };
  expect((await contributions()).contributions).toEqual([]);
  expect(
    await sandboxRead(
      'SELECT count(*)::integer AS count FROM fund_contributions'
    )
  ).toEqual([{ count: 0 }]);
  const pad = virtualController(page);
  await pad.open();
  await hook(page, 'sandbox-payments-open').click();
  await expect(hook(page, 'sandbox-payment-create')).toBeDisabled();
  await expect(hook(page, 'sandbox-payment-kind')).toHaveValue(
    'personal_support'
  );
  await expect(hook(page, 'sandbox-payment-amount')).toHaveValue('25');
  await hook(page, 'sandbox-payment-accept').check();
  const checkout = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/checkout-sessions' &&
      response.request().method() === 'POST'
  );
  const provider = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname.startsWith(
        '/__sandbox/stripe/checkout/'
      ) && request.method() === 'POST'
  );
  await hook(page, 'sandbox-payment-create').click();
  const checkoutResponse = await checkout;
  expect(checkoutResponse.status()).toBe(200);
  const payload = checkoutResponse.request().postDataJSON() as CheckoutRequest;
  expect(payload).toMatchObject({
    amount: 25,
    currency: 'CAD',
    contributionType: 'personal_support',
    publicDisplayConsent: true,
    displayAmountConsent: false,
    nonCharityAcknowledged: true
  });
  expect(payload.idempotencyKey).toBeTruthy();
  const result = (await checkoutResponse.json()) as {
    status: string;
    checkoutId: string;
    redirectUrl: string;
  };
  expect(result.status).toBe('redirected');
  expect(result.checkoutId).toMatch(/^cs_test_/);
  const providerRequest = await provider;
  expect(providerRequest.url()).toBe(
    origin + '/__sandbox/stripe/checkout/' + result.checkoutId
  );
  expect(
    Object.fromEntries(new URLSearchParams(providerRequest.postData()!))
  ).toEqual({
    email: 'controller@simulation.example.test',
    action: 'success'
  });
  await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
    'data-state',
    'confirmed'
  );
  const id = (await hook(page, 'sandbox-payment-state').getAttribute(
    'data-contribution-id'
  ))!;
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  const paid = (await contributions()).contributions;
  expect(paid).toHaveLength(1);
  expect(paid[0]).toMatchObject({
    id,
    stripe_session_id: result.checkoutId,
    payment_status: 'paid',
    contribution_type: 'personal_support',
    amount: 25,
    currency: 'CAD'
  });
  // An empty communication list can briefly precede the asynchronous notification.
  // Wait for this contribution's actual queue entry and SMTP capture before completion.
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          '/api/admin/contribution-activity'
        );
        expect(response.status()).toBe(200);
        const body = (await response.json()) as ContributionActivityResponse;
        return body.items.find((item) => item.contributionId === id)?.email;
      },
      { timeout: 15000 }
    )
    .toBe('sent');
  const queuedResponse = await page.request.get('/api/admin/email-queue');
  expect(queuedResponse.status()).toBe(200);
  const queued = (await queuedResponse.json()) as AdminEmailQueueResponse;
  const notification = queued.messages.filter(
    (message) => message.metadata['contributionId'] === id
  );
  expect(notification).toHaveLength(1);
  expect(notification[0]).toMatchObject({
    template_key: 'admin_contribution_received',
    status: 'sent'
  });
  type CapturedMail = {
    ID: string;
    Subject: string;
    To: { Address: string }[];
  };
  let captured: CapturedMail | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          '/__sandbox/stripe/__test__/mail'
        );
        expect(response.status()).toBe(200);
        const mailbox = (await response.json()) as { messages: CapturedMail[] };
        captured = mailbox.messages.find(
          (message) =>
            message.Subject === notification[0]!.subject &&
            message.To.some(
              (recipient) =>
                recipient.Address === notification[0]!.recipient_email
            )
        );
        return !!captured;
      },
      { timeout: 15000 }
    )
    .toBe(true);
  const capturedResponse = await page.request.get(
    '/__sandbox/stripe/__test__/mail/' + captured!.ID
  );
  expect(capturedResponse.status()).toBe(200);
  const capturedBody = (await capturedResponse.json()) as { Text: string };
  expect(paid[0]!.public_reference).toBeTruthy();
  expect(capturedBody.Text).toContain(paid[0]!.public_reference!);
  const journey = async (): Promise<AdminPaymentJourney> => {
    const response = await page.request.get('/api/admin/payment-journey', {
      params: { contributionId: id }
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as AdminPaymentJourneyResponse;
    expect(body.status).toBe('ok');
    expect(body.journey?.contributionId).toBe(id);
    return body.journey!;
  };
  await expect
    .poll(async () => (await journey()).state, { timeout: 20000 })
    .toBe('complete');
  const complete = await journey();
  expectPaymentJourneyComplete(complete);
  expect(complete).toMatchObject({
    contributionType: 'personal_support',
    amountMinor: 2500,
    currency: 'CAD',
    paymentStatus: 'paid'
  });
  // These are real committed PostgreSQL facts; the helper enforces a read-only transaction.
  const proof = () =>
    sandboxRead(
      `SELECT
    (SELECT count(*)::integer FROM fund_contributions WHERE id=$1 AND stripe_session_id=$2 AND status='paid' AND amount_cents=2500) paid,
    (SELECT count(*)::integer FROM stripe_events WHERE payload->'data'->'object'->>'id'=$2 AND event_type='checkout.session.completed' AND processing_status='processed') events,
    (SELECT count(*)::integer FROM contribution_activity WHERE contribution_id=$1) activity,
    (SELECT count(*)::integer FROM fund_transactions) ledger`,
      [id, result.checkoutId]
    );
  const before = await proof();
  expect(before[0]).toMatchObject({ paid: 1, events: 1, activity: 1 });
  // The simulator signs and redelivers the very same Stripe event, through the ordinary webhook.
  const replay = await page.request.post(
    '/__sandbox/stripe/__test__/checkout-delivery',
    { data: { sessionId: result.checkoutId, action: 'deliver' } }
  );
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toMatchObject({ delivered: true });
  expect(await proof()).toEqual(before);
  expect((await contributions()).contributions).toHaveLength(1);
  await hook(page, 'sandbox-payment-open-journey').click();
  await expect(page).toHaveURL(
    origin + '/admin/fundraiser/attention?paymentJourney=' + id
  );
  await pad.press(3);
  await pad.activate(hook(page, 'payment-journey-refresh'));
  await expect(hook(page, 'payment-journey-complete')).toBeVisible();
  await expect(hook(page, 'payment-journey-next')).toHaveCount(0);
  // Refresh disables its focused button while reading; Y rejoins the guide.
  await pad.press(3);
  await expect(hook(page, 'admin-guidance-toggle')).toBeFocused();
  await pad.activate(hook(page, 'payment-journey-pause'));
  await pad.activate(
    page.locator('openg7-admin-nav a[href="/admin/fundraiser/contributions"]')
  );
  await expect(page).toHaveURL(origin + '/admin/fundraiser/contributions');
  await page.reload();
  await pad.open();
  await pad.press(3);
  await pad.activate(hook(page, 'payment-journey-resume'));
  await expect(hook(page, 'payment-journey-complete')).toBeVisible();
  await expect(hook(page, 'payment-journey-next')).toHaveCount(0);
  expect((await journey()).state).toBe('complete');
  expect(await proof()).toEqual(before);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath('sandbox-personal-admin-complete.png')
  });
  // A second real Checkout captures the cumulative company offer, without authorizing publication.
  await hook(page, 'sandbox-payments-open').click();
  await hook(page, 'sandbox-payment-accept').check();
  // Reload retained the public first Checkout only; reconcile it before requesting a new scenario.
  await hook(page, 'sandbox-payment-create').click();
  await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
    'data-state',
    'confirmed'
  );
  await hook(page, 'sandbox-payment-new').click();
  await hook(page, 'sandbox-payment-kind').selectOption('sponsorship_interest');
  await hook(page, 'sandbox-payment-amount').selectOption('500');
  await hook(page, 'sandbox-payment-public-consent').uncheck();
  await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
    'data-state',
    'ready'
  );
  await hook(page, 'sandbox-payment-accept').check();
  const companyCheckout = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/checkout-sessions' &&
      response.request().method() === 'POST'
  );
  await hook(page, 'sandbox-payment-create').click();
  const companyResponse = await companyCheckout;
  expect(companyResponse.status()).toBe(200);
  const companyPayload = companyResponse
    .request()
    .postDataJSON() as CheckoutRequest;
  expect(companyPayload).toMatchObject({
    amount: 500,
    currency: 'CAD',
    contributionType: 'sponsorship_interest',
    publicDisplayConsent: false,
    displayAmountConsent: false,
    nonCharityAcknowledged: true
  });
  expect(companyPayload.offerAcceptance?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(companyPayload.idempotencyKey).not.toBe(payload.idempotencyKey);
  await expect(hook(page, 'sandbox-payment-state')).toHaveAttribute(
    'data-state',
    'confirmed'
  );
  const companyId = (await hook(page, 'sandbox-payment-state').getAttribute(
    'data-contribution-id'
  ))!;
  expect(companyId).not.toBe(id);
  const company = (await contributions()).contributions.find(
    (row) => row.id === companyId
  )!;
  expect(company).toMatchObject({
    contribution_type: 'sponsorship_interest',
    amount: 500,
    currency: 'CAD',
    payment_status: 'paid',
    public_display_consent: false,
    sponsor_review_status: 'pending_review'
  });
  expect((await contributions()).contributions).toHaveLength(2);
  const companyProof = await sandboxRead(
    `SELECT c.provenance,c.state,o.version,o.fingerprint,o.amount_minor::integer,
    o.currency,o.snapshot->'benefits' benefits,
    (SELECT count(*)::integer FROM sponsorship_obligations WHERE contribution_id=$1) obligations,
    (SELECT count(*)::integer FROM sponsorship_invoices WHERE contribution_id=$1 AND total_cents=50000) invoices,
    (SELECT count(*)::integer FROM sponsorship_obligations WHERE contribution_id=$1 AND state='fulfilled') fulfilled
    FROM sponsorship_commitments c JOIN sponsorship_offers o ON o.id=c.offer_id WHERE c.contribution_id=$1`,
    [companyId]
  );
  expect(companyProof).toHaveLength(1);
  expect(companyProof[0]).toMatchObject({
    provenance: 'accepted_offer',
    state: 'active',
    version: companyPayload.offerAcceptance!.version,
    fingerprint: companyPayload.offerAcceptance!.fingerprint,
    amount_minor: 50000,
    currency: 'CAD',
    obligations: 3,
    invoices: 1,
    fulfilled: 0
  });
  const benefits = companyProof[0]!.benefits as { channel: string }[];
  expect(benefits.map((benefit) => benefit.channel).sort()).toEqual([
    'facebook',
    'linkedin',
    'website'
  ]);
  const companyResult = (await companyResponse.json()) as {
    checkoutId: string;
  };
  const supplierLink = hook(page, 'sandbox-payment-open-supplier');
  await expect(supplierLink).toHaveAttribute(
    'href',
    '/__sandbox/stripe/checkout/' + companyResult.checkoutId
  );
  const popup = page.waitForEvent('popup');
  await supplierLink.click();
  const supplier = await popup;
  try {
    await expect(supplier).toHaveURL(
      origin + '/__sandbox/stripe/checkout/' + companyResult.checkoutId
    );
    await expect(
      supplier.getByRole('button', { name: /Confirmer le paiement/ })
    ).toHaveCount(0);
    await supplier.getByRole('link', { name: 'Continuer vers OpenG7' }).click();
    await expect(supplier.locator('#followup-companyName')).toBeVisible();
    expect((await contributions()).contributions).toHaveLength(2);
    expect(
      await sandboxRead(
        'SELECT count(*)::integer AS count FROM sponsorship_invoices WHERE contribution_id=$1',
        [companyId]
      )
    ).toEqual([{ count: 1 }]);
  } finally {
    await supplier.close();
    await page.bringToFront();
  }
  await hook(page, 'sandbox-payment-open-journey').click();
  await expect(page).toHaveURL(
    origin + '/admin/fundraiser/attention?paymentJourney=' + companyId
  );
  await expect(hook(page, 'payment-journey-next')).toBeVisible();
  await expect(hook(page, 'payment-journey-complete')).toHaveCount(0);
  const companyJourneyResponse = await page.request.get(
    '/api/admin/payment-journey',
    { params: { contributionId: companyId } }
  );
  expect(companyJourneyResponse.status()).toBe(200);
  const companyJourney =
    (await companyJourneyResponse.json()) as AdminPaymentJourneyResponse;
  expect(companyJourney.journey).toMatchObject({
    contributionId: companyId,
    amountMinor: 50000,
    paymentStatus: 'paid'
  });
  expect(companyJourney.journey!.state).not.toBe('complete');
  expect(companyJourney.journey!.next).not.toBeNull();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath('sandbox-company-obligations-pending.png')
  });
});
