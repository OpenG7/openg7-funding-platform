import assert from 'node:assert/strict';
import test from 'node:test';

import {
  stripeSetupAccountDiagnostic,
  stripeSetupSecurityChecks,
  stripeSetupStages,
  stripeSetupSteps,
  stripeSetupWebhookDiagnostic
} from '../dist/apps/funding-web/src/app/features/funding/pages/stripe-setup-page/stripe-setup-projections.js';

function status(overrides = {}) {
  return Object.freeze({
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
    lastCheckedAt: '2026-10-03T12:00:00.000Z',
    ...overrides
  });
}

test('setup progress preserves unavailable and partially configured diagnostics', () => {
  const unavailable = stripeSetupStages(status(), 'live');
  assert.deepEqual(
    unavailable.map(({ state }) => state),
    ['pending', 'pending', 'active', 'pending', 'pending']
  );
  assert.equal(unavailable[1].detail, 'A configurer');
  assert.equal(
    stripeSetupStages(status({ apiReachable: true }), 'test')[1].state,
    'active'
  );
  for (const [transparencySource, detail] of [
    ['database', 'PostgreSQL actif'],
    ['stripe', 'Stripe direct']
  ]) {
    const stages = stripeSetupStages(status({ transparencySource }), 'test');
    assert.equal(stages[1].detail, detail);
    assert.equal(stages[1].state, 'complete');
  }
  const onlySecret = stripeSetupStages(
    status({ stripeSecretKeyConfigured: true }),
    'live'
  );
  assert.equal(onlySecret[2].state, 'active');
  assert.equal(onlySecret[4].state, 'pending');
});

test('local payment mode changes only the final progress stage without changing server facts', () => {
  const ready = status({
    apiReachable: true,
    stripeSecretKeyConfigured: true,
    stripeWebhookSecretConfigured: true,
    transparencySource: 'stripe'
  });
  const before = structuredClone(ready);
  const live = stripeSetupStages(ready, 'live');
  const localTest = stripeSetupStages(ready, 'test');
  assert.deepEqual(live.slice(0, 4), localTest.slice(0, 4));
  assert.equal(live[4].state, 'complete');
  assert.equal(live[4].detail, 'Pret');
  assert.equal(localTest[4].state, 'pending');
  assert.equal(localTest[4].detail, 'A faire');
  assert.deepEqual(ready, before);
});

test('account, webhook and security diagnostics retain independent readiness signals', () => {
  const partial = status({
    apiReachable: true,
    stripeWebhookSecretConfigured: true,
    webhookEndpoint: 'http://localhost:3333/synthetic/webhook'
  });
  const account = stripeSetupAccountDiagnostic(partial);
  const webhook = stripeSetupWebhookDiagnostic(partial);
  assert.equal(account.connected, true);
  assert.equal(account.connectionLabel, 'Compte Stripe connecte');
  assert.equal(account.payoutsReady, false);
  assert.equal(account.payoutLabel, 'Cle Stripe a verifier');
  assert.equal(webhook.configured, true);
  assert.equal(webhook.statusLabel, 'Actif');
  assert.equal(webhook.endpoint, partial.webhookEndpoint);
  assert.equal(webhook.dashboardUrl, partial.stripeDashboardUrl);
  assert.deepEqual(
    stripeSetupSecurityChecks(partial).map(({ state }) => state),
    ['progress', 'complete', 'complete', 'complete', 'complete']
  );
  assert.equal(stripeSetupAccountDiagnostic(status()).connected, false);
  assert.equal(
    stripeSetupWebhookDiagnostic(status()).statusLabel,
    'A configurer'
  );
});

test('setup guide retains manual commands and blocked local checks, then reflects server readiness', () => {
  const unavailable = stripeSetupSteps(status());
  const find = (steps, id) => steps.find((step) => step.id === id);
  assert.equal(find(unavailable, 'run-app').status, 'blocked');
  assert.equal(find(unavailable, 'transparency').status, 'blocked');
  assert.equal(find(unavailable, 'database').statusLabel, 'Non requis');
  assert.equal(find(unavailable, 'stripe-secret').status, 'manual');
  assert.equal(find(unavailable, 'webhook-secret').status, 'manual');

  const ready = status({
    apiReachable: true,
    stripeSecretKeyConfigured: true,
    stripeWebhookSecretConfigured: true,
    databaseReachable: true,
    transparencySource: 'stripe',
    webhookEndpoint: 'http://localhost:3333/synthetic/webhook',
    publicTransparencyEndpoint: 'http://localhost:3333/synthetic/transparency'
  });
  const before = structuredClone(ready);
  const available = stripeSetupSteps(ready);
  for (const id of [
    'stripe-secret',
    'webhook-secret',
    'run-app',
    'transparency'
  ]) {
    assert.equal(find(available, id).status, 'verified');
  }
  assert.equal(find(available, 'database').statusLabel, 'Journal actif');
  assert.ok(
    find(available, 'database').checklist.includes(
      'Mode lancement rapide: Stripe direct'
    )
  );
  assert.equal(
    find(available, 'webhook-secret').links[0].url,
    ready.webhookEndpoint
  );
  assert.equal(
    find(available, 'transparency').links[0].url,
    ready.publicTransparencyEndpoint
  );
  assert.deepEqual(
    find(available, 'test-events').commands,
    find(unavailable, 'test-events').commands
  );
  assert.equal(find(available, 'test-events').commands.length, 8);
  assert.equal(
    find(available, 'stripe-cli').commands[1].value,
    'stripe listen --forward-to localhost:3333/api/stripe/webhook'
  );
  assert.deepEqual(ready, before);
});
