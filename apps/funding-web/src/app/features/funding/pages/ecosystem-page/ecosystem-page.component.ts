import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  inject
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';

interface EcosystemPlatform {
  readonly id: number;
  readonly name: string;
  readonly family: string;
  readonly description: string;
  readonly asset: string;
  readonly repositoryUrl: string;
}

interface EcosystemFamily {
  readonly name: string;
  readonly detail: string;
  readonly icon: string;
  readonly tone: 'cyan' | 'green' | 'gold' | 'violet' | 'orange' | 'blue';
}

interface ArchitectureItem {
  readonly label: string;
  readonly icon: string;
}

interface DevelopmentRow {
  readonly label: string;
  readonly progress: number;
  readonly status: 'Termine' | 'En cours';
}

@Component({
  selector: 'openg7-ecosystem-page',
  standalone: true,
  imports: [CommonModule, RouterLink, FundingHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="ecosystem-page">
      <openg7-funding-header></openg7-funding-header>

      <section class="ecosystem-hero" aria-labelledby="ecosystem-title">
        <img
          class="ecosystem-hero-image"
          src="assets/fonds-des-batisseurs-canada-coffre-lumineux.png"
          alt="Carte numérique du Canada au-dessus d'une ville connectée"
        />
        <div class="ecosystem-hero-overlay" aria-hidden="true"></div>

        <div class="ecosystem-hero-copy">
          <h1 id="ecosystem-title">L’écosystème <strong>OpenG7</strong></h1>
          <p class="ecosystem-lead">
            Treize plateformes. Des fondations partagées. Une infrastructure
            ouverte pour mieux relier le Canada.
          </p>
          <div class="ecosystem-actions">
            <a class="primary" routerLink="/ecosystem" fragment="platforms"
              >Explorer les plateformes <span aria-hidden="true">→</span></a
            >
            <a routerLink="/ecosystem" fragment="connections"
              >Voir les connexions</a
            >
            <a class="gold" routerLink="/" fragment="support"
              >Soutenir l’écosystème</a
            >
          </div>
        </div>

        <dl class="ecosystem-stats" aria-label="Résumé de l'écosystème">
          <div>
            <dt>13</dt>
            <dd>Plateformes</dd>
          </div>
          <div>
            <dt>6</dt>
            <dd>Familles</dd>
          </div>
          <div>
            <dt>1</dt>
            <dd>Infrastructure partagée</dd>
          </div>
          <div>
            <dt>∞</dt>
            <dd>Possibilités</dd>
          </div>
        </dl>
      </section>

      <section class="ecosystem-map-panel" aria-labelledby="map-title">
        <article class="map-intro">
          <h2 id="map-title">Carte interactive de l’écosystème</h2>
          <p>
            OpenG7 organise treize plateformes interconnectées autour de six
            grandes familles pour générer des services meilleurs, plus rapides
            et plus inclusifs pour tous les Canadiens.
          </p>
          <a routerLink="/ecosystem" fragment="connections"
            >Explorer la carte complète <span aria-hidden="true">↗</span></a
          >
        </article>

        <div
          class="network-board"
          aria-label="Connexions entre les plateformes OpenG7"
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
              <strong>Économie<br />et mobilité</strong>
            </article>
            <article class="family-orb green">
              <span aria-hidden="true">♥</span>
              <strong>Santé</strong>
            </article>
            <article class="family-orb blue">
              <span aria-hidden="true">▦</span>
              <strong>Gouvernance<br />et démocratie</strong>
            </article>
          </div>

          <article class="network-core">
            <span aria-hidden="true">⌬</span>
            <strong>OpenG7</strong>
          </article>

          <div class="family-column right">
            <article class="family-orb gold">
              <span aria-hidden="true">●</span>
              <strong>Société</strong>
            </article>
            <article class="family-orb orange">
              <span aria-hidden="true">▣</span>
              <strong>Sécurité</strong>
            </article>
            <article class="family-orb violet">
              <span aria-hidden="true">$</span>
              <strong>Financement</strong>
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
        <h2 id="platforms-title">Les 13 plateformes</h2>
        <div class="platform-grid">
          <article class="platform-card" *ngFor="let platform of platforms">
            <img [src]="platform.asset" [alt]="platform.name" />
            <div>
              <span>{{ platformNumber(platform.id) }}</span>
              <h3>{{ platform.name }}</h3>
              <em>{{ platform.family }}</em>
              <p>{{ platform.description }}</p>
              <a
                [href]="platform.repositoryUrl"
                target="_blank"
                rel="noreferrer"
                >Explorer <span aria-hidden="true">→</span></a
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
          <h2 id="architecture-title">Une architecture partagée</h2>
          <p>
            OpenG7 repose sur un socle commun qui réduit les coûts, accélère la
            livraison et garantit l’interopérabilité.
          </p>
          <div class="architecture-items">
            <article *ngFor="let item of architectureItems">
              <span aria-hidden="true">{{ item.icon }}</span>
              <strong>{{ item.label }}</strong>
            </article>
          </div>
          <div
            class="platform-dots"
            aria-label="Les 13 plateformes reliées au socle commun"
          >
            <span *ngFor="let platform of platforms">{{
              platformNumber(platform.id)
            }}</span>
          </div>
        </article>

        <article id="connections" class="connections-panel">
          <h2>Les connexions créent la valeur</h2>
          <ul>
            <li *ngFor="let family of families" [class]="family.tone">
              <span aria-hidden="true">{{ family.icon }}</span>
              <div>
                <strong>{{ family.name }}</strong>
                <p>{{ family.detail }}</p>
              </div>
            </li>
          </ul>
        </article>
      </section>

      <section class="journey-panel" aria-labelledby="journey-title">
        <h2 id="journey-title">
          Scénario transversal : un parcours de bout en bout
        </h2>
        <div class="journey-track">
          <article *ngFor="let step of journeySteps; let last = last">
            <span aria-hidden="true">{{ step.icon }}</span>
            <strong>{{ step.name }}</strong>
            <p>{{ step.detail }}</p>
            <i *ngIf="!last" aria-hidden="true">→</i>
          </article>
        </div>
      </section>

      <section class="progress-summary">
        <article class="development-panel">
          <h2>État de développement</h2>
          <div class="development-row" *ngFor="let row of developmentRows">
            <span>{{ row.label }}</span>
            <div aria-hidden="true"><i [style.width.%]="row.progress"></i></div>
            <strong>{{ row.progress }}%</strong>
            <em>{{ row.status }}</em>
          </div>
        </article>

        <aside class="summary-panel" aria-label="Indicateurs de synthèse">
          <dl>
            <div>
              <dt>13</dt>
              <dd>Plateformes</dd>
            </div>
            <div>
              <dt>6</dt>
              <dd>Familles</dd>
            </div>
            <div>
              <dt>1</dt>
              <dd>Vision commune</dd>
            </div>
            <div>
              <dt>100+</dt>
              <dd>Partenaires potentiels</dd>
            </div>
          </dl>
          <ul>
            <li>Interopérabilité <span>Conçue dès le départ</span></li>
            <li>Ouverture <span>Standards ouverts</span></li>
            <li>Confiance <span>Sécurité & transparence</span></li>
            <li>Impact <span>Citoyens d’abord</span></li>
          </ul>
        </aside>
      </section>

      <section class="ecosystem-cta" aria-labelledby="ecosystem-cta-title">
        <h2 id="ecosystem-cta-title">
          Le Canada possède déjà les ressources, les talents et les
          institutions.
        </h2>
        <p>OpenG7 cherche à mieux les relier.</p>
        <div class="ecosystem-actions">
          <a class="primary" routerLink="/ecosystem" fragment="platforms"
            >Explorer les plateformes <span aria-hidden="true">→</span></a
          >
          <a routerLink="/ecosystem" fragment="connections"
            >Voir les connexions</a
          >
          <a class="gold" routerLink="/" fragment="support"
            >Soutenir l’écosystème</a
          >
        </div>
      </section>

      <footer class="ecosystem-footer">
        <a class="ecosystem-brand" routerLink="/" aria-label="Accueil OpenG7">
          <span aria-hidden="true">⌬</span>
          <strong>OpenG7</strong>
        </a>
        <nav aria-label="Liens secondaires">
          <a routerLink="/fonds-des-batisseurs/a-propos">À propos</a>
          <a routerLink="/fonds-des-batisseurs/transparence">Documentation</a>
          <a routerLink="/" fragment="support">Nous contacter</a>
        </nav>
        <small>© 2024 OpenG7. Tous droits réservés.</small>
      </footer>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .ecosystem-page {
        background:
          radial-gradient(
            circle at 76% 2%,
            rgb(26 173 255 / 16%),
            transparent 19rem
          ),
          radial-gradient(
            circle at 18% 40%,
            rgb(244 201 87 / 8%),
            transparent 24rem
          ),
          linear-gradient(180deg, #020a17 0%, #031329 46%, #020a17 100%);
        border: 1px solid rgb(63 161 229 / 22%);
        box-shadow: 0 30px 90px rgb(0 0 0 / 52%);
        color: #f6fbff;
        font-family: 'Trebuchet MS', sans-serif;
        margin: 0 auto;
        max-width: 1530px;
        min-height: 100dvh;
        overflow: hidden;
      }

      .ecosystem-brand {
        align-items: center;
        color: #f6fbff;
        display: inline-flex;
        gap: 0.55rem;
        text-decoration: none;
      }

      .ecosystem-brand span {
        color: var(--gold-400);
        display: grid;
        font-size: 1.8rem;
        place-items: center;
        text-shadow: 0 0 20px rgb(244 201 87 / 70%);
      }

      .ecosystem-brand strong {
        font-size: 1.35rem;
      }

      .ecosystem-footer nav a {
        color: #d6e7f8;
        font-size: 0.78rem;
        font-weight: 700;
        padding: 1.6rem 0 1.45rem;
        position: relative;
        text-decoration: none;
      }

      .ecosystem-hero {
        min-height: 23.5rem;
        overflow: hidden;
        padding: 3.1rem clamp(1rem, 3vw, 3.25rem) 1.3rem;
        position: relative;
      }

      .ecosystem-hero-image {
        filter: saturate(1.14) contrast(1.08);
        height: 100%;
        inset: 0;
        object-fit: cover;
        object-position: center 42%;
        opacity: 0.9;
        position: absolute;
        width: 100%;
      }

      .ecosystem-hero-overlay {
        background:
          linear-gradient(
            90deg,
            rgb(2 10 23 / 96%) 0%,
            rgb(2 10 23 / 78%) 28%,
            rgb(2 10 23 / 28%) 58%,
            rgb(2 10 23 / 58%) 100%
          ),
          linear-gradient(
            180deg,
            rgb(2 10 23 / 10%) 0%,
            rgb(2 10 23 / 12%) 55%,
            rgb(2 10 23 / 92%) 100%
          );
        inset: 0;
        position: absolute;
      }

      .ecosystem-hero-copy,
      .ecosystem-stats {
        position: relative;
        z-index: 1;
      }

      .ecosystem-hero-copy {
        max-width: 35rem;
      }

      h1,
      h2,
      h3,
      p,
      dl {
        margin: 0;
      }

      .ecosystem-hero h1 {
        color: #fff8e8;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(2.6rem, 5vw, 4.4rem);
        line-height: 0.98;
        text-shadow: 0 5px 24px rgb(0 0 0 / 76%);
      }

      .ecosystem-hero h1 strong,
      .ecosystem-cta p,
      .platform-card em,
      .connections-panel li span {
        color: var(--gold-400);
      }

      .ecosystem-lead {
        color: #dceaf7;
        font-size: 1.05rem;
        line-height: 1.45;
        margin-top: 1rem;
        max-width: 34rem;
      }

      .ecosystem-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 1.35rem;
      }

      .ecosystem-actions a,
      .map-intro a,
      .platform-card a {
        align-items: center;
        background: rgb(3 20 40 / 74%);
        border: 1px solid rgb(74 165 236 / 52%);
        border-radius: 0.35rem;
        color: #e8f6ff;
        display: inline-flex;
        font-weight: 900;
        gap: 0.45rem;
        min-height: 2.5rem;
        padding: 0 0.95rem;
        text-decoration: none;
      }

      .ecosystem-actions a.primary {
        background: linear-gradient(180deg, #16a8ff, #0879d6);
        border-color: #6ecbff;
        color: #fff;
      }

      .ecosystem-actions a.gold {
        border-color: rgb(244 201 87 / 72%);
        color: #fff2d6;
      }

      .ecosystem-stats {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(4, minmax(8rem, 1fr));
        margin-top: 2.4rem;
        max-width: 39rem;
      }

      .ecosystem-stats div,
      .ecosystem-map-panel,
      .platform-section,
      .architecture-panel,
      .connections-panel,
      .journey-panel,
      .development-panel,
      .summary-panel {
        background: rgb(3 18 36 / 76%);
        border: 1px solid rgb(71 162 229 / 28%);
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 7%),
          0 16px 38px rgb(0 0 0 / 25%);
      }

      .ecosystem-stats div {
        border-radius: 0.5rem;
        display: grid;
        gap: 0.2rem;
        min-height: 4.6rem;
        padding: 0.75rem 0.9rem;
      }

      .ecosystem-stats dt {
        color: #fff;
        font-size: 1.5rem;
        font-weight: 900;
      }

      .ecosystem-stats dd {
        color: #c6d9eb;
        font-size: 0.78rem;
        margin: 0;
      }

      .ecosystem-map-panel,
      .platform-section,
      .architecture-grid,
      .journey-panel,
      .progress-summary,
      .ecosystem-cta {
        margin-left: clamp(1rem, 3vw, 3.25rem);
        margin-right: clamp(1rem, 3vw, 3.25rem);
      }

      .ecosystem-map-panel {
        border-radius: 0.8rem;
        display: grid;
        gap: 1.2rem;
        grid-template-columns: minmax(15rem, 0.62fr) minmax(34rem, 1.7fr);
        margin-top: 0.9rem;
        padding: 1.15rem;
      }

      .map-intro h2,
      .platform-section h2,
      .architecture-panel h2,
      .connections-panel h2,
      .journey-panel h2,
      .development-panel h2,
      .ecosystem-cta h2 {
        color: #fff8e8;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 1.45rem;
      }

      .map-intro p,
      .architecture-panel p,
      .connections-panel p,
      .journey-panel p {
        color: #bed1e5;
        font-size: 0.86rem;
        line-height: 1.45;
        margin-top: 0.85rem;
      }

      .map-intro a {
        margin-top: 1.2rem;
      }

      .network-board {
        align-items: center;
        display: grid;
        gap: 0.75rem;
        grid-template-columns: minmax(10rem, 1fr) 8.2rem 10rem 8.2rem minmax(
            10rem,
            1fr
          );
        min-height: 22.5rem;
        overflow: hidden;
        position: relative;
      }

      .network-board::before,
      .network-board::after {
        background: radial-gradient(
          circle,
          rgb(44 203 255 / 28%),
          transparent 64%
        );
        content: '';
        height: 21rem;
        left: 50%;
        position: absolute;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 36rem;
      }

      .network-board::after {
        background:
          linear-gradient(
            90deg,
            transparent 0 11%,
            rgb(47 203 255 / 34%) 11% 12%,
            transparent 12% 88%,
            rgb(244 201 87 / 34%) 88% 89%,
            transparent 89%
          ),
          radial-gradient(
            circle,
            transparent 0 38%,
            rgb(81 207 255 / 25%) 39% 40%,
            transparent 41% 100%
          );
        height: 18rem;
        width: 30rem;
      }

      .network-list,
      .family-column,
      .network-core {
        position: relative;
        z-index: 1;
      }

      .network-list {
        display: grid;
        gap: 0.55rem;
      }

      .network-node {
        align-items: center;
        background: rgb(4 24 48 / 86%);
        border: 1px solid rgb(52 179 255 / 38%);
        border-radius: 0.5rem;
        display: grid;
        gap: 0.5rem;
        grid-template-columns: 2.35rem 1fr;
        min-height: 3.1rem;
        padding: 0.35rem;
      }

      .network-list.right .network-node {
        border-color: rgb(244 201 87 / 38%);
      }

      .network-node img {
        border-radius: 0.35rem;
        height: 2.35rem;
        object-fit: cover;
        width: 2.35rem;
      }

      .network-node span {
        color: #94dfff;
        display: block;
        font-size: 0.62rem;
      }

      .network-node strong {
        color: #f7fbff;
        display: block;
        font-size: 0.72rem;
        line-height: 1.05;
      }

      .family-column {
        display: grid;
        gap: 1.25rem;
        justify-items: center;
      }

      .family-orb,
      .network-core {
        align-items: center;
        border-radius: 999px;
        display: grid;
        justify-items: center;
        text-align: center;
      }

      .family-orb {
        background: radial-gradient(
          circle,
          rgb(7 50 82 / 96%),
          rgb(4 23 43 / 92%)
        );
        border: 1px solid rgb(82 205 255 / 58%);
        box-shadow: 0 0 26px rgb(64 201 255 / 26%);
        height: 7rem;
        padding: 0.9rem;
        width: 7rem;
      }

      .family-orb.gold,
      .family-orb.orange,
      .family-orb.violet {
        border-color: rgb(244 201 87 / 62%);
        box-shadow: 0 0 26px rgb(244 201 87 / 20%);
      }

      .family-orb span {
        color: #6fdcff;
        font-size: 1.5rem;
      }

      .family-orb.gold span,
      .family-orb.orange span,
      .family-orb.violet span {
        color: var(--gold-400);
      }

      .family-orb strong {
        color: #eef9ff;
        font-size: 0.82rem;
        line-height: 1.1;
      }

      .network-core {
        background: radial-gradient(
          circle,
          rgb(19 61 78 / 98%),
          rgb(4 24 45 / 96%)
        );
        border: 2px solid rgb(244 201 87 / 55%);
        box-shadow:
          0 0 34px rgb(244 201 87 / 26%),
          inset 0 0 34px rgb(42 197 255 / 22%);
        height: 10rem;
        justify-self: center;
        width: 10rem;
      }

      .network-core span {
        color: var(--gold-400);
        font-size: 2.4rem;
      }

      .network-core strong {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 2rem;
      }

      .platform-section {
        border-radius: 0.8rem;
        margin-top: 0.9rem;
        padding: 1rem;
      }

      .platform-grid {
        display: grid;
        gap: 0.8rem;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        margin-top: 0.9rem;
      }

      .platform-card {
        background: rgb(4 20 39 / 82%);
        border: 1px solid rgb(66 162 232 / 34%);
        border-radius: 0.6rem;
        min-height: 14rem;
        overflow: hidden;
        position: relative;
      }

      .platform-card img {
        height: 6rem;
        object-fit: cover;
        width: 100%;
      }

      .platform-card > div {
        padding: 0.55rem 0.65rem 0.7rem;
      }

      .platform-card span {
        color: #fff;
        font-size: 0.9rem;
        font-weight: 900;
      }

      .platform-card h3 {
        color: #fff8e8;
        font-size: 0.95rem;
        line-height: 1.05;
        margin-top: 0.2rem;
      }

      .platform-card em {
        border: 1px solid rgb(81 205 255 / 32%);
        border-radius: 999px;
        display: inline-flex;
        font-size: 0.62rem;
        font-style: normal;
        margin-top: 0.35rem;
        padding: 0.12rem 0.38rem;
      }

      .platform-card p {
        color: #c9dbea;
        font-size: 0.75rem;
        line-height: 1.35;
        margin-top: 0.4rem;
      }

      .platform-card a {
        border: 0;
        color: #52d6ff;
        font-size: 0.74rem;
        margin-top: 0.45rem;
        min-height: auto;
        padding: 0;
      }

      .architecture-grid,
      .progress-summary {
        display: grid;
        gap: 0.9rem;
        grid-template-columns: minmax(30rem, 1.35fr) minmax(20rem, 0.9fr);
        margin-top: 0.9rem;
      }

      .architecture-panel,
      .connections-panel,
      .journey-panel,
      .development-panel,
      .summary-panel {
        border-radius: 0.8rem;
        padding: 1rem;
      }

      .architecture-items {
        display: grid;
        gap: 0.7rem;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        margin-top: 1rem;
      }

      .architecture-items article {
        background: rgb(7 29 55 / 84%);
        border: 1px solid rgb(72 163 230 / 30%);
        border-radius: 0.5rem;
        display: grid;
        gap: 0.45rem;
        min-height: 5.2rem;
        padding: 0.65rem 0.45rem;
        place-items: center;
        text-align: center;
      }

      .architecture-items span {
        color: #dff5ff;
        font-size: 1.55rem;
      }

      .architecture-items strong {
        color: #dceeff;
        font-size: 0.72rem;
        line-height: 1.12;
      }

      .platform-dots {
        align-items: center;
        border-top: 1px solid rgb(72 163 230 / 24%);
        display: flex;
        gap: 0.5rem;
        justify-content: center;
        margin-top: 1.2rem;
        padding-top: 1rem;
      }

      .platform-dots span {
        border: 1px solid rgb(83 213 255 / 40%);
        border-radius: 999px;
        color: #7adfff;
        display: grid;
        font-size: 0.75rem;
        height: 2rem;
        place-items: center;
        width: 2rem;
      }

      .connections-panel ul {
        display: grid;
        gap: 0.72rem;
        list-style: none;
        margin: 0.9rem 0 0;
        padding: 0;
      }

      .connections-panel li {
        align-items: start;
        display: grid;
        gap: 0.6rem;
        grid-template-columns: auto 1fr;
        position: relative;
      }

      .connections-panel li::after {
        background: linear-gradient(90deg, currentColor, transparent);
        border-radius: 999px;
        content: '';
        height: 2px;
        left: 2.2rem;
        opacity: 0.55;
        position: absolute;
        right: 0;
        top: 1rem;
      }

      .connections-panel li.cyan,
      .connections-panel li.blue {
        color: #50d9ff;
      }

      .connections-panel li.green {
        color: #66f3a0;
      }

      .connections-panel li.violet {
        color: #c69bff;
      }

      .connections-panel li.orange,
      .connections-panel li.gold {
        color: var(--gold-400);
      }

      .connections-panel span {
        border: 1px solid currentColor;
        border-radius: 999px;
        display: grid;
        height: 1.7rem;
        place-items: center;
        width: 1.7rem;
      }

      .connections-panel strong {
        color: #fff8e8;
        display: block;
        font-size: 0.95rem;
      }

      .journey-panel {
        margin-top: 0.9rem;
      }

      .journey-track {
        align-items: start;
        display: grid;
        gap: 0.7rem;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        margin-top: 1rem;
      }

      .journey-track article {
        display: grid;
        gap: 0.35rem;
        justify-items: center;
        min-width: 0;
        position: relative;
        text-align: center;
      }

      .journey-track article > span {
        background: radial-gradient(circle, rgb(11 62 92), rgb(4 21 42));
        border: 1px solid rgb(80 213 255 / 44%);
        border-radius: 999px;
        color: #7be2ff;
        display: grid;
        font-size: 1.6rem;
        height: 4.2rem;
        place-items: center;
        width: 4.2rem;
      }

      .journey-track strong {
        color: #fff8e8;
        font-size: 0.8rem;
        line-height: 1.1;
      }

      .journey-track p {
        font-size: 0.68rem;
        margin: 0;
      }

      .journey-track i {
        color: #fff;
        font-style: normal;
        position: absolute;
        right: -0.75rem;
        top: 1.6rem;
      }

      .development-row {
        align-items: center;
        display: grid;
        gap: 0.7rem;
        grid-template-columns: minmax(9rem, 0.65fr) minmax(9rem, 1fr) auto auto;
        margin-top: 0.75rem;
      }

      .development-row span,
      .development-row strong,
      .development-row em {
        color: #dbefff;
        font-size: 0.82rem;
        font-style: normal;
      }

      .development-row div {
        background: rgb(255 255 255 / 10%);
        border-radius: 999px;
        height: 0.42rem;
        overflow: hidden;
      }

      .development-row i {
        background: linear-gradient(90deg, #1aa9ff, #66f3ff);
        display: block;
        height: 100%;
      }

      .summary-panel dl {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .summary-panel dl div {
        border: 1px solid rgb(74 165 236 / 34%);
        border-radius: 0.5rem;
        padding: 0.75rem 0.5rem;
        text-align: center;
      }

      .summary-panel dt {
        color: #fff;
        font-size: 1.9rem;
        font-weight: 900;
      }

      .summary-panel dd {
        color: #c8dcf0;
        font-size: 0.76rem;
        margin: 0;
      }

      .summary-panel ul {
        display: grid;
        gap: 0.5rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        list-style: none;
        margin: 0.8rem 0 0;
        padding: 0;
      }

      .summary-panel li {
        color: #fff8e8;
        font-size: 0.78rem;
      }

      .summary-panel li span {
        color: #9eb5c8;
        display: block;
        font-size: 0.68rem;
      }

      .ecosystem-cta {
        background:
          linear-gradient(180deg, rgb(2 10 23 / 14%), rgb(2 10 23 / 88%)),
          url('/assets/fonds-des-batisseurs-feuille-erable-lumineuse.png');
        background-position: center 56%;
        background-size: cover;
        border-top: 1px solid rgb(244 201 87 / 26%);
        margin-top: 1rem;
        padding: 2.2rem 1rem 1.6rem;
        text-align: center;
      }

      .ecosystem-cta h2 {
        font-size: 1.85rem;
      }

      .ecosystem-cta p {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 2rem;
        font-weight: 900;
        margin-top: 0.25rem;
      }

      .ecosystem-cta .ecosystem-actions {
        justify-content: center;
      }

      .ecosystem-footer {
        align-items: center;
        background: rgb(2 10 23 / 94%);
        border-top: 1px solid rgb(72 163 230 / 24%);
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(12rem, 0.8fr) minmax(20rem, 1.3fr) auto;
        padding: 0.8rem clamp(1rem, 3vw, 3.25rem);
      }

      .ecosystem-footer nav {
        display: flex;
        gap: 2rem;
        justify-content: center;
      }

      .ecosystem-footer small {
        color: #9eb5c8;
      }

      @media (max-width: 1280px) {
        .ecosystem-map-panel,
        .architecture-grid,
        .progress-summary,
        .ecosystem-footer {
          grid-template-columns: 1fr;
        }

        .ecosystem-footer nav {
          justify-content: flex-start;
          overflow-x: auto;
        }

        .network-board {
          grid-template-columns: 1fr;
        }

        .network-board::before,
        .network-board::after {
          display: none;
        }

        .network-list,
        .family-column {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .family-column,
        .network-list {
          display: grid;
        }

        .network-core {
          order: -1;
        }

        .platform-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .architecture-items,
        .journey-track {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }

      @media (max-width: 760px) {
        .ecosystem-actions,
        .ecosystem-stats,
        .network-list,
        .family-column,
        .platform-grid,
        .architecture-items,
        .journey-track,
        .summary-panel dl,
        .summary-panel ul {
          grid-template-columns: 1fr;
        }

        .ecosystem-actions {
          display: grid;
        }

        .ecosystem-actions a {
          justify-content: center;
          width: 100%;
        }

        .ecosystem-hero {
          min-height: 26rem;
          padding: 1.45rem 1rem 1rem;
        }

        .ecosystem-hero-image {
          object-position: 62% center;
        }

        .ecosystem-map-panel,
        .platform-section,
        .architecture-grid,
        .journey-panel,
        .progress-summary,
        .ecosystem-cta {
          margin-left: 0.75rem;
          margin-right: 0.75rem;
        }

        .development-row {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class EcosystemPageComponent {
  private readonly injector = inject(Injector);
  private readonly seo = inject(FundingSeoService);

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
      family: 'Économie & mobilité',
      description:
        'Point d’accès unifié entre citoyens, entreprises et services publics.',
      asset: 'assets/openg7-nexus-carte-canada-connecte.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-nexus'
    },
    {
      id: 2,
      name: 'Canadian Vehicle Registry',
      family: 'Économie & mobilité',
      description:
        'Registre national des véhicules pour des transactions fiables et sécurisées.',
      asset: 'assets/openg7-canadian-vehicle-registry.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-ca-vehicle-registry'
    },
    {
      id: 3,
      name: 'Migration Flow Engine',
      family: 'Gouvernance & démocratie',
      description:
        'Analyse et orchestration des flux migratoires pour des parcours plus fluides.',
      asset: 'assets/openg7-migration-flow-engine-canada.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-migration-flow-engine'
    },
    {
      id: 4,
      name: 'Patient Navigation',
      family: 'Santé',
      description:
        'Guide les patients dans leurs parcours de soins de manière personnalisée.',
      asset: 'assets/openg7-patient-navigation-canada.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-patient-navigation'
    },
    {
      id: 5,
      name: 'Medical Referral Router',
      family: 'Santé',
      description:
        'Acheminer les demandes vers les bons spécialistes au bon moment.',
      asset: 'assets/openg7-medical-referral-router-canada.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-medical-referral-router'
    },
    {
      id: 6,
      name: 'Clinical Workforce Exchange',
      family: 'Santé',
      description:
        'Connecte les professionnels de santé aux besoins des établissements.',
      asset: 'assets/openg7-clinical-workforce-exchange-canada.png',
      repositoryUrl:
        'https://github.com/OpenG7/openg7-clinical-workforce-exchange'
    },
    {
      id: 7,
      name: 'Health Supply Corridors',
      family: 'Santé',
      description:
        'Optimise la disponibilité et la distribution des fournitures médicales critiques.',
      asset: 'assets/openg7-health-supply-corridors-canada.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-health-supply-corridors'
    },
    {
      id: 8,
      name: 'GovGraph',
      family: 'Gouvernance & démocratie',
      description:
        'Graphe des services et règlements pour une meilleure interopérabilité publique.',
      asset: 'assets/openg7-govgraph-gouvernance-canada.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-govgraph'
    },
    {
      id: 9,
      name: 'Election Day Ops',
      family: 'Gouvernance & démocratie',
      description:
        'Opérations électorales modernes, sécurisées et transparentes.',
      asset: 'assets/openg7-ca-election-day-ops-results-audit.png',
      repositoryUrl:
        'https://github.com/OpenG7/openg7-ca-election-day-ops-and-audit'
    },
    {
      id: 10,
      name: 'Voter Register & Official Docs',
      family: 'Gouvernance & démocratie',
      description:
        'Registre électoral et documents officiels vérifiables et à jour.',
      asset: 'assets/openg7-ca-voter-register-official-docs.png',
      repositoryUrl:
        'https://github.com/OpenG7/openg7-ca-voter-register-and-docs'
    },
    {
      id: 11,
      name: 'OpenG7 Social',
      family: 'Société',
      description:
        'Plateforme d’engagement citoyen et de consultations publiques.',
      asset: 'assets/openg7-social-communautes-connectees-canada.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-social'
    },
    {
      id: 12,
      name: 'OpenG7 Firewall',
      family: 'Sécurité',
      description:
        'Protection des services, des identités et des données à l’échelle du pays.',
      asset: 'assets/openg7-firewall-cybersecurite-canada.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-firewall'
    },
    {
      id: 13,
      name: 'OpenG7 Funding Platform',
      family: 'Financement',
      description:
        'Orchestre les financements publics et les subventions d’impact.',
      asset: 'assets/openg7-funding-platform-dragon-coffre.png',
      repositoryUrl: 'https://github.com/OpenG7/openg7-funding-platform'
    }
  ];

  readonly leftNetworkPlatforms = this.platforms.slice(0, 7);
  readonly rightNetworkPlatforms = this.platforms.slice(7);

  readonly families: readonly EcosystemFamily[] = [
    {
      name: 'Santé',
      detail:
        'Parcours patient intégré, moins d’attente, meilleure coordination.',
      icon: '♡',
      tone: 'green'
    },
    {
      name: 'Données',
      detail:
        'Données fiables, partagées en sécurité, pour de meilleures décisions.',
      icon: '▧',
      tone: 'cyan'
    },
    {
      name: 'Mobilité',
      detail:
        'Déplacements et logistique fluides, services accessibles partout.',
      icon: '⌁',
      tone: 'violet'
    },
    {
      name: 'Sécurité',
      detail: 'Identités protégées, services résilients, confiance accrue.',
      icon: '◈',
      tone: 'orange'
    },
    {
      name: 'Financement',
      detail: 'Ressources mieux allouées, projets à fort impact pour tous.',
      icon: '$',
      tone: 'gold'
    }
  ];

  readonly architectureItems: readonly ArchitectureItem[] = [
    { label: 'Cœur de l’infrastructure et services partagés', icon: '◌' },
    { label: 'Design System', icon: '▣' },
    { label: 'Modèles de données', icon: '▰' },
    { label: 'Sécurité & identité', icon: '▨' },
    { label: 'API Gateway', icon: '⌘' },
    { label: 'i18n localisation', icon: '◎' },
    { label: 'Composants réutilisables', icon: '⚙' },
    { label: 'Documentation & normes', icon: '▤' }
  ];

  readonly journeySteps = [
    {
      name: 'OpenGraph',
      detail: 'Comprendre les règles et services disponibles',
      icon: '⌬'
    },
    {
      name: 'Clinical Workforce Exchange',
      detail: 'Identifier les professionnels disponibles',
      icon: '⌘'
    },
    {
      name: 'Medical Referral Router',
      detail: 'Acheminer la demande au bon spécialiste',
      icon: '▤'
    },
    {
      name: 'Patient Navigation',
      detail: 'Accompagner le patient à chaque étape',
      icon: '♙'
    },
    {
      name: 'Health Supply Corridors',
      detail: 'Assurer les fournitures et traitements',
      icon: '▥'
    },
    {
      name: 'OpenG7 Nexus',
      detail: 'Point d’accès unifié et services centralisés',
      icon: '◇'
    },
    {
      name: 'OpenG7 Firewall',
      detail: 'Sécuriser les accès et les données',
      icon: '◈'
    },
    {
      name: 'OpenG7 Funding Platform',
      detail: 'Financer et soutenir les interventions',
      icon: '◎'
    }
  ];

  readonly developmentRows: readonly DevelopmentRow[] = [
    { label: 'Concepts définis', progress: 100, status: 'Termine' },
    { label: 'Prototypes en cours', progress: 78, status: 'En cours' },
    { label: 'Identités visuelles', progress: 85, status: 'En cours' },
    { label: 'Intégrations réelles', progress: 56, status: 'En cours' },
    { label: 'Services partagés', progress: 72, status: 'En cours' }
  ];

  platformNumber(id: number): string {
    return id.toString().padStart(2, '0');
  }
}
