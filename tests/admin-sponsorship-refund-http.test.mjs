import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import Stripe from 'stripe';

import { createAdminSponsorshipRefundHttpHandler } from '../dist/apps/funding-api/src/admin-sponsorship-refund.http.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';
import { SponsorshipRefundOperationError } from '../dist/apps/funding-api/src/sponsorship-refund-operations.js';
import { isSponsorshipEmail } from '../dist/packages/funding-core/src/index.js';

const contributionId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const expectedVersion = 'synthetic-version';
const actor = 'synthetic-owner';
const recipient = 'synthetic-sponsor@example.test';
const targetRecord = {
  id: contributionId,
  version: expectedVersion,
  publicReference: 'SYNTHETIC-REFERENCE',
  sponsorName: 'Synthetic sponsor',
  paymentStatus: 'paid',
  refundWorkflowStatus: 'not_requested',
  refundId: null,
  stripePaymentIntentId: 'pi_synthetic',
  amountCents: 25000,
  amount: 250,
  currency: 'CAD'
};
const requestBody = {
  contributionId,
  expectedVersion,
  confirmationText: ' SYNTHETIC-REFERENCE ',
  refundNote: ' Synthetic note ',
  notifySponsor: true,
  notificationEmail: ` ${recipient} `,
  sponsorMessage: ' Synthetic sponsor message '
};
const creditNoteRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  creditNoteNumber: 'SYNTHETIC-CREDIT-1'
};
const adminCreditNoteRecord = {
  id: creditNoteRecord.id,
  credit_note_number: creditNoteRecord.creditNoteNumber
};
const notificationResult = {
  queued: true,
  attempted: false,
  sent: false,
  messageId: 'synthetic-email',
  error: null
};

