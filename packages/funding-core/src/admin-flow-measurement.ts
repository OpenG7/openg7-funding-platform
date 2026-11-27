import type { PublicationAutomationFilter } from './publication-automation.js';

/** Current qualified snapshot, not an immutable historical throughput series. */
export interface AdminFlowCounters {
  readonly population: number;
  readonly entries: number;
  readonly qualifiedExits: number;
  readonly open: number;
  readonly qualified: number;
  readonly adjusted: number;
  readonly overdue: number;
  readonly undated: number;
  readonly ageSamples: number;
  readonly unknownAge: number;
  readonly oldestAgeSeconds: number | null;
  readonly medianAgeSeconds: number | null;
  readonly p95AgeSeconds: number | null;
  readonly cycleSamples: number;
  readonly medianCycleSeconds: number | null;
  readonly p95CycleSeconds: number | null;
}
export interface AdminFlowCohort extends AdminFlowCounters {
  readonly channel: string;
  readonly target: string;
  readonly format: string;
  readonly mode: 'live' | 'mock' | 'disabled' | 'unknown' | 'mixed';
  readonly deadline: 'dated' | 'undated';
}
export interface AdminFlowMeasurement {
  readonly definition: 'sponsorship-obligation-flow/v1';
  readonly observedAt: string;
  readonly window: {
    readonly from: string;
    readonly to: string;
    readonly timezone: 'UTC';
  };
  readonly scope: Pick<
    PublicationAutomationFilter,
    'sponsorshipId' | 'deliveryId'
  >;
  readonly status: 'available' | 'unavailable';
  readonly sources: readonly string[];
  readonly excludedDossiers: number | null;
  readonly totals: AdminFlowCounters | null;
  readonly cohorts: readonly AdminFlowCohort[];
  /** Absence of instrumentation is never a zero or an inferred autonomy score. */
  readonly humanActiveSeconds: null;
  readonly autonomyRate: null;
}
