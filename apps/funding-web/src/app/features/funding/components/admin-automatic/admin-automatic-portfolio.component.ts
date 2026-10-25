import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  AdminAutomaticRunEntry,
  SponsorshipOfferedBenefit
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { highlightGuidanceRegions } from '../admin-guidance/admin-guidance-highlight.js';
import { revealGuidanceRegion } from '../admin-guidance/admin-guidance-scroll.js';
import {
  AdminBadgeComponent,
  type AdminBadgeTone
} from '../admin-ui/admin-badge.component.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../admin-ui/admin-icon.component.js';

import { automaticAdminUrl } from './admin-automatic-run.js';
import { AdminAutomaticPortfolioService } from './admin-automatic-portfolio.service.js';
import { AdminPreparationCarouselComponent } from './admin-preparation-carousel.component.js';

@Component({
  selector: 'openg7-admin-automatic-portfolio',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    RouterLink,
    AdminBadgeComponent,
    AdminIconComponent,
    AdminPreparationCarouselComponent
  ],
  templateUrl: './admin-automatic-portfolio.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-automatic.component.css',
    './admin-automatic-portfolio.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminAutomaticPortfolioComponent {
  readonly portfolio = inject(AdminAutomaticPortfolioService);
  readonly i18n = inject(FundingI18nService);
  readonly view = input<'records' | 'batch' | 'other'>('records');
  readonly prepare = output<AdminAutomaticRunEntry>();
  readonly processingExpanded = signal(false);
  readonly benefitMetrics = [
    'expected',
    'fulfilled',
    'waived',
    'outstanding',
    'unknown'
  ] as const;
  readonly reviewSteps = ['scope', 'dossier', 'result', 'summary'] as const;
  readonly statuses = {
    balanced: { icon: 'check', tone: 'success' },
    action_required: { icon: 'bellActive', tone: 'warning' },
    waiting: { icon: 'clock', tone: 'neutral' },
    blocked: { icon: 'warning', tone: 'danger' },
    unknown: { icon: 'search', tone: 'warning' }
  } satisfies Record<
    AdminAutomaticRunEntry['balanceStatus'],
    { icon: AdminIconName; tone: AdminBadgeTone }
  >;
  readonly phaseIcon = computed<AdminIconName>(() => {
    switch (this.portfolio.snapshot().phase) {
      case 'loading':
        return 'refresh';
      case 'explaining':
      case 'advancing':
        return 'search';
      case 'awaiting_approval':
        return 'bellActive';
      case 'paused':
        return 'clock';
      case 'completed':
        return 'check';
      case 'uncertain':
      case 'error':
        return 'warning';
      default:
        return 'publications';
    }
  });
  readonly phaseTone = computed<AdminBadgeTone>(() => {
    const phase = this.portfolio.snapshot().phase;
    if (phase === 'error' || phase === 'uncertain') return 'danger';
    if (phase === 'awaiting_approval') return 'warning';
    return 'neutral';
  });
  private readonly reconciliation =
    viewChild<ElementRef<HTMLDialogElement>>('reconciliation');
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readingFocusPending = false;
  private readonly reading = computed(() => {
    const state = this.portfolio.snapshot();
    return state.phase === 'awaiting_approval' ? state.review : null;
  });

  constructor() {
    effect(() => {
      if (this.view() === 'batch') this.processingExpanded.set(true);
    });
    afterNextRender(() => {
      void this.portfolio.load();
    });
    afterRenderEffect((onCleanup) => {
      if (this.view() !== 'batch' || !this.processingExpanded()) {
        this.readingFocusPending = false;
        return;
      }
      const review = this.reading();
      if (!review) {
        if (this.readingFocusPending) {
          const pause =
            this.element.nativeElement.querySelector<HTMLButtonElement>(
              '[data-og7="automatic-portfolio-pause"]'
            );
          if (
            pause &&
            !pause.disabled &&
            pause.getClientRects().length &&
            !pause.ownerDocument.querySelector('dialog[open]')
          ) {
            this.readingFocusPending = false;
            pause.focus({ preventScroll: true });
            pause.scrollIntoView({ block: 'nearest', behavior: 'instant' });
          }
        }
        return;
      }
      this.readingFocusPending = false;
      const hook = review.step === 'result' ? 'latest' : review.step;
      const region = this.element.nativeElement.querySelector<HTMLElement>(
        `[data-og7="automatic-portfolio-${hook}"]`
      );
      const view = region?.ownerDocument.defaultView;
      if (!region || !view || !region.getClientRects().length) return;
      const release = highlightGuidanceRegions([region], view, {
        persistent: true
      });
      onCleanup(() => {
        release();
        const focused = region.ownerDocument.activeElement;
        this.readingFocusPending =
          focused === region.ownerDocument.body ||
          (!!focused && region.parentElement?.contains(focused) === true);
      });
      region.focus({ preventScroll: true });
      region.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'instant'
      });
      revealGuidanceRegion(region, region, undefined, view);
    });
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.automatic.portfolio.' + key, params);
  }

  toggleProcessing(event: Event): void {
    event.preventDefault();
    this.processingExpanded.update((expanded) => !expanded);
  }

  focus(): void {
    const focusVisibleBatch = (): boolean => {
      if (this.view() !== 'batch') return false;
      const region = this.element.nativeElement.querySelector<HTMLElement>(
        '[data-og7="automatic-portfolio-processing"]'
      );
      if (!region?.getClientRects().length) return false;
      region.focus({ preventScroll: true });
      return true;
    };
    if (!focusVisibleBatch())
      afterNextRender(() => focusVisibleBatch(), { injector: this.injector });
  }

  reason(code: string): string {
    for (const key of [
      'admin.automatic.portfolio.reasons.' + code,
      'admin.guidance.paymentJourney.reasons.' + code,
      'admin.dossier.reasons.' + code
    ]) {
      const text = this.i18n.t(key);
      if (text !== key) return text;
    }
    return this.t('reasonUnknown', { code });
  }

  requiredElements(benefit: SponsorshipOfferedBenefit): string {
    return benefit.requiredElements
      .map((element) => this.t('elements.' + element))
      .join(', ');
  }

  amount(amountMinor: number, currency: string): string {
    const formatter = new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency,
      currencyDisplay: 'code'
    });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / 10 ** digits);
  }

  date(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  destination(entry: AdminAutomaticRunEntry): string | null {
    return entry.balance.next
      ? automaticAdminUrl(entry.balance.next.adminUrl)
      : null;
  }

  externalUrl(value: string | null): string | null {
    if (!value) return null;
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  open(entry: AdminAutomaticRunEntry): void {
    this.portfolio.pause();
    this.prepare.emit(entry);
  }

  confirmReconciliation(): void {
    this.reconciliation()?.nativeElement.showModal();
  }

  closeReconciliation(): void {
    this.reconciliation()?.nativeElement.close();
  }

  reconcile(): void {
    this.closeReconciliation();
    void this.portfolio.reconcile();
  }
}
