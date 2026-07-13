import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type {
  SponsorshipBenefitId,
  SponsorshipFollowupDetailsRequest,
  SponsorshipFollowupResponse,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FundingService } from '../../services/funding.service.js';

@Component({
  selector: 'openg7-sponsorship-followup-page',
  standalone: true,
  imports: [CommonModule, RouterLink, FundingHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="followup-shell">
      <openg7-funding-header></openg7-funding-header>

      <section class="followup-hero" aria-labelledby="followup-title">
        <div class="followup-hero-inner">
          <div class="followup-hero-copy">
            <span class="eyebrow">Commandite OpenG7</span>
            <h1 id="followup-title">Suivi de votre commandite</h1>
            <p>
              Votre paiement est reçu. Confirmez maintenant les renseignements
              de votre entreprise afin que l'équipe OpenG7 puisse valider la
              commandite avant toute visibilité publique.
            </p>
          </div>

          <aside
            class="followup-hero-summary"
            *ngIf="followup() as current"
            aria-label="Résumé de la commandite"
          >
            <span>Montant reçu</span>
            <strong>{{ formatMoney(current) }}</strong>
            <div class="reference-summary">
              <span>Référence OpenG7</span>
              <strong class="reference-code">{{
                current.publicReference || 'En attribution'
              }}</strong>
            </div>
            <p>
              {{
                current.detailsSubmitted
                  ? 'Détails reçus, validation en cours.'
                  : 'Détails requis pour poursuivre la validation.'
              }}
            </p>
          </aside>
        </div>
      </section>

      <section class="followup-content">
        <p class="state state-loading" *ngIf="state() === 'loading'">
          Chargement du suivi...
        </p>
        <article class="state-card error" *ngIf="state() === 'error'">
          <span class="eyebrow">Accès au suivi</span>
          <h2>Lien introuvable</h2>
          <p>
            Le lien de suivi est absent, invalide ou expiré. Reprenez le lien
            reçu par courriel ou contactez le support OpenG7.
          </p>
          <a routerLink="/support">Contacter le support</a>
        </article>

        <ng-container *ngIf="followup() as current">
          <dl class="followup-status-panel" aria-label="État de la commandite">
            <div>
              <dt>Référence</dt>
              <dd class="reference-code">
                {{ current.publicReference || 'En attribution' }}
              </dd>
            </div>
            <div>
              <dt>Statut du paiement</dt>
              <dd>{{ paymentLabel(current.paymentStatus) }}</dd>
            </div>
            <div>
              <dt>Validation</dt>
              <dd [class]="statusClass(current.reviewStatus)">
                {{ reviewStatusLabel(current.reviewStatus) }}
              </dd>
            </div>
            <div>
              <dt>Montant</dt>
              <dd>{{ formatMoney(current) }}</dd>
            </div>
            <div>
              <dt>Dernière revue</dt>
              <dd>{{ dateLabel(current.reviewedAt) }}</dd>
            </div>
          </dl>

          <div class="followup-layout">
            <section class="followup-primary">
              <article class="state-card sponsorship-benefits-recap">
                <header class="section-heading">
                  <span class="eyebrow">Avantages réservés</span>
                  <h2>
                    Avantages de votre commandite de {{ formatMoney(current) }}
                  </h2>
                </header>
                <ul>
                  <li *ngFor="let benefit of current.sponsorshipBenefits">
                    {{ benefitLabel(benefit) }}
                  </li>
                </ul>
                <div class="notice-panel">
                  <strong>Publication sous contrôle manuel</strong>
                  <p>
                    Ces avantages restent en attente de publication: la
                    commandite demeure en révision manuelle et les présences sur
                    les réseaux sociaux sont planifiées dans un prochain lot
                    collectif disponible, jamais publiées automatiquement au
                    paiement.
                  </p>
                </div>
                <p class="form-prompt" *ngIf="!current.detailsSubmitted">
                  Transmettez le nom de votre entreprise, votre site web et
                  votre logo ci-dessous pour permettre la révision.
                </p>
              </article>

              <article
                class="state-card review-note approved"
                *ngIf="current.reviewStatus === 'approved'"
              >
                <span class="eyebrow">Validation terminée</span>
                <h2>Commandite acceptée</h2>
                <p>
                  Votre commandite est approuvée. La visibilité publique reste
                  contrôlée par OpenG7 et peut être planifiée séparément.
                </p>
              </article>

              <article
                class="state-card review-note rejected"
                *ngIf="current.reviewStatus === 'rejected'"
              >
                <span class="eyebrow">Validation terminée</span>
                <h2>Commandite refusée</h2>
                <p>
                  La visibilité publique n'est pas activée. Notre équipe peut
                  vous recontacter si une clarification ou un remboursement doit
                  être traité.
                </p>
              </article>
            </section>

            <aside class="review-path" aria-labelledby="review-path-title">
              <span class="eyebrow">Chemin de validation</span>
              <h2 id="review-path-title">Prochaines étapes</h2>
              <ol>
                <li class="done">
                  <span aria-hidden="true">1</span>
                  <strong>Paiement reçu</strong>
                  <p>{{ dateLabel(current.paidAt) }}</p>
                </li>
                <li [class.done]="current.detailsSubmitted">
                  <span aria-hidden="true">2</span>
                  <strong>Détails entreprise</strong>
                  <p>
                    {{
                      current.detailsSubmitted
                        ? 'Informations enregistrées'
                        : 'À compléter ci-dessous'
                    }}
                  </p>
                </li>
                <li [class.active]="current.reviewStatus === 'pending_review'">
                  <span aria-hidden="true">3</span>
                  <strong>Révision OpenG7</strong>
                  <p>{{ reviewStatusLabel(current.reviewStatus) }}</p>
                </li>
                <li [class.done]="current.reviewStatus === 'approved'">
                  <span aria-hidden="true">4</span>
                  <strong>Publication planifiée</strong>
                  <p>Selon le prochain lot disponible.</p>
                </li>
              </ol>
            </aside>
          </div>

          <section
            class="followup-form-panel"
            aria-labelledby="followup-form-title"
          >
            <header>
              <span class="eyebrow">{{
                current.detailsSubmitted ? 'Détails reçus' : 'À compléter'
              }}</span>
              <h2 id="followup-form-title">Informations de commandite</h2>
              <p>
                Ces informations restent privées jusqu'à validation manuelle.
                Aucun logo ni nom d'entreprise n'est publié automatiquement.
              </p>
            </header>

            <form (submit)="$event.preventDefault(); submit()">
              <label>
                <span>Nom de l'entreprise <small>requis</small></span>
                <input
                  type="text"
                  maxlength="200"
                  required
                  autocomplete="organization"
                  [value]="companyName()"
                  (input)="setCompanyName($event)"
                />
              </label>

              <label>
                <span>Nom du contact <small>requis</small></span>
                <input
                  type="text"
                  maxlength="200"
                  required
                  autocomplete="name"
                  [value]="contactName()"
                  (input)="setContactName($event)"
                />
              </label>

              <label>
                <span>Courriel du contact <small>requis</small></span>
                <input
                  type="email"
                  maxlength="200"
                  required
                  autocomplete="email"
                  [value]="contactEmail()"
                  (input)="setContactEmail($event)"
                />
              </label>

              <label>
                Site web
                <input
                  type="url"
                  maxlength="2048"
                  placeholder="https://"
                  [value]="websiteUrl()"
                  (input)="setWebsiteUrl($event)"
                />
              </label>

              <label>
                Lien du logo
                <input
                  type="url"
                  maxlength="2048"
                  placeholder="https://"
                  [value]="logoUrl()"
                  (input)="setLogoUrl($event)"
                />
              </label>

              <label class="full">
                Message ou précision
                <textarea
                  rows="4"
                  maxlength="1000"
                  [value]="message()"
                  (input)="setMessage($event)"
                ></textarea>
              </label>

              <button type="submit" [disabled]="!canSubmit()">
                {{
                  state() === 'submitting'
                    ? 'Envoi...'
                    : 'Enregistrer les informations'
                }}
              </button>
              <p
                class="state state-success"
                *ngIf="state() === 'submitted'"
                aria-live="polite"
              >
                Informations enregistrées. Votre commandite reste en validation
                manuelle.
              </p>
            </form>
          </section>
        </ng-container>
      </section>
    </main>
  `,
  styles: [
    `
      .followup-shell {
        background: #f3f6fa;
        color: #121b2d;
        min-height: 100vh;
      }

      .followup-hero {
        background:
          linear-gradient(135deg, rgb(7 17 30 / 94%), rgb(28 49 72 / 90%)),
          url('/assets/openg7-funding-platform-dragon-coffre.png') center/cover;
        border-bottom: 1px solid rgb(15 23 42 / 16%);
        color: #ffffff;
        padding: 7rem clamp(1rem, 5vw, 4rem) 3.25rem;
      }

      .followup-hero-inner,
      .followup-content {
        margin: 0 auto;
        max-width: 72rem;
      }

      .followup-hero-inner {
        align-items: end;
        display: grid;
        gap: 2rem;
        grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
      }

      .followup-hero-copy {
        max-width: 47rem;
      }

      .eyebrow,
      .followup-status-panel dt {
        color: #9c6a14;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.76rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .followup-hero .eyebrow {
        color: #f6ce68;
      }

      .followup-hero h1 {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(2.35rem, 6vw, 4.6rem);
        line-height: 1;
        margin: 0.65rem 0 1rem;
      }

      .followup-hero p {
        color: #e3edf7;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: clamp(1rem, 2vw, 1.15rem);
        line-height: 1.7;
        margin: 0;
        max-width: 44rem;
      }

      .followup-hero-summary {
        background: rgb(255 255 255 / 92%);
        border: 1px solid rgb(255 255 255 / 54%);
        border-radius: 0.5rem;
        box-shadow: 0 1.25rem 3rem rgb(0 0 0 / 22%);
        color: #121b2d;
        padding: 1.1rem;
      }

      .followup-hero-summary span {
        color: #5f6675;
        display: block;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.78rem;
        font-weight: 800;
        margin-bottom: 0.25rem;
        text-transform: uppercase;
      }

      .followup-hero-summary strong {
        display: block;
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(1.8rem, 4vw, 2.4rem);
        line-height: 1.05;
      }

      .followup-hero-summary p {
        color: #39475b;
        font-size: 0.95rem;
        line-height: 1.55;
        margin-top: 0.75rem;
      }

      .reference-summary {
        border-top: 1px solid #d8e1ed;
        margin-top: 0.9rem;
        padding-top: 0.9rem;
      }

      .reference-code {
        color: #172033;
        font-family:
          ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
        font-size: 1rem;
        font-weight: 900;
        letter-spacing: 0;
        overflow-wrap: anywhere;
      }

      .followup-hero-summary .reference-code {
        font-size: clamp(1.25rem, 3vw, 1.55rem);
      }

      .followup-form-panel p,
      .state-card p {
        color: #435269;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        line-height: 1.6;
        margin: 0;
      }

      .followup-content {
        display: grid;
        gap: 1.25rem;
        padding: 1.25rem clamp(1rem, 5vw, 4rem) 4rem;
      }

      .followup-status-panel {
        display: grid;
        gap: 0.85rem;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        margin: 0;
      }

      .followup-status-panel div,
      .followup-form-panel,
      .state-card,
      .review-path {
        background: #fff;
        border: 1px solid #d8e1ed;
        border-radius: 0.5rem;
        box-shadow: 0 0.85rem 2rem rgb(15 23 42 / 7%);
        color: #121b2d;
      }

      .followup-status-panel div {
        min-height: 5.5rem;
        padding: 1rem 1.1rem;
      }

      .followup-status-panel dd {
        display: block;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 1.05rem;
        font-weight: 900;
        margin: 0.3rem 0 0;
      }

      .review-approved {
        color: #137047;
      }

      .review-rejected {
        color: #a32135;
      }

      .review-pending {
        color: #93620a;
      }

      .followup-layout {
        align-items: start;
        display: grid;
        gap: 1.25rem;
        grid-template-columns: minmax(0, 1fr) minmax(18rem, 23rem);
      }

      .followup-primary {
        display: grid;
        gap: 1rem;
      }

      .state-card,
      .followup-form-panel,
      .review-path {
        padding: clamp(1rem, 2.4vw, 1.4rem);
      }

      .state-card a {
        color: #254db8;
        display: inline-flex;
        font-weight: 800;
        margin-top: 0.75rem;
        text-decoration: none;
      }

      .state-card.error {
        border-color: #f0bac3;
        max-width: 42rem;
      }

      .section-heading {
        margin-bottom: 1rem;
      }

      .section-heading h2,
      .followup-form-panel h2,
      .state-card h2,
      .review-path h2 {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(1.55rem, 3vw, 2rem);
        line-height: 1.15;
        margin: 0.35rem 0 0.55rem;
      }

      .sponsorship-benefits-recap ul {
        display: grid;
        gap: 0.65rem;
        list-style: none;
        margin: 0 0 1rem;
        padding: 0;
      }

      .sponsorship-benefits-recap li {
        align-items: start;
        color: #121b2d;
        display: grid;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 1.02rem;
        font-weight: 850;
        gap: 0.55rem;
        grid-template-columns: 1.35rem minmax(0, 1fr);
        line-height: 1.45;
      }

      .sponsorship-benefits-recap li::before {
        align-items: center;
        background: #e5f5ed;
        border: 1px solid #b8dfcb;
        border-radius: 999px;
        color: #137047;
        content: '\\2713';
        display: inline-flex;
        font-size: 0.82rem;
        font-weight: 900;
        height: 1.35rem;
        justify-content: center;
        margin-top: 0.08rem;
        width: 1.35rem;
      }

      .notice-panel {
        background: #f4f8fc;
        border: 1px solid #d9e5f1;
        border-left: 0.28rem solid #2e7c8c;
        border-radius: 0.5rem;
        padding: 0.95rem 1rem;
      }

      .notice-panel strong {
        color: #173243;
        display: block;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-weight: 900;
        margin-bottom: 0.25rem;
      }

      .form-prompt {
        margin-top: 0.85rem;
      }

      .review-note.approved {
        border-color: #b8dfcb;
      }

      .review-note.rejected {
        border-color: #f0bac3;
      }

      .review-path ol {
        display: grid;
        gap: 0.85rem;
        list-style: none;
        margin: 1rem 0 0;
        padding: 0;
      }

      .review-path li {
        display: grid;
        gap: 0.1rem 0.75rem;
        grid-template-columns: 2rem minmax(0, 1fr);
      }

      .review-path li > span {
        align-items: center;
        background: #eef3f8;
        border: 1px solid #cbd8e6;
        border-radius: 999px;
        color: #5b6778;
        display: inline-flex;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.85rem;
        font-weight: 900;
        height: 2rem;
        justify-content: center;
        width: 2rem;
      }

      .review-path li.done > span {
        background: #e5f5ed;
        border-color: #b8dfcb;
        color: #137047;
      }

      .review-path li.active > span {
        background: #fff4d9;
        border-color: #ebca75;
        color: #8b5d07;
      }

      .review-path strong {
        color: #121b2d;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-weight: 900;
      }

      .review-path p {
        color: #526175;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.93rem;
        grid-column: 2;
        line-height: 1.45;
        margin: 0;
      }

      .followup-form-panel header {
        margin-bottom: 1rem;
      }

      .followup-form-panel form {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .followup-form-panel label {
        display: grid;
        gap: 0.35rem;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.9rem;
        font-weight: 800;
      }

      .followup-form-panel label > span {
        align-items: center;
        display: flex;
        gap: 0.45rem;
      }

      .followup-form-panel small {
        color: #6b7687;
        font-size: 0.72rem;
        font-weight: 900;
        text-transform: uppercase;
      }

      .followup-form-panel label.full {
        grid-column: 1 / -1;
      }

      .followup-form-panel input,
      .followup-form-panel textarea {
        background: #fbfdff;
        border: 1px solid #c5d2e1;
        border-radius: 0.35rem;
        color: #121b2d;
        font: inherit;
        min-height: 2.9rem;
        padding: 0.72rem 0.8rem;
        transition:
          border-color 160ms ease,
          box-shadow 160ms ease;
      }

      .followup-form-panel input:focus,
      .followup-form-panel textarea:focus {
        border-color: #2e7c8c;
        box-shadow: 0 0 0 0.18rem rgb(46 124 140 / 18%);
        outline: none;
      }

      .followup-form-panel textarea {
        min-height: 8rem;
        resize: vertical;
      }

      .followup-form-panel button {
        background: #132032;
        border: 0;
        border-radius: 0.35rem;
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 900;
        min-height: 2.85rem;
        padding: 0 1rem;
        transition:
          background 160ms ease,
          transform 160ms ease;
      }

      .followup-form-panel button:not(:disabled):hover {
        background: #24405f;
        transform: translateY(-1px);
      }

      .followup-form-panel button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .state {
        color: #39475b;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        margin: 0;
      }

      .state-loading {
        background: #fff;
        border: 1px solid #d8e1ed;
        border-radius: 0.5rem;
        padding: 1rem;
      }

      .state-success {
        align-self: center;
        background: #e5f5ed;
        border: 1px solid #b8dfcb;
        border-radius: 0.5rem;
        color: #137047;
        font-weight: 800;
        padding: 0.75rem 0.85rem;
      }

      @media (max-width: 980px) {
        .followup-hero-inner,
        .followup-layout {
          grid-template-columns: 1fr;
        }

        .followup-hero-summary {
          max-width: 28rem;
        }
      }

      @media (max-width: 820px) {
        .followup-status-panel {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .followup-form-panel form {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 560px) {
        .followup-hero {
          padding-top: 5.75rem;
        }

        .followup-status-panel {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class SponsorshipFollowupPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fundingService = inject(FundingService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly token = signal<string>('');
  readonly followup = signal<SponsorshipFollowupResponse | null>(null);
  readonly state = signal<
    'idle' | 'loading' | 'ready' | 'submitting' | 'submitted' | 'error'
  >('idle');

  readonly companyName = signal<string>('');
  readonly contactName = signal<string>('');
  readonly contactEmail = signal<string>('');
  readonly websiteUrl = signal<string>('');
  readonly logoUrl = signal<string>('');
  readonly message = signal<string>('');

  readonly canSubmit = computed(
    () =>
      this.state() !== 'submitting' &&
      this.companyName().trim().length > 0 &&
      this.contactName().trim().length > 0 &&
      this.contactEmail().trim().length > 0 &&
      ['paid', 'refunded', 'disputed'].includes(
        this.followup()?.paymentStatus ?? ''
      )
  );

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token') ?? '';
    this.token.set(token);
    this.removeTokenFromBrowserUrl();
    void this.load();
  }

  async load(): Promise<void> {
    if (!this.token()) {
      this.state.set('error');
      return;
    }

    this.state.set('loading');
    try {
      const followup = await this.fundingService.getSponsorshipFollowup(
        this.token()
      );
      this.followup.set(followup);
      this.companyName.set(followup.companyName ?? '');
      this.contactName.set(followup.contactName ?? '');
      this.contactEmail.set(followup.contactEmail ?? '');
      this.websiteUrl.set(followup.websiteUrl ?? '');
      this.logoUrl.set(followup.logoUrl ?? '');
      this.message.set(followup.message ?? '');
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      return;
    }

    this.state.set('submitting');
    const payload: SponsorshipFollowupDetailsRequest = {
      token: this.token(),
      companyName: this.companyName().trim(),
      contactName: this.contactName().trim(),
      contactEmail: this.contactEmail().trim(),
      websiteUrl: this.websiteUrl().trim() || undefined,
      logoUrl: this.logoUrl().trim() || undefined,
      message: this.message().trim() || undefined
    };

    try {
      await this.fundingService.submitSponsorshipFollowupDetails(payload);
      await this.load();
      this.state.set('submitted');
    } catch {
      this.state.set('error');
    }
  }

  setCompanyName(event: Event): void {
    this.companyName.set(this.valueFromEvent(event));
  }

  setContactName(event: Event): void {
    this.contactName.set(this.valueFromEvent(event));
  }

  setContactEmail(event: Event): void {
    this.contactEmail.set(this.valueFromEvent(event));
  }

  setWebsiteUrl(event: Event): void {
    this.websiteUrl.set(this.valueFromEvent(event));
  }

  setLogoUrl(event: Event): void {
    this.logoUrl.set(this.valueFromEvent(event));
  }

  setMessage(event: Event): void {
    this.message.set(this.valueFromEvent(event));
  }

  reviewStatusLabel(status: SponsorshipReviewStatus): string {
    if (status === 'approved') {
      return 'Acceptee';
    }

    if (status === 'rejected') {
      return 'Refusee';
    }

    return 'En validation';
  }

  statusClass(status: SponsorshipReviewStatus): string {
    if (status === 'approved') {
      return 'review-approved';
    }

    if (status === 'rejected') {
      return 'review-rejected';
    }

    return 'review-pending';
  }

  paymentLabel(status: string): string {
    return status === 'paid' ? 'Confirme' : status;
  }

  benefitLabel(benefit: SponsorshipBenefitId): string {
    switch (benefit) {
      case 'website_mention':
        return 'Mention de votre entreprise sur OpenG7.org';
      case 'facebook_batch':
        return 'Inclusion dans une publication collective de reconnaissance sur Facebook';
      case 'linkedin_batch':
        return 'Inclusion dans une publication collective de reconnaissance sur LinkedIn';
      default:
        return benefit;
    }
  }

  formatMoney(followup: SponsorshipFollowupResponse): string {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: followup.currency || 'CAD'
    }).format(followup.amount);
  }

  dateLabel(value: string | null): string {
    if (!value) {
      return 'Non disponible';
    }

    return new Intl.DateTimeFormat('fr-CA', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  private valueFromEvent(event: Event): string {
    return (
      (event.target as HTMLInputElement | HTMLTextAreaElement | null)?.value ??
      ''
    );
  }

  private removeTokenFromBrowserUrl(): void {
    if (!this.token() || !isPlatformBrowser(this.platformId)) {
      return;
    }

    const url = new URL(window.location.href);
    if (!url.searchParams.has('token')) {
      return;
    }

    url.searchParams.delete('token');
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  }
}
