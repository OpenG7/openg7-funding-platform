/** Synthetic evidence for orchestration tests; it never contacts a moderation API. */
export const moderationDecision = (subject, level, initial = {}) => ({
  requestId: '00000000-0000-4000-8000-000000000001',
  policyVersion: '1.0',
  contentVersion: 3,
  contentFingerprint: 'a'.repeat(64),
  level,
  confirmation: subject.id,
  expectedDecisionId: undefined,
  ...(level === 'N0'
    ? {}
    : {
        primaryReason: level === 'N1' ? 'MISLEADING_CLAIM' : 'HATE_TARGETED',
        secondaryReasons: [],
        internalReason:
          initial.internalReason?.trim() || 'Synthetic private rationale',
        sponsorExplanation:
          initial.sponsorExplanation?.trim() || 'Synthetic external explanation'
      })
});
