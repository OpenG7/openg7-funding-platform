import { computed, signal } from '@angular/core';
import type {
  AdminEmailQueueMessageRecord,
  AdminEmailQueueResponse
} from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';

import { filterEmailQueueMessages } from './admin-email-queue-presentation.js';
import type {
  EmailQueueLoadState,
  EmailQueueRetryState,
  EmailQueueStatusFilter
} from './admin-email-queue-presentation.js';

export interface AdminEmailQueuePorts {
  readonly admin: Pick<
    FundingAdminService,
    'getEmailQueue' | 'retryEmailQueueMessage' | 'reconcileEmailDelivery'
  >;
  token(): string;
  t(key: string, params?: Record<string, unknown>): string;
  confirm(message: string, detail: string): Promise<boolean>;
}

/** Queue consultation and confirmed recovery; navigation and inspection belong to the page. */
export class AdminEmailQueueController {
  readonly targetId = signal<string | undefined>(undefined);
  readonly state = signal<EmailQueueLoadState>('idle');
  readonly errorMessage;
  readonly queue = signal<AdminEmailQueueResponse | null>(null);
  readonly statusFilter = signal<EmailQueueStatusFilter>('all');
  readonly search = signal('');
  readonly retryStates = signal<Record<string, EmailQueueRetryState>>({});
  readonly retryMessages = signal<Record<string, string>>({});
  readonly messages = computed(() => this.queue()?.messages ?? []);
  readonly filteredMessages = computed(() =>
    filterEmailQueueMessages(
      this.messages(),
      this.statusFilter(),
      this.search()
    )
  );
  private requestGeneration = 0;
  private scope = 0;
  private disposed = false;
  private readonly activeRetries = new Set<string>();
  private readonly uncertainRetries = new Set<string>();

  constructor(private readonly ports: AdminEmailQueuePorts) {
    this.errorMessage = signal(
      ports.t('admin.messages.impossible_de_charger_la_file_courriel')
    );
  }

  setTarget(messageId: string | undefined): void {
    if (this.disposed) return;
    this.scope++;
    this.requestGeneration++;
    this.targetId.set(messageId);
    this.queue.set(null);
    this.state.set('idle');
    this.search.set('');
    this.statusFilter.set('all');
    this.retryStates.set({});
    this.retryMessages.set({});
  }

  dispose(): void {
    this.disposed = true;
    this.scope++;
    this.requestGeneration++;
  }

  async loadEmailQueue(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.requestGeneration;
    this.state.set('loading');
    try {
      const result = await this.ports.admin.getEmailQueue(
        this.ports.token(),
        this.targetId()
      );
      if (!this.currentRequest(generation)) return;
      this.queue.set(result);
      this.state.set('ready');
      this.errorMessage.set('');
    } catch (error) {
      if (!this.currentRequest(generation)) return;
      this.state.set('error');
      this.errorMessage.set(this.messageFromError(error));
    }
  }

  async retryMessage(message: AdminEmailQueueMessageRecord): Promise<void> {
    if (
      this.disposed ||
      (this.targetId() && this.targetId() !== message.id) ||
      message.status === 'sent' ||
      message.status === 'uncertain' ||
      message.status === 'sending' ||
      this.activeRetries.has(message.id) ||
      this.messages().some(
        (current) =>
          current.id === message.id &&
          ['sent', 'sending', 'uncertain'].includes(current.status)
      )
    )
      return;

    const scope = this.scope;
    let candidate = message;
    this.activeRetries.add(message.id);
    this.setRetryState(message.id, 'confirming');
    try {
      if (this.uncertainRetries.has(message.id)) {
        // An unanswered POST must be reconciled in reading before a new confirmed attempt.
        const current = await this.loadUncertainMessage(message.id);
        if (!this.currentScope(scope)) return;
        if (!current) {
          this.setRetryState(message.id, 'error');
          return;
        }
        this.uncertainRetries.delete(message.id);
        if (
          current.status === 'sent' ||
          current.status === 'sending' ||
          current.status === 'uncertain'
        ) {
          this.setRetryState(
            message.id,
            current.status === 'sent' ? 'sent' : 'idle'
          );
          this.setRetryMessage(
            message.id,
            this.ports.t(
              current.status === 'sent'
                ? 'admin.messages.message_envoye'
                : current.status === 'uncertain'
                  ? 'admin.emailDelivery.explanation'
                  : 'admin.messages.courriel_deja_en_cours'
            )
          );
          return;
        }
        candidate = current;
      }
      const confirmed = await this.ports.confirm(
        this.ports.t('admin.confirmation.retryEmail'),
        candidate.recipient_email
      );
      if (!this.currentScope(scope)) return;
      if (
        !confirmed ||
        this.messages().some(
          (current) =>
            current.id === message.id &&
            ['sent', 'sending', 'uncertain'].includes(current.status)
        )
      ) {
        this.setRetryState(message.id, 'idle');
        return;
      }

      this.setRetryState(message.id, 'sending');
      this.setRetryMessage(message.id, '');
      this.uncertainRetries.add(message.id);
      const result = await this.ports.admin.retryEmailQueueMessage(
        this.ports.token(),
        { messageId: message.id }
      );
      if (!this.currentScope(scope)) return;
      this.uncertainRetries.delete(message.id);

      // A consultation begun before the accepted operation cannot replace its result.
      this.requestGeneration++;
      if (result.message) this.replaceMessage(result.message);
      const sent = result.sent > 0 || result.message?.status === 'sent';
      const inProgress = result.message?.status === 'sending';
      this.setRetryState(
        message.id,
        sent ? 'sent' : inProgress ? 'idle' : 'error'
      );
      this.setRetryMessage(
        message.id,
        sent
          ? this.ports.t('admin.messages.message_envoye')
          : inProgress
            ? this.ports.t('admin.messages.courriel_deja_en_cours')
            : result.attempted > 0
              ? this.ports.t(
                  'admin.messages.relance_tentee_le_message_reste_en_echec'
                )
              : this.ports.t('admin.messages.aucune_tentative_effectuee')
      );
      // Totals always come from a fresh server snapshot, retaining the target and filters.
      await this.loadEmailQueue();
    } catch (error) {
      if (!this.currentScope(scope)) return;
      this.setRetryState(message.id, 'error');
      this.setRetryMessage(message.id, this.messageFromError(error));
    } finally {
      this.activeRetries.delete(message.id);
    }
  }

