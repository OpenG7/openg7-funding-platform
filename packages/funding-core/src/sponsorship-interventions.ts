/** Private administrative journal; entries never change payment or publication. */
export type SponsorshipInterventionKind =
  'email' | 'phone' | 'internal' | 'extension' | 'refund_review';

export interface SponsorshipInterventionRequest {
  readonly contributionId: string;
  readonly requestId: string;
  readonly kind: SponsorshipInterventionKind;
  readonly note: string;
  readonly nextReviewOn: string | null;
}

export interface SponsorshipIntervention {
  readonly id: string;
  readonly actor: string;
  readonly recordedAt: string;
  readonly kind: SponsorshipInterventionKind;
  readonly note: string;
  readonly nextReviewOn: string | null;
}

export interface SponsorshipInterventionsResponse {
  readonly entries: readonly SponsorshipIntervention[];
  readonly nextCursor: string | null;
  readonly followup: {
    readonly state:
      | 'inactive'
      | 'complete'
      | 'waiting'
      | 'first_reminder'
      | 'second_reminder'
      | 'decision_required'
      | 'extended';
    readonly ageDays: number | null;
    readonly nextReviewOn: string | null;
    readonly lastEmail: { readonly status: string; readonly at: string } | null;
  };
}

/** Internal review markers, not a refund deadline or an automatic email schedule. */
export const SPONSORSHIP_FOLLOWUP_DAYS = {
  first: 7,
  second: 14,
  decision: 30
} as const;
