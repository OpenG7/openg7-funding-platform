import assert from 'node:assert/strict';
import test from 'node:test';

import {
  producerSettingsFromEnv,
  preparationInput,
  snapshotHash
} from '../dist/apps/funding-api/src/preflight/source.js';
import { createPreflightConnectorWorker } from '../dist/apps/funding-api/src/preflight/worker.js';

test('preflight source is opt-in and validates its tenant/cost without touching a provider', () => {
  assert.deepEqual(producerSettingsFromEnv({}), {
    enabled: false,
    tenantId: '',
    maxCostUsd: 0
  });
  const env = {
    PREFLIGHT_ENABLED: 'true',
    PREFLIGHT_TENANT_ID: 'synthetic-tenant'
  };
  assert.equal(producerSettingsFromEnv(env).maxCostUsd, 0.5);
  for (const extra of [
    { PREFLIGHT_TENANT_ID: '' },
    { PREFLIGHT_MAX_COST_USD: 'NaN' },
    { PREFLIGHT_MAX_COST_USD: '-1' },
    { PREFLIGHT_MAX_COST_USD: '101' }
  ])
    assert.throws(
      () => producerSettingsFromEnv({ ...env, ...extra }),
      /CONFIGURATION_INVALID/
    );
});
test('snapshot hashes ignore property order and preparation input omits private source facts', () => {
  assert.equal(snapshotHash({ b: 2, a: 1 }), snapshotHash({ a: 1, b: 2 }));
  const snapshot = {
    commitmentId: 'synthetic',
    contributionId: 'private',
    commitmentVersion: 1,
    offerFingerprint: 'digest',
    eligible: true,
    paymentStatus: 'paid',
    refundStatus: 'not_requested',
    consent: true,
    reviewStatus: 'pending',
    title: 'Example company',
    description: 'Draft only',
    benefits: ['One Web draft'],
    obligations: []
  };
  const input = preparationInput(snapshot, 'a'.repeat(64));
  assert.deepEqual(
    Object.keys(input).sort(),
    [
      'title',
      'description',
      'benefits',
      'sourceSnapshotDigest',
      'sourceCommitmentVersion',
      'preparationOnly'
    ].sort()
  );
  assert.equal(JSON.stringify(input).includes('private'), false);
});
test('disabled relay makes no database or provider calls', async () => {
  const fail = () => {
    throw new Error('must not be called');
  };
  const worker = createPreflightConnectorWorker({
    pool: { query: fail, connect: fail },
    settings: { enabled: false, tenantId: '', maxCostUsd: 0 },
    client: { submit: fail, getMission: fail, notifySourceUpdate: fail }
  });
  assert.deepEqual(await worker.tick(), { delivered: 0, polled: 0 });
  await worker.stop();
});
