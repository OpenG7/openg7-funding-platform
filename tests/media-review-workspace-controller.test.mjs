import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { MediaReviewWorkspaceController } from '../dist/apps/funding-web/src/app/features/funding/components/media-review/media-review-workspace.controller.js';
import { MediaPreviewCollection } from '../dist/apps/funding-web/src/app/features/funding/components/media-review/media-preview-collection.js';
import { MediaReviewUpload } from '../dist/apps/funding-web/src/app/features/funding/components/media-review/media-review-upload.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

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

const acceptedMedia = (index = 0) => ({
  ...asset(index),
  usageSource: 'media',
  ruleId: null,
  usageAcceptance: {
    id: 'synthetic-acceptance-' + index,
    termsVersion: 'synthetic-media-terms-v1',
    termsFingerprint: 'f'.repeat(64),
    locale: 'fr-CA',
    acceptedAt: '2026-11-09T15:20:00.000Z',
    source: 'platform_acceptance'
  }
});

async function acceptedReviewFixture(assets = [acceptedMedia(), asset(1)]) {
  const f = fixture(assets);
  await f.c.load();
  f.c.inspectedId.set(assets[0].id);
  return {
    ...f,
    selected: assets[0],
    commands: new MediaReviewCommands(f.c, () => id)
  };
}

test('platform acceptance opens and cancels a review without any command or business decision', async () => {
  const f = await acceptedReviewFixture();
  f.c.selectedIds.set(['media-1']);
  f.commands.openAcceptedReview(f.selected);
  assert.equal(f.commands.form(), 'review');
  assert.equal(f.commands.acceptedReviewAsset(), f.selected);
  assert.equal(f.commands.canApproveAcceptedReview(), true);
  assert.equal(f.commands.humanReviewed(), false);
  assert.deepEqual(f.calls, [['read']]);
  f.commands.closeForm();
  assert.equal(f.commands.form(), null);
  assert.equal(f.commands.acceptedReview(), null);
  assert.equal(f.c.plan(), null);
  assert.equal(f.selected.reviewStatus, 'pending_review');
  assert.deepEqual(f.calls, [['read']]);
});

test('an explicit platform review prepares and executes only the displayed file despite another selection', async () => {
  const f = await acceptedReviewFixture();
  f.c.selectedIds.set(['media-1']);
  f.commands.openAcceptedReview(f.selected);
  f.c.edit(f.selected, {
    altText: '  Human description of this exact image  '
  });
  assert.deepEqual(f.calls, [['read']]);
  await f.commands.approveAcceptedReview();
  const plans = f.calls.filter(([name]) => name === 'plan');
  const executions = f.calls.filter(([name]) => name === 'execute');
  assert.equal(plans.length, 1);
  assert.equal(executions.length, 1);
  assert.deepEqual(plans[0][1].assets, [
    {
      id: 'media-0',
      version: 'v1',
      altText: 'Human description of this exact image'
    }
  ]);
  assert.equal(plans[0][1].expectedRevision, 'workspace-v1');
  assert.equal(plans[0][1].action, 'approve');
  assert.equal(plans[0][1].contributionId, id);
  assert.equal(executions[0][1].planId, 'plan');
  assert.equal(executions[0][1].confirmation, 'plan');
  assert.equal(executions[0][1].humanReviewed, true);
  assert.equal(f.commands.form(), null);
  assert.equal(f.c.receipt().status, 'completed');
  assert.equal(
    f.calls.some(([name]) => name === 'rules'),
    false
  );
});

