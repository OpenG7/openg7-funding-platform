import {
  MODERATION_REASON_CODES,
  type ModerationReasonCode,
  type ModerationSubject
} from './moderation.js';

export const MODERATION_ASSISTANCE_VERSION = 'openg7-contextual-signals-1';
export interface ModerationEvidenceSpan {
  readonly start: number;
  readonly end: number;
  readonly reasonCode: ModerationReasonCode;
  readonly explanation: string;
}
export interface ModerationAssistanceResult {
  readonly subject: ModerationSubject;
  readonly contentVersion: number;
  readonly contentFingerprint: string;
  readonly analyzerVersion: string;
  readonly disposition: 'human_review_required' | 'abstain';
  readonly evidence: readonly ModerationEvidenceSpan[];
  readonly limitations: readonly string[];
}
/** Suggestions are data, never approvals, refusals, commands or legal conclusions. */
export function suggestTextModeration(input: {
  readonly subject: ModerationSubject;
  readonly contentVersion: number;
  readonly contentFingerprint: string;
  readonly text: string;
}): ModerationAssistanceResult {
  const limitations = [
    'HUMAN_CONTEXT_REQUIRED',
    'NO_AUTOMATIC_DECISION',
    'NOT_EXHAUSTIVE'
  ];
  const base = {
    subject: input.subject,
    contentVersion: input.contentVersion,
    contentFingerprint: input.contentFingerprint,
    analyzerVersion: MODERATION_ASSISTANCE_VERSION
  };
  if (input.text.length > 12000)
    return {
      ...base,
      disposition: 'abstain',
      evidence: [],
      limitations: [...limitations, 'TEXT_LIMIT_EXCEEDED']
    };
  if (
    /\b(citation|citons|dénonc\w*|condamn\w*|critique|satire|parodie|fiction|quote\w*|denounc\w*|condemn\w*|satirical)\b/iu.test(
      input.text
    )
  )
    return {
      ...base,
      disposition: 'abstain',
      evidence: [],
      limitations: [...limitations, 'CONTEXT_MAY_REVERSE_MEANING']
    };
  const rules: readonly {
    code: ModerationReasonCode;
    pattern: RegExp;
    explanation: string;
  }[] = [
    {
      code: 'VIOLENCE_INCITEMENT',
      pattern:
        /\b(tuez|tuons|massacrez|exterminez|kill them|attack them|murder them)\b/giu,
      explanation: 'Explicit action language requires contextual human review.'
    },
    {
      code: 'THREAT',
      pattern:
        /\b(je vais (?:vous|te|les) tuer|nous allons (?:vous|les) tuer|i will kill you|we will kill you)\b/giu,
      explanation: 'Potential threat language requires contextual human review.'
    },
    {
      code: 'DEHUMANIZATION',
      pattern:
        /\b(sous[- ]humains?|subhumans?|unworthy of human rights|indignes? de droits fondamentaux)\b/giu,
      explanation:
        'Potential denial of human dignity requires contextual human review.'
    }
  ];
  const evidence: ModerationEvidenceSpan[] = [];
  for (const rule of rules) {
    for (const match of input.text.matchAll(rule.pattern)) {
      if (evidence.length >= 20) break;
      evidence.push({
        start: match.index,
        end: match.index + match[0].length,
        reasonCode: rule.code,
        explanation: rule.explanation
      });
    }
  }
  return {
    ...base,
    disposition: evidence.length ? 'human_review_required' : 'abstain',
    evidence,
    limitations
  };
}
/** Validate adapter output before it reaches a reviewer; never accept instructions. */
export function validateModerationAssistance(
  result: unknown,
  expected: {
    readonly subject: ModerationSubject;
    readonly contentVersion: number;
    readonly contentFingerprint: string;
    readonly textLength: number;
  }
): result is ModerationAssistanceResult {
  if (!result || typeof result !== 'object' || Array.isArray(result))
    return false;
  const allowedKeys = [
    'subject',
    'contentVersion',
    'contentFingerprint',
    'analyzerVersion',
    'disposition',
    'evidence',
    'limitations'
  ];
  if (Object.keys(result).some((key) => !allowedKeys.includes(key)))
    return false;
  const input = result as ModerationAssistanceResult;
  return (
    !!input.subject &&
    typeof input.subject === 'object' &&
    !Array.isArray(input.subject) &&
    Object.keys(input.subject).every((key) => ['type', 'id'].includes(key)) &&
    input.subject?.type === expected.subject.type &&
    input.subject?.id === expected.subject.id &&
    input.contentVersion === expected.contentVersion &&
    input.contentFingerprint === expected.contentFingerprint &&
    typeof input.analyzerVersion === 'string' &&
    input.analyzerVersion.length > 0 &&
    input.analyzerVersion.length <= 100 &&
    ['human_review_required', 'abstain'].includes(input.disposition) &&
    Array.isArray(input.evidence) &&
    input.evidence.length <= 20 &&
    input.evidence.every(
      (span) =>
        !!span &&
        typeof span === 'object' &&
        !Array.isArray(span) &&
        Object.keys(span).every((key) =>
          ['start', 'end', 'reasonCode', 'explanation'].includes(key)
        ) &&
        Number.isSafeInteger(span.start) &&
        Number.isSafeInteger(span.end) &&
        span.start >= 0 &&
        span.end > span.start &&
        span.end <= expected.textLength &&
        MODERATION_REASON_CODES.includes(span.reasonCode) &&
        typeof span.explanation === 'string' &&
        span.explanation.length <= 500
    ) &&
    Array.isArray(input.limitations) &&
    input.limitations.length <= 20 &&
    input.limitations.every(
      (value) => typeof value === 'string' && value.length <= 200
    ) &&
    (input.disposition === 'abstain'
      ? input.evidence.length === 0
      : input.evidence.length > 0)
  );
}
