import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked
} from '@angular/core';

import { FundingAdminService } from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { AdminPreflightPreparationsController } from './admin-preflight-preparations.controller.js';

/** Read-only Funding admin organism: proposed Preflight work never grants business approval. */
@Component({
  selector: 'openg7-admin-preflight-preparations',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './admin-preflight-preparations.component.html',
  styleUrls: [
    '../admin-ui/admin-controls.css',
    './admin-preflight-preparations.component.css'
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdminPreflightPreparationsComponent {
  readonly contributionId = input.required<string>();
  readonly refreshKey = input.required<string>();
  readonly admin = inject(FundingAdminService);
  readonly i18n = inject(FundingI18nService);
  readonly languageReady = signal(false);
  readonly languageError = signal(false);
  readonly controller = new AdminPreflightPreparationsController({
    read: (id) => this.admin.getPreflightPreparations(id),
    permitted: () => this.admin.hasValidAdminSession(),
    identity: () => this.identityKey()
  });
  constructor() {
    inject(DestroyRef).onDestroy(() => this.controller.dispose());
    effect((onCleanup) => {
      const language = this.i18n.currentLanguage();
      let current = true;
      onCleanup(() => {
        current = false;
      });
      this.languageReady.set(false);
      this.languageError.set(false);
      const translations =
        language === 'en'
          ? import('../../../../../assets/i18n/admin-preflight.en.json')
          : import('../../../../../assets/i18n/admin-preflight.fr-CA.json');
      void translations
        .then(({ default: value }) => {
          if (!current) return;
          this.i18n.mergeTranslations(language, {
            admin: { preflight: value }
          });
          this.languageReady.set(true);
        })
        .catch(() => {
          if (current) this.languageError.set(true);
        });
    });
    effect(() => {
      const id = this.contributionId();
      this.refreshKey();
      this.admin.dataRevision();
      const identity = this.identityKey(),
        ready = this.languageReady();
      untracked(() => {
        if (ready) this.controller.select(id, identity);
      });
    });
  }
  private identityKey(): string {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}:${identity?.role ?? 'token'}`;
  }
  t(key: string): string {
    return this.i18n.t('admin.preflight.' + key);
  }
}
