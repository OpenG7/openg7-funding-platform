import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { CockpitSystem, CockpitSystemState } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { AdminCockpitStatusComponent } from './admin-cockpit-status.component.js';
import { createCockpitBlock } from './cockpit-block.js';

@Component({
  selector: 'openg7-admin-cockpit-systems',
  standalone: true,
  imports: [TranslatePipe, RouterLink, AdminCockpitStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./admin-cockpit.css'],
  template: `
    <section
      class="panel"
      data-og7="cockpit-systems"
      aria-labelledby="cockpit-systems-title"
    >
      <header class="heading">
        <h2 id="cockpit-systems-title">
          {{ 'admin.cockpit.systems' | translate }}
        </h2>
        <openg7-admin-cockpit-status
          [state]="block.state()"
          [stale]="block.stale()"
          (refresh)="block.load()"
        />
      </header>
      @if (block.data(); as data) {
        <ul>
          @for (system of data.systems; track system.id) {
            <li [attr.data-og7-id]="system.id">
              <a [routerLink]="router.parseUrl(system.adminUrl)">
                <span
                  ><strong
                    >{{ 'admin.cockpit.system.' + system.id | translate }} ·
                    {{ system.provider }}</strong
                  >
                  <small>{{
                    'admin.cockpit.evidence.' +
                      (expired(system) ? 'expired' : system.evidence)
                      | translate
                  }}</small>
                  @if (system.observedAt) {
                    <small
                      >{{ 'admin.cockpit.observed' | translate }}
                      <time [attr.datetime]="system.observedAt">{{
                        date(system.observedAt)
                      }}</time></small
                    >
                  }
                  <small
                    >{{ 'admin.cockpit.checked' | translate }}
                    {{ date(system.checkedAt) }}</small
                  >
                </span>
                <span
                  ><span class="status" [attr.data-state]="state(system)">{{
                    'admin.cockpit.health.' + state(system) | translate
                  }}</span></span
                >
              </a>
            </li>
          }
        </ul>
        <p class="notice">{{ 'admin.cockpit.healthScope' | translate }}</p>
      }
    </section>
  `
})
export class AdminCockpitSystemsComponent {
  readonly refreshKey = input(0);
  readonly block = createCockpitBlock('systems', this.refreshKey);
  readonly router = inject(Router);
  readonly i18n = inject(FundingI18nService);
  expired(system: CockpitSystem): boolean {
    return (
      this.block.state() === 'error' ||
      this.block.clock() >= Date.parse(system.validUntil)
    );
  }
  state(system: CockpitSystem): CockpitSystemState {
    return this.expired(system) ? 'unknown' : system.state;
  }
  date(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      timeZone: 'America/Toronto',
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  }
}
