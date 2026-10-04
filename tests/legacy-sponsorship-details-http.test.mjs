import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createLegacySponsorshipDetailsHttpHandler } from '../dist/apps/funding-api/src/legacy-sponsorship-details.http.js';
import { readBody } from '../dist/apps/funding-api/src/http-transport.js';
import {
  isSponsorshipEmail,
  isSponsorshipHttpsUrl
} from '../dist/packages/funding-core/src/index.js';

const input = {
  sessionId: 'cs_synthetic',
  companyName: ' Synthetic company ',
  contactName: ' Synthetic contact ',
  contactEmail: ' synthetic@example.test ',
  websiteUrl: ' https://example.test/website ',
  logoUrl: ' https://example.test/logo.png ',
  message: ' Synthetic message '
};
const session = {
  id: input.sessionId,
  payment_intent: { id: 'pi_synthetic', created: 1780000000 },
  created: 1770000000,
  amount_total: 25000,
  currency: 'cad',
  payment_status: 'paid',
  metadata: {
    contributionType: 'sponsorship_interest',
    publicReference: 'og7-2026-abcdef',
    publicDisplayConsent: 'true',
    displayAmountConsent: 'false',
    nonCharityAcknowledged: 'true'
  }
};
const fixture = ({
  stripeEnabled = true,
  providerSession = session,
  recorded = true,
  failures = {}
} = {}) => {
  const calls = [];
  const record = (name, value) => {
    calls.push({ name, value });
    if (failures[name]) throw failures[name];
  };
  const handler = createLegacySponsorshipDetailsHttpHandler({
    publicBaseOrigin: 'https://funding.example.test',
    SPONSOR_TEXT_MAX_LENGTH: 200,
    SPONSOR_MESSAGE_MAX_LENGTH: 1000,
    stripe: stripeEnabled
      ? {
          checkout: {
            sessions: {
              retrieve: async (...args) => {
                record('retrieve', args);
                return providerSession;
              }
            }
          },
          paymentIntents: { update: async (...args) => record('update', args) }
        }
      : null,
    readBody: async (request, limit) => {
      record('body', limit);
      return readBody(request, limit);
    },
    writeJson: (_request, response, status, payload) => {
      record('response', status);
      Object.assign(response, { status, payload });
    },
    isNonEmptySponsorText: (value, limit) =>
      typeof value === 'string' &&
      value.trim().length > 0 &&
      value.trim().length <= limit,
    isValidSponsorEmail: (value) => isSponsorshipEmail(value, 200),
    isValidOptionalHttpsUrl: (value) =>
      value == null ||
      value === '' ||
      (typeof value === 'string' &&
        value.length <= 2048 &&
        isSponsorshipHttpsUrl(value)),
    truncateStripeMetadataValue: (value) => value.slice(0, 480),
    resolveStripePaymentIntentId: (value) =>
      typeof value === 'string' ? value : (value?.id ?? null),
    recordSponsorshipDetails: async (details) => {
      record('persist', details);
      return recorded;
    },
    reportFailure: (...args) => record('failure', args)
  });
  const invoke = async (
    payload = input,
    { method = 'POST', url = '/sponsorship-details' } = {}
  ) => {
    const request = Readable.from([
      typeof payload === 'string' ? payload : JSON.stringify(payload)
    ]);
    Object.assign(request, { method, url, headers: {} });
    const response = {};
    return { handled: await handler(request, response), ...response };
  };
  return { calls, invoke };
};

test('Legacy details preserve aliases and POST fallthrough; missing Stripe rejects before consuming a body', async () => {
  const missing = fixture({ stripeEnabled: false });
  assert.deepEqual(await missing.invoke('{'), {
    handled: true,
    status: 503,
    payload: { error: 'Stripe is not configured.' }
  });
  assert.deepEqual(
    missing.calls.map(({ name }) => name),
    ['response']
  );
  for (const options of [
    { method: 'GET' },
    { url: '/sponsorship-details/extra' },
    { url: '/sponsorship-followup/details' }
  ]) {
    const f = fixture();
    assert.deepEqual(await f.invoke(input, options), { handled: false });
    assert.deepEqual(f.calls, []);
  }
  assert.equal(
    (await fixture().invoke(input, { url: '/api/sponsorship-details?x=1' }))
      .status,
    200
  );
});

