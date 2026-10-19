import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

import {
  projectPreparationPilot,
  reconcilePreparationIssue
} from '../dist/apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-pilot.projection.js';
import {
  preparationIssueDestination,
  preparationAssistanceDestination
} from '../dist/apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-navigation.js';
const coreHook = registerHooks({
  resolve(specifier, context, next) {
    return specifier === '@openg7/funding-core'
      ? {
          url: new URL(
            '../dist/packages/funding-core/src/index.js',
            import.meta.url
          ).href,
          shortCircuit: true
        }
      : next(specifier, context);
  }
});
const {
  matchesPreparationControllerContext,
  preparationContextActions,
  preparationControllerContext
} =
  await import('../dist/apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-context-actions.js');
coreHook.deregister();

const contributionId = '10000000-0000-4000-8000-000000000811';
const adminUrl = '/admin/fundraiser/sponsors?sponsorshipId=' + contributionId;

function receipt(changes = {}) {
  return {
    contributionId,
    reference: 'SYNTHETIC-811',
    version: 'a'.repeat(64),
    status: 'incomplete',
    payment: {
      amountMinor: 5000,
      currency: 'CAD',
      status: 'paid',
      confirmedAt: '2026-10-17T12:00:00.000Z'
    },
    acceptedOffer: null,
    balance: null,
    checks: [
      { code: 'payment_confirmed', state: 'complete' },
      { code: 'accepted_offer', state: 'missing' },
      { code: 'content_prepared', state: 'missing' }
    ],
    authorizations: [
      { code: 'public_consent', state: 'complete' },
      { code: 'sponsor_review', state: 'missing' },
      { code: 'moderation_review', state: 'missing' }
    ],
    drafts: [],
    blockers: [
      { code: 'commitment_needs_confirmation', adminUrl },
      { code: 'sponsor_review_required', adminUrl },
      { code: 'moderation_review_required', adminUrl },
      { code: 'presentation_missing', adminUrl }
    ],
    canApprove: false,
    approval: null,
    approvalHistory: [],
    ...changes
  };
}

const t = (key) => key;
const assistance = () => ({
  contributionId,
  controlCode: 'accepted_offer',
  revision: 'source1-run1-review0',
  sourceVersion: 1,
  commitmentVersion: 1,
  stale: false,
  capabilities: {
    canManageSource: true,
    canRun: true,
    canReview: true,
    canApply: true
  },
  run: {
    id: 'synthetic-local-run',
    sourceVersion: 1,
    commitmentVersion: 1,
    adapter: 'local_rules_v1',
    state: 'succeeded',
    phase: 'finished',
    errorCode: null,
    reviewVersion: 0,
    reviewDecision: null,
    clauseCount: 2,
    unsupportedCount: 1,
    unresolvedCount: 2,
    appliedCommitmentVersion: null
  }
});
const actions = (current, changes = {}) =>
  preparationContextActions({
    receipt: current,
    issue: null,
    busy: false,
    detailsMode: 'inline',
    t,
    ...changes
  });

test('counts real applicable server checks and authorizations as blockers resolve', () => {
  const initial = receipt();
  const before = projectPreparationPilot(initial);
  assert.deepEqual([before.completed, before.total], [2, 6]);
  assert.equal(before.issues.length, 6);
  const updated = receipt({
    checks: initial.checks.map((check) => ({ ...check, state: 'complete' })),
    authorizations: initial.authorizations.map((check) => ({
      ...check,
      state: 'complete'
    })),
    blockers: [],
    canApprove: true,
    status: 'ready'
  });
  const after = projectPreparationPilot(updated);
  assert.deepEqual([after.completed, after.total], [6, 6]);
  assert.deepEqual(
    before.issues.map((issue) => issue.id),
    after.issues.map((issue) => issue.id)
  );
  assert.equal(
    after.issues.every((issue) => issue.completed),
    true
  );
});

