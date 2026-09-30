import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { CockpitSystem } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import {
  AdminIconComponent,
  type AdminIconName
} from '../admin-ui/admin-icon.component.js';

import { systemExpired, systemState } from './system-state.js';

/** Admin presentation molecule: observed systems in cards; the page owns loading and navigation. */
@Component({
  selector: 'openg7-admin-system-cards',
  standalone: true,
  imports: [TranslatePipe, AdminIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cards">
      @for (system of systems(); track system.id) {
        <button
          type="button"
          [attr.data-state]="state(system)"
          data-og7="setup-system"
          [attr.data-og7-id]="system.id"
          (click)="inspect.emit(system.id)"
        >
          <span class="heading"
            ><openg7-admin-icon [name]="icons[system.id]" />
            <span
              ><strong>{{
                'admin.cockpit.system.' + system.id | translate
              }}</strong>
              <small>{{ system.provider }}</small></span
            >
            <openg7-admin-icon class="arrow" name="arrow" />
          </span>
          <span class="status"
            ><span class="dot" aria-hidden="true"></span
            >{{ 'admin.cockpit.health.' + state(system) | translate }}</span
          >
          <span class="evidence">{{
            'admin.cockpit.evidence.' +
              (expired(system) ? 'expired' : system.evidence) | translate
          }}</span>
          <span class="date"
            >{{ 'admin.cockpit.checked' | translate }}
            <time [attr.datetime]="system.checkedAt">{{
              date(system.checkedAt)
            }}</time></span
          >
        </button>
      }
    </div>
  `,
  styleUrl: './admin-system-cards.component.css'
})
export class AdminSystemCardsComponent {
  readonly systems = input.required<readonly CockpitSystem[]>();
  readonly now = input.required<number>();
  readonly failed = input(false);
  readonly inspect = output<CockpitSystem['id']>();
  private readonly i18n = inject(FundingI18nService);
  readonly icons: Record<CockpitSystem['id'], AdminIconName> = {
    stripe: 'contributions',
    email: 'email',
    storage: 'cloud',
    database: 'database'
  };
  state(system: CockpitSystem) {
    return systemState(system, this.now(), this.failed());
  }
  expired(system: CockpitSystem) {
    return systemExpired(system, this.now(), this.failed());
  }
  date(value: string) {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      timeZone: 'America/Toronto',
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  }
}
