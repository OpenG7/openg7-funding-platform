import assert from 'node:assert/strict';
import test from 'node:test';

import { PreparationAssistanceController } from '../dist/apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-assistance.controller.js';

const id = '10000000-0000-4000-8000-000000009101';
const source = {
  id: 'synthetic-source',
  version: 1,
  title: 'Synthetic agreement',
  text: 'Facebook',
  fingerprint: 'synthetic-fingerprint',
  createdAt: '2026-10-17T12:00:00Z'
};
const resolution = (note = '') => ({
  itemId: 'clause-1',
  disposition: 'unresolved',
  benefitId: null,
  note
});
const state = () => ({
  contributionId: id,
  reference: 'SYNTHETIC-9101',
  revision: 'state-1',
  source,
  commitment: {
    version: 1,
    state: 'needs_confirmation',
    amountMinor: 50000,
    currency: 'CAD'
  },
  stale: false,
  capabilities: {
    canManageSource: true,
    canRun: true,
    canReview: true,
    canApply: true
  },
  run: {
    id: 'synthetic-run',
    sourceVersion: 1,
    commitmentVersion: 1,
    adapter: 'local_rules_v1',
    state: 'succeeded',
    phase: 'finished',
    errorCode: null,
    createdAt: source.createdAt,
    finishedAt: source.createdAt,
    suggestion: {
      adapter: 'local_rules_v1',
      proposedOffer: null,
      limitations: ['no_contractual_terms_inferred'],
      items: [
        {
          id: 'clause-1',
          citation: {
            sourceId: source.id,
            sourceVersion: 1,
            start: 0,
            end: 8,
            excerpt: 'Facebook'
          },
          channels: ['facebook'],
          attention: 'human_mapping_required'
        }
      ]
    },
    review: null,
    application: null
  }
});

async function fixture(t, initial = state()) {
  const f = {
    state: structuredClone(initial),
    identity: 'owner-session-1',
    permitted: true,
    gate: null,
    failure: null,
    readError: null,
    runGate: null,
    runResult: null,
    calls: [],
    changes: []
  };
  const c = new PreparationAssistanceController({
    admin: {
      async getPreparationAssistance() {
        const snapshot = structuredClone(f.state);
        if (f.gate) await f.gate;
        if (f.readError) throw f.readError;
        return snapshot;
      },
      async savePreparationAssistanceSource(request) {
        f.calls.push({ kind: 'source', request: structuredClone(request) });
        if (f.failure) throw f.failure;
        f.state = {
          ...f.state,
          revision: 'source-updated',
          source: {
            ...source,
            title: request.title,
            text: request.text,
            version: (request.expectedSourceVersion ?? 0) + 1
          }
        };
        return structuredClone(f.state);
      },
      async startPreparationAssistanceRun(request) {
        f.calls.push({ kind: 'run', request });
        if (f.runGate) await f.runGate;
        if (f.failure) throw f.failure;
        return structuredClone(f.runResult ?? f.state);
      },
      async reviewPreparationAssistance(request) {
        f.calls.push({ kind: 'review', request: structuredClone(request) });
        f.state = {
          ...f.state,
          revision: 'review-updated',
          run: {
            ...f.state.run,
            review: {
              ...request.draft,
              version: request.expectedReviewVersion + 1,
              decision: request.decision === 'save' ? 'saved' : 'rejected',
              actor: 'synthetic-owner',
              createdAt: source.createdAt
            }
          }
        };
        return structuredClone(f.state);
      }
    },
    identity: () => f.identity,
    permitted: () => f.permitted,
    visible: () => false,
    changed: (selection) => f.changes.push(selection),
    invalidated() {
      f.changes.push(null);
    },
    unauthorized() {
      f.permitted = false;
    }
  });
  t.after(() => c.dispose());
  c.select(id);
  await c.load();
  return { ...f, c, f };
}

test('a concurrent source version preserves the original human draft and requires an explicit reset before another save', async (t) => {
  const { c, f } = await fixture(t);
  c.setSource('text', 'My unsaved contractual text');
  f.state = {
    ...f.state,
    source: { ...source, version: 2, text: 'A colleague source' },
    revision: 'source-2'
  };
  await c.load();
  assert.equal(c.text(), 'My unsaved contractual text');
  assert.equal(c.sourceConflict(), true);
  await c.saveSource();
  assert.equal(f.calls.length, 0);
  c.resetSourceDraft();
  assert.equal(c.text(), 'A colleague source');
  c.setSource('text', 'Reviewed against current version');
  await c.saveSource();
  assert.equal(f.calls[0].request.expectedSourceVersion, 2);
});

