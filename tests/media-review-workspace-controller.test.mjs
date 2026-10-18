import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaReviewWorkspaceController } from '../dist/apps/funding-web/src/app/features/funding/components/media-review/media-review-workspace.controller.js';
import { MediaPreviewCollection } from '../dist/apps/funding-web/src/app/features/funding/components/media-review/media-preview-collection.js';

const id = '10000000-0000-4000-8000-000000000401';
const asset = (index, state = 'ready') => ({
  id: 'media-' + index,
  contributionId: id,
  version: 'v1',
  originalFilename: `photo-${index}.webp`,
  altText: `Synthetic scene ${index}`,
  readiness: {
    state,
    reasons: state === 'ready' ? [] : ['MEDIA_HUMAN_REVIEW_REQUIRED']
  },
  reviewStatus: 'pending_review',
  batchId: null,
  usageSource: 'dossier',
  ruleId: 'rule',
  usageRestrictionsReviewed: false,
  usage: {
    state: 'confirmed',
    channels: ['website'],
    targets: ['openg7'],
    transformations: ['technical'],
    credit: null,
    restrictions: null
  }
});
function fixture(
  assets = Array.from({ length: 100 }, (_, index) => asset(index))
) {
  const calls = [],
    data = {
      contributionId: id,
      revision: 'workspace-v1',
      assets,
      rules: [],
      batches: [],
      writable: true
    };
  let receiptFound = false;
  const ports = {
    admin: {
      mediaWorkspace: async () => {
        calls.push(['read']);
        return data;
      },
      mediaBatchPlan: async (request) => {
        calls.push(['plan', request]);
        return {
          id: 'plan',
          contributionId: id,
          action: request.action,
          revision: data.revision,
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          assets: request.assets.map((item) => ({
            ...assets.find((asset) => asset.id === item.id),
            ...(item.altText === undefined ? {} : { altText: item.altText })
          })),
          blocked: [],
          effects: []
        };
      },
      mediaBatchExecute: async (request) => {
        calls.push(['execute', request]);
        return {
          requestId: request.requestId,
          planId: 'plan',
          status: 'completed',
          action: 'approve',
          items: [{ id: assets[0].id, version: 'v2', result: 'approved' }]
        };
      },
      mediaRules: async (request) => {
        calls.push(['rules', request]);
        return data;
      },
      mediaBatch: async () => data,
      mediaReceipt: async (_id, requestId) => {
        calls.push(['receipt', requestId]);
        return {
          found: receiptFound,
          ...(receiptFound
            ? {
                result: {
                  requestId,
                  planId: 'plan',
                  status: 'completed',
                  action: 'approve',
                  items: []
                }
              }
            : {})
        };
      }
    },
    permitted: () => true,
    changed: () => calls.push(['changed']),
    unauthorized: () => calls.push(['unauthorized'])
  };
  const c = new MediaReviewWorkspaceController(ports);
  c.setScope(id);
  return {
    c,
    ports,
    data,
    calls,
    receiptFound: () => {
      receiptFound = true;
    }
  };
}

test('one hundred metadata entries render pages of 25 and filter without preview reads', async () => {
  const f = fixture();
  await f.c.load();
  assert.equal(f.c.visible().length, 25);
  assert.equal(f.c.pageCount(), 4);
  f.c.page.set(4);
  assert.equal(f.c.visible()[0].id, 'media-75');
  f.c.search.set('photo-99');
  assert.equal(f.c.visible().length, 1);
  assert.equal(f.c.currentPage(), 1);
  assert.deepEqual(f.calls, [['read']]);
});

test('ready selection excludes blocked and exceptional files and selection spans pages', async () => {
  const assets = Array.from({ length: 100 }, (_, index) =>
    asset(
      index,
      index < 17 ? 'ready' : index === 17 ? 'blocked' : 'needs_review'
    )
  );
  const f = fixture(assets);
  await f.c.load();
  f.c.selectReady();
  assert.equal(f.c.selected().length, 17);
  assert.equal(f.c.counts().blocked, 1);
  f.c.selectedIds.set([]);
  f.c.selectPage();
  f.c.page.set(2);
  f.c.selectPage();
  assert.equal(f.c.selected().length, 50);
});

test('one preflight captures exact versions, edited alternative text and restriction review', async () => {
  const f = fixture();
  await f.c.load();
  f.c.edit(f.data.assets[0], {
    altText: '  Exact human description  ',
    restrictions: true
  });
  f.c.toggle('media-0');
  f.c.toggle('media-1');
  await f.c.prepare('approve');
  const request = f.calls.find(([name]) => name === 'plan')[1];
  assert.equal(request.expectedRevision, 'workspace-v1');
  assert.deepEqual(request.assets[0], {
    id: 'media-0',
    version: 'v1',
    altText: 'Exact human description',
    usageRestrictionsConfirmed: true
  });
  assert.equal(
    f.calls.some(([name]) => name === 'execute'),
    false
  );
  await f.c.execute();
  assert.equal(f.calls.filter(([name]) => name === 'execute').length, 1);
  assert.equal(f.c.receipt().status, 'completed');
  assert.equal(f.c.selected().length, 0);
});

