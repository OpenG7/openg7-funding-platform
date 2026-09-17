import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'openg7-admin-sponsors-summary',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="admin-summary-grid"
      [attr.aria-label]="'admin.legacy.resume_des_commandites' | translate"
    >
      <article>
        <span class="metric-mark">{{ 'admin.legacy.to' | translate }}</span>
        <div>
          <span>{{ 'admin.legacy.total_commanditaires' | translate }}</span>
          <strong>{{ totalSponsorships() }}</strong>
          <small>{{ 'admin.legacy.toutes_organisations' | translate }}</small>
        </div>
      </article>
      <article>
        <span class="metric-mark gold">{{
          'admin.legacy.vi' | translate
        }}</span>
        <div>
          <span>{{ 'admin.dossier.approvedConsent' | translate }}</span>
          <strong>{{ visibleCount() }}</strong>
          <small>{{ 'admin.dossier.listScope' | translate }}</small>
        </div>
      </article>
      <article>
        <span class="metric-mark green">{{
          'admin.legacy.ac' | translate
        }}</span>
        <div>
          <span>{{ 'admin.legacy.commanditaires_actifs' | translate }}</span>
          <strong>{{ activeCount() }}</strong>
          <small>{{ 'admin.legacy.avec_paiement_confirme' | translate }}</small>
        </div>
      </article>
      <article>
        <span class="metric-mark money">{{
          'admin.legacy.ca' | translate
        }}</span>
        <div>
          <span>{{ 'admin.legacy.contribution_totale' | translate }}</span>
          <strong>{{ totalContributionLabel() }}</strong>
          <small>{{ 'admin.legacy.paiements_confirmes' | translate }}</small>
        </div>
      </article>
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
        width: 100%;
      }

      .admin-summary-grid {
        display: grid;
        gap: 0.9rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        width: 100%;
      }

      .admin-summary-grid article {
        align-items: center;
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-radius: 0.5rem;
        display: grid;
        gap: 0.9rem;
        grid-template-columns: auto minmax(0, 1fr);
        min-height: 7rem;
        padding: 1.1rem;
      }

      .metric-mark {
        align-items: center;
        background: var(--admin-panel-raised);
        border-radius: 999px;
        color: var(--admin-text);
        display: inline-flex;
        font-weight: 900;
        height: 3rem;
        justify-content: center;
        width: 3rem;
      }

      .metric-mark.gold {
        background: #3c3221;
        color: var(--admin-warning);
      }

      .metric-mark.green {
        background: var(--admin-panel-raised);
        color: var(--admin-success);
      }

      .metric-mark.money {
        background: #3c3221;
        color: var(--admin-warning);
      }

      .admin-summary-grid article span:not(.metric-mark) {
        color: var(--admin-muted);
        font-size: 0.76rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .admin-summary-grid strong {
        display: block;
        font-size: 1.7rem;
        line-height: 1.1;
        margin-top: 0.18rem;
      }

      .admin-summary-grid small {
        color: var(--admin-muted);
      }

      @media (max-width: 860px) {
        .admin-summary-grid {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class AdminSponsorsSummaryComponent {
  readonly totalSponsorships = input.required<number>();
  readonly visibleCount = input.required<number>();
  readonly activeCount = input.required<number>();
  readonly totalContributionLabel = input.required<string>();
}
