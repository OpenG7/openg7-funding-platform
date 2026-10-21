import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import type {
  AdminPreparationReceiptData,
  PreparationAssistanceSummary
} from '@openg7/funding-core';

import type {
  ControllerActionRequest,
  ControllerMode
} from '../../models/context-controller.models.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { ContextControllerComponent } from '../admin-context-controller/context-controller.component.js';
import { ContextControllerActionComponent } from '../admin-context-controller/context-controller-action.component.js';
import {
  controllerScope,
  revealControllerFocus
} from '../admin-controller/admin-controller-navigation.js';
import type { ControllerIntent } from '../admin-pilotage/controller-input.js';
import { ControllerService } from '../admin-pilotage/controller.service.js';

import {
  preparationContextActions,
  preparationControllerContext,
  matchesPreparationControllerContext
} from './preparation-context-actions.js';
import {
  projectPreparationPilot,
  reconcilePreparationIssue
} from './preparation-pilot.projection.js';
import type {
  PreparationDetailsMode,
  PreparationPilotIssue
} from './preparation-pilot.models.js';
import { PreparationIssueListComponent } from './preparation-issue-list.component.js';
import { PreparationIssueDetailComponent } from './preparation-issue-detail.component.js';

/** Presentation coordinator. Hosts own commands, confirmation and fresh server receipts. */
@Component({
  selector: 'openg7-preparation-pilot',
  standalone: true,
  imports: [
    PreparationIssueListComponent,
    PreparationIssueDetailComponent,
    ContextControllerComponent,
    ContextControllerActionComponent
  ],
  templateUrl: './preparation-pilot.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './preparation-pilot.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-og7': 'preparation-pilot',
    '[class.has-issues]': "!ready() && receipt().status !== 'approved'",
    '[attr.data-og7-controller-owner]': 'idPrefix()',
    '[attr.data-og7-mode]': 'mode()',
    '[class.is-guided]': 'guided()',
    '(keydown.escape)': 'escape($event)'
  }
})
export class PreparationPilotComponent {
  readonly receipt = input.required<AdminPreparationReceiptData>();
  readonly idPrefix = input.required<string>();
  readonly selectedId = input<string | null>(null);
  readonly canApprove = input(false);
  readonly guided = input(false);
  readonly busy = input(false);
  readonly detailsMode = input<PreparationDetailsMode>('hidden');
  readonly canAssist = input(false);
  readonly assistanceSummary = input<PreparationAssistanceSummary | null>(null);
  readonly assistanceBusy = input(false);
  readonly assistanceError = input('');
  readonly assistanceRefreshRequested = output<void>();
  readonly assistanceRerunRequested = output<string>();
  readonly assistanceNavigationRequested = output<'review' | 'source'>();
  readonly selectedIdChange = output<string | null>();
  readonly approveRequested = output<void>();
  readonly sourceRequested = output<PreparationPilotIssue>();
  readonly detailsRequested = output<void>();
  readonly campaignsRequested = output<void>();
  readonly historyRequested = output<void>();
  readonly mode = signal<ControllerMode>('peek');
  readonly projection = computed(() => projectPreparationPilot(this.receipt()));
  readonly selection = computed(() =>
    this.projection().issues.some((issue) => issue.id === this.selectedId())
      ? this.selectedId()
      : reconcilePreparationIssue(this.projection().issues, null)
  );
  readonly issue = computed(
    () =>
      this.projection().issues.find((issue) => issue.id === this.selection()) ??
      null
  );
  readonly context = computed(
    () =>
      preparationControllerContext(
        this.receipt(),
        this.selection(),
        this.currentAssistance()
      ),
    {
      equal: (before, after) =>
        before === after ||
        (after !== null && matchesPreparationControllerContext(before, after))
    }
  );
  readonly currentAssistance = computed(() =>
    this.canAssist() &&
    this.assistanceSummary()?.contributionId === this.receipt().contributionId
      ? this.assistanceSummary()
      : null
  );
  readonly ready = computed(
    () => this.receipt().canApprove && this.receipt().status !== 'approved'
  );
  private readonly baseActions = computed(() =>
    preparationContextActions({
      receipt: this.receipt(),
      issue: this.issue(),
      canApprove: this.canApprove(),
      busy: this.busy(),
      detailsMode: this.detailsMode(),
      canAssist: this.canAssist(),
      assistanceSummary: this.currentAssistance(),
      assistanceBusy: this.assistanceBusy(),
      t: (key) => this.t(key)
    })
  );
  readonly actions = computed(() => {
    const bindings = this.controller.profile().bindings;
    const intents = {
      A: 'primary',
      B: 'secondary',
      X: 'edit',
      Y: 'details'
    } as const;
    return this.baseActions().map((action) => {
      const label = action.shortcut?.label as keyof typeof intents | undefined;
      const index = label && bindings[intents[label]];
      return index === undefined
        ? action
        : {
            ...action,
            shortcut: {
              label: ['A', 'B', 'X', 'Y'][index]!,
              tone: (['a', 'b', 'x', 'y'] as const)[index]!
            }
          };
    });
  });
  readonly primaryAction = computed(() =>
    this.guided()
      ? (this.actions().find(
          (action) =>
            action.id === 'preparation-open' ||
            action.id === 'preparation-assistance-review'
        ) ?? null)
      : null
  );
  readonly secondaryActions = computed(() =>
    this.actions().filter(
      (action) =>
        action.id !== this.primaryAction()?.id &&
        (!this.guided() || action.id !== 'preparation-approve')
    )
  );
  private readonly i18n = inject(FundingI18nService);
  private readonly controller = inject(ControllerService);
  private readonly document = inject(DOCUMENT);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly list = viewChild(PreparationIssueListComponent);
  private readonly opener = viewChild<ElementRef<HTMLButtonElement>>('opener');

