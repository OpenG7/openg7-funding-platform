import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { signal } from '@angular/core';

const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@openg7/funding-core')
      return {
        url: new URL(
          '../dist/packages/funding-core/src/index.js',
          import.meta.url
        ).href,
        shortCircuit: true
      };
    return nextResolve(specifier, context);
  }
});
const { MediaReviewApproveAll } =
  await import('../dist/apps/funding-web/src/app/features/funding/components/media-review/media-review-approve-all.js');
const { MediaReviewWorkspaceController } =
  await import('../dist/apps/funding-web/src/app/features/funding/components/media-review/media-review-workspace.controller.js');
const { AdminDashboardRequestError } =
  await import('../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js');
hook.deregister();

const contributionId = '10000000-0000-4000-8000-000000000001';
const otherContributionId = '10000000-0000-4000-8000-000000000002';
const planId = '30000000-0000-4000-8000-000000000001';
const identityKey = 'admin:synthetic-reviewer:session-1';
const storageKey = 'openg7-media-approve-all-pending:' + contributionId;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function asset(index) {
  return {
    id: '20000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
    contributionId,
    kind: index === 0 ? 'logo' : 'supporting_image',
    uploadedBy: 'sponsor',
    originalFilename: `synthetic-${index}.webp`,
    originalMimeType: 'image/webp',
    originalSizeBytes: 32,
    processedMimeType: 'image/webp',
    processedSizeBytes: 32,
    width: 16,
    height: 16,
    altText: `Synthetic exact image ${index}`,
    reviewStatus: 'pending_review',
    version: 'asset-v1',
    createdAt: '2026-11-10T12:00:00.000Z',
    reviewedAt: null,
    sortOrder: index,
    publicUrl: null,
    websiteSelected: false,
    batchId: null,
    ruleId: null,
    usageSource: 'media',
    usageRestrictionsReviewed: false,
    usage: {
      state: 'confirmed',
      channels: ['website'],
      targets: ['openg7'],
      transformations: ['technical'],
      credit: null,
      restrictions: null
    },
    readiness: {
      state: 'needs_review',
      reasons: ['MEDIA_HUMAN_REVIEW_REQUIRED']
    },
    moderation: {
      state: 'unreviewed',
      level: null,
      contentVersion: 1,
      fingerprint: 'f'.repeat(64),
      currentDecisionId: null
    }
  };
}

function prepared(assets) {
  return {
    kind: 'approve_all',
    id: planId,
    contributionId,
    revision: '1',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    candidates: assets.map((item) => ({
      asset: structuredClone(item),
      classification: 'eligible',
      reasons: []
    })),
    summary: {
      total: assets.length,
      eligible: assets.length,
      blocked: 0,
      alreadyApproved: 0,
      notProcessable: 0,
      authorizationRequired: 0,
      consentRequestable: 0
    },
    effects: [
      'ACCEPT_MEDIA_ONLY',
      'NO_SOCIAL_PUBLICATION',
      'WEBSITE_SELECTION_SEPARATE'
    ]
  };
}

function resultFor(plan, requestId, outcomes, status = 'completed') {
  const items = plan.candidates.map(({ asset: item }, index) => {
    const result = outcomes?.[index] ?? 'approved';
    return {
      id: item.id,
      originalFilename: item.originalFilename,
      version: result === 'approved' ? 'asset-v2' : item.version,
      result,
      reasons: result === 'failed' ? ['MEDIA_CONTENT_UNAVAILABLE'] : []
    };
  });
  const count = (result) =>
    items.filter((item) => item.result === result).length;
  return {
    kind: 'approve_all',
    requestId,
    planId: plan.id,
    contributionId: plan.contributionId,
    status,
    items,
    summary: {
      total: items.length,
      approved: count('approved'),
      alreadyApproved: count('already_approved'),
      blocked: count('blocked'),
      notProcessable: count('not_processable'),
      failed: count('failed'),
      pending: count('pending')
    }
  };
}

function memoryStorage(entries = new Map()) {
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key)
  };
}

