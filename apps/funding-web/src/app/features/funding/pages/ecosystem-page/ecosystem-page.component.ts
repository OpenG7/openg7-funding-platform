import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  Injector,
  inject
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';

interface EcosystemPlatform {
  readonly id: number;
  readonly name: string;
  readonly familyKey: string;
  readonly descriptionKey: string;
  readonly asset: string;
  readonly repositoryUrl: string;
}

interface EcosystemFamily {
  readonly nameKey: string;
  readonly detailKey: string;
  readonly icon: string;
  readonly tone: 'cyan' | 'green' | 'gold' | 'violet' | 'orange' | 'blue';
}

interface ArchitectureItem {
  readonly labelKey: string;
  readonly icon: string;
}

interface DevelopmentRow {
  readonly labelKey: string;
  readonly progress: number;
  readonly statusKey: string;
  readonly asOf: string;
  readonly sourceKey: string;
}

@Component({
  selector: 'openg7-ecosystem-page',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, FundingHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="ecosystem-page">
      <openg7-funding-header></openg7-funding-header>

      <section class="ecosystem-hero" aria-labelledby="ecosystem-title">
        <img
          class="ecosystem-hero-image"
          src="assets/fonds-des-batisseurs-canada-coffre-lumineux.png"
          [alt]="'funding.ecosystemPage.hero.backgroundAlt' | translate"
        />
        <div class="ecosystem-hero-overlay" aria-hidden="true"></div>

        <div class="ecosystem-hero-copy">
          <h1 id="ecosystem-title">
            {{ 'funding.ecosystemPage.hero.title' | translate }}
            <strong>OpenG7</strong>
          </h1>
          <p class="ecosystem-lead">
            {{ 'funding.ecosystemPage.hero.lead' | translate }}
          </p>
          <div class="ecosystem-actions">
            <a
              class="primary"
              [routerLink]="ecosystemPath()"
              fragment="platforms"
              >{{
                'funding.ecosystemPage.actions.explorePlatforms' | translate
              }}
              <span aria-hidden="true">→</span></a
            >
            <a [routerLink]="ecosystemPath()" fragment="connections">{{
              'funding.ecosystemPage.actions.viewConnections' | translate
            }}</a>
            <a class="gold" [routerLink]="homePath()" fragment="support">{{
              'funding.ecosystemPage.actions.supportEcosystem' | translate
            }}</a>
          </div>
        </div>

        <dl
          class="ecosystem-stats"
          [attr.aria-label]="
            'funding.ecosystemPage.stats.ariaLabel' | translate
          "
        >
          <div>
            <dt>13</dt>
            <dd>{{ 'funding.ecosystemPage.stats.platforms' | translate }}</dd>
          </div>
          <div>
            <dt>6</dt>
            <dd>{{ 'funding.ecosystemPage.stats.families' | translate }}</dd>
          </div>
          <div>
            <dt>1</dt>
            <dd>
              {{
                'funding.ecosystemPage.stats.sharedInfrastructure' | translate
              }}
            </dd>
          </div>
          <div>
            <dt>∞</dt>
            <dd>
              {{ 'funding.ecosystemPage.stats.possibilities' | translate }}
            </dd>
          </div>
        </dl>
      </section>

      <section class="ecosystem-map-panel" aria-labelledby="map-title">
        <article class="map-intro">
          <h2 id="map-title">
            {{ 'funding.ecosystemPage.map.title' | translate }}
          </h2>
          <p>
            {{ 'funding.ecosystemPage.map.copy' | translate }}
          </p>
          <a [routerLink]="ecosystemPath()" fragment="connections"
            >{{ 'funding.ecosystemPage.map.explore' | translate }}
            <span aria-hidden="true">↗</span></a
          >
        </article>

        <div
          class="network-board"
          [attr.aria-label]="
            'funding.ecosystemPage.map.networkAria' | translate
          "
        >
          <div class="network-list left">
            <article
              *ngFor="let platform of leftNetworkPlatforms"
              class="network-node"
            >
              <img [src]="platform.asset" [alt]="platform.name" />
              <div>
                <span>{{ platformNumber(platform.id) }}</span>
                <strong>{{ platform.name }}</strong>
              </div>
            </article>
          </div>

          <div class="family-column left">
            <article class="family-orb cyan">
              <span aria-hidden="true">↗</span>
              <strong>{{
                'funding.ecosystemPage.families.economyShort' | translate
              }}</strong>
            </article>
            <article class="family-orb green">
              <span aria-hidden="true">♥</span>
              <strong>{{
                'funding.ecosystemPage.families.health' | translate
              }}</strong>
            </article>
            <article class="family-orb blue">
              <span aria-hidden="true">▦</span>
              <strong>{{
                'funding.ecosystemPage.families.governanceShort' | translate
              }}</strong>
            </article>
          </div>

          <article class="network-core">
            <span aria-hidden="true">⌬</span>
            <strong>OpenG7</strong>
          </article>

          <div class="family-column right">
            <article class="family-orb gold">
              <span aria-hidden="true">●</span>
              <strong>{{
                'funding.ecosystemPage.families.society' | translate
              }}</strong>
            </article>
            <article class="family-orb orange">
              <span aria-hidden="true">▣</span>
              <strong>{{
                'funding.ecosystemPage.families.security' | translate
              }}</strong>
            </article>
            <article class="family-orb violet">
              <span aria-hidden="true">$</span>
              <strong>{{
                'funding.ecosystemPage.families.funding' | translate
              }}</strong>
            </article>
          </div>

          <div class="network-list right">
            <article
              *ngFor="let platform of rightNetworkPlatforms"
              class="network-node"
            >
              <img [src]="platform.asset" [alt]="platform.name" />
              <div>
                <span>{{ platformNumber(platform.id) }}</span>
                <strong>{{ platform.name }}</strong>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section
        id="platforms"
        class="platform-section"
        aria-labelledby="platforms-title"
      >
        <h2 id="platforms-title">
          {{ 'funding.ecosystemPage.platforms.title' | translate }}
        </h2>
        <div class="platform-grid">
          <article class="platform-card" *ngFor="let platform of platforms">
            <img [src]="platform.asset" [alt]="platform.name" />
            <div>
              <span>{{ platformNumber(platform.id) }}</span>
              <h3>{{ platform.name }}</h3>
              <em>{{ platform.familyKey | translate }}</em>
              <p>{{ platform.descriptionKey | translate }}</p>
              <a
                [href]="platform.repositoryUrl"
                target="_blank"
                rel="noreferrer"
                >{{ 'funding.ecosystemPage.actions.explore' | translate }}
                <span aria-hidden="true">→</span></a
              >
            </div>
          </article>
        </div>
      </section>

      <section
        id="architecture"
        class="architecture-grid"
        aria-labelledby="architecture-title"
      >
        <article class="architecture-panel">
          <h2 id="architecture-title">
            {{ 'funding.ecosystemPage.architecture.title' | translate }}
          </h2>
          <p>
            {{ 'funding.ecosystemPage.architecture.copy' | translate }}
          </p>
          <div class="architecture-items">
            <article *ngFor="let item of architectureItems">
              <span aria-hidden="true">{{ item.icon }}</span>
              <strong>{{ item.labelKey | translate }}</strong>
            </article>
          </div>
          <div
            class="platform-dots"
            [attr.aria-label]="
              'funding.ecosystemPage.architecture.platformDotsAria' | translate
            "
          >
            <span *ngFor="let platform of platforms">{{
              platformNumber(platform.id)
            }}</span>
          </div>
        </article>

        <article id="connections" class="connections-panel">
          <h2>{{ 'funding.ecosystemPage.connections.title' | translate }}</h2>
          <ul>
            <li *ngFor="let family of families" [class]="family.tone">
              <span aria-hidden="true">{{ family.icon }}</span>
              <div>
                <strong>{{ family.nameKey | translate }}</strong>
                <p>{{ family.detailKey | translate }}</p>
              </div>
            </li>
          </ul>
        </article>
      </section>

      <section class="journey-panel" aria-labelledby="journey-title">
        <h2 id="journey-title">
          {{ 'funding.ecosystemPage.journey.title' | translate }}
        </h2>
        <div class="journey-track">
          <article *ngFor="let step of journeySteps; let last = last">
            <span aria-hidden="true">{{ step.icon }}</span>
            <strong>{{ step.name }}</strong>
            <p>{{ step.detailKey | translate }}</p>
            <i *ngIf="!last" aria-hidden="true">→</i>
          </article>
        </div>
      </section>

      <section class="progress-summary">
        <article class="development-panel">
          <h2>{{ 'funding.ecosystemPage.development.title' | translate }}</h2>
          <div class="development-row" *ngFor="let row of developmentRows">
            <span>{{ row.labelKey | translate }}</span>
            <div aria-hidden="true"><i [style.width.%]="row.progress"></i></div>
            <strong>{{ row.progress }}%</strong>
            <em>{{ row.statusKey | translate }}</em>
            <small>
              {{ 'funding.ecosystemPage.development.asOf' | translate }}
              {{ row.asOf | date: 'longDate' }} ·
              {{ row.sourceKey | translate }}
            </small>
          </div>
        </article>

        <aside
          class="summary-panel"
          [attr.aria-label]="
            'funding.ecosystemPage.summary.ariaLabel' | translate
          "
        >
          <dl>
            <div>
              <dt>13</dt>
              <dd>{{ 'funding.ecosystemPage.stats.platforms' | translate }}</dd>
            </div>
            <div>
              <dt>6</dt>
              <dd>{{ 'funding.ecosystemPage.stats.families' | translate }}</dd>
            </div>
            <div>
              <dt>1</dt>
              <dd>
                {{ 'funding.ecosystemPage.summary.commonVision' | translate }}
              </dd>
            </div>
            <div>
              <dt>100+</dt>
              <dd>
                {{
                  'funding.ecosystemPage.summary.potentialPartners' | translate
                }}
              </dd>
            </div>
          </dl>
          <ul>
            <li>
              {{
                'funding.ecosystemPage.summary.items.interoperability.label'
                  | translate
              }}
              <span>{{
                'funding.ecosystemPage.summary.items.interoperability.detail'
                  | translate
              }}</span>
            </li>
            <li>
              {{
                'funding.ecosystemPage.summary.items.openness.label' | translate
              }}
              <span>{{
                'funding.ecosystemPage.summary.items.openness.detail'
                  | translate
              }}</span>
            </li>
            <li>
              {{
                'funding.ecosystemPage.summary.items.trust.label' | translate
              }}
              <span>{{
                'funding.ecosystemPage.summary.items.trust.detail' | translate
              }}</span>
            </li>
            <li>
              {{
                'funding.ecosystemPage.summary.items.impact.label' | translate
              }}
              <span>{{
                'funding.ecosystemPage.summary.items.impact.detail' | translate
              }}</span>
            </li>
          </ul>
        </aside>
      </section>

      <section class="ecosystem-cta" aria-labelledby="ecosystem-cta-title">
        <h2 id="ecosystem-cta-title">
          {{ 'funding.ecosystemPage.cta.title' | translate }}
        </h2>
        <p>{{ 'funding.ecosystemPage.cta.copy' | translate }}</p>
        <div class="ecosystem-actions">
          <a class="primary" [routerLink]="ecosystemPath()" fragment="platforms"
            >{{ 'funding.ecosystemPage.actions.explorePlatforms' | translate }}
            <span aria-hidden="true">→</span></a
          >
          <a [routerLink]="ecosystemPath()" fragment="connections">{{
            'funding.ecosystemPage.actions.viewConnections' | translate
          }}</a>
          <a class="gold" [routerLink]="homePath()" fragment="support">{{
            'funding.ecosystemPage.actions.supportEcosystem' | translate
          }}</a>
        </div>
      </section>

      <footer class="ecosystem-footer">
        <a
          class="ecosystem-brand"
          [routerLink]="homePath()"
          [attr.aria-label]="'funding.aria.brandHome' | translate"
        >
          <span aria-hidden="true">⌬</span>
          <strong>OpenG7</strong>
        </a>
        <nav
          [attr.aria-label]="
            'funding.ecosystemPage.footer.secondaryLinksAria' | translate
          "
        >
          <a [routerLink]="aboutPath()">{{
            'funding.nav.about' | translate
          }}</a>
          <a [routerLink]="ecosystemPath()">{{
            'funding.ecosystemPage.footer.documentation' | translate
          }}</a>
          <a [routerLink]="supportPath()">{{
            'funding.nav.contact' | translate
          }}</a>
        </nav>
        <small>{{
          'funding.ecosystemPage.footer.copyright'
            | translate: { year: currentYear }
        }}</small>
      </footer>
    </main>
  `,
  styleUrl: './ecosystem-page.component.css'
})
export class EcosystemPageComponent {
  private readonly i18n = inject(FundingI18nService);
  private readonly injector = inject(Injector);
  private readonly seo = inject(FundingSeoService);

  readonly homePath = computed(() => this.i18n.localizedPath('/'));
  readonly aboutPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/a-propos')
  );
  readonly ecosystemPath = computed(() =>
    this.i18n.localizedPath('/ecosystem')
  );
  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );
  readonly supportPath = computed(() => this.i18n.localizedPath('/support'));
  readonly currentYear = new Date().getFullYear();

  constructor() {
    this.seo.bind(
      {
        titleKey: 'funding.seo.ecosystem.title',
        descriptionKey: 'funding.seo.ecosystem.description',
        path: '/ecosystem',
        imagePath: '/assets/openg7-nexus-carte-canada-connecte.png'
      },
      this.injector
    );
  }

  readonly platforms: readonly EcosystemPlatform[] = [
    {
      id: 1,
      name: 'OpenG7 Nexus',
      familyKey: 'funding.ecosystemPage.families.economy',
      descriptionKey: 'funding.ecosystemPage.platformDescriptions.nexus',
      asset: 'assets/openg7-nexus-carte-canada-connecte.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-nexus'
    },
    {
      id: 2,
      name: 'Canadian Vehicle Registry',
      familyKey: 'funding.ecosystemPage.families.economy',
      descriptionKey:
        'funding.ecosystemPage.platformDescriptions.vehicleRegistry',
      asset: 'assets/openg7-canadian-vehicle-registry.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-ca-vehicle-registry'
    },
    {
      id: 3,
      name: 'Migration Flow Engine',
      familyKey: 'funding.ecosystemPage.families.governance',
      descriptionKey: 'funding.ecosystemPage.platformDescriptions.migration',
      asset: 'assets/openg7-migration-flow-engine-canada.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-migration-flow-engine'
    },
    {
      id: 4,
      name: 'Patient Navigation',
      familyKey: 'funding.ecosystemPage.families.health',
      descriptionKey:
        'funding.ecosystemPage.platformDescriptions.patientNavigation',
      asset: 'assets/openg7-patient-navigation-canada.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-patient-navigation'
    },
    {
      id: 5,
      name: 'Medical Referral Router',
      familyKey: 'funding.ecosystemPage.families.health',
      descriptionKey: 'funding.ecosystemPage.platformDescriptions.referral',
      asset: 'assets/openg7-medical-referral-router-canada.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-medical-referral-router'
    },
    {
      id: 6,
      name: 'Clinical Workforce Exchange',
      familyKey: 'funding.ecosystemPage.families.health',
      descriptionKey: 'funding.ecosystemPage.platformDescriptions.workforce',
      asset: 'assets/openg7-clinical-workforce-exchange-canada.png',
      repositoryUrl:
        'https://github.com/OpenG7/openg7-clinical-workforce-exchange'
    },
    {
      id: 7,
      name: 'Health Supply Corridors',
      familyKey: 'funding.ecosystemPage.families.health',
      descriptionKey: 'funding.ecosystemPage.platformDescriptions.supply',
      asset: 'assets/openg7-health-supply-corridors-canada.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-health-supply-corridors'
    },
    {
      id: 8,
      name: 'GovGraph',
      familyKey: 'funding.ecosystemPage.families.governance',
      descriptionKey: 'funding.ecosystemPage.platformDescriptions.govgraph',
      asset: 'assets/openg7-govgraph-gouvernance-canada.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-govgraph'
    },
    {
      id: 9,
      name: 'Election Day Ops',
      familyKey: 'funding.ecosystemPage.families.governance',
      descriptionKey: 'funding.ecosystemPage.platformDescriptions.electionOps',
      asset: 'assets/openg7-ca-election-day-ops-results-audit.png',
      repositoryUrl:
        'https://github.com/OpenG7/openg7-ca-election-day-ops-and-audit'
    },
    {
      id: 10,
      name: 'Voter Register & Official Docs',
      familyKey: 'funding.ecosystemPage.families.governance',
      descriptionKey:
        'funding.ecosystemPage.platformDescriptions.voterRegister',
      asset: 'assets/openg7-ca-voter-register-official-docs.png',
      repositoryUrl:
        'https://github.com/OpenG7/openg7-ca-voter-register-and-docs'
    },
    {
      id: 11,
      name: 'OpenG7 Social',
      familyKey: 'funding.ecosystemPage.families.society',
      descriptionKey: 'funding.ecosystemPage.platformDescriptions.social',
      asset: 'assets/openg7-social-communautes-connectees-canada.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-social'
    },
    {
      id: 12,
      name: 'OpenG7 Firewall',
      familyKey: 'funding.ecosystemPage.families.security',
      descriptionKey: 'funding.ecosystemPage.platformDescriptions.firewall',
      asset: 'assets/openg7-firewall-cybersecurite-canada.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-firewall'
    },
    {
      id: 13,
      name: 'OpenG7 Funding Platform',
      familyKey: 'funding.ecosystemPage.families.funding',
      descriptionKey: 'funding.ecosystemPage.platformDescriptions.funding',
      asset: 'assets/openg7-funding-platform-dragon-coffre.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-funding-platform'
    }
  ];

  readonly leftNetworkPlatforms = this.platforms.slice(0, 7);
  readonly rightNetworkPlatforms = this.platforms.slice(7);

  readonly families: readonly EcosystemFamily[] = [
    {
      nameKey: 'funding.ecosystemPage.families.health',
      detailKey: 'funding.ecosystemPage.familyDetails.health',
      icon: '♡',
      tone: 'green'
    },
    {
      nameKey: 'funding.ecosystemPage.families.data',
      detailKey: 'funding.ecosystemPage.familyDetails.data',
      icon: '▧',
      tone: 'cyan'
    },
    {
      nameKey: 'funding.ecosystemPage.families.mobility',
      detailKey: 'funding.ecosystemPage.familyDetails.mobility',
      icon: '⌁',
      tone: 'violet'
    },
    {
      nameKey: 'funding.ecosystemPage.families.security',
      detailKey: 'funding.ecosystemPage.familyDetails.security',
      icon: '◈',
      tone: 'orange'
    },
    {
      nameKey: 'funding.ecosystemPage.families.funding',
      detailKey: 'funding.ecosystemPage.familyDetails.funding',
      icon: '$',
      tone: 'gold'
    }
  ];

  readonly architectureItems: readonly ArchitectureItem[] = [
    { labelKey: 'funding.ecosystemPage.architecture.items.core', icon: '◌' },
    { labelKey: 'funding.ecosystemPage.architecture.items.design', icon: '▣' },
    { labelKey: 'funding.ecosystemPage.architecture.items.models', icon: '▰' },
    {
      labelKey: 'funding.ecosystemPage.architecture.items.security',
      icon: '▨'
    },
    { labelKey: 'funding.ecosystemPage.architecture.items.gateway', icon: '⌘' },
    { labelKey: 'funding.ecosystemPage.architecture.items.i18n', icon: '◎' },
    {
      labelKey: 'funding.ecosystemPage.architecture.items.components',
      icon: '⚙'
    },
    { labelKey: 'funding.ecosystemPage.architecture.items.docs', icon: '▤' }
  ];

  readonly journeySteps = [
    {
      name: 'OpenGraph',
      detailKey: 'funding.ecosystemPage.journey.items.opengraph',
      icon: '⌬'
    },
    {
      name: 'Clinical Workforce Exchange',
      detailKey: 'funding.ecosystemPage.journey.items.workforce',
      icon: '⌘'
    },
    {
      name: 'Medical Referral Router',
      detailKey: 'funding.ecosystemPage.journey.items.referral',
      icon: '▤'
    },
    {
      name: 'Patient Navigation',
      detailKey: 'funding.ecosystemPage.journey.items.patient',
      icon: '♙'
    },
    {
      name: 'Health Supply Corridors',
      detailKey: 'funding.ecosystemPage.journey.items.supply',
      icon: '▥'
    },
    {
      name: 'OpenG7 Nexus',
      detailKey: 'funding.ecosystemPage.journey.items.nexus',
      icon: '◇'
    },
    {
      name: 'OpenG7 Firewall',
      detailKey: 'funding.ecosystemPage.journey.items.firewall',
      icon: '◈'
    },
    {
      name: 'OpenG7 Funding Platform',
      detailKey: 'funding.ecosystemPage.journey.items.funding',
      icon: '◎'
    }
  ];

  readonly developmentRows: readonly DevelopmentRow[] = [
    {
      labelKey: 'funding.ecosystemPage.development.rows.concepts',
      progress: 100,
      statusKey: 'funding.ecosystemPage.development.status.done',
      asOf: '2026-09-11',
      sourceKey: 'funding.ecosystemPage.development.source.internalRoadmap'
    },
    {
      labelKey: 'funding.ecosystemPage.development.rows.prototypes',
      progress: 78,
      statusKey: 'funding.ecosystemPage.development.status.inProgress',
      asOf: '2026-09-11',
      sourceKey: 'funding.ecosystemPage.development.source.internalRoadmap'
    },
    {
      labelKey: 'funding.ecosystemPage.development.rows.visuals',
      progress: 85,
      statusKey: 'funding.ecosystemPage.development.status.inProgress',
      asOf: '2026-09-11',
      sourceKey: 'funding.ecosystemPage.development.source.internalRoadmap'
    },
    {
      labelKey: 'funding.ecosystemPage.development.rows.integrations',
      progress: 56,
      statusKey: 'funding.ecosystemPage.development.status.inProgress',
      asOf: '2026-09-11',
      sourceKey: 'funding.ecosystemPage.development.source.internalRoadmap'
    },
    {
      labelKey: 'funding.ecosystemPage.development.rows.sharedServices',
      progress: 72,
      statusKey: 'funding.ecosystemPage.development.status.inProgress',
      asOf: '2026-09-11',
      sourceKey: 'funding.ecosystemPage.development.source.internalRoadmap'
    }
  ];

  platformNumber(id: number): string {
    return id.toString().padStart(2, '0');
  }
}
