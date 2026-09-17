/** Additive admin read models. All monetary values are integer minor units. */
export interface CockpitPeriod {
  readonly start: string;
  readonly end: string;
}
export interface CockpitTrend {
  readonly current: number | null;
  readonly previous: number | null;
  readonly percent: number | null;
  readonly series: readonly {
    readonly day: string;
    readonly value: number | null;
  }[];
}
export interface CockpitCurrencyMetrics {
  readonly currency: string;
  readonly grossMinor: number;
  readonly confirmedFeesMinor: number;
  readonly missingFeeCount: number;
  readonly netReceivedMinor: number | null;
  readonly refundedMinor: number;
  readonly disputedMinor: number;
  readonly netAfterRefundsMinor: number | null;
  readonly grossTrend: CockpitTrend;
  readonly netTrend: CockpitTrend;
}
export interface AdminCockpitMetrics {
  readonly available: boolean;
  readonly generatedAt: string;
  readonly source: 'postgresql';
  readonly timezone: 'America/Toronto';
  readonly period: CockpitPeriod;
  readonly previousPeriod: CockpitPeriod;
  readonly currencies: readonly CockpitCurrencyMetrics[];
  readonly sponsorshipCount: number;
  readonly sponsorshipTrend: CockpitTrend;
  /** One active draft per contribution/target/channel; batches and slots are containers. */
  readonly plannedPublicationCount: number | null;
  readonly warnings: readonly (
    | 'publications_unavailable'
    | 'unlinked_transactions'
    | 'duplicate_payments'
    | 'undated_payments'
  )[];
}
export type CockpitActivityKind =
  'payment' | 'invoice' | 'publication' | 'review' | 'information' | 'refund';
export interface CockpitActivityItem {
  readonly id: string;
  readonly kind: CockpitActivityKind;
  readonly occurredAt: string;
  readonly reference: string;
  readonly adminUrl: string;
}
export interface AdminCockpitActivity {
  readonly available: boolean;
  readonly generatedAt: string;
  readonly today: string;
  readonly todayCounts: Readonly<Record<CockpitActivityKind, number | null>>;
  readonly missingSources: readonly string[];
  readonly items: readonly CockpitActivityItem[];
}
export type CockpitSystemState =
  'operational' | 'degraded' | 'unavailable' | 'not_configured' | 'unknown';
export type CockpitSystemEvidence =
  | 'database_read'
  | 'storage_read'
  | 'recent_webhook'
  | 'recent_email'
  | 'pending_errors'
  | 'no_recent_observation'
  | 'not_configured'
  | 'check_failed';
export interface CockpitSystem {
  readonly id: 'stripe' | 'email' | 'storage' | 'database';
  readonly provider: 'Stripe' | 'SMTP' | 'OVH S3' | 'Local' | 'PostgreSQL';
  readonly state: CockpitSystemState;
  readonly evidence: CockpitSystemEvidence;
  readonly checkedAt: string;
  readonly observedAt: string | null;
  readonly validUntil: string;
  readonly adminUrl: string;
}
export interface AdminCockpitSystems {
  readonly generatedAt: string;
  readonly systems: readonly CockpitSystem[];
}
