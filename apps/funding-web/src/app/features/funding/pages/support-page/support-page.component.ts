import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';

interface SupportAction {
  readonly title: string;
  readonly description: string;
  readonly icon: string;
}

interface SupportRepository {
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly url: string;
  readonly status: 'Actif' | 'En développement' | 'Pré-alpha';
  readonly tone: 'cyan' | 'gold' | 'green' | 'blue';
}

interface SupportStep {
  readonly title: string;
  readonly description: string;
}

@Component({
  selector: 'openg7-support-page',
  standalone: true,
  imports: [CommonModule, RouterLink, FundingHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="support-page">
      <openg7-funding-header></openg7-funding-header>

      <section class="support-hero" aria-labelledby="support-title">
        <img
          class="support-hero-image"
          src="assets/fonds-des-batisseurs-canada-coffre-lumineux.png"
          alt="Carte numérique du Canada connectée à l'écosystème OpenG7"
        />
        <img
          class="support-dragon"
          src="assets/fonds-des-batisseurs-dragon-coffre-fort.png"
          alt="Dragon gardien de l'écosystème OpenG7"
        />
        <div class="support-hero-overlay" aria-hidden="true"></div>

        <div class="support-copy">
          <h1 id="support-title">Construire OpenG7 avec <strong>GitHub</strong></h1>
          <p>
            GitHub est l’atelier public de l’écosystème. Explorez les dépôts, signalez un problème,
            proposez une idée et contribuez au code.
          </p>
          <div class="support-actions-row">
            <a class="primary" href="https://github.com/orgs/OpenG7/repositories" target="_blank" rel="noreferrer">Voir les dépôts</a>
            <a href="https://github.com/OpenG7" target="_blank" rel="noreferrer">Ouvrir GitHub <span aria-hidden="true">↗</span></a>
          </div>
        </div>

        <div class="support-action-grid" aria-label="Actions de contribution">
          <article *ngFor="let action of actions">
            <span aria-hidden="true">{{ action.icon }}</span>
            <div>
              <h2>{{ action.title }}</h2>
              <p>{{ action.description }}</p>
            </div>
            <i aria-hidden="true">→</i>
          </article>
        </div>
      </section>

      <section class="support-workspace" aria-label="Espace de support OpenG7">
        <article class="repository-panel">
          <header>
            <span aria-hidden="true">▤</span>
            <div>
              <h2>Choisir un dépôt</h2>
              <p>Voici les dépôts principaux de l’écosystème OpenG7. Cliquez pour explorer, lire la documentation ou contribuer.</p>
            </div>
          </header>

          <div class="repository-list">
            <article *ngFor="let repository of repositories">
              <span class="repository-icon" [class]="repository.tone" aria-hidden="true">{{ repository.icon }}</span>
              <div>
                <h3>{{ repository.name }}</h3>
                <p>{{ repository.description }}</p>
              </div>
              <em [class]="repository.tone">{{ repository.status }}</em>
              <nav aria-label="Liens du dépôt">
                <a [href]="repository.url" target="_blank" rel="noreferrer">README</a>
                <a [href]="repository.url + '/issues'" target="_blank" rel="noreferrer">Issues</a>
                <a [href]="repository.url + '/pulls'" target="_blank" rel="noreferrer">Pull Requests</a>
              </nav>
            </article>
          </div>

          <a class="all-repositories" href="https://github.com/orgs/OpenG7/repositories" target="_blank" rel="noreferrer">
            Voir tous les dépôts sur GitHub <span aria-hidden="true">↗</span>
          </a>
        </article>

        <aside class="support-side">
          <article class="steps-panel">
            <h2>Comment utiliser GitHub avec OpenG7 ?</h2>
            <ol>
              <li *ngFor="let step of steps; let index = index">
                <span>{{ index + 1 }}</span>
                <strong>{{ step.title }}</strong>
                <p>{{ step.description }}</p>
              </li>
            </ol>
          </article>

          <article class="notice-panel warning">
            <span aria-hidden="true">◈</span>
            <div>
              <strong>Ne publiez jamais de clés API, mots de passe ou données personnelles.</strong>
              <p>Pour une faille de sécurité, utilisez le canal privé indiqué dans SECURITY.md.</p>
            </div>
          </article>

          <article class="notice-panel info">
            <span aria-hidden="true">◎</span>
            <div>
              <strong>OpenG7 est actuellement un projet indépendant en développement.</strong>
              <p>Les échanges et contributions passent principalement par GitHub.</p>
            </div>
          </article>
        </aside>
      </section>

      <footer class="support-footer">
        <div>
          <span aria-hidden="true">◆</span>
          <p><strong>Fait au Canada. Ouvert pour tous.</strong> Transparence · Collaboration · Souveraineté numérique</p>
        </div>
        <nav aria-label="Liens support secondaires">
          <a routerLink="/fonds-des-batisseurs/a-propos">Code de conduite</a>
          <a routerLink="/fonds-des-batisseurs/transparence">Sécurité</a>
          <a routerLink="/ecosystem">Documentation</a>
          <a routerLink="/">Licence</a>
        </nav>
        <small>© 2025 OpenG7</small>
      </footer>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .support-page {
        background:
          radial-gradient(circle at 72% 5%, rgb(20 181 255 / 16%), transparent 20rem),
          linear-gradient(180deg, #020a17 0%, #03172d 48%, #020a17 100%);
        border: 1px solid rgb(62 161 229 / 24%);
        box-shadow: 0 30px 90px rgb(0 0 0 / 52%);
        color: #f7fbff;
        font-family: 'Trebuchet MS', sans-serif;
        margin: 0;
        max-width: none;
        min-height: 100dvh;
        overflow: hidden;
        width: 100%;
      }

      .support-hero {
        align-items: start;
        display: grid;
        gap: 1.2rem;
        grid-template-columns: minmax(24rem, 0.85fr) minmax(30rem, 1.15fr);
        min-height: 18.5rem;
        overflow: hidden;
        padding: 2rem clamp(1rem, 7vw, 8rem) 1.25rem;
        position: relative;
      }

      .support-hero-image,
      .support-dragon {
        height: 100%;
        inset: 0;
        object-fit: cover;
        position: absolute;
        width: 100%;
      }

      .support-hero-image {
        filter: saturate(1.18) contrast(1.08);
        object-position: center 36%;
        opacity: 0.78;
      }

      .support-dragon {
        left: auto;
        object-position: right center;
        opacity: 0.22;
        right: -6%;
        width: 46%;
      }

      .support-hero-overlay {
        background:
          linear-gradient(90deg, rgb(2 10 23 / 96%) 0%, rgb(2 10 23 / 72%) 34%, rgb(2 10 23 / 22%) 66%, rgb(2 10 23 / 58%) 100%),
          linear-gradient(180deg, rgb(2 10 23 / 2%) 0%, rgb(2 10 23 / 12%) 48%, rgb(2 10 23 / 92%) 100%);
        inset: 0;
        position: absolute;
      }

      .support-copy,
      .support-action-grid {
        position: relative;
        z-index: 1;
      }

      .support-copy {
        max-width: 42rem;
      }

      h1,
      h2,
      h3,
      p {
        margin: 0;
      }

      .support-copy h1 {
        color: #fff8e8;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(2.25rem, 4.5vw, 4.2rem);
        line-height: 0.92;
        text-shadow: 0 5px 24px rgb(0 0 0 / 76%);
      }

      .support-copy h1 strong,
      .all-repositories,
      .repository-panel header > span,
      .steps-panel h2::before {
        color: #34c8ff;
      }

      .support-copy p {
        color: #cfe1f0;
        font-size: 1.08rem;
        line-height: 1.45;
        margin-top: 0.85rem;
        max-width: 39rem;
      }

      .support-actions-row,
      .support-action-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 0.8rem;
      }

      .support-actions-row {
        margin-top: 1.5rem;
      }

      .support-actions-row a,
      .all-repositories {
        align-items: center;
        background: rgb(3 20 40 / 72%);
        border: 1px solid rgb(83 178 244 / 50%);
        border-radius: 0.45rem;
        color: #f7fbff;
        display: inline-flex;
        font-weight: 900;
        justify-content: center;
        min-height: 2.75rem;
        padding: 0 1.2rem;
        text-decoration: none;
      }

      .support-actions-row a.primary {
        background: linear-gradient(180deg, #52d8ff, #0d9edf);
        border-color: #78e6ff;
        color: #041426;
      }

      .support-action-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-top: 0.25rem;
      }

      .support-action-grid article,
      .repository-panel,
      .steps-panel,
      .notice-panel {
        background: rgb(4 21 43 / 78%);
        border: 1px solid rgb(76 166 235 / 30%);
        box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%), 0 16px 38px rgb(0 0 0 / 24%);
      }

      .support-action-grid article {
        align-items: start;
        backdrop-filter: blur(10px);
        border-radius: 0.62rem;
        display: grid;
        gap: 0.8rem;
        grid-template-columns: auto 1fr auto;
        min-height: 7rem;
        padding: 1rem;
      }

      .support-action-grid article > span,
      .repository-icon,
      .notice-panel > span {
        background: radial-gradient(circle, rgb(11 75 111), rgb(4 29 55));
        border: 1px solid rgb(70 210 255 / 55%);
        border-radius: 0.55rem;
        color: #56d9ff;
        display: grid;
        font-size: 1.6rem;
        height: 3.2rem;
        place-items: center;
        width: 3.2rem;
      }

      .support-action-grid h2 {
        color: #fff8e8;
        font-size: 1rem;
      }

      .support-action-grid p {
        color: #bdd0df;
        font-size: 0.82rem;
        line-height: 1.35;
        margin-top: 0.35rem;
      }

      .support-action-grid i {
        align-self: end;
        color: var(--gold-400);
        font-style: normal;
      }

      .support-workspace {
        display: grid;
        gap: 0.9rem;
        grid-template-columns: minmax(28rem, 1.4fr) minmax(22rem, 0.85fr);
        margin: 0.9rem clamp(1rem, 7vw, 8rem) 0;
      }

      .repository-panel,
      .steps-panel,
      .notice-panel {
        border-radius: 0.72rem;
      }

      .repository-panel {
        padding: 1rem;
      }

      .repository-panel > header {
        align-items: start;
        display: grid;
        gap: 0.8rem;
        grid-template-columns: auto 1fr;
      }

      .repository-panel header > span {
        font-size: 1.8rem;
      }

      .repository-panel h2,
      .steps-panel h2 {
        color: #fff8e8;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 1.3rem;
      }

      .repository-panel header p {
        color: #c3d5e5;
        font-size: 0.84rem;
        line-height: 1.35;
        margin-top: 0.25rem;
      }

      .repository-list {
        display: grid;
        margin-top: 1rem;
      }

      .repository-list article {
        align-items: center;
        border-top: 1px solid rgb(86 166 226 / 20%);
        display: grid;
        gap: 0.8rem;
        grid-template-columns: auto minmax(12rem, 1fr) auto minmax(13rem, auto);
        min-height: 4.45rem;
        padding: 0.62rem 0;
      }

      .repository-list h3 {
        color: #f7fbff;
        font-size: 1rem;
      }

      .repository-list p {
        color: #9fb7c9;
        font-size: 0.76rem;
        line-height: 1.3;
        margin-top: 0.18rem;
      }

      .repository-list em {
        border-radius: 0.35rem;
        color: #cfffff;
        font-size: 0.72rem;
        font-style: normal;
        padding: 0.22rem 0.45rem;
        white-space: nowrap;
      }

      .repository-list em.green,
      .repository-list em.cyan {
        background: rgb(47 209 130 / 18%);
        color: #77f0a7;
      }

      .repository-list em.gold {
        background: rgb(244 201 87 / 16%);
        color: var(--gold-400);
      }

      .repository-list em.blue {
        background: rgb(49 172 255 / 18%);
        color: #76dcff;
      }

      .repository-list nav {
        display: flex;
        gap: 0.7rem;
        justify-content: end;
      }

      .repository-list nav a {
        color: #d7e9f9;
        font-size: 0.78rem;
        text-decoration: none;
        white-space: nowrap;
      }

      .repository-icon.gold,
      .notice-panel.warning > span {
        background: radial-gradient(circle, rgb(94 67 17), rgb(36 28 12));
        border-color: rgb(244 201 87 / 58%);
        color: var(--gold-400);
      }

      .repository-icon.green {
        border-color: rgb(75 236 147 / 48%);
        color: #72f2a4;
      }

      .all-repositories {
        background: transparent;
        border: 0;
        display: flex;
        margin: 0.9rem auto 0;
        min-height: auto;
        padding: 0;
      }

      .support-side {
        display: grid;
        gap: 0.9rem;
      }

      .steps-panel {
        padding: 1rem;
      }

      .steps-panel h2 {
        align-items: center;
        display: flex;
        gap: 0.55rem;
      }

      .steps-panel h2::before {
        content: '▱';
        font-family: 'Trebuchet MS', sans-serif;
      }

      .steps-panel ol {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        list-style: none;
        margin: 1.1rem 0 0;
        padding: 0;
        position: relative;
      }

      .steps-panel li {
        display: grid;
        gap: 0.35rem;
        justify-items: center;
        text-align: center;
      }

      .steps-panel li span {
        background: linear-gradient(180deg, #52d8ff, #0d9edf);
        border-radius: 999px;
        color: #041426;
        display: grid;
        font-weight: 900;
        height: 2rem;
        place-items: center;
        width: 2rem;
      }

      .steps-panel strong {
        color: #fff8e8;
        font-size: 0.82rem;
      }

      .steps-panel p {
        color: #b8cbdc;
        font-size: 0.72rem;
        line-height: 1.35;
      }

      .notice-panel {
        align-items: start;
        display: grid;
        gap: 0.9rem;
        grid-template-columns: auto 1fr;
        padding: 1rem;
      }

      .notice-panel strong {
        color: #fff2d6;
        display: block;
      }

      .notice-panel p {
        color: #c6d7e4;
        font-size: 0.82rem;
        line-height: 1.35;
        margin-top: 0.25rem;
      }

      .support-footer {
        align-items: center;
        border-top: 1px solid rgb(244 201 87 / 38%);
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(18rem, 1fr) minmax(24rem, 1fr) auto;
        margin-top: 1.25rem;
        padding: 1rem clamp(1rem, 7vw, 8rem);
      }

      .support-footer > div {
        align-items: center;
        display: flex;
        gap: 0.7rem;
      }

      .support-footer > div > span {
        color: var(--gold-400);
        font-size: 2rem;
      }

      .support-footer p,
      .support-footer small,
      .support-footer a {
        color: #b8cadd;
        font-size: 0.78rem;
      }

      .support-footer strong {
        color: #fff8e8;
        display: block;
        font-size: 0.92rem;
      }

      .support-footer nav {
        display: flex;
        gap: 1.6rem;
        justify-content: center;
      }

      .support-footer a {
        text-decoration: none;
      }

      @media (max-width: 1240px) {
        .support-hero {
          grid-template-columns: 1fr;
        }

        .support-hero,
        .support-workspace,
        .support-footer {
          padding-left: 1rem;
          padding-right: 1rem;
        }

        .support-workspace,
        .support-footer {
          grid-template-columns: 1fr;
        }

        .support-action-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .repository-list article {
          grid-template-columns: auto 1fr;
        }

        .repository-list em,
        .repository-list nav {
          grid-column: 2;
          justify-content: start;
        }

        .support-footer nav {
          justify-content: flex-start;
        }
      }

      @media (max-width: 720px) {
        .support-hero {
          gap: 0.5rem;
          min-height: auto;
          overflow: visible;
          padding: 0.6rem 0.65rem 0.7rem;
        }

        .support-dragon {
          opacity: 0.12;
          width: 100%;
        }

        .steps-panel ol {
          grid-template-columns: 1fr;
        }

        .support-copy h1 {
          font-size: 1.72rem;
          line-height: 0.92;
        }

        .support-copy p {
          font-size: 0.78rem;
          line-height: 1.22;
          margin-top: 0.35rem;
        }

        .support-actions-row {
          display: none;
        }

        .support-action-grid {
          gap: 0.42rem;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          margin-top: 0.1rem;
        }

        .support-action-grid article {
          gap: 0.38rem;
          grid-template-columns: auto 1fr;
          min-height: 4.05rem;
          padding: 0.48rem;
        }

        .support-action-grid article > span {
          font-size: 0.92rem;
          height: 1.9rem;
          width: 1.9rem;
        }

        .support-action-grid h2 {
          font-size: 0.72rem;
        }

        .support-action-grid p {
          font-size: 0.6rem;
          line-height: 1.15;
          margin-top: 0.2rem;
        }

        .support-action-grid i {
          display: none;
        }

        .repository-list nav,
        .support-footer nav {
          display: grid;
        }

        .repository-list nav a {
          justify-content: center;
          width: 100%;
        }

        .repository-list article,
        .notice-panel,
        .repository-panel > header {
          grid-template-columns: 1fr;
        }

        .repository-list em,
        .repository-list nav {
          grid-column: auto;
        }
      }

      @media (max-width: 420px) {
        .support-action-grid {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class SupportPageComponent {
  readonly actions: readonly SupportAction[] = [
    {
      title: 'Explorer les dépôts',
      description: 'Parcourez les projets OpenG7, leurs objectifs et leur état d’avancement.',
      icon: '▤'
    },
    {
      title: 'Signaler un problème',
      description: 'Aidez à améliorer la qualité en signalant un bug ou un comportement inattendu.',
      icon: '!'
    },
    {
      title: 'Proposer une idée',
      description: 'Partagez vos idées d’amélioration, nouvelles fonctionnalités ou cas d’usage.',
      icon: '♢'
    },
    {
      title: 'Contribuer au code',
      description: 'Fork, code, tests et pull requests : chaque contribution compte.',
      icon: '</>'
    }
  ];

  readonly repositories: readonly SupportRepository[] = [
    {
      name: 'OpenG7 Nexus',
      description: 'Noyau de l’écosystème OpenG7. Identité, routage, intégrations et services clés.',
      icon: '◇',
      url: 'https://github.com/OpenG7/openg7-nexus',
      status: 'Actif',
      tone: 'green'
    },
    {
      name: 'Health Supply Corridors',
      description: 'Optimise la disponibilité et la distribution des fournitures médicales critiques.',
      icon: '✚',
      url: 'https://github.com/OpenG7/openg7-health-supply-corridors',
      status: 'En développement',
      tone: 'green'
    },
    {
      name: 'Patient Navigation',
      description: 'Guide les patients dans leurs parcours de soins de manière personnalisée.',
      icon: '♡',
      url: 'https://github.com/OpenG7/openg7-patient-navigation',
      status: 'En développement',
      tone: 'cyan'
    },
    {
      name: 'Clinical Workforce Exchange',
      description: 'Connecte les professionnels de santé aux besoins des établissements.',
      icon: '✦',
      url: 'https://github.com/OpenG7/openg7-clinical-workforce-exchange',
      status: 'Pré-alpha',
      tone: 'gold'
    },
    {
      name: 'Electoral Systems Canada',
      description: 'Infrastructure électorale canadienne pour processus vérifiables et transparents.',
      icon: '◫',
      url: 'https://github.com/OpenG7/openg7-electoral-systems-canada',
      status: 'Pré-alpha',
      tone: 'blue'
    },
    {
      name: 'OpenG7 Social',
      description: 'Composants sociaux et participation citoyenne pour services publics.',
      icon: '◎',
      url: 'https://github.com/OpenG7/openg7-social',
      status: 'Pré-alpha',
      tone: 'gold'
    },
    {
      name: 'OpenG7 GovGraph',
      description: 'Graphe des données gouvernementales et interopérabilité sémantique.',
      icon: '⌘',
      url: 'https://github.com/OpenG7/openg7-govgraph',
      status: 'Actif',
      tone: 'cyan'
    },
    {
      name: 'Migration Flow Engine',
      description: 'Analyse et orchestration des flux migratoires pour des parcours plus fluides.',
      icon: '⌁',
      url: 'https://github.com/OpenG7/openg7-migration-flow-engine',
      status: 'En développement',
      tone: 'blue'
    },
    {
      name: 'Medical Referral Router',
      description: 'Acheminer les demandes vers les bons spécialistes au bon moment.',
      icon: '↬',
      url: 'https://github.com/OpenG7/openg7-medical-referral-router',
      status: 'En développement',
      tone: 'green'
    },
    {
      name: 'OpenG7 Firewall',
      description: 'Pare-feu applicatif et protection des API pour services publics.',
      icon: '◈',
      url: 'https://github.com/OpenG7/openg7-firewall',
      status: 'En développement',
      tone: 'blue'
    },
    {
      name: 'CA: Voter Register & Docs',
      description: 'Registre électoral et documents officiels vérifiables et à jour.',
      icon: '▣',
      url: 'https://github.com/OpenG7/openg7-ca-voter-register-and-docs',
      status: 'Pré-alpha',
      tone: 'cyan'
    },
    {
      name: 'CA: Vehicle Registry',
      description: 'Registre national des véhicules pour des transactions fiables et sécurisées.',
      icon: '▰',
      url: 'https://github.com/OpenG7/openg7-ca-vehicle-registry',
      status: 'Pré-alpha',
      tone: 'blue'
    },
    {
      name: 'CA: Election Day Ops & Audit',
      description: 'Opérations électorales modernes, sécurisées et auditables.',
      icon: '◬',
      url: 'https://github.com/OpenG7/openg7-ca-election-day-ops-and-audit',
      status: 'Pré-alpha',
      tone: 'gold'
    }
  ];

  readonly steps: readonly SupportStep[] = [
    {
      title: 'Explorer',
      description: 'Parcourez les dépôts et lisez les README pour comprendre chaque projet.'
    },
    {
      title: 'Créer une issue',
      description: 'Signalez un bug ou demandez une amélioration via l’onglet Issues.'
    },
    {
      title: 'Proposer une amélioration',
      description: 'Décrivez votre idée, la valeur ajoutée et le contexte.'
    },
    {
      title: 'Ouvrir une pull request',
      description: 'Soumettez votre code ou vos changements pour revue.'
    }
  ];
}