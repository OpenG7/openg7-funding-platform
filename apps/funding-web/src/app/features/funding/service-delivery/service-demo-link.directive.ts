import { Directive, computed, inject, input } from '@angular/core';
import {
  DefaultUrlSerializer,
  UrlTree,
  type Params,
  type QueryParamsHandling
} from '@angular/router';

import { ServiceDemoNavigation } from './service-demo-navigation.js';

/** The feature's anchors keep native link behavior while normal clicks stay local when embedded. */
@Directive({
  selector: 'a[routerLink]',
  standalone: true,
  host: {
    '[attr.href]': 'href()',
    '(click)': 'activate($event)'
  }
})
export class ServiceDemoLinkDirective {
  readonly routerLink = input<string | readonly unknown[] | UrlTree | null>();
  readonly queryParams = input<Params | null>();
  readonly queryParamsHandling = input<QueryParamsHandling | null>();
  private readonly navigation = inject(ServiceDemoNavigation);
  private readonly serializer = new DefaultUrlSerializer();
  private readonly destination = computed(() => {
    const commands = this.routerLink();
    return commands == null
      ? null
      : this.navigation.linkUrl(
          commands,
          this.queryParams(),
          this.queryParamsHandling()
        );
  });
  readonly href = computed(() => {
    const tree = this.destination();
    return tree ? this.serializer.serialize(tree) : null;
  });

  activate(event: MouseEvent): void {
    const anchor = event.currentTarget as HTMLAnchorElement;
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      (anchor.target && anchor.target !== '_self')
    )
      return;
    const tree = this.destination();
    if (!tree) return;
    event.preventDefault();
    void this.navigation.navigate(tree);
  }
}
