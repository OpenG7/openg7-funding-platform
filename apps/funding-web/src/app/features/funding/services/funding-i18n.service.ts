import { Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { FUNDING_DEFAULT_LANGUAGE } from '@openg7/funding-i18n';

@Injectable({ providedIn: 'root' })
export class FundingI18nService {
  private readonly translationVersion = signal(0);

  constructor(private readonly translate: TranslateService) {
    this.translate.setDefaultLang(FUNDING_DEFAULT_LANGUAGE);
    this.translate.use(FUNDING_DEFAULT_LANGUAGE).subscribe(() => {
      this.translationVersion.update((value) => value + 1);
    });
  }

  trackTranslationState(): void {
    this.translationVersion();
  }

  t(key: string): string {
    return this.translate.instant(key);
  }
}