const fixture = ({
  denied,
  role = 'owner',
  production = true,
  configured = true,
  target = targetRecord,
  refundStatus = 'succeeded',
  creditNote = creditNoteRecord,
  notification = notificationResult,
  failing,
  failure = new Error('Synthetic dependency failure.'),
  durableClaim = false
} = {}) => {
  const calls = [];
  const state = { target: target && { ...target }, claim: null };
  const record = (name, value) => {
    calls.push({ name, value });
    if (name === failing) throw failure;
  };
  const writeJson = (_request, response, status, payload) => {
    record('json', status);
    Object.assign(response, { status, payload });
  };
  const refund = {
    id: 're_synthetic',
    amount: 25000,
    currency: 'cad',
    status: refundStatus,
    payment_intent: 'pi_synthetic'
  };
  const ports = {
    publicBaseOrigin: 'https://funding.example.test',
    isProduction: production,
    stripe: configured
      ? {
          refunds: {
            create: async (input, options) => {
              record('provider', { input, options });
              return { ...refund, amount: input.amount };
            }
          }
        }
      : null,
    ensureAdminAccess: (request, response) => {
      record('access');
      const path = new URL(request.url, 'https://funding.example.test')
        .pathname;
      const status =
        denied ?? (adminRoleAllows(role, request.method, path) ? null : 403);
      if (!status) return true;
      writeJson(request, response, status, { error: 'Access rejected.' });
      return false;
    },
    getAdminAuditActor: () => {
      record('actor');
      return actor;
    },
    readBody: async (request, limit) => {
      record('body', limit);
      return readBody(request, limit);
    },
    writeJson,
    isValidUuid: (value) =>
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value
      ),
    isValidAdminExpectedVersion: (value) =>
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.trim().length <= 128,
    isAllowedSponsorshipStripeRefundReason: (value) =>
      ['duplicate', 'fraudulent', 'requested_by_customer'].includes(value),
    isValidOptionalBoundedText: (value, limit) =>
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length <= limit),
    isValidSponsorEmail: (value) => isSponsorshipEmail(value, 200),
    adminReviewNoteMaxLength: 1000,
    sponsorMessageMaxLength: 1000,
    amountToCents: (amount) => Math.round(amount * 100),
    sponsorshipRefundConfirmationText: ({ publicReference, id }) =>
      publicReference ?? id,
    writeSponsorshipRefundIneligible: (request, response, paymentStatus) => {
      record('ineligible', paymentStatus);
      writeJson(request, response, 409, {
        code: 'SPONSORSHIP_REFUND_NOT_ELIGIBLE',
        paymentStatus
      });
    },
    createDevelopmentRefundResult: (input) => {
      record('development', input);
      return { ...refund, amount: input.amountCents };
    },
    getSponsorshipRefundTarget: async (id) => {
      record('target', id);
      return state.target;
    },
    beginSponsorshipRefundOperation: async (input) => {
      record('claim', input);
      if (durableClaim && state.claim) {
        throw new SponsorshipRefundOperationError(
          'SPONSORSHIP_REFUND_NOT_ELIGIBLE'
        );
      }
      state.claim = operationId;
      return operationId;
    },
    settleSponsorshipRefundOperation: async (providerRefund, id) => {
      record('settle', { refund: providerRefund, operationId: id });
      return true;
    },
    failSponsorshipRefundOperation: async (id, definitive) => {
      record('fail', { operationId: id, definitive });
      if (durableClaim && definitive) state.claim = null;
    },
    updateContributionStatusByPaymentIntent: async (input) => {
      record('payment', input);
      if (durableClaim) state.target.paymentStatus = 'refunded';
      return true;
    },
    createSponsorshipCreditNoteForRefund: async (input) => {
      record('creditNote', input);
      return creditNote;
    },
    getAdminSponsorshipCreditNoteById: async (id) => {
      record('adminCreditNote', id);
      return adminCreditNoteRecord;
    },
    queueSponsorshipCreditNoteEmail: async (input) => {
      record('creditEmail', input);
      return notification;
    },
    queueSponsorshipRefundEmail: async (input) => {
      record('refundEmail', input);
      return notification;
    },
    insertAdminAuditLog: async (input) => {
      record('audit', input);
      return true;
    },
    getAdminSponsorshipById: async (id) => {
      record('sponsorship', id);
      return { id, version: 'synthetic-next-version' };
    },
    reportFailure: (...details) => record('report', details)
  };
  const handler = createAdminSponsorshipRefundHttpHandler(ports);
  return {
    state,
    ports,
    names: () => calls.map(({ name }) => name),
    values: (name) =>
      calls.filter((call) => call.name === name).map(({ value }) => value),
    async run({
      prefix = '/admin/',
      method = 'POST',
      path = `${prefix}sponsorships/refund`,
      body = JSON.stringify(requestBody),
      headers = { 'content-type': 'application/json' }
    } = {}) {
      const request = Object.assign(Readable.from([Buffer.from(body)]), {
        method,
        url: path,
        headers
      });
      const response = {};
      return { handled: await handler(request, response), ...response };
    }
  };
};

test('refund aliases reject absent, expired, revoked, forbidden and unavailable access before reading the body', async (t) => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    for (const denied of [401, 403, 503]) {
      await t.test(`${prefix} ${denied}`, async () => {
        const f = fixture({ denied });
        const result = await f.run({ prefix, body: '{invalid' });
        assert.equal(result.handled, true);
        assert.equal(result.status, denied);
        assert.deepEqual(f.names(), ['access', 'json']);
      });
    }
    for (const role of ['reader', 'operator']) {
      await t.test(`${prefix} ${role}`, async () => {
        const f = fixture({ role });
        assert.equal((await f.run({ prefix })).status, 403);
        assert.deepEqual(f.names(), ['access', 'json']);
      });
    }
  }
});

test('production requires configured Stripe before parsing; development uses the injected mock after its durable claim', async () => {
  const unavailable = fixture({ configured: false });
  assert.deepEqual(await unavailable.run({ body: '{invalid' }), {
    handled: true,
    status: 503,
    payload: { error: 'Stripe is not configured.' }
  });
  assert.deepEqual(unavailable.names(), ['access', 'json']);
  const local = fixture({ configured: false, production: false });
  const result = await local.run();
  assert.equal(result.status, 200);
  assert.equal(result.payload.refunded, true);
  assert.equal(local.values('provider').length, 0);
  assert.ok(
    local.names().indexOf('claim') < local.names().indexOf('development')
  );
  assert.deepEqual(local.values('development'), [
    { amountCents: 25000, currency: 'CAD', paymentIntentId: 'pi_synthetic' }
  ]);
});

