import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterRenderEffect,
  effect,
  inject,
  output,
  signal,
  viewChild
} from '@angular/core';
import type { AdminAutomaticRunEntry } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { ADMIN_GUIDANCE_PAGES } from '../admin-guidance/admin-guidance-pages.js';

import { AdminAutomaticService } from './admin-automatic.service.js';
import { AdminAutomaticPortfolioComponent } from './admin-automatic-portfolio.component.js';
import { AdminAutomaticPortfolioService } from './admin-automatic-portfolio.service.js';

/** Optional, visible preparation organism; final decisions belong to the existing screens. */
@Component({
  selector: 'openg7-admin-automatic',
  standalone: true,
  imports: [AdminAutomaticPortfolioComponent],
  templateUrl: './admin-automatic.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-automatic.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminAutomaticComponent {
  readonly automatic = inject(AdminAutomaticService);
  readonly portfolio = inject(AdminAutomaticPortfolioService);
  readonly i18n = inject(FundingI18nService);
  readonly pages = ADMIN_GUIDANCE_PAGES;
  readonly languageReady = signal(false);
  readonly languageError = signal(false);
  readonly portfolioStarting = signal(false);
  readonly show = output<string>();
  private readonly portfolioView = viewChild(AdminAutomaticPortfolioComponent);
  private disposed = false;
  private shown = 0;

  constructor() {
    if (!this.automatic.selection())
      this.automatic.selection.set(
        this.automatic.guidance.snapshot().payment
          ? 'payment'
          : (this.automatic.guidance.page()?.id ?? 'dashboard')
      );
    inject(DestroyRef).onDestroy(() => (this.disposed = true));
    effect((onCleanup) => {
      const language = this.i18n.currentLanguage();
      let current = true;
      onCleanup(() => (current = false));
      this.languageReady.set(false);
      this.languageError.set(false);
      const locale =
        language === 'en'
          ? import('../../../../../assets/i18n/admin-automatic.en.json')
          : import('../../../../../assets/i18n/admin-automatic.fr-CA.json');
      void locale
        .then(({ default: translations }) => {
          if (!current || this.disposed) return;
          this.i18n.mergeTranslations(language, {
            admin: { automatic: translations }
          });
          this.languageReady.set(true);
        })
        .catch(() => {
          if (!current || this.disposed) return;
          this.automatic.pause();
          this.portfolio.pause();
          this.languageError.set(true);
        });
    });
    afterRenderEffect(() => {
      const request = this.automatic.reveal();
      if (request && request.sequence !== this.shown) {
        this.shown = request.sequence;
        this.show.emit(request.target);
      }
    });
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.automatic.' + key, params);
  }

  pageTitle(pageId?: string): string {
    const page = this.pages.find((entry) => entry.id === pageId);
    return page ? this.i18n.t(page.titleKey) : '';
  }

  reason(reason?: string): string {
    if (!reason) return this.t('startHelp');
    if (reason.startsWith('page:')) {
      const page = this.pages.find((entry) => entry.id === reason.slice(5));
      return page
        ? this.i18n.t(page.steps[0].bodyKey)
        : this.t('reasonUnavailable');
    }
    for (const key of [
      'admin.guidance.paymentJourney.reasons.' + reason,
      'admin.dossier.reasons.' + reason
    ]) {
      const value = this.i18n.t(key);
      if (value !== key) return value;
    }
    return this.t('reasonUnavailable');
  }

  select(event: Event): void {
    this.portfolio.pause();
    this.automatic.pause();
    this.automatic.selection.set((event.target as HTMLSelectElement).value);
  }

  async startPortfolio(): Promise<void> {
    if (this.portfolioStarting()) return;
    this.portfolioStarting.set(true);
    try {
      await this.portfolio.load();
      const view = this.portfolioView();
      if (
        this.disposed ||
        !this.languageReady() ||
        this.languageError() ||
        !view
      )
        return;
      view.focus();
      const { state, error } = this.portfolio.snapshot();
      if (!state || error || (state.run && state.run.status !== 'completed'))
        return;
      await this.portfolio.start();
    } finally {
      this.portfolioStarting.set(false);
    }
  }

  startPreparation(): void {
    this.portfolio.pause();
    void this.automatic.start(this.automatic.selection());
  }

  preparePayment(entry: AdminAutomaticRunEntry): void {
    this.portfolio.pause();
    this.automatic.guidance.followPayment(entry.contributionId);
    this.automatic.guidance.setMode('automatic');
    this.automatic.selection.set('payment');
    void this.automatic.start('payment');
  }
}
