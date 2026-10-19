import { computed, signal } from '@angular/core';
import type {
  AdminAssistantContextResponse,
  AdminAssistantDraftType,
  AdminAssistantPrepareRequest,
  AdminAssistantPrepareResponse,
  AdminAssistantQueryRequest,
  AdminAssistantQueryResponse,
  AdminInformationRequest,
  AdminInformationRequestResult,
  AdminInformationRequestReceipt,
  AdminInformationRequestReceiptRequest
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
  readonly uncertainInformation?: AdminInformationRequest | null;
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
  storage?(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  newRequestId(): string | null;
  getInformationRequestReceipt(
    token: string,
    input: AdminInformationRequestReceiptRequest
  ): Promise<AdminInformationRequestReceipt>;
}

/** Exact dossier reads and explicit human actions; router, lifecycle and DOM stay in the facade. */
export class AdminAssistantContextController {
  readonly receiptRequest =
    signal<AdminInformationRequestReceiptRequest | null>(null);
  readonly informationReceipt = signal<Extract<
    AdminInformationRequestReceipt,
    { found: true }
  > | null>(null);
  readonly receiptState = signal<
    'idle' | 'checking' | 'notFound' | 'unavailable'
  >('idle');
  readonly canVerifyReceipt = computed(
    () =>
      !!this.receiptRequest() &&
      this.informationUncertain() &&
      this.ports.canPrepare() &&
      this.ports.hasValidSession() &&
      !this.busy() &&
      this.receiptState() !== 'checking'
  );
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
  readonly uncertainInformation = signal<AdminInformationRequest | null>(null);
  private readonly retainedInformationMarker = signal(false);
  readonly informationUncertain = computed(
    () => this.retainedInformationMarker() || !!this.uncertainInformation()
  );
  readonly subject = signal('');
  readonly body = signal('');
  readonly question = signal('');
  readonly canPrepare = computed(
    () => this.ports.canPrepare() && !this.informationUncertain()
  );
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
          question: this.question(),
          uncertainInformation: this.uncertainInformation()
        }
      : null;
  });
  private generation = 0;
  private readonly pendingInformation = new Map<
    string,
    AdminInformationRequest
  >();
  private informationScope = '';

  constructor(private readonly ports: AdminAssistantContextPorts) {}

  private current(generation: number): boolean {
    return generation === this.generation && !this.ports.isDestroyed();
  }

  async load(snapshot: AssistantContextSnapshot | null = null): Promise<void> {
    const generation = ++this.generation;
    const scope = this.informationKey('');
    if (scope !== this.informationScope) {
      this.pendingInformation.clear();
      this.informationScope = scope;
    }
    this.clearPrivate();
    this.error.set('');
    this.busy.set(false);
    this.state.set('loading');
    this.restoreUncertainInformation(this.ports.sponsorshipId());
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
      this.restoreUncertainInformation(context?.contributionId);
      if (
        snapshot &&
        context &&
        snapshot.contributionId === context.contributionId &&
        snapshot.sessionGeneration === this.ports.sessionGeneration() &&
        snapshot.identityId === this.ports.identityId()
      ) {
        this.question.set(snapshot.question);
        if (
          snapshot.uncertainInformation?.contributionId ===
            context.contributionId &&
          this.ports.canPrepare()
        ) {
          const input = snapshot.uncertainInformation;
          this.pendingInformation.set(
            this.informationKey(context.contributionId),
            input
          );
          this.uncertainInformation.set(input);
          this.receiptRequest.set({
            contributionId: input.contributionId,
            requestId: input.requestId
          });
          this.subject.set(input.subject);
          this.body.set(input.body);
        }
        if (snapshot.version === context.version) {
          this.answer.set(snapshot.answer);
          if (this.canPrepare()) {
            this.prepared.set(snapshot.prepared);
            this.subject.set(snapshot.subject);
            this.body.set(snapshot.body);
          }
        } else if (snapshot.prepared && !this.uncertainInformation())
          this.error.set('conflict');
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
    let requestId: string | null;
    try {
      requestId = this.ports.newRequestId();
    } catch {
      requestId = null;
    }
    if (!requestId || !this.validRequestId(requestId)) {
      this.error.set('actionError');
      return;
    }
    this.confirmation.set({
      ...preview,
      requestId,
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
    const key = this.informationKey(input.contributionId);
    this.pendingInformation.set(key, input);
    this.setInformationMarker(input.contributionId, true, key, input.requestId);
    this.receiptRequest.set({
      requestId: input.requestId,
      contributionId: input.contributionId
    });
    // Keep the confirmed payload even if navigation starts while the POST is pending.
    this.uncertainInformation.set(input);
    await this.act(async () => {
      let result: AdminInformationRequestResult;
      try {
        result = await this.ports.requestSponsorshipInformation(
          this.ports.token(),
          input
        );
      } catch (error) {
        if (
          error instanceof AdminDashboardRequestError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408 &&
          error.code !== 'INFORMATION_REQUEST_ID_CONFLICT'
        ) {
          this.pendingInformation.delete(key);
          this.setInformationMarker(
            input.contributionId,
            false,
            key,
            input.requestId
          );
          if (
            !this.ports.isDestroyed() &&
            this.informationKey(this.currentContributionId() ?? '') === key
          )
            this.uncertainInformation.set(null);
        }
        throw error;
      }
      if (!this.validReceipt(result, input))
        throw new Error('Information receipt does not match this request.');
      if (!['sending', 'uncertain'].includes(result.deliveryStatus)) {
        this.pendingInformation.delete(key);
        this.setInformationMarker(
          input.contributionId,
          false,
          key,
          input.requestId
        );
      }
      return () => {
        this.applyInformationReceipt(
          { ...result, found: true, contributionId: input.contributionId },
          key,
          result
        );
      };
    });
  }

  async verifyInformationReceipt(): Promise<boolean> {
    const request = this.receiptRequest();
    if (!request || !this.canVerifyReceipt()) return false;
    const generation = this.generation;
    const key = this.informationKey(request.contributionId);
    const current = () =>
      this.current(generation) &&
      this.ports.hasValidSession() &&
      this.ports.canPrepare() &&
      key === this.informationKey(this.currentContributionId() ?? '') &&
      this.receiptRequest()?.requestId === request.requestId;
    this.receiptState.set('checking');
    try {
      const receipt = await this.ports.getInformationRequestReceipt(
        this.ports.token(),
        request
      );
      if (!current()) return false;
      if (
        receipt.requestId !== request.requestId.toLowerCase() ||
        receipt.contributionId !== request.contributionId
      )
        throw new Error('Mismatched information receipt.');
      if (receipt.found === false) {
        this.receiptState.set('notFound');
        return false;
      }
      if (receipt.found !== true)
        throw new Error('Invalid information receipt result.');
      if (!this.validReceipt(receipt, request))
        throw new Error('Incomplete information receipt.');
      this.applyInformationReceipt(receipt, key);
      this.receiptState.set('idle');
      return true;
    } catch (error) {
      if (!current()) return false;
      this.receiptState.set('unavailable');
      if (
        error instanceof AdminDashboardRequestError &&
        (error.status === 401 || error.status === 403)
      )
        await this.handleError(error);
      return false;
    } finally {
      if (current() && this.receiptState() === 'checking')
        this.receiptState.set('idle');
    }
  }

  private validRequestId(value: string): boolean {
    return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
  }

  private validReceipt(
    receipt:
      | Extract<AdminInformationRequestReceipt, { found: true }>
      | AdminInformationRequestResult,
    request: { requestId: string }
  ): boolean {
    const date = (value: unknown) =>
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value;
    return (
      receipt.requestId === request.requestId.toLowerCase() &&
      typeof receipt.messageId === 'string' &&
      this.validRequestId(receipt.messageId) &&
      date(receipt.acceptedAt) &&
      ['queued', 'sending', 'sent', 'failed', 'uncertain'].includes(
        receipt.deliveryStatus
      ) &&
      (receipt.sentAt === null || date(receipt.sentAt))
    );
  }

  private applyInformationReceipt(
    receipt: Extract<AdminInformationRequestReceipt, { found: true }>,
    key: string,
    result?: AdminInformationRequestResult
  ): void {
    this.informationReceipt.set(receipt);
    this.delivery.set(
      result ?? {
        ...receipt,
        status:
          receipt.deliveryStatus === 'sent'
            ? 'already_sent'
            : receipt.deliveryStatus === 'failed'
              ? 'delivery_failed'
              : 'already_queued'
      }
    );
    if (!['sending', 'uncertain'].includes(receipt.deliveryStatus)) {
      this.pendingInformation.delete(key);
      this.setInformationMarker(
        receipt.contributionId,
        false,
        key,
        receipt.requestId
      );
      this.uncertainInformation.set(null);
      this.receiptRequest.set(null);
      this.prepared.set(null);
      this.subject.set('');
      this.body.set('');
    }
    void this.ports.refreshWorkQueue();
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
    this.receiptRequest.set(null);
    this.informationReceipt.set(null);
    this.receiptState.set('idle');
    this.ports.closeConfirmation();
    this.confirmation.set(null);
    this.uncertainInformation.set(null);
    this.retainedInformationMarker.set(false);
    this.data.set(null);
    this.prepared.set(null);
    this.answer.set(null);
    this.delivery.set(null);
    this.subject.set('');
    this.body.set('');
    this.question.set('');
  }

  private informationKey(contributionId: string): string {
    return JSON.stringify([
      this.ports.identityId(),
      this.ports.sessionGeneration(),
      contributionId
    ]);
  }

  private restoreUncertainInformation(contributionId?: string): void {
    if (!contributionId) return;
    try {
      const marker = this.ports
        .storage?.()
        ?.getItem(this.informationStorageKey(contributionId));
      this.retainedInformationMarker.set(!!marker);
      if (marker && this.validRequestId(marker))
        this.receiptRequest.set({ contributionId, requestId: marker });
    } catch {
      // The exact in-memory payload still prevents a second logical request.
    }
    if (!this.ports.canPrepare()) return;
    const input = this.pendingInformation.get(
      this.informationKey(contributionId)
    );
    if (input) {
      this.receiptRequest.set({ contributionId, requestId: input.requestId });
      this.uncertainInformation.set(input);
      this.subject.set(input.subject);
      this.body.set(input.body);
    }
  }

  private informationStorageKey(contributionId: string): string {
    return 'openg7-assistant-information-pending:' + contributionId;
  }

  private currentContributionId(): string | undefined {
    return this.ports.sponsorshipId() ?? this.data()?.context?.contributionId;
  }

  private setInformationMarker(
    contributionId: string,
    pending: boolean,
    requestKey: string,
    requestId: string
  ): void {
    let retained = pending;
    try {
      const storage = this.ports.storage?.();
      const key = this.informationStorageKey(contributionId);
      if (pending) storage?.setItem(key, requestId);
      else {
        const stored = storage?.getItem(key);
        if (stored === requestId) storage?.removeItem(key);
        else if (stored) retained = true;
      }
    } catch {
      // No recipient, body or credential is persisted; memory is the fallback.
    }
    if (
      !this.ports.isDestroyed() &&
      contributionId === this.currentContributionId() &&
      requestKey === this.informationKey(contributionId)
    )
      this.retainedInformationMarker.set(retained);
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
      this.pendingInformation.clear();
      this.clearPrivate();
      this.state.set('forbidden');
      if (status === 401) await this.ports.onUnauthorized();
    } else if (status === 409) {
      this.prepared.set(null);
      this.error.set('conflict');
    } else if (action) this.error.set('actionError');
  }
}
