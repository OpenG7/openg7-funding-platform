import type {
  AdminPreparationReceiptData,
  PreparationAssistanceSummary
} from '@openg7/funding-core';

export type PreparationActionKind =
  'agreement' | 'moderation' | 'presentation' | 'inspect';

/** A server control or a remaining server blocker, never a local workflow state. */
export interface PreparationPilotIssue {
  readonly id: string;
  readonly checkCode?: string;
  readonly titleKey: string;
  readonly summaryCodes: readonly string[];
  readonly completed: boolean;
  readonly adminUrl: string | null;
  readonly actionKind: PreparationActionKind;
}

export interface PreparationPilotProjection {
  readonly issues: readonly PreparationPilotIssue[];
  /** Exact server check counts; standalone blockers do not change this denominator. */
  readonly completed: number;
  readonly total: number;
}

export interface PreparationContextActionsInput {
  readonly receipt: AdminPreparationReceiptData | null;
  readonly issue: PreparationPilotIssue | null;
  /** The host's current permission, in addition to receipt.canApprove. */
  readonly canApprove: boolean;
  readonly busy: boolean;
  readonly canAssist?: boolean;
  readonly assistanceSummary?: PreparationAssistanceSummary | null;
  readonly assistanceBusy?: boolean;
  /** Keys are relative to admin.automatic.portfolio.receipt. */
  readonly t: (key: string) => string;
}
