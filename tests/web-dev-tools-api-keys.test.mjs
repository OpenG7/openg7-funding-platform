import assert from 'node:assert/strict';
import test from 'node:test';

import { projectApiKeyCards } from '../dist/apps/funding-web/src/app/features/funding/pages/api-keys-page/api-keys-catalog.js';

const status = (overrides = {}) =>
  Object.freeze({
    environment: 'development',
    apiReachable: false,
    stripeSecretKeyConfigured: false,
    stripeWebhookSecretConfigured: false,
    databaseUrlConfigured: false,
    databaseReachable: false,
    transparencySource: 'none',
    localApiBaseUrl: 'http://localhost:3333',
    checkoutEndpoint: 'http://localhost:3333/api/checkout-sessions',
    webhookEndpoint: 'http://localhost:3333/api/stripe/webhook',
    publicTransparencyEndpoint:
      'http://localhost:3333/api/public/fund-transparency',
    stripeDashboardUrl: 'https://dashboard.stripe.com/test/webhooks',
    lastCheckedAt: '1970-01-01T00:00:00.000Z',
    ...overrides
  });

test('key diagnostics keep configuration independent from API availability', () => {
  for (const apiReachable of [false, true]) {
    for (const stripeSecretKeyConfigured of [false, true]) {
      for (const stripeWebhookSecretConfigured of [false, true]) {
        const snapshot = status({
          apiReachable,
          stripeSecretKeyConfigured,
          stripeWebhookSecretConfigured
        });
        const cards = projectApiKeyCards(snapshot);
        const card = (id) => cards.find((item) => item.id === id);

        assert.equal(card('publishable').configured, true);
        assert.equal(card('secret').configured, stripeSecretKeyConfigured);
        assert.equal(card('webhook').configured, stripeWebhookSecretConfigured);
        assert.equal(card('environment').configured, apiReachable);
        assert.equal(
          card('secret').statusLabel,
          stripeSecretKeyConfigured
            ? 'Configuree cote API'
            : 'Manquante cote API'
        );
        assert.equal(
          card('webhook').statusLabel,
          stripeWebhookSecretConfigured
            ? 'Configure cote API'
            : 'Manquant cote API'
        );
        assert.equal(
          card('environment').statusLabel,
          apiReachable ? 'API locale joignable' : 'API locale a verifier'
        );
        assert.deepEqual(projectApiKeyCards(snapshot), cards);
      }
    }
  }
});

test('key projections expose fixed masks and placeholders instead of copying private fields', () => {
  const privateValue = 'synthetic-private-value-must-not-render';
  const snapshot = status({
    stripeSecretKeyConfigured: true,
    stripeWebhookSecretConfigured: true,
    localApiBaseUrl: 'http://localhost:4444',
    stripeSecretKey: privateValue,
    stripeWebhookSecret: privateValue
  });
  const cards = projectApiKeyCards(snapshot);

  assert.deepEqual(
    cards.map((card) => card.maskedValue),
    [
      'pk_live_************************',
      'sk_live_************************',
      'whsec_************************',
      'http://localhost:4444'
    ]
  );
  assert.deepEqual(
    cards.map((card) => card.command),
    [
      'pk_live_REMPLACE_MOI',
      '$env:STRIPE_SECRET_KEY="sk_live_REMPLACE_MOI"',
      '$env:STRIPE_WEBHOOK_SECRET="whsec_REMPLACE_MOI"',
      'corepack yarn dev:api'
    ]
  );
  assert.equal(JSON.stringify(cards).includes(privateValue), false);
  assert.equal(snapshot.stripeSecretKey, privateValue);
  assert.equal(snapshot.stripeWebhookSecret, privateValue);
});