test('Legacy field validation preserves each rejection before provider retrieval', async () => {
  for (const [payload, error] of [
    ['{', 'Invalid sponsorship details request body.'],
    [null, 'Invalid sponsorship details request body.'],
    [[], 'Invalid sponsorship details request body.'],
    [true, 'Invalid sponsorship details request body.'],
    [42, 'Invalid sponsorship details request body.'],
    ['"synthetic-request"', 'Invalid sponsorship details request body.'],
    [
      { ...input, sessionId: 'pi_synthetic' },
      'Invalid Stripe checkout session id.'
    ],
    [
      { ...input, sessionId: `cs_${'x'.repeat(200)}` },
      'Invalid Stripe checkout session id.'
    ],
    [{ ...input, companyName: ' ' }, 'Company name is required.'],
    [
      { ...input, companyName: 'Synthetic\u0000company' },
      'Company name is required.'
    ],
    [{ ...input, companyName: 'x'.repeat(201) }, 'Company name is required.'],
    [{ ...input, contactName: ' ' }, 'Contact name is required.'],
    [
      { ...input, contactEmail: 'invalid' },
      'A valid contact email is required.'
    ],
    [
      { ...input, websiteUrl: 'http://example.test' },
      'Website URL must be a valid https link.'
    ],
    [
      { ...input, logoUrl: 'javascript:bad' },
      'Logo URL must be a valid https link.'
    ],
    [{ ...input, message: 'x'.repeat(1001) }, 'Message is too long.'],
    [{ ...input, message: 'Synthetic\u0000message' }, 'Message is too long.']
  ]) {
    const f = fixture();
    assert.deepEqual(await f.invoke(payload), {
      handled: true,
      status: 400,
      payload: { error }
    });
    assert.deepEqual(
      f.calls.map(({ name }) => name),
      ['body', 'response']
    );
  }
});

test('Legacy details require provider-confirmed sponsorship payment before any write', async () => {
  for (const [options, status, error] of [
    [
      { failures: { retrieve: new Error('synthetic missing session') } },
      404,
      'Checkout session not found.'
    ],
    [
      {
        providerSession: {
          ...session,
          metadata: { contributionType: 'personal_support' }
        }
      },
      400,
      'This checkout session is not a sponsorship interest contribution.'
    ],
    [
      { providerSession: { ...session, payment_status: 'unpaid' } },
      409,
      'Payment for this checkout session is not confirmed yet.'
    ]
  ]) {
    const f = fixture(options);
    assert.deepEqual(await f.invoke(), {
      handled: true,
      status,
      payload: { error }
    });
    assert.deepEqual(
      f.calls.map(({ name }) => name),
      ['body', 'retrieve', 'response']
    );
  }
});

test('Legacy details preserve expanded retrieval, metadata then record ordering and normalized input', async () => {
  const f = fixture();
  assert.deepEqual(await f.invoke(), {
    handled: true,
    status: 200,
    payload: { received: true, recorded: true }
  });
  assert.deepEqual(
    f.calls.map(({ name }) => name),
    ['body', 'retrieve', 'update', 'persist', 'response']
  );
  assert.deepEqual(f.calls[1].value, [
    'cs_synthetic',
    { expand: ['payment_intent'] }
  ]);
  assert.deepEqual(f.calls[2].value, [
    'pi_synthetic',
    {
      metadata: {
        sponsorCompanyName: 'Synthetic company',
        sponsorContactName: 'Synthetic contact',
        sponsorContactEmail: 'synthetic@example.test',
        sponsorWebsiteUrl: 'https://example.test/website',
        sponsorLogoUrl: 'https://example.test/logo.png',
        sponsorMessage: 'Synthetic message'
      }
    }
  ]);
  assert.deepEqual(f.calls[3].value, {
    stripeSessionId: 'cs_synthetic',
    stripePaymentIntentId: 'pi_synthetic',
    publicReference: 'OG7-2026-ABCDEF',
    amountCents: 25000,
    currency: 'cad',
    publicDisplayConsent: true,
    displayAmountConsent: false,
    nonCharityAcknowledged: true,
    paidAtIso: new Date(1780000000 * 1000).toISOString(),
    companyName: 'Synthetic company',
    contactName: 'Synthetic contact',
    contactEmail: 'synthetic@example.test',
    websiteUrl: 'https://example.test/website',
    logoUrl: 'https://example.test/logo.png',
    message: 'Synthetic message'
  });
});

test('Legacy recording remains independent of database availability and provider metadata failure', async () => {
  for (const options of [
    { recorded: false },
    { failures: { update: new Error('synthetic provider metadata failure') } },
    { failures: { persist: new Error('synthetic persistence failure') } }
  ]) {
    const f = fixture(options);
    const result = await f.invoke();
    assert.equal(result.status, 200);
    assert.deepEqual(result.payload, {
      received: true,
      recorded: !(options.recorded === false || options.failures?.persist)
    });
    assert.equal(f.calls.filter(({ name }) => name === 'retrieve').length, 1);
    assert.equal(f.calls.filter(({ name }) => name === 'persist').length, 1);
  }
});

test('Legacy absent payment intent skips metadata writes and uses Checkout creation time and defaults', async () => {
  const f = fixture({
    providerSession: {
      ...session,
      payment_intent: null,
      amount_total: null,
      currency: null
    }
  });
  assert.equal(
    (
      await f.invoke({
        ...input,
        websiteUrl: '',
        logoUrl: undefined,
        message: undefined
      })
    ).status,
    200
  );
  assert.deepEqual(
    f.calls.map(({ name }) => name),
    ['body', 'retrieve', 'persist', 'response']
  );
  const persisted = f.calls[2].value;
  assert.equal(persisted.stripePaymentIntentId, null);
  assert.equal(
    persisted.paidAtIso,
    new Date(session.created * 1000).toISOString()
  );
  assert.equal(persisted.amountCents, 0);
  assert.equal(persisted.currency, 'cad');
  assert.equal(persisted.websiteUrl, null);
  assert.equal(persisted.logoUrl, null);
  assert.equal(persisted.message, null);
});
