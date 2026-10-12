import assert from 'node:assert/strict';
import test from 'node:test';

import { AdminSponsorshipHistoricalAuditController } from '../dist/apps/funding-web/src/app/features/funding/components/admin-sponsors/admin-sponsorship-historical-audit-controller.js';
import { AdminDashboardRequestError } from '../dist/apps/funding-web/src/app/features/funding/services/funding-admin-session.js';

const contributionId = '10000000-0000-4000-8000-000000000601',
  evidenceId = '10000000-0000-4000-8000-000000000602';
const item = {
  evidenceId,
  obligationId: 'synthetic-obligation',
  contributionId,
  benefitId: 'website_mention',
  channel: 'website',
  target: 'openg7',
  deliveredAt: '2026-10-01T00:00:00.000Z',
  durationDays: 30,
  requirements: [],
  findings: ['duration_unverified'],
  reviewVersion: 0,
  latestReview: null
};
const data = {
  items: [item],
  pageSize: 25,
  nextCursor: 'synthetic-cursor',
  asOf: '2026-10-12T00:00:00.000Z',
  totals: {
    evidence: 150,
    filtered: 1,
    unreviewed: 100,
    durationUnverified: 50,
    requiredElementMissing: 30,
    snapshotIncomplete: 20,
    noIssueDetected: 50
  }
};
function fixture() {
  const state = {
    id: contributionId,
    owner: true,
    destroyed: false,
    failure: null,
    result: undefined,
    readResult: undefined,
    queries: [],
    commands: [],
    redirects: 0,
    nonces: 0
  };
  const c = new AdminSponsorshipHistoricalAuditController({
    contributionId: () => state.id,
    canOwn: () => state.owner,
    destroyed: () => state.destroyed,
    requestId: () =>
      `10000000-0000-4000-8000-${String(++state.nonces).padStart(12, '0')}`,
    preview: async (query) => {
      state.queries.push(query);
      return structuredClone(state.readResult ?? data);
    },
    review: async (command) => {
      state.commands.push(structuredClone(command));
      if (state.failure) throw state.failure;
      if (state.result !== undefined) return state.result;
      return {
        evidenceId,
        reviewVersion: command.expectedVersion + 1,
        review: {
          id: '10000000-0000-4000-8000-000000000604',
          conclusion: command.conclusion,
          reviewedAt: '2026-10-12T00:00:00.000Z'
        }
      };
    },
    unauthorized: async () => {
      state.redirects++;
    }
  });
  c.select();
  return { c, state };
}
function prepare(c) {
  c.choose(item);
  c.reason.set('Synthetic private review reason');
  c.confirmation.set(true);
}
test('owner inventory scopes the dossier while retaining full global counts and stable cursor', async () => {
  const { c, state } = fixture();
  await c.load();
  assert.deepEqual(state.queries[0], { pageSize: 25, contributionId });
  assert.equal(c.data().totals.evidence, 150);
  c.global.set(true);
  c.filter.set('duration_unverified');
  await c.load('synthetic-cursor');
  assert.deepEqual(state.queries[1], {
    pageSize: 25,
    finding: 'duration_unverified',
    cursor: 'synthetic-cursor'
  });
  state.owner = false;
  await c.load();
  prepare(c);
  await c.submit();
  assert.equal(state.queries.length, 2);
  assert.equal(state.commands.length, 0);
});
test('confirmation and reason are required; a server receipt updates only the review', async () => {
  const { c, state } = fixture();
  await c.load();
  c.choose(item);
  await c.submit();
  assert.equal(state.commands.length, 0);
  c.reason.set('Synthetic review');
  await c.submit();
  assert.equal(state.commands.length, 0);
  c.confirmation.set(true);
  await c.submit();
  assert.equal(state.commands.length, 1);
  assert.equal(state.commands[0].confirmation, evidenceId);
  assert.equal(c.saved(), true);
  assert.equal(c.pending(), null);
  assert.equal(c.data().items[0].reviewVersion, 1);
  assert.deepEqual(c.data().items[0].findings, ['duration_unverified']);
  assert.equal(c.data().totals.unreviewed, 99);
});
test('uncertain response locks payload and retries its original UUID, version and reason', async () => {
  const { c, state } = fixture();
  await c.load();
  prepare(c);
  state.failure = new TypeError('Synthetic lost response');
  await c.submit();
  assert.ok(c.pending());
  c.reason.set('Edited after lost response');
  await c.submit();
  assert.equal(state.commands.length, 1);
  state.failure = null;
  await c.retry();
  assert.deepEqual(state.commands[0], state.commands[1]);
  assert.equal(state.nonces, 1);
  assert.equal(c.pending(), null);
  assert.equal(c.saved(), true);
});
test('definite version conflict allows refreshed evidence and a fresh command', async () => {
  const { c, state } = fixture();
  await c.load();
  prepare(c);
  state.failure = new AdminDashboardRequestError(
    409,
    'Conflict',
    'HISTORICAL_AUDIT_VERSION_CONFLICT'
  );
  await c.submit();
  assert.equal(c.pending(), null);
  assert.equal(c.selected(), null);
  assert.equal(c.error(), 'conflict');
  await c.load();
  c.choose({ ...item, reviewVersion: 1 });
  c.reason.set('Re-examined current version');
  c.confirmation.set(true);
  state.failure = null;
  await c.submit();
  assert.equal(state.nonces, 2);
  assert.equal(state.commands[1].expectedVersion, 1);
  assert.notEqual(state.commands[0].requestId, state.commands[1].requestId);
});
test('uncertain review survives dossier navigation and never belongs to another dossier', async () => {
  const { c, state } = fixture();
  await c.load();
  prepare(c);
  state.failure = new TypeError('Synthetic lost response');
  await c.submit();
  const pending = c.pending();
  state.id = '10000000-0000-4000-8000-000000000603';
  c.select();
  assert.equal(c.pending(), null);
  state.id = contributionId;
  c.select();
  assert.deepEqual(c.pending(), pending);
  state.failure = null;
  await c.retry();
  assert.equal(c.saved(), true);
});
test('replaying an older receipt preserves a newer observed review and its global counts', async () => {
  const { c, state } = fixture();
  await c.load();
  prepare(c);
  state.failure = new TypeError(
    'Synthetic lost acknowledgement of version one'
  );
  await c.submit();
  const original = c.pending();
  const currentReview = {
    id: '10000000-0000-4000-8000-000000000605',
    conclusion: 'follow_up_required',
    reviewedAt: '2026-10-12T01:00:00.000Z'
  };
  state.readResult = {
    ...data,
    items: [{ ...item, reviewVersion: 2, latestReview: currentReview }],
    totals: { ...data.totals, unreviewed: 99 }
  };
  await c.load();
  assert.equal(c.pending(), original);
  state.failure = null;
  await c.retry();
  assert.deepEqual(state.commands[1], original);
  assert.equal(c.saved(), true);
  assert.equal(c.pending(), null);
  assert.equal(c.data().items[0].reviewVersion, 2);
  assert.deepEqual(c.data().items[0].latestReview, currentReview);
  assert.equal(c.data().totals.unreviewed, 99);
});
test('expired session retains the exact review while following shared authentication handling', async () => {
  const { c, state } = fixture();
  prepare(c);
  state.failure = new AdminDashboardRequestError(401);
  await c.submit();
  assert.equal(state.redirects, 1);
  const pending = c.pending();
  assert.deepEqual(pending, state.commands[0]);
  assert.equal(c.saved(), false);
  state.failure = null;
  await c.retry();
  assert.deepEqual(state.commands[1], pending);
  assert.equal(c.saved(), true);
});

