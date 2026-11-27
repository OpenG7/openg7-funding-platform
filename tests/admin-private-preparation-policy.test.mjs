import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePrivatePreparationPolicy,
  privatePreparationRequestId
} from '../dist/apps/funding-api/src/admin-private-preparation-policy.js';
import { AdminAutomaticRunsService } from '../dist/apps/funding-api/src/admin-automatic-runs.service.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity.js';

const policy = {
  capability: 'private_preparation',
  confirmed: true,
  maxDossiers: 1,
  maxDrafts: 4,
  maxProviderCalls: 0,
  maxCostMinor: 0,
  costCurrency: 'CAD',
  expiresAt: '2026-11-25T12:10:00.000Z'
};

test('private preparation opt-in is exact, zero-cost, one dossier and up to four drafts', () => {
  assert.equal(parsePrivatePreparationPolicy(undefined), undefined);
  assert.deepEqual(parsePrivatePreparationPolicy(policy), policy);
  for (const change of [
    { capability: 'publish' },
    { confirmed: false },
    { maxDossiers: 2 },
    { maxDrafts: 0 },
    { maxDrafts: 5 },
    { maxDrafts: 1.1 },
    { maxProviderCalls: 1 },
    { maxCostMinor: 1 },
    { costCurrency: 'USD' },
    { extra: true },
    { expiresAt: '2026-11-25' },
    { expiresAt: '2026-02-30T12:10:00.000Z' },
    { expiresAt: '2026-11-25T12:10:00+00:00' }
  ])
    assert.throws(
      () => parsePrivatePreparationPolicy({ ...policy, ...change }),
      { code: 'RUN_POLICY_INVALID' }
    );
  for (const raw of [null, {}, [], 'private_preparation'])
    assert.throws(() => parsePrivatePreparationPolicy(raw), {
      code: 'RUN_POLICY_INVALID'
    });
});

test('bounded preparation requires explicit confirmation and exact selection before any database access', async () => {
  const service = new AdminAutomaticRunsService({
    connect() {
      throw new Error('Unexpected database access');
    }
  });
  for (const raw of [
    { requestId: '11111111-1111-4111-8111-111111111111' },
    null
  ])
    await assert.rejects(service.prepareBounded(raw, 'synthetic'), {
      code: 'RUN_POLICY_REQUIRED'
    });
  await assert.rejects(
    service.prepareBounded(
      {
        requestId: '11111111-1111-4111-8111-111111111111',
        preparationPolicy: policy
      },
      'synthetic'
    ),
    { code: 'RUN_POLICY_SCOPE_REQUIRED' }
  );
});

test('bounded command identities survive restart and differ from start and other runs', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const command = privatePreparationRequestId(id);
  assert.match(
    command,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/
  );
  assert.equal(privatePreparationRequestId(id.toUpperCase()), command);
  assert.notEqual(command, id);
  assert.notEqual(
    command,
    privatePreparationRequestId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  );
});

test('bounded preparation requires operator or owner rights for both HTTP aliases', () => {
  for (const prefix of ['/api', '']) {
    assert.equal(
      adminRoleAllows(
        'reader',
        'POST',
        prefix + '/admin/automatic-runs/prepare-bounded'
      ),
      false
    );
    assert.equal(
      adminRoleAllows(
        'operator',
        'POST',
        prefix + '/admin/automatic-runs/prepare-bounded'
      ),
      true
    );
    assert.equal(
      adminRoleAllows(
        'owner',
        'POST',
        prefix + '/admin/automatic-runs/prepare-bounded'
      ),
      true
    );
  }
});
