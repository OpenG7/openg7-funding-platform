#!/usr/bin/env node
// Minimal in-memory stand-in for the Stripe REST API, used only by the
// Playwright Docker E2E stack (see docker-compose.e2e.yml). It implements
// exactly the endpoints apps/funding-api/src actually calls (confirmed by
// reading stripe-webhook.service.ts, stripe-backfill.service.ts,
// stripe-transparency.service.ts, and main.ts) plus a `/__test__/...`
// control channel Playwright specs use to seed fixture data before
// triggering a real HTTP call into the api container.
//
// Not a general Stripe mock: no auth checks, no idempotency-key dedup, no
// resources beyond what funding-api touches. `/v1/refunds` is the one
// endpoint with real business logic -- it tracks cumulative refunds per
// charge and rejects an over-refund the same way real Stripe does, which is
// what lets the admin refund flow be tested end-to-end without reimplementing
// that guard in application code.

import { createServer } from 'node:http';
import { randomBytes, createHmac } from 'node:crypto';
import { socialSimulator } from './social.mjs';
import { createSmtpGate } from './smtp-gate.mjs';

const port = Number(process.env.PORT ?? 4242);
const smsReceipts = new Map();
const social = socialSimulator();
const smtpGate = process.env.STUB_MAILPIT_URL ? createSmtpGate() : null;
smtpGate?.server.listen(1025, '0.0.0.0');

const state = {
  paymentIntents: new Map(),
  charges: new Map(),
  balanceTransactions: new Map(),
  checkoutSessions: new Map(),
  checkoutSessionOrder: [],
  payouts: new Map(),
  payoutOrder: [],
  disputes: new Map(),
  disputeOrder: [],
  refunds: new Map()
};

const resetState = () => {
  state.paymentIntents.clear();
  state.charges.clear();
  state.balanceTransactions.clear();
  state.checkoutSessions.clear();
  state.checkoutSessionOrder.length = 0;
  state.payouts.clear();
  state.payoutOrder.length = 0;
  state.disputes.clear();
  state.disputeOrder.length = 0;
  state.refunds.clear();
};

const nowSeconds = () => Math.floor(Date.now() / 1000);
const randomId = (prefix) => `${prefix}_stub_${randomBytes(12).toString('hex')}`;

const sendJson = (response, statusCode, body) => {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload)
  });
  response.end(payload);
};

const sendStripeError = (response, statusCode, message, code) => {
  sendJson(response, statusCode, {
    error: {
      message,
      type: statusCode === 404 ? 'invalid_request_error' : 'invalid_request_error',
      code: code ?? null
    }
  });
};

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });

const parseFormBody = (raw) => {
  const params = new URLSearchParams(raw);
  const result = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
};

// --- Stripe-shaped object builders -----------------------------------

const balanceTransactionObject = (record) => ({
  id: record.id,
  object: 'balance_transaction',
  amount: record.amount,
  fee: record.fee,
  net: record.net,
  currency: record.currency,
  status: record.status,
  created: record.created,
  type: record.type
});

const chargeObject = (record, { expandBalanceTransaction, expandPaymentIntent } = {}) => ({
  id: record.id,
  object: 'charge',
  amount: record.amount,
  currency: record.currency,
  status: record.status,
  created: record.created,
  amount_refunded: record.amountRefunded,
  // Real Stripe objects always carry `metadata` (at minimum `{}`, never
  // undefined) -- apps/funding-api/src/stripe-backfill.service.ts reads
  // `paymentIntent.metadata.project` with no optional chaining, matching
  // that real-world guarantee, so the stub must uphold it too.
  metadata: record.metadata ?? {},
  payment_intent: record.paymentIntentId,
  balance_transaction:
    expandBalanceTransaction && state.balanceTransactions.has(record.balanceTransactionId)
      ? balanceTransactionObject(state.balanceTransactions.get(record.balanceTransactionId))
      : record.balanceTransactionId,
  refunds: {
    object: 'list',
    data: [...record.refundIds]
      .reverse()
      .map((id) => refundObject(state.refunds.get(id))),
    has_more: false,
    url: `/v1/charges/${record.id}/refunds`
  },
  ...(expandPaymentIntent && state.paymentIntents.has(record.paymentIntentId)
    ? {}
    : {})
});

