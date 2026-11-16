import assert from 'node:assert/strict';
import test from 'node:test';

import { publicationWarningCodes } from '../dist/apps/funding-web/src/app/features/funding/models/admin-publication-warning-presentation.js';

test('the recorded website prerequisites become three distinct actionable explanations', () => {
  const codes = [
    'review',
    'media',
    'sponsor_review_required',
    'moderation_review_required',
    'presentation_missing',
    'obligation_blocked',
    'publication_blocked',
    'review_pending_review'
  ];
  assert.deepEqual(
    publicationWarningCodes(codes, {
      reviewPending: true,
      channel: 'website'
    }),
    ['review_and_moderation', 'media', 'presentation_missing']
  );
});

test('known administrative review aliases describe one pending decision', () => {
  assert.deepEqual(
    publicationWarningCodes([
      'sponsor_review_required',
      'review_pending',
      'review',
      'review_pending_review',
      'sponsor_review_required'
    ]),
    ['review']
  );
});

test('a missing public text and a missing or ineligible photo remain separate prerequisites', () => {
  assert.deepEqual(
    publicationWarningCodes([
      'media_missing',
      'public_presentation',
      'required_media_missing',
      'presentation_missing',
      'media'
    ]),
    ['media', 'presentation_missing']
  );
  assert.deepEqual(publicationWarningCodes(['public_presentation']), [
    'presentation_missing'
  ]);
  assert.deepEqual(publicationWarningCodes(['required_media_missing']), [
    'media'
  ]);
});

test('a pending website review can combine its common dossier moderation prerequisite', () => {
  assert.deepEqual(
    publicationWarningCodes(
      ['review_pending_review', 'moderation_review_required'],
      { reviewPending: true, channel: 'website' }
    ),
    ['review_and_moderation']
  );
});

test('moderation remains explicit after the administrative decision is already approved', () => {
  for (const context of [
    { reviewPending: false, channel: 'website' },
    { reviewPending: false, channel: 'facebook', hasIndependentDraft: false },
    { channel: 'website' },
    {}
  ]) {
    assert.deepEqual(
      publicationWarningCodes(
        ['review', 'moderation_review_required'],
        context
      ),
      ['review', 'moderation_review_required']
    );
    assert.deepEqual(
      publicationWarningCodes(['moderation_review_required'], context),
      ['moderation_review_required']
    );
  }
});

test('a moderation prerequisite alone does not invent a pending dossier decision', () => {
  assert.deepEqual(
    publicationWarningCodes(['moderation_review_required'], {
      reviewPending: true,
      channel: 'website'
    }),
    ['moderation_review_required']
  );
});

test('a social draft keeps its independent moderation even while dossier approval is pending', () => {
  for (const channel of ['facebook', 'linkedin']) {
    assert.deepEqual(
      publicationWarningCodes(
        ['sponsor_review_required', 'moderation_review_required'],
        { reviewPending: true, channel, hasIndependentDraft: true }
      ),
      ['review', 'moderation_review_required']
    );
    assert.deepEqual(
      publicationWarningCodes(
        ['sponsor_review_required', 'moderation_review_required'],
        { reviewPending: true, channel }
      ),
      ['review', 'moderation_review_required']
    );
  }
});

test('social prerequisites combine only when independent draft absence is explicit', () => {
  for (const channel of ['facebook', 'linkedin', undefined])
    assert.deepEqual(
      publicationWarningCodes(
        ['review_pending', 'moderation_review_required', 'media'],
        { reviewPending: true, channel, hasIndependentDraft: false }
      ),
      ['review_and_moderation', 'media']
    );
});

test('generic blocked summaries are replaced by existing precise prerequisites', () => {
  assert.deepEqual(
    publicationWarningCodes([
      'obligation_blocked',
      'review_pending_review',
      'publication_blocked',
      'required_media_missing',
      'public_presentation'
    ]),
    ['review', 'media', 'presentation_missing']
  );
});

test('blocked summaries alone retain one explanation with publication taking precedence', () => {
  assert.deepEqual(publicationWarningCodes(['obligation_blocked']), [
    'obligation_blocked'
  ]);
  for (const codes of [
    ['publication_blocked'],
    ['obligation_blocked', 'publication_blocked'],
    ['publication_blocked', 'obligation_blocked', 'publication_blocked']
  ])
    assert.deepEqual(publicationWarningCodes(codes), ['publication_blocked']);
});

test('unknown codes remain explicit while redundant blocked summaries are removed', () => {
  const codes = Object.freeze([
    'future_guard',
    'obligation_blocked',
    'future_guard',
    'publication_blocked'
  ]);
  assert.deepEqual(publicationWarningCodes(codes), ['future_guard']);
  assert.deepEqual(codes, [
    'future_guard',
    'obligation_blocked',
    'future_guard',
    'publication_blocked'
  ]);
  assert.deepEqual(
    publicationWarningCodes(['future_guard', 'obligation_blocked']),
    ['future_guard']
  );
  assert.deepEqual(
    publicationWarningCodes([
      'future_guard_a',
      'future_guard_b',
      'future_guard_a'
    ]),
    ['future_guard_a', 'future_guard_b']
  );
});

test('precise prerequisites remove generic repetition while retaining unknown independent diagnostics', () => {
  assert.deepEqual(
    publicationWarningCodes([
      'future_guard',
      'obligation_blocked',
      'media_missing',
      'publication_blocked',
      'future_guard',
      'another_guard'
    ]),
    ['future_guard', 'media', 'another_guard']
  );
});

test('deduplication preserves first occurrence order across known aliases and unknown codes', () => {
  assert.deepEqual(
    publicationWarningCodes([
      'first_guard',
      'public_presentation',
      'required_media_missing',
      'first_guard',
      'review_pending',
      'presentation_missing',
      'sponsor_review_required',
      'last_guard',
      'media_missing'
    ]),
    ['first_guard', 'presentation_missing', 'media', 'review', 'last_guard']
  );
});

test('unrecognized review and provider codes are not reclassified as ordinary pending approval', () => {
  assert.deepEqual(
    publicationWarningCodes([
      'review_rejected',
      'MEDIA_NOT_APPROVED',
      'moderation_appeal_open',
      'review_rejected'
    ]),
    ['review_rejected', 'MEDIA_NOT_APPROVED', 'moderation_appeal_open']
  );
});

test('presentation does not mutate frozen source codes or context and remains stable on repeated use', () => {
  const codes = Object.freeze([
    'review_pending_review',
    'media_missing',
    'moderation_review_required',
    'public_presentation',
    'publication_blocked'
  ]);
  const context = Object.freeze({ reviewPending: true, channel: 'website' });
  const result = publicationWarningCodes(codes, context);
  assert.deepEqual(result, [
    'review_and_moderation',
    'media',
    'presentation_missing'
  ]);
  assert.deepEqual(publicationWarningCodes(result, context), result);
  assert.deepEqual(codes, [
    'review_pending_review',
    'media_missing',
    'moderation_review_required',
    'public_presentation',
    'publication_blocked'
  ]);
  assert.deepEqual(context, { reviewPending: true, channel: 'website' });
});

test('an empty warning list never invents a verification or a success state', () => {
  assert.deepEqual(publicationWarningCodes([]), []);
  assert.deepEqual(
    publicationWarningCodes([], { reviewPending: true, channel: 'website' }),
    []
  );
});
