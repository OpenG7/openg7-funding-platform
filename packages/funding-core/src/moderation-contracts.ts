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