const paymentIntentObject = (record, { expandLatestCharge, expandBalanceTransaction } = {}) => ({
  id: record.id,
  object: 'payment_intent',
  amount: record.amount,
  currency: record.currency,
  status: record.status,
  created: record.created,
  metadata: record.metadata ?? {},
  latest_charge:
    expandLatestCharge && state.charges.has(record.chargeId)
      ? chargeObject(state.charges.get(record.chargeId), {
          expandBalanceTransaction
        })
      : record.chargeId
});

const refundObject = (record) => ({
  id: record.id,
  object: 'refund',
  amount: record.amount,
  currency: record.currency,
  status: record.status,
  payment_intent: record.paymentIntentId,
  charge: record.chargeId,
  reason: record.reason,
  balance_transaction: record.balanceTransactionId ?? null,
  created: record.created
});

const checkoutSessionObject = (record, { expandPaymentIntent } = {}) => ({
  id: record.id,
  object: 'checkout.session',
  mode: 'payment',
  status: record.sessionStatus ?? (record.paymentStatus === 'paid' ? 'complete' : 'open'),
  client_reference_id: record.clientReferenceId ?? null,
  success_url: record.successUrl ?? null,
  cancel_url: record.cancelUrl ?? null,
  url: record.checkoutUrl ?? null,
  payment_status: record.paymentStatus,
  amount_total: record.amountTotal,
  currency: record.currency,
  created: record.created,
  metadata: record.metadata,
  customer_details: record.customerEmail ? { email: record.customerEmail } : null,
  payment_intent:
    expandPaymentIntent && record.paymentIntentId && state.paymentIntents.has(record.paymentIntentId)
      ? paymentIntentObject(state.paymentIntents.get(record.paymentIntentId))
      : record.paymentIntentId
});

const payoutObject = (record, { expandBalanceTransaction } = {}) => ({
  id: record.id,
  object: 'payout',
  amount: record.amount,
  currency: record.currency,
  status: record.status,
  created: record.created,
  arrival_date: record.created,
  balance_transaction:
    expandBalanceTransaction && state.balanceTransactions.has(record.balanceTransactionId)
      ? balanceTransactionObject(state.balanceTransactions.get(record.balanceTransactionId))
      : record.balanceTransactionId
});

const disputeObject = (record, { expandCharge } = {}) => ({
  id: record.id,
  object: 'dispute',
  amount: record.amount,
  currency: record.currency,
  status: record.status,
  reason: record.reason,
  created: record.created,
  charge:
    expandCharge && state.charges.has(record.chargeId)
      ? chargeObject(state.charges.get(record.chargeId))
      : record.chargeId
});

// --- List helpers -------------------------------------------------------

const filterByCreated = (records, query) => {
  const gte = query.get('created[gte]');
  const lte = query.get('created[lte]');
  return records.filter((record) => {
    if (gte && record.created < Number(gte)) {
      return false;
    }
    if (lte && record.created > Number(lte)) {
      return false;
    }
    return true;
  });
};

const paginate = (records, query) => {
  const limit = Number(query.get('limit') ?? '10');
  const startingAfter = query.get('starting_after');
  let startIndex = 0;
  if (startingAfter) {
    const cursor = records.findIndex((record) => record.id === startingAfter);
    startIndex = cursor === -1 ? 0 : cursor + 1;
  }
  const page = records.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < records.length;
  return { page, hasMore };
};

// --- Route handlers -------------------------------------------------------

const handleGetCharge = (response, id, query) => {
  const record = state.charges.get(id);
  if (!record) {
    sendStripeError(response, 404, `No such charge: '${id}'`, 'resource_missing');
    return;
  }
  const expand = query.getAll('expand[]');
  sendJson(
    response,
    200,
    chargeObject(record, {
      expandBalanceTransaction: expand.includes('balance_transaction'),
      expandPaymentIntent: expand.includes('payment_intent')
    })
  );
};

