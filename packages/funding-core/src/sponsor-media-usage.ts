export const SPONSOR_MEDIA_USAGE_CHANNELS = [
  'website',
  'facebook',
  'linkedin'
] as const;
export const SPONSOR_MEDIA_USAGE_TARGETS = ['openg7', 'openg20'] as const;
export const SPONSOR_MEDIA_TRANSFORMATIONS = [
  'technical',
  'crop',
  'composite',
  'portrait'
] as const;
export type SponsorMediaUsageChannel =
  (typeof SPONSOR_MEDIA_USAGE_CHANNELS)[number];
export type SponsorMediaUsageTarget =
  (typeof SPONSOR_MEDIA_USAGE_TARGETS)[number];
export type SponsorMediaTransformation =
  (typeof SPONSOR_MEDIA_TRANSFORMATIONS)[number];

/** Usage rights are separate from technical acceptance, editorial review and publication consent. */
export interface SponsorMediaUsageRights {
  readonly state: 'needs_confirmation' | 'confirmed' | 'withdrawn';
  readonly channels: readonly SponsorMediaUsageChannel[];
  readonly targets: readonly SponsorMediaUsageTarget[];
  readonly transformations: readonly SponsorMediaTransformation[];
  readonly credit: string | null;
  readonly restrictions: string | null;
}
export const UNKNOWN_SPONSOR_MEDIA_USAGE: SponsorMediaUsageRights =
  Object.freeze({
    state: 'needs_confirmation',
    channels: Object.freeze([]),
    targets: Object.freeze([]),
    transformations: Object.freeze([]),
    credit: null,
    restrictions: null
  });

const orderedValues = <T extends string>(
  value: unknown,
  allowed: readonly T[]
): readonly T[] => {
  if (
    !Array.isArray(value) ||
    value.some((item) => !allowed.includes(item)) ||
    new Set(value).size !== value.length
  )
    throw new Error('Invalid sponsor media permissions.');
  return allowed.filter((item) => value.includes(item));
};
const boundedText = (
  value: unknown,
  maxLength: number,
  multiline = false
): string | null => {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maxLength ||
    (multiline
      ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/
      : /[\u0000-\u001f\u007f<>]/
    ).test(value)
  )
    throw new Error('Invalid sponsor media usage text.');
  return value.trim();
};

/** Stable normalization is shared by capture, approvals, previews and dispatch snapshots. */
export function normalizeSponsorMediaUsage(
  value: unknown
): SponsorMediaUsageRights {
  if (value === null || value === undefined) return UNKNOWN_SPONSOR_MEDIA_USAGE;
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid sponsor media usage.');
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) =>
        ![
          'state',
          'channels',
          'targets',
          'transformations',
          'credit',
          'restrictions'
        ].includes(key)
    ) ||
    typeof input.state !== 'string' ||
    !['needs_confirmation', 'confirmed', 'withdrawn'].includes(input.state)
  )
    throw new Error('Invalid sponsor media usage.');
  const rights: SponsorMediaUsageRights = {
    state: input.state as SponsorMediaUsageRights['state'],
    channels: orderedValues(input.channels, SPONSOR_MEDIA_USAGE_CHANNELS),
    targets: orderedValues(input.targets, SPONSOR_MEDIA_USAGE_TARGETS),
    transformations: orderedValues(
      input.transformations,
      SPONSOR_MEDIA_TRANSFORMATIONS
    ),
    credit: boundedText(input.credit, 200),
    restrictions: boundedText(input.restrictions, 1000, true)
  };
  if (
    rights.state === 'confirmed' &&
    (!rights.channels.length ||
      !rights.targets.length ||
      !rights.transformations.includes('technical'))
  )
    throw new Error(
      'Confirmed image usage requires channels, targets and technical transformation permission.'
    );
  return rights;
}

export type SponsorMediaUsageIssue =
  | 'MEDIA_USAGE_CONFIRMATION_REQUIRED'
  | 'MEDIA_USAGE_WITHDRAWN'
  | 'MEDIA_CHANNEL_NOT_AUTHORIZED'
  | 'MEDIA_TARGET_NOT_AUTHORIZED'
  | 'MEDIA_TRANSFORMATION_NOT_AUTHORIZED'
  | 'MEDIA_RESTRICTIONS_REVIEW_REQUIRED'
  | 'MEDIA_CREDIT_REQUIRED';

export function sponsorMediaUsageIssue(
  usage: SponsorMediaUsageRights,
  context: {
    readonly channel: SponsorMediaUsageChannel;
    readonly target: SponsorMediaUsageTarget;
    readonly transformations: readonly SponsorMediaTransformation[];
    readonly restrictionsReviewed: boolean;
    /** Credit must already be present in the exact protected message or derived image. */
    readonly renderedCredit: string | null;
  }
): SponsorMediaUsageIssue | null {
  if (usage.state === 'withdrawn') return 'MEDIA_USAGE_WITHDRAWN';
  if (usage.state !== 'confirmed') return 'MEDIA_USAGE_CONFIRMATION_REQUIRED';
  if (!usage.channels.includes(context.channel))
    return 'MEDIA_CHANNEL_NOT_AUTHORIZED';
  if (!usage.targets.includes(context.target))
    return 'MEDIA_TARGET_NOT_AUTHORIZED';
  if (
    context.transformations.some(
      (item) => !usage.transformations.includes(item)
    )
  )
    return 'MEDIA_TRANSFORMATION_NOT_AUTHORIZED';
  if (usage.restrictions && !context.restrictionsReviewed)
    return 'MEDIA_RESTRICTIONS_REVIEW_REQUIRED';
  if (usage.credit && context.renderedCredit !== usage.credit)
    return 'MEDIA_CREDIT_REQUIRED';
  return null;
}

export interface SponsorMediaUsageRequest {
  readonly token: string;
  readonly requestId: string;
  readonly assetId: string;
  readonly expectedVersion: string;
  readonly confirmed: true;
  readonly usage: SponsorMediaUsageRights;
}
export interface AdminSponsorMediaUsageRequest {
  readonly requestId: string;
  readonly assetId: string;
  readonly expectedVersion: string;
  readonly confirmation: string;
  readonly usage: SponsorMediaUsageRights;
  /** A private source of authorization is required to qualify historical media. */
  readonly evidenceReference: string;
}
export interface SponsorMediaPreference {
  readonly available: boolean;
  readonly revision: number;
  readonly preferredAssetId: string | null;
  readonly correction: string | null;
  readonly state: 'none' | 'pending' | 'accepted' | 'rejected';
  readonly sponsorExplanation: string | null;
}
export interface SponsorMediaPreferenceRequest {
  readonly token: string;
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly assetId: string | null;
  readonly correction: string | null;
  readonly confirmed: true;
}
export interface AdminSponsorMediaPreferenceDecisionRequest {
  readonly requestId: string;
  readonly contributionId: string;
  readonly expectedRevision: number;
  readonly state: 'accepted' | 'rejected';
  readonly sponsorExplanation: string;
  readonly confirmation: string;
}