test('platform review requires a bounded description and explicit review of recorded restrictions', async () => {
  const selected = acceptedMedia();
  selected.altText = null;
  selected.usage.restrictions = 'Synthetic restriction for this image';
  const f = await acceptedReviewFixture([selected]);
  f.commands.openAcceptedReview(selected);
  assert.equal(f.c.draft(selected).restrictions, false);
  assert.equal(f.commands.canApproveAcceptedReview(), false);
  await f.commands.approveAcceptedReview();
  f.c.edit(selected, { altText: 'Human description' });
  assert.equal(f.commands.canApproveAcceptedReview(), false);
  await f.commands.approveAcceptedReview();
  f.c.edit(selected, { restrictions: true });
  assert.equal(f.commands.canApproveAcceptedReview(), true);
  f.c.edit(selected, { altText: 'x'.repeat(301) });
  assert.equal(f.commands.canApproveAcceptedReview(), false);
  await f.commands.approveAcceptedReview();
  assert.deepEqual(f.calls, [['read']]);
  f.c.edit(selected, { altText: 'Human description' });
  await f.commands.approveAcceptedReview();
  assert.deepEqual(f.calls.find(([name]) => name === 'plan')[1].assets, [
    {
      id: 'media-0',
      version: 'v1',
      altText: 'Human description',
      usageRestrictionsConfirmed: true
    }
  ]);
  assert.equal(f.calls.filter(([name]) => name === 'execute').length, 1);
});

test('platform review cannot open without active rights, source proof and writing permission', async (t) => {
  for (const [name, change] of [
    [
      'reader',
      (f) => f.c.data.update((data) => ({ ...data, writable: false }))
    ],
    [
      'denied actor',
      (f) => {
        f.ports.permitted = () => false;
      }
    ],
    ['uncertain command', (f) => f.c.uncertain.set(true)],
    [
      'blocked media',
      (f) => {
        f.selected.readiness.state = 'blocked';
      }
    ],
    [
      'withdrawn rights',
      (f) => {
        f.selected.usage.state = 'withdrawn';
      }
    ],
    [
      'missing acceptance',
      (f) => {
        delete f.selected.usageAcceptance;
      }
    ],
    ['another inspected file', (f) => f.c.inspectedId.set('media-1')]
  ]) {
    await t.test(name, async () => {
      const f = await acceptedReviewFixture();
      change(f);
      f.commands.openAcceptedReview(f.selected);
      assert.equal(f.commands.form(), null);
      assert.equal(f.commands.acceptedReview(), null);
      assert.deepEqual(f.calls, [['read']]);
    });
  }
});

test('platform review refuses changed source context before preparing a decision', async (t) => {
  for (const [name, change] of [
    ['dossier', (f) => f.c.setScope('another-dossier')],
    ['inspected file', (f) => f.c.inspectedId.set('media-1')],
    [
      'workspace revision',
      (f) => f.c.data.update((data) => ({ ...data, revision: 'workspace-v2' }))
    ],
    [
      'asset version',
      (f) =>
        f.c.data.update((data) => ({
          ...data,
          assets: data.assets.map((item) => ({ ...item, version: 'v2' }))
        }))
    ],
    [
      'acceptance evidence',
      (f) =>
        f.c.data.update((data) => ({
          ...data,
          assets: data.assets.map((item) => ({
            ...item,
            usageAcceptance: {
              ...item.usageAcceptance,
              id: 'changed-acceptance'
            }
          }))
        }))
    ]
  ]) {
    await t.test(name, async () => {
      const f = await acceptedReviewFixture();
      f.commands.openAcceptedReview(f.selected);
      change(f);
      assert.equal(f.commands.canApproveAcceptedReview(), false);
      await f.commands.approveAcceptedReview();
      assert.deepEqual(f.calls, [['read']]);
      assert.equal(f.commands.humanReviewed(), false);
    });
  }
});

