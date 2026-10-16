import {
  DestroyRef,
  Directive,
  ElementRef,
  effect,
  inject,
  input,
  output
} from '@angular/core';

import {
  AdminAutomaticPreparationService,
  type AdminAutomaticPreparationMode
} from './admin-automatic-preparation.service.js';

/** Opt-in for a reviewed, page-owned preview or form opening; never a submit. */
@Directive({
  selector: '[openg7AutomaticPrepare]',
  standalone: true
})
export class AdminAutomaticPreparationDirective {
  readonly id = input.required<string>({ alias: 'openg7AutomaticPrepare' });
  readonly automaticFor = input<string | null>(null);
  readonly automaticExecutionMode =
    input<AdminAutomaticPreparationMode>('prepare');
  readonly automaticPrepare = output<void>();
  private readonly element = inject<ElementRef<HTMLButtonElement>>(ElementRef);
  private readonly preparations = inject(AdminAutomaticPreparationService);

  constructor() {
    let unregister: (() => void) | undefined;
    effect((onCleanup) => {
      unregister = this.preparations.register({
        id: this.id(),
        element: this.element.nativeElement,
        target: this.automaticFor(),
        executionMode: this.automaticExecutionMode(),
        prepare: () => this.automaticPrepare.emit()
      });
      onCleanup(() => {
        unregister?.();
        unregister = undefined;
      });
    });
    inject(DestroyRef).onDestroy(() => unregister?.());
  }
}
