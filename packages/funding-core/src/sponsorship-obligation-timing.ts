/** Private commercial scheduling. A clock never proves continuous exposure. */
export type SponsorshipPublicObservationStatus =
  'visible' | 'changed' | 'not_visible' | 'unknown';

export type SponsorshipPublicObservationReason =
  | 'MATCH'
  | 'PUBLIC_CONTENT_CHANGED'
  | 'PUBLIC_MEDIA_CHANGED'
  | 'PUBLIC_MEDIA_MISSING'
  | 'PROFILE_NOT_OBSERVED'
  | 'HTTP_ERROR'
  | 'HTTP_REDIRECT'
  | 'HTTP_TIMEOUT'
  | 'HTTP_TOO_LARGE'
  | 'HTTP_INVALID'
  | 'DNS_UNSAFE'
  | 'CHECK_BUDGET_EXHAUSTED'
  | 'SOURCE_CHANGED';

/** A sample of the controlled public API and media; never a continuity attestation. */
export interface SponsorshipPublicObservation {
  readonly checkedAt: string;
  readonly status: SponsorshipPublicObservationStatus;
  readonly reason: SponsorshipPublicObservationReason;
  readonly httpStatus: number | null;
}

export interface SponsorshipObligationTiming {
  readonly version: number;
  readonly deadlineDays: number | null;
  readonly durationDays: number | null;
  readonly originAt: string | null;
  readonly originProvenance: 'activation' | 'owner_recorded' | null;
  readonly dueAt: string | null;
  readonly overdue: boolean;
  readonly durationState:
    | 'not_required'
    | 'unsupported'
    | 'awaiting_observation'
    | 'awaiting_review'
    | 'restart_required'
    | 'attested';
  readonly startObservation: {
    readonly id: string;
    readonly observedAt: string;
    readonly earliestCompletionAt: string;
  } | null;
  readonly latestPublicObservation?: SponsorshipPublicObservation | null;
}

export interface SponsorshipTimingCommandRequest {
  readonly requestId: string;
  readonly obligationId: string;
  readonly expectedVersion: number;
  readonly confirmation: string;
  readonly reason: string;
  readonly kind: 'origin' | 'observe' | 'duration';
  readonly originAt?: string;
  readonly evidenceReference?: string;
  readonly startObservationId?: string;
  /** Explicit owner statement supported by private evidence; two snapshots alone are insufficient. */
  readonly continuityConfirmed?: true;
}

export const sponsorshipDeadlineAt = (
  originAt: string,
  days: number
): string => {
  const origin = Date.parse(originAt);
  if (
    !Number.isFinite(origin) ||
    !Number.isSafeInteger(days) ||
    days < 1 ||
    days > 3650
  )
    throw new Error('Invalid sponsorship timing.');
  return new Date(origin + days * 86_400_000).toISOString();
};

export const sponsorshipDeadlineOverdue = (
  dueAt: string | null,
  state: string,
  now: string
): boolean => {
  if (dueAt === null || !['pending', 'blocked'].includes(state)) return false;
  const due = Date.parse(dueAt);
  const current = Date.parse(now);
  if (!Number.isFinite(due) || !Number.isFinite(current))
    throw new Error('Invalid sponsorship timing.');
  return current > due;
};
