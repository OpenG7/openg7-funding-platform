import { CommonModule, isPlatformBrowser } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type {
  SponsorshipBenefitId,
  SponsorMediaAsset,
  SponsorMediaKind,
  SponsorMediaLimits,
  SponsorshipFollowupDetailsRequest,
  SponsorshipFollowupResponse,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

import { FundingHeaderComponent } from '../../components/funding-header/funding-header.component.js';
import { FundingService } from '../../services/funding.service.js';
import {
  getSponsorMediaFileValidationMessage,
  getSponsorMediaUploadFailureMessage
} from '../../services/sponsor-media-upload-feedback.js';

type SponsorshipFollowupFormField =
  | 'companyName'
  | 'contactName'
  | 'contactEmail'
  | 'websiteUrl'
  | 'logoUrl'
  | 'message';

interface SponsorshipFollowupFormErrors {
  readonly companyName: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly websiteUrl: string;
  readonly logoUrl: string;
  readonly paymentStatus: string;
}

const optionalHttpsUrlValidator: ValidatorFn = (
  control: AbstractControl
): ValidationErrors | null => {
  const value = String(control.value ?? '').trim();
  if (!value) {
    return null;
  }

  try {
    return new URL(value).protocol === 'https:' ? null : { httpsUrl: true };
  } catch {
    return { httpsUrl: true };
  }
};

const defaultSponsorMediaLimits: SponsorMediaLimits = {
  maxUploadBytes: 8 * 1024 * 1024,
  maxSupportingImages: 3,
  acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp']
};

type SponsorMediaUploadAttemptStatus =
  'queued' | 'uploading' | 'uploaded' | 'failed';

interface SponsorMediaUploadAttempt {
  readonly id: string;
  readonly kind: SponsorMediaKind;
  readonly filename: string;
  readonly previewUrl: string;
  readonly status: SponsorMediaUploadAttemptStatus;
  readonly message: string;
  readonly asset: SponsorMediaAsset | null;
}

@Component({
  selector: 'openg7-sponsorship-followup-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    FundingHeaderComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="followup-shell">
      <openg7-funding-header></openg7-funding-header>

      <section class="followup-hero" aria-labelledby="followup-title">
        <div class="followup-hero-inner">
          <div class="followup-hero-copy">
            <span class="eyebrow">Commandite OpenG7</span>
            <h1 id="followup-title">Suivi de votre commandite</h1>
            <ng-container
              *ngIf="followup() as current; else followupIntroLoading"
            >
              <p>
                {{
                  isEligiblePaymentStatus(current.paymentStatus)
                    ? "Votre paiement est reçu. Confirmez maintenant les renseignements de votre entreprise afin que l'équipe OpenG7 puisse valider la commandite avant toute visibilité publique."
                    : 'Votre paiement est en attente de confirmation. Les renseignements et les médias seront disponibles dès que Stripe aura confirmé la commandite.'
                }}
              </p>
            </ng-container>
            <ng-template #followupIntroLoading>
              <p>Chargement de l'état de votre commandite...</p>
            </ng-template>
          </div>

          <aside
            class="followup-hero-summary"
            *ngIf="followup() as current"
            aria-label="Résumé de la commandite"
          >
            <span>{{
              isEligiblePaymentStatus(current.paymentStatus)
                ? 'Montant reçu'
                : 'Montant attendu'
            }}</span>
            <strong>{{ formatMoney(current) }}</strong>
            <div class="reference-summary">
              <span>Référence OpenG7</span>
              <strong class="reference-code">{{
                current.publicReference || 'En attribution'
              }}</strong>
            </div>
            <p>
              {{
                !isEligiblePaymentStatus(current.paymentStatus)
                  ? 'Paiement en attente de confirmation Stripe.'
                  : current.detailsSubmitted
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
                <li
                  [class.done]="isEligiblePaymentStatus(current.paymentStatus)"
                  [class.active]="
                    !isEligiblePaymentStatus(current.paymentStatus)
                  "
                >
                  <span aria-hidden="true">1</span>
                  <strong>{{
                    isEligiblePaymentStatus(current.paymentStatus)
                      ? 'Paiement reçu'
                      : 'Paiement en confirmation'
                  }}</strong>
                  <p>
                    {{
                      isEligiblePaymentStatus(current.paymentStatus)
                        ? dateLabel(current.paidAt)
                        : 'Stripe doit confirmer le paiement avant la suite.'
                    }}
                  </p>
                </li>
                <li
                  [class.done]="current.detailsSubmitted"
                  [class.active]="
                    isEligiblePaymentStatus(current.paymentStatus) &&
                    !current.detailsSubmitted
                  "
                >
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

            <form
              [formGroup]="sponsorshipForm"
              (ngSubmit)="submit()"
              novalidate
            >
              <label>
                <span>Nom de l'entreprise <small>requis</small></span>
                <input
                  #companyNameInput
                  type="text"
                  maxlength="200"
                  required
                  autocomplete="organization"
                  formControlName="companyName"
                  [attr.aria-invalid]="errorFor('companyName') ? 'true' : null"
                  aria-describedby="company-name-error"
                />
                <small
                  id="company-name-error"
                  class="field-error"
                  *ngIf="errorFor('companyName')"
                  >{{ errorFor('companyName') }}</small
                >
              </label>

              <label>
                <span>Nom du contact <small>requis</small></span>
                <input
                  #contactNameInput
                  type="text"
                  maxlength="200"
                  required
                  autocomplete="name"
                  formControlName="contactName"
                  [attr.aria-invalid]="errorFor('contactName') ? 'true' : null"
                  aria-describedby="contact-name-error"
                />
                <small
                  id="contact-name-error"
                  class="field-error"
                  *ngIf="errorFor('contactName')"
                  >{{ errorFor('contactName') }}</small
                >
              </label>

              <label>
                <span>Courriel du contact <small>requis</small></span>
                <input
                  #contactEmailInput
                  type="email"
                  maxlength="200"
                  required
                  autocomplete="email"
                  formControlName="contactEmail"
                  [attr.aria-invalid]="errorFor('contactEmail') ? 'true' : null"
                  aria-describedby="contact-email-error"
                />
                <small
                  id="contact-email-error"
                  class="field-error"
                  *ngIf="errorFor('contactEmail')"
                  >{{ errorFor('contactEmail') }}</small
                >
              </label>

              <label>
                Site web
                <input
                  #websiteUrlInput
                  type="url"
                  maxlength="2048"
                  placeholder="https://"
                  formControlName="websiteUrl"
                  [attr.aria-invalid]="errorFor('websiteUrl') ? 'true' : null"
                  aria-describedby="website-url-error"
                />
                <small
                  id="website-url-error"
                  class="field-error"
                  *ngIf="errorFor('websiteUrl')"
                  >{{ errorFor('websiteUrl') }}</small
                >
              </label>

              <section class="media-manager full" aria-labelledby="media-title">
                <header>
                  <div>
                    <span class="eyebrow">Medias prives</span>
                    <h3 id="media-title">Logo et photos de presentation</h3>
                  </div>
                  <p>
                    Les fichiers restent prives jusqu'a leur validation par
                    OpenG7. Une photo de presentation est requise pour completer
                    la fiche.
                  </p>
                  <p
                    class="media-payment-note"
                    *ngIf="mediaUploadDisabledMessage()"
                    aria-live="polite"
                  >
                    {{ mediaUploadDisabledMessage() }}
                  </p>
                </header>

                <label class="media-alt-field">
                  Description de l'image a televerser
                  <input
                    type="text"
                    maxlength="300"
                    [value]="mediaAltText()"
                    (input)="setMediaAltText($event)"
                  />
                  <small
                    >Cette description sera utilisee pour
                    l'accessibilite.</small
                  >
                </label>

                <div class="media-upload-actions">
                  <label class="media-upload-control">
                    {{
                      hasActiveLogo() ? 'Remplacer le logo' : 'Ajouter le logo'
                    }}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      [disabled]="
                        !canUploadMedia() || mediaBusy() || hasApprovedLogo()
                      "
                      (change)="uploadMedia('logo', $event)"
                    />
                  </label>
                  <label class="media-upload-control">
                    Ajouter des photos
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      [disabled]="
                        !canUploadMedia() ||
                        mediaBusy() ||
                        !canAddSupportingImage()
                      "
                      (change)="uploadMedia('supporting_image', $event)"
                    />
                  </label>
                </div>

                <p class="media-status" aria-live="polite">
                  {{ mediaMessage() }}
                </p>

                <div
                  class="media-upload-attempts"
                  *ngIf="mediaUploadAttempts().length > 0"
                  aria-label="Fichiers selectionnes"
                >
                  <article
                    class="media-upload-attempt"
                    [class.failed]="attempt.status === 'failed'"
                    *ngFor="
                      let attempt of mediaUploadAttempts();
                      trackBy: trackMediaUploadAttempt
                    "
                  >
                    <div class="media-preview">
                      <img
                        *ngIf="attempt.previewUrl"
                        [src]="attempt.previewUrl"
                        [alt]="'Apercu de ' + attempt.filename"
                      />
                      <span
                        class="media-preview-placeholder"
                        *ngIf="!attempt.previewUrl"
                        aria-hidden="true"
                        >!</span
                      >
                      <button
                        type="button"
                        class="media-remove-action"
                        [disabled]="
                          mediaBusy() ||
                          attempt.status === 'queued' ||
                          attempt.status === 'uploading'
                        "
                        [attr.aria-label]="'Retirer ' + attempt.filename"
                        title="Retirer cette image"
                        (click)="dismissMediaUploadAttempt(attempt)"
                      >
                        &times;
                      </button>
                    </div>
                    <div class="media-item-copy">
                      <strong>{{ attempt.filename }}</strong>
                      <span
                        [class]="'media-upload-state ' + attempt.status"
                        [attr.role]="
                          attempt.status === 'failed' ? 'alert' : null
                        "
                      >
                        {{ attempt.message }}
                      </span>
                    </div>
                  </article>
                </div>

                <div class="media-list" *ngIf="mediaAssets().length > 0">
                  <div
                    class="media-item"
                    *ngFor="
                      let asset of mediaAssets();
                      trackBy: trackMediaAsset
                    "
                  >
                    <div class="media-preview">
                      <img
                        *ngIf="mediaPreviewFor(asset.id) as preview"
                        [src]="preview"
                        [alt]="asset.altText || mediaKindLabel(asset.kind)"
                      />
                      <button
                        *ngIf="asset.reviewStatus !== 'approved'"
                        type="button"
                        class="media-remove-action"
                        [disabled]="mediaBusy()"
                        [attr.aria-label]="
                          'Supprimer ' + mediaKindLabel(asset.kind)
                        "
                        title="Supprimer cette image"
                        (click)="deleteMedia(asset)"
                      >
                        &times;
                      </button>
                    </div>
                    <div class="media-item-copy">
                      <strong>{{ mediaKindLabel(asset.kind) }}</strong>
                      <span
                        [class]="'media-review-status ' + asset.reviewStatus"
                      >
                        {{ mediaStatusLabel(asset.reviewStatus) }}
                      </span>
                      <small>
                        {{ asset.width }} x {{ asset.height }} px ·
                        {{ formatMediaSize(asset.processedSizeBytes) }}
                      </small>
                    </div>
                  </div>
                </div>
              </section>

              <label class="full">
                Message ou précision
                <textarea
                  rows="4"
                  maxlength="1000"
                  formControlName="message"
                ></textarea>
              </label>

              <div
                class="form-error-summary full"
                *ngIf="formErrorMessages().length > 0 || submitError()"
                role="alert"
                aria-live="polite"
              >
                <strong>Impossible d'enregistrer pour le moment</strong>
                <p *ngIf="submitError()">{{ submitError() }}</p>
                <ul *ngIf="formErrorMessages().length > 0">
                  <li *ngFor="let error of formErrorMessages()">
                    {{ error }}
                  </li>
                </ul>
              </div>

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

      .followup-form-panel .field-error {
        color: #a32135;
        font-size: 0.82rem;
        line-height: 1.35;
        text-transform: none;
      }

      .followup-form-panel label.full {
        grid-column: 1 / -1;
      }

      .media-manager {
        border-bottom: 1px solid #dce3ed;
        border-top: 1px solid #dce3ed;
        display: grid;
        gap: 1rem;
        grid-column: 1 / -1;
        padding: 1.1rem 0;
      }

      .media-manager header {
        align-items: start;
        display: grid;
        gap: 0.5rem 1rem;
        grid-template-columns: minmax(0, 1fr) minmax(15rem, 0.8fr);
        margin: 0;
      }

      .media-manager h3,
      .media-manager p {
        margin: 0;
      }

      .media-manager h3 {
        font-size: 1.05rem;
      }

      .media-manager header p,
      .media-alt-field small,
      .media-item-copy small {
        color: #667085;
        font-size: 0.82rem;
        line-height: 1.45;
      }

      .media-manager header .media-payment-note {
        background: #fff7ed;
        border: 1px solid rgb(194 65 12 / 22%);
        border-radius: 0.5rem;
        color: #7c2d12;
        grid-column: 1 / -1;
        padding: 0.8rem 0.95rem;
      }

      .media-alt-field {
        max-width: 36rem;
      }

      .media-upload-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.65rem;
      }

      .media-upload-control {
        align-items: center;
        background: #1f5f99;
        border: 1px solid #1f5f99;
        border-radius: 0.35rem;
        color: #ffffff;
        cursor: pointer;
        display: inline-flex;
        font-size: 0.82rem;
        justify-content: center;
        min-height: 2.55rem;
        padding: 0.65rem 0.85rem;
      }

      .media-upload-control:has(input:disabled) {
        cursor: not-allowed;
        opacity: 0.58;
      }

      .media-upload-control input {
        height: 1px;
        opacity: 0;
        overflow: hidden;
        position: absolute;
        width: 1px;
      }

      .media-upload-control:focus-within {
        outline: 3px solid rgba(31, 95, 153, 0.24);
        outline-offset: 2px;
      }

      .media-status {
        color: #475467;
        min-height: 1.25rem;
      }

      .media-list {
        display: grid;
        gap: 0.75rem;
      }

      .media-upload-attempts {
        display: grid;
        gap: 0.75rem;
      }

      .media-upload-attempt,
      .media-item {
        align-items: center;
        display: grid;
        gap: 0.85rem;
        grid-template-columns: 6rem minmax(0, 1fr);
        min-height: 5rem;
      }

      .media-upload-attempt {
        border: 1px solid #d8e0ea;
        border-radius: 0.35rem;
        padding: 0.65rem;
      }

      .media-upload-attempt.failed {
        background: #fff7f8;
        border-color: #e5a4ae;
      }

      .media-preview {
        align-items: center;
        aspect-ratio: 4 / 3;
        background: #edf1f6;
        border: 1px solid #d8e0ea;
        display: flex;
        justify-content: center;
        overflow: hidden;
        position: relative;
      }

      .media-preview img {
        height: 100%;
        object-fit: contain;
        width: 100%;
      }

      .media-preview-placeholder {
        color: #9f1d2f;
        font-size: 1.4rem;
        font-weight: 900;
      }

      .media-remove-action {
        align-items: center;
        background: rgba(17, 24, 39, 0.88);
        border: 1px solid rgba(255, 255, 255, 0.85);
        border-radius: 50%;
        color: #ffffff;
        cursor: pointer;
        display: inline-flex;
        font-size: 1.2rem;
        height: 1.8rem;
        justify-content: center;
        line-height: 1;
        padding: 0;
        position: absolute;
        right: 0.3rem;
        top: 0.3rem;
        width: 1.8rem;
      }

      .media-remove-action:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }

      .media-remove-action:focus-visible {
        outline: 3px solid rgba(31, 95, 153, 0.32);
        outline-offset: 2px;
      }

      .media-item-copy {
        display: grid;
        gap: 0.2rem;
        min-width: 0;
      }

      .media-item-copy strong {
        overflow-wrap: anywhere;
      }

      .media-review-status {
        font-size: 0.75rem;
        font-weight: 800;
      }

      .media-review-status.approved {
        color: #137047;
      }

      .media-review-status.pending_review {
        color: #8a5a00;
      }

      .media-review-status.rejected {
        color: #a32135;
      }

      .media-upload-state {
        color: #475467;
        font-size: 0.8rem;
        line-height: 1.4;
      }

      .media-upload-state.uploaded {
        color: #137047;
      }

      .media-upload-state.failed {
        color: #a32135;
        font-weight: 800;
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

      .followup-form-panel input[aria-invalid='true'] {
        border-color: #d94156;
        box-shadow: 0 0 0 0.16rem rgb(217 65 86 / 12%);
      }

      .followup-form-panel textarea {
        min-height: 8rem;
        resize: vertical;
      }

      .form-error-summary {
        background: #fff7f8;
        border: 1px solid #f0bac3;
        border-radius: 0.5rem;
        color: #7d1728;
        display: grid;
        gap: 0.45rem;
        padding: 0.85rem 1rem;
      }

      .form-error-summary strong {
        font-family: 'Trebuchet MS', Arial, sans-serif;
        font-weight: 900;
      }

      .form-error-summary p,
      .form-error-summary ul {
        margin: 0;
      }

      .form-error-summary ul {
        display: grid;
        gap: 0.25rem;
        padding-left: 1.1rem;
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

        .media-manager header {
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

        .media-upload-attempt,
        .media-item {
          align-items: start;
          grid-template-columns: 5rem minmax(0, 1fr);
        }
      }
    `
  ]
})
export class SponsorshipFollowupPageComponent implements OnInit, AfterViewInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fundingService = inject(FundingService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly formBuilder = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('companyNameInput')
  private companyNameInput?: ElementRef<HTMLInputElement>;

  @ViewChild('contactNameInput')
  private contactNameInput?: ElementRef<HTMLInputElement>;

  @ViewChild('contactEmailInput')
  private contactEmailInput?: ElementRef<HTMLInputElement>;

  @ViewChild('websiteUrlInput')
  private websiteUrlInput?: ElementRef<HTMLInputElement>;

  @ViewChild('logoUrlInput')
  private logoUrlInput?: ElementRef<HTMLInputElement>;

  readonly token = signal<string>('');
  readonly followup = signal<SponsorshipFollowupResponse | null>(null);
  readonly state = signal<
    'idle' | 'loading' | 'ready' | 'submitting' | 'submitted' | 'error'
  >('idle');

  readonly submitError = signal<string>('');
  readonly formRevision = signal<number>(0);
  readonly mediaAssets = signal<readonly SponsorMediaAsset[]>([]);
  readonly mediaUploadAttempts = signal<readonly SponsorMediaUploadAttempt[]>(
    []
  );
  readonly mediaLimits = signal<SponsorMediaLimits>(defaultSponsorMediaLimits);
  readonly mediaPreviewUrls = signal<Record<string, string>>({});
  readonly mediaBusy = signal<boolean>(false);
  readonly mediaMessage = signal<string>('');
  readonly mediaAltText = signal<string>('');
  private mediaUploadSequence = 0;
  readonly hasActiveLogo = computed(() =>
    this.mediaAssets().some((asset) => asset.kind === 'logo')
  );
  readonly hasApprovedLogo = computed(() =>
    this.mediaAssets().some(
      (asset) => asset.kind === 'logo' && asset.reviewStatus === 'approved'
    )
  );
  readonly canAddSupportingImage = computed(
    () =>
      this.mediaAssets().filter((asset) => asset.kind === 'supporting_image')
        .length < this.mediaLimits().maxSupportingImages
  );
  readonly canUploadMedia = computed(() =>
    this.isEligiblePaymentStatus(this.followup()?.paymentStatus ?? '')
  );
  readonly mediaUploadDisabledMessage = computed(() =>
    this.canUploadMedia()
      ? ''
      : 'Le televersement sera disponible lorsque le paiement de cette commandite sera confirme.'
  );
  readonly sponsorshipForm = this.formBuilder.nonNullable.group({
    companyName: ['', [Validators.required, Validators.maxLength(200)]],
    contactName: ['', [Validators.required, Validators.maxLength(200)]],
    contactEmail: [
      '',
      [Validators.required, Validators.email, Validators.maxLength(200)]
    ],
    websiteUrl: ['', [Validators.maxLength(2048), optionalHttpsUrlValidator]],
    logoUrl: ['', [Validators.maxLength(2048), optionalHttpsUrlValidator]],
    message: ['', [Validators.maxLength(1000)]]
  });

  readonly formErrors = computed<SponsorshipFollowupFormErrors>(() => {
    this.formRevision();

    return {
      companyName: this.controlError('companyName'),
      contactName: this.controlError('contactName'),
      contactEmail: this.controlError('contactEmail'),
      websiteUrl: this.controlError('websiteUrl'),
      logoUrl: this.controlError('logoUrl'),
      paymentStatus: this.isEligiblePaymentStatus(
        this.followup()?.paymentStatus ?? ''
      )
        ? ''
        : "Le paiement n'est pas encore confirme pour ce lien de suivi."
    };
  });

  readonly formErrorMessages = computed(() =>
    Object.values(this.formErrors()).filter((message) => message.length > 0)
  );

  readonly canSubmit = computed(
    () =>
      this.state() !== 'submitting' &&
      this.formRevision() >= 0 &&
      this.sponsorshipForm.valid &&
      this.isEligiblePaymentStatus(this.followup()?.paymentStatus ?? '') &&
      this.followup()?.reviewStatus !== 'rejected'
  );

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => {
      this.revokeMediaPreviews();
      this.revokeMediaUploadAttemptPreviews();
    });
    this.sponsorshipForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.submitError.set('');
        this.bumpFormRevision();
      });

    this.sponsorshipForm.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.bumpFormRevision());

    const token = this.route.snapshot.queryParamMap.get('token') ?? '';
    this.token.set(token);
    this.removeTokenFromBrowserUrl();
    void this.load();
  }

  ngAfterViewInit(): void {
    this.scheduleAutofillSync();
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
      this.sponsorshipForm.reset({
        companyName: followup.companyName ?? '',
        contactName: followup.contactName ?? '',
        contactEmail: followup.contactEmail ?? '',
        websiteUrl: followup.websiteUrl ?? '',
        logoUrl: followup.logoUrl ?? '',
        message: followup.message ?? ''
      });
      await this.loadMedia();
      this.submitError.set('');
      this.state.set('ready');
      this.bumpFormRevision();
      this.scheduleAutofillSync();
    } catch {
      this.state.set('error');
    }
  }

  async submit(): Promise<void> {
    this.syncFormControlsFromInputs();
    this.sponsorshipForm.markAllAsTouched();
    this.bumpFormRevision();
    if (!this.canSubmit()) {
      return;
    }

    this.state.set('submitting');
    this.submitError.set('');
    const formValue = this.sponsorshipForm.getRawValue();
    const payload: SponsorshipFollowupDetailsRequest = {
      token: this.token(),
      companyName: formValue.companyName.trim(),
      contactName: formValue.contactName.trim(),
      contactEmail: formValue.contactEmail.trim(),
      websiteUrl: formValue.websiteUrl.trim() || undefined,
      logoUrl: formValue.logoUrl.trim() || undefined,
      message: formValue.message.trim() || undefined
    };

    try {
      await this.fundingService.submitSponsorshipFollowupDetails(payload);
      await this.load();
      this.state.set('submitted');
    } catch {
      this.submitError.set(
        "Les informations n'ont pas pu etre enregistrees. Verifiez les champs et reessayez."
      );
      this.state.set('ready');
    }
  }

  async uploadMedia(kind: SponsorMediaKind, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const selected = Array.from(input?.files ?? []);
    if (selected.length === 0 || this.mediaBusy()) {
      return;
    }
    if (!this.canUploadMedia()) {
      this.mediaMessage.set(this.mediaUploadDisabledMessage());
      if (input) {
        input.value = '';
      }
      return;
    }
    const available =
      kind === 'logo'
        ? 1
        : Math.max(
            0,
            this.mediaLimits().maxSupportingImages -
              this.mediaAssets().filter(
                (asset) => asset.kind === 'supporting_image'
              ).length
          );
    const attempts = selected.map((file) =>
      this.createMediaUploadAttempt(kind, file)
    );
    this.mediaUploadAttempts.update((current) => [...current, ...attempts]);

    this.mediaBusy.set(true);
    this.mediaMessage.set('Televersement et traitement en cours...');
    let uploadedCount = 0;
    let failedCount = 0;
    const uploadedAttemptIds: string[] = [];
    try {
      for (const [index, file] of selected.entries()) {
        const attempt = attempts[index]!;
        if (index >= available) {
          failedCount += 1;
          this.updateMediaUploadAttempt(attempt.id, {
            status: 'failed',
            message:
              kind === 'logo'
                ? 'Un seul logo peut etre televerse.'
                : `La limite de ${this.mediaLimits().maxSupportingImages} photos est atteinte.`
          });
          continue;
        }

        const validationMessage = getSponsorMediaFileValidationMessage(
          file,
          this.mediaLimits()
        );
        if (validationMessage) {
          failedCount += 1;
          this.updateMediaUploadAttempt(attempt.id, {
            status: 'failed',
            message: validationMessage
          });
          continue;
        }

        this.updateMediaUploadAttempt(attempt.id, {
          status: 'uploading',
          message: 'Televersement et traitement en cours...'
        });
        try {
          const result = await this.fundingService.uploadSponsorshipMedia(
            this.token(),
            kind,
            file,
            this.mediaAltText()
          );
          uploadedCount += 1;
          uploadedAttemptIds.push(attempt.id);
          this.updateMediaUploadAttempt(attempt.id, {
            status: 'uploaded',
            message: 'Televersement reussi. En attente de validation.',
            asset: result.asset
          });
        } catch (error) {
          failedCount += 1;
          this.updateMediaUploadAttempt(attempt.id, {
            status: 'failed',
            message: getSponsorMediaUploadFailureMessage(
              error,
              this.mediaLimits()
            )
          });
        }
      }

      if (uploadedCount > 0) {
        const mediaReloaded = await this.loadMedia();
        if (mediaReloaded) {
          this.removeMediaUploadAttempts(uploadedAttemptIds);
        } else {
          for (const id of uploadedAttemptIds) {
            this.updateMediaUploadAttempt(id, {
              message:
                "Televersement reussi. L'apercu serveur sera disponible apres actualisation."
            });
          }
        }
        this.mediaAltText.set('');
      }

      if (failedCount === 0) {
        this.mediaMessage.set(
          `${uploadedCount} fichier${uploadedCount > 1 ? 's' : ''} recu${uploadedCount > 1 ? 's' : ''}, en attente de validation.`
        );
      } else if (uploadedCount > 0) {
        this.mediaMessage.set(
          `${uploadedCount} fichier${uploadedCount > 1 ? 's' : ''} recu${uploadedCount > 1 ? 's' : ''}; ${failedCount} en echec. Consultez les miniatures ci-dessous.`
        );
      } else {
        this.mediaMessage.set(
          `Le televersement a echoue pour ${failedCount} fichier${failedCount > 1 ? 's' : ''}. Consultez les messages ci-dessous.`
        );
      }
    } finally {
      this.mediaBusy.set(false);
      if (input) {
        input.value = '';
      }
    }
  }

  async dismissMediaUploadAttempt(
    attempt: SponsorMediaUploadAttempt
  ): Promise<void> {
    if (
      this.mediaBusy() ||
      attempt.status === 'queued' ||
      attempt.status === 'uploading'
    ) {
      return;
    }
    if (
      attempt.status === 'uploaded' &&
      attempt.asset &&
      !(await this.deleteMedia(attempt.asset))
    ) {
      return;
    }
    this.removeMediaUploadAttempts([attempt.id]);
  }

  async deleteMedia(asset: SponsorMediaAsset): Promise<boolean> {
    if (
      this.mediaBusy() ||
      (isPlatformBrowser(this.platformId) &&
        !window.confirm('Supprimer ce media en attente?'))
    ) {
      return false;
    }
    this.mediaBusy.set(true);
    this.mediaMessage.set('Suppression en cours...');
    try {
      await this.fundingService.deleteSponsorshipMedia({
        token: this.token(),
        assetId: asset.id,
        expectedVersion: asset.version
      });
      await this.loadMedia();
      this.mediaMessage.set('Media supprime.');
      return true;
    } catch {
      this.mediaMessage.set("La suppression de l'image a échoué. Réessayez.");
      return false;
    } finally {
      this.mediaBusy.set(false);
    }
  }

  setMediaAltText(event: Event): void {
    const value = (event.target as HTMLInputElement | null)?.value ?? '';
    this.mediaAltText.set(value.slice(0, 300));
  }

  mediaPreviewFor(assetId: string): string {
    return this.mediaPreviewUrls()[assetId] ?? '';
  }

  mediaKindLabel(kind: SponsorMediaKind): string {
    return kind === 'logo' ? 'Logo' : 'Photo de presentation';
  }

  mediaStatusLabel(status: SponsorMediaAsset['reviewStatus']): string {
    if (status === 'approved') {
      return 'Approuve';
    }
    if (status === 'rejected') {
      return 'A remplacer';
    }
    return 'En validation';
  }

  formatMediaSize(bytes: number): string {
    return bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
      : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  }

  trackMediaAsset(_: number, asset: SponsorMediaAsset): string {
    return asset.id;
  }

  trackMediaUploadAttempt(
    _: number,
    attempt: SponsorMediaUploadAttempt
  ): string {
    return attempt.id;
  }

  errorFor(field: keyof SponsorshipFollowupFormErrors): string {
    return this.formErrors()[field];
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
    switch (status) {
      case 'paid':
        return 'Confirmé';
      case 'refunded':
        return 'Remboursé';
      case 'disputed':
        return 'En litige';
      case 'pending':
        return 'En attente';
      case 'expired':
        return 'Expiré';
      case 'failed':
        return 'Échoué';
      default:
        return status;
    }
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

  isEligiblePaymentStatus(status: string): boolean {
    return ['paid', 'refunded', 'disputed'].includes(status);
  }

  private async loadMedia(): Promise<boolean> {
    try {
      const response = await this.fundingService.getSponsorshipMedia(
        this.token()
      );
      this.mediaAssets.set(response.assets);
      this.mediaLimits.set(response.limits);
      await this.loadMediaPreviews(response.assets);
      return true;
    } catch {
      this.mediaMessage.set(
        "Les medias n'ont pas pu etre charges pour le moment."
      );
      return false;
    }
  }

  private createMediaUploadAttempt(
    kind: SponsorMediaKind,
    file: File
  ): SponsorMediaUploadAttempt {
    this.mediaUploadSequence += 1;
    const canPreview =
      isPlatformBrowser(this.platformId) &&
      file.type.startsWith('image/') &&
      file.size > 0;
    return {
      id: `media-upload-${Date.now()}-${this.mediaUploadSequence}`,
      kind,
      filename: file.name || this.mediaKindLabel(kind),
      previewUrl: canPreview ? URL.createObjectURL(file) : '',
      status: 'queued',
      message: 'En attente de televersement...',
      asset: null
    };
  }

  private updateMediaUploadAttempt(
    id: string,
    updates: Partial<SponsorMediaUploadAttempt>
  ): void {
    this.mediaUploadAttempts.update((attempts) =>
      attempts.map((attempt) =>
        attempt.id === id ? { ...attempt, ...updates } : attempt
      )
    );
  }

  private removeMediaUploadAttempts(ids: readonly string[]): void {
    const removedIds = new Set(ids);
    const attempts = this.mediaUploadAttempts();
    if (isPlatformBrowser(this.platformId)) {
      for (const attempt of attempts) {
        if (removedIds.has(attempt.id) && attempt.previewUrl) {
          URL.revokeObjectURL(attempt.previewUrl);
        }
      }
    }
    this.mediaUploadAttempts.set(
      attempts.filter((attempt) => !removedIds.has(attempt.id))
    );
  }

  private revokeMediaUploadAttemptPreviews(): void {
    if (isPlatformBrowser(this.platformId)) {
      for (const attempt of this.mediaUploadAttempts()) {
        if (attempt.previewUrl) {
          URL.revokeObjectURL(attempt.previewUrl);
        }
      }
    }
    this.mediaUploadAttempts.set([]);
  }

  private async loadMediaPreviews(
    assets: readonly SponsorMediaAsset[]
  ): Promise<void> {
    this.revokeMediaPreviews();
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const previews = await Promise.all(
      assets.map(async (asset): Promise<readonly [string, string] | null> => {
        try {
          const blob = await this.fundingService.getSponsorshipMediaPreview(
            this.token(),
            asset.id
          );
          return [asset.id, URL.createObjectURL(blob)] as const;
        } catch {
          return null;
        }
      })
    );
    this.mediaPreviewUrls.set(
      Object.fromEntries(
        previews.filter(
          (entry): entry is readonly [string, string] => entry !== null
        )
      )
    );
  }

  private revokeMediaPreviews(): void {
    if (isPlatformBrowser(this.platformId)) {
      for (const url of Object.values(this.mediaPreviewUrls())) {
        URL.revokeObjectURL(url);
      }
    }
    this.mediaPreviewUrls.set({});
  }

  private scheduleAutofillSync(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    for (const delay of [0, 250, 1000]) {
      setTimeout(() => this.syncFormControlsFromInputs(), delay);
    }
  }

  private syncFormControlsFromInputs(): void {
    const values: Partial<Record<SponsorshipFollowupFormField, string>> = {};
    this.collectNativeInputValue(values, 'companyName', this.companyNameInput);
    this.collectNativeInputValue(values, 'contactName', this.contactNameInput);
    this.collectNativeInputValue(
      values,
      'contactEmail',
      this.contactEmailInput
    );
    this.collectNativeInputValue(values, 'websiteUrl', this.websiteUrlInput);
    this.collectNativeInputValue(values, 'logoUrl', this.logoUrlInput);

    if (Object.keys(values).length === 0) {
      return;
    }

    this.sponsorshipForm.patchValue(values);
    this.bumpFormRevision();
  }

  private collectNativeInputValue(
    values: Partial<Record<SponsorshipFollowupFormField, string>>,
    field: Exclude<SponsorshipFollowupFormField, 'message'>,
    input?: ElementRef<HTMLInputElement>
  ): void {
    const nativeValue = input?.nativeElement.value;
    if (
      nativeValue !== undefined &&
      nativeValue !== this.sponsorshipForm.controls[field].value
    ) {
      values[field] = nativeValue;
    }
  }

  private controlError(field: SponsorshipFollowupFormField): string {
    const control = this.sponsorshipForm.controls[field];
    if (!control.errors) {
      return '';
    }

    if (control.errors['required']) {
      return field === 'companyName'
        ? "Le nom de l'entreprise est requis."
        : field === 'contactName'
          ? 'Le nom du contact est requis.'
          : 'Le courriel du contact est requis.';
    }

    if (control.errors['email']) {
      return 'Le courriel du contact doit etre valide.';
    }

    if (control.errors['httpsUrl']) {
      return field === 'websiteUrl'
        ? 'Le site web doit commencer par https://.'
        : 'Le lien du logo doit commencer par https://.';
    }

    if (control.errors['maxlength']) {
      return 'Ce champ depasse la longueur permise.';
    }

    return '';
  }

  private bumpFormRevision(): void {
    this.formRevision.update((revision) => revision + 1);
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
