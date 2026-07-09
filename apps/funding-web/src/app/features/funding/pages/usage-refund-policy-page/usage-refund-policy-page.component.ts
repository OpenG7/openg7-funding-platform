import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  inject
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { FundingSeoService } from '../../services/funding-seo.service.js';

interface PolicySection {
  readonly titleKey: string;
  readonly copyKey: string;
  readonly items: readonly string[];
}

@Component({
  selector: 'openg7-usage-refund-policy-page',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe, FundingHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="policy-page">
      <openg7-funding-header></openg7-funding-header>

      <section class="policy-hero" aria-labelledby="policy-title">
        <img
          src="assets/fonds-des-batisseurs-canada-coffre-lumineux.png"
          [alt]="'funding.policyPage.hero.imageAlt' | translate"
        />
        <div class="policy-hero-overlay" aria-hidden="true"></div>
        <article>
          <span>{{ 'funding.policyPage.hero.kicker' | translate }}</span>
          <h1 id="policy-title">
            {{ 'funding.policyPage.hero.title' | translate }}
          </h1>
          <p>{{ 'funding.policyPage.hero.copy' | translate }}</p>
          <small>{{ 'funding.policyPage.hero.updated' | translate }}</small>
          <div class="policy-actions">
            <a [routerLink]="fundPath()" fragment="support">
              {{ 'funding.policyPage.actions.contribute' | translate }}
            </a>
            <a [routerLink]="supportPath()">
              {{ 'funding.policyPage.actions.support' | translate }}
            </a>
          </div>
        </article>
      </section>

      <section class="policy-body" aria-labelledby="policy-intro-title">
        <aside
          class="policy-summary"
          [attr.aria-label]="'funding.policyPage.summary.ariaLabel' | translate"
        >
          <strong>{{ 'funding.policyPage.summary.title' | translate }}</strong>
          <p>{{ 'funding.policyPage.summary.copy' | translate }}</p>
          <a [routerLink]="transparencyPath()">
            {{ 'funding.policyPage.actions.transparency' | translate }}
          </a>
        </aside>

        <div class="policy-sections">
          <header>
            <span>{{ 'funding.policyPage.intro.kicker' | translate }}</span>
            <h2 id="policy-intro-title">
              {{ 'funding.policyPage.intro.title' | translate }}
            </h2>
            <p>{{ 'funding.policyPage.intro.copy' | translate }}</p>
          </header>

          <article
            class="policy-section"
            *ngFor="let section of sections; let index = index"
          >
            <span aria-hidden="true">{{ index + 1 }}</span>
            <div>
              <h3>{{ section.titleKey | translate }}</h3>
              <p>{{ section.copyKey | translate }}</p>
              <ul>
                <li *ngFor="let itemKey of section.items">
                  {{ itemKey | translate }}
                </li>
              </ul>
            </div>
          </article>
        </div>
      </section>

      <section class="policy-contact" aria-labelledby="policy-contact-title">
        <div>
          <span>{{ 'funding.policyPage.contact.kicker' | translate }}</span>
          <h2 id="policy-contact-title">
            {{ 'funding.policyPage.contact.title' | translate }}
          </h2>
          <p>{{ 'funding.policyPage.contact.copy' | translate }}</p>
        </div>
        <a [routerLink]="supportPath()">
          {{ 'funding.policyPage.actions.support' | translate }}
        </a>
      </section>
    </main>
  `,
  styles: [
    `
      .policy-page {
        background: #f4f7f2;
        color: #142233;
        min-height: 100vh;
      }

      .policy-hero {
        background: #102033;
        display: grid;
        min-height: 31rem;
        overflow: hidden;
        position: relative;
      }

      .policy-hero img,
      .policy-hero-overlay,
      .policy-hero article {
        grid-area: 1 / 1;
      }

      .policy-hero img {
        height: 100%;
        object-fit: cover;
        width: 100%;
      }

      .policy-hero-overlay {
        background: linear-gradient(90deg, rgb(10 20 35 / 96%), rgb(23 84 102 / 54%), rgb(10 20 35 / 78%));
      }

      .policy-hero article {
        align-self: end;
        color: #f9fbff;
        max-width: 54rem;
        padding: clamp(6rem, 12vw, 10rem) clamp(1rem, 5vw, 4rem) 3rem;
        position: relative;
        z-index: 1;
      }

      .policy-hero span,
      .policy-sections header span,
      .policy-contact span {
        color: #f4c957;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.78rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .policy-hero h1 {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(2.25rem, 6vw, 4.8rem);
        line-height: 1;
        margin: 0.65rem 0 1rem;
        max-width: 48rem;
      }

      .policy-hero p,
      .policy-hero small,
      .policy-summary p,
      .policy-sections p,
      .policy-section li,
      .policy-contact p {
        font-family: 'Trebuchet MS', Arial, sans-serif;
        line-height: 1.58;
      }

      .policy-hero p {
        color: #d9eaf4;
        font-size: 1.05rem;
        margin: 0;
        max-width: 44rem;
      }

      .policy-hero small {
        color: #a9c0cf;
        display: block;
        margin-top: 0.8rem;
      }

      .policy-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 1.45rem;
      }

      .policy-actions a,
      .policy-summary a,
      .policy-contact a {
        align-items: center;
        border-radius: 0.5rem;
        display: inline-flex;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-weight: 900;
        justify-content: center;
        min-height: 2.65rem;
        padding: 0 0.95rem;
        text-decoration: none;
      }

      .policy-actions a:first-child,
      .policy-contact a {
        background: #f4c957;
        color: #102033;
      }

      .policy-actions a:last-child,
      .policy-summary a {
        border: 1px solid rgb(34 94 118 / 34%);
        color: #225e76;
      }

      .policy-actions a:last-child {
        border-color: rgb(217 234 244 / 46%);
        color: #f9fbff;
      }

      .policy-body {
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(15rem, 0.32fr) minmax(0, 1fr);
        padding: clamp(1rem, 4vw, 3rem);
      }

      .policy-summary,
      .policy-sections header,
      .policy-section,
      .policy-contact {
        background: #ffffff;
        border: 1px solid rgb(34 94 118 / 15%);
        border-radius: 0.5rem;
        box-shadow: 0 16px 34px rgb(16 32 51 / 8%);
      }

      .policy-summary {
        align-self: start;
        display: grid;
        gap: 0.8rem;
        padding: 1rem;
      }

      .policy-summary strong {
        color: #102033;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 1.3rem;
      }

      .policy-summary p,
      .policy-sections p,
      .policy-contact p {
        color: #415263;
        margin: 0;
      }

      .policy-sections {
        display: grid;
        gap: 0.85rem;
      }

      .policy-sections header {
        padding: clamp(1rem, 3vw, 1.5rem);
      }

      .policy-sections h2,
      .policy-contact h2 {
        color: #102033;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(1.65rem, 3vw, 2.45rem);
        margin: 0.35rem 0 0.55rem;
      }

      .policy-section {
        display: grid;
        gap: 1rem;
        grid-template-columns: auto minmax(0, 1fr);
        padding: clamp(1rem, 2.5vw, 1.35rem);
      }

      .policy-section > span {
        align-items: center;
        background: #225e76;
        border-radius: 999px;
        color: #ffffff;
        display: inline-flex;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-weight: 900;
        height: 2rem;
        justify-content: center;
        width: 2rem;
      }

      .policy-section h3 {
        color: #102033;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 1rem;
        margin: 0 0 0.4rem;
      }

      .policy-section ul {
        display: grid;
        gap: 0.45rem;
        margin: 0.75rem 0 0;
        padding-left: 1.1rem;
      }

      .policy-section li::marker {
        color: #225e76;
      }

      .policy-contact {
        align-items: center;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
        margin: 0 clamp(1rem, 4vw, 3rem) clamp(1rem, 4vw, 3rem);
        padding: clamp(1rem, 3vw, 1.5rem);
      }

      @media (max-width: 860px) {
        .policy-body,
        .policy-section {
          grid-template-columns: 1fr;
        }

        .policy-contact {
          align-items: start;
          flex-direction: column;
        }
      }
    `
  ]
})
export class UsageRefundPolicyPageComponent {
  private readonly i18n = inject(FundingI18nService);
  private readonly injector = inject(Injector);
  private readonly seo = inject(FundingSeoService);

  readonly fundPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs')
  );
  readonly supportPath = computed(() => this.i18n.localizedPath('/support'));
  readonly transparencyPath = computed(() =>
    this.i18n.localizedPath('/fonds-des-batisseurs/transparence')
  );

  readonly sections: readonly PolicySection[] = [
    {
      titleKey: 'funding.policyPage.sections.nature.title',
      copyKey: 'funding.policyPage.sections.nature.copy',
      items: [
        'funding.policyPage.sections.nature.items.nonCharity',
        'funding.policyPage.sections.nature.items.noReceipt',
        'funding.policyPage.sections.nature.items.voluntary'
      ]
    },
    {
      titleKey: 'funding.policyPage.sections.payments.title',
      copyKey: 'funding.policyPage.sections.payments.copy',
      items: [
        'funding.policyPage.sections.payments.items.stripe',
        'funding.policyPage.sections.payments.items.currency',
        'funding.policyPage.sections.payments.items.confirmation'
      ]
    },
    {
      titleKey: 'funding.policyPage.sections.refunds.title',
      copyKey: 'funding.policyPage.sections.refunds.copy',
      items: [
        'funding.policyPage.sections.refunds.items.request',
        'funding.policyPage.sections.refunds.items.review',
        'funding.policyPage.sections.refunds.items.timing'
      ]
    },
    {
      titleKey: 'funding.policyPage.sections.disputes.title',
      copyKey: 'funding.policyPage.sections.disputes.copy',
      items: [
        'funding.policyPage.sections.disputes.items.stripe',
        'funding.policyPage.sections.disputes.items.visibility',
        'funding.policyPage.sections.disputes.items.records'
      ]
    },
    {
      titleKey: 'funding.policyPage.sections.sponsorship.title',
      copyKey: 'funding.policyPage.sections.sponsorship.copy',
      items: [
        'funding.policyPage.sections.sponsorship.items.review',
        'funding.policyPage.sections.sponsorship.items.followup',
        'funding.policyPage.sections.sponsorship.items.noAutomaticPublication'
      ]
    },
    {
      titleKey: 'funding.policyPage.sections.visibility.title',
      copyKey: 'funding.policyPage.sections.visibility.copy',
      items: [
        'funding.policyPage.sections.visibility.items.approval',
        'funding.policyPage.sections.visibility.items.removal',
        'funding.policyPage.sections.visibility.items.feed'
      ]
    },
    {
      titleKey: 'funding.policyPage.sections.privacy.title',
      copyKey: 'funding.policyPage.sections.privacy.copy',
      items: [
        'funding.policyPage.sections.privacy.items.publicData',
        'funding.policyPage.sections.privacy.items.privateData',
        'funding.policyPage.sections.privacy.items.aggregate'
      ]
    }
  ];

  constructor() {
    this.seo.bind(
      {
        titleKey: 'funding.seo.policy.title',
        descriptionKey: 'funding.seo.policy.description',
        path: '/politique-utilisation-remboursement',
        imagePath: '/assets/fonds-des-batisseurs-canada-coffre-lumineux.png'
      },
      this.injector
    );
  }
}