test('assistance action descriptors share exact ids and shortcuts without changing server prerequisite counts', () => {
  const current = receipt(),
    issue = projectPreparationPilot(current).issues.find(
      (entry) => entry.checkCode === 'accepted_offer'
    );
  const projected = actions(current, {
    issue,
    canAssist: true,
    assistanceSummary: assistance()
  });
  assert.deepEqual(
    projected
      .filter((action) => action.id.startsWith('preparation-assistance-'))
      .map((action) => [action.id, action.enabled, action.shortcut?.label]),
    [
      ['preparation-assistance-review', true, 'A'],
      ['preparation-assistance-source', true, 'X'],
      ['preparation-assistance-rerun', true, 'Y']
    ]
  );
  assert.equal(
    projected.find((action) => action.id === 'preparation-details').shortcut,
    undefined
  );
  assert.equal(
    projected.find((action) => action.id === 'preparation-history').shortcut,
    undefined
  );
  assert.equal(
    projected.some((action) => 'execute' in action),
    false
  );
  assert.deepEqual(
    [
      projectPreparationPilot(current).completed,
      projectPreparationPilot(current).total
    ],
    [2, 6]
  );
  for (const entry of [
    { issue, canAssist: false, assistanceSummary: assistance() },
    {
      issue: { ...issue, checkCode: 'moderation_review' },
      canAssist: true,
      assistanceSummary: assistance()
    },
    {
      issue,
      canAssist: true,
      assistanceSummary: { ...assistance(), contributionId: 'another-dossier' }
    }
  ])
    assert.equal(
      actions(current, entry).some((action) =>
        action.id.startsWith('preparation-assistance-')
      ),
      false
    );
});

test('source, job and review revisions invalidate only the corresponding control context', () => {
  const current = receipt(),
    summary = assistance();
  const agreement = preparationControllerContext(
    current,
    'check:accepted_offer',
    summary
  );
  const moderation = preparationControllerContext(
    current,
    'check:moderation_review',
    summary
  );
  for (const revision of [
    'source2-run2-review0',
    'source1-run1-processing',
    'source1-run1-review2'
  ]) {
    const next = { ...summary, revision };
    assert.equal(
      matchesPreparationControllerContext(
        preparationControllerContext(current, 'check:accepted_offer', next),
        agreement
      ),
      false
    );
    assert.deepEqual(
      preparationControllerContext(current, 'check:moderation_review', next),
      moderation
    );
  }
  assert.equal(
    preparationControllerContext(current, 'check:accepted_offer', {
      ...summary,
      contributionId: 'another-dossier'
    }).revision,
    current.version
  );
  assert.equal(
    preparationAssistanceDestination(contributionId, 'review'),
    adminUrl + '&tab=publication#dossier-assistance-review'
  );
  assert.equal(
    preparationAssistanceDestination(contributionId, 'source'),
    adminUrl + '&tab=publication#dossier-assistance-source'
  );
});

test('not-required controls are omitted and batch examination remains a separate check', () => {
  const personal = receipt({
    checks: [
      { code: 'payment_confirmed', state: 'complete' },
      { code: 'accepted_offer', state: 'not_required' },
      { code: 'content_prepared', state: 'not_required' }
    ],
    authorizations: [],
    blockers: []
  });
  const direct = projectPreparationPilot(personal);
  assert.deepEqual(
    [direct.completed, direct.total, direct.issues.length],
    [1, 1, 1]
  );
  const batch = projectPreparationPilot({
    ...personal,
    checks: [
      { code: 'dossier_examined', state: 'missing' },
      ...personal.checks
    ],
    blockers: [{ code: 'dossier_not_examined', adminUrl }]
  });
  assert.deepEqual([batch.completed, batch.total], [1, 2]);
  assert.equal(batch.issues[0].id, 'check:dossier_examined');
});

test('presentation blockers explain the content control without becoming extra tasks', () => {
  const projected = projectPreparationPilot(receipt());
  const content = projected.issues.find(
    (issue) => issue.checkCode === 'content_prepared'
  );
  assert.equal(content.titleKey, 'pilot.checks.content_prepared');
  assert.equal(content.actionKind, 'presentation');
  assert.deepEqual(content.summaryCodes, ['presentation_missing']);
  const agreement = projected.issues.find(
    (issue) => issue.checkCode === 'accepted_offer'
  );
  assert.equal(agreement.actionKind, 'agreement');
  assert.deepEqual(agreement.summaryCodes, ['commitment_needs_confirmation']);
});

test('unmapped blockers remain actionable even when all declared checks are complete', () => {
  const current = receipt({
    checks: [{ code: 'payment_confirmed', state: 'complete' }],
    authorizations: [],
    blockers: [
      { code: 'future_server_blocker', adminUrl },
      { code: 'required_media_missing', adminUrl },
      { code: 'presentation_missing', adminUrl }
    ]
  });
  const projected = projectPreparationPilot(current);
  assert.deepEqual([projected.completed, projected.total], [1, 1]);
  assert.deepEqual(
    projected.issues.slice(1).map((issue) => [issue.id, issue.titleKey]),
    [
      ['blocker:future_server_blocker', 'pilot.issues.other'],
      ['blocker:required_media_missing', 'pilot.issues.media'],
      ['blocker:presentation_missing', 'pilot.issues.presentation']
    ]
  );
  const selectedId = reconcilePreparationIssue(projected.issues, null);
  assert.equal(selectedId, 'blocker:future_server_blocker');
  const selected = projected.issues.find((issue) => issue.id === selectedId);
  assert.equal(actions(current, { issue: selected })[0].id, 'preparation-open');
  assert.equal(
    actions(current).some((action) => action.id === 'preparation-approve'),
    false
  );
});