function fixture(t, { count = 3, storage = memoryStorage() } = {}) {
  const assets = Array.from({ length: count }, (_, index) => asset(index));
  const data = {
    contributionId,
    revision: '1',
    writable: true,
    assets,
    rules: [],
    batches: []
  };
  const calls = {
    plans: [],
    executes: [],
    receipts: [],
    thumbnails: [],
    previews: [],
    refreshes: 0,
    changed: 0,
    unauthorized: 0
  };
  const state = {
    permitted: signal(true),
    nextId: 0,
    response: null,
    plan: prepared(assets)
  };
  const allocated = [];
  const revoked = [];
  t.mock.method(URL, 'createObjectURL', () => {
    const url = 'blob:approve-all-' + allocated.length;
    allocated.push(url);
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  const controller = new MediaReviewWorkspaceController({
    admin: { mediaWorkspace: async () => data },
    permitted: () => state.permitted(),
    changed: () => {},
    unauthorized: () => calls.unauthorized++
  });
  controller.setScope(contributionId);
  controller.data.set(data);
  const ports = {
    admin: {
      mediaApproveAllPlan: async (request) => {
        calls.plans.push(structuredClone(request));
        return structuredClone(state.plan);
      },
      mediaApproveAllExecute: async (request) => {
        calls.executes.push(structuredClone(request));
        return state.response ?? resultFor(state.plan, request.requestId);
      },
      mediaApproveAllReceipt: async (id, requestId) => {
        calls.receipts.push({ contributionId: id, requestId });
        return state.response
          ? { found: true, result: state.response }
          : { found: false };
      },
      mediaThumbnail: async (id) => {
        calls.thumbnails.push(id);
        return new Blob(['synthetic private image'], { type: 'image/webp' });
      },
      getSponsorMediaPreview: async (token, id) => {
        calls.previews.push({ token, id });
        return new Blob(['synthetic private image'], { type: 'image/webp' });
      },
      getSavedAdminToken: () => 'synthetic-admin-session'
    },
    controller,
    permitted: () => state.permitted(),
    refresh: async () => calls.refreshes++,
    changed: () => calls.changed++,
    unauthorized: () => calls.unauthorized++,
    storage: () => storage,
    newRequestId: () =>
      '40000000-0000-4000-8000-' + String(++state.nextId).padStart(12, '0')
  };
  const model = new MediaReviewApproveAll(ports);
  model.setScope(contributionId, identityKey);
  return {
    model,
    ports,
    controller,
    data,
    state,
    calls,
    storage,
    allocated,
    revoked
  };
}

async function imageLoads(f) {
  await tick();
  for (const candidate of f.model.plan()?.candidates ?? [])
    if (candidate.classification === 'eligible')
      f.model.previewLoaded(candidate.asset.id, candidate.asset.version);
  await tick();
}

test('approve-all prepares the full dossier once despite filters and a different inspected selection', async (t) => {
  const f = fixture(t, { count: 101 });
  f.controller.filter.set('blocked');
  f.controller.search.set('does-not-match');
  f.controller.page.set(4);
  f.controller.selectedIds.set([f.data.assets[1].id]);
  f.controller.inspectedId.set(f.data.assets[2].id);
  await f.model.prepare();
  assert.equal(f.calls.plans.length, 1);
  assert.deepEqual(Object.keys(f.calls.plans[0]).sort(), [
    'contributionId',
    'expectedRevision',
    'requestId'
  ]);
  assert.equal(f.calls.plans[0].contributionId, contributionId);
  assert.equal(f.calls.plans[0].expectedRevision, '1');
  assert.match(f.calls.plans[0].requestId, /^[a-f0-9-]{36}$/);
  assert.equal(f.model.plan().summary.total, 101);
  assert.equal(f.model.plan().candidates.length, 101);
  assert.equal(f.model.plan().candidates[0].asset.kind, 'logo');
  assert.equal(
    f.model.canConfirm(),
    false,
    'a response alone is not a rendered image review'
  );
  assert.deepEqual(f.calls.executes, []);
  await imageLoads(f);
  assert.equal(f.model.canConfirm(), true);
  f.model.close();
  assert.deepEqual(f.calls.executes, []);
  assert.equal(f.storage.entries.size, 0);
});

test('approve-all requires every eligible preview to render and permits one explicit collective confirmation', async (t) => {
  const f = fixture(t);
  f.state.plan.candidates[1].asset.usage.restrictions =
    'Synthetic restriction requiring attribution';
  await f.model.prepare();
  await tick();
  assert.equal(f.model.canConfirm(), false);
  for (const candidate of f.model.plan().candidates.slice(0, -1))
    f.model.previewLoaded(candidate.asset.id, candidate.asset.version);
  assert.equal(f.model.canConfirm(), false);
  const last = f.model.plan().candidates.at(-1).asset;
  f.model.previewLoaded(last.id, 'wrong-version');
  assert.equal(f.model.canConfirm(), false);
  f.model.previewLoaded(last.id, last.version);
  assert.equal(f.model.canConfirm(), true);
  assert.equal(
    f.model.plan().candidates[1].asset.usage.restrictions,
    'Synthetic restriction requiring attribution'
  );
  assert.deepEqual(f.calls.executes, []);
  await f.model.confirm();
  assert.equal(f.calls.executes.length, 1);
  assert.deepEqual(Object.keys(f.calls.executes[0]).sort(), [
    'confirmation',
    'humanReviewed',
    'planId',
    'requestId'
  ]);
  assert.equal(f.calls.executes[0].planId, planId);
  assert.equal(f.calls.executes[0].confirmation, planId);
  assert.equal(f.calls.executes[0].humanReviewed, true);
  assert.notEqual(f.calls.executes[0].requestId, f.calls.plans[0].requestId);
  assert.equal(f.model.receipt().status, 'completed');
  assert.equal(f.model.unresolved(), false);
  assert.equal(
    f.calls.executes.length,
    1,
    'no individual media decisions are required'
  );
});

test('approve-all keeps blocked, approved and unprocessable files visible without requiring their previews', async (t) => {
  const f = fixture(t, { count: 4 });
  f.state.plan.candidates[1].classification = 'blocked';
  f.state.plan.candidates[1].reasons = ['MEDIA_USAGE_WITHDRAWN'];
  f.state.plan.candidates[2].classification = 'already_approved';
  f.state.plan.candidates[3].classification = 'not_processable';
  Object.assign(f.state.plan.summary, {
    eligible: 1,
    blocked: 1,
    alreadyApproved: 1,
    notProcessable: 1
  });
  await f.model.prepare();
  await imageLoads(f);
  assert.equal(f.model.plan().candidates.length, 4);
  assert.deepEqual(f.model.plan().candidates[1].reasons, [
    'MEDIA_USAGE_WITHDRAWN'
  ]);
  assert.equal(f.model.canConfirm(), true);
  assert.deepEqual(f.calls.thumbnails, [f.data.assets[0].id]);
  assert.deepEqual(f.calls.executes, []);
});

test('approve-all cannot confirm an empty, fully blocked or expired preparation', async (t) => {
  for (const scenario of ['empty', 'none-eligible', 'expired']) {
    const f = fixture(t, { count: scenario === 'empty' ? 0 : 1 });
    if (scenario === 'expired')
      f.state.plan.expiresAt = '2020-01-01T00:00:00.000Z';
    if (scenario === 'none-eligible') {
      f.state.plan.candidates[0].classification = 'blocked';
      f.state.plan.candidates[0].reasons = [
        'MEDIA_USAGE_CONFIRMATION_REQUIRED'
      ];
      Object.assign(f.state.plan.summary, { eligible: 0, blocked: 1 });
    }
    await f.model.prepare();
    await imageLoads(f);
    assert.equal(f.model.canConfirm(), false, scenario);
    await f.model.confirm();
    assert.deepEqual(f.calls.executes, [], scenario);
    f.model.dispose();
  }
});

test('a reader cannot prepare, confirm or resume a dossier approval', async (t) => {
  const f = fixture(t);
  f.state.permitted.set(false);
  f.data.writable = false;
  await f.model.prepare();
  await f.model.confirm();
  await f.model.resume();
  assert.deepEqual(f.calls.plans, []);
  assert.deepEqual(f.calls.executes, []);
  assert.equal(f.model.canConfirm(), false);
  assert.equal(f.model.canResume(), false);
});

test('changing workspace revision or losing permission invalidates an unconfirmed plan', async (t) => {
  for (const change of ['revision', 'permission']) {
    const f = fixture(t);
    await f.model.prepare();
    await imageLoads(f);
    assert.equal(f.model.canConfirm(), true);
    if (change === 'revision')
      f.controller.data.set({ ...f.data, revision: '2' });
    else f.state.permitted.set(false);
    await f.model.confirm();
    assert.deepEqual(f.calls.executes, [], change);
    f.model.dispose();
  }
});

test('concurrent confirmation clicks send only one operation and preserve the opaque pending UUID', async (t) => {
  const f = fixture(t);
  await f.model.prepare();
  await imageLoads(f);
  const gate = deferred();
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    return gate.promise;
  };
  const first = f.model.confirm();
  await f.model.confirm();
  assert.equal(f.calls.executes.length, 1);
  const request = f.calls.executes[0];
  assert.equal(f.model.pendingRequestId(), request.requestId);
  assert.match(request.requestId, /^[a-f0-9-]{36}$/);
  assert.equal(f.storage.entries.get(storageKey), request.requestId);
  gate.resolve(resultFor(f.state.plan, request.requestId));
  await first;
  assert.equal(f.storage.entries.has(storageKey), false);
});

test('a lost response requires a read-only receipt check and never silently repeats the approval', async (t) => {
  const f = fixture(t);
  await f.model.prepare();
  await imageLoads(f);
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    throw new TypeError('Synthetic lost response');
  };
  await f.model.confirm();
  const request = f.calls.executes[0];
  assert.equal(f.model.unresolved(), true);
  await f.model.prepare();
  await f.model.confirm();
  await f.model.resume();
  assert.equal(f.calls.plans.length, 1);
  assert.equal(f.calls.executes.length, 1);
  await f.model.reconcile();
  assert.equal(f.calls.receipts.length, 1);
  assert.equal(
    f.model.unresolved(),
    true,
    'absence of a receipt is not proof that nothing committed'
  );
  assert.equal(f.model.pendingRequestId(), request.requestId);
  assert.equal(f.model.canResume(), false);
  f.state.response = resultFor(f.state.plan, request.requestId);
  await f.model.reconcile();
  assert.equal(f.model.receipt().status, 'completed');
  assert.equal(f.model.unresolved(), false);
  assert.equal(f.calls.executes.length, 1);
  assert.equal(f.storage.entries.has(storageKey), false);
});