  constructor() {
    const destroy = inject(DestroyRef);
    effect(() => {
      const selection = this.selection();
      const revision = this.context()?.revision;
      const contributionId = this.receipt().contributionId;
      untracked(() => {
        const active = this.document.activeElement;
        const hadControllerFocus =
          !!active &&
          this.element.nativeElement
            .querySelector('[data-og7="preparation-pilot-controller"]')
            ?.contains(active);
        if (selection !== this.selectedId())
          this.selectedIdChange.emit(selection);
        // Every selection or server revision invalidates held input and open actions.
        void revision;
        void contributionId;
        this.mode.set('peek');
        this.controller.reset();
        if (hadControllerFocus)
          afterNextRender(
            () => {
              if (
                this.document.activeElement === active ||
                this.document.activeElement === this.document.body
              ) {
                const opener = this.opener()?.nativeElement;
                if (opener) revealControllerFocus(opener);
              }
            },
            { injector: this.injector }
          );
      });
    });
    afterNextRender(() => {
      const detach = this.controller.attach((intent) => this.intent(intent), {
        priority: 200
      });
      destroy.onDestroy(detach);
    });
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.automatic.portfolio.receipt.' + key, params);
  }

  select(id: string): void {
    if (!this.projection().issues.some((issue) => issue.id === id)) return;
    const contributionId = this.receipt().contributionId;
    const version = this.receipt().version;
    this.selectedIdChange.emit(id);
    this.mode.set('peek');
    this.controller.reset();
    afterNextRender(
      () => {
        if (
          this.selection() !== id ||
          this.receipt().contributionId !== contributionId ||
          this.receipt().version !== version
        )
          return;
        const active = this.document.activeElement;
        if (
          !(active instanceof HTMLElement) ||
          !this.element.nativeElement.contains(active)
        )
          return;
        const attention = this.element.nativeElement.querySelector<HTMLElement>(
          '[data-og7="preparation-issue-attention"]'
        );
        const choices = this.element.nativeElement.querySelector<HTMLElement>(
          'openg7-preparation-issue-list'
        );
        // Reveal both columns together when the detail sits beside the list.
        const target =
          attention &&
          choices &&
          attention.getBoundingClientRect().right <=
            choices.getBoundingClientRect().left
            ? this.element.nativeElement.querySelector<HTMLElement>(
                '.pilot-content'
              )
            : attention;
        target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        // Keep the selected native control reachable, including in a short guide.
        if (active.getAttribute('data-og7') === 'preparation-issue')
          active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      },
      { injector: this.injector }
    );
  }

  open(): void {
    if (this.busy()) return;
    this.mode.set('open');
    this.controller.reset();
    afterNextRender(
      () => {
        if (this.mode() !== 'open') return;
        const first = this.actionButtons()[0];
        if (first) revealControllerFocus(first);
      },
      { injector: this.injector }
    );
  }

  changeMode(mode: ControllerMode): void {
    if (mode === 'open') this.open();
    else this.close();
  }

  close(): void {
    this.mode.set('peek');
    this.controller.reset();
    afterNextRender(
      () => {
        const opener = this.opener()?.nativeElement;
        if (opener) revealControllerFocus(opener);
      },
      { injector: this.injector }
    );
  }

  escape(event: Event): void {
    if (this.mode() !== 'open') return;
    event.preventDefault();
    event.stopPropagation();
    this.close();
  }

