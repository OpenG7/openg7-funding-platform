import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type ComponentRef,
  DestroyRef,
  ElementRef,
  ViewContainerRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { RouterLink } from '@angular/router';

import type { ServiceDeliveryEmbeddedComponent } from '../../service-delivery/index.js';
import { AdminGuideNavigationService } from '../../services/admin-guide-navigation.service.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';
import { AdminGuidanceService } from '../../services/admin-guidance.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';
import type { AdminAutomaticComponent } from '../admin-automatic/admin-automatic.component.js';
import { adminContentRegions } from '../admin-layout/admin-content-scope.js';

import { highlightGuidanceRegions } from './admin-guidance-highlight.js';
import { AdminPaymentJourneyComponent } from './admin-payment-journey.component.js';
import { AdminPaymentJourneyService } from './admin-payment-journey.service.js';
import {
  ADMIN_GUIDANCE_LOAD_RETRIES,
  guidanceChunkRetrySource,
  loadGuidanceChunkRetry
} from './admin-guidance-retry.js';
import type { AdminWorkflowGuideComponent } from './admin-workflow-guide.component.js';
import {
  guidanceSpace,
  revealGuidanceRegion
} from './admin-guidance-scroll.js';

/** Admin orientation organism: a quiet, optional reading aid beside the existing workflow. */
@Component({
  selector: 'openg7-admin-guidance',
  standalone: true,
  imports: [RouterLink, AdminIconComponent, AdminPaymentJourneyComponent],
  host: { '[class.active]': 'guidance.available() && guidance.enabled()' },
  templateUrl: './admin-guidance.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-guidance.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminGuidanceComponent {
  readonly guidance = inject(AdminGuidanceService);
  readonly journey = inject(AdminPaymentJourneyService);
  readonly i18n = inject(FundingI18nService);
  readonly missing = signal(false);
  readonly placement = signal<'top' | 'bottom'>('top');
  readonly automaticLoading = signal(false);
  readonly automaticError = signal(false);
  readonly workflowLoading = signal(false);
  readonly workflowError = signal(false);
  readonly serviceDeliverySelected = signal(false);
  readonly serviceDeliveryLoading = signal(false);
  readonly serviceDeliveryError = signal(false);
  private readonly serviceDeliveryRequested = signal(false);
  private readonly serviceDeliveryLoadAttempt = signal(0);
  private readonly serviceDeliveryRetrySource = signal<string | null>(null);
  readonly canRetryServiceDelivery = computed(
    () =>
      this.serviceDeliveryError() &&
      this.serviceDeliveryRetrySource() !== null &&
      this.serviceDeliveryLoadAttempt() < ADMIN_GUIDANCE_LOAD_RETRIES
  );
  private readonly serviceDeliveryComponent =
    signal<ComponentRef<ServiceDeliveryEmbeddedComponent> | null>(null);
  readonly serviceDeliveryLoaded = computed(
    () => this.serviceDeliveryComponent() !== null
  );
  private readonly departures = inject(AdminGuideNavigationService);
  private readonly admin = inject(FundingAdminService);
  private readonly serviceDeliveryIdentity = computed(() => {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}`;
  });
  private loadedServiceDeliveryIdentity = '';
  private readonly automaticLoadAttempt = signal(0);
  private readonly workflowLoadAttempt = signal(0);
  private readonly automaticRetrySource = signal<string | null>(null);
  private readonly workflowRetrySource = signal<string | null>(null);
  readonly canRetryAutomatic = computed(
    () =>
      this.automaticError() &&
      this.automaticRetrySource() !== null &&
      this.automaticLoadAttempt() < ADMIN_GUIDANCE_LOAD_RETRIES
  );
  readonly canRetryWorkflows = computed(
    () =>
      this.workflowError() &&
      this.workflowRetrySource() !== null &&
      this.workflowLoadAttempt() < ADMIN_GUIDANCE_LOAD_RETRIES
  );
  private readonly automaticComponent =
    signal<ComponentRef<AdminAutomaticComponent> | null>(null);
  private readonly portfolioStartRequested = signal(false);
  readonly portfolioStartDisabled = computed(() => {
    const automatic = this.automaticComponent()?.instance;
    const run = automatic?.portfolio.snapshot().state?.run;
    return (
      this.portfolioStartRequested() ||
      this.automaticLoading() ||
      !!automatic?.portfolioStarting() ||
      !!automatic?.portfolio.active() ||
      (!!run && run.status !== 'completed')
    );
  });
  private readonly document = inject(DOCUMENT);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly card = viewChild<ElementRef<HTMLElement>>('card');
  private readonly toggle = viewChild<ElementRef<HTMLButtonElement>>('toggle');
  private readonly resume = viewChild<ElementRef<HTMLAnchorElement>>('resume');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('stepHeading');
  private readonly automaticHost = viewChild('automaticHost', {
    read: ViewContainerRef
  });
  private readonly workflowHost = viewChild('workflowHost', {
    read: ViewContainerRef
  });
  private readonly serviceDeliveryHost = viewChild('serviceDeliveryHost', {
    read: ViewContainerRef
  });
  private focusServiceDelivery = false;
  private focusResume = false;
  private releaseHighlight: (() => void) | undefined;
  private frame = 0;

  constructor() {
    afterRenderEffect((onCleanup) => {
      const identity = this.serviceDeliveryIdentity();
      if (
        this.loadedServiceDeliveryIdentity &&
        identity !== this.loadedServiceDeliveryIdentity
      ) {
        this.serviceDeliveryRequested.set(false);
        this.serviceDeliverySelected.set(false);
      }
      this.loadedServiceDeliveryIdentity = identity;
      const host = this.serviceDeliveryHost();
      if (!host || !this.serviceDeliveryRequested()) return;
      const attempt = this.serviceDeliveryLoadAttempt();
      const retrySource = untracked(this.serviceDeliveryRetrySource);
      let current = true;
      let release: (() => void) | undefined;
      this.serviceDeliveryLoading.set(true);
      this.serviceDeliveryError.set(false);
      onCleanup(() => {
        current = false;
        release?.();
        this.serviceDeliveryComponent.set(null);
        this.serviceDeliveryLoading.set(false);
      });
      const load =
        attempt && retrySource
          ? loadGuidanceChunkRetry<ServiceDeliveryEmbeddedComponent>(
              retrySource,
              this.document.baseURI,
              attempt,
              'ServiceDeliveryEmbeddedComponent'
            )
          : import('../../service-delivery/index.js').then(
              (module) => module.ServiceDeliveryEmbeddedComponent
            );
      void load
        .then((componentType) => {
          if (!current || !this.guidance.available()) return;
          const component = host.createComponent(componentType);
          this.serviceDeliveryComponent.set(component);
          const unregister = this.departures.register({
            hasLocalWork: () => component.instance.hasLocalWork(),
            canLeave: () => component.instance.canLeave(),
            cancelLeave: () => component.instance.cancelLeave(),
            reveal: () => this.openServiceDelivery()
          });
          release = () => {
            unregister();
            component.destroy();
          };
          component.instance.closeRequested.subscribe(() =>
            this.selectDiscovery()
          );
          this.serviceDeliveryLoading.set(false);
          component.changeDetectorRef.markForCheck();
        })
        .catch((error: unknown) => {
          if (!current) return;
          release?.();
          this.serviceDeliveryRetrySource.set(
            guidanceChunkRetrySource(error, this.document.baseURI)
          );
          this.serviceDeliveryLoading.set(false);
          this.serviceDeliveryError.set(true);
        });
    });
    afterRenderEffect((onCleanup) => {
      const host = this.workflowHost();
      if (!host) return;
      const attempt = this.workflowLoadAttempt();
      const retrySource = untracked(this.workflowRetrySource);
      let current = true;
      let release: (() => void) | undefined;
      this.workflowLoading.set(true);
      this.workflowError.set(false);
      onCleanup(() => {
        current = false;
        release?.();
        this.workflowLoading.set(false);
      });
      const load =
        attempt && retrySource
          ? loadGuidanceChunkRetry<AdminWorkflowGuideComponent>(
              retrySource,
              this.document.baseURI,
              attempt,
              'AdminWorkflowGuideComponent'
            )
          : import('./admin-workflow-guide.component.js').then(
              ({ AdminWorkflowGuideComponent }) => AdminWorkflowGuideComponent
            );
      void load
        .then((AdminWorkflowGuideComponent) => {
          if (!current || !this.guidance.available()) return;
          const component = host.createComponent(AdminWorkflowGuideComponent);
          release = () => component.destroy();
          component.instance.moveRequested.subscribe(() => this.moveCard());
          this.workflowLoading.set(false);
          component.changeDetectorRef.markForCheck();
        })
        .catch((error: unknown) => {
          if (!current) return;
          release?.();
          this.workflowRetrySource.set(
            guidanceChunkRetrySource(error, this.document.baseURI)
          );
          this.workflowLoading.set(false);
          this.workflowError.set(true);
        });
    });
    // The optional admin surface uses the existing router component runtime.
    // A first deferred block would add its runtime to the public initial bundle.
    afterRenderEffect((onCleanup) => {
      const host = this.automaticHost();
      if (!host) return;
      const attempt = this.automaticLoadAttempt();
      const retrySource = untracked(this.automaticRetrySource);
      let current = true;
      let release: (() => void) | undefined;
      onCleanup(() => {
        current = false;
        release?.();
        this.automaticComponent.set(null);
        this.automaticLoading.set(false);
        this.portfolioStartRequested.set(false);
      });
      this.automaticLoading.set(true);
      this.automaticError.set(false);
      const load =
        attempt && retrySource
          ? loadGuidanceChunkRetry<AdminAutomaticComponent>(
              retrySource,
              this.document.baseURI,
              attempt,
              'AdminAutomaticComponent'
            )
          : import('../admin-automatic/admin-automatic.component.js').then(
              ({ AdminAutomaticComponent }) => AdminAutomaticComponent
            );
      void load
        .then((AdminAutomaticComponent) => {
          if (!current || !this.guidance.available()) return;
          const component = host.createComponent(AdminAutomaticComponent);
          this.automaticComponent.set(component);
          release = () => component.destroy();
          component.instance.show.subscribe((target) => this.show(target));
          this.automaticLoading.set(false);
          component.changeDetectorRef.markForCheck();
        })
        .catch((error: unknown) => {
          if (!current) return;
          release?.();
          release = undefined;
          this.automaticRetrySource.set(
            guidanceChunkRetrySource(error, this.document.baseURI)
          );
          this.automaticComponent.set(null);
          this.automaticLoading.set(false);
          this.automaticError.set(true);
          this.portfolioStartRequested.set(false);
        });
    });
    afterRenderEffect(() => {
      const automatic = this.automaticComponent()?.instance;
      if (!this.portfolioStartRequested() || !automatic) return;
      if (automatic.languageError()) {
        this.portfolioStartRequested.set(false);
      } else if (automatic.languageReady()) {
        this.portfolioStartRequested.set(false);
        void automatic.startPortfolio();
      }
    });
    afterRenderEffect(() => {
      this.guidance.page();
      this.guidance.step();
      this.guidance.snapshot();
      this.guidance.mode();
      if (this.guidance.mode() !== 'discovery')
        this.serviceDeliverySelected.set(false);
      const embedded = this.serviceDeliveryComponent();
      if (
        this.serviceDeliverySelected() &&
        embedded &&
        this.focusServiceDelivery
      ) {
        this.focusServiceDelivery = false;
        (embedded.location.nativeElement as HTMLElement)
          .querySelector<HTMLElement>('#service-demo-heading')
          ?.focus({ preventScroll: true });
      }
      this.journey.data();
      this.clearHighlight();
      this.missing.set(false);
      if (this.focusResume && this.resume()) {
        this.focusResume = false;
        this.resume()!.nativeElement.focus();
      }
      if (
        this.guidance.resumeTarget() === this.guidance.page()?.id &&
        this.heading()
      ) {
        this.heading()!.nativeElement.focus({ preventScroll: true });
        this.guidance.resumeTarget.set(null);
      }
    });
    inject(DestroyRef).onDestroy(() => this.clearHighlight());
  }
  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.guidance.' + key, params);
  }
  openServiceDelivery(): void {
    if (!this.guidance.available()) return;
    if (!this.guidance.enabled()) this.guidance.toggle();
    this.guidance.setMode('discovery');
    this.focusServiceDelivery = true;
    this.serviceDeliverySelected.set(true);
    this.serviceDeliveryRequested.set(true);
    this.clearHighlight();
  }
  selectDiscovery(): void {
    this.serviceDeliverySelected.set(false);
    this.guidance.setMode('discovery');
    this.guidance.resumeTarget.set(this.guidance.page()?.id ?? null);
  }
  retryServiceDelivery(): void {
    if (!this.canRetryServiceDelivery() || this.serviceDeliveryLoading())
      return;
    this.serviceDeliveryLoadAttempt.update((attempt) => attempt + 1);
  }
  retryAutomatic(): void {
    if (
      !this.guidance.available() ||
      !this.canRetryAutomatic() ||
      this.automaticLoading()
    )
      return;
    // Loading the optional view never starts a preparation passage.
    this.portfolioStartRequested.set(false);
    this.automaticLoadAttempt.update((attempt) => attempt + 1);
  }
  retryWorkflows(): void {
    if (
      !this.guidance.available() ||
      !this.canRetryWorkflows() ||
      this.workflowLoading()
    )
      return;
    this.workflowLoadAttempt.update((attempt) => attempt + 1);
  }
  startPortfolio(): void {
    if (!this.guidance.available() || this.portfolioStartDisabled()) return;
    this.portfolioStartRequested.set(true);
    if (!this.guidance.enabled()) this.guidance.toggle();
    this.guidance.setMode('automatic');
  }
  move(direction: number): void {
    this.guidance.move(direction);
    this.guidance.resumeTarget.set(this.guidance.page()?.id ?? null);
  }
  restart(): void {
    this.guidance.restart();
    this.guidance.resumeTarget.set(this.guidance.page()?.id ?? null);
  }
  pause(): void {
    this.focusResume = true;
    this.guidance.pause();
  }
  forget(): void {
    this.guidance.forget();
    this.toggle()?.nativeElement.focus();
  }
  moveCard(): void {
    this.clearHighlight();
    this.placement.update((value) => (value === 'top' ? 'bottom' : 'top'));
  }
  show(hook = this.guidance.step()?.target): void {
    this.clearHighlight();
    if (hook && !/^[a-z0-9-]+$/.test(hook)) return;
    const layout = this.element.nativeElement.closest<HTMLElement>(
      '[data-og7="admin-layout"]'
    );
    const scopes = layout ? adminContentRegions(layout) : [];
    const main = scopes.find((region) => region.id === 'admin-main');
    const view = this.document.defaultView;
    const regions = hook
      ? scopes
          .flatMap((scope) =>
            Array.from(
              scope.querySelectorAll<HTMLElement>(`[data-og7="${hook}"]`)
            )
          )
          .filter(
            (region) =>
              region.closest('[data-og7="admin-layout"]') === layout &&
              region.getClientRects().length > 0 &&
              view?.getComputedStyle(region).visibility !== 'hidden'
          )
      : [];
    this.missing.set(Boolean(hook && regions.length === 0));
    if (this.guidance.mode() === 'payment' && regions.length === 0) return;
    const landmark = regions[0] ?? main;
    const target =
      landmark?.querySelector<HTMLElement>('h1, h2, h3, legend') ?? landmark;
    if (!target || !landmark || !view) return;
    const tabindex = target.getAttribute('tabindex');
    if (tabindex === null) target.setAttribute('tabindex', '-1');
    const releaseRegions = highlightGuidanceRegions(
      regions.length ? regions : [target],
      view
    );
    this.releaseHighlight = () => {
      releaseRegions();
      if (tabindex === null) target.removeAttribute('tabindex');
      else target.setAttribute('tabindex', tabindex);
    };
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'instant'
    });
    const card = this.card()?.nativeElement;
    const current = guidanceSpace(
      landmark,
      card?.getBoundingClientRect(),
      view
    );
    card?.classList.toggle('at-bottom');
    const alternative = guidanceSpace(
      landmark,
      card?.getBoundingClientRect(),
      view
    );
    card?.classList.toggle('at-bottom');
    const required = landmark.getBoundingClientRect().height;
    if (
      current.bottom - current.top < required &&
      alternative.bottom - alternative.top > current.bottom - current.top
    ) {
      this.placement.update((value) => (value === 'top' ? 'bottom' : 'top'));
    }
    this.reveal(landmark, target, true);
  }
  private reveal(
    landmark: HTMLElement,
    target: HTMLElement,
    moveCard: boolean
  ): void {
    const view = this.document.defaultView;
    if (!view) return;
    this.frame = view.requestAnimationFrame(() => {
      this.frame = 0;
      if (target.isConnected) {
        const card = this.card()?.nativeElement.getBoundingClientRect();
        revealGuidanceRegion(landmark, target, card, view);
        const space = guidanceSpace(landmark, card, view);
        const region = landmark.getBoundingClientRect();
        const heading = target.getBoundingClientRect();
        const fits = region.height <= space.bottom - space.top;
        const visible = fits
          ? region.top >= space.top - 1 && region.bottom <= space.bottom + 1
          : heading.top >= space.top - 1 &&
            heading.top + Math.min(heading.height, 24) <= space.bottom;
        // Scroll limits can make the larger theoretical space unreachable.
        if (!visible && moveCard && card) {
          this.placement.update((value) =>
            value === 'top' ? 'bottom' : 'top'
          );
          this.reveal(landmark, target, false);
        }
      }
    });
  }
  private clearHighlight(): void {
    if (this.frame) this.document.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.releaseHighlight?.();
    this.releaseHighlight = undefined;
  }
}