const handleGetBalanceTransaction = (response, id) => {
  const record = state.balanceTransactions.get(id);
  if (!record) {
    sendStripeError(
      response,
      404,
      `No such balance transaction: '${id}'`,
      'resource_missing'
    );
    return;
  }
  sendJson(response, 200, balanceTransactionObject(record));
};

const handleGetPaymentIntent = (response, id, query) => {
  const record = state.paymentIntents.get(id);
  if (!record) {
    sendStripeError(response, 404, `No such payment_intent: '${id}'`, 'resource_missing');
    return;
  }
  const expand = query.getAll('expand[]');
  sendJson(
    response,
    200,
    paymentIntentObject(record, {
      expandLatestCharge: expand.includes('latest_charge.balance_transaction'),
      expandBalanceTransaction: expand.includes('latest_charge.balance_transaction')
    })
  );
};

// The follow-up form also persists its metadata through the real Stripe SDK.
// Restrict this simulator endpoint to metadata; payment facts stay unchanged.
const handleUpdatePaymentIntent = async (request, response, id) => {
  const record = state.paymentIntents.get(id);
  if (!record) {
    sendStripeError(response, 404, 'Unknown payment intent.', 'resource_missing');
    return;
  }
  const form = parseFormBody(await readBody(request));
  const updates = Object.entries(form).map(([key, value]) => [
    /^metadata\[([A-Za-z][A-Za-z0-9_]*)\]$/.exec(key)?.[1],
    value
  ]);
  if (updates.some(([key]) => !key)) {
    sendStripeError(response, 400, 'Only metadata updates are supported.', null);
    return;
  }
  record.metadata = { ...record.metadata, ...Object.fromEntries(updates) };
  for (const [key, value] of updates) {
    if (value === '') delete record.metadata[key];
  }
  sendJson(response, 200, paymentIntentObject(record));
};

const handleListCheckoutSessions = (response, query) => {
  const expand = query.getAll('expand[]');
  const all = state.checkoutSessionOrder.map((id) => state.checkoutSessions.get(id));
  const filtered = filterByCreated(all, query);
  const { page, hasMore } = paginate(filtered, query);
  sendJson(response, 200, {
    object: 'list',
    data: page.map((record) =>
      checkoutSessionObject(record, {
        expandPaymentIntent: expand.includes('data.payment_intent')
      })
    ),
    has_more: hasMore,
    url: '/v1/checkout/sessions'
  });
};

const handleListPayouts = (response, query) => {
  const expand = query.getAll('expand[]');
  const all = state.payoutOrder.map((id) => state.payouts.get(id));
  const filtered = filterByCreated(all, query);
  const { page, hasMore } = paginate(filtered, query);
  sendJson(response, 200, {
    object: 'list',
    data: page.map((record) =>
      payoutObject(record, {
        expandBalanceTransaction: expand.includes('data.balance_transaction')
      })
    ),
    has_more: hasMore,
    url: '/v1/payouts'
  });
};

const handleListDisputes = (response, query) => {
  const expand = query.getAll('expand[]');
  const all = state.disputeOrder.map((id) => state.disputes.get(id));
  const filtered = filterByCreated(all, query);
  const { page, hasMore } = paginate(filtered, query);
  sendJson(response, 200, {
    object: 'list',
    data: page.map((record) =>
      disputeObject(record, { expandCharge: expand.includes('data.charge') })
    ),
    has_more: hasMore,
    url: '/v1/disputes'
  });
};