test('request conflicts and unrecognised 409 replies retain the captured UUID for reconciliation', async () => {
  for (const code of [
    'HISTORICAL_AUDIT_REQUEST_CONFLICT',
    'UNKNOWN_CONFLICT',
    undefined
  ]) {
    const { c, state } = fixture();
    await c.load();
    prepare(c);
    state.failure = new AdminDashboardRequestError(
      409,
      'Synthetic conflict',
      code
    );
    await c.submit();
    const pending = c.pending();
    assert.deepEqual(pending, state.commands[0]);
    assert.equal(c.saved(), false);
    assert.equal(c.error(), 'reviewUnavailable');
    state.failure = null;
    await c.retry();
    assert.deepEqual(state.commands[1], pending);
    assert.equal(state.nonces, 1);
  }
});

test('HTTP success with a wrong or incomplete review receipt remains uncertain', async () => {
  const valid = {
    evidenceId,
    reviewVersion: 1,
    review: {
      id: '10000000-0000-4000-8000-000000000604',
      conclusion: 'inconclusive',
      reviewedAt: '2026-10-12T00:00:00.000Z'
    }
  };
  for (const receipt of [
    null,
    {},
    { ...valid, evidenceId: contributionId },
    { ...valid, reviewVersion: 0 },
    { ...valid, reviewVersion: 2 },
    { ...valid, reviewVersion: 1.5 },
    { ...valid, review: null },
    { ...valid, review: { ...valid.review, id: 'invalid-review' } },
    { ...valid, review: { ...valid.review, conclusion: 'confirmed' } },
    { ...valid, review: { ...valid.review, reviewedAt: 'invalid-date' } }
  ]) {
    const { c, state } = fixture();
    await c.load();
    prepare(c);
    state.result = receipt;
    await c.submit();
    const pending = c.pending();
    assert.ok(pending);
    assert.equal(c.saved(), false);
    assert.equal(c.data().items[0].reviewVersion, 0);
    assert.equal(c.data().totals.unreviewed, 100);
    assert.equal(c.error(), 'reviewUnavailable');
    state.result = undefined;
    await c.retry();
    assert.deepEqual(state.commands[1], pending);
    assert.equal(c.saved(), true);
    assert.equal(state.nonces, 1);
  }
});