for (const [code, message] of [
  ['MEDIA_PLAN_EXPIRED', 'expired'],
  ['MEDIA_NO_ELIGIBLE_ASSETS', 'noEligible']
]) {
  test(`an acknowledged pre-start ${code} refusal permits a fresh preparation without automatic approval`, async (t) => {
    const f = fixture(t);
    await f.model.prepare();
    await imageLoads(f);
    f.ports.admin.mediaApproveAllExecute = async (request) => {
      f.calls.executes.push(structuredClone(request));
      if (f.calls.executes.length === 1)
        throw new AdminDashboardRequestError(409, 'Synthetic refusal', code);
      return resultFor(f.state.plan, request.requestId);
    };
    await f.model.confirm();
    const refused = f.calls.executes[0];
    assert.equal(f.model.error(), message);
    assert.equal(f.model.unresolved(), false);
    assert.equal(f.model.pendingRequestId(), null);
    assert.equal(f.model.canResume(), false);
    assert.equal(f.model.canConfirm(), false);
    assert.equal(f.model.plan(), null);
    assert.equal(f.storage.entries.has(storageKey), false);
    await tick();
    await f.model.confirm();
    await f.model.resume();
    await f.model.reconcile();
    assert.equal(f.calls.plans.length, 1);
    assert.equal(f.calls.executes.length, 1);
    assert.deepEqual(f.calls.receipts, []);

    f.state.plan = {
      ...prepared(f.data.assets),
      id: '30000000-0000-4000-8000-000000000002'
    };
    await f.model.prepare();
    assert.equal(f.calls.plans.length, 2);
    assert.equal(f.calls.executes.length, 1);
    assert.equal(f.model.canConfirm(), false);
    await imageLoads(f);
    assert.equal(f.model.canConfirm(), true);
    assert.equal(f.calls.executes.length, 1);
    await f.model.confirm();
    assert.equal(f.calls.executes.length, 2);
    assert.notEqual(f.calls.executes[1].requestId, refused.requestId);
    assert.notEqual(f.calls.executes[1].planId, refused.planId);
    assert.equal(f.model.receipt().status, 'completed');
    assert.equal(f.model.unresolved(), false);
    f.model.dispose();
  });
}

