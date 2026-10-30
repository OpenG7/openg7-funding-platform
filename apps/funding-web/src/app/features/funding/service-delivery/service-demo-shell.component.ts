import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  ViewEncapsulation,
  computed,
  effect,
  afterNextRender,
  afterRenderEffect,
  inject,
  input,
  output,
  untracked,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  NavigationStart,
  NavigationSkipped,
  Router,
  RouterOutlet
} from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { filter } from 'rxjs';

import { AdminDrawerComponent } from '../components/admin-ui/admin-drawer.component.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../components/admin-ui/admin-icon.component.js';

import { DEMO_DOSSIERS, ServiceDemoState } from './service-demo-state.js';
import { ServiceDemoHelpComponent } from './service-demo-help.component.js';
import { DEMO_DETAIL_PAGES } from './service-demo-detail.component.js';
import { ServiceDemoTabsDirective } from './service-demo-tabs.directive.js';
import { ServiceDemoTransitionDirective } from './service-demo-transition.directive.js';
import { ServiceDemoLinkDirective as RouterLink } from './service-demo-link.directive.js';
import { ServiceDemoNavigation } from './service-demo-navigation.js';
import { ServiceDemoListComponent } from './service-demo-list.component.js';
import { ServiceDemoWorkspaceComponent } from './service-demo-workspace.component.js';
import { ServiceDemoEditorComponent } from './service-demo-editor.component.js';
import { ServiceDemoHistoryComponent } from './service-demo-history.component.js';
import { ServiceDemoDetailComponent } from './service-demo-detail.component.js';

const demoPages = new Set([
  '',
  'contenu',
  'autorisation',
  'publication',
  'historique',
  ...['texte', 'image', 'liens', 'mentions', 'options'].map(
    (tab) => `corriger/${tab}`
  ),
  ...DEMO_DETAIL_PAGES.map((page) => page.path)
]);

