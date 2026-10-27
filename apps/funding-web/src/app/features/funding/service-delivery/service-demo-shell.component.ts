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
  afterNextRender,
  afterRenderEffect,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  NavigationStart,
  NavigationSkipped,
  Router,
  RouterLink,
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
    AdminDrawerComponent
  ],
  templateUrl: './service-demo-shell.component.html',
  styleUrls: [
    '../../../../styles/admin-fonts.css',
    './service-demo.css',
    './service-demo-motion.css',
    './service-demo-navigation.css'
  ],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServiceDemoShellComponent {
  readonly state = inject(ServiceDemoState);
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
        const body = this.document.getElementById('service-demo-body');
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
        this.syncRoute();
        this.menuOpen.set(false);
        const path = event.urlAfterRedirects.split(/[?#]/)[0] ?? '';
        if (path !== this.lastPath) {
          const changingEditorTab =
            this.lastPage === 'corriger' && this.state.page() === 'corriger';
          afterNextRender(
            () => {
              if (this.lastView !== event.urlAfterRedirects) return;
              const focusTarget = changingEditorTab
                ? this.element.nativeElement.querySelector<HTMLElement>(
                    `[data-og7="service-demo-editor-tab"][data-og7-id="${this.state.editorTab()}"]`
                  )
                : this.document.getElementById('service-demo-heading');
              focusTarget?.focus({ preventScroll: true });
              this.document
                .getElementById('service-demo-body')
                ?.scrollTo(
                  0,
                  this.viewPositions.get(event.urlAfterRedirects) ?? 0
                );
            },
            { injector: this.injector }
          );
          this.lastPath = path;
        }
        this.lastView = event.urlAfterRedirects;
        this.lastPage = this.state.page();
      });
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
      const clear = this.clearAfterDeparture;
      this.answerExit(false);
      if (clear) this.state.clearLocalWork();
    });
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
      this.state.page() === 'corriger'
    ) {
      event.preventDefault();
      if (!this.exitPending()) this.state.saveDraft();
    }
    if (event.key === 'Escape' && this.menuOpen()) {
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
    let current = this.route.snapshot;
    let id = '';
    while (current.firstChild) {
      current = current.firstChild;
      id = current.paramMap.get('id') ?? id;
    }
    if (id) this.state.selectDossier(id);
    const data = current.data;
    this.isList.set(data['list'] === true);
    this.isMissing.set(data['missing'] === true);
    this.state.page.set(data['page'] ?? data['detail'] ?? '');
    if (data['page'] === 'corriger')
      this.state.editorTab.set(current.paramMap.get('tab') ?? 'texte');
    this.titleKey.set(data['titleKey'] ?? 'serviceDemo.title');
    const origin = current.queryParamMap.get('retour');
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
    const previewOrigin = current.queryParamMap.get('origine');
    if (
      ['apercu', 'apercu-envoi'].includes(data['detail']) &&
      previewOrigin !== null &&
      previewOrigin !== data['detail'] &&
      demoPages.has(previewOrigin)
    )
      this.returnPage.set(previewOrigin);
    const messageSource = current.queryParamMap.get('source');
    if (
      data['detail'] === 'apercu-envoi' &&
      messageSource &&
      ['demander-correction', 'demander-accord'].includes(messageSource)
    )
      this.returnPage.set(messageSource);
    this.icon.set(data['icon'] ?? 'publications');
  }
}
