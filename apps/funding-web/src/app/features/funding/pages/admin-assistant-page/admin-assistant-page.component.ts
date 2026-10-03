import { DOCUMENT, ViewportScroller, isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject,
  signal
} from '@angular/core';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  Scroll,
  type Params,
  type UrlTree
} from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminAssistantDraftType,
  AdminAssistantMode,
  AdminAssistantPrepareResponse,
  AdminAssistantQueryResponse,
  AdminAssistantSummary,
  AdminAttentionItem,
  AdminAttentionItemType,
  AdminAttentionSeverity,
  AdminWorkQueueQuery,
  AdminWorkQueueResponse
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';
import { AdminAssistantContextComponent } from '../../components/admin-assistant/admin-assistant-context.component.js';
import { AdminAssistantDraftComponent } from '../../components/admin-assistant/admin-assistant-draft.component.js';
import { AdminDrawerComponent } from '../../components/admin-ui/admin-drawer.component.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';

import { AdminAssistantQueueComponent } from './admin-assistant-queue.component.js';
import { AdminAssistantQuestionComponent } from './admin-assistant-question.component.js';
import { AdminAssistantSummaryComponent } from './admin-assistant-summary.component.js';
import { AdminAssistantLabels } from './admin-assistant-labels.js';
import {
  ASSISTANT_TYPES,
  ASSISTANT_PRIORITIES,
  type AssistantLoadState
} from './admin-assistant.contracts.js';

const DRAFT_TYPES: Readonly<Record<string, AdminAssistantDraftType>> = {
  prepare_reminder: 'sponsorship_reminder',
  prepare_publication: 'publication_draft',
  prepare_note: 'admin_note',
  propose_slot: 'slot_proposal'
};
/** Routed overview of the existing queue; preparation never sends or publishes. */
@Component({
  selector: 'openg7-admin-assistant-page',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    AdminAssistantContextComponent,
    AdminAssistantDraftComponent,
    AdminAssistantQueueComponent,
    AdminAssistantQuestionComponent,
    AdminAssistantSummaryComponent,
    AdminDrawerComponent,
    AdminLayoutComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-assistant-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-assistant-surface.css',
    './admin-assistant-page.component.css'
  ]
})
export class AdminAssistantPageComponent {
  readonly i18n = inject(FundingI18nService);
  readonly labels = new AdminAssistantLabels(this.i18n);
  private readonly admin = inject(FundingAdminService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.queryParamMap);
  private readonly destroy = inject(DestroyRef);
  private readonly platform = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly viewport = inject(ViewportScroller);
  private pendingScroll: [number, number] | null = null;
  private listScroll: [number, number] | null = null;
  private pendingFocus: string | null = null;
  readonly sponsorshipId = computed(
    () => this.params()?.get('sponsorshipId') || undefined
  );
  readonly selectedId = signal<string | null>(null);
  readonly selected = signal<AdminAttentionItem | null>(null);
  readonly detailState = signal<AssistantLoadState>('idle');
  readonly query = signal<AdminWorkQueueQuery>({});
  readonly data = signal<AdminWorkQueueResponse | null>(null);
  readonly state = signal<AssistantLoadState>('idle');
  readonly returnTo = computed(() => {
    const params = this.params();
    return this.router.serializeUrl(
      this.router.createUrlTree(['/admin/fundraiser/assistant'], {
        queryParams: Object.fromEntries(
          (params?.keys ?? [])
            .filter((key) => key !== 'returnTo')
            .map((key) => [key, params?.get(key)])
        )
      })
    );
  });
  readonly summary = signal<AdminAssistantSummary | null>(null);
  readonly summaryState = signal<AssistantLoadState>('idle');
  readonly conversationMode = signal<AdminAssistantMode | null>(null);
  readonly conversationState = signal<AssistantLoadState>('idle');
  readonly question = signal('');
  readonly answer = signal<AdminAssistantQueryResponse | null>(null);
  readonly answerState = signal<AssistantLoadState>('idle');
  readonly prepared = signal<AdminAssistantPrepareResponse | null>(null);
  readonly draftState = signal<AssistantLoadState>('idle');
  readonly canPrepare = computed(
    () => this.admin.identity()?.role !== 'reader'
  );
  private generation = 0;
  private detailGeneration = 0;
  private draftGeneration = 0;
  private privacyGeneration = 0;
  private queryKey = '';

