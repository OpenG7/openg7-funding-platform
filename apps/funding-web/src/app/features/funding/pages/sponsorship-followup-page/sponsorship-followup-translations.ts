import { effect, inject, untracked } from '@angular/core';

import en from '../../../../../assets/i18n/funding-followup-journey.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/funding-followup-journey.fr-CA.json' with { type: 'json' };
import { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Follow-up-only copy stays with the lazily loaded private page. */
export function registerSponsorshipFollowupJourneyTranslations(): void {
  const i18n = inject(FundingI18nService);
  effect(() => {
    const language = i18n.currentLanguage();
    untracked(() =>
      i18n.mergeTranslations(language, {
        funding: { followup: { journey: language === 'en' ? en : fr } }
      })
    );
  });
}
