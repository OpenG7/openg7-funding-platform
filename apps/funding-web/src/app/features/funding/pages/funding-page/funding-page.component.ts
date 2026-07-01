import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { FundingProjectConfig } from '@openg7/funding-models';

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
  imports: [CommonModule, RouterLink, RouterLinkActive],
  providers: [provideFundingProjectConfig(OPENG7_FUNDING_CONFIG)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="builders-shell">
      <header class="builders-nav">
        <a class="builders-brand" routerLink="/" aria-label="Accueil Fonds des bâtisseurs OpenG7">
          <span class="brand-leaf" aria-hidden="true">◆</span>
          <span>
            <strong>Fonds des bâtisseurs</strong>
            <em>OpenG7</em>
          </span>
        </a>

        <nav aria-label="Navigation principale">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Accueil</a>
          <a routerLink="/" fragment="funding-purpose">À propos</a>
          <a
            routerLink="/fonds-des-batisseurs/transparence"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: true }"
          >
            Transparence
          </a>
          <a routerLink="/" fragment="ecosystem">Projets</a>
          <a routerLink="/" fragment="support">Contact</a>
        </nav>

        <button type="button" class="nav-contribute" (click)="scrollToSupport()">
          Contribuer
        </button>
      </header>

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

      <section id="funding-purpose" class="funding-band" aria-labelledby="funding-purpose-title">
        <img
          class="funding-band-backdrop"
          src="assets/fonds-des-batisseurs-dragon-coffre-fort.png"
          alt="Dragon gardien protégeant un coffre de financement civique"
        />
        <div class="funding-band-shade" aria-hidden="true"></div>

        <article class="funding-purpose-card">
          <h2 id="funding-purpose-title">Où vont les fonds pour soutenir <strong>OpenG7</strong> ?</h2>
          <p>
            Vos contributions soutiennent l'hébergement sécurisé, le développement continu,
            les données ouvertes et l'ensemble de l'écosystème OpenG7.
          </p>
          <ul>
            <li *ngFor="let allocation of snapshot().allocation">
              <span>{{ allocation.category }}</span>
              <strong>{{ allocationShare(allocation.amount) }}%</strong>
            </li>
          </ul>
        </article>

        <aside id="support" class="support-panel" aria-label="Contribution et transparence financière">
          <section class="contribution-panel">
            <h2>Choisissez votre contribution</h2>
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
            <p class="state state-error" *ngIf="loadingState() === 'error'">
              Impossible de démarrer le paiement.
            </p>
          </section>

          <section class="finance-panel">
            <h2>Transparence financière</h2>
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