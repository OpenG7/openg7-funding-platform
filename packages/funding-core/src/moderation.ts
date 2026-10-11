/** Editorial policy. Public charter approval is deliberately a separate fact. */
export const MODERATION_POLICY_VERSION = '1.0';
export const MODERATION_LEVELS = ['N0', 'N1', 'N2', 'N3', 'N4', 'N5'] as const;
export type ModerationLevel = (typeof MODERATION_LEVELS)[number];
export const MODERATION_SUBJECT_TYPES = [
  'sponsorship',
  'media',
  'publication_draft',
  'publication_delivery'
] as const;
export type ModerationSubjectType = (typeof MODERATION_SUBJECT_TYPES)[number];
export interface ModerationSubject {
  readonly type: ModerationSubjectType;
  readonly id: string;
}
export const MODERATION_REASON_CODES = [
  'HATE_TARGETED',
  'DEHUMANIZATION',
  'DISCRIMINATION',
  'TARGETED_HARASSMENT',
  'THREAT',
  'VIOLENCE_INCITEMENT',
  'VIOLENCE_GLORIFICATION',
  'EXPLOITATION',
  'SEXUAL_CONTENT',
  'PRIVACY_VIOLATION',
  'FRAUD_IMPERSONATION',
  'MISLEADING_CLAIM',
  'ELECTORAL_ADVERTISING',
  'ILLEGAL_CONTENT',
  'IP_RIGHTS',
  'EXTERNAL_LINK_RISK',
  'EDITORIAL_INCOMPATIBILITY'
] as const;
export type ModerationReasonCode = (typeof MODERATION_REASON_CODES)[number];
type LocalizedText = { readonly fr: string; readonly en: string };
export interface ModerationReason {
  readonly code: ModerationReasonCode;
  readonly label: LocalizedText;
  readonly definition: LocalizedText;
  readonly allowedLevels: readonly ModerationLevel[];
}
const reason = (
  code: ModerationReasonCode,
  fr: string,
  en: string,
  definitionFr: string,
  definitionEn: string
): ModerationReason => ({
  code,
  label: { fr, en },
  definition: { fr: definitionFr, en: definitionEn },
  allowedLevels: [
    'DISCRIMINATION',
    'TARGETED_HARASSMENT',
    'SEXUAL_CONTENT',
    'MISLEADING_CLAIM',
    'IP_RIGHTS',
    'EXTERNAL_LINK_RISK',
    'EDITORIAL_INCOMPATIBILITY'
  ].includes(code)
    ? ['N1', 'N2', 'N3', 'N4', 'N5']
    : ['N2', 'N3', 'N4', 'N5']
});
export const MODERATION_REASONS: readonly ModerationReason[] = [
  reason(
    'HATE_TARGETED',
    'Haine ciblée',
    'Targeted hate',
    'Attaque haineuse liée à une appartenance réelle ou supposée.',
    'Hateful attack related to actual or perceived group membership.'
  ),
  reason(
    'DEHUMANIZATION',
    'Déshumanisation',
    'Dehumanization',
    'Présentation de personnes comme sous-humaines ou indignes de droits fondamentaux.',
    'Portraying people as subhuman or undeserving of fundamental rights.'
  ),
  reason(
    'DISCRIMINATION',
    'Discrimination',
    'Discrimination',
    'Exclusion ou traitement discriminatoire visant des personnes ou des groupes.',
    'Discriminatory exclusion or treatment of people or groups.'
  ),
  reason(
    'TARGETED_HARASSMENT',
    'Harcèlement ciblé',
    'Targeted harassment',
    'Humiliation, intimidation ou harcèlement visant une personne identifiable.',
    'Humiliation, intimidation or harassment directed at an identifiable person.'
  ),
  reason(
    'THREAT',
    'Menace',
    'Threat',
    'Menace explicite ou crédible contre des personnes.',
    'Explicit or credible threat against people.'
  ),
  reason(
    'VIOLENCE_INCITEMENT',
    'Incitation à la violence',
    'Incitement to violence',
    'Appel, encouragement ou instruction de violence.',
    'Calling for, encouraging or instructing violence.'
  ),
  reason(
    'VIOLENCE_GLORIFICATION',
    'Glorification de la violence',
    'Glorification of violence',
    'Valorisation de violences ou de leurs auteurs dans un contexte promotionnel.',
    'Promotional glorification of violence or its perpetrators.'
  ),
  reason(
    'EXPLOITATION',
    'Exploitation',
    'Exploitation',
    'Promotion ou banalisation de formes d’exploitation humaine.',
    'Promoting or normalizing human exploitation.'
  ),
  reason(
    'SEXUAL_CONTENT',
    'Contenu sexuel inapproprié',
    'Inappropriate sexual content',
    'Contenu sexuel incompatible avec le cadre public de reconnaissance.',
    'Sexual content incompatible with the public recognition programme.'
  ),
  reason(
    'PRIVACY_VIOLATION',
    'Atteinte à la vie privée',
    'Privacy violation',
    'Exposition non autorisée de renseignements ou d’images privés.',
    'Unauthorized disclosure of private information or images.'
  ),
  reason(
    'FRAUD_IMPERSONATION',
    'Fraude ou usurpation',
    'Fraud or impersonation',
    'Fausse identité, usurpation ou représentation frauduleuse.',
    'False identity, impersonation or fraudulent representation.'
  ),
  reason(
    'MISLEADING_CLAIM',
    'Allégation trompeuse',
    'Misleading claim',
    'Allégation matériellement trompeuse ou insuffisamment étayée.',
    'Materially misleading or insufficiently supported claim.'
  ),
  reason(
    'ELECTORAL_ADVERTISING',
    'Publicité électorale ou partisane',
    'Electoral or partisan advertising',
    'Publicité électorale ou partisane commanditée exclue du programme.',
    'Sponsored electoral or partisan advertising excluded from the programme.'
  ),
  reason(
    'ILLEGAL_CONTENT',
    'Contenu illicite',
    'Illegal content',
    'Contenu dont la conformité exige un examen motivé et, si nécessaire, spécialisé.',
    'Content requiring a reasoned compliance review and, where needed, specialist review.'
  ),
  reason(
    'IP_RIGHTS',
    'Droits de propriété intellectuelle',
    'Intellectual property rights',
    'Usage non autorisé ou droits non démontrés sur les éléments proposés.',
    'Unauthorized use or unsubstantiated rights in proposed material.'
  ),
  reason(
    'EXTERNAL_LINK_RISK',
    'Risque lié à un lien externe',
    'External link risk',
    'Destination dangereuse, trompeuse ou incompatible avec la reconnaissance.',
    'Unsafe, deceptive or incompatible external destination.'
  ),
  reason(
    'EDITORIAL_INCOMPATIBILITY',
    'Incompatibilité éditoriale précise',
    'Specific editorial incompatibility',
    'Incompatibilité avec une disposition expresse de la politique, identifiée dans la décision.',
    'Incompatibility with an express policy provision identified in the decision.'
  )
];
export const MODERATION_EDITORIAL_PROVISIONS = [
  {
    id: 'recognition-scope',
    label: {
      fr: 'Reconnaissance de la commandite dans le cadre du programme',
      en: 'Sponsorship recognition within the programme scope'
    }
  },
  {
    id: 'nonpartisan-recognition',
    label: {
      fr: 'Exclusion de la publicité électorale ou partisane commanditée',
      en: 'Exclusion of sponsored electoral or partisan advertising'
    }
  },
  {
    id: 'public-safety-and-rights',
    label: {
      fr: 'Respect de la sécurité, de la dignité et des droits dans les contenus publics',
      en: 'Respect for safety, dignity and rights in public content'
    }
  }
] as const;
export const MODERATION_POLICY = {
  version: MODERATION_POLICY_VERSION,
  editorialStatus: 'approved',
  publicCharterStatus: 'proposed',
  contextualReview: true,
  independentReviewLevels: ['N4'] as readonly ModerationLevel[]
} as const;
export interface ModerationDecisionInput {
  readonly requestId: string;
  readonly policyVersion: string;
  readonly contentFingerprint: string;
  readonly contentVersion: number;
  readonly level: ModerationLevel;
  readonly primaryReason?: ModerationReasonCode | null;
  readonly secondaryReasons?: readonly ModerationReasonCode[];
  readonly editorialProvision?: string | null;
  readonly internalReason?: string | null;
  readonly sponsorExplanation?: string | null;
  readonly confirmation: string;
  readonly expectedDecisionId?: string | null;
}
export type ModerationCaseState =
  | 'unreviewed'
  | 'approved'
  | 'correction_requested'
  | 'on_hold'
  | 'rejected'
  | 'removed'
  | 'pending_independent_review';