@Component({
  selector: 'openg7-service-demo-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    TranslatePipe,
    AdminIconComponent,
    NgTemplateOutlet,
    ServiceDemoHelpComponent,
    ServiceDemoTabsDirective,
    ServiceDemoTransitionDirective,
    AdminDrawerComponent,
    ServiceDemoListComponent,
    ServiceDemoWorkspaceComponent,
    ServiceDemoEditorComponent,
    ServiceDemoHistoryComponent,
    ServiceDemoDetailComponent
  ],
  templateUrl: './service-demo-shell.component.html',
  styleUrls: [
    '../../../../styles/admin-fonts.css',
    './service-demo.css',
    './service-demo-motion.css',
    './service-demo-navigation.css',
    './service-demo-embedded.css'
  ],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServiceDemoShellComponent {
  readonly preserveFocus = input(false);
  readonly state = inject(ServiceDemoState);
  readonly navigation = inject(ServiceDemoNavigation);
  readonly closeRequested = output<void>();
  readonly detailViews = computed(() => [
    this.navigation.url().split(/[?#]/)[0]
  ]);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly viewPositions = new Map<string, number>();
  private lastView = '';
  private lastPage = '';
  private lastPath = '';
  private resolveExit: ((accepted: boolean) => void) | null = null;
  private clearAfterDeparture = false;
  readonly exitPending = signal(false);
  readonly draftDossiers = computed(() =>
    DEMO_DOSSIERS.filter((dossier) =>
      this.state.draftIds().includes(dossier.id)
    )
  );
  readonly menuOpen = signal(false);
  readonly titleKey = signal('serviceDemo.title');
  readonly icon = signal<AdminIconName>('publications');
  readonly isList = signal(true);
  readonly isMissing = signal(false);
  readonly returnPage = signal('');
  readonly editorOrigin = signal('contenu');
  readonly showSteps = computed(() => !this.isList() && !this.isMissing());
  readonly steps = ['contenu', 'autorisation', 'publication'] as const;
  readonly activeStep = computed(() => {
    let page = ['apercu', 'apercu-envoi'].includes(this.state.page())
      ? this.returnPage()
      : this.state.page();
    const visited = new Set<string>();
    while (page && !visited.has(page)) {
      visited.add(page);
      if (this.steps.includes(page as (typeof this.steps)[number])) return page;
      if (page === 'corriger' || page.startsWith('corriger/'))
        return this.editorOrigin();
      if (page === 'historique' || page === 'web') return 'contenu';
      page =
        DEMO_DETAIL_PAGES.find((entry) => entry.path === page)?.parent ?? '';
    }
    return '';
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    if (!this.navigation.embedded)
      this.router.events
        .pipe(
          filter(
            (event) =>
              event instanceof NavigationEnd ||
              event instanceof NavigationStart ||
              event instanceof NavigationSkipped
          ),
          takeUntilDestroyed(destroyRef)
        )
        .subscribe((event) => {
          const body = this.scrollport();
          if (event instanceof NavigationSkipped) {
            this.answerExit(false);
            return;
          }
          if (event instanceof NavigationStart) {
            this.answerExit(false);
            if (this.lastView)
              this.viewPositions.set(this.lastView, body?.scrollTop ?? 0);
            return;
          }
          this.navigation.syncRoute(this.route);
          this.updateView(event.urlAfterRedirects);
        });
    if (this.navigation.embedded) {
      effect(() => {
        const url = this.navigation.url();
        untracked(() => {
          if (this.lastView)
            this.viewPositions.set(
              this.lastView,
              this.scrollport()?.scrollTop ?? 0
            );
          this.updateView(url);
        });
      });
    } else {
      this.navigation.syncRoute(this.route);
    }
    this.syncRoute();
    afterRenderEffect((onCleanup) => {
      if (!this.state.hasLocalWork()) return;
      const view = this.document.defaultView;
      if (!view) return;
      const preventLoss = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        event.returnValue = '';
      };
      view.addEventListener('beforeunload', preventLoss);
      onCleanup(() => view.removeEventListener('beforeunload', preventLoss));
    });
    destroyRef.onDestroy(() => {
      const clear = this.navigation.embedded || this.clearAfterDeparture;
      this.answerExit(false);
      if (clear) this.state.clearLocalWork();
    });
  }

  private updateView(url: string): void {
    this.syncRoute();
    this.menuOpen.set(false);
    const path = url.split(/[?#]/)[0] ?? '';
    if (path !== this.lastPath) {
      const changingEditorTab =
        this.lastPage === 'corriger' && this.state.page() === 'corriger';
      afterNextRender(
        () => {
          if (this.lastView !== url) return;
          const focusTarget = changingEditorTab
            ? this.element.nativeElement.querySelector<HTMLElement>(
                `[data-og7="service-demo-editor-tab"][data-og7-id="${this.state.editorTab()}"]`
              )
            : this.element.nativeElement.querySelector<HTMLElement>(
                '#service-demo-heading'
              );
          if (!this.preserveFocus())
            focusTarget?.focus({ preventScroll: true });
          this.scrollport()?.scrollTo(0, this.viewPositions.get(url) ?? 0);
        },
        { injector: this.injector }
      );
      this.lastPath = path;
    }
    this.lastView = url;
    this.lastPage = this.state.page();
  }

  private scrollport(): HTMLElement | null {
    return this.element.nativeElement.querySelector<HTMLElement>(
      this.navigation.embedded
        ? '[data-og7="service-demo"]'
        : '#service-demo-body'
    );
  }

  skipToContent(event: Event): void {
    if (!this.navigation.embedded) return;
    event.preventDefault();
    this.element.nativeElement
      .querySelector<HTMLElement>('#service-demo-heading')
      ?.focus();
  }

  canLeave(): boolean | Promise<boolean> {
    if (!this.state.hasLocalWork()) return true;
    if (this.exitPending()) return false;
    this.exitPending.set(true);
    return new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  answerExit(accepted: boolean): void {
    this.clearAfterDeparture = accepted;
    const resolve = this.resolveExit;
    this.resolveExit = null;
    this.exitPending.set(false);
    resolve?.(accepted);
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent): void {
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 's' &&
      (!this.navigation.embedded ||
        this.element.nativeElement.contains(this.document.activeElement)) &&
      this.state.page() === 'corriger'
    ) {
      event.preventDefault();
      if (!this.exitPending()) this.state.saveDraft();
    }
    if (
      event.key === 'Escape' &&
      !event.defaultPrevented &&
      !this.exitPending() &&
      this.menuOpen() &&
      (!this.navigation.embedded ||
        this.element.nativeElement.contains(this.document.activeElement))
    ) {
      this.menuOpen.set(false);
      this.element.nativeElement
        .querySelector<HTMLElement>('[data-og7="service-demo-more"]')
        ?.focus();
    }
  }

  @HostListener('document:click', ['$event'])
  closeOutsideMenu(event: Event): void {
    const menu = this.element.nativeElement.querySelector(
      '[data-og7="service-demo-menu"]'
    );
    if (this.menuOpen() && menu && !event.composedPath().includes(menu))
      this.menuOpen.set(false);
  }

  private syncRoute(): void {
    const params = this.navigation.params();
    const query = this.navigation.query();
    const id = params.get('id');
    const returnTo = query.get('returnTo');
    // The guide passes only its workspace path, never dossier queries or an external URL.
    this.state.returnTo.set(
      returnTo &&
        returnTo.length <= 256 &&
        /^\/admin\/fundraiser(?:\/[a-z][a-z0-9-]*)*$/.test(returnTo)
        ? returnTo
        : null
    );
    if (id) this.state.selectDossier(id);
    const data = this.navigation.data();
    this.isList.set(data['list'] === true);
    this.isMissing.set(data['missing'] === true);
    this.state.page.set(data['page'] ?? data['detail'] ?? '');
    if (data['page'] === 'corriger')
      this.state.editorTab.set(params.get('tab') ?? 'texte');
    this.titleKey.set(data['titleKey'] ?? 'serviceDemo.title');
    const origin = query.get('retour');
    this.editorOrigin.set(
      origin && this.steps.includes(origin as (typeof this.steps)[number])
        ? origin
        : 'contenu'
    );
    this.returnPage.set(
      data['page'] === 'corriger' &&
        origin &&
        this.steps.includes(origin as (typeof this.steps)[number])
        ? origin
        : (data['parent'] ?? '')
    );
    const previewOrigin = query.get('origine');
    if (
      ['apercu', 'apercu-envoi'].includes(data['detail']) &&
      previewOrigin !== null &&
      previewOrigin !== data['detail'] &&
      demoPages.has(previewOrigin)
    )
      this.returnPage.set(previewOrigin);
    const messageSource = query.get('source');
    if (
      data['detail'] === 'apercu-envoi' &&
      messageSource &&
      ['demander-correction', 'demander-accord'].includes(messageSource)
    )
      this.returnPage.set(messageSource);
    this.icon.set(data['icon'] ?? 'publications');
  }
}
