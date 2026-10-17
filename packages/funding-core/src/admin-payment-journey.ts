import type { ContributionType } from './contribution-contracts.js';
import type { SponsorshipProgressState } from './sponsorship-progress.js';

/** Read-only work derived from confirmed payment and dossier facts. */
export interface AdminPaymentJourneyStep {
  readonly id: string;
  readonly state: SponsorshipProgressState;
  readonly reason: string;
  readonly adminUrl: string;
  readonly target?: string;
  readonly responsibility?: 'admin' | 'platform' | 'none';
}

export interface AdminPaymentJourney {
  readonly contributionId: string;
  readonly reference: string;
  readonly contributionType: ContributionType;
  readonly amountMinor: number;
  readonly currency: string;
  readonly paymentStatus: string;
  readonly state: 'complete' | 'action_required' | 'waiting' | 'blocked';
  readonly completed: number;
  readonly total: number;
  readonly steps: readonly AdminPaymentJourneyStep[];
  readonly next: {
    readonly reason: string;
    readonly adminUrl: string;
    readonly target?: string;
    readonly responsibility?: 'admin' | 'platform' | 'none';
  } | null;
}

export interface AdminPaymentJourneyResponse {
  readonly status: 'ok' | 'not_found' | 'unavailable';
  readonly generatedAt: string;
  readonly journey: AdminPaymentJourney | null;
}
