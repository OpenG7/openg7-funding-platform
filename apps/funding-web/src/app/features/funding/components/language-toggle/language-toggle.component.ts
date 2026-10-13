import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { Router } from '@angular/router';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

@Component({
  selector: 'openg7-language-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="language-toggle"
      [attr.aria-label]="ariaLabel()"
      (click)="toggleLanguage()"
    >
      {{ label() }}
    </button>
  `,
  styles: [
    `
      .language-toggle {
        background: rgb(5 18 35 / 72%);
        border: 1px solid rgb(244 201 87 / 46%);
        border-radius: 999px;
        color: #fff2d6;
        cursor: pointer;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 0.78rem;
        font-weight: 900;
        min-height: 2.2rem;
        padding: 0 0.75rem;
        text-transform: uppercase;
      }

      .language-toggle:hover {
        background: rgb(244 201 87 / 16%);
      }
    `
  ]
})
export class LanguageToggleComponent {
  private readonly i18n = inject(FundingI18nService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  readonly label = computed(() =>
    this.i18n.currentLanguage() === 'fr-CA' ? 'EN' : 'FR'
  );
  readonly ariaLabel = computed(() =>
    this.i18n.currentLanguage() === 'fr-CA'
      ? 'Switch site language to English'
      : 'Changer la langue du site vers le français'
  );

  toggleLanguage(): void {
    const targetLanguage =
      this.i18n.currentLanguage() === 'fr-CA' ? 'en' : 'fr-CA';
    // The checkout notice removes its return parameters through replaceState.
    // Read the current location so a language change cannot restore them.
    const currentUrl = this.router.parseUrl(this.location.path(true));
    const destination = this.router.parseUrl(
      this.i18n.alternateLanguagePath(targetLanguage)
    );
    destination.fragment = currentUrl.fragment;
    // Checkout context belongs only to the equivalent funding entry. In
    // particular, never copy a private follow-up token into another page.
    if (
      ['/', '/fonds-des-batisseurs'].includes(this.i18n.currentCanonicalPath())
    ) {
      for (const key of [
        'checkout',
        'intent',
        'contributionType',
        'reference',
        'session_id',
        'followup_token'
      ]) {
        const values = currentUrl.queryParamMap.getAll(key);
        if (values.length) destination.queryParams[key] = values;
      }
    }
    void this.router.navigateByUrl(destination);
  }
}
