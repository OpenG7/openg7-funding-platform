import {
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  inject,
  signal
} from '@angular/core';

const selectedTab =
  '[aria-current="page"], [aria-current="step"], [aria-pressed="true"], [aria-selected="true"]';
const tabControls =
  'a, button, [aria-current], [aria-pressed], [aria-selected]';

interface TabIndicator {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

/** Decorative selection marker; existing controls retain their semantics and focus. */
@Directive({
  selector: '[openg7ServiceDemoTabs]',
  standalone: true,
  host: {
    class: 'service-demo-motion-tabs',
    '[class.service-demo-motion-tabs-ready]': 'indicator() !== null',
    '[style.--service-demo-tabs-x.px]': 'indicator()?.x',
    '[style.--service-demo-tabs-y.px]': 'indicator()?.y',
    '[style.--service-demo-tabs-width.px]': 'indicator()?.width'
  }
})
export class ServiceDemoTabsDirective {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  readonly indicator = signal<TabIndicator | null>(null);

  constructor() {
    afterNextRender(() => {
      const host = this.element.nativeElement;
      const view = host.ownerDocument.defaultView;
      if (!view) return;

      const updateIndicator = () => {
        const active = host.querySelector<HTMLElement>(selectedTab);
        if (!active || active.getClientRects().length === 0) {
          this.indicator.set(null);
          return;
        }
        // Layout offsets ignore the temporary scale used while pressing a button.
        let x = 0;
        let y = 0;
        let offset: HTMLElement | null = active;
        while (offset && offset !== host) {
          x += offset.offsetLeft;
          y += offset.offsetTop;
          offset = offset.offsetParent as HTMLElement | null;
          if (offset && offset !== host) {
            x += offset.clientLeft;
            y += offset.clientTop;
          }
        }
        if (offset !== host) {
          this.indicator.set(null);
          return;
        }
        for (
          let parent = active.parentElement;
          parent && parent !== host;
          parent = parent.parentElement
        ) {
          x -= parent.scrollLeft;
          y -= parent.scrollTop;
        }
        const position = {
          x,
          y: y + active.offsetHeight - 2,
          width: active.offsetWidth
        };
        this.indicator.update((current) =>
          current?.x === position.x &&
          current.y === position.y &&
          current.width === position.width
            ? current
            : position
        );
      };

      const resizeObserver =
        typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(updateIndicator);
      const observed = new Set<Element>();
      const observeControls = () => {
        const controls = new Set<Element>([
          host,
          ...Array.from(host.children),
          ...Array.from(host.querySelectorAll(tabControls))
        ]);
        for (const previous of observed) {
          if (controls.has(previous)) continue;
          resizeObserver?.unobserve(previous);
          observed.delete(previous);
        }
        for (const control of controls) {
          if (observed.has(control)) continue;
          resizeObserver?.observe(control);
          observed.add(control);
        }
      };
      const mutationObserver =
        typeof MutationObserver === 'undefined'
          ? null
          : new MutationObserver(() => {
              observeControls();
              updateIndicator();
            });

      observeControls();
      updateIndicator();
      mutationObserver?.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['aria-current', 'aria-pressed', 'aria-selected']
      });
      view.addEventListener('resize', updateIndicator);
      this.destroyRef.onDestroy(() => {
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
        view.removeEventListener('resize', updateIndicator);
        observed.clear();
      });
    });
  }
}
