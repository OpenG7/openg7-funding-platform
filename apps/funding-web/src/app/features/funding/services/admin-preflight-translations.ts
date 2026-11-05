import { effect, inject, untracked } from '@angular/core';

import en from '../../../../assets/i18n/admin-preflight.en.json' with { type: 'json' };
import fr from '../../../../assets/i18n/admin-preflight.fr-CA.json' with { type: 'json' };

import { FundingI18nService } from './funding-i18n.service.js';

export function registerAdminPreflightTranslations(): void {
  const i18n = inject(FundingI18nService);
  effect(() => {
    const language = i18n.currentLanguage();
    untracked(() =>
      i18n.mergeTranslations(language, {
        admin: { preflight: language === 'en' ? en : fr }
      })
    );
  });
}
