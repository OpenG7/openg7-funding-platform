/** Read-only remote proposals. Source facts and business decisions remain owned by Funding. */
export interface PreflightInboxProposal {
  readonly id: string;
  readonly missionId: string;
  readonly source: {
    readonly application: 'funding-platform';
    readonly subjectType: string;
    readonly subjectId: string;
    readonly version: number;
  };
  readonly type: string;
  readonly risk: string;
  readonly status: 'prepared';
  readonly version: number;
  readonly createdAt: string;
  readonly explanations: readonly string[];
  readonly limitations: readonly string[];
  readonly blockingConditions: readonly string[];
  readonly anomalies: readonly string[];
  readonly checks: readonly {
    readonly resultId: string;
    readonly kind: string;
    readonly passed: boolean;
  }[];
  readonly provenance: {
    readonly simulated: boolean;
    readonly provider: string;
    readonly model: string;
  };
  readonly authority: 'source_application';
  readonly businessDecisionExecuted: false;
}

export interface PreflightInboxResponse {
  readonly state: 'disabled' | 'ready';
  readonly consoleUrl: string | null;
  readonly items: readonly PreflightInboxProposal[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly authority: 'source_application';
  readonly businessDecisionExecuted: false;
}

export interface PreflightInboxUnavailable {
  readonly state: 'unavailable';
  readonly consoleUrl: string | null;
  readonly code: 'PREFLIGHT_UNAVAILABLE' | 'PREFLIGHT_RESPONSE_INVALID';
  readonly error: string;
}
