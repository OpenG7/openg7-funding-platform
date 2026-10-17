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
import type { AdminPreparationReceiptData } from '@openg7/funding-core';

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
import type { PreparationPilotIssue } from './preparation-pilot.models.js';
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
    '[attr.data-og7-controller-owner]': 'idPrefix()',
    '[attr.data-og7-mode]': 'mode()',
    '(keydown.escape)': 'escape($event)'
  }
})
export class PreparationPilotComponent {
  readonly receipt = input.required<AdminPreparationReceiptData>();
  readonly idPrefix = input.required<string>();
  readonly selectedId = input<string | null>(null);
  readonly canApprove = input(false);
  readonly busy = input(false);
  readonly selectedIdChange = output<string | null>();
  readonly approveRequested = output<void>();
  readonly sourceRequested = output<PreparationPilotIssue>();
  readonly detailsRequested = output<void>();
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
  readonly context = computed(() =>
    preparationControllerContext(this.receipt(), this.selection())
  );
  readonly ready = computed(
    () => this.receipt().canApprove && this.receipt().status !== 'approved'
  );
  readonly actions = computed(() => {
    const bindings = this.controller.profile().bindings;
    const intents = {
      A: 'primary',
      B: 'secondary',
      X: 'edit',
      Y: 'details'
    } as const;
    return preparationContextActions({
      receipt: this.receipt(),
      issue: this.issue(),
      canApprove: this.canApprove(),
      busy: this.busy(),
      t: (key) => this.t(key)
    }).map((action) => {
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
      const revision = this.receipt().version;
      const contributionId = this.receipt().contributionId;
      untracked(() => {
        if (selection !== this.selectedId())
          this.selectedIdChange.emit(selection);
        // Every selection or server revision invalidates held input and open actions.
        void revision;
        void contributionId;
        this.mode.set('peek');
        this.controller.reset();
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
    this.selectedIdChange.emit(id);
    this.mode.set('peek');
    this.controller.reset();
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
    if (
      this.mode() !== 'open' ||
      !matchesPreparationControllerContext(this.context(), request.context)
    )
      return;
    const action = this.actions().find(
      (action) => action.id === request.actionId
    );
    if (!action?.enabled || !action.visible || action.busy) return;
    if (action.id === 'preparation-back') {
      this.close();
      return;
    }
    if (action.id !== 'preparation-approve') this.mode.set('peek');
    this.controller.reset();
    if (action.id === 'preparation-open') {
      const issue = this.issue();
      if (issue) this.sourceRequested.emit(issue);
    } else if (action.id === 'preparation-approve')
      this.approveRequested.emit();
    else if (action.id === 'preparation-details') this.detailsRequested.emit();
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
      this.list()?.move(intent === 'previous' ? -1 : 1);
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
      if (this.mode() !== 'open')
        this.list()?.move(['up', 'left'].includes(intent) ? -1 : 1);
      else {
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
      }
      return true;
    }
    if (this.mode() === 'open' && ['edit', 'details'].includes(intent)) {
      const id =
        intent === 'edit' ? 'preparation-details' : 'preparation-history';
      this.actionButtons()
        .find((button) => button.getAttribute('data-og7-id') === id)
        ?.click();
      return true;
    }
    return false;
  }
}