test('other conflicts or incompatible refusal statuses preserve the UUID and require a receipt check', async (t) => {
  for (const [status, code] of [
    [409, 'MEDIA_PLAN_STALE'],
    [400, 'MEDIA_PLAN_EXPIRED'],
    [500, 'MEDIA_NO_ELIGIBLE_ASSETS']
  ]) {
    const f = fixture(t);
    await f.model.prepare();
    await imageLoads(f);
    f.ports.admin.mediaApproveAllExecute = async (request) => {
      f.calls.executes.push(structuredClone(request));
      throw new AdminDashboardRequestError(status, 'Synthetic refusal', code);
    };
    await f.model.confirm();
    const request = f.calls.executes[0];
    assert.equal(f.model.unresolved(), true, `${status} ${code}`);
    assert.equal(f.model.pendingRequestId(), request.requestId);
    assert.equal(f.storage.entries.get(storageKey), request.requestId);
    assert.equal(f.model.canResume(), false);
    await f.model.prepare();
    await f.model.confirm();
    await f.model.resume();
    assert.equal(f.calls.plans.length, 1);
    assert.equal(f.calls.executes.length, 1);
    assert.deepEqual(f.calls.receipts, []);
    await f.model.reconcile();
    assert.deepEqual(f.calls.receipts, [
      { contributionId, requestId: request.requestId }
    ]);
    assert.equal(f.model.unresolved(), true);
    assert.equal(f.model.pendingRequestId(), request.requestId);
    assert.equal(f.model.canResume(), false);
    assert.equal(f.storage.entries.get(storageKey), request.requestId);
    f.model.dispose();
  }
});

