import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  viewChild
} from '@angular/core';

import type {
  ControllerContext,
  ControllerMode
} from '../../models/context-controller.models.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

/** Presentation shell. The owning page projects native controls and owns their intentions. */
@Component({
  selector: 'openg7-context-controller',
  standalone: true,
  imports: [AdminIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './context-controller.component.html',
  styleUrl: './context-controller.component.css',
  host: {
    'data-og7': 'context-controller',
    'data-controller-zone': 'radial',
    '[class.is-collapsed]': '!actionsExpanded()',
    '[class.has-explicit-mode]': 'mode() !== null',
    '[attr.data-controller-mode]': 'mode()',
    '[attr.data-og7-id]': 'context()?.key ?? null'
  }
})
export class ContextControllerComponent {
  readonly context = input<ControllerContext | null>(null);
  /** Null preserves Pilotage's existing responsive expanded behavior. */
  readonly mode = input<ControllerMode | null>(null);
  readonly expanded = input(true);
  readonly actionsExpanded = computed(() =>
    this.mode() === null ? this.expanded() : this.mode() === 'open'
  );
  readonly title = input.required<string>();
  readonly contextLabel = input('');
  readonly collapseLabel = input.required<string>();
  readonly expandLabel = input.required<string>();
  readonly actionsId = input('context-controller-actions');
  readonly expandedChange = output<boolean>();
  readonly modeChange = output<ControllerMode>();
  private readonly actions = viewChild<ElementRef<HTMLDivElement>>('actions');
  private readonly toggleButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('toggleButton');

  constructor() {
    effect(() => {
      if (this.mode() === null || this.actionsExpanded()) return;
      const actions = this.actions()?.nativeElement;
      if (actions?.contains(actions.ownerDocument.activeElement))
        this.toggleButton().nativeElement.focus({ preventScroll: true });
    });
  }

  toggle(): void {
    // Focus must leave projected controls before their wrapper becomes hidden.
    this.toggleButton().nativeElement.focus({ preventScroll: true });
    if (this.mode() !== null)
      this.modeChange.emit(this.actionsExpanded() ? 'peek' : 'open');
    else this.expandedChange.emit(!this.expanded());
  }
}
