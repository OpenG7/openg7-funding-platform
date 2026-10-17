import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import type { AdminSponsorsListState } from '../../models/admin-sponsors-ui.models.js';

@Component({
  selector: 'openg7-admin-sponsors-summary',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="sponsors-summary"
      data-og7="sponsors-summary"
      [attr.aria-label]="'admin.sponsors.pageScope' | translate"
      [attr.aria-busy]="state() === 'loading'"
    >
      <span class="summary-scope">{{
        'admin.sponsors.pageScope' | translate
      }}</span>
      <dl>
        <div>
          <dt>{{ 'admin.sponsors.pendingReview' | translate }}</dt>
          <dd
            [class.needs-review]="
              state() === 'ready' && pendingReviewCount() > 0
            "
          >
            {{ state() === 'ready' ? pendingReviewCount() : '—' }}
          </dd>
        </div>
        <div>
          <dt>{{ 'admin.dossier.approvedConsent' | translate }}</dt>
          <dd>{{ state() === 'ready' ? visibleCount() : '—' }}</dd>
        </div>
        <div [title]="'admin.sponsors.activeHelp' | translate">
          <dt>{{ 'admin.sponsors.active' | translate }}</dt>
          <dd>{{ state() === 'ready' ? activeCount() : '—' }}</dd>
        </div>
      </dl>
    </section>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    './admin-sponsors-summary.component.css'
  ]
})
export class AdminSponsorsSummaryComponent {
  readonly state = input.required<AdminSponsorsListState>();
  readonly pendingReviewCount = input.required<number>();
  readonly visibleCount = input.required<number>();
  readonly activeCount = input.required<number>();
}
