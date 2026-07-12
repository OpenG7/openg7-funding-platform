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
        <div>
          <span>Commandite OpenG7</span>
          <h1 id="followup-title">Suivi de votre commandite</h1>
          <p>
            Reprenez votre formulaire apres paiement et consultez le statut de
            validation avant toute visibilite publique.
          </p>
        </div>
      </section>

      <section class="followup-content">
        <p class="state" *ngIf="state() === 'loading'">
          Chargement du suivi...
        </p>
        <article class="state-card error" *ngIf="state() === 'error'">
          <h2>Lien introuvable</h2>
          <p>
            Le lien de suivi est absent, invalide ou expire. Reprenez le lien
            recu par courriel ou contactez le support OpenG7.
          </p>
          <a routerLink="/support">Contacter le support</a>
        </article>

        <ng-container *ngIf="followup() as current">
          <aside class="followup-status-panel">
            <div>
              <span>Statut du paiement</span>
              <strong>{{ paymentLabel(current.paymentStatus) }}</strong>
            </div>
            <div>
              <span>Validation</span>
              <strong [class]="statusClass(current.reviewStatus)">
                {{ reviewStatusLabel(current.reviewStatus) }}
              </strong>
            </div>
            <div>
              <span>Montant</span>
              <strong>{{ formatMoney(current) }}</strong>
            </div>
            <div>
              <span>Derniere revue</span>
              <strong>{{ dateLabel(current.reviewedAt) }}</strong>
            </div>
          </aside>

          <article class="state-card sponsorship-benefits-recap">
            <h2>Avantages de votre commandite de {{ formatMoney(current) }}</h2>
            <ul>
              <li *ngFor="let benefit of current.sponsorshipBenefits">
                {{ benefitLabel(benefit) }}
              </li>
            </ul>
            <p>
              Ces avantages restent en attente de publication : la commandite
              demeure en revision manuelle et les presences sur les reseaux
              sociaux sont planifiees dans un prochain lot collectif
              disponible, jamais publiees automatiquement au paiement.
            </p>
            <p *ngIf="!current.detailsSubmitted">
              Transmettez le nom de votre entreprise, votre site web et votre
              logo ci-dessous pour permettre la revision.
            </p>
          </article>

          <article class="state-card" *ngIf="current.reviewStatus === 'approved'">
            <h2>Commandite acceptee</h2>
            <p>
              Votre commandite est approuvee. La visibilite publique reste
              controlee par OpenG7 et peut etre planifiee separement.
            </p>
          </article>

          <article class="state-card" *ngIf="current.reviewStatus === 'rejected'">
            <h2>Commandite refusee</h2>
            <p>
              La visibilite publique n'est pas activee. Notre equipe peut vous
              recontacter si une clarification ou un remboursement doit etre
              traite.
            </p>
          </article>

          <section class="followup-form-panel" aria-labelledby="followup-form-title">
            <header>
              <span>{{ current.detailsSubmitted ? 'Details recus' : 'A completer' }}</span>
              <h2 id="followup-form-title">Informations de commandite</h2>
              <p>
                Ces informations restent privees jusqu'a validation manuelle.
                Aucun logo ni nom d'entreprise n'est publie automatiquement.
              </p>
            </header>

            <form (submit)="$event.preventDefault(); submit()">
              <label>
                Nom de l'entreprise
                <input
                  type="text"
                  maxlength="200"
                  required
                  [value]="companyName()"
                  (input)="setCompanyName($event)"
                />
              </label>

              <label>
                Nom du contact
                <input
                  type="text"
                  maxlength="200"
                  required
                  [value]="contactName()"
                  (input)="setContactName($event)"
                />
              </label>

              <label>
                Courriel du contact
                <input
                  type="email"
                  maxlength="200"
                  required
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
                Message ou precision
                <textarea
                  rows="4"
                  maxlength="1000"
                  [value]="message()"
                  (input)="setMessage($event)"
                ></textarea>
              </label>

              <button type="submit" [disabled]="!canSubmit()">
                {{ state() === 'submitting' ? 'Envoi...' : 'Enregistrer les informations' }}
              </button>
              <p class="state state-success" *ngIf="state() === 'submitted'">
                Informations enregistrees. Votre commandite reste en validation
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
        background: #06111f;
        color: #f7fbff;
        min-height: 100vh;
      }

      .followup-hero {
        background: linear-gradient(135deg, #06111f, #172944 56%, #312915);
        padding: 7rem clamp(1rem, 5vw, 4rem) 3rem;
      }

      .followup-hero div,
      .followup-content {
        margin: 0 auto;
        max-width: 68rem;
      }

      .followup-hero span,
      .followup-form-panel header span,
      .followup-status-panel span {
        color: #f4c957;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.78rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .followup-hero h1 {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(2.4rem, 6vw, 4.8rem);
        line-height: 0.98;
        margin: 0.65rem 0 1rem;
      }

      .followup-hero p,
      .followup-form-panel p,
      .state-card p {
        color: #ccdaeb;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        line-height: 1.6;
        margin: 0;
        max-width: 42rem;
      }

      .followup-content {
        display: grid;
        gap: 1rem;
        padding: 1rem clamp(1rem, 5vw, 4rem) 4rem;
      }

      .followup-status-panel {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .followup-status-panel div,
      .followup-form-panel,
      .state-card {
        background: #fff;
        border: 1px solid rgb(192 205 222 / 28%);
        border-radius: 0.5rem;
        color: #172033;
      }

      .followup-status-panel div {
        padding: 1rem;
      }

      .followup-status-panel strong {
        display: block;
        margin-top: 0.25rem;
      }

      .review-approved {
        color: #176236;
      }

      .review-rejected {
        color: #9f1d2f;
      }

      .review-pending {
        color: #8a5a00;
      }

      .state-card,
      .followup-form-panel {
        padding: 1rem;
      }

      .state-card a {
        color: #254db8;
        display: inline-flex;
        font-weight: 800;
        margin-top: 0.75rem;
        text-decoration: none;
      }

      .state-card.error {
        border-color: #ffc6ce;
      }

      .sponsorship-benefits-recap ul {
        display: grid;
        gap: 0.35rem;
        list-style: none;
        margin: 0.5rem 0;
        padding: 0;
      }

      .sponsorship-benefits-recap li {
        color: #172033;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-weight: 700;
      }

      .sponsorship-benefits-recap li::before {
        content: '\\2713 ';
        font-weight: 900;
      }

      .followup-form-panel header {
        margin-bottom: 1rem;
      }

      .followup-form-panel h2,
      .state-card h2 {
        margin: 0.25rem 0 0.5rem;
      }

      .followup-form-panel form {
        display: grid;
        gap: 0.85rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .followup-form-panel label {
        display: grid;
        gap: 0.35rem;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-size: 0.9rem;
        font-weight: 800;
      }

      .followup-form-panel label.full {
        grid-column: 1 / -1;
      }

      .followup-form-panel input,
      .followup-form-panel textarea {
        border: 1px solid #cbd6e4;
        border-radius: 0.35rem;
        font: inherit;
        padding: 0.7rem 0.75rem;
      }

      .followup-form-panel textarea {
        resize: vertical;
      }

      .followup-form-panel button {
        background: #172033;
        border: 0;
        border-radius: 0.35rem;
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 900;
        min-height: 2.85rem;
        padding: 0 1rem;
      }

      .followup-form-panel button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .state {
        color: #dbe8f7;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        margin: 0;
      }

      .state-success {
        align-self: center;
        color: #176236;
        font-weight: 800;
      }

      @media (max-width: 820px) {
        .followup-status-panel,
        .followup-form-panel form {
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
    return (event.target as HTMLInputElement | HTMLTextAreaElement | null)
      ?.value ?? '';
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
