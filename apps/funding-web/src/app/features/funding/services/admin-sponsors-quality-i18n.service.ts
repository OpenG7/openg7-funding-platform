import { Injectable, effect, inject, untracked } from '@angular/core';

import en from '../../../../assets/i18n/admin-sponsors-quality.en.json' with { type: 'json' };
import fr from '../../../../assets/i18n/admin-sponsors-quality.fr-CA.json' with { type: 'json' };

import { FundingI18nService } from './funding-i18n.service.js';

/** Admin-only labels shared by the quality page and its contextual entry points. */
@Injectable({ providedIn: 'root' })
export class AdminSponsorsQualityI18nService {
  private readonly i18n = inject(FundingI18nService);

  constructor() {
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() =>
        this.i18n.mergeTranslations(language, {
          admin: { sponsorsQuality: language === 'en' ? en : fr }
        })
      );
    });
  }

  t(key: string, params?: Record<string, unknown>): string {
    return this.i18n.t('admin.sponsorsQuality.' + key, params);
  }
}