test('unmatched routes and methods fall through without effects', async () => {
  for (const request of [
    { method: 'GET' },
    { method: 'PUT' },
    { method: 'OPTIONS' },
    { path: '/admin/sponsorships/refund/extra' },
    { path: '/unknown' }
  ]) {
    const f = fixture();
    assert.deepEqual(await f.run(request), { handled: false });
    assert.deepEqual(f.names(), []);
  }
});

test('malformed, missing and oversized bodies retain the transport error and default body limit', async () => {
  for (const body of [
    '',
    '{invalid',
    'null',
    'false',
    '123',
    'x'.repeat(262145)
  ]) {
    const f = fixture();
    const result = await f.run({ body });
    assert.equal(result.status, 400);
    assert.equal(
      result.payload.error,
      'Invalid sponsorship refund request body.'
    );
    assert.deepEqual(f.names(), ['access', 'body', 'json']);
    assert.deepEqual(f.values('body'), [undefined]);
  }
});

test('invalid refund fields and notification requirements are rejected before target lookup', async (t) => {
  const cases = [
    [{ contributionId: 'invalid' }, 'Invalid contribution id.'],
    [{ expectedVersion: undefined }, 'Sponsorship version is required.'],
    [{ expectedVersion: ' ' }, 'Sponsorship version is required.'],
    [{ confirmationText: '' }, 'Confirmation text is required.'],
    [{ confirmationText: 12 }, 'Confirmation text is required.'],
    [{ refundReason: 'invalid' }, 'Invalid Stripe refund reason.'],
    [{ amount: '250' }, 'Refund amount must be a number.'],
    [{ amount: null }, 'Refund amount must be a number.'],
    [{ refundNote: 'x'.repeat(1001) }, 'Refund note is too long.'],
    [
      { sponsorMessage: 'x'.repeat(1001) },
      'Sponsor notification message is too long.'
    ],
    [
      { notificationEmail: 'invalid' },
      'A valid sponsor notification email is required.'
    ],
    [{ sponsorMessage: ' ' }, 'A sponsor-facing refund message is required.']
  ];
  for (const [change, expected] of cases) {
    await t.test(expected, async () => {
      const f = fixture();
      const result = await f.run({
        body: JSON.stringify({ ...requestBody, ...change })
      });
      assert.equal(result.status, 400);
      assert.equal(result.payload.error, expected);
      assert.deepEqual(f.names(), ['access', 'body', 'json']);
    });
  }
});

test('missing database target remains a 404; version conflict precedes eligibility and effects', async () => {
  const unavailable = fixture({ target: null });
  assert.deepEqual((await unavailable.run()).payload, {
    error: 'Sponsorship contribution was not found.'
  });
  const concurrent = fixture({
    target: {
      ...targetRecord,
      version: 'new-version',
      paymentStatus: 'refunded'
    }
  });
  const result = await concurrent.run();
  assert.equal(result.status, 409);
  assert.deepEqual(result.payload, {
    code: 'SPONSORSHIP_CONCURRENT_UPDATE',
    message: 'Cette commandite a ete modifiee par un autre administrateur.',
    currentVersion: 'new-version'
  });
  assert.deepEqual(concurrent.names(), ['access', 'body', 'target', 'json']);
});

test('payment, processing and completed manual refunds block further provider calls', async () => {
  for (const paymentStatus of ['refunded', 'disputed', 'pending', null]) {
    const f = fixture({ target: { ...targetRecord, paymentStatus } });
    assert.equal((await f.run()).status, 409);
    assert.deepEqual(f.values('ineligible'), [paymentStatus]);
    assert.equal(f.values('claim').length, 0);
  }
  for (const refundWorkflowStatus of ['processing', 'completed']) {
    const f = fixture({ target: { ...targetRecord, refundWorkflowStatus } });
    const result = await f.run();
    assert.equal(result.status, 409);
    assert.equal(result.payload.code, 'SPONSORSHIP_REFUND_NOT_ELIGIBLE');
    assert.equal(result.payload.refundWorkflowStatus, refundWorkflowStatus);
    assert.equal(f.values('claim').length, 0);
  }
});