test('lost execute response suspends mutations and reconciles read-only without replaying the command', async () => {
  const f = fixture();
  await f.c.load();
  f.c.toggle('media-0');
  await f.c.prepare('delete');
  f.ports.admin.mediaBatchExecute = async (request) => {
    f.calls.push(['execute', request]);
    throw new TypeError('Synthetic lost receipt');
  };
  await f.c.execute();
  const request = f.c.pending();
  assert.equal(f.c.uncertain(), true);
  assert.equal(f.c.canWrite(), false);
  await f.c.execute();
  await f.c.prepare('delete');
  await f.c.reconcile();
  assert.equal(f.c.notice(), 'noReceipt');
  assert.equal(f.c.uncertain(), true);
  f.receiptFound();
  await f.c.reconcile();
  assert.equal(f.c.uncertain(), false);
  assert.equal(f.c.receipt().requestId, request.requestId);
  assert.equal(f.calls.filter(([name]) => name === 'execute').length, 1);
});

test('expired or blocked manifests never execute', async () => {
  const f = fixture();
  await f.c.load();
  f.c.toggle('media-0');
  await f.c.prepare('approve');
  f.c.plan.update((plan) => ({
    ...plan,
    blocked: [{ id: 'media-0', reasons: ['MEDIA_USAGE_WITHDRAWN'] }]
  }));
  await f.c.execute();
  assert.equal(
    f.calls.some(([name]) => name === 'execute'),
    false
  );
  f.c.plan.update((plan) => ({
    ...plan,
    blocked: [],
    expiresAt: '2000-01-01T00:00:00Z'
  }));
  await f.c.execute();
  assert.equal(
    f.calls.some(([name]) => name === 'execute'),
    false
  );
});

test('switching dossiers ignores old metadata, clears plans and retained private drafts', async () => {
  const f = fixture();
  let resolve;
  f.ports.admin.mediaWorkspace = () =>
    new Promise((done) => {
      resolve = done;
    });
  const loading = f.c.load();
  f.c.setScope('other-dossier');
  resolve(f.data);
  await loading;
  assert.equal(f.c.data(), null);
  assert.deepEqual(f.c.selectedIds(), []);
});

test('saved analysis drafts restore text and classification once and preserve newer local edits', async () => {
  const f = fixture();
  await f.c.load();
  const item = f.data.assets[0],
    run = {
      id: 'analysis-1',
      assetId: item.id,
      state: 'succeeded',
      stale: false,
      review: {
        version: 1,
        decision: 'saved',
        draft: { altText: 'Saved human correction', classification: 'photo' }
      }
    };
  f.c.restoreSavedAnalysisDraft(item, run);
  assert.equal(f.c.draft(item).altText, 'Saved human correction');
  assert.equal(f.c.draft(item).classification, 'photo');
  const restored = f.c.drafts();
  f.c.restoreSavedAnalysisDraft(item, run);
  assert.equal(f.c.drafts(), restored);
  f.c.edit(item, {
    altText: 'Newer unsaved local text',
    classification: 'logo'
  });
  f.c.restoreSavedAnalysisDraft(item, {
    ...run,
    review: { ...run.review, version: 2 }
  });
  assert.equal(f.c.draft(item).altText, 'Newer unsaved local text');
  assert.equal(f.c.draft(item).classification, 'logo');
});

test('stale, terminal and other-media analysis drafts never replace current asset metadata', async () => {
  const f = fixture();
  await f.c.load();
  const item = f.data.assets[0],
    run = {
      id: 'analysis-1',
      assetId: item.id,
      state: 'succeeded',
      stale: false,
      review: {
        version: 1,
        decision: 'saved',
        draft: { altText: 'Invalid draft', classification: 'photo' }
      }
    };
  f.c.restoreSavedAnalysisDraft(item, { ...run, stale: true });
  f.c.restoreSavedAnalysisDraft(item, { ...run, assetId: 'other-media' });
  f.c.restoreSavedAnalysisDraft(item, {
    ...run,
    review: { ...run.review, decision: 'accepted' }
  });
  f.c.restoreSavedAnalysisDraft({ ...item, version: 'old-version' }, run);
  assert.deepEqual(f.c.drafts(), {});
  assert.equal(f.c.draft(item).altText, item.altText);
});

test('thumbnail loading is bounded to four requests and disposed results allocate no private URL', async (t) => {
  const loads = [],
    allocated = [],
    revoked = [];
  t.mock.method(URL, 'createObjectURL', () => {
    const url = 'blob:' + allocated.length;
    allocated.push(url);
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  const previews = new MediaPreviewCollection(
    (id) => new Promise((resolve) => loads.push({ id, resolve }))
  );
  for (let i = 0; i < 20; i++) previews.request('media-' + i, 'v1');
  assert.equal(loads.length, 4);
  loads[0].resolve(new Blob(['synthetic'], { type: 'image/webp' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads.length, 5);
  assert.equal(allocated.length, 1);
  previews.dispose();
  for (const load of loads.slice(1))
    load.resolve(new Blob(['synthetic'], { type: 'image/webp' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(allocated.length, 1);
  assert.deepEqual(revoked, allocated);
});
