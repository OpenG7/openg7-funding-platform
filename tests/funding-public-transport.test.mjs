import assert from 'node:assert/strict';
import test from 'node:test';

import { FundingPublicClient } from '../dist/apps/funding-web/src/app/features/funding/services/funding-public.client.js';

const baseUrl = 'https://funding.example.test/api';
const checkoutRequest = {
  amount: 25,
  currency: 'CAD',
  projectId: 'openg7',
  successUrl: 'https://funding.example.test/fr/contribuer?checkout=success',
  cancelUrl: 'https://funding.example.test/fr/contribuer?checkout=cancel',
  contributionType: 'personal_support',
  publicDisplayConsent: false,
  publicDisplayName: 'Synthetic contributor',
  displayAmountConsent: false,
  nonCharityAcknowledged: true
};

const requests = [
  {
    name: 'checkout',
    path: '/checkout-sessions',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: checkoutRequest,
    result: {
      checkoutId: 'cs_synthetic',
      redirectUrl: 'https://checkout.example.test/synthetic',
      status: 'redirected'
    },
    fallback: 'Checkout API is unavailable.',
    invoke: (client) => client.startCheckout(checkoutRequest)
  },
  {
    name: 'public configuration',
    path: '/public/funding-config',
    method: 'GET',
    headers: { Accept: 'application/json' },
    result: {
      business_sponsorship_enabled: false,
      allowed_contribution_amounts: [5, 25],
      last_updated_at: '2026-01-01T00:00:00.000Z'
    },
    fallback: 'Funding runtime config could not be loaded.',
    invoke: (client) => client.getPublicFundingConfig()
  },
  {
    name: 'public reference lookup',
    path: '/reference-lookup',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: { reference: 'OG7-synthetic / +?é' },
    result: { found: false, publicReference: 'OG7-synthetic / +?é' },
    cancellable: true,
    fallback: 'OpenG7 reference lookup could not be completed.',
    invoke: (client, signal) =>
      client.lookupPublicReference({ reference: 'OG7-synthetic / +?é' }, signal)
  },
  {
    name: 'contribution reference recovery',
    path: '/reference-recovery',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: { email: 'synthetic+test@example.test' },
    result: { accepted: true },
    cancellable: true,
    fallback: 'Reference recovery could not be requested.',
    invoke: (client, signal) =>
      client.requestContributionReferenceRecovery(
        { email: 'synthetic+test@example.test' },
        signal
      )
  },
  {
    name: 'sponsorship batch availability',
    path: '/public/sponsorship-batches/availability',
    method: 'GET',
    headers: { Accept: 'application/json' },
    result: {
      data_source: 'empty',
      availability: [{ channel: 'facebook', nextAvailableAt: null }],
      slots: []
    },
    fallback: 'Sponsorship batch availability could not be loaded.',
    invoke: (client) => client.getSponsorshipBatchAvailability()
  }
];

test('public requests preserve payloads, response data and optional cancellation without admin credentials', async (t) => {
  for (const request of requests) {
    for (const withSignal of request.cancellable ? [false, true] : [false]) {
      await t.test(`${request.name}: signal ${withSignal}`, async (t) => {
        const client = new FundingPublicClient(baseUrl);
        const signal = withSignal ? new AbortController().signal : undefined;
        const fetchMock = t.mock.method(
          globalThis,
          'fetch',
          async (url, options) => {
            assert.equal(url, baseUrl + request.path);
            assert.deepEqual(options, {
              ...(request.cancellable ? { signal } : {}),
              method: request.method,
              headers: request.headers,
              ...(request.body ? { body: JSON.stringify(request.body) } : {})
            });
            return Response.json(request.result);
          }
        );
        assert.deepEqual(await request.invoke(client, signal), request.result);
        assert.equal(fetchMock.mock.callCount(), 1);
      });
    }
  }
});

test('public HTTP failures retain endpoint errors without decoding private error bodies or retrying', async (t) => {
  for (const request of requests) {
    for (const status of [400, 401, 403, 409, 503]) {
      await t.test(`${request.name}: ${status}`, async (t) => {
        const client = new FundingPublicClient(baseUrl);
        const response = Response.json(
          { error: 'Synthetic private error' },
          { status }
        );
        const decodeMock = t.mock.method(response, 'json', async () => {
          throw new Error('HTTP error bodies must not be decoded');
        });
        const fetchMock = t.mock.method(
          globalThis,
          'fetch',
          async () => response
        );
        await assert.rejects(request.invoke(client), {
          name: 'Error',
          message: request.fallback
        });
        assert.equal(decodeMock.mock.callCount(), 0);
        assert.equal(fetchMock.mock.callCount(), 1);
      });
    }
  }
});

