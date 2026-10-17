import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  output,
  viewChild
} from '@angular/core';
import type {
  AdminAutomaticRunEntry,
  SponsorshipOfferedBenefit
} from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { highlightGuidanceRegions } from '../admin-guidance/admin-guidance-highlight.js';
import { revealGuidanceRegion } from '../admin-guidance/admin-guidance-scroll.js';

import { automaticAdminUrl } from './admin-automatic-run.js';
import { AdminAutomaticPortfolioService } from './admin-automatic-portfolio.service.js';

@Component({
  selector: 'openg7-admin-automatic-portfolio',
  standalone: true,
  imports: [NgTemplateOutlet],
  templateUrl: './admin-automatic-portfolio.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-automatic.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminAutomaticPortfolioComponent {
  readonly portfolio = inject(AdminAutomaticPortfolioService);
  readonly i18n = inject(FundingI18nService);
  readonly prepare = output<AdminAutomaticRunEntry>();
  private readonly reconciliation =
    viewChild<ElementRef<HTMLDialogElement>>('reconciliation');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly reading = computed(() => {
    const state = this.portfolio.snapshot();
    return state.phase === 'awaiting_approval' ? state.review : null;
  });

  constructor() {
    afterNextRender(() => {
      void this.portfolio.load();
    });
    afterRenderEffect((onCleanup) => {
      const review = this.reading();
      if (!review) return;
      const hook = review.step === 'result' ? 'latest' : review.step;
      const region = this.element.nativeElement.querySelector<HTMLElement>(
        `[data-og7="automatic-portfolio-${hook}"]`
      );
      const view = region?.ownerDocument.defaultView;
      if (!region || !view || !region.getClientRects().length) return;
      const release = highlightGuidanceRegions([region], view, {
        persistent: true
      });
      onCleanup(release);
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

  focus(): void {
    this.heading()?.nativeElement.focus();
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
