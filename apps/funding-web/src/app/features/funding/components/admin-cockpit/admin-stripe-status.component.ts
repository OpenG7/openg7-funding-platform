import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { CockpitSystem, CockpitSystemCheck } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

import { systemExpired, systemState } from './system-state.js';

/** Admin presentation molecule shared by setup and cockpit; no data loading. */
@Component({
  selector: 'openg7-admin-stripe-status',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './admin-stripe-status.component.css',
  template: `
    @if (!system().connection) {
      <span class="check">
        <strong>{{ 'admin.cockpit.stripe.connection' | translate }}</strong>
        <span class="status">{{
          'admin.cockpit.health.unknown' | translate
        }}</span>
        <span>{{ 'admin.cockpit.stripe.notChecked' | translate }}</span>
      </span>
    }
    @for (item of checks(); track item.kind) {
      <span
        class="check"
        data-og7="stripe-check"
        [attr.data-og7-id]="item.kind"
        [attr.data-state]="state(item.check)"
      >
        <span class="heading">
          <strong>{{ 'admin.cockpit.stripe.' + item.kind | translate }}</strong>
          <span class="status">{{
            statusKey(item.check, item.kind) | translate
          }}</span>
        </span>
        <span>{{
          'admin.cockpit.evidence.' +
            (expired(item.check) ? 'expired' : item.check.evidence) | translate
        }}</span>
        @if (item.kind === 'webhooks') {
          <span class="date">
            {{ 'admin.cockpit.stripe.lastWebhook' | translate }}
            @if (item.check.observedAt; as observedAt) {
              <time [attr.datetime]="observedAt">{{ date(observedAt) }}</time>
            } @else {
              {{ 'admin.cockpit.stripe.noWebhookDate' | translate }}
            }
          </span>
        }
        <span class="date">
          {{ 'admin.cockpit.checked' | translate }}
          <time [attr.datetime]="item.check.checkedAt">{{
            date(item.check.checkedAt)
          }}</time>
        </span>
      </span>
    }
  `
})
export class AdminStripeStatusComponent {
  readonly system = input.required<CockpitSystem>();
  readonly now = input.required<number>();
  readonly failed = input(false);
  private readonly i18n = inject(FundingI18nService);
  readonly checks = computed(() => {
    const system = this.system();
    return [
      ...(system.connection
        ? [{ kind: 'connection', check: system.connection }]
        : []),
      { kind: 'webhooks', check: system }
    ];
  });
  state(check: CockpitSystemCheck) {
    return systemState(check, this.now(), this.failed());
  }
  expired(check: CockpitSystemCheck) {
    return systemExpired(check, this.now(), this.failed());
  }
  statusKey(check: CockpitSystemCheck, kind: string): string {
    if (kind === 'webhooks' && !this.expired(check)) {
      if (check.evidence === 'no_recent_observation')
        return 'admin.cockpit.stripe.inactive';
      if (check.state === 'operational') return 'admin.cockpit.stripe.recent';
    }
    return 'admin.cockpit.health.' + this.state(check);
  }
  date(value: string): string {
    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      timeZone: 'America/Toronto',
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  }
}
