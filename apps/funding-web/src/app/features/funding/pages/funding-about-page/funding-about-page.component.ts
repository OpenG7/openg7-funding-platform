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
  styleUrl: './funding-about-page.component.css'
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
