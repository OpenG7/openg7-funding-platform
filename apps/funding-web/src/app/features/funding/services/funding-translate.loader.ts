import { Injectable } from '@angular/core';
import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';

import enTranslations from '../../../../assets/i18n/en.json' with { type: 'json' };
import frCaTranslations from '../../../../assets/i18n/fr-CA.json' with { type: 'json' };

const translations: Record<string, TranslationObject> = {
  en: enTranslations,
  'fr-CA': frCaTranslations
};

@Injectable()
export class FundingTranslateLoader implements TranslateLoader {
  getTranslation(language: string): Observable<TranslationObject> {
    return of(translations[language] ?? translations['fr-CA']);
  }
}
