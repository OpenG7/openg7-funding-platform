import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  parseStripeBackfillScope,
  AdminStripeBackfillService
} from '../dist/apps/funding-api/src/admin-stripe-backfill.service.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';

test('Stripe admin recovery rejects invalid, excessive and future scopes', () => {
  const now = Date.parse('2026-09-27T16:00:00Z');
  const scope = { from: '2026-09-01', to: '2026-09-27', limit: 100 };
  assert.deepEqual(parseStripeBackfillScope(scope, now), scope);
  for (const invalid of [
    null,
    [],
    {},
    { ...scope, from: '2026-02-30' },
    { ...scope, from: '2026-08-01' },
    { ...scope, to: '2026-09-28' },
    { ...scope, to: '2026-08-31' },
    ...[0, 101, 1.5, '10', null].map((limit) => ({ ...scope, limit })),
    { ...scope, includeUnmatched: true }
  ]) {
    assert.throws(() => parseStripeBackfillScope(invalid, now), {
      code: 'INVALID_SCOPE',
      status: 400
    });
  }
});

test('Stripe recovery and its receipts are owner-only for both route prefixes', () => {
  for (const path of ['/admin/stripe-backfill', '/api/admin/stripe-backfill']) {
    for (const method of ['GET', 'POST']) {
      assert.equal(adminRoleAllows('owner', method, path), true);
      for (const role of ['reader', 'operator'])
        assert.equal(adminRoleAllows(role, method, path), false);
    }
  }
});

test('local recovery refuses live or malformed credentials before connecting', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const pool = {
    connect() {
      throw new Error('Should not connect');
    }
  };
  for (const apiKey of ['sk_live_synthetic', 'rk_live_synthetic', 'invalid']) {
    const service = new AdminStripeBackfillService(
      pool,
      {},
      { apiKey, projectId: 'openg7', environment: 'development' }
    );
    await assert.rejects(
      service.preview({ from: today, to: today, limit: 1 }, 'owner'),
      { code: 'STRIPE_MODE_UNAVAILABLE' }
    );
  }
});

test('Stripe recovery French and English have the same complete message keys', () => {
  const messages = (locale) =>
    JSON.parse(
      readFileSync(`apps/funding-web/src/assets/i18n/${locale}.json`, 'utf8')
    ).admin.stripeBackfill;
  const keys = (value) =>
    Object.entries(value)
      .flatMap(([key, text]) =>
        typeof text === 'object'
          ? keys(text).map((child) => key + '.' + child)
          : (assert.ok(text.trim()), [key])
      )
      .sort();
  assert.deepEqual(keys(messages('fr-CA')), keys(messages('en')));
});
