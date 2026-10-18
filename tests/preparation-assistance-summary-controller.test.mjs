import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const hook = registerHooks({
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
const { PreparationAssistanceSummaryController } =
  await import('../dist/apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-assistance-summary.controller.js');
hook.deregister();

const id = '10000000-0000-4000-8000-000000009201';
const summary = () => ({
  contributionId: id,
  controlCode: 'accepted_offer',
  revision: 'source1-run1-review0',
  sourceVersion: 1,
  commitmentVersion: 1,
  stale: false,
  capabilities: {
    canManageSource: true,
    canRun: true,
    canReview: true,
    canApply: false
  },
  run: {
    id: 'synthetic-run-1',
    sourceVersion: 1,
    commitmentVersion: 1,
    adapter: 'local_rules_v1',
    state: 'succeeded',
    phase: 'finished',
    errorCode: null,
    reviewVersion: 0,
    reviewDecision: null,
    clauseCount: 1,
    unsupportedCount: 0,
    unresolvedCount: 1,
    appliedCommitmentVersion: null
  }
});
async function fixture(t) {
  const f = {
    state: summary(),
    identity: 'owner-session-1',
    permitted: true,
    reads: [],
    commands: [],
    readGate: null,
    runGate: null,
    runResult: null,
    readError: null,
    runError: null
  };
  const c = new PreparationAssistanceSummaryController({
    admin: {
      async getPreparationAssistanceSummary(contributionId) {
        f.reads.push(contributionId);
        const snapshot = structuredClone(f.state),
          gate = f.readGate;
        if (gate) await gate;
        if (f.readError) throw f.readError;
        return snapshot;
      },
      async rerunPreparationAssistanceSummary(request) {
        f.commands.push(structuredClone(request));
        if (f.runGate) await f.runGate;
        if (f.runError) throw f.runError;
        return structuredClone(f.runResult ?? f.state);
      }
    },
    identity: () => f.identity,
    permitted: () => f.permitted,
    visible: () => false,
    unauthorized() {
      f.permitted = false;
    }
  });
  t.after(() => c.dispose());
  c.select(id, '1');
  await c.load();
  f.reads = [];
  return { c, f };
}

test('a newer external revision during a retained rerun is reread after the command without replaying it', async (t) => {
  const { c, f } = await fixture(t);
  let release;
  f.runGate = new Promise((resolve) => (release = resolve));
  f.runResult = {
    ...summary(),
    revision: 'old-source-queued',
    run: {
      ...summary().run,
      id: 'synthetic-run-2',
      state: 'queued',
      phase: 'queued'
    }
  };
  const rerunning = c.rerun(c.data().revision);
  assert.equal(f.commands.length, 1);
  f.state = {
    ...summary(),
    sourceVersion: 2,
    revision: 'source2-run3-review0',
    run: { ...summary().run, id: 'synthetic-run-3', sourceVersion: 2 }
  };
  c.select(id, '2');
  assert.equal(f.reads.length, 0);
  release();
  await rerunning;
  assert.equal(c.data().revision, 'source2-run3-review0');
  assert.equal(f.commands.length, 1);
  assert.equal(f.commands[0].sourceVersion, 1);
  assert.deepEqual(f.reads, [id]);
});

test('an explicit refresh during rerun is deferred even when its external revision key does not change', async (t) => {
  const { c, f } = await fixture(t);
  let release;
  f.runGate = new Promise((resolve) => (release = resolve));
  f.runResult = summary();
  const rerunning = c.rerun(c.data().revision);
  f.state = {
    ...summary(),
    revision: 'concurrent-human-review',
    run: { ...summary().run, reviewVersion: 2, reviewDecision: 'saved' }
  };
  await c.load();
  assert.equal(f.reads.length, 0);
  release();
  await rerunning;
  assert.equal(c.data().revision, 'concurrent-human-review');
  assert.equal(f.reads.length, 1);
  assert.equal(f.commands.length, 1);
});

test('a delayed GET cannot restore a summary superseded by a newer external revision', async (t) => {
  const { c, f } = await fixture(t);
  let release;
  f.readGate = new Promise((resolve) => (release = resolve));
  const oldRead = c.load();
  f.readGate = null;
  f.state = {
    ...summary(),
    revision: 'human-review-2',
    run: { ...summary().run, reviewVersion: 2, reviewDecision: 'saved' }
  };
  c.select(id, '2');
  await c.load();
  release();
  await oldRead;
  assert.equal(c.data().revision, 'human-review-2');
  assert.equal(c.data().run.reviewVersion, 2);
  assert.equal(f.commands.length, 0);
});

test('an uncertain rerun reads facts without replay and retains its UUID for an explicit identical retry', async (t) => {
  const { c, f } = await fixture(t);
  f.runError = { status: 503 };
  await c.rerun(c.data().revision);
  assert.equal(c.error(), 'uncertain');
  assert.equal(f.commands.length, 1);
  assert.equal(f.reads.length, 1);
  f.runError = null;
  await c.rerun(c.data().revision);
  assert.equal(f.commands.length, 2);
  assert.equal(f.commands[0].requestId, f.commands[1].requestId);
});

test('a rerun observed after an uncertain response is reconciled and a later new explicit run gets a new UUID', async (t) => {
  const { c, f } = await fixture(t);
  f.runError = { status: 503 };
  f.state = {
    ...summary(),
    revision: 'new-run-observed',
    run: { ...summary().run, id: 'synthetic-run-2' }
  };
  await c.rerun(c.data().revision);
  assert.equal(c.data().run.id, 'synthetic-run-2');
  f.runError = null;
  await c.rerun(c.data().revision);
  assert.equal(f.commands.length, 2);
  assert.notEqual(f.commands[0].requestId, f.commands[1].requestId);
});

test('a later manual read reconciles an uncertain command after the immediate verification also failed', async (t) => {
  const { c, f } = await fixture(t);
  f.runError = { status: 503 };
  f.readError = { status: 503 };
  await c.rerun(c.data().revision);
  assert.equal(c.data(), null);
  const firstRequest = f.commands[0].requestId;
  f.readError = null;
  f.state = {
    ...summary(),
    revision: 'run-discovered-later',
    run: { ...summary().run, id: 'synthetic-run-2' }
  };
  await c.load();
  f.runError = null;
  await c.rerun(c.data().revision);
  assert.equal(f.commands.length, 2);
  assert.notEqual(f.commands[1].requestId, firstRequest);
});

test('a forbidden or unavailable read clears the old summary instead of exposing cached actions', async (t) => {
  const { c, f } = await fixture(t);
  for (const status of [503, 403]) {
    f.readError = { status };
    await c.load();
    assert.equal(c.data(), null);
    assert.equal(c.error(), status === 403 ? 'forbidden' : 'unavailable');
    await c.rerun('old-revision');
    assert.equal(f.commands.length, 0);
  }
});

test('deselection or a replacement session invalidates pending compact reads and never issues a job', async (t) => {
  const { c, f } = await fixture(t);
  let release;
  f.readGate = new Promise((resolve) => (release = resolve));
  const reading = c.load();
  f.identity = 'operator-session';
  f.permitted = false;
  c.select('');
  release();
  await reading;
  assert.equal(c.data(), null);
  assert.equal(f.commands.length, 0);
  const count = f.reads.length;
  c.select(id);
  await c.load();
  assert.equal(f.reads.length, count);
});