test('an interrupted receipt preserves committed items and resumes only after an explicit action with the same UUID', async (t) => {
  const f = fixture(t);
  await f.model.prepare();
  await imageLoads(f);
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    return resultFor(
      f.state.plan,
      request.requestId,
      ['approved', 'pending', 'pending'],
      'in_progress'
    );
  };
  await f.model.confirm();
  const first = f.calls.executes[0];
  assert.equal(f.model.receipt().status, 'in_progress');
  assert.equal(f.model.receipt().summary.approved, 1);
  assert.equal(f.model.receipt().summary.pending, 2);
  assert.equal(f.model.unresolved(), true);
  assert.equal(f.model.canResume(), true);
  await tick();
  assert.equal(
    f.calls.executes.length,
    1,
    'in_progress never launches a background POST'
  );
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    return resultFor(f.state.plan, request.requestId);
  };
  await f.model.resume();
  assert.deepEqual(f.calls.executes[1], first);
  assert.equal(f.model.unresolved(), false);
  assert.equal(f.model.receipt().summary.approved, 3);
});

test('a terminal partial receipt remains visible and does not keep replaying failed files', async (t) => {
  const f = fixture(t);
  await f.model.prepare();
  await imageLoads(f);
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    return resultFor(
      f.state.plan,
      request.requestId,
      ['approved', 'failed', 'approved'],
      'partial'
    );
  };
  await f.model.confirm();
  assert.equal(f.model.receipt().status, 'partial');
  assert.equal(f.model.receipt().summary.approved, 2);
  assert.equal(f.model.receipt().summary.failed, 1);
  assert.deepEqual(f.model.receipt().items[1].reasons, [
    'MEDIA_CONTENT_UNAVAILABLE'
  ]);
  assert.equal(f.model.unresolved(), false);
  assert.equal(f.model.canResume(), false);
  await f.model.resume();
  assert.equal(f.calls.executes.length, 1);
});

test('reloading restores only the pending UUID and requires explicit reconciliation before resuming', async (t) => {
  const storage = memoryStorage();
  const f = fixture(t, { storage });
  await f.model.prepare();
  await imageLoads(f);
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    throw new TypeError('Synthetic navigation before response');
  };
  await f.model.confirm();
  const original = f.calls.executes[0];
  f.model.dispose();
  const reloaded = fixture(t, { storage });
  assert.equal(reloaded.model.pendingRequestId(), original.requestId);
  assert.equal(reloaded.model.unresolved(), true);
  assert.equal(reloaded.model.canResume(), false);
  assert.deepEqual(reloaded.calls.plans, []);
  assert.deepEqual(reloaded.calls.executes, []);
  assert.deepEqual(reloaded.calls.receipts, []);
  assert.equal(storage.entries.size, 1);
  assert.equal([...storage.entries.values()][0], original.requestId);
  reloaded.state.response = resultFor(
    f.state.plan,
    original.requestId,
    ['approved', 'pending', 'pending'],
    'in_progress'
  );
  await reloaded.model.reconcile();
  assert.equal(reloaded.model.canResume(), true);
  assert.deepEqual(reloaded.calls.executes, []);
  await reloaded.model.resume();
  assert.deepEqual(reloaded.calls.executes, [original]);
});

test('another actor receipt rejection leaves the interrupted operation unresolved without posting', async (t) => {
  const requestId = '40000000-0000-4000-8000-000000000099';
  const storage = memoryStorage(new Map([[storageKey, requestId]]));
  const f = fixture(t, { storage });
  f.ports.admin.mediaApproveAllReceipt = async (request) => {
    f.calls.receipts.push(request);
    throw new AdminDashboardRequestError(
      403,
      'Other actor',
      'MEDIA_RECEIPT_ACTOR_MISMATCH'
    );
  };
  await f.model.reconcile();
  assert.equal(f.model.unresolved(), true);
  assert.equal(f.model.canResume(), false);
  await f.model.resume();
  assert.deepEqual(f.calls.executes, []);
  assert.equal(storage.entries.get(storageKey), requestId);
});

