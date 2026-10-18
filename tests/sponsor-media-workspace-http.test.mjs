import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createSponsorMediaWorkspaceHttpHandler } from '../dist/apps/funding-api/src/sponsor-media-workspace/http.js';
import {
  validatePlan,
  validateRules
} from '../dist/apps/funding-api/src/sponsor-media-workspace/policy.js';
import { adminRoleAllows } from '../dist/apps/funding-api/src/admin-identity/policy.js';
const id = randomUUID();
function fixture({ authorized = true, reviewer = true } = {}) {
  const calls = [];
  let result;
  const handler = createSponsorMediaWorkspaceHttpHandler({
    publicBaseOrigin: 'https://example.test',
    pool: {},
    service: {
      async workspace(...args) {
        calls.push(args);
        return { rules: [{ id: 'rule' }] };
      },
      async execute() {
        calls.push('execute');
        return { status: 'completed' };
      }
    },
    ensureAdminAccess: () => authorized,
    canReview: () => reviewer,
    getAdminAuditActor: () => 'synthetic-admin',
    readBody: async (request) => request.body,
    writeJson: (_q, _s, status, body) => {
      result = { status, body };
    }
  });
  return {
    calls,
    run: async (url, method = 'GET', body) => {
      await handler(
        { url, method, body, headers: { 'content-type': 'application/json' } },
        { setHeader() {} }
      );
      return result;
    }
  };
}
test('workspace APIs enforce access before reading; private histories and receipts exclude readers', async () => {
  let f = fixture({ authorized: false });
  assert.equal(
    await f.run('/api/admin/sponsorships/media/workspace?contributionId=' + id),
    undefined
  );
  assert.deepEqual(f.calls, []);
  f = fixture({ reviewer: false });
  assert.equal(
    (
      await f.run(
        '/api/admin/sponsorships/media/workspace?contributionId=' + id
      )
    ).status,
    200
  );
  assert.deepEqual(f.calls, [[id, false]]);
  for (const path of ['receipt', 'workspace/history', 'analyses'])
    assert.equal(
      adminRoleAllows('reader', 'GET', '/api/admin/sponsorships/media/' + path),
      false
    );
  for (const path of ['receipt', 'workspace/history'])
    assert.equal(
      (await f.run('/api/admin/sponsorships/media/' + path)).status,
      403
    );
});
test('unknown fields, arrays and missing collective confirmation cannot reach a mutation', async () => {
  const f = fixture();
  for (const body of ['[]', 'null', JSON.stringify({ actor: 'spoof' })])
    assert.equal(
      (await f.run('/api/admin/sponsorships/media/batch/execute', 'POST', body))
        .status,
      400
    );
  assert.deepEqual(f.calls, []);
  assert.throws(
    () =>
      validatePlan({
        requestId: id,
        contributionId: id,
        expectedRevision: '1',
        action: 'approve',
        assets: Array.from({ length: 101 }, () => ({ id, version: 'v1' }))
      }),
    { code: 'INVALID_MEDIA_SELECTION' }
  );
  assert.throws(
    () =>
      validateRules({
        requestId: id,
        contributionId: id,
        expectedRevision: '1',
        scope: 'dossier',
        scopeId: id,
        usage: {
          state: 'confirmed',
          channels: ['website'],
          targets: ['openg7'],
          transformations: ['technical'],
          credit: null,
          restrictions: null
        },
        evidenceReference: 'Synthetic authorization',
        coveredAssetIds: [],
        confirmation: id
      }),
    { code: 'MEDIA_AUTHORIZATION_SCOPE_REQUIRED' }
  );
});
