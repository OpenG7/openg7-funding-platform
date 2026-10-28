import {
  Injectable,
  InjectionToken,
  computed,
  inject,
  signal
} from '@angular/core';
import {
  ActivatedRoute,
  DefaultUrlSerializer,
  Router,
  UrlTree,
  convertToParamMap,
  type Data,
  type NavigationExtras,
  type ParamMap,
  type Params,
  type QueryParamsHandling
} from '@angular/router';

import {
  SERVICE_DEMO_LIST_DATA,
  resolveServiceDemoPage,
  serviceDemoPageKind
} from './service-demo-pages.js';

export const SERVICE_DEMO_EMBEDDED = new InjectionToken<boolean>(
  'SERVICE_DEMO_EMBEDDED',
  { providedIn: 'root', factory: () => false }
);

type DemoCommands = string | readonly unknown[] | UrlTree;

/** Feature-local navigation: embedded visits never navigate the administrative router. */
@Injectable()
export class ServiceDemoNavigation {
  readonly embedded = inject(SERVICE_DEMO_EMBEDDED);
  private readonly router = inject(Router);
  private readonly serializer = new DefaultUrlSerializer();
  private activeRoute: ActivatedRoute | undefined;
  private readonly currentData = signal<Data>(SERVICE_DEMO_LIST_DATA);
  private readonly currentParams = signal<ParamMap>(convertToParamMap({}));
  private readonly currentQuery = signal<ParamMap>(convertToParamMap({}));
  private readonly currentUrl = signal('/demo/prestations');
  readonly data = this.currentData.asReadonly();
  readonly params = this.currentParams.asReadonly();
  readonly query = this.currentQuery.asReadonly();
  readonly url = this.currentUrl.asReadonly();
  readonly kind = computed(() => serviceDemoPageKind(this.data()));

  syncRoute(root: ActivatedRoute): void {
    if (this.embedded) return;
    let route = root;
    let snapshot = root.snapshot;
    const params: Params = { ...snapshot.params };
    // The complete snapshot tree exists while child outlets are still activating.
    // Their live ActivatedRoute instances may not have a snapshot yet.
    while (snapshot.firstChild) {
      snapshot = snapshot.firstChild;
      if (route.firstChild?.snapshot) route = route.firstChild;
      Object.assign(params, snapshot.params);
    }
    this.activeRoute = route;
    this.currentData.set(snapshot.data);
    this.currentParams.set(convertToParamMap(params));
    this.currentQuery.set(snapshot.queryParamMap);
    const navigating = this.router.currentNavigation()?.finalUrl;
    this.currentUrl.set(
      navigating ? this.serializer.serialize(navigating) : this.router.url
    );
  }

  async navigate(
    commands: DemoCommands,
    extras: NavigationExtras = {}
  ): Promise<boolean> {
    const tree = this.target(commands, extras);
    if (!this.embedded) return this.router.navigateByUrl(tree, extras);
    const segments =
      tree.root.children['primary']?.segments.map((segment) => segment.path) ??
      [];
    // Outside links are handled by the embedding host's explicit close action.
    if (segments[0] !== 'demo' || segments[1] !== 'prestations') return false;
    const resolved = resolveServiceDemoPage(segments);
    this.currentData.set(resolved.data);
    this.currentParams.set(convertToParamMap(resolved.params));
    this.currentQuery.set(convertToParamMap(tree.queryParams));
    this.currentUrl.set(this.serializer.serialize(tree));
    return true;
  }

  linkUrl(
    commands: DemoCommands,
    queryParams?: Params | null,
    queryParamsHandling?: QueryParamsHandling | null
  ): UrlTree {
    return this.target(commands, { queryParams, queryParamsHandling });
  }

  private target(commands: DemoCommands, extras: NavigationExtras): UrlTree {
    // Link directives also track same-page filter changes in standalone mode.
    this.url();
    if (!this.embedded) {
      if (commands instanceof UrlTree) return commands;
      return this.router.createUrlTree(this.routerCommands(commands), {
        ...extras,
        relativeTo: extras.relativeTo ?? this.activeRoute
      });
    }
    const tree =
      commands instanceof UrlTree
        ? this.serializer.parse(this.serializer.serialize(commands))
        : this.embeddedTree(commands);
    if (
      commands instanceof UrlTree &&
      extras.queryParams === undefined &&
      extras.queryParamsHandling === undefined
    )
      return tree;
    const current = this.serializer.parse(this.url());
    const handling = extras.queryParamsHandling;
    const query =
      handling === 'preserve'
        ? current.queryParams
        : handling === 'merge'
          ? { ...current.queryParams, ...extras.queryParams }
          : (extras.queryParams ?? {});
    tree.queryParams = Object.fromEntries(
      Object.entries(query).filter(
        ([, value]) => value !== null && value !== undefined
      )
    );
    tree.fragment = extras.preserveFragment
      ? current.fragment
      : (extras.fragment ?? tree.fragment);
    return tree;
  }

  private routerCommands(commands: string | readonly unknown[]): unknown[] {
    if (typeof commands !== 'string') return [...commands];
    if (!commands.startsWith('/')) return [commands];
    // href() already encodes synthetic dossier identifiers. Decode the URL once
    // before Router's command serializer encodes each path segment itself.
    const parsed = this.serializer.parse(commands);
    const segments =
      parsed.root.children['primary']?.segments.map(
        (segment) => segment.path
      ) ?? [];
    return ['/', ...segments];
  }

  private embeddedTree(commands: string | readonly unknown[]): UrlTree {
    if (typeof commands === 'string' && commands.startsWith('/'))
      return this.serializer.parse(commands);
    const entries = typeof commands === 'string' ? [commands] : commands;
    let segments =
      this.serializer
        .parse(this.url())
        .root.children['primary']?.segments.map((segment) => segment.path) ??
      [];
    for (const [index, command] of entries.entries()) {
      if (typeof command !== 'string' && typeof command !== 'number')
        throw new TypeError(
          'A service demo destination must contain path segments'
        );
      const value = String(command);
      if (index === 0 && value.startsWith('/')) segments = [];
      for (const part of value.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') segments.pop();
        else segments.push(part);
      }
    }
    return this.serializer.parse(
      '/' + segments.map(encodeURIComponent).join('/')
    );
  }
}
