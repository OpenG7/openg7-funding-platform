import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { AdminSponsorshipProgress } from '@openg7/funding-core';

import { FundingI18nService } from '../../services/funding-i18n.service.js';

/** Presentation molecule: persisted financial and publication facts, no mutations. */
@Component({
  selector: 'openg7-admin-sponsorship-facts',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section data-og7="dossier-facts" [attr.data-og7-id]="view()">
      @if (dossier(); as d) {
        @if (view() === 'billing') {
          <h3>{{ 'admin.dossier.documents' | translate }}</h3>
          @for (document of d.documents; track document.id) {
            <p>
              <strong>{{ document.number }}</strong> ·
              {{ 'admin.dossier.' + document.kind | translate }} ·
              {{ money(document.amountMinor, document.currency) }}
            </p>
          } @empty {
            <p>{{ 'admin.dossier.noDocuments' | translate }}</p>
          }
          @if (d.refund.creditMissing) {
            <p role="status">
              {{ 'admin.dossier.reasons.credit_missing' | translate }}
            </p>
          }
          <a
            routerLink="/admin/fundraiser/invoices"
            [queryParams]="{ contributionId: d.contributionId }"
            queryParamsHandling="merge"
            >{{ 'admin.dossier.openInvoices' | translate }}</a
          >
          @for (email of d.failedEmails; track email.id) {
            <p>
              <a
                routerLink="/admin/fundraiser/email-queue"
                [queryParams]="{ messageId: email.id }"
                queryParamsHandling="merge"
                >{{ 'admin.dossier.reasons.email_failed' | translate }}</a
              >
            </p>
          }
        }
        @if (view() === 'publication') {
          <h3>{{ 'admin.dossier.publicationProgress' | translate }}</h3>
          @for (publication of d.publications; track publication.id) {
            <article>
              <strong
                >{{ publication.target }} · {{ publication.channel }}</strong
              >
              <dl>
                <div>
                  <dt>{{ 'admin.dossier.draft' | translate }}</dt>
                  <dd>
                    {{
                      'admin.dossier.values.' + publication.status | translate
                    }}
                  </dd>
                </div>
                @if (publication.batchStatus) {
                  <div>
                    <dt>{{ 'admin.dossier.batch' | translate }}</dt>
                    <dd>
                      {{
                        'admin.dossier.values.' + publication.batchStatus
                          | translate
                      }}
                    </dd>
                  </div>
                }
                @if (publication.slotStatus) {
                  <div>
                    <dt>{{ 'admin.dossier.slot' | translate }}</dt>
                    <dd>
                      {{
                        'admin.dossier.values.' + publication.slotStatus
                          | translate
                      }}
                    </dd>
                  </div>
                }
                @if (publication.deliveryStatus) {
                  <div>
                    <dt>{{ 'admin.dossier.delivery' | translate }}</dt>
                    <dd>
                      {{
                        'admin.dossier.values.' + publication.deliveryStatus
                          | translate
                      }}
                    </dd>
                  </div>
                }
                @if (publication.deliveryMode === 'mock') {
                  <div>
                    <dt>{{ 'admin.dossier.mode' | translate }}</dt>
                    <dd>{{ 'admin.dossier.simulation' | translate }}</dd>
                  </div>
                }
              </dl>
              <a
                routerLink="/admin/fundraiser/publications"
                [queryParams]="{ draftId: publication.id }"
                queryParamsHandling="merge"
                >{{ 'admin.dossier.openPublication' | translate }}</a
              >
            </article>
          } @empty {
            <p>{{ 'admin.dossier.noPublications' | translate }}</p>
          }
        }
        @if (view() === 'refund') {
          <h3>{{ 'admin.dossier.refundProgress' | translate }}</h3>
          <p>
            {{ 'admin.dossier.confirmedRefund' | translate }} :
            <strong>{{
              money(d.refund.confirmedAmountMinor, d.currency)
            }}</strong>
            · {{ 'admin.dossier.states.' + d.refund.state | translate }}
          </p>
          @if (d.refund.hasError) {
            <p role="alert">
              {{ 'admin.dossier.reasons.refund_check' | translate }}
            </p>
          }
          @if (d.refund.creditMissing) {
            <p role="status">
              {{ 'admin.dossier.reasons.credit_missing' | translate }}
            </p>
          }
          <a
            routerLink="/admin/fundraiser/sponsors"
            [queryParams]="{ sponsorshipId: d.contributionId, tab: 'billing' }"
            queryParamsHandling="merge"
            >{{ 'admin.dossier.tabs.billing' | translate }}</a
          >
        }
        @if (view() === 'overview') {
          @for (event of d.failedStripeEvents; track event.id) {
            <p>
              {{ 'admin.dossier.reasons.stripe_failed' | translate }} ·
              {{ event.type }} · {{ event.id }}
            </p>
            <a
              routerLink="/admin/fundraiser/attention"
              [queryParams]="{
                type: 'stripe_event_failed',
                itemId: 'stripe_event_failed:' + event.id
              }"
              >{{ 'admin.dossier.openStep' | translate }}</a
            >
          }
        }
      } @else {
        <p role="status">{{ 'admin.dossier.factsUnavailable' | translate }}</p>
      }
    </section>
  `,
  styleUrls: [
    '../admin-ui/admin-theme.css',
    '../admin-ui/admin-controls.css',
    '../admin-ui/admin-forms.css'
  ],
  styles: [
    `
      :host {
        display: block;
      }
      section {
        padding: 1rem;
        color: var(--admin-text);
      }
      article {
        padding: 0.8rem 0;
        border-bottom: 1px solid var(--admin-border);
      }
      dl {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
      }
      dt {
        font-size: 0.8rem;
      }
      dd {
        margin: 0.2rem 0;
      }
      a {
        color: var(--admin-muted);
        font-weight: 650;
      }
      a:focus-visible {
        outline: 3px solid #296fc8;
        outline-offset: 3px;
      }
    `
  ]
})
export class AdminSponsorshipFactsComponent {
  private readonly i18n = inject(FundingI18nService);
  readonly dossier = input<AdminSponsorshipProgress | null>(null);
  readonly view = input.required<
    'billing' | 'publication' | 'refund' | 'overview'
  >();

  money(amount: number, currency: string): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      style: 'currency',
      currency
    }).format(amount / 100);
  }
}
