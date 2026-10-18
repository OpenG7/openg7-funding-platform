import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifySponsorMedia,
  resolveSponsorMediaRules
} from '../dist/packages/funding-core/src/sponsor-media-review.js';

const rights = {
  state: 'confirmed',
  channels: ['website'],
  targets: ['openg7'],
  transformations: ['technical'],
  credit: null,
  restrictions: null
};
const candidate = {
  usage: rights,
  reviewStatus: 'pending_review',
  altText: 'Synthetic mountain landscape',
  technicalValid: true,
  humanReviewed: true
};

test('a ready review candidate grants neither media approval nor publication rights', () => {
  const before = structuredClone(candidate);
  assert.deepEqual(classifySponsorMedia(candidate), {
    state: 'ready',
    reasons: []
  });
  assert.deepEqual(candidate, before);
  assert.equal(candidate.reviewStatus, 'pending_review');
  assert.deepEqual(candidate.usage.channels, ['website']);
});

test('unknown and withdrawn rights cannot be inferred from successful analysis', () => {
  for (const usage of [
    undefined,
    { ...rights, state: 'needs_confirmation' },
    { ...rights, state: 'withdrawn' }
  ]) {
    const result = classifySponsorMedia({
      ...candidate,
      usage,
      analysis: 'complete'
    });
    assert.equal(result.state, 'blocked');
    assert.match(result.reasons[0], /MEDIA_USAGE_/);
  }
  for (const usage of [
    { ...rights, channels: [] },
    { ...rights, targets: [] },
    { ...rights, transformations: [] }
  ])
    assert.equal(
      classifySponsorMedia({ ...candidate, usage }).state,
      'blocked'
    );
});

test('missing analysis remains an exception and supports an explicit manual review', () => {
  for (const analysis of [undefined, 'unavailable', 'uncertain', 'failed']) {
    const result = classifySponsorMedia({
      ...candidate,
      humanReviewed: false,
      analysis
    });
    assert.equal(result.state, 'needs_review');
    assert.equal(
      classifySponsorMedia({ ...candidate, analysis }).state,
      'ready'
    );
  }
});

test('unresolved restrictions, missing alt text and adverse moderation do not disappear in a batch', () => {
  assert.equal(
    classifySponsorMedia({
      ...candidate,
      usage: {
        ...rights,
        restrictions: 'Human permission required for identifiable participants'
      }
    }).state,
    'needs_review'
  );
  assert.equal(
    classifySponsorMedia({ ...candidate, altText: '  ' }).state,
    'needs_review'
  );
  for (const moderationState of [
    'correction_requested',
    'on_hold',
    'rejected',
    'removed',
    'pending_independent_review'
  ])
    assert.equal(
      classifySponsorMedia({ ...candidate, moderationState }).state,
      'blocked'
    );
  assert.equal(
    classifySponsorMedia({ ...candidate, reviewStatus: 'rejected' }).state,
    'blocked'
  );
  assert.equal(
    classifySponsorMedia({ ...candidate, technicalValid: false }).state,
    'blocked'
  );
});

test('inheritance returns references, preserves explicit empty restrictions and never falls back after withdrawal', () => {
  const dossier = rights;
  const batch = { ...rights, targets: ['openg20'] };
  const own = {
    ...rights,
    state: 'withdrawn',
    channels: [],
    targets: [],
    transformations: []
  };
  assert.deepEqual(
    resolveSponsorMediaRules({ own: null, batch: null, dossier }),
    { source: 'dossier', usage: dossier }
  );
  assert.equal(
    resolveSponsorMediaRules({ own: null, batch, dossier }).usage,
    batch
  );
  const withdrawn = resolveSponsorMediaRules({ own, batch, dossier });
  assert.equal(withdrawn.source, 'media');
  assert.equal(withdrawn.usage, own);
  assert.deepEqual(withdrawn.usage.channels, []);
  assert.deepEqual(
    resolveSponsorMediaRules({ own: null, batch: null, dossier: null }),
    { source: 'dossier', usage: null }
  );
});
