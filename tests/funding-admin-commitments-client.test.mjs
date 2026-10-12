import assert from 'node:assert/strict';
import test from 'node:test';
import { FundingAdminCommitmentsClient } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-commitments.client.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';
test('commercial clients reuse saved authenticated transport with no-store and exact command bodies', async () => {
  const calls = [];
  const client = new FundingAdminCommitmentsClient({
    requestAdminJson: async (path, options) => {
      calls.push({ path, options });
      return Response.json({ commitment: null });
    }
  });
  const qualification = {
    requestId: 'synthetic-request',
    contributionId: 'synthetic-dossier',
    expectedVersion: 1,
    confirmation: 'synthetic-dossier',
    reason: 'Synthetic agreement',
    evidenceReference: 'synthetic://evidence',
    offer: {
      version: 'historical-qualification-v1',
      amountMinor: 50000,
      currency: 'CAD',
      benefits: []
    }
  };
  const adjustment = {
    requestId: 'synthetic-adjustment',
    obligationId: 'synthetic-obligation',
    expectedVersion: 2,
    confirmation: 'synthetic-obligation',
    reason: 'Synthetic adjustment',
    kind: 'format',
    format: 'individual_portrait'
  };
  await client.get('synthetic /');
  await client.qualify(qualification);
  await client.adjust(adjustment);
  await client.adoptionPreview(50, 'cursor /');
  assert.deepEqual(
    calls.map((c) => c.path),
    [
      '/admin/sponsorship-commitments?contributionId=synthetic+%2F',
      '/admin/sponsorship-commitments/qualify',
      '/admin/sponsorship-commitments/adjust',
      '/admin/sponsorship-commitments/adoption-preview?pageSize=50&cursor=cursor+%2F'
    ]
  );
  assert.ok(
    calls.every(
      (c) => c.options.auth === 'saved' && c.options.cache === 'no-store'
    )
  );
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[3].options.body, undefined);
  assert.equal(calls[1].options.body, qualification);
  assert.equal(calls[2].options.body, adjustment);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
});
test('commercial errors preserve status/code and never replay a mutation automatically', async () => {
  for (const status of [400, 401, 403, 409, 503]) {
    let calls = 0;
    const client = new FundingAdminCommitmentsClient({
      requestAdminJson: async () => {
        calls++;
        return Response.json(
          { code: 'COMMITMENT_VERSION_CONFLICT' },
          { status }
        );
      }
    });
    await assert.rejects(
      client.adjust({}),
      (error) =>
        error instanceof AdminDashboardRequestError &&
        error.status === status &&
        error.code === 'COMMITMENT_VERSION_CONFLICT'
    );
    assert.equal(calls, 1);
  }
});