  async reconcileMessage(
    message: AdminEmailQueueMessageRecord,
    outcome: 'sent' | 'not_sent',
    evidenceReference: string
  ): Promise<void> {
    if (
      this.disposed ||
      message.status !== 'uncertain' ||
      this.activeRetries.has(message.id) ||
      (this.targetId() && this.targetId() !== message.id)
    )
      return;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(evidenceReference)) {
      this.setRetryState(message.id, 'error');
      this.setRetryMessage(
        message.id,
        this.ports.t('admin.emailDelivery.invalidEvidence')
      );
      return;
    }
    const scope = this.scope;
    this.activeRetries.add(message.id);
    this.setRetryState(message.id, 'confirming');
    try {
      const confirmed = await this.ports.confirm(
        this.ports.t(
          outcome === 'sent'
            ? 'admin.emailDelivery.confirmSent'
            : 'admin.emailDelivery.confirmNotSent'
        ),
        `${message.id} ? ${evidenceReference}`
      );
      if (!this.currentScope(scope)) return;
      if (!confirmed) {
        this.setRetryState(message.id, 'idle');
        return;
      }
      this.setRetryState(message.id, 'sending');
      const result = await this.ports.admin.reconcileEmailDelivery(
        this.ports.token(),
        {
          messageId: message.id,
          expectedUpdatedAt: message.updated_at,
          confirmation: message.id,
          outcome,
          evidenceReference
        }
      );
      if (!this.currentScope(scope)) return;
      this.requestGeneration++;
      if (result.message) this.replaceMessage(result.message);
      this.setRetryState(
        message.id,
        result.message?.status === 'sent' ? 'sent' : 'idle'
      );
      this.setRetryMessage(
        message.id,
        this.ports.t('admin.emailDelivery.reconciled')
      );
      await this.loadEmailQueue();
    } catch (error) {
      if (!this.currentScope(scope)) return;
      this.setRetryState(message.id, 'error');
      this.setRetryMessage(message.id, this.messageFromError(error));
      // A lost mutation response requires a fresh read, never automatic resubmission.
      await this.loadEmailQueue();
    } finally {
      this.activeRetries.delete(message.id);
    }
  }

  retryStateFor(id: string): EmailQueueRetryState {
    return this.retryStates()[id] ?? 'idle';
  }

  retryMessageFor(id: string): string {
    return this.retryMessages()[id] ?? '';
  }

  private async loadUncertainMessage(
    id: string
  ): Promise<AdminEmailQueueMessageRecord | null> {
    const generation = ++this.requestGeneration;
    this.state.set('loading');
    try {
      const result = await this.ports.admin.getEmailQueue(
        this.ports.token(),
        id
      );
      if (!this.currentRequest(generation)) return null;
      const message = result.messages.find((item) => item.id === id) ?? null;
      const previous = this.queue();
      this.queue.set(
        this.targetId() || !previous
          ? result
          : {
              ...result,
              messages: previous.messages.map((item) =>
                item.id === id && message ? message : item
              )
            }
      );
      this.state.set('ready');
      this.errorMessage.set('');
      return message;
    } catch (error) {
      if (this.currentRequest(generation)) {
        this.state.set('error');
        this.errorMessage.set(this.messageFromError(error));
      }
      return null;
    }
  }

  private replaceMessage(message: AdminEmailQueueMessageRecord): void {
    const current = this.queue();
    if (!current?.messages.some((candidate) => candidate.id === message.id))
      return;
    this.queue.set({
      ...current,
      messages: current.messages.map((candidate) =>
        candidate.id === message.id ? message : candidate
      )
    });
  }

  private setRetryState(id: string, state: EmailQueueRetryState): void {
    this.retryStates.update((states) => ({ ...states, [id]: state }));
  }

  private setRetryMessage(id: string, message: string): void {
    this.retryMessages.update((messages) => ({ ...messages, [id]: message }));
  }

  private messageFromError(error: unknown): string {
    return error instanceof Error
      ? error.message
      : this.ports.t('admin.messages.operation_admin_impossible');
  }

  private currentScope(scope: number): boolean {
    return !this.disposed && scope === this.scope;
  }

  private currentRequest(generation: number): boolean {
    return !this.disposed && generation === this.requestGeneration;
  }
}
