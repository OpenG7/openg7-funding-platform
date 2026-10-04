import { computed, signal } from '@angular/core';
import type {
  AdminAssistantDraftType,
  AdminAssistantMode,
  AdminAssistantPrepareResponse,
  AdminAssistantQueryResponse,
  AdminAssistantSummary,
  AdminAttentionItem,
  AdminWorkQueueQuery,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';
import type { FundingLanguage } from '../../services/funding-i18n.service.js';

import type { AssistantLoadState } from './admin-assistant.contracts.js';

export interface AdminAssistantPorts {
  readonly admin: Pick<
    FundingAdminService,
    | 'getWorkQueue'
    | 'prepareAssistantDraft'
    | 'getAssistantSummary'
    | 'getAssistantContext'
    | 'queryAssistant'
  >;
  token(): string;
  canPrepare(): boolean;
  language(): FundingLanguage;
  onSessionExpired(): void | Promise<void>;
}

const DRAFT_TYPES: Readonly<Record<string, AdminAssistantDraftType>> = {
  prepare_reminder: 'sponsorship_reminder',
  prepare_publication: 'publication_draft',
  prepare_note: 'admin_note',
  propose_slot: 'slot_proposal'
};

/** Private overview reads and draft preparation; route, scroll and focus belong to the page. */
export class AdminAssistantController {
  readonly selectedId = signal<string | null>(null);
  readonly selected = signal<AdminAttentionItem | null>(null);
  readonly detailState = signal<AssistantLoadState>('idle');
  readonly query = signal<AdminWorkQueueQuery>({});
  readonly data = signal<AdminWorkQueueResponse | null>(null);
  readonly state = signal<AssistantLoadState>('idle');
  readonly summary = signal<AdminAssistantSummary | null>(null);
  readonly summaryState = signal<AssistantLoadState>('idle');
  readonly conversationMode = signal<AdminAssistantMode | null>(null);
  readonly conversationState = signal<AssistantLoadState>('idle');
  readonly question = signal('');
  readonly answer = signal<AdminAssistantQueryResponse | null>(null);
  readonly answerState = signal<AssistantLoadState>('idle');
  readonly prepared = signal<AdminAssistantPrepareResponse | null>(null);
  readonly draftState = signal<AssistantLoadState>('idle');
  readonly canPrepare = computed(() => this.ports.canPrepare());
  private generation = 0;
  private detailGeneration = 0;
  private draftGeneration = 0;
  private privacyGeneration = 0;
  private queryKey = '';
  private overviewActive = true;
  private disposed = false;

  constructor(private readonly ports: AdminAssistantPorts) {}

  setOverview(query: AdminWorkQueueQuery, selectedId: string | null): void {
    if (this.disposed) return;
    this.overviewActive = true;
    const key = JSON.stringify(query);
    const changed = key !== this.queryKey;
    if (changed) {
      this.queryKey = key;
      this.query.set({ ...query });
    }
    const selectionChanged = selectedId !== this.selectedId();
    if (selectionChanged) {
      this.selectedId.set(selectedId);
      this.selected.set(null);
      this.detailState.set('idle');
      this.clearDraft();
      this.detailGeneration++;
    }
    if (changed) void this.load();
    if (selectionChanged && selectedId) void this.loadDetail(selectedId);
  }

  leaveOverview(): void {
    if (this.disposed) return;
    this.overviewActive = false;
    this.generation++;
    this.detailGeneration++;
    this.queryKey = '';
    this.query.set({});
    this.data.set(null);
    this.selectedId.set(null);
    this.selected.set(null);
    this.state.set('idle');
    this.detailState.set('idle');
    this.clearDraft();
  }

  async load(): Promise<void> {
    if (this.disposed || !this.overviewActive) return;
    const generation = ++this.generation;
    this.state.set('loading');
    try {
      const result = await this.ports.admin.getWorkQueue(
        this.ports.token(),
        this.query()
      );
      if (!this.current(generation, this.generation)) return;
      this.data.set(result.available ? result : null);
      this.state.set(result.available ? 'ready' : 'unavailable');
    } catch (error) {
      if (!this.current(generation, this.generation)) return;
      await this.handleError(error, this.state);
    }
  }

  refresh(): void {
    if (this.disposed || !this.overviewActive) return;
    void this.load();
    const id = this.selectedId();
    if (id) void this.loadDetail(id);
  }

  private async loadDetail(id: string): Promise<void> {
    const generation = ++this.detailGeneration;
    this.detailState.set('loading');
    this.clearDraft();
    try {
      const result = await this.ports.admin.getWorkQueue(this.ports.token(), {
        itemId: id,
        pageSize: 1
      });
      if (!this.current(generation, this.detailGeneration)) return;
      this.selected.set(result.available ? (result.items[0] ?? null) : null);
      this.detailState.set(result.available ? 'ready' : 'unavailable');
    } catch (error) {
      if (!this.current(generation, this.detailGeneration)) return;
      await this.handleError(error, this.detailState);
    }
  }

  prepareType(item: AdminAttentionItem): AdminAssistantDraftType | undefined {
    const action = item.suggestedActions.find(
      (candidate) => candidate.executionMode === 'prepare'
    );
    return action ? DRAFT_TYPES[action.actionType] : undefined;
  }

  async prepare(item: AdminAttentionItem): Promise<void> {
    const type = this.prepareType(item);
    if (
      this.disposed ||
      !this.overviewActive ||
      !type ||
      !this.canPrepare() ||
      this.draftState() === 'loading' ||
      this.detailState() !== 'ready' ||
      this.selected()?.id !== item.id
    )
      return;
    const generation = ++this.draftGeneration;
    this.draftState.set('loading');
    this.prepared.set(null);
    try {
      const result = await this.ports.admin.prepareAssistantDraft(
        this.ports.token(),
        {
          type,
          reference:
            item.sponsorshipId ??
            item.publicationId ??
            String(item.facts['reference'] ?? ''),
          language: this.ports.language()
        }
      );
      if (!this.current(generation, this.draftGeneration)) return;
      this.prepared.set(result);
      this.draftState.set('ready');
    } catch (error) {
      if (!this.current(generation, this.draftGeneration)) return;
      await this.handleError(error, this.draftState);
    }
  }

  async loadSummary(opened: boolean): Promise<void> {
    if (
      this.disposed ||
      !opened ||
      this.summaryState() === 'loading' ||
      this.summaryState() === 'ready'
    )
      return;
    const generation = this.privacyGeneration;
    this.summaryState.set('loading');
    try {
      const summary = await this.ports.admin.getAssistantSummary(
        this.ports.token()
      );
      if (!this.current(generation, this.privacyGeneration)) return;
      this.summary.set(summary);
      this.summaryState.set('ready');
    } catch (error) {
      if (!this.current(generation, this.privacyGeneration)) return;
      await this.handleError(error, this.summaryState);
    }
  }

  async loadConversation(opened: boolean): Promise<void> {
    if (
      this.disposed ||
      !opened ||
      this.conversationState() === 'loading' ||
      this.conversationState() === 'ready'
    )
      return;
    const generation = this.privacyGeneration;
    this.conversationState.set('loading');
    try {
      const response = await this.ports.admin.getAssistantContext(
        this.ports.token()
      );
      if (!this.current(generation, this.privacyGeneration)) return;
      this.conversationMode.set(response.conversationMode);
      this.conversationState.set('ready');
    } catch (error) {
      if (!this.current(generation, this.privacyGeneration)) return;
      await this.handleError(error, this.conversationState);
    }
  }

  async ask(): Promise<void> {
    const message = this.question().trim();
    if (
      this.disposed ||
      !message ||
      this.answerState() === 'loading' ||
      !this.conversationMode() ||
      this.conversationMode() === 'disabled'
    )
      return;
    const generation = this.privacyGeneration;
    this.answerState.set('loading');
    this.answer.set(null);
    try {
      const response = await this.ports.admin.queryAssistant(
        this.ports.token(),
        {
          message
        }
      );
      if (!this.current(generation, this.privacyGeneration)) return;
      this.answer.set(response);
      this.answerState.set('ready');
    } catch (error) {
      if (!this.current(generation, this.privacyGeneration)) return;
      await this.handleError(error, this.answerState);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.overviewActive = false;
    this.clearPrivateData('idle');
    this.queryKey = '';
    this.query.set({});
    this.selectedId.set(null);
  }

  private current(generation: number, active: number): boolean {
    return !this.disposed && generation === active;
  }

  private clearDraft(): void {
    this.draftGeneration++;
    this.prepared.set(null);
    this.draftState.set('idle');
  }

  /** Invalidate every pending private read before removing data on access denial or destruction. */
  private clearPrivateData(state: AssistantLoadState): void {
    this.generation++;
    this.detailGeneration++;
    this.privacyGeneration++;
    this.data.set(null);
    this.selected.set(null);
    this.clearDraft();
    this.summary.set(null);
    this.answer.set(null);
    this.question.set('');
    this.conversationMode.set(null);
    this.state.set(state);
    this.detailState.set(state);
    this.summaryState.set('idle');
    this.conversationState.set('idle');
    this.answerState.set('idle');
  }

  private async handleError(
    error: unknown,
    state: { set(value: AssistantLoadState): void }
  ): Promise<void> {
    const status =
      error instanceof AdminDashboardRequestError ? error.status : null;
    if (status === 401 || status === 403) this.clearPrivateData('forbidden');
    if (status === 401) await this.ports.onSessionExpired();
    else state.set(status === 403 ? 'forbidden' : 'error');
  }
}