  constructor() {
    if (!isPlatformBrowser(this.platform)) return;
    this.router.events
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((event) => {
        if (!(event instanceof Scroll)) return;
        if (this.pendingFocus) {
          const id = this.pendingFocus;
          const row = Array.from(
            this.document.querySelectorAll<HTMLElement>(
              '[data-og7="assistant-items"] > li'
            )
          ).find((element) => element.dataset['og7Id'] === id);
          row
            ?.querySelector<HTMLButtonElement>('button')
            ?.focus({ preventScroll: !!this.pendingScroll });
          this.pendingFocus = null;
        }
        if (this.pendingScroll) {
          this.viewport.scrollToPosition(this.pendingScroll, {
            behavior: 'instant'
          });
          this.pendingScroll = null;
        }
      });
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe((params) => {
        if (params.get('sponsorshipId')) {
          this.generation++;
          this.detailGeneration++;
          this.queryKey = '';
          return;
        }
        const type = params.get('type') as AdminAttentionItemType;
        const priority = params.get('priority') as AdminAttentionSeverity;
        const page = Number(params.get('page') || 1);
        const query: AdminWorkQueueQuery = {
          type: ASSISTANT_TYPES.includes(type) ? type : undefined,
          priority: ASSISTANT_PRIORITIES.includes(priority)
            ? priority
            : undefined,
          page:
            Number.isInteger(page) && page > 0 && page <= 1000000 ? page : 1,
          pageSize: 15,
          overview: true,
          emailTemplate: params.get('emailTemplate') || undefined,
          emailError: params.get('emailError') || undefined
        };
        const key = JSON.stringify(query);
        if (key !== this.queryKey) {
          this.queryKey = key;
          this.query.set(query);
          void this.load();
        }
        const id = params.get('selected');
        if (id !== this.selectedId()) {
          this.selectedId.set(id);
          this.selected.set(null);
          this.prepared.set(null);
          this.draftState.set('idle');
          this.draftGeneration++;
          this.detailGeneration++;
          if (id) void this.loadDetail(id);
        }
      });
  }

  async load(): Promise<void> {
    const generation = ++this.generation;
    this.state.set('loading');
    try {
      const result = await this.admin.getWorkQueue(
        this.admin.getSavedAdminToken(),
        this.query()
      );
      if (generation !== this.generation || this.destroy.destroyed) return;
      this.data.set(result.available ? result : null);
      this.state.set(result.available ? 'ready' : 'unavailable');
    } catch (error) {
      if (generation !== this.generation || this.destroy.destroyed) return;
      await this.handleError(error, this.state);
    }
  }

  refresh(): void {
    void this.load();
    const id = this.selectedId();
    if (id) void this.loadDetail(id);
  }

  private async loadDetail(id: string): Promise<void> {
    const generation = ++this.detailGeneration;
    this.detailState.set('loading');
    this.prepared.set(null);
    this.draftGeneration++;
    this.draftState.set('idle');
    try {
      const result = await this.admin.getWorkQueue(
        this.admin.getSavedAdminToken(),
        { itemId: id, pageSize: 1 }
      );
      if (generation !== this.detailGeneration || this.destroy.destroyed)
        return;
      this.selected.set(result.available ? (result.items[0] ?? null) : null);
      this.detailState.set(result.available ? 'ready' : 'unavailable');
    } catch (error) {
      if (generation !== this.detailGeneration || this.destroy.destroyed)
        return;
      await this.handleError(error, this.detailState);
    }
  }

  /** Invalidate pending reads before removing every private surface on access denial. */
  private clearPrivateData(): void {
    this.generation++;
    this.detailGeneration++;
    this.draftGeneration++;
    this.privacyGeneration++;
    this.data.set(null);
    this.selected.set(null);
    this.prepared.set(null);
    this.summary.set(null);
    this.answer.set(null);
    this.question.set('');
    this.conversationMode.set(null);
    this.state.set('forbidden');
    this.detailState.set('forbidden');
    this.summaryState.set('idle');
    this.conversationState.set('idle');
    this.answerState.set('idle');
    this.draftState.set('idle');
  }

