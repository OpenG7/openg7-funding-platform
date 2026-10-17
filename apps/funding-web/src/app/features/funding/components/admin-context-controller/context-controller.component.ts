import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild
} from '@angular/core';

import type { ControllerContext } from '../../models/context-controller.models.js';
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
    '[class.is-collapsed]': '!expanded()',
    '[attr.data-og7-id]': 'context()?.key ?? null'
  }
})
export class ContextControllerComponent {
  readonly context = input<ControllerContext | null>(null);
  readonly expanded = input(true);
  readonly title = input.required<string>();
  readonly contextLabel = input('');
  readonly collapseLabel = input.required<string>();
  readonly expandLabel = input.required<string>();
  readonly actionsId = input('context-controller-actions');
  readonly expandedChange = output<boolean>();
  private readonly toggleButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('toggleButton');

  toggle(): void {
    // Focus must leave projected controls before their wrapper becomes hidden.
    this.toggleButton().nativeElement.focus({ preventScroll: true });
    this.expandedChange.emit(!this.expanded());
  }
}
