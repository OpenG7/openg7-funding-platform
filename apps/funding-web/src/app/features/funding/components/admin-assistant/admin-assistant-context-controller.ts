import { computed, signal } from '@angular/core';
import type {
  AdminAssistantContextResponse,
  AdminAssistantDraftType,
  AdminAssistantPrepareRequest,
  AdminAssistantPrepareResponse,
  AdminAssistantQueryRequest,
  AdminAssistantQueryResponse,
  AdminInformationRequest,
  AdminInformationRequestResult
} from '@openg7/funding-core';

import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import type { FundingLanguage } from '../../services/funding-i18n.service.js';

export interface AssistantContextSnapshot {
  readonly contributionId: string;
  readonly version: string;
  readonly sessionGeneration: number;
  readonly identityId: string | null;
  readonly prepared: AdminAssistantPrepareResponse | null;
  readonly answer: AdminAssistantQueryResponse | null;
  readonly subject: string;
  readonly body: string;
  readonly question: string;
}

/** One-use, in-memory handoff. The facade passes it through router navigation info. */
export class AssistantContextNavigation {
  constructor(private snapshot: AssistantContextSnapshot | null) {}

  take(): AssistantContextSnapshot | null {
    const snapshot = this.snapshot;
    this.snapshot = null;
    return snapshot;
  }
}

export interface AdminAssistantContextPorts {
  sponsorshipId(): string | undefined;
  hasValidSession(): boolean;
  token(): string;
  canPrepare(): boolean;
  sessionGeneration(): number;
  identityId(): string | null;
  isDestroyed(): boolean;
  language(): FundingLanguage;
  getAssistantContext(
    token: string,
    sponsorshipId?: string
  ): Promise<AdminAssistantContextResponse>;
  prepareAssistantDraft(
    token: string,
    payload: AdminAssistantPrepareRequest
  ): Promise<AdminAssistantPrepareResponse>;
  queryAssistant(
    token: string,
    payload: AdminAssistantQueryRequest
  ): Promise<AdminAssistantQueryResponse>;
  requestSponsorshipInformation(
    token: string,
    payload: AdminInformationRequest
  ): Promise<AdminInformationRequestResult>;
  refreshWorkQueue(): Promise<void>;
  onUnauthorized(): Promise<void>;
  closeConfirmation(): void;
  openConfirmation(): void;
}

/** Exact dossier reads and explicit human actions; router, lifecycle and DOM stay in the facade. */
export class AdminAssistantContextController {
  readonly data = signal<AdminAssistantContextResponse | null>(null);
  readonly state = signal<'loading' | 'ready' | 'error' | 'forbidden'>(
    'loading'
  );
  readonly busy = signal(false);
  readonly error = signal('');
  readonly prepared = signal<AdminAssistantPrepareResponse | null>(null);
  readonly answer = signal<AdminAssistantQueryResponse | null>(null);
  readonly delivery = signal<AdminInformationRequestResult | null>(null);
  readonly confirmation = signal<AdminInformationRequest | null>(null);
  readonly subject = signal('');
  readonly body = signal('');
  readonly question = signal('');
  readonly canPrepare = computed(() => this.ports.canPrepare());
  readonly snapshot = computed<AssistantContextSnapshot | null>(() => {
    const context = this.data()?.context;
    return context
      ? {
          contributionId: context.contributionId,
          version: context.version,
          sessionGeneration: this.ports.sessionGeneration(),
          identityId: this.ports.identityId(),
          prepared: this.prepared(),
          answer: this.answer(),
          subject: this.subject(),
          body: this.body(),
          question: this.question()
        }
      : null;
  });
  private generation = 0;

  constructor(private readonly ports: AdminAssistantContextPorts) {}

  private current(generation: number): boolean {
    return generation === this.generation && !this.ports.isDestroyed();
  }