  private async handleError(
    error: unknown,
    state: { set(value: AssistantLoadState): void }
  ): Promise<void> {
    const status =
      error instanceof AdminDashboardRequestError ? error.status : null;
    if (status === 401 || status === 403) this.clearPrivateData();
    if (status === 401) {
      this.admin.clearAdminSession();
      await this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url }
      });
    } else {
      state.set(status === 403 ? 'forbidden' : 'error');
    }
  }

  navigate(params: Params): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      scroll:
        Object.hasOwn(params, 'selected') && !Object.hasOwn(params, 'page')
          ? 'manual'
          : undefined
    });
  }
  filter(type: AdminAttentionItemType | null): void {
    this.navigate({
      type,
      page: null,
      selected: null,
      emailTemplate: null,
      emailError: null
    });
  }
  priority(value: AdminAttentionSeverity | null): void {
    this.navigate({ priority: value || null, page: null, selected: null });
  }
  emailGroup(template: string, error: string): void {
    this.navigate({
      type: 'email_delivery_failed',
      emailTemplate: template || null,
      emailError: error,
      page: null,
      selected: null
    });
  }
  open(item: AdminAttentionItem): void {
    this.listScroll = this.viewport.getScrollPosition();
    this.pendingScroll = this.listScroll;
    this.navigate({ selected: item.id });
  }
  close(): void {
    this.pendingFocus = this.selectedId();
    this.pendingScroll = this.listScroll;
    this.navigate({ selected: null });
  }
  page(page: number): void {
    this.navigate({ page, selected: null });
  }

  adminLink(item: AdminAttentionItem): UrlTree {
    const tree = this.router.parseUrl(
      item.adminUrl?.startsWith('/admin/fundraiser/')
        ? item.adminUrl
        : '/admin/fundraiser/attention'
    );
    tree.queryParams = { ...tree.queryParams, returnTo: this.returnTo() };
    return tree;
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
      !type ||
      !this.canPrepare() ||
      this.draftState() === 'loading' ||
      this.detailState() !== 'ready'
    )
      return;
    const generation = ++this.draftGeneration;
    this.draftState.set('loading');
    this.prepared.set(null);
    try {
      const result = await this.admin.prepareAssistantDraft(
        this.admin.getSavedAdminToken(),
        {
          type,
          reference:
            item.sponsorshipId ??
            item.publicationId ??
            String(item.facts['reference'] ?? ''),
          language: this.i18n.currentLanguage()
        }
      );
      if (generation !== this.draftGeneration || this.destroy.destroyed) return;
      this.prepared.set(result);
      this.draftState.set('ready');
    } catch (error) {
      if (generation !== this.draftGeneration || this.destroy.destroyed) return;
      await this.handleError(error, this.draftState);
    }
  }

  async loadSummary(opened: boolean): Promise<void> {
    if (
      !opened ||
      this.summaryState() === 'loading' ||
      this.summaryState() === 'ready'
    )
      return;
    const generation = this.privacyGeneration;
    this.summaryState.set('loading');
    try {
      const summary = await this.admin.getAssistantSummary(
        this.admin.getSavedAdminToken()
      );
      if (generation !== this.privacyGeneration || this.destroy.destroyed)
        return;
      this.summary.set(summary);
      this.summaryState.set('ready');
    } catch (error) {
      if (generation !== this.privacyGeneration || this.destroy.destroyed)
        return;
      await this.handleError(error, this.summaryState);
    }
  }
  async loadConversation(opened: boolean): Promise<void> {
    if (
      !opened ||
      this.conversationState() === 'loading' ||
      this.conversationState() === 'ready'
    )
      return;
    const generation = this.privacyGeneration;
    this.conversationState.set('loading');
    try {
      const response = await this.admin.getAssistantContext(
        this.admin.getSavedAdminToken()
      );
      if (generation !== this.privacyGeneration || this.destroy.destroyed)
        return;
      this.conversationMode.set(response.conversationMode);
      this.conversationState.set('ready');
    } catch (error) {
      if (generation !== this.privacyGeneration || this.destroy.destroyed)
        return;
      await this.handleError(error, this.conversationState);
    }
  }
  async ask(): Promise<void> {
    const message = this.question().trim();
    if (
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
      const response = await this.admin.queryAssistant(
        this.admin.getSavedAdminToken(),
        { message }
      );
      if (generation !== this.privacyGeneration || this.destroy.destroyed)
        return;
      this.answer.set(response);
      this.answerState.set('ready');
    } catch (error) {
      if (generation !== this.privacyGeneration || this.destroy.destroyed)
        return;
      await this.handleError(error, this.answerState);
    }
  }
}
