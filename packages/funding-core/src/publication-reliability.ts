/** Safe, read-only correlations. These facts never authorize an external retry. */
export const PUBLICATION_RELIABILITY_INCIDENT_CODES = [
  'FULFILMENT_EVIDENCE_MISMATCH',
  'ORPHAN_FULFILMENT_EVIDENCE',
  'OBLIGATION_RESERVATION_MISMATCH',
  'ACCOUNT_RESERVATION_MISMATCH',
  'ACCOUNT_LEASE_MISMATCH',
  'ACCOUNT_RESULT_UNCERTAIN',
  'ACCOUNT_SCHEDULE_CONFLICT',
  'BATCH_CAPACITY_EXCEEDED',
  'SLOT_CAPACITY_EXCEEDED',
  'SPONSORSHIP_DEADLINE_EXCEEDED',
  'SPONSORSHIP_DEADLINE_ORIGIN_UNKNOWN'
] as const;
export type PublicationReliabilityIncidentCode =
  (typeof PUBLICATION_RELIABILITY_INCIDENT_CODES)[number];
export type PublicationReliabilitySubjectType =
  'obligation' | 'delivery' | 'batch' | 'slot';
export interface PublicationReliabilityIncident {
  readonly code: PublicationReliabilityIncidentCode;
  readonly subjectType: PublicationReliabilitySubjectType;
  readonly subjectId: string;
  readonly sponsorshipId?: string;
  readonly deliveryId?: string;
  readonly batchId?: string;
  readonly slotId?: string;
}
export interface PublicationReliabilityIncidentFilter {
  readonly code?: PublicationReliabilityIncidentCode;
  readonly subjectType?: PublicationReliabilitySubjectType;
  readonly cursor?: string;
}
export interface PublicationReliabilityIncidentPage {
  readonly scope: 'global';
  readonly evaluatedAt: string;
  /** Complete incident count, independent of the current code/type filters. */
  readonly globalTotal: number;
  readonly filteredTotal: number;
  readonly limit: number;
  readonly incidents: readonly PublicationReliabilityIncident[];
  /** Opaque keyset continuation; changing facts invalidates the continuation. */
  readonly nextCursor: string | null;
  readonly snapshot: string;
}
export interface PublicationReliability {
  readonly scope: 'global';
  readonly evaluatedAt: string;
  readonly obligations: {
    readonly open: number;
    readonly undatedSocial: number;
    readonly oldestOpenAt: string | null;
    readonly oldestUndatedAt: string | null;
    readonly fulfilledWithEvidence: number;
    readonly waived: number;
    readonly unqualifiedDossiers: number;
    readonly overdue?: number;
    readonly missingDeadlineOrigin?: number;
    readonly awaitingDuration?: number;
  };
  readonly capacity: {
    readonly saturatedBatches: number;
    readonly saturatedSlots: number;
    readonly accountConflicts: number;
  };
  readonly deliveries: {
    readonly publishing: number;
    readonly uncertain: number;
    readonly uncertainAccounts: number;
    readonly oldestUncertainAccountAt: string | null;
    readonly overdueApproved: number;
  };
  readonly discrepancies: {
    readonly proof: number;
    readonly orphanProof: number;
    readonly obligationReservation: number;
    readonly accountReservation: number;
    readonly accountLease: number;
    readonly batchCapacity: number;
    readonly slotCapacity: number;
  };
  readonly incidents: readonly PublicationReliabilityIncident[];
  readonly incidentTotal: number;
  readonly correlationLimit: number;
}
