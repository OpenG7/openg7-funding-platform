// Thin wrapper around the Stripe stub's `/__test__/...` control channel
// (tests/stripe-stub/server.mjs). Plain .mjs (not .ts) so it can be imported
// unchanged by both scripts/e2e-seed.mjs (plain `node`, no TS loader) and the
// Playwright specs (ts-node/esm), the same way fixtures/e2e-fixtures.mjs is.
//
// The stub's real /v1/... surface is only reachable from inside the Docker
// `data` network (the `api` container talks to it as `stripe-stub:4242`);
// this control channel is host-bound (127.0.0.1:4242, see
// docker-compose.e2e.yml) specifically so both the seed script and Playwright
// specs, running on the host, can seed/reset it directly -- the same way
// scripts/e2e-seed.mjs shells into the postgres container for Postgres rows.

const STUB_BASE_URL =
  process.env.STRIPE_STUB_BASE_URL ?? 'http://127.0.0.1:4242';

const post = async (path, body) => {
  const response = await fetch(`${STUB_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(
      `stripe-stub ${path} responded ${response.status}: ${await response.text()}`
    );
  }
};

const patch = async (path, body) => {
  const response = await fetch(`${STUB_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(
      `stripe-stub ${path} responded ${response.status}: ${await response.text()}`
    );
  }
};

export const resetStripeStub = () => post('/__test__/reset');

export const registerStripePaymentIntent = (params) =>
  post('/__test__/payment-intents', params);

export const updateStripeBalanceTransaction = (id, params) =>
  patch(`/__test__/balance-transactions/${encodeURIComponent(id)}`, params);

export const registerStripeCheckoutSession = (params) =>
  post('/__test__/checkout-sessions', params);

export const registerStripePayout = (params) =>
  post('/__test__/payouts', params);

export const registerStripeDispute = (params) =>
  post('/__test__/disputes', params);
