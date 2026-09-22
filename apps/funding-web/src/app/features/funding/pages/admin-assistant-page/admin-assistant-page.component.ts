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
import { AdminAssistantAnswerComponent } from '../../components/admin-assistant/admin-assistant-answer.component.js';
import { AdminDrawerComponent } from '../../components/admin-ui/admin-drawer.component.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';

const TYPES: readonly AdminAttentionItemType[] = [
  'sponsorship_needs_info',
  'sponsorship_needs_review',
  'publication_needs_preparation',
  'publication_late',
  'publication_ready',
  'publication_slot_upcoming',
  'email_delivery_failed',
  'financial_data_warning',
  'invoice_missing',
  'stripe_event_failed',
  'stripe_event_stalled'
];
const DRAFT_TYPES: Readonly<Record<string, AdminAssistantDraftType>> = {
  prepare_reminder: 'sponsorship_reminder',
  prepare_publication: 'publication_draft',
  prepare_note: 'admin_note',
  propose_slot: 'slot_proposal'
};
type LoadState =
  'idle' | 'loading' | 'ready' | 'error' | 'forbidden' | 'unavailable';

/** Routed overview of the existing queue; preparation never sends or publishes. */
@Component({
  selector: 'openg7-admin-assistant-page',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    AdminAssistantContextComponent,
    AdminAssistantDraftComponent,
    AdminAssistantAnswerComponent,
    AdminDrawerComponent,
    AdminLayoutComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-assistant-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-assistant-page.component.css'
  ]
})
export class AdminAssistantPageComponent {
  readonly i18n = inject(FundingI18nService);
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
  readonly detailState = signal<LoadState>('idle');
  readonly query = signal<AdminWorkQueueQuery>({});
  readonly data = signal<AdminWorkQueueResponse | null>(null);
  readonly state = signal<LoadState>('idle');
  readonly priorities: readonly AdminAttentionSeverity[] = [
    'urgent',
    'today',
    'this_week',
    'informational'
  ];
  readonly categories = computed(() =>
    TYPES.filter(
      (type) =>
        (this.data()?.typeCounts[type] ?? 0) > 0 || this.query().type === type
    )
  );
  readonly pages = computed(() =>
    Math.max(
      1,
      Math.ceil(
        (this.data()?.filteredTotal ?? 0) / (this.data()?.pageSize ?? 15)
      )
    )
  );
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
  readonly summaryState = signal<LoadState>('idle');
  readonly conversationMode = signal<AdminAssistantMode | null>(null);
  readonly conversationState = signal<LoadState>('idle');
  readonly question = signal('');
  readonly answer = signal<AdminAssistantQueryResponse | null>(null);
  readonly answerState = signal<LoadState>('idle');
  readonly prepared = signal<AdminAssistantPrepareResponse | null>(null);
  readonly draftState = signal<LoadState>('idle');
  readonly canPrepare = computed(
    () => this.admin.identity()?.role !== 'reader'
  );
  private generation = 0;
  private detailGeneration = 0;
  private draftGeneration = 0;
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
          type: TYPES.includes(type) ? type : undefined,
          priority: this.priorities.includes(priority) ? priority : undefined,
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