test('selection stays unresolved, then advances after the selected control is completed', () => {
  const projected = projectPreparationPilot(receipt());
  assert.equal(
    reconcilePreparationIssue(projected.issues, 'check:moderation_review'),
    'check:moderation_review'
  );
  assert.equal(
    reconcilePreparationIssue(projected.issues, 'check:payment_confirmed'),
    'check:accepted_offer'
  );
  assert.equal(
    reconcilePreparationIssue(projected.issues, 'removed-issue'),
    'check:accepted_offer'
  );
  assert.equal(
    reconcilePreparationIssue(
      projected.issues.map((issue) => ({ ...issue, completed: true })),
      'check:accepted_offer'
    ),
    null
  );
});

test('delayed contexts are rejected after changing issue, dossier or exact version', () => {
  const current = receipt();
  const requested = preparationControllerContext(
    current,
    'check:accepted_offer'
  );
  assert.equal(matchesPreparationControllerContext(requested, requested), true);
  for (const context of [
    preparationControllerContext(current, 'check:content_prepared'),
    preparationControllerContext(
      { ...current, contributionId: 'other' },
      'check:accepted_offer'
    ),
    preparationControllerContext(
      { ...current, version: 'b'.repeat(64) },
      'check:accepted_offer'
    ),
    null
  ]) {
    assert.equal(
      matchesPreparationControllerContext(context, requested),
      false
    );
  }
  assert.equal(preparationControllerContext(current, null).key, 'preparation');
  assert.equal(preparationControllerContext(null, null), null);
});

test('opening an issue only offers navigation and rejects unsafe destinations', () => {
  const current = receipt();
  const issue = projectPreparationPilot(current).issues[1];
  const [primary] = actions(current, { issue });
  assert.equal(primary.id, 'preparation-open');
  assert.equal(primary.enabled, true);
  assert.equal(primary.requiresConfirmation, false);
  assert.equal(primary.label, 'pilot.actions.agreement');
  assert.equal('execute' in primary, false);
  for (const invalid of [
    'https://example.com/admin',
    '//example.com',
    '/api/admin/sponsorships',
    '/admin/fundraiser/../access'
  ]) {
    assert.equal(
      actions(current, { issue: { ...issue, adminUrl: invalid } })[0].enabled,
      false,
      invalid
    );
    const projected = projectPreparationPilot(
      receipt({
        blockers: [{ code: 'commitment_needs_confirmation', adminUrl: invalid }]
      })
    );
    assert.equal(projected.issues[1].adminUrl, null);
  }
});

test('contextual actions never duplicate preparation approval, including a ready server receipt', () => {
  const ready = receipt({ status: 'ready', canApprove: true });
  for (const current of [receipt(), ready, { ...ready, status: 'approved' }]) {
    assert.equal(
      actions(current).some((action) => action.id === 'preparation-approve'),
      false
    );
    assert.equal(
      actions(current).some((action) => action.requiresConfirmation),
      false
    );
  }
  assert.equal(
    actions(ready, { busy: true }).every((action) => !action.enabled),
    true
  );
  assert.equal(
    actions(null).every((action) => !action.enabled),
    true
  );
  assert.deepEqual(
    actions(ready).map((action) => action.id),
    ['preparation-details', 'preparation-history', 'preparation-back']
  );
});

