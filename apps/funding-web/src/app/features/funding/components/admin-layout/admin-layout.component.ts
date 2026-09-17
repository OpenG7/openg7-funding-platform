import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminNavComponent } from '../admin-nav/admin-nav.component.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

/** Admin page template: placement and navigation, no business data loading. */
@Component({
  selector: 'openg7-admin-layout',
  standalone: true,
  imports: [RouterLink, TranslatePipe, AdminNavComponent, AdminIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      class="skip-link"
      href="#admin-main"
      (click)="$event.preventDefault(); main.focus()"
    >
      {{ 'admin.shell.skip' | translate }}
    </a>
    <div class="layout" data-og7="admin-layout">
      <openg7-admin-nav [collapsible]="true" />
      <div class="workspace">
        <header class="topbar">
          <span class="workspace-label">{{
            'admin.shell.workspace' | translate
          }}</span>
          <div class="tools">
            <a
              class="admin-button admin-button--primary"
              routerLink="/admin/fundraiser/assistant"
              [queryParams]="
                sponsorshipId() ? { sponsorshipId: sponsorshipId() } : {}
              "
            >
              <openg7-admin-icon name="assistant" />{{
                'admin.nav.assistant' | translate
              }}
            </a>
            <button
              class="admin-button"
              type="button"
              (click)="i18n.toggleLanguage()"
              [attr.aria-label]="
                (i18n.currentLanguage() === 'fr-CA'
                  ? 'admin.shell.toEnglish'
                  : 'admin.shell.toFrench'
                ) | translate
              "
            >
              {{ i18n.currentLanguage() === 'fr-CA' ? 'EN' : 'FR' }}
            </button>
            <span class="identity"
              ><openg7-admin-icon name="audit" /><span>{{
                'admin.shell.identity' | translate
              }}</span></span
            >
          </div>
        </header>
        <main id="admin-main" #main tabindex="-1"><ng-content /></main>
      </div>
    </div>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-layout.component.css'
  ]
})
export class AdminLayoutComponent {
  readonly sponsorshipId = input<string>();
  readonly i18n = inject(FundingI18nService);
}