const handleCreateRefund = async (request, response) => {
  const raw = await readBody(request);
  const body = parseFormBody(raw);
  const paymentIntentId = body.payment_intent;
  const chargeIdParam = body.charge;

  const paymentIntent = paymentIntentId
    ? state.paymentIntents.get(paymentIntentId)
    : null;
  const chargeId = chargeIdParam ?? paymentIntent?.chargeId;
  const charge = chargeId ? state.charges.get(chargeId) : null;

  if (!charge) {
    sendStripeError(
      response,
      400,
      `No such payment_intent: '${paymentIntentId ?? ''}'`,
      'resource_missing'
    );
    return;
  }

  const remaining = charge.amount - charge.amountRefunded;
  const requestedAmount = body.amount !== undefined ? Number(body.amount) : remaining;

  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    sendStripeError(response, 400, 'Invalid refund amount.', 'parameter_invalid_integer');
    return;
  }

  if (requestedAmount > remaining) {
    // Mirrors real Stripe's own guard: a charge can never be refunded past
    // its original amount, regardless of how many partial refunds already
    // happened. This is the invariant the admin refund route itself does
    // not independently enforce (see apps/funding-api/src/main.ts) -- money
    // safety here comes from Stripe being the source of truth, exactly as
    // it does in production.
    sendStripeError(
      response,
      400,
      'This refund would exceed the amount available to refund on this charge.',
      'amount_too_large'
    );
    return;
  }

  const refund = {
    id: randomId('re'),
    amount: requestedAmount,
    currency: charge.currency,
    status: 'succeeded',
    paymentIntentId: charge.paymentIntentId,
    chargeId: charge.id,
    reason: body.reason ?? null,
    balanceTransactionId: randomId('txn_refund'),
    created: nowSeconds()
  };
  state.refunds.set(refund.id, refund);
  state.balanceTransactions.set(refund.balanceTransactionId, {
    id: refund.balanceTransactionId,
    amount: -requestedAmount,
    fee: 0,
    net: -requestedAmount,
    currency: charge.currency,
    status: 'available',
    created: refund.created,
    type: 'refund'
  });
  charge.amountRefunded += requestedAmount;
  charge.refundIds.push(refund.id);

  sendJson(response, 200, refundObject(refund));
};

// --- `/__test__/...` control channel -------------------------------------

const handleTestReset = (response) => {
  resetState();
  sendJson(response, 200, { ok: true });
};

const handleTestRegisterPaymentIntent = async (request, response) => {
  const body = JSON.parse(await readBody(request));
  const amount = Number(body.amount);
  const fee = Number(body.fee ?? 0);
  const net = body.net !== undefined ? Number(body.net) : amount - fee;
  const currency = body.currency ?? 'cad';
  const created = body.created ?? nowSeconds();
  const chargeId = body.chargeId ?? randomId('ch');
  const balanceTransactionId = body.balanceTransactionId ?? randomId('txn');

  const metadata = body.metadata ?? {};

  state.paymentIntents.set(body.id, {
    id: body.id,
    amount,
    currency,
    status: body.status ?? 'succeeded',
    chargeId,
    created,
    metadata
  });
  state.charges.set(chargeId, {
    id: chargeId,
    amount,
    currency,
    status: 'succeeded',
    created,
    paymentIntentId: body.id,
    balanceTransactionId,
    amountRefunded: 0,
    refundIds: [],
    metadata
  });
  state.balanceTransactions.set(balanceTransactionId, {
    id: balanceTransactionId,
    amount,
    fee,
    net,
    currency,
    status: 'available',
    created,
    type: 'charge'
  });

  sendJson(response, 200, { ok: true, chargeId, balanceTransactionId });
};

// Upsert rather than strict-update: this backs both test 81 (correcting an
// existing balance transaction's fee/net) and standalone balance
// transactions that were never created through /__test__/payment-intents,
// such as a refund's own balance transaction (test 87).
const handleTestUpdateBalanceTransaction = async (request, response, id) => {
  const body = JSON.parse(await readBody(request));
  const existing = state.balanceTransactions.get(id);

  if (!existing && body.amount === undefined) {
    sendStripeError(
      response,
      404,
      `No such balance transaction: '${id}'`,
      'resource_missing'
    );
    return;
  }

  const amount = body.amount !== undefined ? Number(body.amount) : existing.amount;
  const fee = body.fee !== undefined ? Number(body.fee) : (existing?.fee ?? 0);
  const net = body.net !== undefined ? Number(body.net) : amount - fee;

  state.balanceTransactions.set(id, {
    id,
    amount,
    fee,
    net,
    currency: body.currency ?? existing?.currency ?? 'cad',
    status: 'available',
    created: body.created ?? existing?.created ?? nowSeconds(),
    type: body.type ?? existing?.type ?? 'charge'
  });

  sendJson(response, 200, { ok: true });
};

