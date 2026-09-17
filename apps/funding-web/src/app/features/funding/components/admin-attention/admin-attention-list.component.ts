import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input
} from '@angular/core';
import { Router, RouterLink, type UrlTree } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminAttentionItem } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import {
  AdminBadgeComponent,
  type AdminBadgeTone
} from '../admin-ui/admin-badge.component.js';
import { AdminIconComponent } from '../admin-ui/admin-icon.component.js';

/** Funding organism: presents deterministic tasks and links, without mutations. */
@Component({
  selector: 'openg7-admin-attention-list',
  standalone: true,
  imports: [RouterLink, TranslatePipe, AdminBadgeComponent, AdminIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="tasks" data-og7="attention-items">
      @for (item of items(); track item.id) {
        <li [attr.data-og7-id]="item.id">
          <div class="task-main">
            <div class="task-title">
              <openg7-admin-badge [tone]="tone(item)">{{
                'admin.attention.priority.' + item.severity | translate
              }}</openg7-admin-badge>
              <h3>{{ 'admin.attention.types.' + item.type | translate }}</h3>
            </div>
            <p>{{ 'admin.attention.reasons.' + item.type | translate }}</p>
            <small
              >{{
                item.facts['reference'] ||
                  item.emailQueueId ||
                  item.sponsorshipId ||
                  ''
              }}
              @if (item.facts['channel']) {
                · {{ item.facts['channel'] }}
              }
              @if (item.facts['eventType']) {
                · {{ item.facts['eventType'] }}
              }
            </small>
            @if (item.dueAt) {
              <small
                >{{ 'admin.attention.dueLabel' | translate }}
                <time [attr.datetime]="item.dueAt">{{
                  date(item.dueAt)
                }}</time></small
              >
            }
            @if (item.facts['receivedAt']; as receivedAt) {
              <small
                >{{ 'admin.attention.receivedAt' | translate }}
                {{ date('' + receivedAt) }}</small
              >
            }
          </div>
          @if (showLink()) {
            @if (
              item.type === 'stripe_event_failed' ||
              item.type === 'stripe_event_stalled'
            ) {
              <button
                class="admin-button"
                type="button"
                (click)="inspectStripe(item)"
              >
                {{ 'admin.inspector.kinds.stripe' | translate }}
              </button>
            }
            <a
              class="admin-button admin-button--primary"
              [routerLink]="destination(item)"
              [attr.aria-label]="
                ('admin.attention.open' | translate) +
                ' · ' +
                ('admin.attention.types.' + item.type | translate) +
                ' · ' +
                (item.facts['reference'] ||
                  item.emailQueueId ||
                  item.sponsorshipId ||
                  '')
              "
            >
              {{ 'admin.attention.open' | translate
              }}<openg7-admin-icon name="arrow" />
            </a>
          }
        </li>
      }
    </ul>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    './admin-attention.css'
  ]
})
export class AdminAttentionListComponent {
  readonly inspection = inject(AdminInspectionService);
  inspectStripe(item: AdminAttentionItem): void {
    this.inspection.stripe(
      String(item.facts['reference'] ?? ''),
      item.adminUrl ?? '/admin/fundraiser/attention'
    );
  }
  readonly items = input.required<readonly AdminAttentionItem[]>();
  readonly showLink = input(true);
  readonly returnTo = input('/admin/fundraiser/attention');
  private readonly router = inject(Router);
  private readonly i18n = inject(FundingI18nService);
  tone(item: AdminAttentionItem): AdminBadgeTone {
    return item.severity === 'urgent'
      ? 'danger'
      : item.severity === 'today'
        ? 'warning'
        : 'neutral';
  }
  date(value: string): string {
    return Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
          timeZone: 'America/Toronto',
          dateStyle: 'medium',
          timeStyle: 'short'
        }).format(new Date(value))
      : '';
  }
  destination(item: AdminAttentionItem): UrlTree {
    const url = item.adminUrl?.startsWith('/admin/fundraiser/')
      ? item.adminUrl
      : '/admin/fundraiser/attention';
    const tree = this.router.parseUrl(url);
    tree.queryParams = { ...tree.queryParams, returnTo: this.returnTo() };
    return tree;
  }
}