test('amount precision, missing PaymentIntent and exact confirmation remain guarded before claim', async () => {
  for (const amount of [0, -1, 250.01, 1.234, 0.001]) {
    const f = fixture();
    const result = await f.run({
      body: JSON.stringify({ ...requestBody, amount })
    });
    assert.equal(result.status, 400);
    assert.equal(
      result.payload.error,
      'Refund amount must be between 0.01 and 250.00 CAD.'
    );
    assert.equal(f.values('claim').length, 0);
  }
  const missing = fixture({
    target: { ...targetRecord, stripePaymentIntentId: null }
  });
  assert.equal(
    (await missing.run()).payload.code,
    'SPONSORSHIP_REFUND_NOT_ELIGIBLE'
  );
  const unconfirmed = fixture();
  assert.equal(
    (
      await unconfirmed.run({
        body: JSON.stringify({ ...requestBody, confirmationText: 'wrong' })
      })
    ).payload.error,
    'Confirmation text must match SYNTHETIC-REFERENCE.'
  );
  assert.equal(unconfirmed.values('claim').length, 0);
  const noReference = fixture({
    target: { ...targetRecord, publicReference: null }
  });
  assert.equal(
    (
      await noReference.run({
        body: JSON.stringify({
          ...requestBody,
          confirmationText: contributionId
        })
      })
    ).status,
    200
  );
});

test('full and partial refunds preserve minor amounts, durable claim, idempotency and effect order for both aliases', async () => {
  for (const prefix of ['/admin/', '/api/admin/']) {
    for (const amount of [undefined, 250, 12.5, 0.01]) {
      const f = fixture();
      const result = await f.run({
        prefix,
        path: `${prefix}sponsorships/refund?synthetic=1`,
        body: JSON.stringify({ ...requestBody, amount })
      });
      const amountMinor =
        amount === undefined ? 25000 : Math.round(amount * 100);
      const full = amountMinor === 25000;
      assert.equal(result.handled, true);
      assert.equal(result.status, 200);
      assert.equal(result.payload.refunded, true);
      assert.equal(result.payload.fullRefund, full);
      assert.equal(result.payload.amount, amountMinor / 100);
      assert.equal(result.payload.currency, 'CAD');
      assert.equal(result.payload.paymentStatusUpdated, full);
      assert.deepEqual(result.payload.creditNote, adminCreditNoteRecord);
      assert.deepEqual(result.payload.notification, notificationResult);
      assert.deepEqual(f.names(), [
        'access',
        'body',
        'target',
        'actor',
        'claim',
        'provider',
        'settle',
        ...(full ? ['payment'] : []),
        'creditNote',
        'adminCreditNote',
        'creditEmail',
        'actor',
        'audit',
        'sponsorship',
        'json'
      ]);
      assert.deepEqual(f.values('claim'), [
        {
          contributionId,
          expectedVersion,
          paymentIntentId: 'pi_synthetic',
          amountMinor,
          currency: 'CAD',
          reason: 'requested_by_customer',
          note: 'Synthetic note',
          actor
        }
      ]);
      assert.deepEqual(f.values('provider'), [
        {
          input: {
            amount: amountMinor,
            payment_intent: 'pi_synthetic',
            reason: 'requested_by_customer',
            metadata: {
              contributionId,
              refundType: full ? 'full' : 'partial',
              refundAmountCents: String(amountMinor),
              refundReason: 'requested_by_customer',
              publicReference: 'SYNTHETIC-REFERENCE',
              source: 'openg7_admin_sponsorship_refund',
              openg7RefundOperationId: operationId
            }
          },
          options: { idempotencyKey: `sponsorship-refund:${operationId}` }
        }
      ]);
      assert.deepEqual(f.values('creditNote'), [
        {
          contributionId,
          stripeRefundId: 're_synthetic',
          refundAmountCents: amountMinor
        }
      ]);
      assert.deepEqual(f.values('creditEmail'), [
        {
          to: recipient,
          creditNote: creditNoteRecord,
          sponsorMessage: 'Synthetic sponsor message',
          idempotencyKey: `sponsorship-credit-note:${creditNoteRecord.id}:re_synthetic`
        }
      ]);
      const audit = f.values('audit')[0];
      assert.equal(
        audit.action,
        full
          ? 'sponsorship_refund.stripe_full'
          : 'sponsorship_refund.stripe_partial'
      );
      assert.equal(audit.metadata.requestedAmount, amountMinor);
      assert.equal(audit.metadata.refundWorkflowStatus, 'completed');
      assert.equal(audit.metadata.paymentStatusUpdated, full);
      assert.equal(audit.actor, actor);
    }
  }
});