test('stale preparation responses cannot open another dossier, session or disposed controller', async (t) => {
  for (const change of ['dossier', 'session', 'dispose']) {
    const f = fixture(t);
    const gate = deferred();
    f.ports.admin.mediaApproveAllPlan = async (request) => {
      f.calls.plans.push(request);
      return gate.promise;
    };
    const preparing = f.model.prepare();
    await f.model.prepare();
    assert.equal(f.calls.plans.length, 1, change);
    if (change === 'dispose') f.model.dispose();
    else
      f.model.setScope(
        change === 'dossier' ? otherContributionId : contributionId,
        'admin:synthetic-reviewer:session-2'
      );
    gate.resolve(f.state.plan);
    await preparing;
    await tick();
    assert.equal(f.model.plan(), null, change);
    assert.equal(f.model.canConfirm(), false, change);
    assert.deepEqual(f.calls.executes, [], change);
  }
});

test('a foreign or incompatible receipt never resolves the retained request', async (t) => {
  for (const forged of [
    'kind',
    'dossier',
    'plan',
    'request',
    'foreign-item',
    'omitted-item',
    'duplicate-item'
  ]) {
    const f = fixture(t);
    await f.model.prepare();
    await imageLoads(f);
    f.ports.admin.mediaApproveAllExecute = async (request) => {
      f.calls.executes.push(structuredClone(request));
      const receipt = resultFor(f.state.plan, request.requestId);
      if (forged === 'kind') receipt.kind = 'different_operation';
      if (forged === 'dossier') receipt.contributionId = otherContributionId;
      if (forged === 'plan')
        receipt.planId = '30000000-0000-4000-8000-000000000099';
      if (forged === 'request')
        receipt.requestId = '40000000-0000-4000-8000-000000000099';
      if (forged === 'foreign-item')
        receipt.items[1].id = '20000000-0000-4000-8000-000000000099';
      if (forged === 'duplicate-item')
        receipt.items[1].id = receipt.items[0].id;
      if (forged === 'omitted-item') {
        receipt.items.pop();
        receipt.summary.total--;
        receipt.summary.approved--;
      }
      return receipt;
    };
    await f.model.confirm();
    assert.equal(f.model.unresolved(), true, forged);
    assert.equal(f.model.canResume(), false, forged);
    assert.equal(f.model.receipt(), null, forged);
    assert.equal(f.storage.entries.size, 1, forged);
    f.model.dispose();
  }
});

test('a forged dossier inventory cannot become a confirmable preparation', async (t) => {
  for (const forged of [
    'kind',
    'dossier',
    'foreign-member',
    'duplicate-member'
  ]) {
    const f = fixture(t);
    if (forged === 'kind') f.state.plan.kind = 'different_operation';
    if (forged === 'dossier') f.state.plan.contributionId = otherContributionId;
    if (forged === 'foreign-member')
      f.state.plan.candidates[1].asset.contributionId = otherContributionId;
    if (forged === 'duplicate-member')
      f.state.plan.candidates[1].asset.id = f.state.plan.candidates[0].asset.id;
    await f.model.prepare();
    await imageLoads(f);
    await f.model.confirm();
    assert.deepEqual(f.calls.executes, [], forged);
    assert.equal(f.model.canConfirm(), false, forged);
    f.model.dispose();
  }
});

test('private preview reads stay bounded to four and all 101 images remain eligible for one confirmation', async (t) => {
  const f = fixture(t, { count: 101 });
  const pending = [];
  let active = 0;
  let maxActive = 0;
  f.ports.admin.mediaThumbnail = (id) => {
    f.calls.thumbnails.push(id);
    active++;
    maxActive = Math.max(maxActive, active);
    const gate = deferred();
    pending.push(gate);
    return gate.promise.finally(() => active--);
  };
  await f.model.prepare();
  assert.equal(pending.length, 4);
  assert.equal(f.model.canConfirm(), false);
  for (let offset = 0; offset < 101; offset += 4) {
    for (const gate of pending.slice(offset, offset + 4))
      gate.resolve(new Blob(['synthetic'], { type: 'image/webp' }));
    await tick();
  }
  assert.equal(f.calls.thumbnails.length, 101);
  assert.equal(maxActive, 4);
  await imageLoads(f);
  assert.equal(f.model.canConfirm(), true);
  assert.deepEqual(f.calls.executes, []);
  f.model.dispose();
  assert.equal(f.revoked.length, f.allocated.length);
});

test('a failed image load prevents collective confirmation until an explicit preview retry succeeds', async (t) => {
  const f = fixture(t, { count: 2 });
  await f.model.prepare();
  await imageLoads(f);
  const failing = f.model.plan().candidates[1].asset;
  f.model.markPreviewFailed(failing.id, failing.version);
  assert.equal(f.model.canConfirm(), false);
  await f.model.confirm();
  assert.deepEqual(f.calls.executes, []);
  f.model.retryPreviews();
  await imageLoads(f);
  assert.equal(f.model.canConfirm(), true);
  assert.deepEqual(f.calls.executes, []);
});