  private async handleError(
    error: unknown,
    state: { set(value: LoadState): void }
  ): Promise<void> {
    if (error instanceof AdminDashboardRequestError && error.status === 401) {
      this.data.set(null);
      this.selected.set(null);
      this.admin.clearAdminSession();
      await this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url }
      });
    } else {
      const forbidden =
        error instanceof AdminDashboardRequestError && error.status === 403;
      if (forbidden) {
        this.data.set(null);
        this.selected.set(null);
      }
      state.set(forbidden ? 'forbidden' : 'error');
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
  filter(type: string | null): void {
    this.navigate({
      type,
      page: null,
      selected: null,
      emailTemplate: null,
      emailError: null
    });
  }
  priority(value: string): void {
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
  typeLabel(type: AdminAttentionItemType): string {
    return this.i18n.t('admin.attention.types.' + type);
  }
  title(item: AdminAttentionItem): string {
    if (item.type === 'email_delivery_failed')
      return this.templateLabel(String(item.facts['templateKey'] ?? ''));
    return String(item.facts['reference'] ?? this.typeLabel(item.type));
  }
  templateLabel(template: string): string {
    const key = 'admin.assistantOverview.templates.' + template;
    const label = this.i18n.t(key);
    return label === key
      ? this.i18n.t('admin.assistantOverview.templates.other')
      : label;
  }
  errorLabel(error: string): string {
    const key = 'admin.assistantOverview.errors.' + error;
    const label = this.i18n.t(key);
    return label === key
      ? this.i18n.t('admin.assistantOverview.errors.autre')
      : label;
  }
  missingFields(item: AdminAttentionItem): string[] {
    return String(item.facts['missingFields'] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((field) => {
        const key = 'admin.context.fields.' + field;
        const label = this.i18n.t(key);
        return label === key
          ? this.i18n.t('admin.assistantOverview.missingInformation')
          : label;
      });
  }
  reason(item: AdminAttentionItem): string {
    const days = item.facts['daysSincePaid'] ?? item.facts['daysWaiting'];
    if (typeof days === 'number')
      return this.i18n.t('admin.assistantOverview.waiting', { days });
    if (item.type === 'email_delivery_failed')
      return this.i18n.t(
        item.facts['attemptsExhausted']
          ? 'admin.assistantOverview.exhausted'
          : 'admin.assistantOverview.attempts',
        { count: item.facts['attempts'], max: item.facts['maxAttempts'] }
      );
    if (item.dueAt)
      return this.i18n.t('admin.assistantOverview.due', {
        date: this.dateLabel(item.dueAt)
      });
    return this.i18n.t('admin.attention.reasons.' + item.type);
  }
  amount(item: AdminAttentionItem): string {
    const amount = item.facts['amount'],
      currency = item.facts['currency'];
    return typeof amount === 'number' && typeof currency === 'string'
      ? new Intl.NumberFormat(this.i18n.currentLanguage()).format(amount) +
          ' ' +
          currency
      : '';
  }
  dateLabel(value: string): string {
    return Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'America/Toronto'
        }).format(new Date(value))
      : this.i18n.t('admin.dashboard.notAvailable');
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
    } catch {
      if (generation === this.draftGeneration && !this.destroy.destroyed)
        this.draftState.set('error');
    }
  }

  async loadSummary(event: Event): Promise<void> {
    if (
      !(event.target as HTMLDetailsElement).open ||
      this.summaryState() === 'loading' ||
      this.summaryState() === 'ready'
    )
      return;
    this.summaryState.set('loading');
    try {
      const summary = await this.admin.getAssistantSummary(
        this.admin.getSavedAdminToken()
      );
      if (this.destroy.destroyed) return;
      this.summary.set(summary);
      this.summaryState.set('ready');
    } catch {
      if (!this.destroy.destroyed) this.summaryState.set('error');
    }
  }
  async loadConversation(event: Event): Promise<void> {
    if (
      !(event.target as HTMLDetailsElement).open ||
      this.conversationState() === 'loading' ||
      this.conversationState() === 'ready'
    )
      return;
    this.conversationState.set('loading');
    try {
      const response = await this.admin.getAssistantContext(
        this.admin.getSavedAdminToken()
      );
      if (this.destroy.destroyed) return;
      this.conversationMode.set(response.conversationMode);
      this.conversationState.set('ready');
    } catch {
      if (!this.destroy.destroyed) this.conversationState.set('error');
    }
  }
  async ask(event: Event): Promise<void> {
    event.preventDefault();
    const message = this.question().trim();
    if (
      !message ||
      this.answerState() === 'loading' ||
      !this.conversationMode() ||
      this.conversationMode() === 'disabled'
    )
      return;
    this.answerState.set('loading');
    this.answer.set(null);
    try {
      const response = await this.admin.queryAssistant(
        this.admin.getSavedAdminToken(),
        { message }
      );
      if (this.destroy.destroyed) return;
      this.answer.set(response);
      this.answerState.set('ready');
    } catch {
      if (!this.destroy.destroyed) this.answerState.set('error');
    }
  }
}
