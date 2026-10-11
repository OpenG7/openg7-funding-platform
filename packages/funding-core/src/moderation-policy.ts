import {
  MODERATION_LEVELS,
  MODERATION_POLICY_VERSION,
  MODERATION_REASON_CODES,
  MODERATION_SUBJECT_TYPES,
  type ModerationCaseState,
  type ModerationDecisionInput,
  type ModerationDecisionRecord,
  type ModerationLevel,
  type ModerationReasonCode,
  type ModerationSubject,
  type PublicModerationDecision
} from './moderation-contracts.js';
import {
  MODERATION_EDITORIAL_PROVISIONS,
  MODERATION_REASONS
} from './moderation-catalogue.js';

export const MODERATION_POLICY = {
  version: MODERATION_POLICY_VERSION,
  editorialStatus: 'approved',
  publicCharterStatus: 'proposed',
  contextualReview: true,
  independentReviewLevels: ['N4'] as readonly ModerationLevel[]
} as const;

export const publicModerationDecision = (
  decision: ModerationDecisionRecord
): PublicModerationDecision => ({
  id: decision.id,
  subject: decision.subject,
  contentVersion: decision.contentVersion,
  policyVersion: decision.policyVersion,
  level: decision.level,
  primaryReason: decision.primaryReason,
  secondaryReasons: decision.secondaryReasons,
  sponsorExplanation: decision.sponsorExplanation,
  createdAt: decision.createdAt,
  state: decision.state
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isModerationSubject(
  value: unknown
): value is ModerationSubject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as ModerationSubject;
  return (
    MODERATION_SUBJECT_TYPES.includes(input.type) &&
    typeof input.id === 'string' &&
    uuid.test(input.id)
  );
}
export function validateModerationDecision(
  subject: ModerationSubject,
  value: unknown
): string | null {
  if (
    !isModerationSubject(subject) ||
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  )
    return 'INVALID_MODERATION_DECISION';
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'requestId',
          'policyVersion',
          'contentFingerprint',
          'contentVersion',
          'level',
          'primaryReason',
          'secondaryReasons',
          'editorialProvision',
          'internalReason',
          'sponsorExplanation',
          'confirmation',
          'expectedDecisionId'
        ].includes(key)
    )
  )
    return 'INVALID_MODERATION_DECISION';
  const input = value as ModerationDecisionInput;
  if (
    typeof input.requestId !== 'string' ||
    !uuid.test(input.requestId) ||
    !Number.isSafeInteger(input.contentVersion) ||
    input.contentVersion < 1 ||
    typeof input.contentFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.contentFingerprint) ||
    !MODERATION_LEVELS.includes(input.level)
  )
    return 'INVALID_MODERATION_DECISION';
  if (input.confirmation !== subject.id) return 'CONFIRMATION_REQUIRED';
  if (input.policyVersion !== MODERATION_POLICY_VERSION)
    return 'MODERATION_POLICY_UNAVAILABLE';
  if (
    input.expectedDecisionId != null &&
    (typeof input.expectedDecisionId !== 'string' ||
      !uuid.test(input.expectedDecisionId))
  )
    return 'INVALID_MODERATION_DECISION';
  if (input.level === 'N4' && subject.type !== 'sponsorship')
    return 'MODERATION_SCOPE_INVALID';
  if (input.level === 'N3' && subject.type === 'sponsorship')
    return 'MODERATION_SCOPE_INVALID';
  if (
    input.level === 'N0' &&
    (input.primaryReason != null || (input.secondaryReasons?.length ?? 0) > 0)
  )
    return 'MODERATION_REASON_INVALID';
  if (
    input.level !== 'N0' &&
    !MODERATION_REASON_CODES.includes(
      input.primaryReason as ModerationReasonCode
    )
  )
    return 'MODERATION_REASON_REQUIRED';
  if (
    input.secondaryReasons != null &&
    (!Array.isArray(input.secondaryReasons) ||
      input.secondaryReasons.length > 16 ||
      new Set(input.secondaryReasons).size !== input.secondaryReasons.length ||
      input.secondaryReasons.some(
        (code) =>
          !MODERATION_REASON_CODES.includes(code) ||
          code === input.primaryReason
      ))
  )
    return 'MODERATION_REASON_INVALID';
  if (
    input.level !== 'N0' &&
    [input.primaryReason, ...(input.secondaryReasons ?? [])].some(
      (code) =>
        !MODERATION_REASONS.find(
          (reason) => reason.code === code
        )?.allowedLevels.includes(input.level)
    )
  )
    return 'MODERATION_LEVEL_INCOMPATIBLE';
  if (
    [input.primaryReason, ...(input.secondaryReasons ?? [])].includes(
      'EDITORIAL_INCOMPATIBILITY'
    ) &&
    !MODERATION_EDITORIAL_PROVISIONS.some(
      (provision) => provision.id === input.editorialProvision
    )
  )
    return 'MODERATION_PROVISION_REQUIRED';
  for (const text of [input.internalReason, input.sponsorExplanation]) {
    if (text != null && (typeof text !== 'string' || text.trim().length > 2000))
      return 'INVALID_MODERATION_DECISION';
  }
  if (
    input.editorialProvision != null &&
    (typeof input.editorialProvision !== 'string' ||
      input.editorialProvision.length > 200)
  )
    return 'INVALID_MODERATION_DECISION';
  if (
    input.level !== 'N0' &&
    (!input.internalReason?.trim() || !input.sponsorExplanation?.trim())
  )
    return 'MODERATION_EXPLANATION_REQUIRED';
  return null;
}
export function requiresIndependentModerationReview(
  input: Pick<
    ModerationDecisionInput,
    'level' | 'primaryReason' | 'secondaryReasons'
  >
): boolean {
  return (
    input.level === 'N4' ||
    (input.level === 'N5' &&
      [input.primaryReason, ...(input.secondaryReasons ?? [])].some((code) =>
        [
          'HATE_TARGETED',
          'DEHUMANIZATION',
          'THREAT',
          'VIOLENCE_INCITEMENT',
          'VIOLENCE_GLORIFICATION',
          'EXPLOITATION',
          'PRIVACY_VIOLATION',
          'FRAUD_IMPERSONATION',
          'ILLEGAL_CONTENT'
        ].includes(code ?? '')
      ))
  );
}
export function moderationCaseState(
  level: ModerationLevel,
  independentPending = false
): ModerationCaseState {
  if (independentPending) return 'pending_independent_review';
  return (
    {
      N0: 'approved',
      N1: 'correction_requested',
      N2: 'on_hold',
      N3: 'rejected',
      N4: 'rejected',
      N5: 'removed'
    } as const
  )[level];
}