  request(request: ControllerActionRequest): void {
    if (this.mode() !== 'open') return;
    this.dispatch(request);
  }
  requestPrimary(request: ControllerActionRequest): void {
    if (
      !this.guided() ||
      this.busy() ||
      request.actionId !== this.primaryAction()?.id ||
      !matchesPreparationControllerContext(this.context(), request.context)
    )
      return;
    // This explicit native-button gesture opens the existing command surface.
    // The same mode, fresh descriptor and version guards still govern dispatch.
    this.open();
    this.request(request);
  }
  private dispatch(request: ControllerActionRequest): void {
    if (!matchesPreparationControllerContext(this.context(), request.context))
      return;
    const action = this.actions().find(
      (action) => action.id === request.actionId
    );
    if (!action?.enabled || !action.visible || action.busy) return;
    if (action.id === 'preparation-back') {
      this.close();
      return;
    }
    if (action.id === 'preparation-assistance-rerun') {
      const summary = this.currentAssistance();
      if (!summary) return;
      this.close();
      this.assistanceRerunRequested.emit(summary.revision);
      return;
    }
    if (action.id !== 'preparation-approve') this.mode.set('peek');
    this.controller.reset();
    if (
      action.id === 'preparation-assistance-review' ||
      action.id === 'preparation-assistance-source'
    ) {
      this.assistanceNavigationRequested.emit(
        action.id === 'preparation-assistance-review' ? 'review' : 'source'
      );
    } else if (action.id === 'preparation-open') {
      const issue = this.issue();
      if (issue) this.sourceRequested.emit(issue);
    } else if (action.id === 'preparation-approve')
      this.approveRequested.emit();
    else if (action.id === 'preparation-details') this.detailsRequested.emit();
    else if (action.id === 'preparation-campaigns')
      this.campaignsRequested.emit();
    else if (action.id === 'preparation-history') this.historyRequested.emit();
  }

  private actionButtons(): HTMLButtonElement[] {
    return Array.from(
      this.element.nativeElement.querySelectorAll<HTMLButtonElement>(
        '[data-og7="preparation-pilot-action"]'
      )
    ).filter(
      (button) =>
        !button.disabled && !button.hidden && button.getClientRects().length > 0
    );
  }

  private intent(intent: ControllerIntent): boolean {
    const active = this.document.activeElement as HTMLElement | null;
    const root = this.element.nativeElement;
    if (
      !active ||
      !root.contains(active) ||
      !controllerScope(this.document).contains(root)
    )
      return false;
    if (['previous', 'next'].includes(intent)) {
      const issueId =
        active.getAttribute('data-og7') === 'preparation-issue'
          ? active.getAttribute('data-og7-id')
          : null;
      const issues = this.list()?.navigableIssues() ?? this.projection().issues;
      const index = issues.findIndex((issue) => issue.id === issueId);
      const offset = intent === 'previous' ? -1 : 1;
      // Bumpers select adjacent issues, then leave the list in DOM order.
      // Other controls and list boundaries belong to the shared navigator.
      if (index < 0 || index + offset < 0 || index + offset >= issues.length)
        return false;
      this.list()?.move(offset, issueId);
      return true;
    }
    if (intent === 'secondary' && this.mode() === 'open') {
      this.close();
      return true;
    }
    if (intent === 'primary') {
      // A activates the same native control as Enter, including selection,
      // disclosure and Back. It never falls through to another business action.
      if (
        this.mode() !== 'open' &&
        active.getAttribute('data-og7') === 'preparation-issue' &&
        active.getAttribute('data-og7-id') === this.selection()
      )
        this.opener()?.nativeElement.click();
      else if (active.matches('button:not([disabled]),summary,a[href]'))
        active.click();
      return true;
    }
    if (['up', 'down', 'left', 'right'].includes(intent)) {
      if (this.mode() !== 'open') return false;
      const buttons = this.actionButtons();
      const index = buttons.indexOf(active as HTMLButtonElement);
      const next =
        buttons[
          (Math.max(0, index) +
            (['up', 'left'].includes(intent) ? -1 : 1) +
            buttons.length) %
            buttons.length
        ];
      if (next) revealControllerFocus(next);
      return true;
    }
    if (this.mode() === 'open' && ['edit', 'details'].includes(intent)) {
      const id = this.baseActions().find(
        (action) => action.shortcut?.label === (intent === 'edit' ? 'X' : 'Y')
      )?.id;
      this.actionButtons()
        .find((button) => button.getAttribute('data-og7-id') === id)
        ?.click();
      return true;
    }
    return false;
  }
}
