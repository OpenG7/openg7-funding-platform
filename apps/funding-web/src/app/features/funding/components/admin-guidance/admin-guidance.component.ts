import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminGuidanceService } from '../../services/admin-guidance.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

import { highlightGuidanceRegions } from './admin-guidance-highlight.js';
import { AdminPaymentJourneyComponent } from './admin-payment-journey.component.js';
import { AdminPaymentJourneyService } from './admin-payment-journey.service.js';
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
  private readonly document = inject(DOCUMENT);
  private readonly card = viewChild<ElementRef<HTMLElement>>('card');
  private readonly toggle = viewChild<ElementRef<HTMLButtonElement>>('toggle');
  private readonly resume = viewChild<ElementRef<HTMLAnchorElement>>('resume');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('stepHeading');
  private focusResume = false;
  private releaseHighlight: (() => void) | undefined;
  private frame = 0;

  constructor() {
    afterRenderEffect(() => {
      this.guidance.page();
      this.guidance.step();
      this.guidance.snapshot();
      this.guidance.mode();
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
    const main = this.document.getElementById('admin-main');
    const view = this.document.defaultView;
    const regions = hook
      ? Array.from(
          main?.querySelectorAll<HTMLElement>(`[data-og7="${hook}"]`) ?? []
        ).filter(
          (region) =>
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
