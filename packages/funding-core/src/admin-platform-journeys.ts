/** Read-only journey observations; persisted evidence is not an external synthetic check. */
export type AdminPlatformJourneyId =
  | 'contribution'
  | 'invoicing'
  | 'sponsorship'
  | 'publication'
  | 'transparency'
  | 'administration';

export type AdminPlatformJourneyState =
  'operational' | 'degraded' | 'unavailable' | 'unknown';

export type AdminPlatformJourneyDiagnostic =
  | 'correlated_chain'
  | 'correlated_step'
  | 'partial_observation'
  | 'no_recent_observation'
  | 'source_missing'
  | 'source_unavailable'
  | 'processing_failed'
  | 'processing_delayed'
  | 'delivery_uncertain'
  | 'awaiting_review'
  | 'awaiting_authorization'
  | 'smtp_accepted'
  | 'public_observation_missing'
  | 'authenticated_request';

export type AdminPlatformJourneyEvidenceScope =
  'correlated_records' | 'partial_records' | 'authenticated_request' | 'none';

export type AdminPlatformJourneyStepId =
  | 'checkout'
  | 'payment'
  | 'confirmation'
  | 'followup'
  | 'invoice'
  | 'email'
  | 'dossier'
  | 'media'
  | 'review'
  | 'visibility'
  | 'authorization'
  | 'scheduling'
  | 'delivery'
  | 'transactions'
  | 'calculation'
  | 'public_display'
  | 'login'
  | 'session'
  | 'api_access';

export interface AdminPlatformJourneyObservation {
  readonly state: AdminPlatformJourneyState;
  readonly diagnostic: AdminPlatformJourneyDiagnostic;
  readonly evidenceScope: AdminPlatformJourneyEvidenceScope;
  /** Provenance of observed facts; never inferred from a successful database read. */
  readonly environment: 'live' | 'test' | 'unknown';
  readonly checkedAt: string;
  readonly observedAt: string | null;
  /** A consumer must render expired observations as unknown. */
  readonly validUntil: string;
  /** Fixed internal administrative destination, without personal or provider data. */
  readonly adminUrl: string;
}

export interface AdminPlatformJourneyStep extends AdminPlatformJourneyObservation {
  readonly id: AdminPlatformJourneyStepId;
}

export interface AdminPlatformJourney extends AdminPlatformJourneyObservation {
  readonly id: AdminPlatformJourneyId;
  readonly steps: readonly AdminPlatformJourneyStep[];
}

export interface AdminPlatformJourneys {
  readonly generatedAt: string;
  readonly journeys: readonly AdminPlatformJourney[];
}
