import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyProviders } from '../scripts/providers-verify.mjs';

const env = {
  STRIPE_SECRET_KEY: 'sk_test_synthetic',
  SMTP_ENABLED: 'true',
  SPONSOR_MEDIA_STORAGE_DRIVER: 'ovh-s3',
  SPONSOR_MEDIA_ENDPOINT: 'https://storage.example.invalid',
  SPONSOR_MEDIA_REGION: 'test',
  OVH_S3_ACCESS_KEY_ID: 'synthetic',
  OVH_S3_SECRET_ACCESS_KEY: 'synthetic-secret',
  SPONSOR_MEDIA_PRIVATE_BUCKET: 'private',
  SPONSOR_MEDIA_PUBLIC_BUCKET: 'public'
};
test('provider verification is bounded to test Stripe, SMTP authentication and bucket reads', async () => {
  const calls = [];
  const report = await verifyProviders(env, {
    stripe: async () => calls.push('stripe'),
    smtp: async () => calls.push('smtp'),
    s3: async (_env, key) => calls.push(key)
  });
  assert.equal(report.length, 4);
  assert.ok(report.every((r) => r.status === 'verified'));
  assert.equal(calls.length, 4);
  let stripeCalled = false;
  const live = await verifyProviders(
    { ...env, STRIPE_SECRET_KEY: 'sk_live_synthetic' },
    {
      stripe: async () => {
        stripeCalled = true;
      },
      smtp: async () => {},
      s3: async () => {}
    }
  );
  assert.equal(stripeCalled, false);
  assert.equal(live[0].status, 'not_configured');
});
test('provider errors cannot leak credentials or payloads into the report', async () => {
  const fail = async () => {
    throw new Error('synthetic-secret private-address provider-payload');
  };
  const report = await verifyProviders(env, {
    stripe: fail,
    smtp: fail,
    s3: fail
  });
  assert.ok(report.every((r) => r.status === 'failed'));
  assert.equal(JSON.stringify(report).includes('synthetic-secret'), false);
});
