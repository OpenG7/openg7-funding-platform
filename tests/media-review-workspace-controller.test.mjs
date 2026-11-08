import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { MediaReviewWorkspaceController } from '../dist/apps/funding-web/src/app/features/funding/components/media-review/media-review-workspace.controller.js';
import { MediaPreviewCollection } from '../dist/apps/funding-web/src/app/features/funding/components/media-review/media-preview-collection.js';
import { MediaReviewUpload } from '../dist/apps/funding-web/src/app/features/funding/components/media-review/media-review-upload.js';

// Match the existing Node test loaders: the root build emits workspace packages under dist/.
const workspaceHook = registerHooks({
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
const { MediaReviewCommands } =
  await import('../dist/apps/funding-web/src/app/features/funding/components/media-review/media-review-commands.js');
workspaceHook.deregister();

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

test('one hundred metadata entries render pages of eight and filter without preview reads', async () => {
  const f = fixture();
  await f.c.load();
  assert.equal(f.c.visible().length, 8);
  assert.equal(f.c.pageCount(), 13);
  f.c.page.set(13);
  assert.equal(f.c.visible()[0].id, 'media-96');
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
  assert.equal(f.c.selected().length, 16);
});

test('destination filters use actual private assignments rather than granted usage channels', async () => {
  const f = fixture();
  f.data.preparationObligations = [
    {
      id: 'facebook-1',
      version: 2,
      channel: 'facebook',
      target: 'openg7',
      ordinal: 1,
      acceptsMedia: true
    }
  ];
  f.data.preparationAssignments = [
    {
      id: 'assignment-1',
      assetId: 'media-1',
      assetVersion: 'v1',
      obligationId: 'facebook-1',
      obligationVersion: 2,
      stale: false
    }
  ];
  await f.c.load();
  f.c.destinationFilter.set('facebook');
  assert.deepEqual(
    f.c.filtered().map((asset) => asset.id),
    ['media-1']
  );
  f.c.destinationFilter.set('website');
  assert.equal(f.c.filtered().length, 0);
  f.c.destinationFilter.set('all');
  f.c.assignmentFilter.set('unassigned');
  assert.equal(f.c.filtered().length, 99);
  f.data.preparationAssignments[0].stale = true;
  f.c.data.set({ ...f.data });
  f.c.assignmentFilter.set('stale');
  assert.deepEqual(
    f.c.filtered().map((asset) => asset.id),
    ['media-1']
  );
});

test('library views, type filters and sorting derive from the same media references', async () => {
  const f = fixture([
    {
      ...asset(0),
      kind: 'supporting_image',
      createdAt: '2026-01-01T00:00:00Z'
    },
    { ...asset(1), kind: 'logo', createdAt: '2026-01-03T00:00:00Z' },
    {
      ...asset(2),
      kind: 'supporting_image',
      createdAt: '2026-01-02T00:00:00Z',
      websiteSelected: true
    }
  ]);
  await f.c.load();
  assert.deepEqual(
    f.c.filtered().map((asset) => asset.id),
    ['media-1', 'media-2', 'media-0']
  );
  f.c.libraryView.set('presentation');
  assert.deepEqual(
    f.c.filtered().map((asset) => asset.id),
    ['media-1', 'media-2']
  );
  f.c.kindFilter.set('logo');
  assert.equal(f.c.filtered()[0], f.data.assets[1]);
  f.c.kindFilter.set('all');
  f.c.libraryView.set('documents');
  assert.equal(f.c.filtered().length, 0);
  f.c.classifications.set({ 'media-0': 'document' });
  assert.equal(f.c.filtered()[0], f.data.assets[0]);
});

test('selection scope reports off-page items and cannot introduce foreign media ids', async () => {
  const f = fixture();
  await f.c.load();
  f.c.selectPage();
  assert.equal(f.c.selected().length, 8);
  f.c.page.set(2);
  assert.equal(f.c.hiddenSelectionCount(), 8);
  f.c.toggle('foreign-media');
  assert.equal(f.c.selected().length, 8);
  f.c.selectPage();
  f.c.search.set('photo-1');
  assert.equal(
    f.c.hiddenSelectionCount(),
    f.c.selected().filter((item) => !f.c.visible().includes(item)).length
  );
  f.c.setScope('another-dossier');
  assert.equal(f.c.selected().length, 0);
  assert.equal(f.c.hiddenSelectionCount(), 0);
});

test('a mismatched server projection never exposes another dossier or its assets', async () => {
  const f = fixture();
  f.ports.admin.mediaWorkspace = async () => ({
    ...f.data,
    contributionId: 'other-dossier'
  });
  await f.c.load();
  assert.equal(f.c.data(), null);
  assert.equal(f.c.error(), 'loadFailed');
});

test('private assignment plans carry the exact target version without executing any decision', async () => {
  const f = fixture();
  await f.c.load();
  f.c.toggle('media-0');
  await f.c.prepare('preparation_assign', {
    targetObligationId: 'website-1',
    targetObligationVersion: 3
  });
  const request = f.calls.find(([name]) => name === 'plan')[1];
  assert.equal(request.targetObligationId, 'website-1');
  assert.equal(request.targetObligationVersion, 3);
  assert.equal(request.action, 'preparation_assign');
  assert.equal(
    f.calls.some(([name]) => name === 'execute'),
    false
  );
});

test('usage scope suggestions snapshot actual image services without changing existing rights', async () => {
  const f = fixture();
  const obligation = {
    id: 'website-1',
    version: 1,
    channel: 'website',
    target: 'openg7',
    ordinal: 1,
    format: null,
    state: 'pending',
    acceptsMedia: true
  };
  f.data.preparationObligations = [
    obligation,
    { ...obligation, id: 'website-2', ordinal: 2 },
    {
      ...obligation,
      id: 'facebook-1',
      channel: 'facebook',
      target: 'openg20',
      format: 'individual_portrait',
      state: 'blocked'
    },
    {
      ...obligation,
      id: 'linkedin-text',
      channel: 'linkedin',
      format: 'collective_text',
      acceptsMedia: false
    },
    {
      ...obligation,
      id: 'linkedin-fulfilled',
      channel: 'linkedin',
      state: 'fulfilled',
      acceptsMedia: false
    }
  ];
  await f.c.load();
  f.c.inspectedId.set(f.data.assets[0].id);
  const commands = new MediaReviewCommands(f.c, () => id);
  commands.openRules('media');
  assert.deepEqual(commands.rulesSuggestedScope(), {
    channels: ['website', 'facebook'],
    targets: ['openg7', 'openg20']
  });
  assert.equal(commands.rulesValue(), f.data.assets[0].usage);
  const suggestion = commands.rulesSuggestedScope();
  f.c.data.update((data) => ({ ...data, preparationObligations: [] }));
  assert.equal(commands.rulesSuggestedScope(), suggestion);
  assert.equal(
    f.calls.some(([name]) => name !== 'read'),
    false
  );
  commands.openRules('media');
  assert.equal(commands.rulesSuggestedScope(), null);
});

test('missing services and restoring inheritance do not propose new usage rights', async () => {
  const f = fixture();
  await f.c.load();
  const commands = new MediaReviewCommands(f.c, () => id);
  commands.openRules();
  assert.equal(commands.rulesSuggestedScope(), null);
  assert.equal(commands.rulesValue(), null);
  commands.rulesSuggestedScope.set({
    channels: ['facebook'],
    targets: ['openg20']
  });
  commands.restoreInheritance(f.data.assets[0]);
  assert.equal(commands.rulesSuggestedScope(), null);
  assert.equal(commands.inheritRequested(), true);
});

test('a correction uses native N1 reasons and requires the editorial provision before preparing its manifest', async () => {
  const f = fixture();
  await f.c.load();
  f.c.toggle('media-0');
  const commands = new MediaReviewCommands(f.c, () => id);
  commands.openCorrection();
  commands.rejectReason.set('EDITORIAL_INCOMPATIBILITY');
  commands.rejectExplanation.set(
    'Please correct the identified editorial problem.'
  );
  commands.rejectInternalReason.set(
    'Synthetic documented editorial correction.'
  );
  await commands.prepareReject();
  assert.equal(
    f.calls.some(([name]) => name === 'plan'),
    false
  );
  commands.editorialProvision.set('recognition-scope');
  await commands.prepareReject();
  const request = f.calls.find(([name]) => name === 'plan')[1];
  assert.equal(request.action, 'request_correction');
  assert.equal(request.editorialProvision, 'recognition-scope');
  assert.equal(commands.humanReviewed(), false);
  assert.equal(
    f.calls.some(([name]) => name === 'execute'),
    false
  );
});

test('multi-file upload reports invalid files separately and continues with valid files', async () => {
  const f = fixture();
  await f.c.load();
  const uploaded = [];
  const upload = new MediaReviewUpload({
    admin: {
      mediaUpload: async (_id, _kind, file) => {
        uploaded.push(file.name);
        return { uploaded: true, asset: f.data.assets[0] };
      }
    },
    controller: f.c,
    contributionId: () => id,
    refresh: async () => {},
    changed: () => {}
  });
  await upload.upload({
    target: {
      files: [
        new File(['synthetic'], 'invalid.txt', { type: 'text/plain' }),
        new File(['synthetic'], 'valid.png', { type: 'image/png' })
      ],
      value: ''
    }
  });
  assert.deepEqual(uploaded, ['valid.png']);
  assert.deepEqual(upload.result().items, [
    { name: 'invalid.txt', state: 'invalid' },
    { name: 'valid.png', state: 'received' }
  ]);
  assert.equal(upload.result().received, 1);
  assert.equal(upload.result().failed, 1);
});

test('an uncertain upload retains its request id and stops the remaining files without replay', async () => {
  const f = fixture();
  await f.c.load();
  const requests = [];
  const upload = new MediaReviewUpload({
    admin: {
      mediaUpload: async (_id, _kind, _file, requestId) => {
        requests.push(requestId);
        throw new Error('Synthetic lost acknowledgement');
      }
    },
    controller: f.c,
    contributionId: () => id,
    refresh: async () => {},
    changed: () => {}
  });
  await upload.upload({
    target: {
      files: [
        new File(['synthetic'], 'first.png', { type: 'image/png' }),
        new File(['synthetic'], 'second.png', { type: 'image/png' })
      ],
      value: ''
    }
  });
  assert.equal(requests.length, 1);
  assert.equal(f.c.uncertainRequest(), requests[0]);
  assert.equal(f.c.uncertain(), true);
  assert.deepEqual(upload.result().items, [
    { name: 'first.png', state: 'uncertain' },
    { name: 'second.png', state: 'not_processed' }
  ]);
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
