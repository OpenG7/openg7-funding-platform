import assert from 'node:assert/strict';
import { test } from 'node:test';
import Stripe from 'stripe';

import { processStripeWebhook } from '../dist/apps/funding-api/src/stripe-webhook.service.js';

const stripe = new Stripe('sk_test_disposable_fixture', {
  host: '127.0.0.1',
  port: 1,
  protocol: 'http',
  maxNetworkRetries: 0
});
const secret = 'whsec_disposable_fixture';
const payload = JSON.stringify({
  id: 'evt_ignored_fixture',
  type: 'test.ignored',
  data: { object: {} }
});

test('a bad Stripe signature never opens a database connection', async () => {
  const pool = {
    connect() {
      throw new Error('Database must not be reached');
    }
  };
  const response = await processStripeWebhook(payload, 'invalid', {
    stripe,
    webhookSecret: secret,
    pool,
    publicBaseUrl: 'https://example.test'
  });
  assert.equal(response.statusCode, 400);
});

test('an ignored verified event is accepted in Stripe-direct mode', async () => {
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret
  });
  const response = await processStripeWebhook(payload, signature, {
    stripe,
    webhookSecret: secret,
    pool: null,
    publicBaseUrl: 'https://example.test'
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ignored, true);
});

test('unavailable event persistence requests a Stripe retry', async () => {
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret
  });
  const response = await processStripeWebhook(payload, signature, {
    stripe,
    webhookSecret: secret,
    pool: {
      async connect() {
        throw new Error('Simulated DB outage');
      }
    },
    publicBaseUrl: 'https://example.test'
  });
  assert.equal(response.statusCode, 500);
  assert.equal(response.payload.received, false);
});