test('a concurrent review preserves local resolutions and does not silently bind them to the new review version', async (t) => {
  const { c, f } = await fixture(t);
  c.resolve('clause-1', { note: 'My unsaved human note' });
  const remote = {
    ...resolution('Colleague explanation'),
    disposition: 'excluded'
  };
  f.state = {
    ...f.state,
    revision: 'review-1',
    run: {
      ...f.state.run,
      review: {
        version: 1,
        decision: 'saved',
        offer: null,
        items: [remote],
        reason: 'Reviewed by a colleague',
        actor: 'another-owner',
        createdAt: source.createdAt
      }
    }
  };
  await c.load();
  assert.equal(c.reviewConflict(), true);
  assert.equal(c.items()[0].note, 'My unsaved human note');
  await c.review('save', {
    offer: null,
    items: c.items(),
    reason: 'My reason'
  });
  assert.equal(f.calls.length, 0);
  c.resetReviewDraft();
  assert.deepEqual(c.items(), [remote]);
  c.resolve('clause-1', { note: 'Explicitly revised colleague draft' });
  await c.review('save', {
    offer: null,
    items: c.items(),
    reason: 'New human review reason'
  });
  assert.equal(f.calls[0].request.expectedReviewVersion, 1);
});

test('an uncertain source command is reread without replay and an explicit identical retry keeps the same request id', async (t) => {
  const { c, f } = await fixture(t);
  c.setSource('text', 'Explicit edit');
  f.failure = { status: 503 };
  await c.saveSource();
  assert.equal(f.calls.length, 1);
  assert.equal(c.error(), 'uncertain');
  assert.equal(c.sourceDirty(), true);
  f.failure = null;
  await c.saveSource();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].request.requestId, f.calls[1].request.requestId);
});

test('an uncertain reanalysis observed by an immediate or later read retires its old UUID before a new explicit run', async (t) => {
  for (const delayedRead of [false, true]) {
    const { c, f } = await fixture(t);
    f.failure = { status: 503 };
    f.readError = delayedRead ? { status: 503 } : null;
    f.state = {
      ...f.state,
      revision: 'new-local-run-observed',
      run: { ...f.state.run, id: 'synthetic-run-2' }
    };
    await c.analyze();
    assert.equal(f.calls.length, 1);
    if (delayedRead) {
      f.readError = null;
      await c.load();
    }
    assert.equal(c.data().run.id, 'synthetic-run-2');
    f.failure = null;
    await c.analyze();
    assert.equal(f.calls.length, 2);
    assert.notEqual(f.calls[0].request.requestId, f.calls[1].request.requestId);
  }
  const { c, f } = await fixture(t);
  f.failure = { status: 503 };
  await c.analyze();
  f.failure = null;
  await c.analyze();
  assert.equal(f.calls[0].request.requestId, f.calls[1].request.requestId);
});

test('an external revision during a full-form command is reread after its response without replaying that command', async (t) => {
  const { c, f } = await fixture(t);
  let release;
  f.runGate = new Promise((resolve) => (release = resolve));
  f.runResult = {
    ...state(),
    revision: 'older-command-response',
    run: { ...state().run, id: 'synthetic-run-2' }
  };
  const running = c.analyze();
  f.state = {
    ...state(),
    revision: 'new-external-revision',
    run: { ...state().run, id: 'synthetic-run-3' }
  };
  c.select(id, 'external-revision-2');
  assert.equal(f.calls.length, 1);
  release();
  await running;
  assert.equal(c.data().revision, 'new-external-revision');
  assert.equal(c.data().run.id, 'synthetic-run-3');
  assert.equal(f.calls.length, 1);
});

test('a full-form GET retained before an external revision cannot replace the newer source or erase a human draft', async (t) => {
  const { c, f } = await fixture(t);
  c.setSource('text', 'My private unsaved source draft');
  let release;
  f.gate = new Promise((resolve) => (release = resolve));
  const previousRead = c.load();
  f.gate = null;
  f.state = {
    ...state(),
    revision: 'source-2',
    source: {
      ...source,
      version: 2,
      text: 'A colleague saved this current source'
    }
  };
  c.select(id, 'external-revision-2');
  await c.load();
  release();
  await previousRead;
  assert.equal(c.data().source.version, 2);
  assert.equal(c.text(), 'My private unsaved source draft');
  assert.equal(c.sourceConflict(), true);
  assert.equal(f.calls.length, 0);
});

test('a pending read cannot restore private source text after the session is replaced or revoked', async (t) => {
  const { c, f } = await fixture(t);
  let release;
  f.gate = new Promise((resolve) => {
    release = resolve;
  });
  const pending = c.load();
  f.identity = 'revoked-session';
  f.permitted = false;
  c.select(id);
  release();
  await pending;
  assert.equal(c.data(), null);
  assert.equal(c.text(), '');
  assert.deepEqual(c.items(), []);
  assert.equal(f.calls.length, 0);
});

test('a queued job gaining its proposal initializes resolutions without marking the business control complete', async (t) => {
  const initial = state();
  initial.run = {
    ...initial.run,
    state: 'queued',
    phase: 'queued',
    suggestion: null
  };
  const { c, f } = await fixture(t, initial);
  assert.deepEqual(c.items(), []);
  f.state = state();
  await c.load();
  assert.deepEqual(c.items(), [resolution()]);
  assert.equal(c.data().commitment.state, 'needs_confirmation');
  assert.equal(f.calls.length, 0);
});