test('unavailable browser storage preserves the in-memory interrupted command without inventing a new UUID', async (t) => {
  const f = fixture(t, {
    storage: {
      getItem() {
        throw new Error('Synthetic storage unavailable');
      },
      setItem() {
        throw new Error('Synthetic storage unavailable');
      },
      removeItem() {
        throw new Error('Synthetic storage unavailable');
      }
    }
  });
  await f.model.prepare();
  await imageLoads(f);
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    throw new TypeError('Synthetic lost response');
  };
  await f.model.confirm();
  const original = f.calls.executes[0];
  assert.equal(f.model.unresolved(), true);
  assert.equal(f.model.pendingRequestId(), original.requestId);
  f.state.response = resultFor(
    f.state.plan,
    original.requestId,
    ['approved', 'pending', 'pending'],
    'in_progress'
  );
  await f.model.reconcile();
  assert.equal(f.model.canResume(), true);
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    return resultFor(f.state.plan, request.requestId);
  };
  await f.model.resume();
  assert.deepEqual(f.calls.executes[1], original);
});

test('another retained operation discovered at confirmation prevents a second POST', async (t) => {
  const f = fixture(t);
  await f.model.prepare();
  await imageLoads(f);
  const previous = '40000000-0000-4000-8000-000000000088';
  f.storage.entries.set(storageKey, previous);
  await f.model.confirm();
  assert.deepEqual(f.calls.executes, []);
  assert.equal(f.model.pendingRequestId(), previous);
  assert.equal(f.model.unresolved(), true);
  assert.equal(f.model.canResume(), false);
  assert.equal(f.storage.entries.get(storageKey), previous);
});

test('an old execution response cannot overwrite another dossier or erase its recoverable UUID', async (t) => {
  const f = fixture(t);
  await f.model.prepare();
  await imageLoads(f);
  const gate = deferred();
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    return gate.promise;
  };
  const executing = f.model.confirm();
  const original = f.calls.executes[0];
  f.model.setScope(otherContributionId, identityKey);
  gate.resolve(resultFor(f.state.plan, original.requestId));
  await executing;
  assert.equal(f.model.receipt(), null);
  assert.equal(f.model.plan(), null);
  assert.equal(f.model.pendingRequestId(), null);
  assert.equal(f.calls.refreshes, 0);
  assert.equal(f.calls.changed, 0);
  assert.equal(f.storage.entries.get(storageKey), original.requestId);
});

test('a terminal receipt with pending items cannot resolve an uncertain operation', async (t) => {
  for (const status of ['completed', 'partial']) {
    const f = fixture(t);
    await f.model.prepare();
    await imageLoads(f);
    f.ports.admin.mediaApproveAllExecute = async (request) => {
      f.calls.executes.push(structuredClone(request));
      return resultFor(
        f.state.plan,
        request.requestId,
        ['approved', 'pending', 'pending'],
        status
      );
    };
    await f.model.confirm();
    assert.equal(f.model.unresolved(), true, status);
    assert.equal(f.model.receipt(), null, status);
    assert.equal(f.model.canResume(), false, status);
    f.model.dispose();
  }
});

test('all committed items with pending finalization remain resumable without another image review', async (t) => {
  const f = fixture(t);
  await f.model.prepare();
  await imageLoads(f);
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    return resultFor(f.state.plan, request.requestId, undefined, 'in_progress');
  };
  await f.model.confirm();
  const original = f.calls.executes[0];
  assert.equal(f.model.receipt().status, 'in_progress');
  assert.equal(f.model.receipt().summary.approved, 3);
  assert.equal(f.model.receipt().summary.pending, 0);
  assert.equal(f.model.unresolved(), true);
  assert.equal(f.model.canResume(), true);
  await tick();
  assert.equal(f.calls.executes.length, 1);
  const previewReads = f.calls.thumbnails.length;
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    return resultFor(f.state.plan, request.requestId);
  };
  await f.model.resume();
  assert.deepEqual(f.calls.executes, [original, original]);
  assert.equal(f.calls.thumbnails.length, previewReads);
  assert.equal(f.model.receipt().status, 'completed');
  assert.equal(f.model.unresolved(), false);
});