const handleTestRegisterCheckoutSession = async (request, response) => {
  const body = JSON.parse(await readBody(request));
  const created = body.created ?? nowSeconds();
  const record = {
    id: body.id,
    paymentIntentId: body.paymentIntentId ?? null,
    amountTotal: Number(body.amountTotal),
    currency: body.currency ?? 'cad',
    metadata: body.metadata ?? {},
    customerEmail: body.customerEmail ?? null,
    paymentStatus: body.paymentStatus ?? 'paid',
    created
  };
  if (!state.checkoutSessions.has(record.id)) {
    state.checkoutSessionOrder.push(record.id);
  }
  state.checkoutSessions.set(record.id, record);
  sendJson(response, 200, { ok: true });
};

const handleTestRegisterPayout = async (request, response) => {
  const body = JSON.parse(await readBody(request));
  const created = body.created ?? nowSeconds();
  const balanceTransactionId = body.balanceTransactionId ?? randomId('txn');
  const amount = Number(body.amount);
  if (!state.balanceTransactions.has(balanceTransactionId)) {
    state.balanceTransactions.set(balanceTransactionId, {
      id: balanceTransactionId,
      amount,
      fee: 0,
      net: amount,
      currency: body.currency ?? 'cad',
      status: 'available',
      created,
      type: 'payout'
    });
  }
  const record = {
    id: body.id,
    amount,
    currency: body.currency ?? 'cad',
    status: body.status ?? 'paid',
    balanceTransactionId,
    created
  };
  if (!state.payouts.has(record.id)) {
    state.payoutOrder.push(record.id);
  }
  state.payouts.set(record.id, record);
  sendJson(response, 200, { ok: true, balanceTransactionId });
};

const handleTestRegisterDispute = async (request, response) => {
  const body = JSON.parse(await readBody(request));
  const record = {
    id: body.id,
    chargeId: body.chargeId,
    amount: Number(body.amount),
    currency: body.currency ?? 'cad',
    status: body.status ?? 'needs_response',
    reason: body.reason ?? 'general',
    created: body.created ?? nowSeconds()
  };
  if (!state.disputes.has(record.id)) {
    state.disputeOrder.push(record.id);
  }
  state.disputes.set(record.id, record);
  sendJson(response, 200, { ok: true });
};

// --- Dispatch ---------------------------------------------------------

