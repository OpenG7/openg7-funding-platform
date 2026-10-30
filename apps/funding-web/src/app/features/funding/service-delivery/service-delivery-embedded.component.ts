import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';

import { SERVICE_DELIVERY_TOUR_ENABLED } from '../config/admin-guide-features.js';

import { ServiceDemoShellComponent } from './service-demo-shell.component.js';
import {
  SERVICE_DEMO_EMBEDDED,
  ServiceDemoNavigation
} from './service-demo-navigation.js';
import { DEMO_DOSSIERS, ServiceDemoState } from './service-demo-state.js';
import {
  SERVICE_DEMO_EDITOR_TABS,
  resolveServiceDemoPage
} from './service-demo-pages.js';

/** Follow the first file from the promised services to results and evidence. */
const TOUR_PAGES = [
  '',
  'accord',
  'web',
  'confirmer-visibilite',
  'accord',
  'contenu',
  ...SERVICE_DEMO_EDITOR_TABS.map((tab) => `corriger/${tab}`),
  'apercu',
  'approuver-preparation',
  'autorisation',
  'demander-accord',
  'apercu-envoi',
  'accord-recu',
  'conditions',
  'contact',
  'confirmer-autorisation',
  'publication',
  'planifier',
  'confirmer-envoi',
  'resultat',
  'preuves',
  'historique'
] as const;
const TOUR_DOSSIER = DEMO_DOSSIERS[0].id;
const TOUR_DELAY = 20_000;

