import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  untracked
} from '@angular/core';

import en from '../../../../../assets/i18n/app-update.en.json' with { type: 'json' };
import fr from '../../../../../assets/i18n/app-update.fr-CA.json' with { type: 'json' };
import { AppUpdateService } from '../../services/app-update.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Global Funding notice; the visitor decides when to leave the current page. */
@Component({
  selector: 'openg7-app-update',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="update-status"
      aria-live="polite"
      aria-atomic="true"
      data-og7="app-update-announcement"
    >
      {{ updates.available() ? t('title') : '' }}
    </span>
    @if (updates.available()) {
      <aside
        class="update-notice"
        aria-labelledby="app-update-title"
        data-og7="app-update-notice"
        (focusin)="rememberFocus($event)"
      >
        <div>
          <strong id="app-update-title">{{ t('title') }}</strong>
          <p>{{ t('description') }}</p>
        </div>
        <div class="update-actions">
          <button
            type="button"
            class="refresh"
            data-og7="app-update-refresh"
            (click)="updates.refresh()"
          >
            {{ t('refresh') }}
          </button>
          <button type="button" data-og7="app-update-later" (click)="dismiss()">
            {{ t('later') }}
          </button>
        </div>
      </aside>
    }
  `,
  styleUrl: './app-update.component.css'
})
export class AppUpdateComponent {
  readonly updates = inject(AppUpdateService);
  private readonly i18n = inject(FundingI18nService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private returnFocus: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() =>
        this.i18n.mergeTranslations(language, {
          appUpdate: language === 'en' ? en : fr
        })
      );
    });
  }

  t(key: string): string {
    return this.i18n.t(`appUpdate.${key}`);
  }

  rememberFocus(event: FocusEvent): void {
    const previous = event.relatedTarget;
    if (
      previous instanceof HTMLElement &&
      !this.host.nativeElement.contains(previous)
    )
      this.returnFocus = previous;
  }

  dismiss(): void {
    this.updates.dismiss();
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
  }
}
