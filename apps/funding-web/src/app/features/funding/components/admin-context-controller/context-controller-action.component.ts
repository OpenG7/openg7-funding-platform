import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output
} from '@angular/core';

import type {
  ControllerAction,
  ControllerActionRequest,
  ControllerContext
} from '../../models/context-controller.models.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

/** Native button presentation. Availability and confirmation remain owned by the page. */
@Component({
  selector: 'button[openg7-context-controller-action]',
  standalone: true,
  imports: [AdminIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './context-controller-action.component.html',
  styleUrl: './context-controller-action.component.css',
  host: {
    type: 'button',
    '[disabled]': 'disabled()',
    '[hidden]': '!action().visible',
    '[attr.aria-label]': 'accessibleLabel()',
    '[attr.aria-busy]': 'action().busy || null',
    '[attr.data-tone]': 'action().tone',
    '[attr.data-controller-action-zone]': 'action().zone',
    '[attr.data-state]': 'action().busy ? "pending" : "idle"',
    '(pointerdown)': 'capturePointer($event)',
    '(pointercancel)': 'clearGesture()',
    '(keydown)': 'captureKeyboard($event)',
    '(click)': 'request($event)'
  }
})
export class ContextControllerActionComponent {
  readonly action = input.required<ControllerAction>();
  readonly context = input<ControllerContext | null>(null);
  readonly actionRequested = output<ControllerActionRequest>();
  private gestureContext: ControllerContext | null | undefined;
  readonly disabled = computed(
    () =>
      !this.context() ||
      !this.action().enabled ||
      !this.action().visible ||
      !!this.action().busy
  );
  readonly accessibleLabel = computed(() => {
    const action = this.action();
    return this.disabled() && action.disabledReason
      ? `${action.label}. ${action.disabledReason}`
      : action.label;
  });

  capturePointer(event: PointerEvent): void {
    if (event.button === 0) this.captureContext();
  }

  captureKeyboard(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.repeat) event.preventDefault();
    else this.captureContext();
  }

  private captureContext(): void {
    const context = this.context();
    this.gestureContext = context ? { ...context } : null;
  }

  clearGesture(): void {
    this.gestureContext = undefined;
  }

  request(event: MouseEvent): void {
    const action = this.action();
    const context = this.context();
    const gesture = this.gestureContext;
    this.clearGesture();
    const changed =
      gesture !== undefined &&
      (!gesture ||
        !context ||
        gesture.key !== context.key ||
        gesture.targetId !== context.targetId ||
        gesture.revision !== context.revision);
    if (this.disabled() || !context || changed) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    this.actionRequested.emit({ actionId: action.id, context: { ...context } });
  }
}
