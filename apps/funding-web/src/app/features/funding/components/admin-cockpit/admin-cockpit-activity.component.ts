import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { AdminCockpitStatusComponent } from './admin-cockpit-status.component.js';
import { createCockpitBlock } from './cockpit-block.js';

@Component({
  selector: 'openg7-admin-cockpit-activity',
  standalone: true,
  imports: [TranslatePipe, RouterLink, AdminCockpitStatusComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./admin-cockpit.css'],
  template: `
    <section
      class="panel"
      data-og7="cockpit-activity"
      aria-labelledby="cockpit-activity-title"
    >
      <header class="heading">
        <h2 id="cockpit-activity-title">
          {{ 'admin.cockpit.activity' | translate }}
        </h2>
        <openg7-admin-cockpit-status
          [state]="block.state()"
          [stale]="block.stale()"
          (refresh)="block.load()"
        />
      </header>
      @if (block.data(); as data) {
        <p class="meta">
          {{ 'admin.cockpit.today' | translate }} · {{ data.today }} ·
          America/Toronto
        </p>
        <dl class="today">
          @for (kind of kinds; track kind) {
            <div>
              <dt>{{ 'admin.cockpit.todayKind.' + kind | translate }}</dt>
              <dd>{{ data.todayCounts[kind] ?? '—' }}</dd>
            </div>
          }
        </dl>
        @if (data.missingSources.length) {
          <p class="notice" role="status">
            {{ 'admin.cockpit.partialActivity' | translate }}
          </p>
        }
        <ul>
          @for (item of data.items; track item.id) {
            <li>
              <a [routerLink]="router.parseUrl(item.adminUrl)"
                ><span
                  ><strong>{{
                    'admin.cockpit.kind.' + item.kind | translate
                  }}</strong
                  ><small>{{ item.reference }}</small></span
                >
                <small
                  ><time [attr.datetime]="item.occurredAt">{{
                    date(item.occurredAt)
                  }}</time></small
                ></a
              >
            </li>
          }
        </ul>
        @if (!data.items.length) {
          <p class="notice">{{ 'admin.cockpit.noActivity' | translate }}</p>
        }
        <p class="meta">
          {{ 'admin.cockpit.asOf' | translate }}
          <time [attr.datetime]="data.generatedAt">{{
            date(data.generatedAt)
          }}</time>
        </p>
      }
    </section>
  `
})
export class AdminCockpitActivityComponent {
  readonly refreshKey = input(0);
  readonly block = createCockpitBlock('activity', this.refreshKey);
  readonly router = inject(Router);
  readonly i18n = inject(FundingI18nService);
  readonly kinds = [
    'payment',
    'invoice',
    'publication',
    'review',
    'information',
    'refund'
  ] as const;
  date(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      timeZone: 'America/Toronto',
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  }
}