test('platform review rejects a server plan that differs from the exact human confirmation', async (t) => {
  for (const [name, change] of [
    ['dossier', (plan) => ({ ...plan, contributionId: 'other-dossier' })],
    ['workspace revision', (plan) => ({ ...plan, revision: 'workspace-v2' })],
    [
      'asset version',
      (plan) => ({ ...plan, assets: [{ ...plan.assets[0], version: 'v2' }] })
    ],
    [
      'acceptance evidence',
      (plan) => ({
        ...plan,
        assets: [
          {
            ...plan.assets[0],
            usageAcceptance: {
              ...plan.assets[0].usageAcceptance,
              id: 'changed-acceptance'
            }
          }
        ]
      })
    ],
    [
      'usage permissions',
      (plan) => ({
        ...plan,
        assets: [
          {
            ...plan.assets[0],
            usage: { ...plan.assets[0].usage, channels: ['facebook'] }
          }
        ]
      })
    ],
    [
      'description',
      (plan) => ({
        ...plan,
        assets: [
          { ...plan.assets[0], altText: 'Unreviewed replacement description' }
        ]
      })
    ],
    ['extra file', (plan) => ({ ...plan, assets: [...plan.assets, asset(1)] })]
  ]) {
    await t.test(name, async () => {
      const f = await acceptedReviewFixture();
      const prepare = f.ports.admin.mediaBatchPlan;
      f.ports.admin.mediaBatchPlan = async (request) =>
        change(await prepare(request));
      f.commands.openAcceptedReview(f.selected);
      await f.commands.approveAcceptedReview();
      assert.equal(f.calls.filter(([command]) => command === 'plan').length, 1);
      assert.equal(
        f.calls.some(([command]) => command === 'execute'),
        false
      );
      assert.equal(f.c.error(), 'changed');
      assert.equal(f.c.plan(), null);
      assert.equal(f.commands.humanReviewed(), false);
    });
  }
});

test('a platform review invalidated while its plan is pending never executes or retains that plan', async () => {
  const f = await acceptedReviewFixture();
  const prepare = f.ports.admin.mediaBatchPlan;
  let release;
  let reportReady;
  const ready = new Promise((resolve) => {
    reportReady = resolve;
  });
  f.ports.admin.mediaBatchPlan = async (request) => {
    const plan = await prepare(request);
    await new Promise((resolve) => {
      release = resolve;
      reportReady();
    });
    return plan;
  };
  f.commands.openAcceptedReview(f.selected);
  const pending = f.commands.approveAcceptedReview();
  await ready;
  assert.equal(f.commands.reviewSubmitting(), true);
  await f.commands.approveAcceptedReview();
  f.c.data.update((data) => ({ ...data, revision: 'workspace-v2' }));
  release();
  await pending;
  assert.equal(f.calls.filter(([command]) => command === 'plan').length, 1);
  assert.equal(
    f.calls.some(([command]) => command === 'execute'),
    false
  );
  assert.equal(f.c.plan(), null);
  assert.equal(f.c.error(), 'changed');
  assert.equal(f.commands.reviewSubmitting(), false);
});

test('blocked or rejected platform plans never execute a media approval', async (t) => {
  for (const response of ['blocked', 'conflict']) {
    await t.test(response, async () => {
      const f = await acceptedReviewFixture();
      const prepare = f.ports.admin.mediaBatchPlan;
      f.ports.admin.mediaBatchPlan = async (request) => {
        const plan = await prepare(request);
        if (response === 'conflict') throw new AdminDashboardRequestError(409);
        return {
          ...plan,
          blocked: [{ id: 'media-0', reasons: ['MEDIA_INVALID'] }]
        };
      };
      f.commands.openAcceptedReview(f.selected);
      await f.commands.approveAcceptedReview();
      assert.equal(f.calls.filter(([command]) => command === 'plan').length, 1);
      assert.equal(
        f.calls.some(([command]) => command === 'execute'),
        false
      );
      assert.equal(f.commands.humanReviewed(), false);
      assert.equal(f.commands.form(), 'review');
      if (response === 'blocked') assert.equal(f.c.plan().blocked.length, 1);
      else assert.equal(f.c.plan(), null);
    });
  }
});

test('platform review preserves authentication and authorization errors returned during planning', async (t) => {
  for (const status of [401, 403]) {
    await t.test(String(status), async () => {
      const f = await acceptedReviewFixture();
      f.ports.admin.mediaBatchPlan = async (request) => {
        f.calls.push(['plan', request]);
        throw new AdminDashboardRequestError(status);
      };
      f.commands.openAcceptedReview(f.selected);
      await f.commands.approveAcceptedReview();
      assert.equal(f.c.error(), status === 401 ? 'unauthorized' : 'forbidden');
      assert.equal(f.c.data(), null);
      assert.equal(f.c.plan(), null);
      assert.equal(f.calls.filter(([command]) => command === 'plan').length, 1);
      assert.equal(
        f.calls.some(([command]) => command === 'execute'),
        false
      );
      assert.equal(f.commands.humanReviewed(), false);
      assert.equal(
        f.calls.filter(([command]) => command === 'unauthorized').length,
        status === 401 ? 1 : 0
      );
    });
  }
});

