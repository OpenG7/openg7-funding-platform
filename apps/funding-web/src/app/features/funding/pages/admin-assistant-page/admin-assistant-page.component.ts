import { DOCUMENT, ViewportScroller, isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject
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
  AdminAttentionItem,
  AdminAttentionItemType,
  AdminAttentionSeverity,
  AdminWorkQueueQuery
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
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
  ASSISTANT_PRIORITIES
} from './admin-assistant.contracts.js';
import { AdminAssistantController } from './admin-assistant-controller.js';

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
  private readonly controller = new AdminAssistantController({
    admin: {
      getWorkQueue: (token, query) => this.admin.getWorkQueue(token, query),
      prepareAssistantDraft: (token, payload) =>
        this.admin.prepareAssistantDraft(token, payload),
      getAssistantSummary: (token) => this.admin.getAssistantSummary(token),
      getAssistantContext: (token, sponsorshipId) =>
        this.admin.getAssistantContext(token, sponsorshipId),
      queryAssistant: (token, payload) =>
        this.admin.queryAssistant(token, payload)
    },
    token: () => this.admin.getSavedAdminToken(),
    canPrepare: () => this.admin.identity()?.role !== 'reader',
    language: () => this.i18n.currentLanguage(),
    onSessionExpired: async () => {
      this.admin.clearAdminSession();
      await this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url }
      });
    }
  });
  readonly selectedId = this.controller.selectedId;
  readonly selected = this.controller.selected;
  readonly detailState = this.controller.detailState;
  readonly query = this.controller.query;
  readonly data = this.controller.data;
  readonly state = this.controller.state;
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
  readonly summary = this.controller.summary;
  readonly summaryState = this.controller.summaryState;
  readonly conversationMode = this.controller.conversationMode;
  readonly conversationState = this.controller.conversationState;
  readonly question = this.controller.question;
  readonly answer = this.controller.answer;
  readonly answerState = this.controller.answerState;
  readonly prepared = this.controller.prepared;
  readonly draftState = this.controller.draftState;
  readonly canPrepare = this.controller.canPrepare;

  constructor() {
    this.destroy.onDestroy(() => this.controller.dispose());
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
          this.controller.leaveOverview();
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
        this.controller.setOverview(query, params.get('selected'));
      });
  }

  load(): Promise<void> {
    return this.controller.load();
  }

  refresh(): void {
    this.controller.refresh();
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
    return this.controller.prepareType(item);
  }

  prepare(item: AdminAttentionItem): Promise<void> {
    return this.controller.prepare(item);
  }

  loadSummary(opened: boolean): Promise<void> {
    return this.controller.loadSummary(opened);
  }

  loadConversation(opened: boolean): Promise<void> {
    return this.controller.loadConversation(opened);
  }

  ask(): Promise<void> {
    return this.controller.ask();
  }
}