test('the host owns agreement details while a Guide handoff only offers navigation to Campaigns', () => {
  const current = receipt();
  const omitted = actions(current, { detailsMode: 'hidden' });
  assert.equal(
    omitted.some((action) =>
      ['preparation-details', 'preparation-campaigns'].includes(action.id)
    ),
    false
  );
  const redirected = actions(current, { detailsMode: 'campaigns' });
  assert.equal(
    redirected.some((action) => action.id === 'preparation-details'),
    false
  );
  const handoff = redirected.find(
    (action) => action.id === 'preparation-campaigns'
  );
  assert.equal(handoff.enabled, true);
  assert.equal(handoff.label, 'pilot.actions.campaigns');
  assert.equal(handoff.shortcut.label, 'X');
  assert.equal(handoff.requiresConfirmation, false);
  assert.equal('execute' in handoff, false);
  assert.equal(
    actions(current, { detailsMode: 'campaigns', busy: true }).find(
      (action) => action.id === 'preparation-campaigns'
    ).enabled,
    false
  );
  assert.equal(
    actions(null, { detailsMode: 'campaigns' }).find(
      (action) => action.id === 'preparation-campaigns'
    ).enabled,
    false
  );
  const issue = projectPreparationPilot(current).issues.find(
    (entry) => entry.checkCode === 'accepted_offer'
  );
  const assisted = actions(current, {
    detailsMode: 'campaigns',
    issue,
    canAssist: true,
    assistanceSummary: assistance()
  });
  assert.equal(
    assisted.find((action) => action.id === 'preparation-campaigns').shortcut,
    undefined
  );
  assert.equal(
    assisted.find((action) => action.id === 'preparation-assistance-source')
      .shortcut.label,
    'X'
  );
});

test('issue navigation opens the existing form matching the reported blocker', () => {
  const issue = projectPreparationPilot(receipt()).issues.find(
    (entry) => entry.checkCode === 'content_prepared'
  );
  for (const [actionKind, summaryCodes, tab, anchor] of [
    ['agreement', [], 'publication', 'dossier-agreement'],
    ['moderation', [], 'overview', 'dossier-review'],
    ['presentation', ['presentation_missing'], 'identity', 'dossier-identity'],
    ['presentation', ['company_missing'], 'identity', 'dossier-identity'],
    ['presentation', ['required_media_missing'], 'media', 'dossier-media'],
    [
      'presentation',
      ['website_draft_missing'],
      'publication',
      'dossier-publication'
    ],
    [
      'presentation',
      ['website_draft_outdated'],
      'publication',
      'dossier-publication'
    ],
    [
      'presentation',
      ['publication_draft_missing'],
      'publication',
      'dossier-publication'
    ],
    [
      'presentation',
      ['publication_draft_incomplete'],
      'publication',
      'dossier-publication'
    ],
    ['inspect', ['required_media_missing'], 'media', 'dossier-media'],
    ['inspect', ['sponsor_review_required'], 'overview', 'dossier-review'],
    [
      'inspect',
      ['commitment_needs_confirmation'],
      'publication',
      'dossier-agreement'
    ]
  ]) {
    const result = preparationIssueDestination({
      ...issue,
      actionKind,
      summaryCodes,
      adminUrl: adminUrl + '&tab=overview&view=compact#previous'
    });
    const destination = new URL(result, 'https://admin.invalid');
    assert.equal(destination.pathname, '/admin/fundraiser/sponsors');
    assert.equal(destination.searchParams.get('sponsorshipId'), contributionId);
    assert.equal(destination.searchParams.get('view'), 'compact');
    assert.equal(
      destination.searchParams.get('tab'),
      tab,
      summaryCodes.join(',')
    );
    assert.equal(destination.hash, '#' + anchor);
  }
});

test('draft navigation wins for mixed content causes and never defaults all content to identity', () => {
  const issue = projectPreparationPilot(receipt()).issues.find(
    (entry) => entry.checkCode === 'content_prepared'
  );
  const mixed = preparationIssueDestination({
    ...issue,
    summaryCodes: [
      'presentation_missing',
      'required_media_missing',
      'publication_draft_missing'
    ]
  });
  assert.equal(
    new URL(mixed, 'https://admin.invalid').searchParams.get('tab'),
    'publication'
  );
  assert.equal(
    new URL(mixed, 'https://admin.invalid').hash,
    '#dossier-publication'
  );
  assert.equal(
    preparationIssueDestination({ ...issue, summaryCodes: [] }),
    adminUrl
  );
  assert.equal(
    preparationIssueDestination({
      ...issue,
      summaryCodes: ['future_server_blocker']
    }),
    adminUrl
  );
});

test('navigation preserves safe non-dossier links and rejects unsafe or absent links', () => {
  const issue = projectPreparationPilot(receipt()).issues[1];
  const draftUrl =
    '/admin/fundraiser/publications/drafts?sponsorshipId=' +
    contributionId +
    '&draftId=synthetic#draft';
  assert.equal(
    preparationIssueDestination({ ...issue, adminUrl: draftUrl }),
    draftUrl
  );
  for (const invalid of [
    null,
    'https://example.com/admin',
    '//example.com',
    '/api/admin/sponsorships',
    '/admin/fundraiser/../access'
  ]) {
    assert.equal(
      preparationIssueDestination({ ...issue, adminUrl: invalid }),
      null,
      invalid
    );
  }
});
