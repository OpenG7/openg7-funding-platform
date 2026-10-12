import type { SponsorshipBenefitId } from './sponsorship-benefits.js';
import type {
  SponsorshipObligationChannel,
  SponsorshipObligationTarget,
  SponsorshipOfferedBenefit
} from './sponsorship-offers.js';

/** Observations of immutable delivery facts; these never amend a commercial balance. */
export type SponsorshipHistoricalAuditFinding =
  'duration_unverified' | 'required_element_missing' | 'snapshot_incomplete';
export type SponsorshipHistoricalAuditFilter =
  SponsorshipHistoricalAuditFinding | 'no_issue_detected';
export type SponsorshipHistoricalAuditConclusion =
  'confirmed' | 'follow_up_required' | 'inconclusive';
export interface SponsorshipHistoricalAuditReview {
  readonly id: string;
  readonly conclusion: SponsorshipHistoricalAuditConclusion;
  readonly reviewedAt: string;
}
export interface SponsorshipHistoricalAuditItem {
  readonly evidenceId: string;
  readonly obligationId: string;
  readonly contributionId: string;
  readonly benefitId: SponsorshipBenefitId;
  readonly channel: SponsorshipObligationChannel;
  readonly target: SponsorshipObligationTarget;
  readonly deliveredAt: string;
  readonly durationDays: number | null;
  readonly requirements: readonly {
    readonly element: SponsorshipOfferedBenefit['requiredElements'][number];
    readonly observation: 'satisfied' | 'missing' | 'unknown';
  }[];
  readonly findings: readonly SponsorshipHistoricalAuditFinding[];
  readonly reviewVersion: number;
  readonly latestReview: SponsorshipHistoricalAuditReview | null;
}
export interface SponsorshipHistoricalAuditPreview {
  readonly items: readonly SponsorshipHistoricalAuditItem[];
  readonly pageSize: number;
  readonly nextCursor: string | null;
  /** Stable upper bound for evidence, retained in the opaque next cursor. */
  readonly asOf: string;
  /** Global counts include every evidence at asOf, irrespective of page or filters. */
  readonly totals: {
    readonly evidence: number;
    readonly filtered: number;
    readonly unreviewed: number;
    readonly durationUnverified: number;
    readonly requiredElementMissing: number;
    readonly snapshotIncomplete: number;
    readonly noIssueDetected: number;
  };
}
export interface SponsorshipHistoricalAuditReviewRequest {
  readonly requestId: string;
  readonly evidenceId: string;
  readonly expectedVersion: number;
  /** Explicit confirmation names this exact immutable evidence. */
  readonly confirmation: string;
  readonly conclusion: SponsorshipHistoricalAuditConclusion;
  /** Private audit context; never returned in the inventory. */
  readonly reason: string;
}
export interface SponsorshipHistoricalAuditReviewResponse {
  readonly evidenceId: string;
  readonly reviewVersion: number;
  readonly review: SponsorshipHistoricalAuditReview;
}
