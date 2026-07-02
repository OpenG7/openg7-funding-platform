import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { FundingProjectConfig } from '@openg7/funding-models';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FUNDING_PROJECT_CONFIG } from '../../config/funding-project-config.token.js';
import { provideFundingProjectConfig } from '../../config/funding-project-config.token.js';
import { OPENG7_FUNDING_CONFIG } from '../../config/openg7-funding.config.js';
import { FundingService } from '../../services/funding.service.js';

interface EcosystemCard {
  readonly id: number;
  readonly title: string;
  readonly description: string;
  readonly asset: string;
}

interface FoundationPillar {
  readonly title: string;
  readonly description: string;
}

@Component({
  selector: 'openg7-funding-page',
  standalone: true,
  imports: [CommonModule, RouterLink, FundingHeaderComponent],
  providers: [provideFundingProjectConfig(OPENG7_FUNDING_CONFIG)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="builders-shell">
      <openg7-funding-header></openg7-funding-header>

      <section class="poster-hero" aria-labelledby="builders-title">
        <img
          class="hero-backdrop"
          src="assets/fonds-des-batisseurs-feuille-erable-lumineuse.png"
          alt="Ville canadienne lumineuse avec feuille d'érable connectée"
        />
        <div class="hero-shade" aria-hidden="true"></div>

        <div class="hero-copy">
          <h1 id="builders-title">
            <span>13 outils.</span>
            <span>Une mission.</span>
            <strong>Un avenir.</strong>
          </h1>
          <p>
            Le Fonds des Bâtisseurs alimente un écosystème numérique ouvert pour
            renforcer l'économie, la transparence et la résilience du Canada.
          </p>

          <article class="hero-progress-card" aria-label="Progression de la collecte">
            <div>
              <span>{{ snapshot().totals.confirmedContributions }} $ recueillis sur {{ config.monthlyGoal }} $</span>
              <strong>{{ campaignProgress() }}%</strong>
            </div>
            <div class="progress-track" aria-hidden="true">
              <span [style.width.%]="campaignProgress()"></span>
            </div>
            <button type="button" (click)="scrollToSupport()">
              Soutenir OpenG7
              <span aria-hidden="true">→</span>
            </button>
          </article>
        </div>
      </section>

      <section id="ecosystem" class="ecosystem-section" aria-labelledby="ecosystem-title">
        <header class="section-title ornament-title">
          <h2 id="ecosystem-title">L'écosystème <strong>OpenG7</strong></h2>
          <p>13 plateformes bâtissent le Canada de demain.</p>
        </header>

        <div class="tool-grid">
          <article class="tool-card" *ngFor="let card of ecosystemCards">
            <img [src]="card.asset" [alt]="card.title" />
            <div class="tool-card-copy">
              <span>{{ card.id }}</span>
              <div>
                <h3>{{ card.title }}</h3>
                <p>{{ card.description }}</p>
              </div>
            </div>
          </article>
        </div>

        <p class="solid-foundations">
          Ces plateformes ont besoin de <strong>fondations solides.</strong>
        </p>
      </section>

      <section id="funding-purpose" class="funding-purpose-board" aria-labelledby="funding-purpose-title">
        <img
          class="purpose-city"
          src="assets/fonds-des-batisseurs-feuille-erable-lumineuse.png"
          alt="Ville canadienne lumineuse avec feuille d'érable connectée"
        />
        <img
          class="purpose-dragon"
          src="assets/fonds-des-batisseurs-dragon-coffre-fort.png"
          alt="Dragon gardien protégeant un coffre de financement civique"
        />
        <div class="purpose-overlay" aria-hidden="true"></div>

        <article class="purpose-intro">
          <span class="section-kicker">Fonds des Bâtisseurs</span>
          <h2 id="funding-purpose-title">Où vont les fonds pour soutenir <strong>OpenG7</strong> ?</h2>
          <p>
            Chaque contribution est reliée à une mission concrète : garder les plateformes en ligne,
            améliorer les outils publics et publier un registre financier compréhensible.
          </p>
          <div class="purpose-actions">
            <button type="button" (click)="scrollToSupport()">Soutenir OpenG7</button>
            <a [routerLink]="['/fonds-des-batisseurs/transparence']">Voir le registre</a>
          </div>
        </article>

        <dl class="purpose-proof-strip" aria-label="État public du fonds">
          <div>
            <dt>Dernière synchronisation</dt>
            <dd>Temps réel</dd>
          </div>
          <div>
            <dt>Source des contributions</dt>
            <dd>Stripe</dd>
          </div>
          <div>
            <dt>Devise principale</dt>
            <dd>{{ config.currency }}</dd>
          </div>
          <div>
            <dt>Campagne active</dt>
            <dd>{{ config.campaignTitle }}</dd>
          </div>
        </dl>

        <section class="purpose-kpi-grid" aria-label="Indicateurs financiers du fonds">
          <article class="purpose-kpi blue">
            <span aria-hidden="true">+</span>
            <div>
              <h3>Contributions confirmées</h3>
              <strong>{{ snapshot().totals.confirmedContributions }} $</strong>
              <p>{{ snapshot().contributors.length }} bâtisseurs publics</p>
            </div>
          </article>
          <article class="purpose-kpi red">
            <span aria-hidden="true">-</span>
            <div>
              <h3>Frais de paiement</h3>
              <strong>{{ snapshot().totals.transactionFees }} $</strong>
              <p>Déduits avant disponibilité</p>
            </div>
          </article>
          <article class="purpose-kpi green">
            <span aria-hidden="true">=</span>
            <div>
              <h3>Fonds nets disponibles</h3>
              <strong>{{ snapshot().totals.availableFunds }} $</strong>
              <p>Disponible pour les projets</p>
            </div>
          </article>
          <article class="purpose-kpi gold">
            <span aria-hidden="true">%</span>
            <div>
              <h3>Objectif mensuel</h3>
              <strong>{{ config.monthlyGoal }} $</strong>
              <p>{{ campaignProgress() }} % atteint</p>
            </div>
          </article>
        </section>

        <article class="purpose-campaign-card" aria-label="Progression de la campagne">
          <header>
            <span>Progression de la campagne</span>
            <strong>{{ campaignProgress() }} %</strong>
          </header>
          <div class="purpose-track" aria-hidden="true">
            <span [style.width.%]="campaignProgress()"></span>
          </div>
          <p>{{ remainingForMonthlyGoal() }} $ sont encore nécessaires pour atteindre l'objectif mensuel.</p>
        </article>

        <div class="purpose-dashboard-grid">
          <article class="purpose-panel purpose-flow">
            <h3>Du paiement au fonds disponible</h3>
            <ol>
              <li>
                <span>1</span>
                <div>
                  <strong>Contribution reçue</strong>
                  <p>Le paiement sécurisé est déclenché depuis la page.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Paiement confirmé</strong>
                  <p>La contribution est validée puis ajoutée au total public.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Frais déduits</strong>
                  <p>Les frais de traitement restent visibles dans le calcul.</p>
                </div>
              </li>
              <li>
                <span>4</span>
                <div>
                  <strong>Fonds disponibles</strong>
                  <p>Le montant net finance l'infrastructure et les projets OpenG7.</p>
                </div>
              </li>
            </ol>
          </article>

          <article class="purpose-panel purpose-allocation">
            <h3>Répartition prévue du fonds</h3>
            <div class="purpose-donut" [style.background]="allocationDonut()" aria-hidden="true"></div>
            <ul>
              <li *ngFor="let allocation of snapshot().allocation; let index = index">
                <span [style.background]="allocationColor(index)" aria-hidden="true"></span>
                <strong>{{ allocationShare(allocation.amount) }}%</strong>
                <p>{{ allocation.category }}</p>
              </li>
            </ul>
          </article>

          <aside id="support" class="purpose-support-panel" aria-label="Contribution et transparence financière">
            <section class="contribution-panel">
              <h3>Choisissez votre contribution</h3>
              <div class="amount-grid">
                <button
                  type="button"
                  *ngFor="let amount of config.contributionAmounts"
                  [class.active]="isSelectedAmount(amount)"
                  (click)="setContributionAmount(amount)"
                >
                  {{ amount }} $
                </button>
              </div>
              <label for="custom-contribution">Autre montant</label>
              <input
                id="custom-contribution"
                type="number"
                min="1"
                step="1"
                inputmode="numeric"
                placeholder="$"
                (input)="setCustomContributionFromEvent($event)"
              />
              <button type="button" class="gold-cta" (click)="supportProject()">
                Soutenir OpenG7
              </button>
              <p class="payment-note">Paiement sécurisé par Stripe</p>
              <p class="state" *ngIf="loadingState() === 'loading'">Préparation du paiement...</p>
              <p class="state state-success" *ngIf="loadingState() === 'success'">
                Checkout simulé en local. Configurez Stripe dans /dev/stripe-setup pour ouvrir le paiement réel.
              </p>
              <p class="state state-error" *ngIf="loadingState() === 'error'">
                Impossible de démarrer le paiement.
              </p>
            </section>

            <section class="finance-panel">
              <h3>Transparence financière</h3>
              <dl>
                <div>
                  <dt>Contributions confirmées</dt>
                  <dd>{{ snapshot().totals.confirmedContributions }} $</dd>
                </div>
                <div>
                  <dt>Frais Stripe</dt>
                  <dd>{{ snapshot().totals.transactionFees }} $</dd>
                </div>
                <div>
                  <dt>Fonds nets disponibles</dt>
                  <dd>{{ snapshot().totals.availableFunds }} $</dd>
                </div>
              </dl>
              <a [routerLink]="['/fonds-des-batisseurs/transparence']">Voir les détails publics</a>
            </section>
          </aside>
        </div>
      </section>

      <footer class="builders-footer">
        <p>
          Les 13 cartes montrent ce que nous construisons.
          <strong>Le Fonds des Bâtisseurs montre comment nous le finançons.</strong>
        </p>
        <ul>
          <li *ngFor="let pillar of foundationPillars">
            <strong>{{ pillar.title }}</strong>
            <span>{{ pillar.description }}</span>
          </li>
        </ul>
      </footer>
    </main>
  `
})
export class FundingPageComponent {
  private readonly fundingService = inject(FundingService);

  readonly config: FundingProjectConfig =
    inject(FUNDING_PROJECT_CONFIG, { optional: true }) ?? OPENG7_FUNDING_CONFIG;

  readonly snapshot = signal(this.fundingService.mockSnapshot);
  readonly selectedContributionAmount = signal<number>(
    this.config.contributionAmounts[2] ?? this.config.contributionAmounts[0]
  );
  readonly loadingState = signal<'idle' | 'loading' | 'success' | 'error'>('idle');

  readonly campaignProgress = computed<number>(() => {
    const goal = this.config.monthlyGoal;
    if (goal <= 0) {
      return 0;
    }

    const ratio = (this.snapshot().totals.confirmedContributions / goal) * 100;
    return Math.min(100, Math.max(0, Math.round(ratio)));
  });

  readonly allocationTotal = computed<number>(() =>
    this.snapshot().allocation.reduce((sum, item) => sum + item.amount, 0)
  );

  readonly remainingForMonthlyGoal = computed<number>(() =>
    Math.max(0, this.config.monthlyGoal - this.snapshot().totals.confirmedContributions)
  );

  private readonly allocationPalette = ['#f4b53c', '#2f9fe5', '#58d79a', '#e5df80', '#e58a3e'];

  readonly allocationDonut = computed<string>(() => {
    const total = this.allocationTotal();
    if (total <= 0) {
      return 'conic-gradient(#f4b53c 0 100%)';
    }

    let cursor = 0;
    const segments = this.snapshot().allocation.map((allocation, index) => {
      const start = cursor;
      cursor += (allocation.amount / total) * 100;
      return `${this.allocationColor(index)} ${start}% ${cursor}%`;
    });

    return `conic-gradient(${segments.join(', ')})`;
  });

  readonly ecosystemCards: readonly EcosystemCard[] = [
    {
      id: 1,
      title: 'OpenG7 Social',
      description: 'Réseau social ouvert et souverain pour communautés et idées.',
      asset: 'assets/openg7-social-communautes-connectees-canada-miniature.png'
    },
    {
      id: 2,
      title: 'Migration Flow Engine',
      description: "Moteur d'analyse des flux migratoires pour une planification intelligente.",
      asset: 'assets/openg7-migration-flow-engine-canada-miniature.png'
    },
    {
      id: 3,
      title: 'Firewall',
      description: 'Protection avancée des infrastructures et des données critiques.',
      asset: 'assets/openg7-firewall-cybersecurite-canada-miniature.png'
    },
    {
      id: 4,
      title: 'CA: Election Day Ops',
      description: "Coordination sécurisée des opérations le jour de l'élection.",
      asset: 'assets/openg7-ca-election-day-ops-results-audit-miniature.png'
    },
    {
      id: 5,
      title: 'CA: Voter Register',
      description: 'Registre des électeurs et documents officiels numériques.',
      asset: 'assets/openg7-ca-voter-register-official-docs-miniature.png'
    },
    {
      id: 6,
      title: 'Canadian Vehicle Registry',
      description: 'Registre national des véhicules pour plus de sécurité et efficacité.',
      asset: 'assets/openg7-canadian-vehicle-registry-miniature.png'
    },
    {
      id: 7,
      title: 'GovGraph',
      description: 'Graphe de données gouvernementales interconnectées.',
      asset: 'assets/openg7-govgraph-gouvernance-canada-miniature.png'
    },
    {
      id: 8,
      title: 'Nexus',
      description: 'Portail unifié pour services et démarches citoyennes.',
      asset: 'assets/openg7-nexus-carte-canada-connecte-miniature.png'
    },
    {
      id: 9,
      title: 'Patient Navigation',
      description: 'Guide les patients dans le parcours de soins personnalisé.',
      asset: 'assets/openg7-patient-navigation-canada-miniature.png'
    },
    {
      id: 10,
      title: 'Medical Referral Router',
      description: 'Aiguillage intelligent vers les bons soins au bon moment.',
      asset: 'assets/openg7-medical-referral-router-canada-miniature.png'
    },
    {
      id: 11,
      title: 'Clinical Workforce Exchange',
      description: 'Plateforme de mise en relation des talents de la santé.',
      asset: 'assets/openg7-clinical-workforce-exchange-canada-miniature.png'
    },
    {
      id: 12,
      title: 'Health Supply Corridors',
      description: "Chaînes d'approvisionnement résilientes pour le système de santé.",
      asset: 'assets/openg7-health-supply-corridors-canada-miniature.png'
    },
    {
      id: 13,
      title: 'Funding Platform',
      description: 'Plateforme transparente de financement des initiatives OpenG7.',
      asset: 'assets/openg7-funding-platform-dragon-coffre-miniature.png'
    }
  ];

  readonly foundationPillars: readonly FoundationPillar[] = [
    {
      title: 'Transparence',
      description: 'Des comptes clairs, ouverts à tous.'
    },
    {
      title: 'Résilience',
      description: 'Des fondations solides pour un avenir sûr.'
    },
    {
      title: 'Collaboration',
      description: 'Ensemble, nous allons plus loin.'
    },
    {
      title: 'Avenir ouvert',
      description: 'Technologie ouverte au service de tous.'
    }
  ];

  setContributionAmount(amount: number): void {
    this.selectedContributionAmount.set(amount);
  }

  setCustomContributionFromEvent(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const amount = Number(input?.value ?? 0);

    if (amount > 0) {
      this.selectedContributionAmount.set(amount);
    }
  }

  isSelectedAmount(amount: number): boolean {
    return this.selectedContributionAmount() === amount;
  }

  allocationShare(amount: number): number {
    const total = this.allocationTotal();
    return total > 0 ? Math.round((amount / total) * 100) : 0;
  }

  allocationColor(index: number): string {
    return this.allocationPalette[index % this.allocationPalette.length];
  }

  scrollToSupport(): void {
    document.getElementById('support')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }

  async supportProject(): Promise<void> {
    this.loadingState.set('loading');
    try {
      const result = await this.fundingService.startCheckout(
        this.selectedContributionAmount()
      );
      if (result.status === 'redirected') {
        window.location.assign(result.redirectUrl);
        return;
      }

      this.loadingState.set('success');
    } catch {
      this.loadingState.set('error');
    }
  }
}