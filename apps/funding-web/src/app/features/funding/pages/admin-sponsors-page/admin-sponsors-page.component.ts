import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  DEFAULT_SPONSORSHIP_PRICING_CONFIG,
  resolveSponsorshipBenefits
} from '@openg7/funding-core';
import type {
  AdminAuditLogEntry,
  AdminSponsorshipRejectionRefundHandling,
  AdminPagination,
  AdminSponsorshipRecord,
  AdminSponsorshipRefundResult,
  AdminSponsorshipReviewResult,
  SponsorFeedChannel,
  SponsorFeedStatus,
  SponsorFeedTarget,
  SponsorshipBenefitId,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

import { AdminNavComponent } from '../../components/admin-nav/admin-nav.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

const feedStatuses: readonly SponsorFeedStatus[] = [
  'not_planned',
  'planned',
  'drafted',
  'published'
];

interface SponsorshipPublicationDraft {
  readonly publicSlug: string;
  readonly publicSummary: string;
  readonly feedTarget: '' | SponsorFeedTarget;
  readonly facebook: boolean;
  readonly linkedin: boolean;
  readonly feedStatus: SponsorFeedStatus;
  readonly feedPublicUrl: string;
  readonly feedNotes: string;
}

type SponsorshipPublicationTextField =
  | 'publicSlug'
  | 'publicSummary'
  | 'feedTarget'
  | 'feedStatus'
  | 'feedPublicUrl'
  | 'feedNotes';
type SponsorshipReviewFilter = 'all' | SponsorshipReviewStatus;
type SponsorFeedStatusFilter = 'all' | SponsorFeedStatus;
type SponsorPaymentStatusFilter = 'all' | 'paid' | 'refunded' | 'disputed';
type SponsorDetailsTab = 'overview' | 'identity' | 'publication' | 'audit';
type SponsorProcessingState =
  | 'action-required'
  | 'approved-ready'
  | 'publication-progress'
  | 'published'
  | 'blocked'
  | 'waiting-payment';
type SponsorshipPublicationChannel = Extract<
  SponsorFeedChannel,
  'facebook' | 'linkedin'
>;

interface SponsorAuditEntry {
  readonly id: string;
  readonly date: string;
  readonly label: string;
  readonly detail?: string;
}

interface SponsorRejectionDraft {
  readonly notifySponsor: boolean;
  readonly recipientEmail: string;
  readonly sponsorMessage: string;
  readonly refundHandling: AdminSponsorshipRejectionRefundHandling;
  readonly refundNote: string;
}

interface SponsorRefundDraft {
  readonly confirmationText: string;
  readonly notifySponsor: boolean;
  readonly recipientEmail: string;
  readonly sponsorMessage: string;
  readonly refundNote: string;
}

const pageSizeOptions = [6, 10, 25] as const;
const defaultPagination: AdminPagination = {
  page: 1,
  pageSize: 6,
  totalItems: 0,
  totalPages: 1,
  hasPreviousPage: false,
  hasNextPage: false
};
const benefitFeedChannelMap: Partial<
  Record<SponsorshipBenefitId, SponsorshipPublicationChannel>
> = {
  facebook_batch: 'facebook',
  linkedin_batch: 'linkedin'
};
const sponsorLogoMaxBytes = 512 * 1024;
const sponsorLogoMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const controlledSponsorLogoUrlPrefixes = [
  '/api/public/sponsor-logos/',
  '/public/sponsor-logos/'
];

@Component({
  selector: 'openg7-admin-sponsors-page',
  standalone: true,
  imports: [CommonModule, RouterLink, AdminNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="admin-shell">
      <openg7-admin-nav />

      <section class="admin-workspace">
        <header class="admin-page-header">
          <nav class="admin-breadcrumb" aria-label="Fil d'Ariane admin">
            <a routerLink="/admin/fundraiser">Accueil</a>
            <span aria-hidden="true">/</span>
            <a routerLink="/admin/fundraiser">Fundraiser</a>
            <span aria-hidden="true">/</span>
            <strong>Commanditaires</strong>
          </nav>

          <div class="admin-title-row">
            <div>
              <span class="admin-kicker">Administration</span>
              <h1>Commanditaires / partenaires</h1>
              <p>
                Gestion des organisations commanditaires, statut de revue et
                visibilite publique.
              </p>
            </div>

            <div class="admin-actions">
              <button
                type="button"
                class="secondary-action"
                (click)="loadSponsorships()"
                [disabled]="state() === 'loading'"
              >
                Actualiser
              </button>
              <a class="primary-action" routerLink="/fonds-des-batisseurs"
                >Retour public</a
              >
            </div>
          </div>
        </header>

        <section class="admin-summary-grid" aria-label="Resume des commandites">
          <article>
            <span class="metric-mark">TO</span>
            <div>
              <span>Total commanditaires</span
              ><strong>{{ pagination().totalItems }}</strong
              ><small>Toutes organisations</small>
            </div>
          </article>
          <article>
            <span class="metric-mark gold">VI</span>
            <div>
              <span>Visibles publiquement</span
              ><strong>{{ visibleCount() }}</strong
              ><small>Affichees ou publiees</small>
            </div>
          </article>
          <article>
            <span class="metric-mark green">AC</span>
            <div>
              <span>Commanditaires actifs</span
              ><strong>{{ activeCount() }}</strong
              ><small>Avec paiement confirme</small>
            </div>
          </article>
          <article>
            <span class="metric-mark money">CA</span>
            <div>
              <span>Contribution totale</span
              ><strong>{{ formatSummaryMoney(totalContribution()) }}</strong
              ><small>Paiements confirmes</small>
            </div>
          </article>
        </section>

        <section class="sponsors-board" aria-label="Commandites admin">
          <section
            class="sponsors-list-panel"
            aria-label="Liste des commandites"
          >
            <header class="admin-table-toolbar">
              <label class="search-control">
                Recherche
                <input
                  type="search"
                  placeholder="Rechercher une entreprise ou un courriel..."
                  [value]="search()"
                  (input)="setSearch($event)"
                />
              </label>

              <div class="filter-row">
                <label>
                  Statut de revue
                  <select
                    [value]="reviewFilter()"
                    (change)="setReviewFilter($event)"
                  >
                    <option value="all">Tous</option>
                    <option value="pending_review">En attente</option>
                    <option value="approved">Approuvees</option>
                    <option value="rejected">Refusees</option>
                  </select>
                </label>

                <label>
                  Visibilite / statut feed
                  <select
                    [value]="feedFilter()"
                    (change)="setFeedFilter($event)"
                  >
                    <option value="all">Tous</option>
                    <option
                      *ngFor="let status of feedStatuses"
                      [value]="status"
                    >
                      {{ feedStatusLabel(status) }}
                    </option>
                  </select>
                </label>

                <label>
                  Paiement
                  <select
                    [value]="paymentFilter()"
                    (change)="setPaymentFilter($event)"
                  >
                    <option value="all">Tous</option>
                    <option value="paid">Paye</option>
                    <option value="refunded">Rembourse</option>
                    <option value="disputed">Litige</option>
                  </select>
                </label>

                <button
                  type="button"
                  class="tertiary-action"
                  (click)="resetFilters()"
                  [disabled]="!hasActiveFilters()"
                >
                  Reinitialiser
                </button>
              </div>
            </header>

            <div
              class="state state-loading"
              *ngIf="state() === 'loading'"
              aria-live="polite"
            >
              <span>Chargement des commandites...</span>
              <div class="skeleton-list" aria-hidden="true">
                <span></span><span></span><span></span>
              </div>
            </div>

            <div class="state state-error" *ngIf="state() === 'error'">
              <strong>Impossible de charger les commandites.</strong>
              <span>Les donnees n'ont pas pu etre recuperees.</span>
              <button
                type="button"
                class="secondary-action"
                (click)="loadSponsorships()"
              >
                Reessayer
              </button>
            </div>

            <ng-container *ngIf="state() !== 'loading' && state() !== 'error'">
              <div
                class="sponsor-table"
                *ngIf="filteredSponsorships().length > 0"
              >
                <div class="sponsor-table-head" aria-hidden="true">
                  <span>Commanditaire</span><span>Commandite</span
                  ><span>Revue</span><span>Publication</span
                  ><span>Paiement</span><span>Soumission</span><span></span>
                </div>

                <button
                  type="button"
                  class="sponsor-table-row"
                  [ngClass]="sponsorshipRowStateClass(sponsorship)"
                  [attr.title]="sponsorshipProcessingLabel(sponsorship)"
                  [class.selection-pulse]="
                    selectionPulseId() === sponsorship.id
                  "
                  *ngFor="
                    let sponsorship of paginatedSponsorships();
                    trackBy: trackById
                  "
                  [class.selected]="
                    selectedSponsorship()?.id === sponsorship.id
                  "
                  [attr.aria-current]="
                    selectedSponsorship()?.id === sponsorship.id ? 'true' : null
                  "
                  (click)="selectSponsorship(sponsorship)"
                >
                  <span class="row-cell sponsor-main">
                    <span class="sponsor-avatar" aria-hidden="true">{{
                      initialsFor(sponsorship)
                    }}</span>
                    <span
                      ><strong>{{
                        sponsorship.sponsor_company_name ||
                          'Entreprise sans nom'
                      }}</strong
                      ><small>{{
                        sponsorship.sponsor_contact_email ||
                          'Courriel non fourni'
                      }}</small></span
                    >
                  </span>
                  <span class="row-cell amount-cell"
                    ><strong>{{ formatMoney(sponsorship) }}</strong
                    ><small [class]="tierClass(sponsorship)">{{
                      sponsorshipTierLabel(sponsorship)
                    }}</small></span
                  >
                  <span class="row-cell stacked-cell"
                    ><span
                      [class]="statusClass(sponsorship.sponsor_review_status)"
                      >{{
                        reviewStatusLabel(sponsorship.sponsor_review_status)
                      }}</span
                    ><span [class]="visibilityClass(sponsorship)">{{
                      visibilityLabel(sponsorship)
                    }}</span></span
                  >
                  <span class="row-cell stacked-cell"
                    ><span
                      [class]="feedStatusClass(sponsorship.sponsor_feed_status)"
                      >{{
                        feedStatusLabel(sponsorship.sponsor_feed_status)
                      }}</span
                    ><small>{{ feedTargetLabel(sponsorship) }}</small
                    ><small>{{ feedChannelsLabel(sponsorship) }}</small></span
                  >
                  <span class="row-cell stacked-cell"
                    ><span
                      [class]="paymentStatusClass(sponsorship.payment_status)"
                      >{{
                        paymentStatusLabel(sponsorship.payment_status)
                      }}</span
                    ><small>{{
                      dateOnlyLabel(sponsorship.paid_at)
                    }}</small></span
                  >
                  <span class="row-cell stacked-cell"
                    ><small>Soumis le</small
                    ><span>{{
                      dateOnlyLabel(submittedAt(sponsorship))
                    }}</span></span
                  >
                  <span class="row-cell row-open" aria-hidden="true">›</span>
                </button>
              </div>

              <article
                class="empty-admin-state"
                *ngIf="
                  state() === 'ready' &&
                  sponsorships().length === 0 &&
                  !hasActiveFilters()
                "
              >
                <h2>Toutes les commandites ont ete revisees.</h2>
                <p>
                  Il n'y a actuellement aucune nouvelle commandite a traiter.
                </p>
              </article>

              <article
                class="empty-admin-state"
                *ngIf="
                  state() === 'ready' &&
                  sponsorships().length === 0 &&
                  hasActiveFilters()
                "
              >
                <h2>Aucune commandite ne correspond aux filtres.</h2>
                <p>Reinitialisez les filtres ou elargissez la recherche.</p>
                <button
                  type="button"
                  class="secondary-action"
                  (click)="resetFilters()"
                >
                  Reinitialiser les filtres
                </button>
              </article>

              <footer
                class="pagination-bar"
                *ngIf="filteredSponsorships().length > 0"
              >
                <span
                  >Affichage de {{ paginationStart() }} a
                  {{ paginationEnd() }} sur
                  {{ pagination().totalItems }} resultats</span
                >
                <div class="pagination-controls">
                  <button
                    type="button"
                    class="icon-action"
                    (click)="previousPage()"
                    [disabled]="normalizedPage() <= 1"
                    aria-label="Page precedente"
                  >
                    ‹
                  </button>
                  <strong>{{ normalizedPage() }}</strong>
                  <button
                    type="button"
                    class="icon-action"
                    (click)="nextPage()"
                    [disabled]="normalizedPage() >= totalPages()"
                    aria-label="Page suivante"
                  >
                    ›
                  </button>
                </div>
                <label
                  ><span>Par page</span
                  ><select [value]="pageSize()" (change)="setPageSize($event)">
                    <option *ngFor="let size of pageSizeOptions" [value]="size">
                      {{ size }}
                    </option>
                  </select></label
                >
              </footer>
            </ng-container>
          </section>

          <aside
            #sponsorDetailPanel
            class="sponsor-detail-panel"
            [class.is-empty]="!selectedSponsorship()"
            [class.selection-pulse]="
              selectedSponsorship() &&
              selectionPulseId() === selectedSponsorship()?.id
            "
            aria-label="Dossier commanditaire selectionne"
          >
            <ng-container
              *ngIf="selectedSponsorship() as selected; else noSelection"
            >
              <header class="detail-header">
                <div class="detail-title">
                  <span class="sponsor-avatar large" aria-hidden="true">{{
                    initialsFor(selected)
                  }}</span>
                  <div>
                    <h2>
                      {{
                        selected.sponsor_company_name || 'Entreprise sans nom'
                      }}
                    </h2>
                    <p>
                      {{ formatMoney(selected) }} ·
                      {{ sponsorshipTierLabel(selected) }}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  class="icon-action close-detail"
                  (click)="closeDetails()"
                  aria-label="Fermer le dossier"
                >
                  ×
                </button>
                <div class="detail-badges">
                  <span [class]="statusClass(selected.sponsor_review_status)">{{
                    reviewStatusLabel(selected.sponsor_review_status)
                  }}</span
                  ><span [class]="visibilityClass(selected)">{{
                    visibilityLabel(selected)
                  }}</span
                  ><span
                    [class]="paymentStatusClass(selected.payment_status)"
                    >{{ paymentStatusLabel(selected.payment_status) }}</span
                  >
                </div>
                <dl class="detail-meta">
                  <div>
                    <dt>Reference publique</dt>
                    <dd>{{ selected.public_reference || 'Non attribuee' }}</dd>
                  </div>
                  <div>
                    <dt>Soumis le</dt>
                    <dd>{{ dateOnlyLabel(submittedAt(selected)) }}</dd>
                  </div>
                  <div>
                    <dt>Derniere revue</dt>
                    <dd>{{ dateOnlyLabel(selected.sponsor_reviewed_at) }}</dd>
                  </div>
                </dl>
              </header>

              <p
                class="payment-alert"
                *ngIf="paymentEligibilityMessage(selected)"
                role="alert"
              >
                {{ paymentEligibilityMessage(selected) }}
              </p>

              <nav class="detail-tabs" aria-label="Onglets du dossier">
                <button
                  type="button"
                  [class.active]="activeTab() === 'overview'"
                  (click)="setActiveTab('overview')"
                >
                  Vue d'ensemble
                </button>
                <button
                  type="button"
                  [class.active]="activeTab() === 'identity'"
                  (click)="setActiveTab('identity')"
                >
                  Identite & logo
                </button>
                <button
                  type="button"
                  [class.active]="activeTab() === 'publication'"
                  (click)="setActiveTab('publication')"
                >
                  Publication
                </button>
                <button
                  type="button"
                  [class.active]="activeTab() === 'audit'"
                  (click)="setActiveTab('audit')"
                >
                  Historique & audit
                </button>
              </nav>

              <section
                class="detail-body"
                *ngIf="activeTab() === 'overview'"
                aria-label="Vue d'ensemble"
              >
                <div class="detail-card-grid">
                  <article class="detail-card">
                    <h3>Entreprise & contact</h3>
                    <dl>
                      <div>
                        <dt>Nom de l'entreprise</dt>
                        <dd>
                          {{
                            selected.sponsor_company_name ||
                              'Entreprise sans nom'
                          }}
                        </dd>
                      </div>
                      <div>
                        <dt>Nom public</dt>
                        <dd>{{ publicNameLabel(selected) }}</dd>
                      </div>
                      <div>
                        <dt>Contact</dt>
                        <dd>
                          {{ selected.sponsor_contact_name || 'Non fourni' }}
                        </dd>
                      </div>
                      <div>
                        <dt>Courriel</dt>
                        <dd>
                          <a
                            *ngIf="
                              selected.sponsor_contact_email;
                              else emptyEmail
                            "
                            [href]="'mailto:' + selected.sponsor_contact_email"
                            >{{ selected.sponsor_contact_email }}</a
                          ><ng-template #emptyEmail>Non fourni</ng-template>
                        </dd>
                      </div>
                      <div>
                        <dt>Site web</dt>
                        <dd>
                          <a
                            *ngIf="
                              selected.sponsor_website_url;
                              else emptyWebsiteOverview
                            "
                            [href]="selected.sponsor_website_url"
                            target="_blank"
                            rel="noreferrer"
                            >{{ selected.sponsor_website_url }}</a
                          ><ng-template #emptyWebsiteOverview
                            >Non fourni</ng-template
                          >
                        </dd>
                      </div>
                      <div>
                        <dt>Reference publique</dt>
                        <dd class="copy-line">
                          <code>{{
                            selected.public_reference || 'Non attribuee'
                          }}</code
                          ><button
                            type="button"
                            class="mini-action"
                            (click)="copyReference(selected)"
                            [disabled]="!selected.public_reference"
                          >
                            Copier
                          </button>
                        </dd>
                      </div>
                    </dl>
                    <small
                      class="inline-status"
                      *ngIf="copyMessageFor(selected.id)"
                      >{{ copyMessageFor(selected.id) }}</small
                    >
                  </article>

                  <article class="detail-card">
                    <h3>Commandite</h3>
                    <dl>
                      <div>
                        <dt>Montant</dt>
                        <dd>{{ formatMoney(selected) }}</dd>
                      </div>
                      <div>
                        <dt>Niveau / tier</dt>
                        <dd>
                          <span [class]="tierClass(selected)">{{
                            sponsorshipTierLabel(selected)
                          }}</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Avantages</dt>
                        <dd>{{ sponsorshipBenefitsLabel(selected) }}</dd>
                      </div>
                      <div>
                        <dt>Paiement</dt>
                        <dd>
                          <span
                            [class]="
                              paymentStatusClass(selected.payment_status)
                            "
                            >{{
                              paymentStatusLabel(selected.payment_status)
                            }}</span
                          >
                        </dd>
                      </div>
                      <div>
                        <dt>Date de paiement</dt>
                        <dd>{{ dateOnlyLabel(selected.paid_at) }}</dd>
                      </div>
                    </dl>
                  </article>
                </div>

                <article class="detail-card" *ngIf="selected.sponsor_message">
                  <h3>Message du commanditaire</h3>
                  <p>{{ selected.sponsor_message }}</p>
                </article>

                <article class="detail-card">
                  <h3>Note interne</h3>
                  <label class="review-note-label"
                    >Note visible uniquement pour l'administration.<textarea
                      rows="5"
                      maxlength="1000"
                      [value]="reviewNoteFor(selected.id)"
                      (input)="setReviewNote(selected.id, $event)"
                    ></textarea>
                  </label>
                  <div class="form-footer">
                    <span
                      class="inline-status"
                      [class.is-dirty]="isReviewNoteDirty(selected)"
                      aria-live="polite"
                      >{{ reviewNoteStateLabel(selected) }}</span
                    ><button
                      type="button"
                      class="secondary-action"
                      (click)="saveReviewNote(selected)"
                      [disabled]="
                        !isReviewNoteDirty(selected) ||
                        isActionPending(noteActionId(selected.id))
                      "
                    >
                      {{
                        isActionPending(noteActionId(selected.id))
                          ? 'Enregistrement...'
                          : 'Enregistrer la note'
                      }}
                    </button>
                  </div>
                </article>
              </section>

              <section
                class="detail-body"
                *ngIf="activeTab() === 'identity'"
                aria-label="Identite et logo"
              >
                <article class="detail-card">
                  <h3>Logo actuel</h3>
                  <figure
                    class="logo-preview large-preview"
                    *ngIf="logoPreviewSourceFor(selected); else noLogoPreview"
                  >
                    <img
                      [src]="logoPreviewSourceFor(selected)"
                      [alt]="
                        'Logo ' +
                        (selected.sponsor_company_name || 'commanditaire')
                      "
                    />
                  </figure>
                  <ng-template #noLogoPreview
                    ><p class="muted-copy">
                      Aucun logo disponible.
                    </p></ng-template
                  >
                  <dl class="compact-definition-list">
                    <div>
                      <dt>URL du logo</dt>
                      <dd>
                        <a
                          *ngIf="selected.sponsor_logo_url; else emptyLogoUrl"
                          [href]="selected.sponsor_logo_url"
                          target="_blank"
                          rel="noreferrer"
                          >{{ selected.sponsor_logo_url }}</a
                        ><ng-template #emptyLogoUrl>Non fourni</ng-template>
                      </dd>
                    </div>
                    <div>
                      <dt>Nom public</dt>
                      <dd>{{ publicNameLabel(selected) }}</dd>
                    </div>
                    <div>
                      <dt>Site web public</dt>
                      <dd>
                        {{ selected.sponsor_website_url || 'Non fourni' }}
                      </dd>
                    </div>
                  </dl>
                  <div class="logo-actions">
                    <label class="logo-upload-control"
                      >{{
                        selected.sponsor_logo_url
                          ? 'Remplacer le logo'
                          : 'Televerser un logo'
                      }}<input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        [disabled]="
                          isActionPending(logoActionId(selected.id)) ||
                          isActionPending(deleteLogoActionId(selected.id))
                        "
                        (change)="uploadLogo(selected, $event)" /></label
                    ><button
                      type="button"
                      class="secondary-danger-action"
                      [disabled]="
                        !selected.sponsor_logo_url ||
                        isActionPending(deleteLogoActionId(selected.id)) ||
                        isActionPending(logoActionId(selected.id))
                      "
                      (click)="deleteLogo(selected)"
                    >
                      Supprimer le logo
                    </button>
                  </div>
                  <small class="inline-status" aria-live="polite">{{
                    logoUploadMessageFor(selected.id) ||
                      'Formats acceptes: PNG, JPEG ou WebP, max 512 KiB.'
                  }}</small>
                </article>
              </section>

              <section
                class="detail-body"
                *ngIf="activeTab() === 'publication'"
                aria-label="Publication"
              >
                <article class="detail-card publication-editor">
                  <header>
                    <div>
                      <span>Publication</span>
                      <h3>Commanditaire et feeds</h3>
                    </div>
                    <button
                      type="button"
                      class="publication-save"
                      [disabled]="
                        !publicationDirtyFor(selected) ||
                        hasSlugError(selected) ||
                        !canSavePublication(selected) ||
                        isActionPending(publicationActionId(selected.id))
                      "
                      (click)="savePublication(selected)"
                    >
                      {{
                        isActionPending(publicationActionId(selected.id))
                          ? 'Enregistrement...'
                          : 'Enregistrer'
                      }}
                    </button>
                  </header>
                  <p
                    class="inline-status"
                    [class.is-dirty]="publicationDirtyFor(selected)"
                    aria-live="polite"
                  >
                    {{ publicationStateLabel(selected) }}
                  </p>
                  <div class="publication-grid">
                    <label
                      >Slug public<input
                        type="text"
                        maxlength="120"
                        [value]="publicationDraftFor(selected.id).publicSlug"
                        (input)="
                          setPublicationField(selected.id, 'publicSlug', $event)
                        "
                        [attr.aria-invalid]="
                          slugErrorFor(selected) ? 'true' : null
                        "
                      /><small
                        class="field-error"
                        *ngIf="slugErrorFor(selected)"
                        >{{ slugErrorFor(selected) }}</small
                      ></label
                    >
                    <label
                      >Destination feed<select
                        [value]="publicationDraftFor(selected.id).feedTarget"
                        (change)="
                          setPublicationField(selected.id, 'feedTarget', $event)
                        "
                      >
                        <option value="">Aucune</option>
                        <option value="openg7">OpenG7</option>
                        <option value="openg20">OpenG20</option>
                      </select></label
                    >
                    <label
                      >Statut feed<select
                        [value]="publicationDraftFor(selected.id).feedStatus"
                        (change)="
                          setPublicationField(selected.id, 'feedStatus', $event)
                        "
                      >
                        <option
                          *ngFor="let status of feedStatuses"
                          [value]="status"
                        >
                          {{ feedStatusLabel(status) }}
                        </option>
                      </select></label
                    >
                    <fieldset>
                      <legend>Canaux</legend>
                      <label
                        ><input
                          type="checkbox"
                          [checked]="publicationDraftFor(selected.id).facebook"
                          [disabled]="
                            isPromisedFeedChannel(selected, 'facebook')
                          "
                          [attr.title]="
                            isPromisedFeedChannel(selected, 'facebook')
                              ? 'Canal inclus par le palier de contribution'
                              : null
                          "
                          (change)="
                            setPublicationChannel(
                              selected.id,
                              'facebook',
                              $event
                            )
                          "
                        />
                        Facebook</label
                      ><label
                        ><input
                          type="checkbox"
                          [checked]="publicationDraftFor(selected.id).linkedin"
                          [disabled]="
                            isPromisedFeedChannel(selected, 'linkedin')
                          "
                          [attr.title]="
                            isPromisedFeedChannel(selected, 'linkedin')
                              ? 'Canal inclus par le palier de contribution'
                              : null
                          "
                          (change)="
                            setPublicationChannel(
                              selected.id,
                              'linkedin',
                              $event
                            )
                          "
                        />
                        LinkedIn</label
                      >
                    </fieldset>
                    <label class="publication-span-2"
                      >Resume public<textarea
                        rows="4"
                        maxlength="500"
                        [value]="publicationDraftFor(selected.id).publicSummary"
                        (input)="
                          setPublicationField(
                            selected.id,
                            'publicSummary',
                            $event
                          )
                        "
                      ></textarea>
                    </label>
                    <label
                      >Lien de publication<input
                        type="url"
                        maxlength="2048"
                        [value]="publicationDraftFor(selected.id).feedPublicUrl"
                        (input)="
                          setPublicationField(
                            selected.id,
                            'feedPublicUrl',
                            $event
                          )
                        "
                    /></label>
                    <label class="publication-span-2"
                      >Notes feed<textarea
                        rows="4"
                        maxlength="1000"
                        [value]="publicationDraftFor(selected.id).feedNotes"
                        (input)="
                          setPublicationField(selected.id, 'feedNotes', $event)
                        "
                      ></textarea>
                    </label>
                  </div>
                </article>

                <article class="detail-card public-preview">
                  <span>Previsualisation non publiee</span>
                  <div>
                    <figure
                      class="logo-preview"
                      *ngIf="logoPreviewSourceFor(selected)"
                    >
                      <img
                        [src]="logoPreviewSourceFor(selected)"
                        [alt]="
                          'Logo ' +
                          (selected.sponsor_company_name || 'commanditaire')
                        "
                      />
                    </figure>
                    <div>
                      <h3>{{ publicNameLabel(selected) }}</h3>
                      <p>
                        {{
                          publicationDraftFor(selected.id).publicSummary ||
                            'Aucun resume public pour le moment.'
                        }}
                      </p>
                    </div>
                  </div>
                  <dl class="compact-definition-list">
                    <div>
                      <dt>Destination</dt>
                      <dd>
                        {{
                          publicationDraftFor(selected.id).feedTarget ||
                            'Aucune'
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>Canaux</dt>
                      <dd>{{ draftChannelsLabel(selected.id) }}</dd>
                    </div>
                    <div>
                      <dt>Lien</dt>
                      <dd>
                        {{
                          publicationDraftFor(selected.id).feedPublicUrl ||
                            'Non defini'
                        }}
                      </dd>
                    </div>
                  </dl>
                </article>
              </section>

              <section
                class="detail-body"
                *ngIf="activeTab() === 'audit'"
                aria-label="Historique et audit"
              >
                <article class="detail-card">
                  <h3>Historique disponible</h3>
                  <ol
                    class="audit-list"
                    *ngIf="auditEntriesFor(selected).length > 0; else noAudit"
                  >
                    <li
                      *ngFor="
                        let entry of auditEntriesFor(selected);
                        trackBy: trackByAuditEntry
                      "
                    >
                      <time>{{ dateTimeLabel(entry.date) }}</time>
                      <p>{{ entry.label }}</p>
                      <small *ngIf="entry.detail">{{ entry.detail }}</small>
                    </li>
                  </ol>
                  <ng-template #noAudit
                    ><p class="muted-copy">
                      Aucun historique administratif detaille n'est encore
                      disponible pour ce dossier.
                    </p></ng-template
                  >
                  <p class="muted-copy">
                    Les actions admin proviennent du journal prive et restent
                    limitees a cette commandite.
                  </p>
                </article>
              </section>

              <section
                class="rejection-workflow"
                *ngIf="isRejectionPanelOpen(selected)"
                aria-label="Refus de commandite"
              >
                <header>
                  <div>
                    <span>Action sensible</span>
                    <h3>Refuser la commandite</h3>
                  </div>
                  <button
                    type="button"
                    class="icon-action"
                    (click)="closeRejectionPanel()"
                    aria-label="Fermer le refus"
                  >
                    ×
                  </button>
                </header>

                <label class="rejection-span-2"
                  >Raison interne du refus *<textarea
                    rows="4"
                    maxlength="1000"
                    [value]="reviewNoteFor(selected.id)"
                    (input)="setReviewNote(selected.id, $event)"
                  ></textarea>
                </label>

                <label class="rejection-span-2"
                  >Message au commanditaire *<textarea
                    rows="5"
                    maxlength="1000"
                    [value]="rejectionDraftFor(selected).sponsorMessage"
                    (input)="
                      setRejectionDraftField(
                        selected.id,
                        'sponsorMessage',
                        $event
                      )
                    "
                  ></textarea>
                </label>

                <label class="checkbox-line rejection-span-2">
                  <input
                    type="checkbox"
                    [checked]="rejectionDraftFor(selected).notifySponsor"
                    (change)="
                      setRejectionDraftBoolean(
                        selected.id,
                        'notifySponsor',
                        $event
                      )
                    "
                  />
                  Envoyer le courriel de refus
                </label>

                <label
                  >Destinataire<input
                    type="email"
                    autocomplete="email"
                    [disabled]="!rejectionDraftFor(selected).notifySponsor"
                    [value]="rejectionDraftFor(selected).recipientEmail"
                    (input)="
                      setRejectionDraftField(
                        selected.id,
                        'recipientEmail',
                        $event
                      )
                    "
                /></label>

                <label
                  >Remboursement<select
                    [value]="rejectionDraftFor(selected).refundHandling"
                    (change)="setRejectionRefundHandling(selected.id, $event)"
                  >
                    <option value="none">Ne pas rembourser maintenant</option>
                    <option value="manual_required">
                      A traiter manuellement dans Stripe
                    </option>
                    <option value="manual_completed">
                      Deja rembourse manuellement
                    </option>
                  </select></label
                >

                <label class="rejection-span-2"
                  >Note remboursement<textarea
                    rows="3"
                    maxlength="1000"
                    [value]="rejectionDraftFor(selected).refundNote"
                    (input)="
                      setRejectionDraftField(selected.id, 'refundNote', $event)
                    "
                  ></textarea>
                </label>

                <footer>
                  <span class="inline-status" aria-live="polite">{{
                    rejectionValidationMessage(selected)
                  }}</span>
                  <button
                    type="button"
                    class="secondary-action"
                    (click)="closeRejectionPanel()"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    class="review-button reject"
                    [disabled]="
                      !canConfirmRejection(selected) ||
                      isAnyActionPending(selected.id)
                    "
                    (click)="confirmRejection(selected)"
                  >
                    {{
                      isActionPending(reviewActionId(selected.id))
                        ? 'Refus en cours...'
                        : 'Confirmer le refus'
                    }}
                  </button>
                </footer>
              </section>

              <section
                class="refund-workflow"
                *ngIf="isRefundPanelOpen(selected)"
                aria-label="Remboursement Stripe"
              >
                <header>
                  <div>
                    <span>Stripe</span>
                    <h3>Remboursement complet</h3>
                  </div>
                  <button
                    type="button"
                    class="icon-action"
                    (click)="closeRefundPanel()"
                    aria-label="Fermer le remboursement"
                  >
                    ×
                  </button>
                </header>

                <p class="refund-warning rejection-span-2">
                  Cette action declenche un remboursement Stripe complet de
                  {{ formatMoney(selected) }}. Elle est envoyee a Stripe
                  immediatement.
                </p>

                <label class="rejection-span-2"
                  >Texte de confirmation
                  <small
                    >Recopiez
                    <code>{{ refundConfirmationText(selected) }}</code></small
                  ><input
                    type="text"
                    autocomplete="off"
                    [value]="refundDraftFor(selected).confirmationText"
                    (input)="
                      setRefundDraftField(
                        selected.id,
                        'confirmationText',
                        $event
                      )
                    "
                /></label>

                <label class="checkbox-line rejection-span-2">
                  <input
                    type="checkbox"
                    [checked]="refundDraftFor(selected).notifySponsor"
                    (change)="
                      setRefundDraftBoolean(
                        selected.id,
                        'notifySponsor',
                        $event
                      )
                    "
                  />
                  Envoyer le courriel de remboursement
                </label>

                <label
                  >Destinataire<input
                    type="email"
                    autocomplete="email"
                    [disabled]="!refundDraftFor(selected).notifySponsor"
                    [value]="refundDraftFor(selected).recipientEmail"
                    (input)="
                      setRefundDraftField(selected.id, 'recipientEmail', $event)
                    "
                /></label>

                <label
                  >Message au commanditaire<textarea
                    rows="4"
                    maxlength="1000"
                    [disabled]="!refundDraftFor(selected).notifySponsor"
                    [value]="refundDraftFor(selected).sponsorMessage"
                    (input)="
                      setRefundDraftField(selected.id, 'sponsorMessage', $event)
                    "
                  ></textarea>
                </label>

                <label class="rejection-span-2"
                  >Note remboursement<textarea
                    rows="3"
                    maxlength="1000"
                    [value]="refundDraftFor(selected).refundNote"
                    (input)="
                      setRefundDraftField(selected.id, 'refundNote', $event)
                    "
                  ></textarea>
                </label>

                <footer>
                  <span class="inline-status" aria-live="polite">{{
                    refundValidationMessage(selected)
                  }}</span>
                  <button
                    type="button"
                    class="secondary-action"
                    (click)="closeRefundPanel()"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    class="review-button refund"
                    [disabled]="
                      !canConfirmRefund(selected) ||
                      isAnyActionPending(selected.id)
                    "
                    (click)="confirmRefund(selected)"
                  >
                    {{
                      isActionPending(refundActionId(selected.id))
                        ? 'Remboursement...'
                        : 'Rembourser Stripe'
                    }}
                  </button>
                </footer>
              </section>

              <footer class="detail-actions">
                <p
                  class="review-toast"
                  *ngIf="reviewMessageFor(selected.id)"
                  role="status"
                  aria-live="polite"
                >
                  {{ reviewMessageFor(selected.id) }}
                </p>
                <button
                  type="button"
                  class="review-button neutral"
                  [disabled]="isAnyActionPending(selected.id)"
                  (click)="review(selected, 'pending_review')"
                >
                  Remettre en attente
                </button>
                <button
                  type="button"
                  class="review-button reject"
                  [disabled]="isAnyActionPending(selected.id)"
                  (click)="openRejectionPanel(selected)"
                >
                  Refuser
                </button>
                <button
                  type="button"
                  class="review-button refund"
                  [disabled]="
                    isAnyActionPending(selected.id) ||
                    !canRefundSponsorship(selected)
                  "
                  (click)="openRefundPanel(selected)"
                >
                  Rembourser Stripe
                </button>
                <button
                  type="button"
                  class="review-button approve"
                  [disabled]="
                    isAnyActionPending(selected.id) ||
                    !canApproveSponsorship(selected)
                  "
                  (click)="review(selected, 'approved')"
                >
                  Accepter
                </button>
              </footer>
            </ng-container>

            <ng-template #noSelection
              ><article class="empty-detail-state">
                <h2>Aucun commanditaire selectionne</h2>
                <p>
                  Selectionnez une ligne dans la liste pour ouvrir le dossier,
                  reviser la commandite et preparer sa publication.
                </p>
              </article></ng-template
            >
          </aside>
        </section>
      </section>
    </main>
  `,
  styles: [
    `
      .admin-shell {
        background: #f6f8fc;
        color: #111827;
        display: grid;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        gap: 1.25rem;
        grid-template-columns: 15rem minmax(0, 1fr);
        min-height: 100vh;
        padding: 1.25rem;
      }

      .admin-workspace {
        display: grid;
        gap: 1rem;
        min-width: 0;
      }

      .admin-page-header,
      .admin-summary-grid,
      .sponsors-board {
        width: 100%;
      }

      .admin-page-header {
        display: grid;
        gap: 1rem;
      }

      .admin-breadcrumb,
      .admin-title-row,
      .admin-actions,
      .filter-row,
      .pagination-controls,
      .detail-badges,
      .logo-actions,
      .form-footer {
        align-items: center;
        display: flex;
        gap: 0.75rem;
      }

      .admin-breadcrumb {
        color: #667085;
        font-size: 0.84rem;
      }

      .admin-breadcrumb a,
      .admin-breadcrumb strong {
        color: inherit;
        font-weight: 800;
        text-decoration: none;
      }

      .admin-title-row {
        align-items: end;
        justify-content: space-between;
      }

      .admin-title-row h1,
      .detail-header h2,
      .detail-card h3,
      .empty-admin-state h2,
      .empty-detail-state h2 {
        margin: 0;
      }

      .admin-title-row h1 {
        font-size: clamp(1.9rem, 3vw, 2.45rem);
        line-height: 1.05;
      }

      .admin-title-row p,
      .muted-copy,
      .empty-admin-state p,
      .empty-detail-state p {
        color: #566274;
        line-height: 1.55;
        margin: 0.35rem 0 0;
      }

      .admin-kicker,
      .admin-summary-grid article span:not(.metric-mark),
      dt,
      .publication-editor header span,
      .public-preview > span {
        color: #667085;
        font-size: 0.76rem;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      button,
      input,
      select,
      textarea {
        font: inherit;
      }

      button:focus-visible,
      a:focus-visible,
      input:focus-visible,
      select:focus-visible,
      textarea:focus-visible {
        outline: 3px solid rgba(37, 99, 235, 0.28);
        outline-offset: 2px;
      }

      .primary-action,
      .secondary-action,
      .tertiary-action,
      .secondary-danger-action,
      .review-button,
      .publication-save,
      .mini-action,
      .icon-action {
        align-items: center;
        border-radius: 0.4rem;
        cursor: pointer;
        display: inline-flex;
        font-weight: 900;
        justify-content: center;
        min-height: 2.5rem;
        padding: 0 0.85rem;
        text-decoration: none;
      }

      .primary-action,
      .publication-save {
        background: #a86f16;
        border: 1px solid #9a6414;
        color: #fff;
      }

      .secondary-action,
      .tertiary-action,
      .mini-action,
      .icon-action {
        background: #fff;
        border: 1px solid #cfd8e6;
        color: #172033;
      }

      .tertiary-action:disabled,
      .secondary-action:disabled,
      .secondary-danger-action:disabled,
      .review-button:disabled,
      .publication-save:disabled,
      .mini-action:disabled,
      .icon-action:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .secondary-danger-action {
        background: #fff8f8;
        border: 1px solid #f1a8b4;
        color: #9f1d2f;
      }

      .icon-action {
        min-height: 2.2rem;
        padding: 0;
        width: 2.2rem;
      }

      .admin-summary-grid {
        display: grid;
        gap: 0.9rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .admin-summary-grid article,
      .sponsors-list-panel,
      .sponsor-detail-panel,
      .detail-card,
      .empty-admin-state,
      .empty-detail-state {
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.5rem;
      }

      .admin-summary-grid article {
        align-items: center;
        display: grid;
        gap: 0.9rem;
        grid-template-columns: auto minmax(0, 1fr);
        min-height: 7rem;
        padding: 1.1rem;
      }

      .metric-mark,
      .sponsor-avatar {
        align-items: center;
        border-radius: 999px;
        display: inline-flex;
        font-weight: 900;
        justify-content: center;
      }

      .metric-mark {
        background: #eef2f7;
        color: #172033;
        height: 3rem;
        width: 3rem;
      }

      .metric-mark.gold {
        background: #fff4d9;
        color: #a86f16;
      }
      .metric-mark.green {
        background: #e8f7ee;
        color: #177245;
      }
      .metric-mark.money {
        background: #f4eadb;
        color: #9a6414;
      }

      .admin-summary-grid strong {
        display: block;
        font-size: 1.7rem;
        line-height: 1.1;
        margin-top: 0.18rem;
      }

      .admin-summary-grid small,
      .sponsor-table-row small,
      .inline-status {
        color: #667085;
      }

      .sponsors-board {
        align-items: start;
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(52rem, 1fr) minmax(22rem, 32rem);
      }

      .sponsors-list-panel,
      .sponsor-detail-panel {
        min-width: 0;
        overflow: hidden;
      }

      .admin-table-toolbar {
        align-items: end;
        border-bottom: 1px solid #e4e9f2;
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(16rem, 1fr) auto;
        padding: 1rem;
      }

      .search-control,
      .admin-table-toolbar label,
      .review-note-label,
      .rejection-workflow label,
      .refund-workflow label,
      .publication-grid label,
      .logo-upload-control {
        display: grid;
        gap: 0.35rem;
        font-size: 0.84rem;
        font-weight: 800;
      }

      .filter-row {
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      input,
      select,
      textarea {
        border: 1px solid #cdd6e3;
        border-radius: 0.35rem;
        padding: 0.65rem 0.75rem;
      }

      textarea {
        resize: vertical;
      }

      .state,
      .empty-admin-state,
      .empty-detail-state {
        display: grid;
        gap: 0.7rem;
        padding: 1rem;
      }

      .state-error {
        background: #fff7f8;
        color: #9f1d2f;
      }
      .state-loading {
        color: #38425a;
      }

      .skeleton-list {
        display: grid;
        gap: 0.65rem;
      }

      .skeleton-list span {
        background: linear-gradient(90deg, #edf2f7, #f8fafc, #edf2f7);
        border-radius: 0.35rem;
        display: block;
        height: 3.5rem;
      }

      .sponsor-table {
        display: grid;
      }

      .sponsor-table-head,
      .sponsor-table-row {
        display: grid;
        gap: 0.65rem;
        grid-template-columns:
          minmax(12rem, 1.6fr) minmax(6rem, 0.7fr) minmax(6.75rem, 0.75fr)
          minmax(7rem, 0.8fr) minmax(7rem, 0.75fr) minmax(7rem, 0.75fr)
          1.25rem;
        padding: 0.75rem 1rem;
      }

      .sponsor-table-head {
        border-bottom: 1px solid #e8edf5;
        color: #506079;
        font-size: 0.76rem;
        font-weight: 900;
      }

      .sponsor-table-row {
        appearance: none;
        background: var(--sponsor-row-bg, #fff);
        border: 0;
        border-bottom: 1px solid #edf1f6;
        border-left: 0.28rem solid var(--sponsor-row-accent, transparent);
        box-sizing: border-box;
        color: inherit;
        padding-left: 0.72rem;
        text-align: left;
        transition:
          background-color 0.16s ease,
          box-shadow 0.16s ease,
          border-color 0.16s ease;
        width: 100%;
      }

      .sponsor-table-row:hover {
        background: var(--sponsor-row-hover-bg, #f8fbff);
      }

      .sponsor-table-row.selected {
        background: var(--sponsor-row-selected-bg, #f8fbff);
        box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.24);
      }

      .sponsor-row-state-action-required {
        --sponsor-row-accent: #d8941f;
        --sponsor-row-bg: #fff8ea;
        --sponsor-row-hover-bg: #fff1d4;
        --sponsor-row-selected-bg: #fff4dc;
      }

      .sponsor-row-state-approved-ready {
        --sponsor-row-accent: #2f855a;
        --sponsor-row-bg: #f0fbf4;
        --sponsor-row-hover-bg: #e4f7eb;
        --sponsor-row-selected-bg: #e8f7ee;
      }

      .sponsor-row-state-publication-progress {
        --sponsor-row-accent: #3b73d9;
        --sponsor-row-bg: #eef5ff;
        --sponsor-row-hover-bg: #e4efff;
        --sponsor-row-selected-bg: #e8f1ff;
      }

      .sponsor-row-state-published {
        --sponsor-row-accent: #2aa198;
        --sponsor-row-bg: #ebfaf7;
        --sponsor-row-hover-bg: #ddf6f1;
        --sponsor-row-selected-bg: #e4f6f3;
      }

      .sponsor-row-state-blocked {
        --sponsor-row-accent: #c0392b;
        --sponsor-row-bg: #fff0ee;
        --sponsor-row-hover-bg: #ffe4e1;
        --sponsor-row-selected-bg: #fdecea;
      }

      .sponsor-row-state-waiting-payment {
        --sponsor-row-accent: #6f7a8e;
        --sponsor-row-bg: #f3f6fa;
        --sponsor-row-hover-bg: #edf1f7;
        --sponsor-row-selected-bg: #eef2f7;
      }

      .row-cell,
      .stacked-cell,
      .amount-cell {
        align-content: center;
        display: grid;
        gap: 0.3rem;
        min-width: 0;
      }

      .sponsor-main {
        align-items: center;
        display: grid;
        gap: 0.75rem;
        grid-template-columns: auto minmax(0, 1fr);
      }

      .sponsor-main strong,
      .sponsor-main small,
      .stacked-cell small,
      dd,
      .public-preview p {
        overflow-wrap: anywhere;
      }

      .sponsor-avatar {
        background: #172033;
        color: #fff;
        height: 2.35rem;
        width: 2.35rem;
      }

      .sponsor-avatar.large {
        font-size: 1.05rem;
        height: 3.5rem;
        width: 3.5rem;
      }

      .row-open {
        color: #506079;
        font-size: 1.6rem;
        justify-content: center;
      }

      .pagination-bar {
        align-items: center;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
        padding: 0.8rem 1rem;
      }

      .pagination-bar label {
        align-items: center;
        display: flex;
        gap: 0.45rem;
      }

      .sponsor-detail-panel {
        display: grid;
        max-height: calc(100vh - 2.5rem);
        position: sticky;
        top: 1.25rem;
      }

      .review-toast {
        animation: review-toast-in 0.22s ease both;
        background: #10233d;
        border: 1px solid rgb(255 255 255 / 12%);
        border-radius: 0.45rem;
        box-shadow: 0 16px 34px rgb(15 23 42 / 24%);
        color: #fff;
        font-size: 0.86rem;
        font-weight: 900;
        margin: 0;
        max-width: min(24rem, calc(100% - 2rem));
        padding: 0.75rem 0.9rem;
        position: absolute;
        bottom: calc(100% + 0.75rem);
        right: 1rem;
        z-index: 4;
      }

      .sponsor-table-row.selection-pulse,
      .sponsor-detail-panel.selection-pulse {
        animation: selected-box-fade-in 0.52s ease both;
      }

      .detail-header {
        display: grid;
        gap: 0.9rem;
        grid-template-columns: minmax(0, 1fr) auto;
        padding: 1rem;
      }

      .detail-title {
        align-items: center;
        display: grid;
        gap: 0.8rem;
        grid-template-columns: auto minmax(0, 1fr);
      }

      .detail-title p {
        color: #38425a;
        margin: 0.2rem 0 0;
      }

      .payment-alert {
        background: #fff7ed;
        border: 1px solid #fed7aa;
        border-radius: 0.45rem;
        color: #9a3412;
        font-weight: 900;
        grid-column: 1 / -1;
        margin: 0 1rem 1rem;
        padding: 0.75rem 0.9rem;
      }

      .rejection-workflow {
        background: #fff8f8;
        border-top: 1px solid #f1a8b4;
        display: grid;
        gap: 0.85rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        padding: 1rem;
      }

      .refund-workflow {
        background: #f3f7ff;
        border-top: 1px solid #b8cff7;
        display: grid;
        gap: 0.85rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        padding: 1rem;
      }

      .rejection-workflow header,
      .refund-workflow header,
      .rejection-workflow footer {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        grid-column: 1 / -1;
        justify-content: space-between;
      }

      .refund-workflow footer {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        grid-column: 1 / -1;
        justify-content: space-between;
      }

      .rejection-workflow header span {
        color: #9f1d2f;
        font-size: 0.72rem;
        font-weight: 900;
        text-transform: uppercase;
      }

      .refund-workflow header span {
        color: #0f3e99;
        font-size: 0.72rem;
        font-weight: 900;
        text-transform: uppercase;
      }

      .rejection-workflow h3 {
        margin: 0.15rem 0 0;
      }

      .refund-workflow h3 {
        margin: 0.15rem 0 0;
      }

      .refund-warning {
        background: #e8f1ff;
        border: 1px solid #b8cff7;
        border-radius: 0.4rem;
        color: #173b76;
        font-weight: 900;
        margin: 0;
        padding: 0.75rem 0.9rem;
      }

      .rejection-span-2 {
        grid-column: 1 / -1;
      }

      .checkbox-line {
        align-items: center;
        display: flex;
        gap: 0.5rem;
      }

      .checkbox-line input {
        min-height: auto;
      }

      .detail-badges,
      .detail-meta {
        grid-column: 1 / -1;
      }
      .detail-badges {
        flex-wrap: wrap;
      }

      .detail-meta,
      .detail-card dl,
      .compact-definition-list {
        display: grid;
        gap: 0.75rem;
        margin: 0;
      }

      .detail-meta {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      dd {
        margin: 0.15rem 0 0;
      }

      .detail-tabs {
        border-bottom: 1px solid #e4e9f2;
        border-top: 1px solid #e4e9f2;
        display: flex;
        gap: 0.25rem;
        overflow-x: auto;
        padding: 0 1rem;
      }

      .detail-tabs button {
        background: transparent;
        border: 0;
        border-bottom: 0.18rem solid transparent;
        color: #38425a;
        cursor: pointer;
        font-weight: 900;
        padding: 0.9rem 0.65rem 0.72rem;
        white-space: nowrap;
      }

      .detail-tabs button.active {
        border-color: #2563eb;
        color: #0f3e99;
      }

      .detail-body {
        display: grid;
        gap: 0.9rem;
        overflow: auto;
        padding: 1rem;
      }

      .detail-card {
        display: grid;
        gap: 0.85rem;
        padding: 1rem;
      }

      .detail-card-grid {
        display: grid;
        gap: 0.9rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .copy-line,
      .logo-actions,
      .form-footer {
        flex-wrap: wrap;
      }

      .logo-preview {
        align-items: center;
        background: #f4f7fb;
        border: 1px solid #d9e0ea;
        border-radius: 0.35rem;
        display: flex;
        height: 4.5rem;
        justify-content: center;
        overflow: hidden;
        width: 8rem;
      }

      .large-preview {
        height: 8rem;
        width: 12rem;
      }
      .logo-preview img {
        max-height: 100%;
        max-width: 100%;
        object-fit: contain;
      }

      .publication-editor header,
      .public-preview > div {
        align-items: center;
        display: flex;
        gap: 0.8rem;
        justify-content: space-between;
      }

      .publication-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .publication-span-2 {
        grid-column: 1 / -1;
      }

      fieldset {
        border: 1px solid #d9e0ea;
        border-radius: 0.35rem;
        display: grid;
        gap: 0.4rem;
        margin: 0;
        padding: 0.65rem 0.75rem;
      }

      fieldset label {
        align-items: center;
        display: flex;
        gap: 0.4rem;
      }

      .public-preview > span {
        color: #a86f16;
      }

      .detail-actions {
        align-items: center;
        background: #fff;
        border-top: 1px solid #e4e9f2;
        display: flex;
        flex-wrap: wrap;
        gap: 0.7rem;
        justify-content: flex-end;
        padding: 1rem;
        position: sticky;
        bottom: 0;
      }

      .detail-actions .inline-status {
        flex: 1 1 100%;
      }

      .status-badge,
      .visibility-badge,
      .feed-badge,
      .payment-badge,
      .tier-badge {
        border-radius: 999px;
        display: inline-flex;
        font-size: 0.72rem;
        font-weight: 900;
        padding: 0.25rem 0.55rem;
        width: max-content;
      }

      .status-pending,
      .feed-planned,
      .payment-pending,
      .visibility-review,
      .tier-gold {
        background: #fff2cf;
        color: #8a5a00;
      }
      .status-approved,
      .feed-published,
      .payment-paid,
      .visibility-visible {
        background: #dff7e8;
        color: #176236;
      }
      .status-rejected,
      .payment-failed {
        background: #ffe0e5;
        color: #9f1d2f;
      }
      .visibility-hidden,
      .feed-not_planned {
        background: #eef1f5;
        color: #667085;
      }
      .feed-drafted {
        background: #ede9fe;
        color: #5b21b6;
      }
      .tier-silver {
        background: #eef2f7;
        color: #38425a;
      }
      .tier-bronze {
        background: #fff0e5;
        color: #9a4d13;
      }

      .field-error {
        color: #9f1d2f;
        font-weight: 800;
      }
      .inline-status.is-dirty {
        color: #a86f16;
        font-weight: 900;
      }

      .review-button.neutral {
        background: #eef2f7;
        border: 1px solid #d8e0ea;
        color: #1f2937;
      }
      .review-button.reject {
        background: #fff8f8;
        border: 1px solid #d9394f;
        color: #c0182c;
      }
      .review-button.approve {
        background: #178244;
        border: 1px solid #146b39;
        color: #fff;
      }
      .review-button.refund {
        background: #174ea6;
        border: 1px solid #123d82;
        color: #fff;
      }

      @keyframes review-toast-in {
        from {
          opacity: 0;
          transform: translateY(-0.35rem);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes selected-box-fade-in {
        0% {
          box-shadow:
            inset 0.18rem 0 0 #2563eb,
            0 0 0 0 rgb(37 99 235 / 0%);
          opacity: 0.62;
          transform: translateY(0.25rem);
        }
        45% {
          box-shadow:
            inset 0.18rem 0 0 #2563eb,
            0 0 0 0.28rem rgb(37 99 235 / 14%);
          opacity: 1;
        }
        100% {
          box-shadow:
            inset 0.18rem 0 0 #2563eb,
            0 0 0 0 rgb(37 99 235 / 0%);
          opacity: 1;
          transform: translateY(0);
        }
      }

      .audit-list {
        display: grid;
        gap: 0.75rem;
        margin: 0;
        padding-left: 1.2rem;
      }

      .audit-list time {
        color: #667085;
        font-size: 0.82rem;
        font-weight: 800;
      }
      .audit-list p {
        margin: 0.15rem 0;
      }

      @media (max-width: 1500px) {
        .sponsors-board {
          grid-template-columns: 1fr;
        }
        .sponsor-detail-panel {
          max-height: none;
          position: static;
        }
      }

      @media (max-width: 1120px) {
        .sponsor-table-head {
          display: none;
        }

        .sponsor-table-row {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.8rem 1rem;
          padding: 1rem;
        }

        .sponsor-main {
          grid-column: 1 / -1;
        }

        .row-open {
          display: none;
        }
      }

      @media (max-width: 860px) {
        .admin-shell,
        .admin-summary-grid,
        .admin-table-toolbar,
        .rejection-workflow,
        .refund-workflow,
        .publication-grid,
        .detail-card-grid,
        .detail-meta {
          grid-template-columns: 1fr;
        }

        .admin-title-row,
        .admin-actions,
        .pagination-bar {
          align-items: stretch;
          flex-direction: column;
        }

        .sponsor-table-head {
          display: none;
        }
        .sponsor-table-row {
          grid-template-columns: 1fr;
          gap: 0.7rem;
        }

        .row-open {
          display: none;
        }
        .detail-actions {
          justify-content: stretch;
        }
        .detail-actions button {
          flex: 1 1 100%;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .review-toast,
        .sponsor-table-row.selection-pulse,
        .sponsor-detail-panel.selection-pulse {
          animation: none;
        }
      }
    `
  ]
})
export class AdminSponsorsPageComponent implements OnInit, OnDestroy {
  private readonly admin = inject(FundingAdminService);
  @ViewChild('sponsorDetailPanel')
  private readonly sponsorDetailPanel?: ElementRef<HTMLElement>;

  readonly adminToken = signal<string>('');
  readonly sponsorships = signal<readonly AdminSponsorshipRecord[]>([]);
  readonly reviewNotes = signal<Record<string, string>>({});
  readonly publicationDrafts = signal<
    Record<string, SponsorshipPublicationDraft>
  >({});
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly actionState = signal<string | null>(null);
  readonly logoUploadMessages = signal<Record<string, string>>({});
  readonly logoPreviewUrls = signal<Record<string, string>>({});
  readonly search = signal<string>('');
  readonly reviewFilter = signal<SponsorshipReviewFilter>('all');
  readonly feedFilter = signal<SponsorFeedStatusFilter>('all');
  readonly paymentFilter = signal<SponsorPaymentStatusFilter>('all');
  readonly selectedSponsorshipId = signal<string | null>(null);
  readonly activeRejectionId = signal<string | null>(null);
  readonly activeRefundId = signal<string | null>(null);
  readonly activeTab = signal<SponsorDetailsTab>('overview');
  readonly page = signal<number>(1);
  readonly pageSize = signal<number>(6);
  readonly pagination = signal<AdminPagination>(defaultPagination);
  readonly selectionPulseId = signal<string | null>(null);
  readonly reviewMessages = signal<Record<string, string>>({});
  readonly publicationMessages = signal<Record<string, string>>({});
  readonly noteMessages = signal<Record<string, string>>({});
  readonly copyMessages = signal<Record<string, string>>({});
  readonly rejectionDrafts = signal<Record<string, SponsorRejectionDraft>>({});
  readonly refundDrafts = signal<Record<string, SponsorRefundDraft>>({});
  readonly feedStatuses = feedStatuses;
  readonly pageSizeOptions = pageSizeOptions;

  readonly filteredSponsorships = computed(() => this.sponsorships());
  readonly totalPages = computed(() => this.pagination().totalPages);
  readonly normalizedPage = computed(() => this.pagination().page);
  readonly paginatedSponsorships = computed(() => this.sponsorships());
  readonly paginationStart = computed(() =>
    this.pagination().totalItems === 0
      ? 0
      : (this.pagination().page - 1) * this.pagination().pageSize + 1
  );
  readonly paginationEnd = computed(() =>
    this.pagination().totalItems === 0
      ? 0
      : this.paginationStart() + this.sponsorships().length - 1
  );
  readonly selectedSponsorship = computed(() => {
    const selectedId = this.selectedSponsorshipId();
    if (!selectedId) {
      return null;
    }

    return this.sponsorships().find((item) => item.id === selectedId) ?? null;
  });
  readonly hasActiveFilters = computed(
    () =>
      this.search().trim().length > 0 ||
      this.reviewFilter() !== 'all' ||
      this.feedFilter() !== 'all' ||
      this.paymentFilter() !== 'all'
  );

  readonly visibleCount = computed(
    () =>
      this.sponsorships().filter(
        (item) =>
          item.sponsor_review_status === 'approved' &&
          (item.public_display_consent ||
            item.sponsor_feed_status === 'published')
      ).length
  );
  readonly activeCount = computed(
    () =>
      this.sponsorships().filter(
        (item) =>
          item.payment_status === 'paid' &&
          item.sponsor_review_status !== 'rejected'
      ).length
  );
  readonly totalContribution = computed(() =>
    this.sponsorships()
      .filter((item) => item.payment_status === 'paid')
      .reduce((total, item) => total + item.amount, 0)
  );
  private readonly reviewMessageTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private selectionPulseTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    void this.loadSponsorships();
  }

  ngOnDestroy(): void {
    this.revokeLogoPreviews();
    this.clearReviewMessageTimers();
    this.clearSelectionPulseTimer();
  }

  async loadSponsorships(): Promise<void> {
    this.state.set('loading');

    try {
      const response = await this.admin.getSponsorships(this.adminToken(), {
        page: this.page(),
        pageSize: this.pageSize(),
        search: this.search(),
        reviewStatus: this.reviewFilter(),
        feedStatus: this.feedFilter(),
        paymentStatus: this.paymentFilter(),
        sort: 'priority',
        direction: 'desc'
      });
      const sponsorships = response.items ?? response.sponsorships;
      this.sponsorships.set(sponsorships);
      this.pagination.set(response.pagination ?? defaultPagination);
      this.page.set(response.pagination?.page ?? this.page());
      this.reviewNotes.set(
        Object.fromEntries(
          sponsorships.map((item) => [item.id, item.sponsor_review_note ?? ''])
        )
      );
      this.publicationDrafts.set(
        Object.fromEntries(
          sponsorships.map((item) => [item.id, this.toPublicationDraft(item)])
        )
      );
      if (
        sponsorships.length > 0 &&
        !sponsorships.some((item) => item.id === this.selectedSponsorshipId())
      ) {
        this.selectedSponsorshipId.set(sponsorships[0]?.id ?? null);
      }
      this.state.set('ready');
      this.saveToken();
      void this.loadLogoPreviews(sponsorships);
    } catch {
      this.state.set('error');
    }
  }

  async review(
    sponsorship: AdminSponsorshipRecord,
    reviewStatus: SponsorshipReviewStatus
  ): Promise<void> {
    if (reviewStatus === 'rejected') {
      this.openRejectionPanel(sponsorship);
      return;
    }

    if (
      reviewStatus === 'approved' &&
      !this.canApproveSponsorship(sponsorship)
    ) {
      this.setReviewMessage(
        sponsorship.id,
        this.paymentEligibilityMessage(sponsorship) ||
          "Action impossible: le paiement n'est pas admissible.",
        true
      );
      return;
    }

    const reviewNote = this.reviewNoteFor(sponsorship.id).trim();

    if (
      reviewStatus === 'pending_review' &&
      sponsorship.sponsor_review_status !== 'pending_review' &&
      typeof window !== 'undefined' &&
      !window.confirm('Remettre ce dossier en attente?')
    ) {
      return;
    }

    this.actionState.set(this.reviewActionId(sponsorship.id));
    this.setReviewMessage(
      sponsorship.id,
      `Action en cours: ${this.reviewActionName(reviewStatus)}...`
    );

    try {
      await this.admin.reviewSponsorship(this.adminToken(), {
        contributionId: sponsorship.id,
        reviewStatus,
        reviewNote: reviewNote || undefined,
        expectedVersion: sponsorship.version
      });
      await this.loadSponsorships();
      this.setReviewMessage(
        sponsorship.id,
        this.reviewSuccessMessage(reviewStatus),
        true
      );
      this.pulseSelection(sponsorship.id);
    } catch (error) {
      this.setReviewMessage(
        sponsorship.id,
        this.messageFromError(
          error,
          "Action impossible: la revue n'a pas pu etre enregistree."
        ),
        true
      );
    } finally {
      this.actionState.set(null);
    }
  }

  openRejectionPanel(sponsorship: AdminSponsorshipRecord): void {
    this.ensureRejectionDraft(sponsorship);
    this.activeTab.set('overview');
    this.activeRefundId.set(null);
    this.activeRejectionId.set(sponsorship.id);
    this.setReviewMessage(
      sponsorship.id,
      'Completez la raison, le message et le traitement du remboursement.'
    );
  }

  closeRejectionPanel(): void {
    this.activeRejectionId.set(null);
  }

  isRejectionPanelOpen(sponsorship: AdminSponsorshipRecord): boolean {
    return this.activeRejectionId() === sponsorship.id;
  }

  rejectionDraftFor(
    sponsorship: AdminSponsorshipRecord
  ): SponsorRejectionDraft {
    return (
      this.rejectionDrafts()[sponsorship.id] ??
      this.defaultRejectionDraft(sponsorship)
    );
  }

  setRejectionDraftField(
    id: string,
    field: 'recipientEmail' | 'sponsorMessage' | 'refundNote',
    event: Event
  ): void {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement;
    this.rejectionDrafts.update((drafts) => {
      const current = drafts[id] ?? this.emptyRejectionDraft();
      return {
        ...drafts,
        [id]: {
          ...current,
          [field]: input.value
        }
      };
    });
  }

  setRejectionDraftBoolean(
    id: string,
    field: 'notifySponsor',
    event: Event
  ): void {
    const input = event.target as HTMLInputElement;
    this.rejectionDrafts.update((drafts) => {
      const current = drafts[id] ?? this.emptyRejectionDraft();
      return {
        ...drafts,
        [id]: {
          ...current,
          [field]: input.checked
        }
      };
    });
  }

  setRejectionRefundHandling(id: string, event: Event): void {
    const input = event.target as HTMLSelectElement;
    const value = input.value as AdminSponsorshipRejectionRefundHandling;
    this.rejectionDrafts.update((drafts) => {
      const current = drafts[id] ?? this.emptyRejectionDraft();
      return {
        ...drafts,
        [id]: {
          ...current,
          refundHandling: value
        }
      };
    });
  }

  canConfirmRejection(sponsorship: AdminSponsorshipRecord): boolean {
    const draft = this.rejectionDraftFor(sponsorship);
    const reason = this.reviewNoteFor(sponsorship.id).trim();

    if (!reason) {
      return false;
    }

    if (!draft.notifySponsor) {
      return true;
    }

    return (
      this.isValidEmailDraft(draft.recipientEmail) &&
      draft.sponsorMessage.trim().length > 0
    );
  }

  rejectionValidationMessage(sponsorship: AdminSponsorshipRecord): string {
    const draft = this.rejectionDraftFor(sponsorship);
    if (!this.reviewNoteFor(sponsorship.id).trim()) {
      return 'Raison interne obligatoire.';
    }

    if (draft.notifySponsor && !this.isValidEmailDraft(draft.recipientEmail)) {
      return 'Destinataire courriel requis.';
    }

    if (draft.notifySponsor && !draft.sponsorMessage.trim()) {
      return 'Message au commanditaire obligatoire.';
    }

    return draft.notifySponsor
      ? 'Pret a refuser et envoyer le courriel.'
      : 'Pret a refuser sans courriel.';
  }

  async confirmRejection(sponsorship: AdminSponsorshipRecord): Promise<void> {
    if (!this.canConfirmRejection(sponsorship)) {
      this.setReviewMessage(
        sponsorship.id,
        this.rejectionValidationMessage(sponsorship),
        true
      );
      return;
    }

    const draft = this.rejectionDraftFor(sponsorship);
    const reviewNote = this.reviewNoteFor(sponsorship.id).trim();

    this.actionState.set(this.reviewActionId(sponsorship.id));
    this.setReviewMessage(sponsorship.id, 'Action en cours: refus...');

    try {
      const result = await this.admin.reviewSponsorship(this.adminToken(), {
        contributionId: sponsorship.id,
        reviewStatus: 'rejected',
        reviewNote,
        expectedVersion: sponsorship.version,
        notifySponsor: draft.notifySponsor,
        notificationEmail: draft.notifySponsor
          ? draft.recipientEmail.trim()
          : undefined,
        sponsorMessage: draft.notifySponsor
          ? draft.sponsorMessage.trim()
          : undefined,
        refundHandling: draft.refundHandling,
        refundNote: draft.refundNote.trim() || undefined
      });
      await this.loadSponsorships();
      this.activeRejectionId.set(null);
      this.setReviewMessage(
        sponsorship.id,
        [
          this.reviewSuccessMessage('rejected'),
          this.rejectionNotificationResultLabel(result),
          this.rejectionRefundResultLabel(result.refundHandling)
        ]
          .filter(Boolean)
          .join(' '),
        true
      );
      this.pulseSelection(sponsorship.id);
    } catch (error) {
      this.setReviewMessage(
        sponsorship.id,
        this.messageFromError(
          error,
          "Action impossible: le refus n'a pas pu etre enregistre."
        ),
        true
      );
    } finally {
      this.actionState.set(null);
    }
  }

  openRefundPanel(sponsorship: AdminSponsorshipRecord): void {
    this.ensureRefundDraft(sponsorship);
    this.activeRejectionId.set(null);
    this.activeRefundId.set(sponsorship.id);
    this.setReviewMessage(
      sponsorship.id,
      `Recopiez ${this.refundConfirmationText(
        sponsorship
      )} pour confirmer le remboursement Stripe.`
    );
  }

  closeRefundPanel(): void {
    this.activeRefundId.set(null);
  }

  isRefundPanelOpen(sponsorship: AdminSponsorshipRecord): boolean {
    return this.activeRefundId() === sponsorship.id;
  }

  refundDraftFor(sponsorship: AdminSponsorshipRecord): SponsorRefundDraft {
    return (
      this.refundDrafts()[sponsorship.id] ??
      this.defaultRefundDraft(sponsorship)
    );
  }

  setRefundDraftField(
    id: string,
    field:
      'confirmationText' | 'recipientEmail' | 'sponsorMessage' | 'refundNote',
    event: Event
  ): void {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement;
    this.refundDrafts.update((drafts) => {
      const current = drafts[id] ?? this.emptyRefundDraft();
      return {
        ...drafts,
        [id]: {
          ...current,
          [field]: input.value
        }
      };
    });
  }

  setRefundDraftBoolean(
    id: string,
    field: 'notifySponsor',
    event: Event
  ): void {
    const input = event.target as HTMLInputElement;
    this.refundDrafts.update((drafts) => {
      const current = drafts[id] ?? this.emptyRefundDraft();
      return {
        ...drafts,
        [id]: {
          ...current,
          [field]: input.checked
        }
      };
    });
  }

  canRefundSponsorship(sponsorship: AdminSponsorshipRecord): boolean {
    return sponsorship.payment_status === 'paid';
  }

  refundConfirmationText(sponsorship: AdminSponsorshipRecord): string {
    return sponsorship.public_reference || sponsorship.id;
  }

  canConfirmRefund(sponsorship: AdminSponsorshipRecord): boolean {
    const draft = this.refundDraftFor(sponsorship);
    return (
      this.canRefundSponsorship(sponsorship) &&
      draft.confirmationText.trim() ===
        this.refundConfirmationText(sponsorship) &&
      (!draft.notifySponsor ||
        (this.isValidEmailDraft(draft.recipientEmail) &&
          draft.sponsorMessage.trim().length > 0))
    );
  }

  refundValidationMessage(sponsorship: AdminSponsorshipRecord): string {
    const draft = this.refundDraftFor(sponsorship);
    if (!this.canRefundSponsorship(sponsorship)) {
      return 'Remboursement Stripe disponible seulement pour un paiement paye.';
    }

    if (!draft.confirmationText.trim()) {
      return 'Texte de confirmation obligatoire.';
    }

    if (
      draft.confirmationText.trim() !== this.refundConfirmationText(sponsorship)
    ) {
      return 'Le texte ne correspond pas a la reference demandee.';
    }

    if (draft.notifySponsor && !this.isValidEmailDraft(draft.recipientEmail)) {
      return 'Destinataire courriel requis.';
    }

    if (draft.notifySponsor && !draft.sponsorMessage.trim()) {
      return 'Message au commanditaire obligatoire.';
    }

    return draft.notifySponsor
      ? 'Pret a rembourser et envoyer le courriel.'
      : 'Pret a declencher le remboursement Stripe complet.';
  }

  async confirmRefund(sponsorship: AdminSponsorshipRecord): Promise<void> {
    if (!this.canConfirmRefund(sponsorship)) {
      this.setReviewMessage(
        sponsorship.id,
        this.refundValidationMessage(sponsorship),
        true
      );
      return;
    }

    const draft = this.refundDraftFor(sponsorship);
    this.actionState.set(this.refundActionId(sponsorship.id));
    this.setReviewMessage(sponsorship.id, 'Remboursement Stripe en cours...');

    try {
      const result = await this.admin.refundSponsorship(this.adminToken(), {
        contributionId: sponsorship.id,
        expectedVersion: sponsorship.version,
        confirmationText: draft.confirmationText.trim(),
        refundNote: draft.refundNote.trim() || undefined,
        notifySponsor: draft.notifySponsor,
        notificationEmail: draft.notifySponsor
          ? draft.recipientEmail.trim()
          : undefined,
        sponsorMessage: draft.notifySponsor
          ? draft.sponsorMessage.trim()
          : undefined
      });
      await this.loadSponsorships();
      this.activeRefundId.set(null);
      this.setReviewMessage(
        sponsorship.id,
        [
          this.refundResultLabel(result),
          this.refundNotificationResultLabel(result)
        ]
          .filter(Boolean)
          .join(' '),
        true
      );
      this.pulseSelection(sponsorship.id);
    } catch (error) {
      this.setReviewMessage(
        sponsorship.id,
        this.messageFromError(
          error,
          "Action impossible: le remboursement Stripe n'a pas pu etre cree."
        ),
        true
      );
    } finally {
      this.actionState.set(null);
    }
  }

  async saveReviewNote(sponsorship: AdminSponsorshipRecord): Promise<void> {
    this.actionState.set(this.noteActionId(sponsorship.id));
    this.setNoteMessage(sponsorship.id, 'Enregistrement en cours...');

    try {
      await this.admin.reviewSponsorship(this.adminToken(), {
        contributionId: sponsorship.id,
        reviewStatus: sponsorship.sponsor_review_status,
        reviewNote: this.reviewNoteFor(sponsorship.id).trim() || undefined,
        expectedVersion: sponsorship.version
      });
      await this.loadSponsorships();
      this.setNoteMessage(sponsorship.id, 'Note enregistree.');
    } catch (error) {
      this.setNoteMessage(
        sponsorship.id,
        this.messageFromError(error, "La note n'a pas pu etre enregistree.")
      );
    } finally {
      this.actionState.set(null);
    }
  }

  async savePublication(sponsorship: AdminSponsorshipRecord): Promise<void> {
    const draft = this.publicationDraftFor(sponsorship.id);
    const slugError = this.slugErrorFor(sponsorship);
    if (!this.publicationDirtyFor(sponsorship) || slugError) {
      this.setPublicationMessage(
        sponsorship.id,
        slugError || 'Aucune modification a enregistrer.'
      );
      return;
    }

    if (!this.canSavePublication(sponsorship)) {
      this.setPublicationMessage(
        sponsorship.id,
        this.paymentEligibilityMessage(sponsorship) ||
          "Publication bloquee: le paiement n'est pas admissible."
      );
      return;
    }

    this.actionState.set(this.publicationActionId(sponsorship.id));
    this.setPublicationMessage(sponsorship.id, 'Enregistrement en cours...');

    try {
      await this.admin.updateSponsorshipPublication(this.adminToken(), {
        contributionId: sponsorship.id,
        expectedVersion: sponsorship.version,
        publicSlug: draft.publicSlug.trim() || undefined,
        publicSummary: draft.publicSummary.trim() || undefined,
        feedTarget: draft.feedTarget || null,
        feedChannels: [
          ...(draft.facebook ? ['facebook' as const] : []),
          ...(draft.linkedin ? ['linkedin' as const] : [])
        ],
        feedStatus: draft.feedStatus,
        feedPublicUrl: draft.feedPublicUrl.trim() || undefined,
        feedNotes: draft.feedNotes.trim() || undefined
      });
      await this.loadSponsorships();
      this.setPublicationMessage(sponsorship.id, 'Publication enregistree.');
    } catch (error) {
      this.setPublicationMessage(
        sponsorship.id,
        this.messageFromError(
          error,
          "Les donnees de publication n'ont pas pu etre enregistrees."
        )
      );
    } finally {
      this.actionState.set(null);
    }
  }

  async uploadLogo(
    sponsorship: AdminSponsorshipRecord,
    event: Event
  ): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;

    if (!file) {
      return;
    }

    if (
      file.size > sponsorLogoMaxBytes ||
      !sponsorLogoMimeTypes.has(file.type)
    ) {
      this.setLogoUploadMessage(
        sponsorship.id,
        'Logo refuse: PNG, JPEG ou WebP, max 512 KiB.'
      );
      if (input) {
        input.value = '';
      }
      return;
    }

    this.actionState.set(this.logoActionId(sponsorship.id));
    this.setLogoUploadMessage(sponsorship.id, 'Upload en cours...');

    try {
      const result = await this.admin.uploadSponsorLogo(
        this.adminToken(),
        sponsorship.id,
        sponsorship.version,
        file
      );
      this.setLogoUploadMessage(
        sponsorship.id,
        `Logo enregistre (${Math.ceil(result.sizeBytes / 1024)} KiB).`
      );
      await this.loadSponsorships();
    } catch (error) {
      this.setLogoUploadMessage(
        sponsorship.id,
        this.messageFromError(error, 'Upload du logo impossible.')
      );
    } finally {
      this.actionState.set(null);
      if (input) {
        input.value = '';
      }
    }
  }

  async deleteLogo(sponsorship: AdminSponsorshipRecord): Promise<void> {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('Supprimer ce logo commanditaire?')
    ) {
      return;
    }

    this.actionState.set(this.deleteLogoActionId(sponsorship.id));
    this.setLogoUploadMessage(sponsorship.id, 'Suppression en cours...');

    try {
      await this.admin.deleteSponsorLogo(
        this.adminToken(),
        sponsorship.id,
        sponsorship.version
      );
      this.setLogoUploadMessage(sponsorship.id, 'Logo supprime.');
      await this.loadSponsorships();
    } catch (error) {
      this.setLogoUploadMessage(
        sponsorship.id,
        this.messageFromError(error, 'Suppression du logo impossible.')
      );
    } finally {
      this.actionState.set(null);
    }
  }

  setAdminToken(event: Event): void {
    this.adminToken.set(this.valueFromEvent(event));
    this.saveToken();
  }

  setSearch(event: Event): void {
    this.search.set(this.valueFromEvent(event));
    this.page.set(1);
    void this.loadSponsorships();
  }

  setReviewFilter(event: Event): void {
    const value = this.valueFromEvent(event);
    this.reviewFilter.set(
      value === 'pending_review' || value === 'approved' || value === 'rejected'
        ? value
        : 'all'
    );
    this.page.set(1);
    void this.loadSponsorships();
  }

  setFeedFilter(event: Event): void {
    const value = this.valueFromEvent(event);
    this.feedFilter.set(
      value === 'not_planned' ||
        value === 'planned' ||
        value === 'drafted' ||
        value === 'published'
        ? value
        : 'all'
    );
    this.page.set(1);
    void this.loadSponsorships();
  }

  setPaymentFilter(event: Event): void {
    const value = this.valueFromEvent(event);
    this.paymentFilter.set(
      value === 'paid' || value === 'refunded' || value === 'disputed'
        ? value
        : 'all'
    );
    this.page.set(1);
    void this.loadSponsorships();
  }

  resetFilters(): void {
    this.search.set('');
    this.reviewFilter.set('all');
    this.feedFilter.set('all');
    this.paymentFilter.set('all');
    this.page.set(1);
    void this.loadSponsorships();
  }

  setPageSize(event: Event): void {
    const value = Number.parseInt(this.valueFromEvent(event), 10);
    this.pageSize.set(
      pageSizeOptions.some((size) => size === value) ? value : 6
    );
    this.page.set(1);
    void this.loadSponsorships();
  }

  previousPage(): void {
    this.page.set(Math.max(1, this.normalizedPage() - 1));
    void this.loadSponsorships();
  }

  nextPage(): void {
    this.page.set(Math.min(this.totalPages(), this.normalizedPage() + 1));
    void this.loadSponsorships();
  }

  selectSponsorship(sponsorship: AdminSponsorshipRecord): void {
    this.selectedSponsorshipId.set(sponsorship.id);
    this.pulseSelection(sponsorship.id);
    this.scrollSelectedSponsorshipIntoView();
  }

  closeDetails(): void {
    this.selectedSponsorshipId.set(null);
    this.activeRejectionId.set(null);
    this.activeRefundId.set(null);
  }

  setActiveTab(tab: SponsorDetailsTab): void {
    this.activeTab.set(tab);
  }

  setReviewNote(id: string, event: Event): void {
    this.setReviewNoteValue(id, this.valueFromEvent(event));
  }

  setReviewNoteValue(id: string, value: string): void {
    this.reviewNotes.update((notes) => ({
      ...notes,
      [id]: value
    }));
  }

  setPublicationField(
    id: string,
    field: SponsorshipPublicationTextField,
    event: Event
  ): void {
    const value =
      field === 'publicSlug'
        ? this.normalizeSlug(this.valueFromEvent(event))
        : this.valueFromEvent(event);
    this.publicationDrafts.update((drafts) => {
      const draft = drafts[id] ?? this.emptyPublicationDraft();
      return {
        ...drafts,
        [id]: {
          ...draft,
          [field]: value
        }
      };
    });
  }

  setPublicationChannel(
    id: string,
    channel: SponsorshipPublicationChannel,
    event: Event
  ): void {
    const sponsorship = this.sponsorships().find((item) => item.id === id);
    const checked =
      (sponsorship && this.isPromisedFeedChannel(sponsorship, channel)) ||
      ((event.target as HTMLInputElement | null)?.checked ?? false);
    this.publicationDrafts.update((drafts) => {
      const draft = drafts[id] ?? this.emptyPublicationDraft();
      return {
        ...drafts,
        [id]: {
          ...draft,
          [channel]: checked
        }
      };
    });
  }

  reviewNoteFor(id: string): string {
    return this.reviewNotes()[id] ?? '';
  }

  reviewActionId(id: string): string {
    return `review:${id}`;
  }

  refundActionId(id: string): string {
    return `refund:${id}`;
  }

  publicationActionId(id: string): string {
    return `publication:${id}`;
  }

  noteActionId(id: string): string {
    return `note:${id}`;
  }

  logoActionId(id: string): string {
    return `logo:${id}`;
  }

  deleteLogoActionId(id: string): string {
    return `logo-delete:${id}`;
  }

  logoPreviewSourceFor(sponsorship: AdminSponsorshipRecord): string {
    if (!sponsorship.sponsor_logo_url) {
      return '';
    }

    if (this.isControlledLogoUrl(sponsorship.sponsor_logo_url)) {
      return this.logoPreviewUrls()[sponsorship.id] ?? '';
    }

    return sponsorship.sponsor_logo_url;
  }

  logoUploadMessageFor(id: string): string {
    return this.logoUploadMessages()[id] ?? '';
  }

  reviewMessageFor(id: string): string {
    return this.reviewMessages()[id] ?? '';
  }

  copyMessageFor(id: string): string {
    return this.copyMessages()[id] ?? '';
  }

  publicationDraftFor(id: string): SponsorshipPublicationDraft {
    return this.publicationDrafts()[id] ?? this.emptyPublicationDraft();
  }

  promisedFeedChannelsFor(
    sponsorship: AdminSponsorshipRecord
  ): readonly SponsorshipPublicationChannel[] {
    const { achievedBenefits } = resolveSponsorshipBenefits(
      sponsorship.amount,
      DEFAULT_SPONSORSHIP_PRICING_CONFIG
    );

    return achievedBenefits
      .map((benefit) => benefitFeedChannelMap[benefit])
      .filter(
        (channel): channel is SponsorshipPublicationChannel =>
          channel === 'facebook' || channel === 'linkedin'
      );
  }

  isPromisedFeedChannel(
    sponsorship: AdminSponsorshipRecord,
    channel: SponsorshipPublicationChannel
  ): boolean {
    return this.promisedFeedChannelsFor(sponsorship).includes(channel);
  }

  isActionPending(actionId: string): boolean {
    return this.actionState() === actionId;
  }

  isAnyActionPending(id: string): boolean {
    const action = this.actionState();
    return Boolean(action && action.endsWith(id));
  }

  trackById(_: number, sponsorship: AdminSponsorshipRecord): string {
    return sponsorship.id;
  }

  initialsFor(sponsorship: AdminSponsorshipRecord): string {
    const source =
      sponsorship.sponsor_company_name ||
      sponsorship.sponsor_contact_name ||
      sponsorship.public_reference ||
      'OG';
    const initials = source
      .split(/\s+/)
      .map((part) => part.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();

    return initials || 'OG';
  }

  visibilityLabel(sponsorship: AdminSponsorshipRecord): string {
    if (
      sponsorship.sponsor_review_status === 'approved' &&
      (sponsorship.public_display_consent ||
        sponsorship.sponsor_feed_status === 'published')
    ) {
      return 'Visible';
    }

    if (sponsorship.sponsor_review_status === 'pending_review') {
      return 'En revision';
    }

    return 'Masque';
  }

  visibilityClass(sponsorship: AdminSponsorshipRecord): string {
    const state =
      sponsorship.sponsor_review_status === 'approved' &&
      (sponsorship.public_display_consent ||
        sponsorship.sponsor_feed_status === 'published')
        ? 'visible'
        : sponsorship.sponsor_review_status === 'pending_review'
          ? 'review'
          : 'hidden';

    return `visibility-badge visibility-${state}`;
  }

  reviewActionName(status: SponsorshipReviewStatus): string {
    if (status === 'approved') {
      return 'acceptation';
    }

    if (status === 'rejected') {
      return 'refus';
    }

    return 'remise en attente';
  }

  reviewSuccessMessage(status: SponsorshipReviewStatus): string {
    if (status === 'approved') {
      return 'Action confirmee: commandite acceptee.';
    }

    if (status === 'rejected') {
      return 'Action confirmee: commandite refusee.';
    }

    return 'Action confirmee: commandite remise en attente.';
  }

  reviewStatusLabel(status: SponsorshipReviewStatus): string {
    if (status === 'approved') {
      return 'Approuvee';
    }

    if (status === 'rejected') {
      return 'Refusee';
    }

    return 'En attente';
  }

  feedStatusLabel(status: SponsorFeedStatus): string {
    if (status === 'published') {
      return 'Publie';
    }

    if (status === 'drafted') {
      return 'Brouillon';
    }

    if (status === 'planned') {
      return 'Planifie';
    }

    return 'Non planifie';
  }

  feedStatusClass(status: SponsorFeedStatus): string {
    return `feed-badge feed-${status}`;
  }

  sponsorshipProcessingState(
    sponsorship: AdminSponsorshipRecord
  ): SponsorProcessingState {
    const isBlocked =
      sponsorship.sponsor_review_status === 'rejected' ||
      ['refunded', 'disputed', 'failed'].includes(sponsorship.payment_status);
    if (isBlocked) {
      return 'blocked';
    }

    if (sponsorship.payment_status !== 'paid') {
      return 'waiting-payment';
    }

    if (sponsorship.sponsor_review_status === 'pending_review') {
      return 'action-required';
    }

    if (sponsorship.sponsor_feed_status === 'published') {
      return 'published';
    }

    if (
      sponsorship.sponsor_feed_status === 'planned' ||
      sponsorship.sponsor_feed_status === 'drafted'
    ) {
      return 'publication-progress';
    }

    return 'approved-ready';
  }

  sponsorshipRowStateClass(sponsorship: AdminSponsorshipRecord): string {
    return `sponsor-row-state-${this.sponsorshipProcessingState(sponsorship)}`;
  }

  sponsorshipProcessingLabel(sponsorship: AdminSponsorshipRecord): string {
    switch (this.sponsorshipProcessingState(sponsorship)) {
      case 'action-required':
        return 'Traitement requis';
      case 'approved-ready':
        return 'Approuvee, publication a planifier';
      case 'publication-progress':
        return 'Publication en preparation';
      case 'published':
        return 'Publication terminee';
      case 'blocked':
        return 'Commandite bloquee';
      case 'waiting-payment':
        return 'Paiement en attente';
    }
  }

  feedTargetLabel(sponsorship: AdminSponsorshipRecord): string {
    if (sponsorship.sponsor_feed_target === 'openg7') {
      return 'OpenG7';
    }

    if (sponsorship.sponsor_feed_target === 'openg20') {
      return 'OpenG20';
    }

    return 'Aucune';
  }

  feedChannelsLabel(sponsorship: AdminSponsorshipRecord): string {
    if (sponsorship.sponsor_feed_channels.length === 0) {
      return 'Aucun canal';
    }

    return sponsorship.sponsor_feed_channels
      .map((channel) => (channel === 'linkedin' ? 'LinkedIn' : 'Facebook'))
      .join(' / ');
  }

  draftChannelsLabel(id: string): string {
    const draft = this.publicationDraftFor(id);
    const channels = [
      ...(draft.facebook ? ['Facebook'] : []),
      ...(draft.linkedin ? ['LinkedIn'] : [])
    ];

    return channels.length > 0 ? channels.join(' / ') : 'Aucun canal';
  }

  statusClass(status: SponsorshipReviewStatus): string {
    return `status-badge status-${status.replace('_review', '')}`;
  }

  paymentStatusLabel(status: string): string {
    if (status === 'paid') {
      return 'Paye';
    }

    if (status === 'refunded') {
      return 'Rembourse';
    }

    if (status === 'disputed') {
      return 'Litige';
    }

    if (status === 'failed') {
      return 'Echec de paiement';
    }

    return 'En attente';
  }

  paymentStatusClass(status: string): string {
    const state =
      status === 'paid'
        ? 'paid'
        : status === 'failed' || status === 'disputed'
          ? 'failed'
          : 'pending';

    return `payment-badge payment-${state}`;
  }

  paymentEligibilityMessage(sponsorship: AdminSponsorshipRecord): string {
    if (sponsorship.payment_status === 'refunded') {
      return 'Paiement rembourse: les nouvelles approbations et publications publiques sont bloquees.';
    }

    if (sponsorship.payment_status === 'disputed') {
      return "Paiement conteste: la visibilite et les nouvelles publications sont bloquees jusqu'a resolution.";
    }

    return '';
  }

  canApproveSponsorship(sponsorship: AdminSponsorshipRecord): boolean {
    return (
      sponsorship.payment_status === 'paid' ||
      sponsorship.sponsor_review_status === 'approved'
    );
  }

  canSavePublication(sponsorship: AdminSponsorshipRecord): boolean {
    return sponsorship.payment_status === 'paid';
  }

  formatMoney(sponsorship: AdminSponsorshipRecord): string {
    return `${new Intl.NumberFormat('fr-CA', {
      maximumFractionDigits: 0
    }).format(
      sponsorship.amount
    )} $ ${(sponsorship.currency || 'CAD').toUpperCase()}`;
  }

  formatSummaryMoney(amount: number): string {
    return `${new Intl.NumberFormat('fr-CA', {
      maximumFractionDigits: 0
    }).format(amount)} $ CAD`;
  }

  formatAmount(amount: number, currency: string): string {
    return new Intl.NumberFormat('fr-CA', {
      currency: currency || 'CAD',
      style: 'currency'
    }).format(amount);
  }

  sponsorshipTierLabel(sponsorship: AdminSponsorshipRecord): string {
    const { tier } = resolveSponsorshipBenefits(
      sponsorship.amount,
      DEFAULT_SPONSORSHIP_PRICING_CONFIG
    );

    switch (tier) {
      case 'website_facebook_linkedin':
        return 'Or';
      case 'website_facebook':
        return 'Argent';
      case 'website_only':
        return 'Bronze';
      default:
        return 'Indetermine';
    }
  }

  tierClass(sponsorship: AdminSponsorshipRecord): string {
    const tier = this.sponsorshipTierLabel(sponsorship).toLowerCase();
    const state =
      tier === 'or' ? 'gold' : tier === 'argent' ? 'silver' : 'bronze';

    return `tier-badge tier-${state}`;
  }

  sponsorshipBenefitsLabel(sponsorship: AdminSponsorshipRecord): string {
    const { achievedBenefits } = resolveSponsorshipBenefits(
      sponsorship.amount,
      DEFAULT_SPONSORSHIP_PRICING_CONFIG
    );

    if (achievedBenefits.length === 0) {
      return 'Aucun avantage (montant sous le minimum de commandite)';
    }

    const labels: Record<(typeof achievedBenefits)[number], string> = {
      website_mention: 'Mention OpenG7.org',
      facebook_batch: 'Lot collectif Facebook',
      linkedin_batch: 'Lot collectif LinkedIn'
    };

    return achievedBenefits.map((benefit) => labels[benefit]).join(', ');
  }

  dateOnlyLabel(value: string | null): string {
    if (!value) {
      return 'Non disponible';
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return 'Non disponible';
    }

    return new Intl.DateTimeFormat('fr-CA', {
      dateStyle: 'medium'
    }).format(date);
  }

  dateTimeLabel(value: string | null): string {
    if (!value) {
      return 'Non disponible';
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return 'Non disponible';
    }

    return new Intl.DateTimeFormat('fr-CA', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  submittedAt(sponsorship: AdminSponsorshipRecord): string | null {
    return (
      sponsorship.sponsor_details_submitted_at ||
      sponsorship.paid_at ||
      sponsorship.created_at
    );
  }

  publicNameLabel(sponsorship: AdminSponsorshipRecord): string {
    if (!sponsorship.public_display_consent) {
      return 'Non consenti';
    }

    return sponsorship.public_name || 'Consenti, nom manquant';
  }

  rejectionNotificationResultLabel(
    result: AdminSponsorshipReviewResult
  ): string {
    if (!result.notification) {
      return 'Aucun courriel envoye.';
    }

    if (result.notification.sent) {
      return 'Courriel envoye au commanditaire.';
    }

    if (result.notification.queued) {
      return 'Courriel mis en file.';
    }

    return result.notification.error
      ? `Courriel non envoye: ${result.notification.error}`
      : 'Courriel non envoye.';
  }

  rejectionRefundResultLabel(
    handling: AdminSponsorshipRejectionRefundHandling | undefined
  ): string {
    if (handling === 'manual_required') {
      return 'Remboursement a traiter manuellement.';
    }

    if (handling === 'manual_completed') {
      return 'Remboursement marque comme deja traite.';
    }

    return '';
  }

  refundResultLabel(result: AdminSponsorshipRefundResult): string {
    const status = result.refundStatus
      ? ` Statut Stripe: ${result.refundStatus}.`
      : '';
    const localStatus = result.paymentStatusUpdated
      ? ' Commandite marquee comme remboursee.'
      : '';
    const creditNote = result.creditNote
      ? ` Avoir cree: ${result.creditNote.credit_note_number}.`
      : '';

    return `Remboursement Stripe cree: ${this.formatAmount(
      result.amount,
      result.currency
    )}.${status}${localStatus}${creditNote}`;
  }

  refundNotificationResultLabel(result: AdminSponsorshipRefundResult): string {
    if (!result.notification) {
      return '';
    }

    if (result.notification.sent) {
      return 'Courriel de remboursement/avoir envoye.';
    }

    if (result.notification.queued) {
      return 'Courriel de remboursement/avoir mis en file.';
    }

    return result.notification.error
      ? `Courriel de remboursement/avoir non envoye: ${result.notification.error}`
      : 'Courriel de remboursement/avoir non envoye.';
  }

  isReviewNoteDirty(sponsorship: AdminSponsorshipRecord): boolean {
    return (
      this.reviewNoteFor(sponsorship.id).trim() !==
      (sponsorship.sponsor_review_note ?? '').trim()
    );
  }

  reviewNoteStateLabel(sponsorship: AdminSponsorshipRecord): string {
    const message = this.noteMessages()[sponsorship.id];
    if (message) {
      return message;
    }

    return this.isReviewNoteDirty(sponsorship)
      ? 'Modifications non enregistrees'
      : 'Note enregistree';
  }

  publicationDirtyFor(sponsorship: AdminSponsorshipRecord): boolean {
    const draft = this.publicationDraftFor(sponsorship.id);
    const original = this.toPublicationDraft(sponsorship, false, false);

    return (
      draft.publicSlug !== original.publicSlug ||
      draft.publicSummary !== original.publicSummary ||
      draft.feedTarget !== original.feedTarget ||
      draft.facebook !== original.facebook ||
      draft.linkedin !== original.linkedin ||
      draft.feedStatus !== original.feedStatus ||
      draft.feedPublicUrl !== original.feedPublicUrl ||
      draft.feedNotes !== original.feedNotes
    );
  }

  publicationStateLabel(sponsorship: AdminSponsorshipRecord): string {
    const message = this.publicationMessages()[sponsorship.id];
    if (message) {
      return message;
    }

    const paymentMessage = this.paymentEligibilityMessage(sponsorship);
    if (paymentMessage) {
      return paymentMessage;
    }

    const slugError = this.slugErrorFor(sponsorship);
    if (slugError) {
      return slugError;
    }

    return this.publicationDirtyFor(sponsorship)
      ? 'Modifications non enregistrees'
      : 'Publication enregistree';
  }

  slugErrorFor(sponsorship: AdminSponsorshipRecord): string {
    const slug = this.publicationDraftFor(sponsorship.id).publicSlug.trim();
    if (!slug) {
      return '';
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return 'Utilisez seulement des lettres, chiffres et tirets.';
    }

    const duplicate = this.sponsorships().some(
      (item) =>
        item.id !== sponsorship.id &&
        this.normalizeSlug(item.sponsor_public_slug ?? '') === slug
    );

    return duplicate ? 'Ce slug est deja utilise.' : '';
  }

  hasSlugError(sponsorship: AdminSponsorshipRecord): boolean {
    return Boolean(this.slugErrorFor(sponsorship));
  }

  auditEntriesFor(sponsorship: AdminSponsorshipRecord): SponsorAuditEntry[] {
    const entries: SponsorAuditEntry[] = [];
    entries.push({
      id: `${sponsorship.id}:created`,
      date: sponsorship.created_at,
      label: 'Reception de la commandite.'
    });

    if (sponsorship.paid_at) {
      entries.push({
        id: `${sponsorship.id}:paid`,
        date: sponsorship.paid_at,
        label: 'Paiement confirme.',
        detail: this.paymentStatusLabel(sponsorship.payment_status)
      });
    }

    if (sponsorship.sponsor_details_submitted_at) {
      entries.push({
        id: `${sponsorship.id}:details`,
        date: sponsorship.sponsor_details_submitted_at,
        label: 'Details commanditaire recus.'
      });
    }

    if (sponsorship.sponsor_reviewed_at) {
      entries.push({
        id: `${sponsorship.id}:reviewed`,
        date: sponsorship.sponsor_reviewed_at,
        label: `Statut de revue: ${this.reviewStatusLabel(
          sponsorship.sponsor_review_status
        )}.`
      });
    }

    if (sponsorship.sponsor_visibility_updated_at) {
      entries.push({
        id: `${sponsorship.id}:visibility`,
        date: sponsorship.sponsor_visibility_updated_at,
        label: 'Donnees de publication mises a jour.',
        detail: this.feedStatusLabel(sponsorship.sponsor_feed_status)
      });
    }

    for (const entry of sponsorship.admin_audit_entries ?? []) {
      entries.push({
        id: entry.id,
        date: entry.created_at,
        label: this.adminAuditLabel(entry),
        detail: this.adminAuditDetail(entry)
      });
    }

    return entries.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  trackByAuditEntry(_: number, entry: SponsorAuditEntry): string {
    return entry.id;
  }

  private adminAuditLabel(entry: AdminAuditLogEntry): string {
    if (entry.action.startsWith('sponsorship_review.')) {
      const reviewStatus =
        typeof entry.metadata.reviewStatus === 'string'
          ? (entry.metadata.reviewStatus as SponsorshipReviewStatus)
          : null;
      return reviewStatus
        ? `Decision admin: ${this.reviewStatusLabel(reviewStatus)}.`
        : 'Decision admin enregistree.';
    }

    switch (entry.action) {
      case 'sponsorship.logo.upload':
        return 'Logo commanditaire ajoute ou remplace.';
      case 'sponsorship.logo.delete':
        return 'Logo commanditaire supprime.';
      case 'sponsorship_refund.stripe_full':
        return 'Remboursement Stripe complet cree.';
      case 'sponsorship_publication.update':
        return 'Publication commanditaire mise a jour.';
      default:
        return entry.summary || entry.action;
    }
  }

  private adminAuditDetail(entry: AdminAuditLogEntry): string {
    const details = [`Acteur: ${entry.actor}`];

    if (entry.action === 'sponsorship_refund.stripe_full') {
      const refundId =
        typeof entry.metadata.refundId === 'string'
          ? entry.metadata.refundId
          : null;
      const refundStatus =
        typeof entry.metadata.refundStatus === 'string'
          ? entry.metadata.refundStatus
          : null;
      if (refundId) {
        details.push(`Refund: ${refundId}`);
      }
      if (refundStatus) {
        details.push(`Statut: ${refundStatus}`);
      }
    }

    if (entry.action === 'sponsorship_publication.update') {
      const feedStatus =
        typeof entry.metadata.feedStatus === 'string'
          ? (entry.metadata.feedStatus as SponsorFeedStatus)
          : null;
      if (feedStatus) {
        details.push(`Publication: ${this.feedStatusLabel(feedStatus)}`);
      }
    }

    if (entry.action.startsWith('sponsorship_review.')) {
      const notificationSent =
        typeof entry.metadata.notificationSent === 'boolean'
          ? entry.metadata.notificationSent
          : null;
      if (notificationSent !== null) {
        details.push(
          notificationSent ? 'Courriel envoye' : 'Courriel non envoye'
        );
      }
    }

    return details.join(' · ');
  }

  async copyReference(sponsorship: AdminSponsorshipRecord): Promise<void> {
    if (!sponsorship.public_reference) {
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(sponsorship.public_reference);
      }
      this.setCopyMessage(sponsorship.id, 'Reference copiee.');
    } catch {
      this.setCopyMessage(sponsorship.id, 'Copie impossible.');
    }
  }

  private toPublicationDraft(
    sponsorship: AdminSponsorshipRecord,
    useGeneratedSlug = true,
    includePromisedChannels = true
  ): SponsorshipPublicationDraft {
    const defaultSlug = this.normalizeSlug(
      useGeneratedSlug
        ? sponsorship.sponsor_public_slug ||
            sponsorship.public_name ||
            sponsorship.sponsor_company_name ||
            sponsorship.public_reference ||
            ''
        : sponsorship.sponsor_public_slug || ''
    );
    const feedChannels = new Set<SponsorFeedChannel>([
      ...sponsorship.sponsor_feed_channels,
      ...(includePromisedChannels
        ? this.promisedFeedChannelsFor(sponsorship)
        : [])
    ]);

    return {
      publicSlug: defaultSlug,
      publicSummary: sponsorship.sponsor_public_summary ?? '',
      feedTarget: sponsorship.sponsor_feed_target ?? '',
      facebook: feedChannels.has('facebook'),
      linkedin: feedChannels.has('linkedin'),
      feedStatus: sponsorship.sponsor_feed_status,
      feedPublicUrl: sponsorship.sponsor_feed_public_url ?? '',
      feedNotes: sponsorship.sponsor_feed_notes ?? ''
    };
  }

  private emptyPublicationDraft(): SponsorshipPublicationDraft {
    return {
      publicSlug: '',
      publicSummary: '',
      feedTarget: '',
      facebook: false,
      linkedin: false,
      feedStatus: 'not_planned',
      feedPublicUrl: '',
      feedNotes: ''
    };
  }

  private ensureRejectionDraft(sponsorship: AdminSponsorshipRecord): void {
    this.rejectionDrafts.update((drafts) =>
      drafts[sponsorship.id]
        ? drafts
        : {
            ...drafts,
            [sponsorship.id]: this.defaultRejectionDraft(sponsorship)
          }
    );
  }

  private defaultRejectionDraft(
    sponsorship: AdminSponsorshipRecord
  ): SponsorRejectionDraft {
    const sponsorName =
      sponsorship.sponsor_company_name ||
      sponsorship.public_name ||
      'votre organisation';

    return {
      notifySponsor: Boolean(sponsorship.sponsor_contact_email),
      recipientEmail: sponsorship.sponsor_contact_email ?? '',
      sponsorMessage: [
        `Bonjour ${sponsorName},`,
        '',
        'Apres revision, nous ne pouvons pas accepter cette commandite OpenG7 pour le moment.',
        '',
        'Merci de votre comprehension. Vous pouvez repondre a ce courriel si vous souhaitez clarifier la situation.'
      ].join('\n'),
      refundHandling: 'none',
      refundNote: ''
    };
  }

  private emptyRejectionDraft(): SponsorRejectionDraft {
    return {
      notifySponsor: false,
      recipientEmail: '',
      sponsorMessage: '',
      refundHandling: 'none',
      refundNote: ''
    };
  }

  private ensureRefundDraft(sponsorship: AdminSponsorshipRecord): void {
    this.refundDrafts.update((drafts) =>
      drafts[sponsorship.id]
        ? drafts
        : {
            ...drafts,
            [sponsorship.id]: this.defaultRefundDraft(sponsorship)
          }
    );
  }

  private defaultRefundDraft(
    sponsorship: AdminSponsorshipRecord
  ): SponsorRefundDraft {
    const sponsorName =
      sponsorship.sponsor_company_name ||
      sponsorship.public_name ||
      'votre organisation';

    return {
      confirmationText: '',
      notifySponsor: Boolean(sponsorship.sponsor_contact_email),
      recipientEmail: sponsorship.sponsor_contact_email ?? '',
      sponsorMessage: [
        `Bonjour ${sponsorName},`,
        '',
        'Nous confirmons que le remboursement Stripe complet de votre commandite OpenG7 vient d etre lance.',
        '',
        'Selon votre institution financiere, le credit peut prendre quelques jours ouvrables avant d apparaitre.'
      ].join('\n'),
      refundNote: ''
    };
  }

  private emptyRefundDraft(): SponsorRefundDraft {
    return {
      confirmationText: '',
      notifySponsor: false,
      recipientEmail: '',
      sponsorMessage: '',
      refundNote: ''
    };
  }

  private isValidEmailDraft(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  private saveToken(): void {
    this.admin.saveAdminToken(this.adminToken());
  }

  private setLogoUploadMessage(id: string, message: string): void {
    this.logoUploadMessages.update((messages) => ({
      ...messages,
      [id]: message
    }));
  }

  private setReviewMessage(
    id: string,
    message: string,
    autoHide = false
  ): void {
    this.clearReviewMessageTimer(id);
    this.reviewMessages.update((messages) => ({
      ...messages,
      [id]: message
    }));

    if (autoHide) {
      this.reviewMessageTimers.set(
        id,
        setTimeout(() => {
          this.clearReviewMessage(id, message);
        }, 3000)
      );
    }
  }

  private clearReviewMessage(id: string, expectedMessage?: string): void {
    this.clearReviewMessageTimer(id);
    this.reviewMessages.update((messages) => {
      if (expectedMessage !== undefined && messages[id] !== expectedMessage) {
        return messages;
      }

      const remaining = { ...messages };
      delete remaining[id];
      return remaining;
    });
  }

  private clearReviewMessageTimer(id: string): void {
    const timer = this.reviewMessageTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.reviewMessageTimers.delete(id);
    }
  }

  private clearReviewMessageTimers(): void {
    for (const timer of this.reviewMessageTimers.values()) {
      clearTimeout(timer);
    }
    this.reviewMessageTimers.clear();
  }

  private pulseSelection(id: string): void {
    this.clearSelectionPulseTimer();
    this.selectionPulseId.set(null);
    this.selectionPulseTimer = setTimeout(() => {
      this.selectionPulseId.set(id);
      this.selectionPulseTimer = setTimeout(() => {
        if (this.selectionPulseId() === id) {
          this.selectionPulseId.set(null);
        }
        this.selectionPulseTimer = null;
      }, 520);
    }, 0);
  }

  private scrollSelectedSponsorshipIntoView(): void {
    if (typeof window === 'undefined') {
      return;
    }

    setTimeout(() => {
      const detailPanel = this.sponsorDetailPanel?.nativeElement;
      if (!detailPanel) {
        return;
      }

      const { top, bottom } = detailPanel.getBoundingClientRect();
      const viewportHeight =
        window.innerHeight || document.documentElement.clientHeight;
      if (top >= 0 && bottom <= viewportHeight) {
        return;
      }

      detailPanel.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }, 0);
  }

  private clearSelectionPulseTimer(): void {
    if (this.selectionPulseTimer) {
      clearTimeout(this.selectionPulseTimer);
      this.selectionPulseTimer = null;
    }
  }

  private setPublicationMessage(id: string, message: string): void {
    this.publicationMessages.update((messages) => ({
      ...messages,
      [id]: message
    }));
  }

  private setNoteMessage(id: string, message: string): void {
    this.noteMessages.update((messages) => ({
      ...messages,
      [id]: message
    }));
  }

  private setCopyMessage(id: string, message: string): void {
    this.copyMessages.update((messages) => ({
      ...messages,
      [id]: message
    }));
  }

  private messageFromError(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.trim()
      ? error.message
      : fallback;
  }

  private normalizeSlug(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }

  private async loadLogoPreviews(
    sponsorships: readonly AdminSponsorshipRecord[]
  ): Promise<void> {
    this.revokeLogoPreviews();

    if (
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      return;
    }

    const previewEntries = await Promise.all(
      sponsorships
        .filter((sponsorship) =>
          this.isControlledLogoUrl(sponsorship.sponsor_logo_url)
        )
        .map(async (sponsorship) => {
          try {
            const logo = await this.admin.getSponsorLogoPreview(
              this.adminToken(),
              sponsorship.id
            );
            return [sponsorship.id, URL.createObjectURL(logo)] as const;
          } catch {
            return null;
          }
        })
    );

    this.logoPreviewUrls.set(
      Object.fromEntries(
        previewEntries.filter(
          (entry): entry is readonly [string, string] => entry !== null
        )
      )
    );
  }

  private revokeLogoPreviews(): void {
    if (
      typeof URL !== 'undefined' &&
      typeof URL.revokeObjectURL === 'function'
    ) {
      for (const objectUrl of Object.values(this.logoPreviewUrls())) {
        URL.revokeObjectURL(objectUrl);
      }
    }

    this.logoPreviewUrls.set({});
  }

  private isControlledLogoUrl(logoUrl: string | null): boolean {
    return Boolean(
      logoUrl &&
      controlledSponsorLogoUrlPrefixes.some((prefix) =>
        logoUrl.startsWith(prefix)
      )
    );
  }

  private valueFromEvent(event: Event): string {
    return (
      (
        event.target as
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
      )?.value ?? ''
    );
  }
}
