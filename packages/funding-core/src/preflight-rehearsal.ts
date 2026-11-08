import type { PreflightInboxProposal } from './preflight-inbox.js';

export type PreflightRehearsalScenario = 'standard' | 'missing_input';
export type PreflightRehearsalStepKey =
  'created' | 'submitted' | 'processing' | 'prepared' | 'returned' | 'review';
export type PreflightRehearsalStepState =
  'pending' | 'active' | 'confirmed' | 'attention' | 'failed';
export type PreflightRehearsalDelivery =
  'prepared' | 'sending' | 'acknowledged' | 'uncertain' | 'rejected';

export interface PreflightRehearsalStep {
  readonly key: PreflightRehearsalStepKey;
  readonly state: PreflightRehearsalStepState;
  readonly at: string | null;
  readonly code?: string;
}

export interface PreflightRehearsalTask {
  readonly id: string;
  readonly key: string;
  readonly kind: string;
  readonly status: string;
  readonly attempts: number;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly errorCode: string | null;
}

export interface PreflightRehearsalOutput {
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly warnings: readonly string[];
  readonly provenance: {
    readonly provider: string;
    readonly model: string;
    readonly simulated: boolean;
  };
}

/** A synthetic local recipe, never a contribution, payment or real commitment. */
export interface PreflightRehearsalRun {
  readonly id: string;
  readonly scenario: PreflightRehearsalScenario;
  readonly synthetic: true;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source: {
    readonly application: 'funding-platform';
    readonly subjectType: 'sponsorship-commitment';
    readonly subjectId: string;
    readonly version: 1;
    readonly synthetic: true;
  };
  readonly missionId: string;
  readonly missionStatus: string | null;
  readonly delivery: PreflightRehearsalDelivery;
  readonly submittedAt: string | null;
  readonly lastCheckedAt: string | null;
  readonly receivedAt: string | null;
  readonly steps: readonly PreflightRehearsalStep[];
  readonly tasks: readonly PreflightRehearsalTask[];
  readonly proposals: readonly PreflightInboxProposal[];
  readonly output: PreflightRehearsalOutput | null;
  readonly error: { readonly code: string; readonly retryable: boolean } | null;
  readonly expectedSimulation: true;
  readonly observedSimulated: boolean | null;
  readonly terminal: boolean;
  readonly authority: 'source_application';
  readonly businessDecisionExecuted: false;
}

export interface PreflightRehearsalSummary {
  readonly id: string;
  readonly scenario: PreflightRehearsalScenario;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly delivery: PreflightRehearsalDelivery;
  readonly missionStatus: string | null;
  readonly terminal: boolean;
}

export interface PreflightRehearsalResponse {
  readonly enabled: boolean;
  readonly canLaunch: boolean;
  readonly consoleUrl: string | null;
  readonly run: PreflightRehearsalRun | null;
  readonly runs: readonly PreflightRehearsalSummary[];
}

export interface PreflightRehearsalStartRequest {
  readonly requestId: string;
  readonly scenario: PreflightRehearsalScenario;
}