test('public network and JSON decoding failures propagate without replay or checkout simulation', async (t) => {
  for (const request of requests) {
    for (const networkFailure of [false, true]) {
      await t.test(
        `${request.name}: ${networkFailure ? 'network' : 'decode'}`,
        async (t) => {
          const client = new FundingPublicClient(baseUrl);
          const failure = new TypeError('Synthetic transport failure');
          const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
            if (networkFailure) throw failure;
            return new Response('deliberately invalid JSON');
          });
          await assert.rejects(request.invoke(client), (error) =>
            networkFailure ? error === failure : error instanceof SyntaxError
          );
          assert.equal(fetchMock.mock.callCount(), 1);
        }
      );
    }
  }
});

test('reference recovery requires the literal accepted boolean even for HTTP success', async (t) => {
  for (const result of [
    {},
    { accepted: false },
    { accepted: 'true' },
    { accepted: 1 }
  ]) {
    await t.test(JSON.stringify(result), async (t) => {
      const client = new FundingPublicClient(baseUrl);
      const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
        Response.json(result)
      );
      await assert.rejects(
        client.requestContributionReferenceRecovery(requests[3].body),
        {
          name: 'Error',
          message: 'Reference recovery was not accepted.'
        }
      );
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }
});

test('reference lookup preserves pending payment and found states without inferring confirmation', async (t) => {
  const client = new FundingPublicClient(baseUrl);
  const result = {
    found: true,
    publicReference: 'OG7-synthetic',
    contributionType: 'sponsorship_interest',
    paymentStatus: 'pending',
    amount: null,
    displayAmount: false,
    currency: 'CAD',
    paidAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    reviewStatus: 'pending_review',
    detailsSubmitted: false,
    nextStep: 'wait_for_payment_confirmation'
  };
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json(result)
  );
  assert.deepEqual(
    await client.lookupPublicReference({ reference: 'OG7-synthetic' }),
    result
  );
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('checkout transport returns mocked results unchanged for the facade to enforce its local fallback policy', async (t) => {
  const client = new FundingPublicClient(baseUrl);
  const result = {
    checkoutId: 'mock_synthetic',
    redirectUrl: 'https://funding.example.test/fr/contribuer?checkout=success',
    status: 'mocked'
  };
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json(result)
  );
  assert.deepEqual(await client.startCheckout(checkoutRequest), result);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('reference cancellation forwards the same signal and abort reason before or during fetch', async (t) => {
  for (const request of requests.filter((request) => request.cancellable)) {
    for (const alreadyAborted of [false, true]) {
      await t.test(
        `${request.name}: ${alreadyAborted ? 'before' : 'during'}`,
        async (t) => {
          const client = new FundingPublicClient(baseUrl);
          const controller = new AbortController();
          const reason = new DOMException(
            'Synthetic cancellation',
            'AbortError'
          );
          if (alreadyAborted) controller.abort(reason);
          const fetchMock = t.mock.method(
            globalThis,
            'fetch',
            async (url, options) => {
              assert.equal(options.signal, controller.signal);
              options.signal.throwIfAborted();
              return new Promise((resolve, reject) => {
                options.signal.addEventListener(
                  'abort',
                  () => reject(options.signal.reason),
                  { once: true }
                );
              });
            }
          );
          const pending = request.invoke(client, controller.signal);
          const rejection = assert.rejects(
            pending,
            (error) => error === reason
          );
          if (!alreadyAborted) controller.abort(reason);
          await rejection;
          assert.equal(fetchMock.mock.callCount(), 1);
        }
      );
    }
  }
});

test('public clients run during SSR and retain the supplied base URL without browser access', async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    get: () => {
      throw new Error('Public transport must not access window');
    }
  });
  t.after(() => {
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  });
  for (const apiBaseUrl of ['/api', '', baseUrl]) {
    for (const request of requests) {
      await t.test(`${apiBaseUrl}: ${request.name}`, async (t) => {
        const client = new FundingPublicClient(apiBaseUrl);
        const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
          assert.equal(url, apiBaseUrl + request.path);
          return Response.json(request.result);
        });
        assert.deepEqual(await request.invoke(client), request.result);
        assert.equal(fetchMock.mock.callCount(), 1);
      });
    }
  }
});

test('unencodable public JSON requests fail before sending a mutation', async (t) => {
  const cyclic = {};
  cyclic.self = cyclic;
  for (const request of [
    (client) => client.startCheckout(cyclic),
    (client) => client.lookupPublicReference(cyclic),
    (client) => client.requestContributionReferenceRecovery(cyclic)
  ]) {
    await t.test(request.toString(), async (t) => {
      const client = new FundingPublicClient(baseUrl);
      const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
        throw new Error('Unencodable request must not be sent');
      });
      await assert.rejects(request(client), TypeError);
      assert.equal(fetchMock.mock.callCount(), 0);
    });
  }
});
