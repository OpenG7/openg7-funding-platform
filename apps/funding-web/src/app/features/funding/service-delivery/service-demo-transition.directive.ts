import {
  Directive,
  ElementRef,
  afterRenderEffect,
  inject,
  input
} from '@angular/core';

export type ServiceDemoTransitionKey =
  string | number | boolean | null | undefined;

/** Fades updated content without delaying removal or recreating retained controls. */
@Directive({
  selector: '[openg7ServiceDemoTransition]',
  standalone: true
})
export class ServiceDemoTransitionDirective {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly transitionKey = input<ServiceDemoTransitionKey>(undefined, {
    alias: 'openg7ServiceDemoTransition'
  });

  constructor() {
    let initialized = false;
    let previousKey: ServiceDemoTransitionKey;
    afterRenderEffect((onCleanup) => {
      const key = this.transitionKey();
      // An unavailable key is not a rendered identity or a future entrance.
      if (key === undefined) {
        initialized = false;
        return;
      }
      const changed = initialized && !Object.is(previousKey, key);
      previousKey = key;
      initialized = true;
      if (!changed) return;

      const element = this.element.nativeElement;
      const view = element.ownerDocument.defaultView;
      if (!view || typeof view.matchMedia !== 'function') return;
      const motion = view.matchMedia('(prefers-reduced-motion: reduce)');
      if (motion.matches || typeof element.animate !== 'function') return;

      const animation = element.animate([{ opacity: 0.45 }, { opacity: 1 }], {
        duration: 180,
        easing: 'ease-out'
      });
      const reduceMotion = () => {
        if (motion.matches) animation.cancel();
      };
      motion.addEventListener('change', reduceMotion);
      onCleanup(() => {
        animation.cancel();
        motion.removeEventListener('change', reduceMotion);
      });
    });
  }
}
