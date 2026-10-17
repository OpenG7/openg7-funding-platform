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
    '../admin-ui/admin-forms.css',
    './admin-sponsors-summary.component.css'
  ]
})
export class AdminSponsorsSummaryComponent {
  readonly totalSponsorships = input.required<number>();
  readonly visibleCount = input.required<number>();
  readonly activeCount = input.required<number>();
  readonly totalContributionLabel = input.required<string>();
}