test('an uncertain platform approval is reconciled without planning or executing it twice', async () => {
  const f = await acceptedReviewFixture();
  f.ports.admin.mediaBatchExecute = async (request) => {
    f.calls.push(['execute', request]);
    throw new AdminDashboardRequestError(503);
  };
  f.commands.openAcceptedReview(f.selected);
  await f.commands.approveAcceptedReview();
  assert.equal(f.c.uncertain(), true);
  assert.equal(f.c.error(), 'uncertain');
  assert.equal(f.commands.form(), 'review');
  assert.equal(f.commands.canApproveAcceptedReview(), false);
  await f.commands.approveAcceptedReview();
  f.commands.closeForm();
  f.commands.openAcceptedReview(f.selected);
  assert.equal(f.commands.form(), null);
  assert.equal(f.calls.filter(([command]) => command === 'plan').length, 1);
  assert.equal(f.calls.filter(([command]) => command === 'execute').length, 1);
  f.receiptFound();
  await f.c.reconcile();
  assert.equal(f.c.uncertain(), false);
  assert.equal(f.c.receipt().status, 'completed');
  assert.equal(f.calls.filter(([command]) => command === 'receipt').length, 1);
  assert.equal(f.calls.filter(([command]) => command === 'plan').length, 1);
  assert.equal(f.calls.filter(([command]) => command === 'execute').length, 1);
});

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

const unconfirmedMedia = (index = 0) => ({
  ...asset(index, 'blocked'),
  usage: {
    state: 'needs_confirmation',
    channels: [],
    targets: [],
    transformations: [],
    credit: null,
    restrictions: null
  },
  readiness: {
    state: 'blocked',
    reasons: ['MEDIA_USAGE_CONFIRMATION_REQUIRED']
  }
});
const documentedUsage = {
  usage: {
    state: 'confirmed',
    channels: ['website'],
    targets: ['openg7'],
    transformations: ['technical'],
    credit: null,
    restrictions: null
  },
  evidenceReference: 'Synthetic private image-usage agreement'
};

test('guided media review asks for documented rights on the inspected file without planning or approving', async () => {
  const f = fixture([unconfirmedMedia(), asset(1)]);
  await f.c.load();
  f.c.inspectedId.set('media-0');
  f.c.selectedIds.set(['media-1']);
  const continued = [];
  const commands = new MediaReviewCommands(
    f.c,
    () => id,
    (target) => continued.push(target)
  );
  commands.openReviewPermissions(f.data.assets[0]);
  assert.equal(commands.form(), 'rules');
  assert.equal(commands.rulesScope(), 'media');
  assert.equal(commands.rulesScopeId(), 'media-0');
  assert.deepEqual(
    commands.coveredAssets().map((item) => item.id),
    ['media-0']
  );
  commands.changeScope({ target: { value: 'dossier' } });
  assert.equal(commands.rulesScope(), 'media');
  await commands.saveRules({ ...documentedUsage, evidenceReference: '' });
  assert.deepEqual(f.calls, [['read']]);
  assert.deepEqual(continued, []);

  f.ports.admin.mediaRules = async (request) => {
    f.calls.push(['rules', request]);
    return {
      ...f.data,
      revision: 'workspace-v2',
      assets: f.data.assets.map((item) =>
        item.id === 'media-0'
          ? {
              ...item,
              version: 'v2',
              usage: request.usage,
              readiness: {
                state: 'needs_review',
                reasons: ['MEDIA_HUMAN_REVIEW_REQUIRED']
              }
            }
          : item
      )
    };
  };
  await commands.saveRules(documentedUsage);
  const request = f.calls.find(([name]) => name === 'rules')[1];
  assert.equal(request.contributionId, id);
  assert.equal(request.expectedRevision, 'workspace-v1');
  assert.equal(request.scope, 'media');
  assert.equal(request.scopeId, 'media-0');
  assert.equal(request.confirmation, 'media-0');
  assert.deepEqual(request.coveredAssetIds, ['media-0']);
  assert.equal(request.includesFutureUploads, undefined);
  assert.equal(request.evidenceReference, documentedUsage.evidenceReference);
  assert.equal(f.c.inspected().version, 'v2');
  assert.equal(f.c.inspected().reviewStatus, 'pending_review');
  assert.equal(commands.form(), null);
  assert.equal(commands.reviewPermissions(), null);
  assert.equal(commands.humanReviewed(), false);
  assert.deepEqual(continued, [{ id: 'media-0', contributionId: id }]);
  assert.equal(
    f.calls.some(([name]) => name === 'plan' || name === 'execute'),
    false
  );
});

