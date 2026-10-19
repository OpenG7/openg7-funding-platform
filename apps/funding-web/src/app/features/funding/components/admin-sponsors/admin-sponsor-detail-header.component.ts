import { TranslatePipe } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import type {
  AdminSponsorshipProgress,
  SponsorshipReviewStatus
} from '@openg7/funding-core';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { AdminSponsorDetailHeaderView } from '../../models/admin-sponsors-ui.models.js';

@Component({
  selector: 'openg7-admin-sponsor-detail-header',
  standalone: true,
  imports: [TranslatePipe, CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="detail-header" data-og7="dossier-header">
      <div class="detail-title">
        <span class="sponsor-avatar large" aria-hidden="true">{{
          detail().initials
        }}</span>
        <div>
          <h1>{{ detail().companyName }}</h1>
          <p>{{ detail().amountLabel }} &middot; {{ detail().tierLabel }}</p>
        </div>
      </div>

      <div class="detail-badges">
        <div
          class="review-capsule admin-focus-target"
          role="group"
          [attr.aria-label]="'admin.dossier.review' | translate"
          [attr.data-review-state]="reviewStatus()"
          [attr.id]="reviewAnchor() ? 'dossier-review' : null"
          [attr.tabindex]="reviewAnchor() ? -1 : null"
        >
          <span class="review-label">{{
            'admin.dossier.review' | translate
          }}</span>
          <span class="review-state">{{
            'admin.dossier.values.' + reviewStatus() | translate
          }}</span>
        </div>
        <span
          class="visibility-badge"
          [class.visibility-visible]="website()?.visible"
        >
          {{
            'admin.dossier.workspace.' +
              (website()
                ? website()?.visible
                  ? 'websiteVisible'
                  : 'websiteHidden'
                : 'websiteUnknown') | translate
          }} </span
        ><span [class]="detail().paymentStatusClass">{{
          detail().paymentStatusLabel
        }}</span
        ><span
          *ngIf="
            detail().refundWorkflowStatusClass as refundWorkflowStatusClass
          "
          [class]="refundWorkflowStatusClass"
          >{{ detail().refundWorkflowStatusLabel }}</span
        >
      </div>

      <details class="header-details">
        <summary>{{ 'admin.dossier.workspace.details' | translate }}</summary>
        <dl class="detail-meta">
          <div>
            <dt>{{ 'admin.legacy.reference_publique' | translate }}</dt>
            <dd>{{ detail().publicReferenceLabel }}</dd>
          </div>
          <div>
            <dt>{{ 'admin.legacy.soumis_le' | translate }}</dt>
            <dd>{{ detail().submittedAtLabel }}</dd>
          </div>
          <div>
            <dt>{{ 'admin.legacy.derniere_revue' | translate }}</dt>
            <dd>{{ detail().reviewedAtLabel }}</dd>
          </div>
        </dl>
      </details>
      <div class="header-feature">
        <ng-content select="[dossier-header-feature]" />
      </div>
    </header>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css',
    './admin-sponsor-detail-header.component.css'
  ]
})
export class AdminSponsorDetailHeaderComponent {
  readonly website = input<AdminSponsorshipProgress['website']>();
  readonly detail = input.required<AdminSponsorDetailHeaderView>();
  readonly reviewStatus = input.required<SponsorshipReviewStatus>();
  readonly reviewAnchor = input(false);
}
