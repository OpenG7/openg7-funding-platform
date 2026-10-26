import {
  DestroyRef,
  Directive,
  TemplateRef,
  afterNextRender,
  inject
} from '@angular/core';

import { ServiceDemoState } from './service-demo-state.js';

/** Keeps the current page's actions outside its scrolling body. */
@Directive({
  selector: 'ng-template[openg7ServiceDemoActions]',
  standalone: true
})
export class ServiceDemoActionsDirective {
  constructor() {
    const state = inject(ServiceDemoState);
    const template = inject(TemplateRef<unknown>);
    afterNextRender(() => state.actions.set(template));
    inject(DestroyRef).onDestroy(() => {
      if (state.actions() === template) state.actions.set(null);
    });
  }
}
