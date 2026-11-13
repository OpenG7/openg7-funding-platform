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
  let bodyReads = 0;
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
      },
      async planApproveAll(input, actor) {
        calls.push({ action: 'approve-all/plan', input, actor });
        return { kind: 'approve_all', id };
      },
      async executeApproveAll(input, actor) {
        calls.push({ action: 'approve-all/execute', input, actor });
        return { kind: 'approve_all', status: 'partial' };
      },
      async approveAllReceipt(input, actor) {
        calls.push({ action: 'approve-all/receipt', input, actor });
        return {
          found: true,
          result: { kind: 'approve_all', status: 'in_progress' }
        };
      }
    },
    ensureAdminAccess: () => authorized,
    canReview: () => reviewer,
    getAdminAuditActor: () => 'synthetic-admin',
    readBody: async (request) => {
      bodyReads++;
      return request.body;
    },
    writeJson: (_q, _s, status, body) => {
      result = { status, body };
    }
  });
  return {
    calls,
    bodyReads: () => bodyReads,
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

test('whole-dossier approval uses dedicated aliases, payloads and private receipt lookup', async () => {
  const requestId = randomUUID();
  const plan = { requestId, contributionId: id, expectedRevision: '3' };
  const execute = {
    requestId,
    planId: id,
    confirmation: id,
    humanReviewed: true
  };
  for (const prefix of [
    '/admin/sponsorships/media/',
    '/api/admin/sponsorships/media/'
  ]) {
    for (const [action, body] of [
      ['approve-all/plan', plan],
      ['approve-all/execute', execute]
    ]) {
      const f = fixture();
      const result = await f.run(prefix + action, 'POST', JSON.stringify(body));
      assert.equal(result.status, 200);
      assert.equal(result.body.kind, 'approve_all');
      assert.deepEqual(f.calls, [
        { action, input: body, actor: 'synthetic-admin' }
      ]);
      assert.equal(f.bodyReads(), 1);
    }
    const f = fixture();
    const receipt = await f.run(
      prefix +
        'approve-all/receipt?contributionId=' +
        id +
        '&requestId=' +
        requestId
    );
    assert.equal(receipt.status, 200);
    assert.equal(receipt.body.result.status, 'in_progress');
    assert.deepEqual(f.calls, [
      {
        action: 'approve-all/receipt',
        input: { contributionId: id, requestId },
        actor: 'synthetic-admin'
      }
    ]);
    assert.equal(f.bodyReads(), 0);
  }
});

test('whole-dossier approval rejects reader access and client-selected scope before a service mutation', async () => {
  for (const action of [
    'approve-all/plan',
    'approve-all/execute',
    'approve-all/receipt'
  ]) {
    const method = action.endsWith('receipt') ? 'GET' : 'POST';
    const path = '/api/admin/sponsorships/media/' + action;
    assert.equal(adminRoleAllows('reader', method, path), false);
    assert.equal(adminRoleAllows('operator', method, path), true);
    assert.equal(adminRoleAllows('owner', method, path), true);
    const reader = fixture({ reviewer: false });
    assert.equal((await reader.run(path, method, '{')).status, 403);
    assert.equal(reader.bodyReads(), 0);
    assert.deepEqual(reader.calls, []);
    const absent = fixture({ authorized: false });
    assert.equal(await absent.run(path, method, '{'), undefined);
    assert.equal(absent.bodyReads(), 0);
    assert.deepEqual(absent.calls, []);
  }
  for (const extra of [
    { assets: [{ id, version: 'v1' }] },
    { filter: 'ready' },
    { actor: 'spoof' },
    { includeFuture: true }
  ]) {
    const f = fixture();
    const result = await f.run(
      '/api/admin/sponsorships/media/approve-all/plan',
      'POST',
      JSON.stringify({
        requestId: id,
        contributionId: id,
        expectedRevision: '1',
        ...extra
      })
    );
    assert.equal(result.status, 400);
    assert.deepEqual(f.calls, []);
  }
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
