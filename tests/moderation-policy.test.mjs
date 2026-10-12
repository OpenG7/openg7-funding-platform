import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MODERATION_POLICY,
  MODERATION_REASON_CODES,
  MODERATION_REASONS,
  moderationCaseState,
  publicModerationDecision,
  requiresIndependentModerationReview,
  validateModerationDecision
} from '../dist/packages/funding-core/src/index.js';

const id = '00000000-0000-4000-8000-000000000001';
const subject = { type: 'publication_delivery', id };
const approval = {
  requestId: id,
  policyVersion: '1.0',
  contentFingerprint: 'a'.repeat(64),
  contentVersion: 1,
  level: 'N0',
  confirmation: id
};
const reject = (code = 'HATE_TARGETED') => ({
  ...approval,
  level: 'N3',
  primaryReason: code,
  internalReason: 'Synthetic internal review evidence.',
  sponsorExplanation: 'This element requires revision.'
});

test('the editorial catalogue is complete in both languages and public terms remain proposed', () => {
  assert.equal(MODERATION_REASON_CODES.length, 17);
  assert.equal(new Set(MODERATION_REASON_CODES).size, 17);
  assert.equal(MODERATION_REASONS.length, 17);
  assert.equal(MODERATION_POLICY.publicCharterStatus, 'proposed');
  for (const reason of MODERATION_REASONS) {
    assert.ok(
      reason.label.fr &&
        reason.label.en &&
        reason.definition.fr &&
        reason.definition.en
    );
    assert.equal(
      validateModerationDecision(subject, reject(reason.code)),
      reason.code === 'EDITORIAL_INCOMPATIBILITY'
        ? 'MODERATION_PROVISION_REQUIRED'
        : null
    );
  }
});
test('human approval is possible without a reason code, including contextual criticism or quotation', () => {
  assert.equal(validateModerationDecision(subject, approval), null);
  assert.equal(
    validateModerationDecision(subject, {
      ...approval,
      primaryReason: 'HATE_TARGETED'
    }),
    'MODERATION_REASON_INVALID'
  );
});
test('unknown codes, missing reasons, version, confirmation and external explanation fail closed', () => {
  assert.equal(
    validateModerationDecision(subject, {
      ...approval,
      actor: 'client-selected-reviewer'
    }),
    'INVALID_MODERATION_DECISION'
  );
  assert.equal(
    validateModerationDecision(subject, {
      ...reject(),
      primaryReason: 'UNKNOWN'
    }),
    'MODERATION_REASON_REQUIRED'
  );
  assert.equal(
    validateModerationDecision(subject, { ...reject(), primaryReason: null }),
    'MODERATION_REASON_REQUIRED'
  );
  assert.equal(
    validateModerationDecision(subject, {
      ...approval,
      contentVersion: undefined
    }),
    'INVALID_MODERATION_DECISION'
  );
  assert.equal(
    validateModerationDecision(subject, { ...approval, policyVersion: '0.9' }),
    'MODERATION_POLICY_UNAVAILABLE'
  );
  assert.equal(
    validateModerationDecision(subject, { ...approval, confirmation: '' }),
    'CONFIRMATION_REQUIRED'
  );
  assert.equal(
    validateModerationDecision(subject, {
      ...reject(),
      sponsorExplanation: ' '
    }),
    'MODERATION_EXPLANATION_REQUIRED'
  );
  assert.equal(
    validateModerationDecision(subject, { ...reject(), internalReason: ' ' }),
    'MODERATION_EXPLANATION_REQUIRED'
  );
  assert.equal(
    validateModerationDecision(subject, {
      ...reject(),
      secondaryReasons: ['THREAT', 'THREAT']
    }),
    'MODERATION_REASON_INVALID'
  );
  assert.equal(
    validateModerationDecision(subject, {
      ...reject(),
      secondaryReasons: ['UNKNOWN']
    }),
    'MODERATION_REASON_INVALID'
  );
  assert.equal(
    validateModerationDecision(subject, { ...reject(), level: 'N1' }),
    'MODERATION_LEVEL_INCOMPATIBLE'
  );
});
test('a precise approved provision is mandatory for editorial incompatibility', () => {
  assert.equal(
    validateModerationDecision(subject, {
      ...reject('EDITORIAL_INCOMPATIBILITY'),
      editorialProvision: 'something vague'
    }),
    'MODERATION_PROVISION_REQUIRED'
  );
  assert.equal(
    validateModerationDecision(subject, {
      ...reject('EDITORIAL_INCOMPATIBILITY'),
      editorialProvision: 'recognition-scope'
    }),
    null
  );
  assert.equal(
    validateModerationDecision(subject, {
      ...reject(),
      secondaryReasons: ['EDITORIAL_INCOMPATIBILITY']
    }),
    'MODERATION_PROVISION_REQUIRED'
  );
});
test('refusing an element does not refuse a dossier and serious decisions require independent review', () => {
  assert.equal(
    validateModerationDecision({ type: 'sponsorship', id }, reject()),
    'MODERATION_SCOPE_INVALID'
  );
  assert.equal(
    validateModerationDecision(subject, { ...reject(), level: 'N4' }),
    'MODERATION_SCOPE_INVALID'
  );
  assert.equal(requiresIndependentModerationReview({ level: 'N4' }), true);
  assert.equal(
    requiresIndependentModerationReview({
      level: 'N5',
      primaryReason: 'VIOLENCE_GLORIFICATION'
    }),
    true
  );
  assert.equal(
    requiresIndependentModerationReview({
      level: 'N5',
      primaryReason: 'IP_RIGHTS'
    }),
    false
  );
  assert.equal(moderationCaseState('N4', true), 'pending_independent_review');
  assert.equal(moderationCaseState('N1'), 'correction_requested');
});
test('the sponsor projection never contains confidential notes, identities or fingerprints', () => {
  const projected = publicModerationDecision({
    ...reject(),
    id,
    subject,
    policyVersion: '1.0',
    contentVersion: 1,
    state: 'active',
    createdAt: '2026-10-11T12:00:00.000Z',
    actor: 'admin:private',
    editorialProvision: 'private evidence',
    independentReviewer: 'admin:second-private',
    contentFingerprint: 'a'.repeat(64),
    internalReason: 'PRIVATE_INTERNAL_SYNTHETIC'
  });
  const serialized = JSON.stringify(projected);
  assert.equal(projected.sponsorExplanation, 'This element requires revision.');
  for (const privateField of [
    'internalReason',
    'actor',
    'independentReviewer',
    'contentFingerprint',
    'editorialProvision',
    'PRIVATE_INTERNAL_SYNTHETIC'
  ])
    assert.ok(!serialized.includes(privateField));
});
