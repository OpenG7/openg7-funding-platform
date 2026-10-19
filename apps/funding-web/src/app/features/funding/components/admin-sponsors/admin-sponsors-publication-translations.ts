import { effect, inject, untracked } from '@angular/core';

import en from '../../../../../assets/i18n/admin-sponsors-publication-cleanup.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/admin-sponsors-publication-cleanup.fr-CA.json' with { type: 'json' };
import { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Register the shared labels for the dossier's publication surfaces. */
export function registerSponsorPublicationTranslations(): void {
  const i18n = inject(FundingI18nService);
  effect(() => {
    const language = i18n.currentLanguage();
    untracked(() =>
      i18n.mergeTranslations(language, {
        admin: {
          dossier: { publicationCleanup: language === 'en' ? en : fr }
        }
      })
    );
  });
}
