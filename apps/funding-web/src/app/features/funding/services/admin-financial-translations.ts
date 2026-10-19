import { effect, inject, untracked } from '@angular/core';

import en from '../../../../assets/i18n/admin-financial-safety.en.json' with { type: 'json' };
import fr from '../../../../assets/i18n/admin-financial-safety.fr-CA.json' with { type: 'json' };

import { FundingI18nService } from './funding-i18n.service.js';

/** The admin shell is lazy: financial safety labels stay out of public bundles. */
export function registerAdminFinancialTranslations(): void {
  const i18n = inject(FundingI18nService);
  effect(() => {
    const language = i18n.currentLanguage();
    untracked(() =>
      i18n.mergeTranslations(language, {
        admin: { financialSafety: language === 'en' ? en : fr }
      })
    );
  });
}
