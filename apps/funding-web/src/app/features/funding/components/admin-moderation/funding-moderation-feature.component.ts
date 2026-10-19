import {
  ChangeDetectionStrategy,
  Component,
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
import { TranslatePipe } from '@ngx-translate/core';
import type { ModerationSubject } from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingModerationService } from '../../services/funding-moderation.service.js';
import { AdminAutomaticPreparationDirective } from '../admin-automatic/admin-automatic-preparation.directive.js';

import { FundingModerationActionsComponent } from './funding-moderation-actions.component.js';

/** Subject-scoped entry point; editorial decisions remain owned by the shared actions. */
@Component({
  selector: 'openg7-funding-moderation-feature',
  standalone: true,
  imports: [
    TranslatePipe,
    AdminAutomaticPreparationDirective,
    FundingModerationActionsComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './funding-moderation-feature.component.html',
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './funding-moderation-feature.component.css'
  ]
})
export class FundingModerationFeatureComponent {
  readonly subject = input.required<ModerationSubject>();
  readonly automaticFor = input<string | null>(null);
  readonly openAction = input<string | null>(null);
  readonly disabled = input(false);
  readonly changed = output<void>();
  readonly openedChange = output<boolean>();
  readonly opened = signal(false);
  readonly visited = signal(false);
  private readonly actions = viewChild(FundingModerationActionsComponent);
  private readonly trigger =
    viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly admin = inject(FundingAdminService);
  private readonly moderation = inject(FundingModerationService);
  private readonly injector = inject(Injector);
  readonly busy = computed(() => !!this.actions()?.busy());
  // Token-mode sessions have no OIDC identity; keep the existing presentation policy.
  readonly canReview = computed(() => this.admin.identity()?.role !== 'reader');
  readonly panelId = computed(
    () => `moderation-feature-${this.subject().type}-${this.subject().id}`
  );
  private generation = 0;

  constructor() {
    effect((onCleanup) => {
      const panelId = this.panelId();
      this.admin.sessionGeneration();
      this.canReview();
      this.generation++;
      untracked(() => {
        if (this.opened()) this.openedChange.emit(false);
      });
      this.opened.set(false);
      this.visited.set(false);
      onCleanup(() => {
        this.generation++;
        const pending = this.moderation.pending();
        if (
          this.busy() &&
          pending &&
          panelId ===
            `moderation-feature-${pending.subject.type}-${pending.subject.id}`
        )
          this.moderation.answer(null);
      });
    });
  }

  open(toggle = true): void {
    if (this.busy() || this.disabled() || !this.canReview()) return;
    if (toggle && this.opened()) {
      this.close();
      return;
    }
    this.visited.set(true);
    this.opened.set(true);
    this.openedChange.emit(true);
    const generation = this.generation;
    afterNextRender(
      () => {
        if (generation !== this.generation || !this.opened()) return;
        const panel = this.panel()?.nativeElement;
        panel
          ?.querySelector<HTMLElement>('[data-og7="moderation-feature-close"]')
          ?.focus({ preventScroll: true });
        panel?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      },
      { injector: this.injector }
    );
  }

  close(restoreFocus = true, event?: Event): void {
    if (this.busy()) return;
    event?.stopPropagation();
    this.opened.set(false);
    this.openedChange.emit(false);
    if (!restoreFocus) return;
    const generation = this.generation;
    afterNextRender(
      () => {
        if (generation !== this.generation || this.opened()) return;
        this.trigger()?.nativeElement.focus({ preventScroll: true });
      },
      { injector: this.injector }
    );
  }
}
