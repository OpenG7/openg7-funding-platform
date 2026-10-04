import type { AdminAssistantMode } from './admin-assistant-context.js';

// ============================================================================
// Admin AI assistant (read-only operational copilot) — iteration 1.
//
// The assistant never owns business state: statuses, amounts, permissions and
// validations always come from the deterministic application services. These
// types describe (1) the deterministic attention work queue and (2) the
// controlled conversational answer. No business decision is encoded here.
// ============================================================================

export type AdminAttentionItemType =
  | 'sponsorship_needs_info'
  | 'sponsorship_needs_review'
  | 'publication_needs_preparation'
  | 'publication_late'
  | 'email_delivery_failed'
  | 'invoice_missing'
  | 'stripe_event_failed'
  | 'stripe_event_stalled'
  | 'publication_ready'
  | 'publication_slot_upcoming'
  | 'financial_data_warning';

export type AdminAttentionSeverity =
  'urgent' | 'today' | 'this_week' | 'informational';

/**
 * How the admin UI should treat a suggested action. Iteration 1 only emits
 * `navigate` (open the existing admin screen). `prepare` and
 * `confirmation_required` are reserved for later iterations and must never
 * trigger a write on their own.
 */
export type AdminAttentionActionExecutionMode =
  'navigate' | 'prepare' | 'confirmation_required';

export interface AdminAttentionSuggestedAction {
  readonly actionType: string;
  readonly label: string;
  readonly executionMode: AdminAttentionActionExecutionMode;
}

export type AdminAttentionFactValue = string | number | boolean | null;

export interface AdminAttentionItem {
  readonly id: string;
  readonly type: AdminAttentionItemType;
  readonly severity: AdminAttentionSeverity;
  readonly title: string;
  readonly explanation: string;
  readonly sponsorshipId?: string;
  readonly contributionId?: string;
  readonly publicationId?: string;
  readonly emailQueueId?: string;
  readonly detectedAt: string;
  readonly dueAt?: string;
  readonly adminUrl?: string;
  /**
   * Minimal, non-sensitive facts backing the item. Never contains raw contact
   * emails, full addresses, follow-up tokens, Stripe secrets or SMTP secrets.
   */
  readonly facts: Record<string, AdminAttentionFactValue>;
  readonly suggestedActions: readonly AdminAttentionSuggestedAction[];
}

export interface AdminAssistantFinancialSummary {
  readonly grossPaid: number;
  readonly processingFees: number | null;
  readonly refunded: number;
  readonly netReceived: number | null;
  readonly currency: string;
  /** Human-readable caveats; used so no figure is presented as available cash. */
  readonly limitations: readonly string[];
}

export interface AdminAssistantSummary {
  readonly generatedAt: string;
  readonly counts: {
    readonly urgent: number;
    readonly today: number;
    readonly thisWeek: number;
    readonly informational: number;
  };
  readonly sponsorships: {
    readonly needsInfo: number;
    readonly needsReview: number;
    readonly approved: number;
  };
  readonly publications: {
    readonly needsPreparation: number;
    readonly scheduled: number;
    readonly late: number;
  };
  readonly emails: {
    readonly failed: number;
  };
  readonly financialSummary?: AdminAssistantFinancialSummary;
  readonly attentionItems: readonly AdminAttentionItem[];
}

export interface AdminAssistantQueryRequest {
  readonly sponsorshipId?: string;
  readonly message: string;
}

export type AdminAssistantAnswerBlockKind =
  'facts' | 'interpretation' | 'recommendation' | 'data_unavailable';

/**
 * Anti-hallucination contract: every answer is split into typed blocks so the
 * UI (and the reader) can always tell a tool-sourced fact from an
 * interpretation, a recommendation, or a "data unavailable" statement.
 */
export interface AdminAssistantAnswerBlock {
  readonly kind: AdminAssistantAnswerBlockKind;
  readonly title: string;
  readonly lines: readonly string[];
}

export interface AdminAssistantAnswerLink {
  readonly label: string;
  readonly adminUrl: string;
}

export interface AdminAssistantToolInvocationSummary {
  readonly tool: string;
  readonly resultCount: number;
}

export type AdminAssistantQueryStatus =
  | 'ok'
  | 'assistant_disabled'
  | 'provider_not_configured'
  | 'no_results'
  | 'timeout'
  | 'provider_error';

export interface AdminAssistantQueryResponse {
  readonly generatedAt: string;
  readonly mode: AdminAssistantMode;
  readonly enabled: boolean;
  readonly status: AdminAssistantQueryStatus;
  readonly answer: readonly AdminAssistantAnswerBlock[];
  readonly links: readonly AdminAssistantAnswerLink[];
  readonly toolInvocations: readonly AdminAssistantToolInvocationSummary[];
  readonly limitations: readonly string[];
  readonly provider: {
    readonly name: string;
    readonly model: string | null;
  };
}

// ============================================================================
// Admin AI assistant — iteration 2: preparatory drafts (generation only).
//
// The assistant may PREPARE draft content the administrator can review, but it
// NEVER persists, sends, publishes or executes anything. Every proposal is
// explicitly flagged as not sent / not published / not persisted, and always
// points to the existing admin screen where the human takes the real action.
// Refund preparation is intentionally out of scope for this iteration.
// ============================================================================

export type AdminAssistantDraftType =
  'sponsorship_reminder' | 'publication_draft' | 'admin_note' | 'slot_proposal';

export interface AdminAssistantDraftField {
  readonly label: string;
  readonly value: string;
}

export interface AdminAssistantDraftProposal {
  readonly type: AdminAssistantDraftType;
  readonly generatedAt: string;
  /** Public reference / admin id of the related record, never private data. */
  readonly reference: string | null;
  readonly title: string;
  readonly bodyLines: readonly string[];
  /** Structured extras (subject, channel, proposed date…). */
  readonly fields: readonly AdminAssistantDraftField[];
  readonly adminUrl: string;
  /** Human-readable, unmissable "nothing was sent/published" notice. */
  readonly notice: string;
  readonly limitations: readonly string[];
  readonly sent: false;
  readonly published: false;
  readonly persisted: false;
}

export interface AdminAssistantPrepareRequest {
  readonly language?: 'fr-CA' | 'en';
  readonly type: AdminAssistantDraftType;
  /** Sponsorship reference/id, or publication id for a slot proposal. */
  readonly reference?: string;
}

export type AdminAssistantPrepareStatus =
  'ok' | 'not_found' | 'not_applicable' | 'assistant_unavailable';

export interface AdminAssistantPrepareResponse {
  readonly delivery?: import('./admin-assistant-context.js').AdminInformationRequestPreview;
  readonly status: AdminAssistantPrepareStatus;
  readonly draft: AdminAssistantDraftProposal | null;
  readonly message: string | null;
}
