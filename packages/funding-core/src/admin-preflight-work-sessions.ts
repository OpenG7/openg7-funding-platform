import type { AdminServicePreparationReceipt } from './admin-service-preparation.js';
import type { PreflightDeskStage } from './preflight-desk.js';

/** Personal navigation and review entries. No content or publication authority. */
export interface AdminPreflightWorkSessionCheckpoint {
  readonly pendingDecision:
    'approved' | 'correction_requested' | 'rejected' | null;
  readonly reason: string;
  readonly view?: string;
  readonly decisionRequestId?: string;
  readonly expectedPreparationVersion?: string;
}
export interface AdminPreflightWorkSessionFilters {
  readonly deskStatus?: 'all' | PreflightDeskStage;
  readonly deskSearch?: string;
  readonly deskPage?: number;
}
export interface AdminPreflightWorkSessionItem {
  readonly position: number;
  readonly contributionId: string;
  readonly obligationId: string;
  readonly observedVersion: string;
  readonly state: 'pending' | 'deferred' | 'saved';
  readonly checkpoint: AdminPreflightWorkSessionCheckpoint;
  readonly visitedAt: string | null;
  readonly savedAt: string | null;
  readonly reference: string | null;
  readonly companyName: string | null;
  readonly channel: 'website' | 'facebook' | 'linkedin' | null;
  readonly currentStatus: PreflightDeskStage | 'unavailable';
  readonly obsolete: boolean;
}
export interface AdminPreflightWorkSessionReport {
  readonly total: number;
  readonly visited: number;
  readonly deferred: number;
  readonly saved: number;
  readonly remaining: number;
  readonly decisions: {
    /** All committed review events during this actor's session interval. */
    readonly total: number;
    readonly approved: number;
    readonly correctionRequested: number;
    readonly rejected: number;
  };
  /** Current Funding stock in this manifest, distinct from actions during the session. */
  readonly readyForDelivery: number;
  readonly delivered: number;
  readonly unavailable: number;
  /** Union of saved/deferred items without a session decision still applicable to their current content. */
  readonly toResume: number;
  readonly attention: readonly {
    readonly contributionId: string;
    readonly obligationId: string;
    readonly kind:
      | 'correction'
      | 'to_schedule'
      | 'scheduled'
      | 'pending'
      | 'failed'
      | 'uncertain'
      | 'source_changed'
      | 'unavailable';
    readonly reference: string | null;
    readonly companyName: string | null;
    readonly channel: 'website' | 'facebook' | 'linkedin' | null;
    readonly adminUrl: string | null;
  }[];
}
export interface AdminPreflightWorkSessionSummary {
  readonly id: string;
  readonly revision: number;
  readonly status: 'active' | 'paused' | 'finished';
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
  readonly lastPosition: number;
  readonly itemCount: number;
}
export interface AdminPreflightWorkSession extends AdminPreflightWorkSessionSummary {
  readonly filters: AdminPreflightWorkSessionFilters;
  readonly items: readonly AdminPreflightWorkSessionItem[];
  readonly report: AdminPreflightWorkSessionReport;
}
export interface AdminPreflightWorkSessionState {
  readonly current: AdminPreflightWorkSession | null;
  readonly recent: readonly AdminPreflightWorkSessionSummary[];
  readonly command: {
    readonly requestId: string;
    readonly status: 'applied' | 'not_found';
  } | null;
}
export interface AdminPreflightWorkSessionStartRequest {
  readonly requestId: string;
  readonly contributionId: string;
  readonly obligationId: string;
  readonly filters?: AdminPreflightWorkSessionFilters;
}
export interface AdminPreflightWorkSessionCommandRequest {
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly action:
    'visit' | 'defer' | 'checkpoint' | 'pause' | 'finish' | 'resume';
  readonly contributionId?: string;
  readonly obligationId?: string;
  readonly observedVersion?: string;
  readonly checkpoint?: AdminPreflightWorkSessionCheckpoint;
  readonly filters?: AdminPreflightWorkSessionFilters;
}
export interface AdminServicePreparationSaveDraftRequest {
  readonly contributionId: string;
  readonly obligationId: string;
  readonly expectedVersion: string;
  readonly requestId: string;
  readonly title: string;
  readonly body: string;
  readonly disclosureText: string;
  readonly workSessionId?: string;
  readonly expectedSessionRevision?: number;
}
export interface AdminServicePreparationSaveDraftResult {
  readonly receipt: AdminServicePreparationReceipt;
  readonly session: AdminPreflightWorkSession | null;
}