test('pending, failed and canceled Stripe outcomes preserve workflow distinctions and skip forbidden effects', async () => {
  for (const refundStatus of ['pending', 'failed', 'canceled', null]) {
    const f = fixture({ refundStatus });
    const result = await f.run();
    const accepted = !['failed', 'canceled'].includes(refundStatus);
    assert.equal(result.status, 200);
    assert.equal(result.payload.refunded, false);
    assert.equal(
      result.payload.refundWorkflowStatus,
      accepted ? 'processing' : 'failed'
    );
    assert.equal(f.values('payment').length, 0);
    assert.equal(f.values('creditNote').length, Number(accepted));
    assert.equal(f.values('creditEmail').length, Number(accepted));
    assert.equal(f.values('audit').length, 1);
    assert.equal(f.values('fail').length, 0);
  }
});

test('notification opt-in is strict and preserves no notification or recipient validation when disabled', async () => {
  for (const notifySponsor of [false, undefined, 'true']) {
    const f = fixture();
    const result = await f.run({
      body: JSON.stringify({
        ...requestBody,
        notifySponsor,
        notificationEmail: 'invalid',
        sponsorMessage: ''
      })
    });
    assert.equal(result.status, 200);
    assert.equal(result.payload.notification, undefined);
    assert.equal(f.values('creditEmail').length, 0);
    assert.equal(f.values('refundEmail').length, 0);
    assert.equal(f.values('audit')[0].metadata.notificationEmail, null);
  }
});

test('credit note failures retain settlement and audit, with the existing refund email fallback', async () => {
  for (const options of [{ creditNote: null }, { failing: 'creditNote' }]) {
    const f = fixture(options);
    const result = await f.run();
    assert.equal(result.status, 200);
    assert.equal(result.payload.refunded, true);
    assert.equal(result.payload.creditNote, null);
    assert.equal(f.values('fail').length, 0);
    assert.equal(f.values('creditEmail').length, 0);
    assert.deepEqual(f.values('refundEmail'), [
      {
        to: recipient,
        contributionId,
        publicReference: 'SYNTHETIC-REFERENCE',
        sponsorName: 'Synthetic sponsor',
        amount: 250,
        currency: 'CAD',
        refundId: 're_synthetic',
        refundStatus: 'succeeded',
        sponsorMessage: 'Synthetic sponsor message',
        refundNote: 'Synthetic note',
        idempotencyKey: `sponsorship-refund-email:${contributionId}:re_synthetic`
      }
    ]);
    assert.equal(
      f.values('audit')[0].metadata.creditNoteError,
      options.failing ? 'Synthetic dependency failure.' : null
    );
  }
  const refreshFailure = fixture({ failing: 'adminCreditNote' });
  assert.equal((await refreshFailure.run()).status, 200);
  assert.equal(refreshFailure.values('creditEmail').length, 1);
  assert.equal(refreshFailure.values('refundEmail').length, 0);
});

test('notification delivery results and errors remain explicit without undoing provider settlement', async () => {
  const notification = {
    ...notificationResult,
    attempted: true,
    error: 'Synthetic SMTP refusal.'
  };
  const f = fixture({ notification });
  const result = await f.run();
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload.notification, notification);
  assert.equal(
    f.values('audit')[0].metadata.notificationError,
    notification.error
  );
  assert.equal(f.values('fail').length, 0);
});

test('claim conflicts never reach Stripe or release a claim owned by another request', async () => {
  for (const code of [
    'SPONSORSHIP_CONCURRENT_UPDATE',
    'SPONSORSHIP_REFUND_NOT_ELIGIBLE'
  ]) {
    const f = fixture({
      failing: 'claim',
      failure: new SponsorshipRefundOperationError(code)
    });
    const result = await f.run();
    assert.equal(result.status, 409);
    assert.deepEqual(result.payload, {
      code,
      error: 'Refund claim refused; refresh the sponsorship.'
    });
    assert.equal(f.values('provider').length, 0);
    assert.equal(f.values('fail').length, 0);
  }
});

