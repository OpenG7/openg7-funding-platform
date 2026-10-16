import type { ResponsibilityBalance } from './admin-responsibility-balance.js';

export interface AdminAutomaticRunAction {
  readonly kind: 'draft_prepared';
  readonly targetId: string;
  readonly channel: 'facebook' | 'linkedin';
  readonly target: 'openg7' | 'openg20';
  readonly created: boolean;
  readonly auditReference: string | null;
}

/** Immutable server observation. Preparation is never a fulfilled benefit. */
export interface AdminAutomaticRunEntry {
  readonly seq: number;
  readonly runId: string;
  readonly pass: number;
  readonly contributionId: string;
  readonly reference: string;
  readonly balanceStatus: ResponsibilityBalance['status'];
  readonly reasonCodes: readonly string[];
  readonly actions: readonly AdminAutomaticRunAction[];
  readonly beforeBalance: ResponsibilityBalance;
  readonly balance: ResponsibilityBalance;
  readonly createdAt: string;
  readonly actor: string;
  readonly requestId: string;
  readonly auditReference: string;
}

export interface AdminAutomaticRun {
  readonly id: string;
  readonly version: number;
  readonly status: 'running' | 'paused' | 'completed' | 'uncertain';
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly observedAt: string | null;
  readonly pass: number;
  readonly cursor: number;
  readonly dossierCount: number;
  readonly processedCount: number;
  readonly balancedCount: number;
  readonly outstandingCount: number;
  readonly unknownCount: number;
  readonly uncoveredCount: number;
  readonly newPaymentCount: number;
  readonly currencyTotals: readonly {
    readonly currency: string;
    readonly amountMinor: number;
  }[];
  readonly latestEntry: AdminAutomaticRunEntry | null;
  readonly nextContributionId: string | null;
  /** Every frozen dossier was balanced at its own report date; not a live platform guarantee. */
  readonly globalBalanced: boolean;
}

export interface AdminAutomaticRunState {
  readonly run: AdminAutomaticRun | null;
  readonly balance: ResponsibilityBalance | null;
}

export interface AdminAutomaticRunReport {
  readonly entries: readonly AdminAutomaticRunEntry[];
  readonly nextCursor: number | null;
}

export interface AdminAutomaticRunStartRequest {
  readonly requestId: string;
}

export interface AdminAutomaticRunAdvanceRequest {
  readonly runId: string;
  readonly requestId: string;
  readonly expectedVersion: number;
}

export interface AdminAutomaticRunControlRequest extends AdminAutomaticRunAdvanceRequest {
  /** Recheck starts another pass over the same frozen payment manifest. */
  readonly action: 'pause' | 'resume' | 'recheck' | 'reconcile';
}
