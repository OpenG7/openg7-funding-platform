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

interface AboutFoundation {
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly actionKey: string;
  readonly path: string;
  readonly fragment?: string;
}

@Component({
  selector: 'openg7-funding-about-page',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, FundingHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="about-page">
      <openg7-funding-header></openg7-funding-header>

      <section class="about-hero" aria-labelledby="about-title">
        <img
          class="about-hero-image"
          data-og7="about-hero-image"
          src="assets/fonds-des-batisseurs-dragon-coffre-lumineux-960.webp"
          srcset="
            assets/fonds-des-batisseurs-dragon-coffre-lumineux-960.webp   960w,
            assets/fonds-des-batisseurs-dragon-coffre-lumineux-1672.webp 1672w
          "
          sizes="(max-width: 1530px) 100vw, 1530px"
          width="1672"
          height="941"
          fetchpriority="high"
          decoding="async"
          [alt]="'funding.aboutPage.hero.imageAlt' | translate"
        />
        <div class="about-hero-vignette" aria-hidden="true"></div>

        <div class="about-copy">
          <a
            class="about-emblem"
            [routerLink]="homePath()"
            [attr.aria-label]="'funding.aboutPage.hero.homeAria' | translate"
          >
            <span></span>
          </a>
          <h1 id="about-title">
            {{ 'funding.aboutPage.hero.title' | translate
            }}<strong>OpenG7</strong>
          </h1>
          <div class="about-rule" aria-hidden="true"><span></span></div>
          <p class="about-statement">
            {{ 'funding.aboutPage.hero.statement' | translate }}
            <strong>{{
              'funding.aboutPage.hero.statementStrong' | translate
            }}</strong>
          </p>
          <p class="about-description">
            {{ 'funding.aboutPage.hero.description' | translate }}
          </p>

          <nav
            class="about-actions"
            [attr.aria-label]="'funding.aboutPage.hero.actionsAria' | translate"
          >
            <a
              class="primary"
              [routerLink]="homePath()"
              fragment="funding-purpose"
            >
              <span aria-hidden="true">▤</span>
              {{ 'funding.aboutPage.actions.understandFund' | translate }}
            </a>
            <a [routerLink]="ecosystemPath()">
              <span aria-hidden="true">⌖</span>
              {{ 'funding.aboutPage.actions.discover' | translate }}
            </a>
            <a [routerLink]="homePath()" fragment="support">
              <span aria-hidden="true">♡</span>
              {{ 'funding.aboutPage.actions.support' | translate }}
            </a>
          </nav>
        </div>
      </section>

      <section
        class="about-mission about-section"
        aria-labelledby="about-mission-title"
      >
        <header>
          <span class="about-kicker">{{
            'funding.aboutPage.mission.eyebrow' | translate
          }}</span>
          <h2 id="about-mission-title">
            {{ 'funding.aboutPage.mission.title' | translate }}
          </h2>
          <p>{{ 'funding.aboutPage.mission.description' | translate }}</p>
        </header>
        <div class="about-mission-grid">
          <article>
            <h3>{{ 'funding.aboutPage.mission.fund.title' | translate }}</h3>
            <p>
              {{ 'funding.aboutPage.mission.fund.description' | translate }}
            </p>
            <ul>
              <li *ngFor="let useKey of fundingUseKeys">
                {{ useKey | translate }}
              </li>
            </ul>
          </article>
          <article>
            <h3>{{ 'funding.aboutPage.mission.team.title' | translate }}</h3>
            <p>
              {{ 'funding.aboutPage.mission.team.description' | translate }}
            </p>
            <a class="about-text-link" [routerLink]="supportPath()">
              {{ 'funding.aboutPage.actions.askQuestion' | translate }}
              <span aria-hidden="true">→</span>
            </a>
          </article>
        </div>
      </section>

      <section
        class="about-foundations"
        aria-labelledby="about-foundations-title"
      >
        <header>
          <span>{{ 'funding.aboutPage.foundations.eyebrow' | translate }}</span>
          <h2 id="about-foundations-title">
            {{ 'funding.aboutPage.foundations.title' | translate }}
          </h2>
        </header>
        <div>
          <article *ngFor="let foundation of foundations()">
            <h3>{{ foundation.titleKey | translate }}</h3>
            <p>{{ foundation.descriptionKey | translate }}</p>
            <a
              class="about-text-link"
              [routerLink]="foundation.path"
              [fragment]="foundation.fragment"
            >
              {{ foundation.actionKey | translate }}
              <span aria-hidden="true">→</span>
            </a>
          </article>
        </div>
      </section>

      <section
        class="about-accountability about-section"
        aria-labelledby="about-accountability-title"
      >
        <header>
          <span class="about-kicker">{{
            'funding.aboutPage.accountability.eyebrow' | translate
          }}</span>
          <h2 id="about-accountability-title">
            {{ 'funding.aboutPage.accountability.title' | translate }}
          </h2>
        </header>
        <div class="about-mission-grid">
          <article>
            <h3>
              {{
                'funding.aboutPage.accountability.finances.title' | translate
              }}
            </h3>
            <p>
              {{
                'funding.aboutPage.accountability.finances.description'
                  | translate
              }}
            </p>
          </article>
          <article>
            <h3>
              {{
                'funding.aboutPage.accountability.recognition.title' | translate
              }}
            </h3>
            <p>
              {{
                'funding.aboutPage.accountability.recognition.description'
                  | translate
              }}
            </p>
            <a class="about-text-link" [routerLink]="sponsorsPath()">
              {{ 'funding.aboutPage.actions.sponsors' | translate }}
              <span aria-hidden="true">→</span>
            </a>
          </article>
        </div>
      </section>

      <section
        class="about-next about-section"
        aria-labelledby="about-next-title"
      >
        <h2 id="about-next-title">
          {{ 'funding.aboutPage.next.title' | translate }}
        </h2>
        <p>{{ 'funding.aboutPage.next.description' | translate }}</p>
        <div class="about-actions">
          <a class="primary" [routerLink]="homePath()" fragment="support">
            {{ 'funding.aboutPage.actions.contribute' | translate }}
            <span aria-hidden="true">→</span>
          </a>
          <a [routerLink]="transparencyPath()">
            {{ 'funding.aboutPage.actions.transparency' | translate }}
          </a>
        </div>
      </section>

      <footer class="about-footer">
        <a [routerLink]="homePath()">{{ 'funding.brand.title' | translate }}</a>
        <nav
          [attr.aria-label]="'funding.aboutPage.footer.ariaLabel' | translate"
        >
          <a [routerLink]="supportPath()">{{
            'funding.aboutPage.footer.help' | translate
          }}</a>
          <a [routerLink]="policyPath()">{{
            'funding.aboutPage.footer.policy' | translate
          }}</a>
        </nav>
      </footer>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .about-page {
        background: var(--surface-page);
        border: 1px solid var(--border-color);
        box-shadow: 0 8px 24px rgb(41 51 46 / 7%);
        margin: 0 auto;
        max-width: 1530px;
        min-height: 100dvh;
        overflow: hidden;
        position: relative;
      }

      .about-hero {
        align-items: center;
        display: flex;
        min-height: 28rem;
        overflow: hidden;
        padding: 3rem clamp(1rem, 4vw, 3.5rem);
        position: relative;
      }

      .about-hero-image {
        height: 100%;
        inset: 0;
        object-fit: cover;
        object-position: center bottom;
        position: absolute;
        width: 100%;
      }

      .about-hero-vignette {
        background:
          linear-gradient(
            90deg,
            var(--surface-page) 0%,
            color-mix(in srgb, var(--surface-page) 97%, transparent) 38%,
            color-mix(in srgb, var(--surface-page) 90%, transparent) 68%,
            color-mix(in srgb, var(--surface-page) 25%, transparent)
          ),
          linear-gradient(180deg, transparent 60%, var(--surface-page));
        inset: 0;
        position: absolute;
      }

      .about-copy {
        max-width: 46rem;
        position: relative;
        z-index: 1;
      }

      .about-section {
        padding: 2.5rem clamp(1rem, 4vw, 3.5rem);
      }

      .about-kicker {
        color: var(--color-gold);
        font:
          900 0.875rem 'Segoe UI',
          sans-serif;
        text-transform: uppercase;
      }

      .about-section h2 {
        font-size: clamp(1.6rem, 3vw, 2rem);
        line-height: 1.25;
        margin: 0.5rem 0 1rem;
      }

      .about-section h3 {
        font-size: 1.2rem;
        margin: 0 0 0.75rem;
      }

      .about-section p,
      .about-section li {
        color: var(--text-soft);
        font:
          1rem/1.65 'Segoe UI',
          sans-serif;
        max-width: 70ch;
      }

      .about-mission-grid {
        display: grid;
        gap: 2rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-top: 2rem;
      }

      .about-mission-grid ul {
        padding-left: 1.25rem;
      }

      .about-mission-grid li + li {
        margin-top: 0.4rem;
      }

      .about-text-link {
        color: var(--color-gold);
        display: inline-block;
        font:
          700 0.95rem/1.5 'Segoe UI',
          sans-serif;
        padding: 0.75rem 0;
        text-underline-offset: 0.25rem;
      }

      .about-text-link span {
        margin-left: 0.3rem;
      }

      .about-next {
        background: var(--surface-subtle);
        border-block: 1px solid var(--border-color);
      }

      .about-next .about-actions {
        margin-top: 1.25rem;
      }

      .about-footer {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 1rem 2rem;
        justify-content: space-between;
        padding: 1.5rem clamp(1rem, 4vw, 3.5rem);
      }

      .about-footer nav {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1.5rem;
      }

      .about-footer a {
        color: var(--color-primary);
        font:
          0.95rem/1.5 'Segoe UI',
          sans-serif;
        padding: 0.65rem 0;
        text-underline-offset: 0.25rem;
      }

      .about-emblem {
        border: 2px solid var(--border-color);
        border-radius: 999px;
        display: grid;
        height: 3.5rem;
        margin-bottom: 1.5rem;
        place-items: center;
        position: relative;
        text-decoration: none;
        width: 3.5rem;
      }

      .about-emblem::before {
        background: #ff3424;
        clip-path: polygon(
          50% 0,
          62% 32%,
          95% 24%,
          70% 50%,
          88% 82%,
          50% 66%,
          12% 82%,
          30% 50%,
          5% 24%,
          38% 32%
        );
        content: '';
        height: 0.72rem;
        left: 50%;
        position: absolute;
        top: -0.36rem;
        transform: translateX(-50%);
        width: 0.72rem;
      }

      .about-emblem span {
        border-bottom: 1.1rem solid var(--border-color);
        border-left: 0.68rem solid transparent;
        border-right: 0.68rem solid transparent;
        height: 0;
        position: relative;
        width: 2.5rem;
      }

      .about-emblem span::before,
      .about-emblem span::after {
        background: var(--surface-subtle);
        bottom: -1.3rem;
        content: '';
        height: 2.4rem;
        position: absolute;
        width: 0.12rem;
      }

      .about-emblem span::before {
        left: 0.38rem;
        transform: rotate(-24deg);
      }

      .about-emblem span::after {
        right: 0.38rem;
        transform: rotate(24deg);
      }

      .about-copy h1 {
        color: var(--text-main);
        font-size: clamp(2rem, 4vw, 2.75rem);
        line-height: 1.15;
        margin: 0;
        text-shadow: none;
      }

      .about-copy h1 strong,
      .about-statement strong,
      .about-foundations header span {
        color: var(--color-gold);
      }

      .about-rule {
        background: var(--surface-subtle);
        height: 1px;
        margin: 1.3rem 0 1.35rem;
        max-width: 37rem;
        position: relative;
      }

      .about-rule span {
        background: var(--color-gold);
        border-radius: 999px;
        box-shadow: none;
        display: block;
        height: 0.42rem;
        left: 18rem;
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 0.42rem;
      }

      .about-statement {
        color: var(--text-soft);
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 1.5rem;
        font-weight: 900;
        line-height: 1.25;
        margin: 0;
        max-width: 44rem;
        text-transform: uppercase;
      }

      .about-description {
        color: var(--text-soft);
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 1.05rem;
        line-height: 1.55;
        margin: 1.25rem 0 0;
        max-width: 36rem;
      }

      .about-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.8rem;
        margin-top: 2rem;
      }

      .about-actions a {
        align-items: center;
        background: var(--surface-panel);
        border: 1px solid var(--border-color);
        border-radius: 0.35rem;
        color: var(--color-primary);
        display: inline-flex;
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 0.95rem;
        font-weight: 900;
        gap: 0.62rem;
        min-height: 2.75rem;
        padding: 0 0.95rem;
        text-decoration: none;
        text-transform: none;
      }

      .about-actions a.primary {
        background: var(--color-primary);
        border-color: var(--color-primary);
        color: var(--on-primary);
      }

      .about-actions span {
        border: 1px solid currentColor;
        border-radius: 999px;
        display: grid;
        font-size: 1.1rem;
        height: 1.55rem;
        line-height: 1.25;
        place-items: center;
        width: 1.55rem;
      }

      .about-foundations {
        background: var(--surface-page);
        border-top: 1px solid var(--border-color);
        display: grid;
        gap: 1rem;
        padding: 2.5rem clamp(1rem, 4vw, 3.5rem);
      }

      .about-foundations header h2 {
        font-size: 1.7rem;
        line-height: 1.25;
        margin: 0.25rem 0 0;
      }

      .about-foundations header span {
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 0.875rem;
        font-weight: 900;
        text-transform: uppercase;
      }

      .about-foundations > div {
        display: grid;
        gap: 1.5rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .about-foundations article {
        background: var(--surface-page);
        border: 1px solid var(--border-color);
        border-radius: 0.62rem;
        box-shadow: 0 8px 24px rgb(41 51 46 / 7%);
        display: flex;
        flex-direction: column;
        padding: 1.25rem;
      }

      .about-foundations .about-text-link {
        margin-top: auto;
      }

      .about-foundations h3 {
        color: var(--text-main);
        font-size: 1rem;
        margin: 0;
      }

      .about-foundations p {
        color: var(--text-soft);
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 0.95rem;
        line-height: 1.6;
        margin: 0.6rem 0 0.5rem;
      }

      @media (max-width: 1240px) {
        .about-hero {
          min-height: 36rem;
          padding-top: 4rem;
        }

        .about-foundations {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 860px) {
        .about-hero {
          align-items: center;
          min-height: max(34rem, calc(100dvh - 4rem));
          padding: 4rem 1rem 2rem;
        }

        .about-hero-image {
          object-position: 64% center;
        }

        .about-hero-vignette {
          background: linear-gradient(
            color-mix(in srgb, var(--surface-page) 94%, transparent),
            color-mix(in srgb, var(--surface-page) 98%, transparent)
          );
        }

        .about-emblem {
          height: 3.9rem;
          margin-bottom: 1.5rem;
          width: 3.9rem;
        }

        .about-copy h1 {
          font-size: 2.75rem;
        }

        .about-statement {
          font-size: 1.1rem;
        }

        .about-description {
          font-size: 0.95rem;
        }

        .about-actions,
        .about-mission-grid,
        .about-foundations > div {
          grid-template-columns: 1fr;
        }

        .about-actions {
          display: grid;
        }

        .about-actions a {
          justify-content: center;
        }
      }

      @media (max-width: 560px) {
        .about-copy h1 {
          font-size: 2.42rem;
        }

        .about-rule span {
          left: 62%;
        }
      }

      @media (max-height: 560px) and (max-width: 900px) {
        .about-hero {
          align-items: start;
          min-height: 100dvh;
          padding-bottom: 1rem;
          padding-top: 1.2rem;
        }

        .about-emblem {
          height: 2.8rem;
          margin-bottom: 0.7rem;
          width: 2.8rem;
        }

        .about-copy h1 {
          font-size: 2.45rem;
        }

        .about-rule {
          margin: 0.68rem 0;
        }

        .about-statement {
          font-size: 0.92rem;
        }

        .about-description {
          font-size: 0.88rem;
          line-height: 1.4;
          margin-top: 0.65rem;
        }

        .about-actions {
          gap: 0.5rem;
          margin-top: 0.85rem;
        }

        .about-actions a {
          font-size: 0.875rem;
          min-height: 2.75rem;
          padding: 0 0.7rem;
        }

        .about-actions span {
          height: 1.32rem;
          width: 1.32rem;
        }
      }
    `
  ]
})
export class FundingAboutPageComponent {
  private readonly i18n = inject(FundingI18nService);
  private readonly injector = inject(Injector);
  private readonly seo = inject(FundingSeoService);

  readonly homePath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs')
  );
  readonly ecosystemPath = computed(() =>
    this.i18n.localizedPath('/ecosystem')
  );
  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );
  readonly buildersPath = computed(() =>
    this.i18n.localizedPath('/batisseurs')
  );
  readonly sponsorsPath = computed(() =>
    this.i18n.localizedPath('/commanditaires')
  );
  readonly supportPath = computed(() => this.i18n.localizedPath('/support'));
  readonly policyPath = computed(() =>
    this.i18n.localizedPath('/politique-utilisation-remboursement')
  );

  readonly fundingUseKeys = [
    'funding.aboutPage.mission.fund.uses.hosting',
    'funding.aboutPage.mission.fund.uses.development',
    'funding.aboutPage.mission.fund.uses.maintenance'
  ] as const;

  constructor() {
    this.seo.bind(
      {
        titleKey: 'funding.seo.about.title',
        descriptionKey: 'funding.seo.about.description',
        path: '/fonds-des-batisseurs/a-propos',
        imagePath: '/assets/fonds-des-batisseurs-dragon-coffre-lumineux.png'
      },
      this.injector
    );
  }

  readonly foundations = computed<readonly AboutFoundation[]>(() => [
    {
      titleKey: 'funding.aboutPage.foundations.items.infrastructure.title',
      descriptionKey:
        'funding.aboutPage.foundations.items.infrastructure.description',
      actionKey: 'funding.aboutPage.actions.platforms',
      path: this.ecosystemPath(),
      fragment: 'platforms'
    },
    {
      titleKey: 'funding.aboutPage.foundations.items.transparency.title',
      descriptionKey:
        'funding.aboutPage.foundations.items.transparency.description',
      actionKey: 'funding.aboutPage.actions.registry',
      path: this.transparencyPath()
    },
    {
      titleKey: 'funding.aboutPage.foundations.items.impact.title',
      descriptionKey: 'funding.aboutPage.foundations.items.impact.description',
      actionKey: 'funding.aboutPage.actions.builders',
      path: this.buildersPath()
    }
  ]);
}