  async load(snapshot: AssistantContextSnapshot | null = null): Promise<void> {
    const generation = ++this.generation;
    this.clearPrivate();
    this.error.set('');
    this.busy.set(false);
    this.state.set('loading');
    try {
      if (!this.ports.hasValidSession())
        throw new AdminDashboardRequestError(401);
      const data = await this.ports.getAssistantContext(
        this.ports.token(),
        this.ports.sponsorshipId()
      );
      if (!this.current(generation)) return;
      this.data.set(data);
      this.state.set('ready');
      const context = data.context;
      if (
        snapshot &&
        context &&
        snapshot.contributionId === context.contributionId &&
        snapshot.sessionGeneration === this.ports.sessionGeneration() &&
        snapshot.identityId === this.ports.identityId()
      ) {
        this.question.set(snapshot.question);
        if (snapshot.version === context.version) {
          this.answer.set(snapshot.answer);
          if (this.canPrepare()) {
            this.prepared.set(snapshot.prepared);
            this.subject.set(snapshot.subject);
            this.body.set(snapshot.body);
          }
        } else if (snapshot.prepared) this.error.set('conflict');
      }
    } catch (error) {
      if (this.current(generation)) {
        this.state.set('error');
        await this.handleError(error, false);
      }
    }
  }

  async prepare(type: AdminAssistantDraftType): Promise<void> {
    const context = this.data()?.context;
    if (!context || this.busy() || !this.canPrepare()) return;
    this.prepared.set(null);
    this.delivery.set(null);
    await this.act(async () => {
      const result = await this.ports.prepareAssistantDraft(
        this.ports.token(),
        {
          type,
          reference: context.contributionId,
          language: this.ports.language()
        }
      );
      return () => {
        this.prepared.set(result);
        this.subject.set(result.delivery?.subject ?? '');
        this.body.set(result.delivery?.body ?? '');
      };
    });
  }

  reviewSend(): void {
    const preview = this.prepared()?.delivery;
    if (
      !preview ||
      !this.canPrepare() ||
      this.busy() ||
      !this.subject().trim() ||
      !this.body().trim()
    )
      return;
    this.confirmation.set({
      ...preview,
      subject: this.subject().trim(),
      body: this.body().trim(),
      confirmed: true
    });
    this.ports.openConfirmation();
  }

  cancelSend(): void {
    this.ports.closeConfirmation();
    this.confirmation.set(null);
  }

  async send(): Promise<void> {
    const input = this.confirmation();
    if (!input || this.busy() || !this.canPrepare()) return;
    this.cancelSend();
    await this.act(async () => {
      const result = await this.ports.requestSponsorshipInformation(
        this.ports.token(),
        input
      );
      return () => {
        this.delivery.set(result);
        void this.ports.refreshWorkQueue();
        this.prepared.set(null);
        this.subject.set('');
        this.body.set('');
      };
    });
  }

  async ask(): Promise<void> {
    const context = this.data()?.context;
    if (
      !context ||
      !this.question().trim() ||
      this.busy() ||
      this.data()?.conversationMode === 'disabled'
    )
      return;
    this.answer.set(null);
    await this.act(async () => {
      const answer = await this.ports.queryAssistant(this.ports.token(), {
        message: this.question().trim(),
        sponsorshipId: context.contributionId
      });
      return () => this.answer.set(answer);
    });
  }

  private async act(work: () => Promise<() => void>): Promise<void> {
    const generation = this.generation;
    this.busy.set(true);
    this.error.set('');
    try {
      const apply = await work();
      if (this.current(generation)) apply();
    } catch (error) {
      if (this.current(generation)) await this.handleError(error);
    } finally {
      if (this.current(generation)) this.busy.set(false);
    }
  }

  private clearPrivate(): void {
    this.ports.closeConfirmation();
    this.confirmation.set(null);
    this.data.set(null);
    this.prepared.set(null);
    this.answer.set(null);
    this.delivery.set(null);
    this.subject.set('');
    this.body.set('');
    this.question.set('');
  }

  private async handleError(error: unknown, action = true): Promise<void> {
    const status =
      error instanceof AdminDashboardRequestError ? error.status : 0;
    if (status === 403 && action) {
      // An action can be forbidden while the dossier remains readable.
      // Recheck access before showing facts; discard the rejected private draft.
      const generation = this.generation + 1;
      await this.load();
      if (
        this.current(generation) &&
        this.state() === 'ready' &&
        this.data()?.context
      )
        this.error.set('actionForbidden');
      return;
    }
    if (status === 401 || status === 403) {
      this.clearPrivate();
      this.state.set('forbidden');
      if (status === 401) await this.ports.onUnauthorized();
    } else if (status === 409) {
      this.prepared.set(null);
      this.error.set('conflict');
    } else if (action) this.error.set('actionError');
  }
}
