import assert from 'node:assert/strict';
import test from 'node:test';

import { projectMediaApprovalAvailability as project } from '../dist/apps/funding-web/src/app/features/funding/models/admin-media-approval-availability.js';

const asset = (overrides = {}) => ({
  reviewStatus: 'pending_review',
  altText: 'Synthetic scene',
  websiteSelected: false,
  usage: { state: 'confirmed' },
  readiness: {
    state: 'needs_review',
    reasons: ['MEDIA_HUMAN_REVIEW_REQUIRED']
  },
  ...overrides
});
const awaiting = (overrides = {}) =>
  asset({
    usage: { state: 'needs_confirmation' },
    readiness: {
      state: 'blocked',
      reasons: ['MEDIA_USAGE_CONFIRMATION_REQUIRED']
    },
    ...overrides
  });

test('a missing or legacy inventory cannot establish zero media eligible for approval', () => {
  for (const assets of [
    null,
    [asset({ readiness: undefined })],
    [asset({ usage: undefined })]
  ]) {
    const result = project(assets);
    assert.equal(result.eligibleCount, null);
    assert.equal(result.allAwaitingConsent, false);
  }
  assert.equal(project([]).pendingCount, 0);
  assert.equal(project([]).allAwaitingConsent, false);
});

test('consent waiting and descriptions still to prepare coexist even when readiness hides missing alt', () => {
  const result = project([awaiting({ altText: '   ' }), awaiting()]);
  assert.equal(result.pendingCount, 2);
  assert.equal(result.eligibleCount, 0);
  assert.equal(result.consentRequiredCount, 2);
  assert.equal(result.missingAltCount, 1);
  assert.equal(result.allAwaitingConsent, true);
});

test('a mixed dossier retains its approval opportunity for confirmed media needing human review', () => {
  const result = project([
    awaiting(),
    asset({
      usage: { state: 'confirmed', restrictions: 'Keep attribution' },
      usageRestrictionsReviewed: false
    }),
    asset({ reviewStatus: 'approved' }),
    asset({ reviewStatus: 'rejected' })
  ]);
  assert.equal(result.pendingCount, 2);
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.allAwaitingConsent, false);
  assert.equal(result.consentRequiredCount, 1);
});

test('withdrawal, technical failure and moderation restrictions are separate from waiting for first consent', () => {
  for (const extra of [
    asset({
      usage: { state: 'withdrawn' },
      readiness: { state: 'blocked', reasons: ['MEDIA_USAGE_WITHDRAWN'] }
    }),
    awaiting({
      readiness: {
        state: 'blocked',
        reasons: ['MEDIA_USAGE_CONFIRMATION_REQUIRED', 'MEDIA_INVALID']
      }
    }),
    awaiting({
      readiness: {
        state: 'blocked',
        reasons: ['MEDIA_USAGE_CONFIRMATION_REQUIRED', 'MODERATION_RESTRICTED']
      }
    })
  ]) {
    const result = project([awaiting(), extra]);
    assert.equal(result.eligibleCount, 0);
    assert.equal(result.allAwaitingConsent, false);
  }
  assert.equal(
    project([asset({ usage: { state: 'withdrawn' } })]).withdrawnCount,
    1
  );
});

test('recorded consent returns approval only after a persisted description is available', () => {
  assert.equal(project([awaiting({ altText: null })]).eligibleCount, 0);
  assert.equal(project([asset({ altText: null })]).eligibleCount, 0);
  assert.equal(project([asset()]).eligibleCount, 1);
});

test('bulk approval never reactivates selected website media and does not require a platform consent receipt', () => {
  const result = project([
    asset({ websiteSelected: true }),
    asset({ usageAcceptance: undefined })
  ]);
  assert.equal(result.pendingCount, 2);
  assert.equal(result.eligibleCount, 1);
});
