import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output
} from '@angular/core';

import type { AdminSponsorDetailHeaderView } from '../../models/admin-sponsors-ui.models.js';

@Component({
  selector: 'openg7-admin-sponsor-detail-header',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="detail-header">
      <div class="detail-title">
        <span class="sponsor-avatar large" aria-hidden="true">{{
          detail().initials
        }}</span>
        <div>
          <h2>{{ detail().companyName }}</h2>
          <p>{{ detail().amountLabel }} &middot; {{ detail().tierLabel }}</p>
        </div>
      </div>

      <button
        type="button"
        class="icon-action close-detail"
        (click)="close.emit()"
        aria-label="Fermer le dossier"
      >
        &times;
      </button>

      <div class="detail-badges">
        <span [class]="detail().reviewStatusClass">{{
          detail().reviewStatusLabel
        }}</span
        ><span [class]="detail().visibilityClass">{{
          detail().visibilityLabel
        }}</span
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

      <dl class="detail-meta">
        <div>
          <dt>Reference publique</dt>
          <dd>{{ detail().publicReferenceLabel }}</dd>
        </div>
        <div>
          <dt>Soumis le</dt>
          <dd>{{ detail().submittedAtLabel }}</dd>
        </div>
        <div>
          <dt>Derniere revue</dt>
          <dd>{{ detail().reviewedAtLabel }}</dd>
        </div>
      </dl>
    </header>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .detail-header {
        display: grid;
        gap: 0.9rem;
        grid-template-columns: minmax(0, 1fr) auto;
        padding: 1rem;
      }

      .detail-title {
        align-items: center;
        display: grid;
        gap: 0.8rem;
        grid-template-columns: auto minmax(0, 1fr);
      }

      .detail-title h2 {
        margin: 0;
      }

      .detail-title p {
        color: #38425a;
        margin: 0.2rem 0 0;
      }

      .sponsor-avatar {
        align-items: center;
        background: #172033;
        border-radius: 999px;
        color: #fff;
        display: inline-flex;
        font-weight: 900;
        height: 2.35rem;
        justify-content: center;
        width: 2.35rem;
      }

      .sponsor-avatar.large {
        font-size: 1.05rem;
        height: 3.5rem;
        width: 3.5rem;
      }

      .icon-action {
        align-items: center;
        background: #fff;
        border: 1px solid #cfd8e6;
        border-radius: 0.4rem;
        color: #172033;
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        font-weight: 900;
        justify-content: center;
        min-height: 2.2rem;
        padding: 0;
        text-decoration: none;
        width: 2.2rem;
      }

      .icon-action:focus-visible {
        outline: 3px solid rgba(37, 99, 235, 0.28);
        outline-offset: 2px;
      }

      .icon-action:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .detail-badges,
      .detail-meta {
        grid-column: 1 / -1;
      }

      .detail-badges {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }

      .detail-meta {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin: 0;
      }

      dt {
        color: #667085;
        font-size: 0.76rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      dd {
        margin: 0.15rem 0 0;
        overflow-wrap: anywhere;
      }

      .status-badge,
      .visibility-badge,
      .payment-badge,
      .refund-badge {
        border-radius: 999px;
        display: inline-flex;
        font-size: 0.72rem;
        font-weight: 900;
        padding: 0.25rem 0.55rem;
        width: max-content;
      }

      .status-pending,
      .payment-pending,
      .refund-requested,
      .visibility-review {
        background: #fff2cf;
        color: #8a5a00;
      }

      .status-approved,
      .payment-paid,
      .refund-completed,
      .visibility-visible {
        background: #dff7e8;
        color: #176236;
      }

      .status-rejected,
      .payment-failed,
      .refund-failed {
        background: #ffe0e5;
        color: #9f1d2f;
      }

      .visibility-hidden,
      .refund-not-requested {
        background: #eef1f5;
        color: #667085;
      }

      .refund-processing {
        background: #e8f1ff;
        color: #174ea6;
      }

      @media (max-width: 860px) {
        .detail-header {
          grid-template-columns: 1fr;
        }

        .icon-action {
          justify-self: end;
        }

        .detail-meta {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class AdminSponsorDetailHeaderComponent {
  readonly detail = input.required<AdminSponsorDetailHeaderView>();
  readonly close = output<void>();
}
