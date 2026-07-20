import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'openg7-admin-sponsors-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="admin-summary-grid" aria-label="Resume des commandites">
      <article>
        <span class="metric-mark">TO</span>
        <div>
          <span>Total commanditaires</span>
          <strong>{{ totalSponsorships() }}</strong>
          <small>Toutes organisations</small>
        </div>
      </article>
      <article>
        <span class="metric-mark gold">VI</span>
        <div>
          <span>Visibles publiquement</span>
          <strong>{{ visibleCount() }}</strong>
          <small>Affichees ou publiees</small>
        </div>
      </article>
      <article>
        <span class="metric-mark green">AC</span>
        <div>
          <span>Commanditaires actifs</span>
          <strong>{{ activeCount() }}</strong>
          <small>Avec paiement confirme</small>
        </div>
      </article>
      <article>
        <span class="metric-mark money">CA</span>
        <div>
          <span>Contribution totale</span>
          <strong>{{ totalContributionLabel() }}</strong>
          <small>Paiements confirmes</small>
        </div>
      </article>
    </section>
  `,
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
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.5rem;
        display: grid;
        gap: 0.9rem;
        grid-template-columns: auto minmax(0, 1fr);
        min-height: 7rem;
        padding: 1.1rem;
      }

      .metric-mark {
        align-items: center;
        background: #eef2f7;
        border-radius: 999px;
        color: #172033;
        display: inline-flex;
        font-weight: 900;
        height: 3rem;
        justify-content: center;
        width: 3rem;
      }

      .metric-mark.gold {
        background: #fff4d9;
        color: #a86f16;
      }

      .metric-mark.green {
        background: #e8f7ee;
        color: #177245;
      }

      .metric-mark.money {
        background: #f4eadb;
        color: #9a6414;
      }

      .admin-summary-grid article span:not(.metric-mark) {
        color: #667085;
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
        color: #667085;
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