test('confirmed rights retain the exact review target while parent refresh temporarily disables the surface', async () => {
  const f = fixture([unconfirmedMedia()]);
  await f.c.load();
  f.c.inspectedId.set('media-0');
  let refreshing = false;
  f.ports.permitted = () => !refreshing;
  f.ports.changed = () => {
    refreshing = true;
  };
  f.ports.admin.mediaRules = async (request) => {
    f.calls.push(['rules', request]);
    return {
      ...f.data,
      revision: 'workspace-v2',
      assets: [
        {
          ...f.data.assets[0],
          version: 'v2',
          usage: request.usage,
          readiness: {
            state: 'needs_review',
            reasons: ['MEDIA_HUMAN_REVIEW_REQUIRED']
          }
        }
      ]
    };
  };
  const targets = [];
  const commands = new MediaReviewCommands(
    f.c,
    () => id,
    (target) => targets.push(target)
  );
  commands.openReviewPermissions(f.data.assets[0]);
  await commands.saveRules(documentedUsage);
  assert.equal(f.c.canWrite(), false);
  assert.deepEqual(targets, [{ id: 'media-0', contributionId: id }]);
  assert.equal(commands.form(), null);
  assert.equal(
    f.calls.some(([name]) => name === 'plan' || name === 'execute'),
    false
  );
});

test('guided rights cannot be saved after their file, version, workspace or scope changes', async (t) => {
  for (const [name, change] of [
    ['inspected file', (f) => f.c.inspectedId.set('media-1')],
    [
      'asset version',
      (f) =>
        f.c.data.update((data) => ({
          ...data,
          assets: data.assets.map((item) => ({ ...item, version: 'v2' }))
        }))
    ],
    [
      'workspace revision',
      (f) => f.c.data.update((data) => ({ ...data, revision: 'workspace-v2' }))
    ],
    ['rules scope', (_f, commands) => commands.rulesScope.set('dossier')],
    ['inheritance', (_f, commands) => commands.inheritRequested.set(true)],
    [
      'future files',
      (_f, commands) => commands.includesFutureUploads.set(true)
    ],
    ['dossier', (f) => f.c.setScope('another-dossier')]
  ]) {
    await t.test(name, async () => {
      const f = fixture([unconfirmedMedia(), asset(1)]);
      await f.c.load();
      f.c.inspectedId.set('media-0');
      const continued = [];
      const commands = new MediaReviewCommands(
        f.c,
        () => id,
        (target) => continued.push(target)
      );
      commands.openReviewPermissions(f.data.assets[0]);
      change(f, commands);
      await commands.saveRules(documentedUsage);
      assert.deepEqual(f.calls, [['read']]);
      assert.deepEqual(continued, []);
      assert.equal(f.c.error(), 'changed');
    });
  }
});

