import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectPreparationPilot,
  reconcilePreparationIssue
} from '../dist/apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-pilot.projection.js';
import {
  matchesPreparationControllerContext,
  preparationContextActions,
  preparationControllerContext
} from '../dist/apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-context-actions.js';
import { preparationIssueDestination } from '../dist/apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-navigation.js';

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
const actions = (current, changes = {}) =>
  preparationContextActions({
    receipt: current,
    issue: null,
    canApprove: true,
    busy: false,
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
    actions(current).find((action) => action.id === 'preparation-approve')
      .enabled,
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
  const [primary] = actions(current, { issue, canApprove: false });
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

test('approval requires host and server permission, is disabled while busy and absent once approved', () => {
  const ready = receipt({ status: 'ready', canApprove: true });
  const enabled = actions(ready).find(
    (action) => action.id === 'preparation-approve'
  );
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.requiresConfirmation, true);
  assert.equal(actions(ready, { canApprove: false })[0].enabled, false);
  assert.equal(actions({ ...ready, canApprove: false })[0].enabled, false);
  assert.equal(
    actions(ready, { busy: true }).every((action) => !action.enabled),
    true
  );
  assert.equal(
    actions({ ...ready, status: 'approved' }).some(
      (action) => action.id === 'preparation-approve'
    ),
    false
  );
  assert.equal(
    actions(null).every((action) => !action.enabled),
    true
  );
  assert.deepEqual(
    actions(ready)
      .slice(1)
      .map((action) => action.id),
    ['preparation-details', 'preparation-history', 'preparation-back']
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