/** Public, browser-local workspace; its navigation never changes the host router. */
@Component({
  selector: 'openg7-service-delivery-embedded',
  standalone: true,
  imports: [ServiceDemoShellComponent],
  providers: [
    ServiceDemoState,
    ServiceDemoNavigation,
    { provide: SERVICE_DEMO_EMBEDDED, useValue: true }
  ],
  host: {
    class: 'service-delivery-embedded',
    'data-og7': 'service-delivery-embedded'
  },
  template:
    '<openg7-service-demo-shell [preserveFocus]="preserveTourFocus()" (closeRequested)="closeRequested.emit()" />',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServiceDeliveryEmbeddedComponent {
  readonly active = input(true);
  readonly closeRequested = output<void>();
  private readonly state = inject(ServiceDemoState);
  readonly hasLocalWork = this.state.hasLocalWork;
  private readonly currentTourState = signal<
    'stopped' | 'running' | 'paused' | 'completed'
  >('stopped');
  readonly tourState = this.currentTourState.asReadonly();
  private readonly currentTourStep = signal(0);
  readonly tourStep = this.currentTourStep.asReadonly();
  readonly tourTotal = TOUR_PAGES.length;
  readonly tourTitleKey = computed(() => {
    const page = TOUR_PAGES[this.tourStep()]!;
    if (page.startsWith('corriger/'))
      return `serviceDemoEditor.tabs.${page.split('/')[1]}`;
    return String(
      resolveServiceDemoPage([
        'demo',
        'prestations',
        'dossier',
        TOUR_DOSSIER,
        ...(page ? page.split('/') : [])
      ]).data['titleKey']
    );
  });
  readonly preserveTourFocus = signal(false);
  private readonly navigation = inject(ServiceDemoNavigation);
  private readonly document = inject(DOCUMENT);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly shell = viewChild(ServiceDemoShellComponent);
  private timer: number | undefined;
  private deadline = 0;
  private remaining = TOUR_DELAY;
  private tourUrl = '';
  private activatingTourLink = false;

  constructor() {
    afterRenderEffect(() => {
      const manualNavigation = this.navigation.url() !== this.tourUrl;
      if (manualNavigation) this.preserveTourFocus.set(false);
      if (!this.active() || manualNavigation) this.pauseTour();
    });
    afterRenderEffect((onCleanup) => {
      const view = this.document.defaultView;
      if (!view) return;
      const pauseWhenHidden = () => {
        if (this.document.hidden) this.pauseTour();
      };
      const pauseForDialog = () => {
        if (this.document.querySelector('dialog[open]')) this.pauseTour();
      };
      const observer = new view.MutationObserver(pauseForDialog);
      observer.observe(this.document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open']
      });
      this.document.addEventListener('visibilitychange', pauseWhenHidden);
      onCleanup(() => {
        observer.disconnect();
        this.document.removeEventListener('visibilitychange', pauseWhenHidden);
      });
    });
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  playTour(): void {
    const view = this.document.defaultView;
    if (
      !SERVICE_DELIVERY_TOUR_ENABLED ||
      !view ||
      !this.active() ||
      this.document.hidden ||
      this.document.querySelector('dialog[open]') ||
      this.tourState() === 'running'
    )
      return;
    if (this.tourState() !== 'paused') {
      this.currentTourStep.set(0);
      this.remaining = TOUR_DELAY;
    }
    this.preserveTourFocus.set(true);
    this.currentTourState.set('running');
    if (this.showTourStep()) this.scheduleStep();
    else this.pauseTour();
  }

  pauseTour(): void {
    if (this.tourState() !== 'running') return;
    const now = this.document.defaultView?.performance.now() ?? this.deadline;
    this.remaining = Math.max(0, this.deadline - now);
    this.clearTimer();
    this.currentTourState.set('paused');
  }

  stopTour(): void {
    if (!SERVICE_DELIVERY_TOUR_ENABLED) {
      this.pauseTour();
      return;
    }
    this.clearTimer();
    this.currentTourState.set('stopped');
    this.currentTourStep.set(0);
    this.remaining = TOUR_DELAY;
    this.preserveTourFocus.set(true);
    this.showTourStep();
  }

  /** Manual navigation and editing hand control back to the administrator. */
  @HostListener('pointerdown')
  @HostListener('click')
  @HostListener('keydown')
  @HostListener('input')
  onInteraction(): void {
    if (this.activatingTourLink) return;
    this.pauseTour();
    this.preserveTourFocus.set(false);
  }

  private showTourStep(step = this.tourStep()): boolean {
    const page = TOUR_PAGES[step]!;
    const target = `/demo/prestations/dossier/${TOUR_DOSSIER}${page ? '/' + page : ''}`;
    if (
      this.navigation.data()['detail'] === 'accord' &&
      (page === 'web' || page === 'contenu')
    ) {
      const service = page === 'web' ? 'web' : 'facebook';
      const link = this.element.nativeElement.querySelector<HTMLAnchorElement>(
        `a[data-og7="service-demo-promised-service"][data-og7-id="${service}"]`
      );
      // Activate only the visible, exact synthetic service link, never a command.
      if (
        !link ||
        link.getAttribute('href') !== target ||
        link.closest('[hidden]') ||
        link.getClientRects().length === 0
      )
        return false;
      this.tourUrl = target;
      this.activatingTourLink = true;
      try {
        link.click();
      } finally {
        this.activatingTourLink = false;
      }
      return this.navigation.url() === target;
    }
    this.tourUrl = target;
    void this.navigation.navigate(this.tourUrl);
    return true;
  }

  private scheduleStep(): void {
    const view = this.document.defaultView;
    if (!view) return;
    this.deadline = view.performance.now() + this.remaining;
    this.timer = view.setTimeout(() => {
      this.timer = undefined;
      if (
        !SERVICE_DELIVERY_TOUR_ENABLED ||
        !this.active() ||
        this.document.hidden ||
        this.document.querySelector('dialog[open]')
      ) {
        this.pauseTour();
        return;
      }
      this.remaining = TOUR_DELAY;
      if (this.tourStep() === TOUR_PAGES.length - 1) {
        this.currentTourState.set('completed');
        return;
      }
      const next = this.tourStep() + 1;
      if (!this.showTourStep(next)) {
        this.pauseTour();
        this.remaining = TOUR_DELAY;
        return;
      }
      this.currentTourStep.set(next);
      this.scheduleStep();
    }, this.remaining);
  }

  private clearTimer(): void {
    if (this.timer !== undefined)
      this.document.defaultView?.clearTimeout(this.timer);
    this.timer = undefined;
  }

  canLeave(): boolean | Promise<boolean> {
    return this.shell()?.canLeave() ?? true;
  }

  cancelLeave(): void {
    this.shell()?.answerExit(false);
  }

  /** Accept only a known synthetic file and keep the host router untouched. */
  openDossier(id: string): boolean {
    if (!DEMO_DOSSIERS.some((dossier) => dossier.id === id)) return false;
    this.onInteraction();
    void this.navigation.navigate(['/demo/prestations/dossier', id]);
    return true;
  }
}