export interface ModerationContent {
  readonly subject: ModerationSubject;
  readonly contributionId: string | null;
  readonly contributionIds: readonly string[];
  readonly contentVersion: number;
  readonly fingerprint: string;
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly currentDecisionId: string | null;
}
export interface ModerationDecisionRecord {
  readonly id: string;
  readonly subject: ModerationSubject;
  readonly contributionId: string | null;
  readonly contentVersion: number;
  readonly contentFingerprint: string;
  readonly policyVersion: string;
  readonly level: ModerationLevel;
  readonly primaryReason: ModerationReasonCode | null;
  readonly secondaryReasons: readonly ModerationReasonCode[];
  readonly editorialProvision: string | null;
  readonly internalReason: string | null;
  readonly sponsorExplanation: string | null;
  readonly actor: string;
  readonly createdAt: string;
  readonly state: 'active' | 'pending_independent_review';
  readonly previousDecisionId: string | null;
  readonly independentReviewer?: string | null;
}
/** The only decision projection allowed in sponsor portals and notifications. */
export type PublicModerationDecision = Pick<
  ModerationDecisionRecord,
  | 'id'
  | 'subject'
  | 'contentVersion'
  | 'policyVersion'
  | 'level'
  | 'primaryReason'
  | 'secondaryReasons'
  | 'sponsorExplanation'
  | 'createdAt'
  | 'state'
>;
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
