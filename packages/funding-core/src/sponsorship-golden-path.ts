import type { AdminCampaignItem } from './admin-campaigns.js';
import type { AdminPaymentJourney } from './admin-payment-journey.js';
import type {
  ResponsibilityBalance,
  ResponsibilityBalanceObligation
} from './admin-responsibility-balance.js';
import type { SponsorshipCommitmentRecord } from './sponsorship-commitments.js';
import type { SponsorshipProgressPublication } from './sponsorship-progress.js';

/** Native execution observations, not a new authorization or proof policy. */
export type GoldenPathExecution = Pick<
  SponsorshipProgressPublication,
  | 'id'
  | 'obligationId'
  | 'deliveryId'
  | 'deliveryStatus'
  | 'deliveryMode'
  | 'scheduledAt'
  | 'publishedAt'
>;

export interface SponsorshipGoldenPathService {
  readonly obligation: ResponsibilityBalanceObligation;
  /** Null means this passage has no observation on the loaded campaign page. */
  readonly preparation: AdminCampaignItem['preparation'] | null;
  readonly workflow: AdminCampaignItem['workflow'] | null;
  readonly executions: readonly GoldenPathExecution[];
  readonly adminUrl: string;
}

/** A dossier snapshot derived from existing owners; never a persisted workflow. */
export interface SponsorshipGoldenPath {
  readonly contributionId: string;
  readonly reference: string;
  readonly observedAt: string;
  readonly version: string;
  readonly paymentStatus: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly state: ResponsibilityBalance['status'];
  readonly reasons: readonly string[];
  readonly counts: Pick<
    ResponsibilityBalance,
    'expected' | 'fulfilled' | 'waived' | 'outstanding' | 'unknown'
  >;
  readonly commitment: Pick<
    SponsorshipCommitmentRecord,
    'id' | 'version' | 'state' | 'offerId'
  > | null;
  readonly steps: AdminPaymentJourney['steps'];
  readonly next: ResponsibilityBalance['next'];
  readonly services: readonly SponsorshipGoldenPathService[];
  /** Coverage of preparation/workflow observations, not a truncated proof total. */
  readonly partial: boolean;
  readonly sources: readonly {
    readonly owner:
      'responsibilities' | 'payment_journey' | 'campaigns' | 'publications';
    readonly observedAt: string;
  }[];
}

export interface SponsorshipGoldenPathObservation {
  readonly status:
    'available' | 'not_found' | 'not_sponsorship' | 'unavailable';
  readonly path: SponsorshipGoldenPath | null;
}