test('guided rights do not open for a hard blocker, denied actor or uncertain operation', async (t) => {
  for (const [name, change] of [
    [
      'technical failure',
      (f) => {
        f.data.assets[0].readiness.reasons.push('MEDIA_INVALID');
      }
    ],
    [
      'withdrawn rights',
      (f) => {
        f.data.assets[0].readiness.reasons = ['MEDIA_USAGE_WITHDRAWN'];
      }
    ],
    [
      'moderation restriction',
      (f) => {
        f.data.assets[0].readiness.reasons.push('MODERATION_RESTRICTED');
      }
    ],
    [
      'rejected media with an inconsistent reason',
      (f) => {
        f.data.assets[0].reviewStatus = 'rejected';
      }
    ],
    [
      'withdrawn rights with an inconsistent reason',
      (f) => {
        f.data.assets[0].usage.state = 'withdrawn';
      }
    ],
    ['denied actor', (f) => (f.ports.permitted = () => false)],
    ['uncertain command', (f) => f.c.uncertain.set(true)],
    ['busy command', (f) => f.c.busy.set(true)]
  ]) {
    await t.test(name, async () => {
      const f = fixture([unconfirmedMedia()]);
      change(f);
      await f.c.load();
      f.c.inspectedId.set('media-0');
      const commands = new MediaReviewCommands(f.c, () => id);
      commands.openReviewPermissions(f.data.assets[0]);
      assert.equal(commands.form(), null);
      assert.equal(commands.reviewPermissions(), null);
      assert.deepEqual(f.calls, [['read']]);
    });
  }
});

test('an uncertain rights save keeps the guided form blocked without retrying or continuing acceptance', async () => {
  const f = fixture([unconfirmedMedia()]);
  f.ports.admin.mediaRules = async (request) => {
    f.calls.push(['rules', request]);
    throw new AdminDashboardRequestError(503);
  };
  await f.c.load();
  f.c.inspectedId.set('media-0');
  const continued = [];
  const commands = new MediaReviewCommands(
    f.c,
    () => id,
    (target) => continued.push(target)
  );
  commands.openReviewPermissions(f.data.assets[0]);
  await commands.saveRules(documentedUsage);
  assert.equal(f.c.uncertain(), true);
  assert.equal(commands.form(), 'rules');
  assert.equal(commands.reviewPermissions().id, 'media-0');
  await commands.saveRules(documentedUsage);
  assert.equal(f.calls.filter(([name]) => name === 'rules').length, 1);
  assert.deepEqual(continued, []);
  assert.equal(
    f.calls.some(([name]) => name === 'plan' || name === 'execute'),
    false
  );
});

test('a delayed rights response never continues review for a different inspected file', async () => {
  const f = fixture([unconfirmedMedia(), asset(1)]);
  let resolve;
  f.ports.admin.mediaRules = async () =>
    new Promise((complete) => {
      resolve = complete;
    });
  await f.c.load();
  f.c.inspectedId.set('media-0');
  const continued = [];
  const commands = new MediaReviewCommands(
    f.c,
    () => id,
    (target) => continued.push(target)
  );
  commands.openReviewPermissions(f.data.assets[0]);
  const saving = commands.saveRules(documentedUsage);
  f.c.inspectedId.set('media-1');
  resolve({ ...f.data, revision: 'workspace-v2' });
  await saving;
  assert.deepEqual(continued, []);
  assert.equal(f.c.inspected().id, 'media-1');
  assert.equal(commands.reviewPermissions(), null);
});

test('resetting the review context prevents a late rights response from closing a new form', async () => {
  const f = fixture([unconfirmedMedia()]);
  let resolve;
  f.ports.admin.mediaRules = async () =>
    new Promise((complete) => {
      resolve = complete;
    });
  await f.c.load();
  f.c.inspectedId.set('media-0');
  const continued = [];
  const commands = new MediaReviewCommands(
    f.c,
    () => id,
    (target) => continued.push(target)
  );
  commands.openReviewPermissions(f.data.assets[0]);
  const saving = commands.saveRules(documentedUsage);
  commands.reset();
  commands.form.set('batch');
  resolve({ ...f.data, revision: 'workspace-v2' });
  await saving;
  assert.equal(commands.form(), 'batch');
  assert.equal(commands.reviewPermissions(), null);
  assert.deepEqual(continued, []);
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