test('repeated completed and concurrent partial requests create only one logical provider call', async () => {
  const full = fixture({ durableClaim: true });
  assert.equal((await full.run()).status, 200);
  assert.equal((await full.run()).status, 409);
  assert.equal(full.values('provider').length, 1);
  assert.equal(full.values('audit').length, 1);
  const partial = fixture({ durableClaim: true });
  const body = JSON.stringify({ ...requestBody, amount: 12.5 });
  const results = await Promise.all([
    partial.run({ body }),
    partial.run({ body })
  ]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 409]);
  assert.equal(partial.values('provider').length, 1);
  assert.equal(partial.values('creditNote').length, 1);
  assert.equal(partial.values('creditEmail').length, 1);
  assert.equal(partial.values('fail').length, 0);
});

test('uncertain provider errors retain the durable claim; definitive rejection permits a controlled retry', async () => {
  const errors = [
    [new Error('Synthetic provider connection lost.'), false],
    [
      new Stripe.errors.StripeInvalidRequestError({
        message: 'Synthetic invalid request.',
        statusCode: 400,
        code: 'parameter_invalid_integer'
      }),
      true
    ],
    [
      new Stripe.errors.StripeInvalidRequestError({
        message: 'Synthetic key in use.',
        statusCode: 400,
        code: 'idempotency_key_in_use'
      }),
      false
    ],
    [
      new Stripe.errors.StripeInvalidRequestError({
        message: 'Synthetic server refusal.',
        statusCode: 500
      }),
      false
    ]
  ];
  for (const [failure, definitive] of errors) {
    const f = fixture({ durableClaim: true });
    let attempt = 0;
    f.ports.stripe.refunds.create = async (input, options) => {
      attempt++;
      if (attempt === 1) throw failure;
      return {
        id: 're_retry',
        amount: input.amount,
        currency: 'cad',
        status: 'succeeded',
        payment_intent: input.payment_intent
      };
    };
    const first = await f.run();
    assert.equal(first.status, 502);
    assert.equal(
      first.payload.code,
      definitive ? undefined : 'SPONSORSHIP_REFUND_UNCERTAIN'
    );
    assert.deepEqual(f.values('fail'), [{ operationId, definitive }]);
    assert.equal(f.values('settle').length, 0);
    const second = await f.run();
    assert.equal(second.status, definitive ? 200 : 409);
    assert.equal(attempt, definitive ? 2 : 1);
  }
});

test('errors after provider response keep its known outcome and never fail or release the durable operation', async () => {
  for (const failing of [
    'settle',
    'payment',
    'creditEmail',
    'audit',
    'sponsorship'
  ]) {
    const f = fixture({ failing });
    const result = await f.run();
    assert.equal(result.status, 502, failing);
    assert.deepEqual(
      result.payload,
      { error: 'Synthetic dependency failure.' },
      failing
    );
    assert.equal(f.values('provider').length, 1, failing);
    assert.equal(f.values('fail').length, 0, failing);
    assert.equal(f.values('report').at(-1)[1].uncertain, false, failing);
  }
  const fallbackEmail = fixture({ creditNote: null, failing: 'refundEmail' });
  assert.equal((await fallbackEmail.run()).status, 502);
  assert.equal(fallbackEmail.values('fail').length, 0);
});

test('failure to persist an uncertain outcome reports the blocked operation and never relaunches Stripe', async () => {
  const f = fixture({ failing: 'fail' });
  f.ports.stripe.refunds.create = async () => {
    throw new Error('Synthetic connection lost.');
  };
  const result = await f.run();
  assert.equal(result.status, 502);
  assert.equal(result.payload.code, 'SPONSORSHIP_REFUND_UNCERTAIN');
  assert.equal(f.values('fail').length, 1);
  assert.equal(
    f.values('report')[0][0],
    'Failed to record Stripe refund outcome; operation remains blocked.'
  );
  assert.equal(f.values('report')[1][1].uncertain, true);
});
