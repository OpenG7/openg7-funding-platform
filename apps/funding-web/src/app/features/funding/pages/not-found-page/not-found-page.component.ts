import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Public page: explain a missing destination and offer localized recovery links. */
@Component({
  selector: 'openg7-not-found-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, FundingHeaderComponent],
  template: `
    <openg7-funding-header />
    <main aria-labelledby="not-found-title" data-og7="not-found">
      <p class="code" aria-hidden="true">404</p>
      <h1 id="not-found-title">{{ 'funding.notFound.title' | translate }}</h1>
      <p>{{ 'funding.notFound.copy' | translate }}</p>
      <nav [attr.aria-label]="'funding.notFound.navigation' | translate">
        <a [routerLink]="i18n.localizedPath('/fonds-des-batisseurs')">{{
          'funding.notFound.home' | translate
        }}</a>
        <a [routerLink]="i18n.localizedPath('/support')">{{
          'funding.notFound.help' | translate
        }}</a>
      </nav>
    </main>
  `,
  styleUrl: './not-found-page.component.css'
})
export class NotFoundPageComponent {
  readonly i18n = inject(FundingI18nService);
  constructor() {
    const meta = inject(Meta);
    const title = inject(Title);
    effect(() =>
      title.setTitle(this.i18n.t('funding.notFound.title') + ' | OpenG7')
    );
    meta.updateTag({ name: 'robots', content: 'noindex, follow' });
    inject(DestroyRef).onDestroy(() => meta.removeTag('name="robots"'));
  }
}
