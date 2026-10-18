import assert from 'node:assert/strict';
import test from 'node:test';

import { preparationAssistanceActions } from '../dist/packages/funding-core/src/preparation-assistance-summary.js';

const base = () => ({
  contributionId: '10000000-0000-4000-8000-000000000901',
  controlCode: 'accepted_offer',
  revision: 'synthetic-summary',
  sourceVersion: 1,
  commitmentVersion: 1,
  stale: false,
  run: {
    id: 'synthetic-run',
    sourceVersion: 1,
    commitmentVersion: 1,
    adapter: 'local_rules_v1',
    state: 'succeeded',
    phase: 'finished',
    errorCode: null,
    reviewVersion: 0,
    reviewDecision: null,
    clauseCount: 3,
    unsupportedCount: 1,
    unresolvedCount: 3,
    appliedCommitmentVersion: null
  },
  capabilities: {
    canManageSource: true,
    canRun: true,
    canReview: true,
    canApply: true
  }
});
const actions = (summary, options = {}) =>
  preparationAssistanceActions(summary, {
    permitted: true,
    busy: false,
    ...options
  });
const action = (values, id) => values.find((value) => value.id === id);

test('current authority and availability gate every assistance action independently of cached capabilities', () => {
  for (const [summary, options] of [
    [null, {}],
    [base(), { permitted: false }],
    [base(), { busy: true }]
  ]) {
    const projected = actions(summary, options);
    assert.equal(projected.length, 3);
    assert.ok(
      projected.every(
        (value) => !value.enabled && value.disabledReason === 'unavailable'
      )
    );
  }
});

test('viewing a source or a historical result does not imply permission to edit or apply it', () => {
  for (const decision of [null, 'saved', 'accepted', 'rejected']) {
    const summary = base();
    summary.stale = true;
    summary.run.reviewDecision = decision;
    summary.capabilities = {
      canManageSource: false,
      canRun: false,
      canReview: false,
      canApply: false
    };
    const projected = actions(summary);
    assert.equal(action(projected, 'review').enabled, true);
    assert.equal(action(projected, 'source').enabled, true);
    assert.equal(action(projected, 'rerun').enabled, false);
    assert.equal(action(projected, 'rerun').disabledReason, 'not_eligible');
  }
});

test('queued and processing jobs cannot be duplicated by a contextual rerun', () => {
  for (const state of ['queued', 'processing']) {
    const summary = base();
    summary.run.state = state;
    const projected = actions(summary);
    assert.equal(action(projected, 'review').enabled, false);
    assert.equal(action(projected, 'source').enabled, true);
    assert.equal(action(projected, 'rerun').enabled, false);
    assert.equal(action(projected, 'rerun').disabledReason, 'running');
  }
});

test('a terminal failure or an older source without a job keeps an explicit manual rerun available', () => {
  for (const state of ['failed', 'cancelled', null]) {
    const summary = base();
    if (state === null) summary.run = null;
    else summary.run.state = state;
    const projected = actions(summary);
    assert.equal(action(projected, 'review').enabled, false);
    assert.equal(action(projected, 'source').enabled, true);
    assert.equal(action(projected, 'rerun').enabled, true);
  }
  const missing = { ...base(), sourceVersion: null, run: null };
  assert.ok(actions(missing).every((value) => !value.enabled));
  assert.equal(action(actions(missing), 'rerun').disabledReason, 'no_source');
});

test('the registry is a pure projection and never grants business approval from suggestion counts', () => {
  const summary = base();
  const before = structuredClone(summary);
  const projected = actions(summary);
  assert.deepEqual(
    projected.map(({ id }) => id),
    ['review', 'source', 'rerun']
  );
  assert.deepEqual(summary, before);
  const resolved = structuredClone(summary);
  resolved.run.unresolvedCount = 0;
  resolved.run.unsupportedCount = 0;
  assert.deepEqual(actions(resolved), projected);
  assert.ok(
    projected.every(
      (value) => !['apply', 'approve', 'publish', 'refund'].includes(value.id)
    )
  );
});
