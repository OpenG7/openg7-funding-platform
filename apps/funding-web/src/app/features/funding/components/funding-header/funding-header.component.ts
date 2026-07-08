import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { LanguageToggleComponent } from '../language-toggle/language-toggle.component.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

@Component({
  selector: 'openg7-funding-header',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    TranslatePipe,
    LanguageToggleComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="builders-nav">
      <a
        class="builders-brand"
        [routerLink]="homePath()"
        [attr.aria-label]="'funding.aria.brandHome' | translate"
      >
        <span class="brand-leaf" aria-hidden="true">◆</span>
        <span>
          <strong>{{ 'funding.brand.title' | translate }}</strong>
          <em>{{ 'funding.brand.organization' | translate }}</em>
        </span>
      </a>

      <nav [attr.aria-label]="'funding.aria.primaryNavigation' | translate">
        <a
          [routerLink]="homePath()"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
          >{{ 'funding.nav.home' | translate }}</a
        >
        <a
          [routerLink]="aboutPath()"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
        >
          {{ 'funding.nav.about' | translate }}
        </a>
        <a
          [routerLink]="ecosystemPath()"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
        >
          {{ 'funding.nav.ecosystem' | translate }}
        </a>
        <a
          [routerLink]="musicPath()"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
          >{{ 'funding.nav.music' | translate }}</a
        >
        <a
          [routerLink]="shopPath()"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
          >{{ 'funding.nav.shop' | translate }}</a
        >
        <a
          [routerLink]="buildersPath()"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
          >{{ 'funding.nav.builders' | translate }}</a
        >
        <a
          [routerLink]="transparencyPath()"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
        >
          {{ 'funding.nav.transparency' | translate }}
        </a>
        <a
          [routerLink]="supportPath()"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: true }"
          >{{ 'funding.nav.support' | translate }}</a
        >
      </nav>

      <div class="nav-actions">
        <openg7-language-toggle></openg7-language-toggle>
        <a
          class="nav-contribute"
          [routerLink]="homePath()"
          fragment="support"
          >{{ 'funding.nav.supportCta' | translate }}</a
        >
      </div>
    </header>
  `
})
export class FundingHeaderComponent {
  private readonly i18n = inject(FundingI18nService);

  readonly homePath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs')
  );
  readonly aboutPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/a-propos')
  );
  readonly ecosystemPath = computed(() =>
    this.i18n.localizedPath('/ecosystem')
  );
  readonly musicPath = computed(() => this.i18n.localizedPath('/music'));
  readonly shopPath = computed(() => this.i18n.localizedPath('/boutique'));
  readonly buildersPath = computed(() => this.i18n.localizedPath('/batisseurs'));
  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );
  readonly supportPath = computed(() => this.i18n.localizedPath('/support'));
}