const handleCreateCheckout = async (request, response) => {
  if (!process.env.STUB_PUBLIC_BASE_URL || !process.env.STUB_WEBHOOK_URL) {
    sendStripeError(
      response,
      503,
      'Navigable Checkout is enabled only in acceptance.'
    );
    return;
  }
  const form = parseFormBody(await readBody(request));
  const amount = Number(form['line_items[0][price_data][unit_amount]']);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    sendStripeError(response, 400, 'Invalid amount.');
    return;
  }
  const metadata = Object.fromEntries(
    Object.entries(form)
      .filter(([key]) => /^metadata\[[^\]]+\]$/.test(key))
      .map(([key, value]) => [key.slice(9, -1), value])
  );
  const id = randomId('cs_test'),
    paymentIntentId = randomId('pi_test');
  const record = {
    id,
    paymentIntentId,
    amountTotal: amount,
    currency: form['line_items[0][price_data][currency]'],
    metadata,
    customerEmail: 'company@simulation.example.test',
    paymentStatus: 'unpaid',
    created: nowSeconds(),
    clientReferenceId: form.client_reference_id,
    successUrl: form.success_url,
    cancelUrl: form.cancel_url,
    checkoutUrl: process.env.STUB_PUBLIC_BASE_URL + '/checkout/' + id
  };
  state.checkoutSessions.set(id, record);
  state.checkoutSessionOrder.push(id);
  state.paymentIntents.set(paymentIntentId, {
    id: paymentIntentId,
    amount,
    amountReceived: 0,
    currency: record.currency,
    status: 'requires_payment_method',
    created: record.created,
    metadata,
    latestChargeId: null
  });
  // Stripe can defer creating the PaymentIntent until Checkout is visited.
  sendJson(response, 200, { ...checkoutSessionObject(record), payment_intent: null });
};
const handleCheckoutPage = async (request, response, id) => {
  const record = state.checkoutSessions.get(id);
  if (!record?.checkoutUrl) {
    sendStripeError(response, 404, 'Unknown simulated Checkout.');
    return;
  }
  if (request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      `<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width"><title>Checkout simulé</title><body><main><h1>Checkout simulé</h1><p>Aucun paiement réel. Contribution : ${(record.amountTotal / 100).toFixed(2)} CAD.</p>${record.declined ? '<p role="alert">Paiement simulé refusé. Essayez un autre moyen de paiement.</p>' : ''}${record.sessionStatus === 'expired' ? '<p role="alert">Session simulée expirée.</p>' : '<form method="post"><label>Courriel simulé <input type="email" name="email" required value="' + record.customerEmail + '"></label><button type="submit">Confirmer le paiement simulé</button><button name="action" value="decline">Simuler un refus</button><button name="action" value="expire">Simuler une expiration</button></form>'}<a href="${record.cancelUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">Retourner à OpenG7</a></main></body></html>`
    );
    return;
  }
  if (request.method !== 'POST') {
    sendStripeError(response, 405, 'Method not allowed.');
    return;
  }
  const checkoutForm = parseFormBody(await readBody(request));
  if (record.sessionStatus === 'expired') {
    sendStripeError(response, 409, 'This simulated session has expired.');
    return;
  }
  const email = checkoutForm.email ?? record.customerEmail;
  if (
    email.length > 254 ||
    !/^[A-Za-z0-9._+-]+@simulation\.example\.test$/.test(email)
  ) {
    sendStripeError(
      response,
      400,
      'Use a synthetic simulation.example.test email.'
    );
    return;
  }
  if (record.paymentStatus === 'paid' && email !== record.customerEmail) {
    sendStripeError(
      response,
      409,
      'A confirmed payment keeps its original email.'
    );
    return;
  }
  record.customerEmail = email;
  if (['decline', 'expire'].includes(checkoutForm.action)) {
    if (record.paymentStatus === 'paid') {
      sendStripeError(response, 409, 'A confirmed payment cannot fail or expire.');
      return;
    }
    const expired = checkoutForm.action === 'expire';
    record.declined = !expired;
    if (expired) record.sessionStatus = 'expired';
    record.negativeEvent ??= {
      id: randomId('evt'), object: 'event', livemode: false, created: nowSeconds(),
      type: expired ? 'checkout.session.expired' : 'payment_intent.payment_failed',
      data: { object: expired ? checkoutSessionObject(record) : paymentIntentObject(state.paymentIntents.get(record.paymentIntentId)) }
    };
    if (!(await deliverSimulatedEvent(record.negativeEvent))) {
      sendStripeError(response, 502, 'Negative webhook delivery failed.');
      return;
    }
    response.writeHead(303, { location: record.checkoutUrl });
    response.end();
    return;
  }
  record.paymentStatus = 'paid';
  const intent = state.paymentIntents.get(record.paymentIntentId);
  intent.status = 'succeeded';
  intent.amountReceived = record.amountTotal;
  if (!record.deferWebhook && !(await deliverCheckoutWebhook(record))) {
    sendStripeError(
      response,
      502,
      'Webhook simulation failed; retry uses the same event.'
    );
    return;
  }
  response.writeHead(303, {
    location: record.successUrl.replace('{CHECKOUT_SESSION_ID}', record.id)
  });
  response.end();
};

const deliverCheckoutWebhook = async (record) => {
  record.eventId ??= randomId('evt');
  return deliverSimulatedEvent({
    id: record.eventId,
    object: 'event',
    type: 'checkout.session.completed',
    created: nowSeconds(),
    livemode: false,
    data: { object: checkoutSessionObject(record) }
  });
};
const deliverSimulatedEvent = async (event) => {
  const body = JSON.stringify(event);
  const time = nowSeconds();
  const signature = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET)
    .update(`${time}.${body}`)
    .digest('hex');
  const delivery = await fetch(process.env.STUB_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': `t=${time},v1=${signature}`
    },
    body,
    signal: AbortSignal.timeout(10000)
  });
  return delivery.ok;
};