test('a lost resume response requires a fresh explicit GET before the same UUID can be resumed again', async (t) => {
  const f = fixture(t);
  await f.model.prepare();
  await imageLoads(f);
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    return resultFor(
      f.state.plan,
      request.requestId,
      ['approved', 'pending', 'pending'],
      'in_progress'
    );
  };
  await f.model.confirm();
  const original = f.calls.executes[0];
  assert.equal(f.model.canResume(), true);
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    throw new TypeError('Synthetic lost resume response');
  };
  await f.model.resume();
  assert.equal(f.calls.executes.length, 2);
  assert.equal(f.model.unresolved(), true);
  assert.equal(f.model.canResume(), false);
  await f.model.resume();
  await f.model.confirm();
  assert.equal(f.calls.executes.length, 2);
  assert.equal(f.calls.receipts.length, 0);
  f.state.response = resultFor(
    f.state.plan,
    original.requestId,
    ['approved', 'pending', 'pending'],
    'in_progress'
  );
  await f.model.reconcile();
  assert.equal(f.calls.receipts.length, 1);
  assert.equal(f.model.canResume(), true);
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    return resultFor(f.state.plan, request.requestId);
  };
  await f.model.resume();
  assert.deepEqual(f.calls.executes, [original, original, original]);
  assert.equal(f.model.unresolved(), false);
});

test('a pre-start refusal code received during resume cannot discard an acknowledged operation', async (t) => {
  for (const code of ['MEDIA_PLAN_EXPIRED', 'MEDIA_NO_ELIGIBLE_ASSETS']) {
    const f = fixture(t);
    await f.model.prepare();
    await imageLoads(f);
    f.ports.admin.mediaApproveAllExecute = async (request) => {
      f.calls.executes.push(structuredClone(request));
      return resultFor(
        f.state.plan,
        request.requestId,
        ['approved', 'pending', 'pending'],
        'in_progress'
      );
    };
    await f.model.confirm();
    const original = f.calls.executes[0];
    const acknowledged = structuredClone(f.model.receipt());
    f.ports.admin.mediaApproveAllExecute = async (request) => {
      f.calls.executes.push(structuredClone(request));
      throw new AdminDashboardRequestError(409, 'Synthetic refusal', code);
    };
    await f.model.resume();
    assert.equal(f.calls.executes.length, 2, code);
    assert.equal(f.model.unresolved(), true, code);
    assert.deepEqual(f.model.receipt(), acknowledged);
    assert.equal(f.model.pendingRequestId(), original.requestId);
    assert.equal(f.storage.entries.get(storageKey), original.requestId);
    assert.equal(f.model.canResume(), false);
    await f.model.prepare();
    await f.model.resume();
    assert.equal(f.calls.plans.length, 1);
    assert.equal(f.calls.executes.length, 2);
    assert.deepEqual(f.calls.receipts, []);

    f.state.response = acknowledged;
    await f.model.reconcile();
    assert.equal(f.model.canResume(), true);
    assert.deepEqual(f.calls.receipts, [
      { contributionId, requestId: original.requestId }
    ]);
    f.ports.admin.mediaApproveAllExecute = async (request) => {
      f.calls.executes.push(structuredClone(request));
      return resultFor(f.state.plan, request.requestId);
    };
    await f.model.resume();
    assert.deepEqual(f.calls.executes, [original, original, original]);
    assert.equal(f.model.unresolved(), false);
    f.model.dispose();
  }
});

test('a resumed receipt cannot replace the previously observed dossier inventory', async (t) => {
  const f = fixture(t);
  await f.model.prepare();
  await imageLoads(f);
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    return resultFor(
      f.state.plan,
      request.requestId,
      ['approved', 'pending', 'pending'],
      'in_progress'
    );
  };
  await f.model.confirm();
  const previous = structuredClone(f.model.receipt());
  f.ports.admin.mediaApproveAllExecute = async (request) => {
    f.calls.executes.push(structuredClone(request));
    const forged = resultFor(f.state.plan, request.requestId);
    forged.items[1].id = '20000000-0000-4000-8000-000000000099';
    return forged;
  };
  await f.model.resume();
  assert.equal(f.model.unresolved(), true);
  assert.equal(f.model.canResume(), false);
  assert.deepEqual(f.model.receipt(), previous);
  assert.equal(f.storage.entries.get(storageKey), previous.requestId);
});

test('a metadata refresh failure does not turn a confirmed terminal receipt into another approval attempt', async (t) => {
  const f = fixture(t);
  await f.model.prepare();
  await imageLoads(f);
  f.ports.refresh = async () => {
    f.calls.refreshes++;
    throw new TypeError('Synthetic metadata read unavailable');
  };
  await f.model.confirm();
  assert.equal(f.model.receipt().status, 'completed');
  assert.equal(f.model.receipt().summary.approved, 3);
  assert.equal(f.model.unresolved(), false);
  assert.equal(f.model.canResume(), false);
  assert.equal(f.storage.entries.has(storageKey), false);
  assert.ok(f.model.error());
  await f.model.resume();
  assert.equal(f.calls.executes.length, 1);
});
