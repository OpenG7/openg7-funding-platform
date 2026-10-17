import assert from 'node:assert/strict';
import test from 'node:test';

import {
  matchesControllerContext,
  pilotageControllerActions,
  pilotageControllerContext,
  pilotageDeckActions
} from '../dist/apps/funding-web/src/app/features/funding/pages/admin-pilotage-page/pilotage-controller-actions.js';

const decision = {
  id: 'decision-1',
  targetId: 'sponsor-1',
  version: 'version-1',
  actions: [
    { id: 'sponsor.approve', blocked: null },
    { id: 'sponsor.reject', blocked: null }
  ]
};
const input = (overrides = {}) => ({
  decision,
  primary: decision.actions[0],
  reject: decision.actions[1],
  editable: undefined,
  blocked: false,
  busy: false,
  bindings: null,
  labels: {
    accept: 'Accept',
    reject: 'Reject',
    edit: 'Edit',
    details: 'Details',
    unavailable: 'Unavailable'
  },
  blockedReason: 'Read only',
  explain: (code) => `Reason: ${code}`,
  ...overrides
});

test('reader, stale or uncertain decisions retain inspection while every mutation stays disabled', () => {
  const actions = pilotageControllerActions(input({ blocked: true }));
  assert.deepEqual(
    actions.filter((a) => a.enabled).map((a) => a.id),
    ['pilot-details']
  );
  assert.ok(
    actions.filter((a) => a.requiresConfirmation).every((a) => !a.enabled)
  );
  assert.ok(
    actions
      .filter((a) => a.id !== 'pilot-details')
      .every((a) => a.disabledReason === 'Read only')
  );
  for (const state of [{ busy: true }, { decision: null }]) {
    assert.ok(pilotageControllerActions(input(state)).every((a) => !a.enabled));
  }
});

test('server blocked actions cannot be enabled by a controller profile or another available action', () => {
  const actions = pilotageControllerActions(
    input({
      primary: { id: 'sponsor.approve', blocked: 'VERSION_CONFLICT' },
      bindings: { primary: 2, secondary: 0, edit: 1, details: 3 }
    })
  );
  assert.equal(actions[0].enabled, false);
  assert.equal(actions[0].disabledReason, 'Reason: VERSION_CONFLICT');
  assert.equal(actions[0].shortcut.label, 'X');
  assert.equal(actions[1].enabled, true);
  assert.equal(actions[1].shortcut.label, 'A');
  assert.equal(actions[2].enabled, false);
  assert.equal(actions[2].shortcut.label, 'B');
});

test('a delayed intention is rejected after changing decision, target or content revision', () => {
  const snapshot = pilotageControllerContext(decision);
  assert.equal(
    matchesControllerContext(
      pilotageControllerContext({ ...decision }),
      snapshot
    ),
    true
  );
  for (const change of [
    { id: 'decision-2' },
    { targetId: 'sponsor-2' },
    { version: 'version-2' }
  ]) {
    assert.equal(
      matchesControllerContext(
        pilotageControllerContext({ ...decision, ...change }),
        snapshot
      ),
      false
    );
  }
  assert.equal(matchesControllerContext(null, snapshot), false);
  assert.equal(pilotageControllerContext(null), null);
});

test('workspace navigation remains available without a decision; dossier actions need one', () => {
  const navigation = {
    decision: null,
    busy: false,
    canNavigate: false,
    hasFollowing: false,
    labels: {
      home: 'Home',
      previous: 'Previous',
      next: 'Next',
      record: 'Record',
      queue: 'Queue',
      diagnostics: 'Controller'
    }
  };
  const actions = pilotageDeckActions(navigation);
  assert.deepEqual(
    actions.filter((a) => a.enabled).map((a) => a.id),
    ['pilot-home', 'pilot-diagnostics']
  );
  assert.ok(
    actions.filter((a) => a.scope === 'selection').every((a) => !a.enabled)
  );
  assert.ok(
    actions.every((a) => a.zone === 'bottom' && !a.requiresConfirmation)
  );
  assert.ok(
    pilotageDeckActions({ ...navigation, busy: true }).every((a) => !a.enabled)
  );
  const available = pilotageDeckActions({
    ...navigation,
    decision: { ...decision, detailsUrl: '/admin/fundraiser/sponsors' },
    canNavigate: true,
    hasFollowing: true
  });
  assert.ok(available.every((a) => a.enabled));
  assert.equal(
    available.find((a) => a.id === 'pilot-previous').shortcut.label,
    'LB'
  );
  assert.equal(
    available.find((a) => a.id === 'pilot-next').shortcut.label,
    'RB'
  );
  assert.equal(
    available.find((a) => a.id === 'pilot-open-record').shortcut,
    undefined
  );
});