// Acceptance can delay the provider callback independently of the browser return.
// This control exists only in the local simulator, never in the application API.
const handleCheckoutDelivery = async (request, response) => {
  if (!process.env.STUB_PUBLIC_BASE_URL || !process.env.STUB_WEBHOOK_URL) {
    sendJson(response, 503, { error: 'Acceptance Checkout is not configured.' });
    return;
  }
  const { sessionId, action } = JSON.parse(await readBody(request));
  if (typeof sessionId !== 'string' || !['defer', 'deliver', 'replay-negative'].includes(action)) {
    sendJson(response, 400, { error: 'Invalid delivery control.' });
    return;
  }
  const record = state.checkoutSessions.get(sessionId);
  if (!record?.checkoutUrl) {
    sendJson(response, 404, { error: 'Unknown acceptance Checkout.' });
    return;
  }
  if (action === 'replay-negative' && record.negativeEvent) {
    const delivered = await deliverSimulatedEvent(record.negativeEvent);
    sendJson(response, delivered ? 200 : 502, { delivered });
  } else if (action === 'defer' && record.paymentStatus === 'unpaid') {
    record.deferWebhook = true;
    sendJson(response, 200, { deferred: true });
  } else if (action === 'deliver' && record.paymentStatus === 'paid') {
    const delivered = await deliverCheckoutWebhook(record);
    sendJson(response, delivered ? 200 : 502, { delivered });
  } else {
    sendJson(response, 409, { error: 'Checkout is not in the required state.' });
  }
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://stripe-stub.local');
  const { pathname, searchParams } = url;

  try {
    if (await social(request, response, url)) return;
    if (request.method === 'POST' && pathname === '/__test__/checkout-delivery') {
      await handleCheckoutDelivery(request, response);
      return;
    }
    if (request.method === 'POST' && pathname === '/v1/checkout/sessions') {
      await handleCreateCheckout(request, response);
      return;
    }
    if (pathname.startsWith('/checkout/')) {
      await handleCheckoutPage(
        request,
        response,
        decodeURIComponent(pathname.slice('/checkout/'.length))
      );
      return;
    }
    if (request.method === 'GET' && pathname.startsWith('/v1/checkout/sessions/')) {
      const record = state.checkoutSessions.get(
        decodeURIComponent(pathname.slice('/v1/checkout/sessions/'.length))
      );
      if (!record) sendStripeError(response, 404, 'Unknown session.');
      else
        sendJson(
          response,
          200,
          checkoutSessionObject(record, {
            expandPaymentIntent: searchParams
              .getAll('expand[]')
              .includes('payment_intent')
          })
        );
      return;
    }
    if (pathname === '/__test__/sms' && request.method === 'POST') {
      const body = JSON.parse(await readBody(request));
      if (
        typeof body.idempotencyKey !== 'string' ||
        typeof body.text !== 'string' ||
        body.recipient !== 'simulation-admin'
      ) {
        sendJson(response, 400, {});
        return;
      }
      const existing = smsReceipts.get(body.idempotencyKey);
      if (existing && existing.text !== body.text) {
        sendJson(response, 409, {});
        return;
      }
      const receipt = existing ?? {
        ...body,
        id: randomId('sms_mock'),
        capturedAt: new Date().toISOString(),
        simulated: true
      };
      smsReceipts.set(body.idempotencyKey, receipt);
      sendJson(response, 200, receipt);
      return;
    }
    if (pathname === '/__test__/sms' && request.method === 'GET') {
      sendJson(response, 200, { items: [...smsReceipts.values()] });
      return;
    }
    if (pathname.startsWith('/__test__/sms/') && request.method === 'GET') {
      const receipt = smsReceipts.get(
        decodeURIComponent(pathname.slice('/__test__/sms/'.length))
      );
      sendJson(response, receipt ? 200 : 404, receipt ?? {});
      return;
    }
    if (pathname === '/__test__/smtp' && smtpGate) {
      if (request.method === 'POST') {
        const { mode } = JSON.parse(await readBody(request));
        if (!['allow', 'hold', 'reject'].includes(mode)) {
          sendJson(response, 400, {});
          return;
        }
        smtpGate.setMode(mode);
      } else if (request.method !== 'GET') {
        sendJson(response, 405, {});
        return;
      }
      sendJson(response, 200, smtpGate.snapshot());
      return;
    }
    if (
      /^\/__test__\/mail\/[A-Za-z0-9-]+$/.test(pathname) &&
      request.method === 'GET' &&
      process.env.STUB_MAILPIT_URL
    ) {
      const mail = await fetch(
        process.env.STUB_MAILPIT_URL +
          '/api/v1/message/' +
          pathname.split('/').at(-1),
        { signal: AbortSignal.timeout(3000) }
      );
      sendJson(response, mail.status, await mail.json());
      return;
    }
    if (
      pathname === '/__test__/mail' &&
      request.method === 'GET' &&
      process.env.STUB_MAILPIT_URL
    ) {
      const mail = await fetch(process.env.STUB_MAILPIT_URL + '/api/v1/messages', {
        signal: AbortSignal.timeout(3000)
      });
      sendJson(response, mail.status, await mail.json());
      return;
    }
    if (request.method === 'POST' && pathname === '/__test__/reset') {
      handleTestReset(response);
      return;
    }
    if (request.method === 'POST' && pathname === '/__test__/payment-intents') {
      await handleTestRegisterPaymentIntent(request, response);
      return;
    }
    if (
      request.method === 'PATCH' &&
      pathname.startsWith('/__test__/balance-transactions/')
    ) {
      await handleTestUpdateBalanceTransaction(
        request,
        response,
        decodeURIComponent(pathname.slice('/__test__/balance-transactions/'.length))
      );
      return;
    }
    if (request.method === 'POST' && pathname === '/__test__/checkout-sessions') {
      await handleTestRegisterCheckoutSession(request, response);
      return;
    }
    if (request.method === 'POST' && pathname === '/__test__/payouts') {
      await handleTestRegisterPayout(request, response);
      return;
    }
    if (request.method === 'POST' && pathname === '/__test__/disputes') {
      await handleTestRegisterDispute(request, response);
      return;
    }

    if (request.method === 'GET' && pathname.startsWith('/v1/charges/')) {
      handleGetCharge(
        response,
        decodeURIComponent(pathname.slice('/v1/charges/'.length)),
        searchParams
      );
      return;
    }
    if (request.method === 'GET' && pathname.startsWith('/v1/balance_transactions/')) {
      handleGetBalanceTransaction(
        response,
        decodeURIComponent(pathname.slice('/v1/balance_transactions/'.length))
      );
      return;
    }
    if (request.method === 'GET' && pathname === '/v1/checkout/sessions') {
      handleListCheckoutSessions(response, searchParams);
      return;
    }
    if (request.method === 'POST' && pathname.startsWith('/v1/payment_intents/')) {
      await handleUpdatePaymentIntent(
        request,
        response,
        decodeURIComponent(pathname.slice('/v1/payment_intents/'.length))
      );
      return;
    }
    if (request.method === 'GET' && pathname.startsWith('/v1/payment_intents/')) {
      handleGetPaymentIntent(
        response,
        decodeURIComponent(pathname.slice('/v1/payment_intents/'.length)),
        searchParams
      );
      return;
    }
    if (request.method === 'GET' && pathname === '/v1/payouts') {
      handleListPayouts(response, searchParams);
      return;
    }
    if (request.method === 'GET' && pathname === '/v1/disputes') {
      handleListDisputes(response, searchParams);
      return;
    }
    if (request.method === 'POST' && pathname === '/v1/refunds') {
      await handleCreateRefund(request, response);
      return;
    }

    sendStripeError(response, 404, `Unrecognized request URL: ${pathname}`, null);
  } catch (error) {
    console.error('stripe-stub request failed', error);
    sendStripeError(response, 500, 'Internal stripe-stub error.', null);
  }
});

server.listen(port, () => {
  console.log(`stripe-stub listening on :${port}`);
});
