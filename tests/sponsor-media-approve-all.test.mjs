import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

import {
  approveAllDerivedRequestId,
  classifyApproveAllReasons,
  SponsorMediaApproveAllService,
  validateApproveAllExecuteRequest,
  validateApproveAllPlanRequest
} from '../dist/apps/funding-api/src/sponsor-media-workspace/approve-all.js';
import { SponsorMediaWorkspaceService } from '../dist/apps/funding-api/src/sponsor-media-workspace/service.js';
import { executeBatch } from '../dist/apps/funding-api/src/sponsor-media-workspace/plans.js';

test('dossier confirmation cannot be reduced to a client selection or performed without explicit review', () => {
  const requestId = randomUUID(),
    contributionId = randomUUID(),
    planId = randomUUID();
  const plan = { requestId, contributionId, expectedRevision: '7' };
  const execute = {
    requestId,
    planId,
    confirmation: planId,
    humanReviewed: true
  };
  validateApproveAllPlanRequest(plan);
  validateApproveAllExecuteRequest(execute);
  for (const patch of [
    { assets: [] },
    { expectedRevision: '0' },
    { requestId: 'invalid' },
    { actor: 'spoof' },
    { filter: 'ready' }
  ])
    assert.throws(
      () => validateApproveAllPlanRequest({ ...plan, ...patch }),
      (error) => error.status === 400
    );
  for (const patch of [
    { humanReviewed: false },
    { confirmation: randomUUID() },
    { requestId: 'invalid' },
    { assets: [] },
    { includeFuture: true }
  ])
    assert.throws(
      () => validateApproveAllExecuteRequest({ ...execute, ...patch }),
      (error) => error.status === 400
    );
});

test('durable child, decision and completion identifiers have separate stable UUID namespaces', () => {
  const requestId = randomUUID(),
    assetId = randomUUID();
  const ids = ['item', 'decision', 'final'].map((phase) =>
    approveAllDerivedRequestId(requestId, phase, assetId)
  );
  assert.equal(new Set(ids).size, 3);
  for (const id of ids) {
    assert.match(
      id,
      /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
    );
    assert.notEqual(id, requestId);
  }
  assert.equal(
    approveAllDerivedRequestId(requestId, 'item', assetId),
    approveAllDerivedRequestId(
      requestId.toUpperCase(),
      'item',
      assetId.toUpperCase()
    )
  );
  assert.notEqual(
    approveAllDerivedRequestId(requestId, 'item', assetId),
    approveAllDerivedRequestId(requestId, 'item', randomUUID())
  );
  assert.notEqual(
    approveAllDerivedRequestId(requestId, 'item', assetId),
    approveAllDerivedRequestId(randomUUID(), 'item', assetId)
  );
});

test('native blocking reasons remain local and distinguish authorization from an unusable source', () => {
  assert.equal(classifyApproveAllReasons([]), 'eligible');
  assert.equal(
    classifyApproveAllReasons(['MEDIA_ALREADY_APPROVED']),
    'already_approved'
  );
  for (const reason of [
    'MEDIA_USAGE_CONFIRMATION_REQUIRED',
    'MEDIA_USAGE_WITHDRAWN',
    'MEDIA_ALT_TEXT_REQUIRED',
    'MODERATION_INDEPENDENT_REVIEW_REQUIRED',
    'MEDIA_WEBSITE_SELECTION_REVIEW_REQUIRED'
  ])
    assert.equal(classifyApproveAllReasons([reason]), 'blocked');
  for (const reason of [
    'MEDIA_CONTENT_UNAVAILABLE',
    'MEDIA_INVALID',
    'MEDIA_NOT_FOUND',
    'MEDIA_PLAN_STALE',
    'MEDIA_VERSION_CONFLICT',
    'MODERATION_CONTENT_CHANGED',
    'MODERATION_DECISION_CONFLICT'
  ])
    assert.equal(classifyApproveAllReasons([reason]), 'not_processable');
  assert.equal(
    classifyApproveAllReasons([
      'MEDIA_USAGE_CONFIRMATION_REQUIRED',
      'MEDIA_CONTENT_UNAVAILABLE'
    ]),
    'not_processable'
  );
});

function storedFixture(plan, result) {
  const actor = 'synthetic-admin';
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(sql);
      if (/^BEGIN|^ROLLBACK|^COMMIT/.test(sql)) return { rows: [] };
      if (sql.includes('sponsor_media_batch_plans'))
        return { rows: [{ actor, plan }] };
      if (sql.includes('sponsor_media_workspace_commands'))
        return { rows: [{ actor, result }] };
      throw new Error('Unexpected mutation or lookup');
    },
    release() {}
  };
  return {
    actor,
    calls,
    pool: { query: db.query, connect: async () => db },
    storage: {
      async readPrivateObject() {
        calls.push('private bytes');
        return null;
      },
      async deletePrivateObject() {
        return true;
      },
      async deletePublicObject() {
        return true;
      }
    }
  };
}

test('legacy execution rejects a dossier plan before source reads or writes, including direct native execution', async () => {
  const f = storedFixture({ kind: 'approve_all' }, null);
  const input = {
    requestId: randomUUID(),
    planId: randomUUID(),
    humanReviewed: true
  };
  input.confirmation = input.planId;
  const service = new SponsorMediaWorkspaceService(f.pool, f.storage);
  for (const execute of [
    () => service.execute(input, f.actor),
    () => executeBatch(f.pool, input, f.actor)
  ])
    await assert.rejects(execute, { code: 'MEDIA_PLAN_KIND_MISMATCH' });
  assert.equal(f.calls.includes('private bytes'), false);
  assert.equal(
    f.calls.some((sql) => /UPDATE|INSERT/.test(sql)),
    false
  );
});

test('receipt kinds cannot accidentally unlock the other controller after an uncertain operation', async () => {
  const contributionId = randomUUID(),
    requestId = randomUUID();
  const current = storedFixture(null, { kind: 'approve_all', stage: 'start' });
  const legacy = new SponsorMediaWorkspaceService(
    current.pool,
    current.storage
  );
  await assert.rejects(
    () => legacy.receipt(contributionId, requestId, current.actor),
    { code: 'MEDIA_RECEIPT_KIND_MISMATCH' }
  );
  const previous = storedFixture(null, {
    status: 'completed',
    action: 'approve',
    items: []
  });
  const dedicated = new SponsorMediaApproveAllService(
    previous.pool,
    previous.storage
  );
  await assert.rejects(
    () => dedicated.receipt({ contributionId, requestId }, previous.actor),
    { code: 'MEDIA_RECEIPT_KIND_MISMATCH' }
  );
});
