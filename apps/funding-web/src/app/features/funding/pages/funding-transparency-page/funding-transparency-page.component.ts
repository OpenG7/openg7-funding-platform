import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import type { FundTransparencyPublicResponse } from '@openg7/funding-core';

import { FundTransparencyService } from '../../services/fund-transparency.service.js';

@Component({
  selector: 'openg7-funding-transparency-page',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="transparency-shell">
      <section class="intro card">
        <p class="kicker">OpenG7</p>
        <h1>Transparence financiere du Fonds des batisseurs</h1>
        <p class="subtitle">
          Vue publique des flux financiers agreges relies au financement du projet.
        </p>
        <p class="privacy-notice">
          Les donnees affichees sont agregees automatiquement a partir des transactions Stripe.
          Aucune information personnelle des contributeurs n'est publiee.
        </p>
      </section>

      <section class="metrics-grid" *ngIf="data() as report">
        <article class="card metric">
          <h2>Total recu</h2>
          <p>{{ report.total_received | currency: report.currency }}</p>
        </article>
        <article class="card metric">
          <h2>Frais Stripe</h2>
          <p>{{ report.total_fees | currency: report.currency }}</p>
        </article>
        <article class="card metric">
          <h2>Montant net</h2>
          <p>{{ report.total_net | currency: report.currency }}</p>
        </article>
        <article class="card metric">
          <h2>Nombre de contributions</h2>
          <p>{{ report.contributions_count }}</p>
        </article>
        <article class="card metric">
          <h2>Montant rembourse</h2>
          <p>{{ report.total_refunded | currency: report.currency }}</p>
        </article>
        <article class="card metric">
          <h2>Versements effectues</h2>
          <p>{{ report.total_payouts | currency: report.currency }}</p>
        </article>
        <article class="card metric available">
          <h2>Disponible estime</h2>
          <p>{{ report.current_available_estimate | currency: report.currency }}</p>
        </article>
      </section>

      <section class="card" *ngIf="data() as report">
        <header class="section-header">
          <h2>Resume mensuel</h2>
        </header>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mois</th>
                <th>Recu</th>
                <th>Frais</th>
                <th>Net</th>
                <th>Rembourse</th>
                <th>Versements</th>
                <th>Contributions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let month of report.monthly_summary">
                <td>{{ month.month }}</td>
                <td>{{ month.total_received | currency: month.currency }}</td>
                <td>{{ month.total_fees | currency: month.currency }}</td>
                <td>{{ month.total_net | currency: month.currency }}</td>
                <td>{{ month.total_refunded | currency: month.currency }}</td>
                <td>{{ month.total_payouts | currency: month.currency }}</td>
                <td>{{ month.contributions_count }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card" *ngIf="data() as report">
        <header class="section-header">
          <h2>Projets finances</h2>
        </header>
        <ul class="allocations">
          <li *ngFor="let allocation of report.latest_public_allocations">
            <div>
              <h3>{{ allocation.project_name }}</h3>
              <p>{{ allocation.public_description }}</p>
            </div>
            <p class="allocation-amount">
              {{ allocation.amount_allocated | currency: allocation.currency }}
            </p>
          </li>
        </ul>
      </section>

      <footer class="last-updated" *ngIf="data() as report">
        Derniere mise a jour: {{ report.last_updated_at | date: 'medium' }}
      </footer>

      <section class="card" *ngIf="loading()">Chargement des donnees...</section>
      <section class="card error" *ngIf="error()">Impossible de charger la transparence publique.</section>
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
      background:
        radial-gradient(circle at top right, rgba(4, 120, 87, 0.14), transparent 45%),
        radial-gradient(circle at 15% 15%, rgba(30, 64, 175, 0.12), transparent 40%),
        linear-gradient(180deg, #f8fbfc 0%, #edf4f7 100%);
      color: #0f172a;
      font-family: 'Segoe UI', 'Trebuchet MS', sans-serif;
      padding: 2rem clamp(1rem, 3vw, 2.5rem);
    }

    .transparency-shell {
      max-width: 1080px;
      margin: 0 auto;
      display: grid;
      gap: 1.2rem;
    }

    .card {
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 16px;
      padding: 1.1rem 1.2rem;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
    }

    .kicker {
      margin: 0;
      font-size: 0.8rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #0369a1;
      font-weight: 700;
    }

    h1 {
      margin: 0.4rem 0 0.2rem;
      line-height: 1.15;
      font-size: clamp(1.4rem, 4vw, 2.15rem);
    }

    .subtitle {
      margin: 0;
      color: #334155;
    }

    .privacy-notice {
      margin: 0.8rem 0 0;
      background: #ecfeff;
      border-left: 4px solid #0891b2;
      border-radius: 8px;
      padding: 0.75rem 0.85rem;
      color: #0f172a;
      font-weight: 500;
    }

    .metrics-grid {
      display: grid;
      gap: 0.8rem;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    }

    .metric h2 {
      margin: 0;
      font-size: 0.92rem;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }

    .metric p {
      margin: 0.5rem 0 0;
      font-size: 1.4rem;
      font-weight: 700;
      color: #0f172a;
    }

    .available {
      border-color: rgba(5, 150, 105, 0.4);
      background: rgba(236, 253, 245, 0.82);
    }

    .section-header h2 {
      margin: 0;
      font-size: 1.15rem;
    }

    .table-wrap {
      overflow-x: auto;
      margin-top: 0.7rem;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 720px;
    }

    th,
    td {
      text-align: left;
      padding: 0.56rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.25);
      font-size: 0.92rem;
      white-space: nowrap;
    }

    th {
      color: #334155;
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .allocations {
      list-style: none;
      margin: 0.8rem 0 0;
      padding: 0;
      display: grid;
      gap: 0.7rem;
    }

    .allocations li {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      border-bottom: 1px solid rgba(148, 163, 184, 0.25);
      padding-bottom: 0.65rem;
    }

    .allocations h3 {
      margin: 0;
      font-size: 1rem;
    }

    .allocations p {
      margin: 0.3rem 0 0;
      color: #334155;
      font-size: 0.92rem;
    }

    .allocation-amount {
      margin: 0;
      font-weight: 700;
      white-space: nowrap;
    }

    .last-updated {
      color: #334155;
      font-size: 0.9rem;
    }

    .error {
      border-color: rgba(220, 38, 38, 0.35);
      background: rgba(254, 242, 242, 0.85);
      color: #7f1d1d;
    }

    @media (max-width: 720px) {
      :host {
        padding: 1rem 0.75rem 1.6rem;
      }

      .card {
        border-radius: 12px;
      }

      .allocations li {
        flex-direction: column;
      }
    }
  `
})
export class FundingTransparencyPageComponent implements OnInit {
  private readonly transparencyService = inject(FundTransparencyService);

  readonly data = signal<FundTransparencyPublicResponse | null>(null);
  readonly loading = signal<boolean>(true);
  readonly error = signal<boolean>(false);

  readonly hasAllocations = computed(
    () => (this.data()?.latest_public_allocations.length ?? 0) > 0
  );

  async ngOnInit(): Promise<void> {
    try {
      const report = await this.transparencyService.getPublicTransparency();
      this.data.set(report);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
