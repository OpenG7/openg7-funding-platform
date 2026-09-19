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
        background: #020815;
        border: 1px solid rgb(237 190 86 / 30%);
        box-shadow:
          0 0 0 1px rgb(31 157 240 / 12%),
          0 30px 90px rgb(0 0 0 / 55%);
        margin: 0 auto;
        max-width: 1530px;
        min-height: 100dvh;
        overflow: hidden;
        position: relative;
      }

      .about-hero {
        align-items: center;
        display: flex;
        min-height: 38rem;
        overflow: hidden;
        padding: 4rem clamp(1rem, 4vw, 3.5rem);
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
            rgb(2 8 18 / 98%) 0%,
            rgb(2 8 18 / 80%) 30%,
            rgb(2 8 18 / 12%) 58%,
            rgb(2 8 18 / 6%) 100%
          ),
          linear-gradient(
            180deg,
            rgb(2 8 18 / 10%) 0%,
            rgb(2 8 18 / 0%) 62%,
            rgb(2 8 18 / 38%) 100%
          );
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
        color: var(--gold-400);
        font:
          900 0.85rem 'Trebuchet MS',
          sans-serif;
        text-transform: uppercase;
      }

      .about-section h2 {
        font-size: clamp(1.6rem, 3vw, 2rem);
        line-height: 1.2;
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
          1rem/1.65 'Trebuchet MS',
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
        color: var(--gold-400);
        display: inline-block;
        font:
          700 0.95rem/1.5 'Trebuchet MS',
          sans-serif;
        padding: 0.75rem 0;
        text-underline-offset: 0.25rem;
      }

      .about-text-link span {
        margin-left: 0.3rem;
      }

      .about-next {
        background: var(--ink-800);
        border-block: 1px solid var(--panel-border);
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
        color: var(--text-soft);
        font:
          0.95rem/1.5 'Trebuchet MS',
          sans-serif;
        padding: 0.65rem 0;
        text-underline-offset: 0.25rem;
      }

      .about-emblem {
        border: 2px solid rgb(244 201 87 / 72%);
        border-radius: 999px;
        display: grid;
        height: 4.8rem;
        margin-bottom: 2.5rem;
        place-items: center;
        position: relative;
        text-decoration: none;
        width: 4.8rem;
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
        border-bottom: 1.1rem solid rgb(244 201 87 / 88%);
        border-left: 0.68rem solid transparent;
        border-right: 0.68rem solid transparent;
        height: 0;
        position: relative;
        width: 2.5rem;
      }

      .about-emblem span::before,
      .about-emblem span::after {
        background: rgb(244 201 87 / 76%);
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
        color: #fff8e8;
        font-size: 4.4rem;
        line-height: 0.95;
        margin: 0;
        text-shadow: 0 5px 24px rgb(0 0 0 / 76%);
      }

      .about-copy h1 strong,
      .about-statement strong,
      .about-foundations header span {
        color: var(--gold-400);
      }

      .about-rule {
        background: linear-gradient(
          90deg,
          rgb(244 201 87 / 72%),
          rgb(244 201 87 / 20%),
          transparent
        );
        height: 1px;
        margin: 1.3rem 0 1.35rem;
        max-width: 37rem;
        position: relative;
      }

      .about-rule span {
        background: #fff1a8;
        border-radius: 999px;
        box-shadow: 0 0 16px rgb(244 201 87 / 95%);
        display: block;
        height: 0.42rem;
        left: 18rem;
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 0.42rem;
      }

      .about-statement {
        color: #fff4e2;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 1.5rem;
        font-weight: 900;
        line-height: 1.22;
        margin: 0;
        max-width: 44rem;
        text-transform: uppercase;
      }

      .about-description {
        color: #f4ead7;
        font-family: 'Trebuchet MS', sans-serif;
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
        background: rgb(3 18 36 / 54%);
        border: 1px solid rgb(244 201 87 / 62%);
        border-radius: 0.35rem;
        color: #fff3df;
        display: inline-flex;
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 0.95rem;
        font-weight: 900;
        gap: 0.62rem;
        min-height: 3.15rem;
        padding: 0 0.95rem;
        text-decoration: none;
        text-transform: uppercase;
      }

      .about-actions a.primary {
        background: linear-gradient(180deg, #ffe08a 0%, #d99b2e 100%);
        border-color: #ffe69a;
        color: #09111c;
      }

      .about-actions span {
        border: 1px solid currentColor;
        border-radius: 999px;
        display: grid;
        font-size: 1.1rem;
        height: 1.55rem;
        line-height: 1;
        place-items: center;
        width: 1.55rem;
      }

      .about-foundations {
        background: linear-gradient(
          180deg,
          rgb(3 13 28 / 98%),
          rgb(2 8 18 / 100%)
        );
        border-top: 1px solid rgb(221 169 59 / 32%);
        display: grid;
        gap: 1rem;
        padding: 2.5rem clamp(1rem, 4vw, 3.5rem);
      }

      .about-foundations header h2 {
        font-size: 1.7rem;
        line-height: 1;
        margin: 0.25rem 0 0;
      }

      .about-foundations header span {
        font-family: 'Trebuchet MS', sans-serif;
        font-size: 0.78rem;
        font-weight: 900;
        text-transform: uppercase;
      }

      .about-foundations > div {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .about-foundations article {
        background: rgb(3 19 38 / 78%);
        border: 1px solid rgb(102 177 232 / 26%);
        border-radius: 0.62rem;
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 8%),
          0 12px 30px rgb(0 0 0 / 22%);
        display: flex;
        flex-direction: column;
        padding: 1.25rem;
      }

      .about-foundations .about-text-link {
        margin-top: auto;
      }

      .about-foundations h3 {
        color: #fff2d7;
        font-size: 1rem;
        margin: 0;
      }

      .about-foundations p {
        color: #cfdceb;
        font-family: 'Trebuchet MS', sans-serif;
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
          background:
            linear-gradient(
              90deg,
              rgb(2 8 18 / 94%) 0%,
              rgb(2 8 18 / 66%) 58%,
              rgb(2 8 18 / 34%) 100%
            ),
            linear-gradient(180deg, rgb(2 8 18 / 16%) 0%, rgb(2 8 18 / 84%) 82%);
        }

        .about-emblem {
          height: 3.9rem;
          margin-bottom: 1.5rem;
          width: 3.9rem;
        }

        .about-copy h1 {
          font-size: 3rem;
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
          font-size: 0.82rem;
          min-height: 2.45rem;
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
