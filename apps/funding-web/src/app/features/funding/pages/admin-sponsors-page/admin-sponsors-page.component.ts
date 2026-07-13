import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
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
  AdminSponsorshipRecord,
  SponsorFeedStatus,
  SponsorFeedTarget,
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

      <section class="admin-content">
        <header class="admin-topbar">
          <div>
            <span>Administration</span>
            <h1>Commandites d'entreprise</h1>
          </div>
          <a routerLink="/fonds-des-batisseurs">Retour au fonds</a>
        </header>

        <section class="admin-auth-panel" aria-labelledby="admin-auth-title">
          <div>
            <h2 id="admin-auth-title">Acces de revue</h2>
            <p>
              En production, utilisez le jeton configure dans
              <code>FUNDING_ADMIN_TOKEN</code>.
            </p>
          </div>
          <label>
            Jeton admin
            <input
              type="password"
              autocomplete="off"
              [value]="adminToken()"
              (input)="setAdminToken($event)"
            />
          </label>
          <button type="button" (click)="loadSponsorships()">Actualiser</button>
        </section>

        <section class="admin-summary-grid" aria-label="Resume des commandites">
          <article>
            <span>En attente</span>
            <strong>{{ pendingCount() }}</strong>
          </article>
          <article>
            <span>Approuvees</span>
            <strong>{{ approvedCount() }}</strong>
          </article>
          <article>
            <span>Refusees</span>
            <strong>{{ rejectedCount() }}</strong>
          </article>
          <article>
            <span>Total</span>
            <strong>{{ sponsorships().length }}</strong>
          </article>
        </section>

        <section class="admin-filters" aria-label="Filtres commandites">
          <label>
            Recherche
            <input
              type="search"
              placeholder="Entreprise, contact, courriel, référence..."
              [value]="search()"
              (input)="setSearch($event)"
            />
          </label>

          <label>
            Statut revue
            <select [value]="reviewFilter()" (change)="setReviewFilter($event)">
              <option value="all">Tous</option>
              <option value="pending_review">En attente</option>
              <option value="approved">Approuvees</option>
              <option value="rejected">Refusees</option>
            </select>
          </label>

          <label>
            Statut feed
            <select [value]="feedFilter()" (change)="setFeedFilter($event)">
              <option value="all">Tous</option>
              <option *ngFor="let status of feedStatuses" [value]="status">
                {{ feedStatusLabel(status) }}
              </option>
            </select>
          </label>
        </section>

        <p class="state" *ngIf="state() === 'loading'">
          Chargement des commandites...
        </p>
        <p class="state state-error" *ngIf="state() === 'error'">
          Impossible de charger ou modifier les commandites. Verifiez le jeton,
          la base de donnees et les migrations.
        </p>

        <section
          class="sponsorship-admin-list"
          aria-label="Liste des commandites"
        >
          <article
            class="sponsorship-admin-item"
            *ngFor="
              let sponsorship of filteredSponsorships();
              trackBy: trackById
            "
          >
            <header>
              <div>
                <span [class]="statusClass(sponsorship.sponsor_review_status)">
                  {{ reviewStatusLabel(sponsorship.sponsor_review_status) }}
                </span>
                <h2>
                  {{
                    sponsorship.sponsor_company_name || 'Entreprise sans nom'
                  }}
                </h2>
              </div>
              <div class="amount-and-tier">
                <strong>{{ formatMoney(sponsorship) }}</strong>
                <small class="tier-badge">{{
                  sponsorshipTierLabel(sponsorship)
                }}</small>
              </div>
            </header>

            <dl class="sponsorship-admin-fields">
              <div>
                <dt>Référence</dt>
                <dd class="reference-code">
                  {{ sponsorship.public_reference || 'Non attribuée' }}
                </dd>
              </div>
              <div>
                <dt>Avantages</dt>
                <dd>{{ sponsorshipBenefitsLabel(sponsorship) }}</dd>
              </div>
              <div>
                <dt>Contact</dt>
                <dd>{{ sponsorship.sponsor_contact_name || 'Non fourni' }}</dd>
              </div>
              <div>
                <dt>Courriel</dt>
                <dd>{{ sponsorship.sponsor_contact_email || 'Non fourni' }}</dd>
              </div>
              <div>
                <dt>Site web</dt>
                <dd>
                  <a
                    *ngIf="sponsorship.sponsor_website_url; else emptyWebsite"
                    [href]="sponsorship.sponsor_website_url"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {{ sponsorship.sponsor_website_url }}
                  </a>
                  <ng-template #emptyWebsite>Non fourni</ng-template>
                </dd>
              </div>
              <div>
                <dt>Logo</dt>
                <dd>
                  <ng-container
                    *ngIf="sponsorship.sponsor_logo_url; else emptyLogo"
                  >
                    <figure
                      class="logo-preview"
                      *ngIf="logoPreviewSourceFor(sponsorship)"
                    >
                      <img
                        [src]="logoPreviewSourceFor(sponsorship)"
                        [alt]="
                          'Logo ' +
                          (sponsorship.sponsor_company_name || 'commanditaire')
                        "
                      />
                    </figure>
                    <a
                      [href]="sponsorship.sponsor_logo_url"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {{ sponsorship.sponsor_logo_url }}
                    </a>
                    <button
                      type="button"
                      class="logo-delete-button"
                      [disabled]="
                        actionState() === deleteLogoActionId(sponsorship.id) ||
                        actionState() === logoActionId(sponsorship.id)
                      "
                      (click)="deleteLogo(sponsorship)"
                    >
                      Supprimer
                    </button>
                  </ng-container>
                  <ng-template #emptyLogo>Non fourni</ng-template>
                  <label class="logo-upload-control">
                    {{
                      sponsorship.sponsor_logo_url
                        ? 'Remplacer le logo'
                        : 'Televerser un logo'
                    }}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      [disabled]="
                        actionState() === logoActionId(sponsorship.id) ||
                        actionState() === deleteLogoActionId(sponsorship.id)
                      "
                      (change)="uploadLogo(sponsorship, $event)"
                    />
                  </label>
                  <small
                    class="logo-upload-state"
                    *ngIf="logoUploadMessageFor(sponsorship.id)"
                  >
                    {{ logoUploadMessageFor(sponsorship.id) }}
                  </small>
                </dd>
              </div>
              <div>
                <dt>Nom public</dt>
                <dd>{{ publicNameLabel(sponsorship) }}</dd>
              </div>
              <div>
                <dt>Paiement</dt>
                <dd>
                  {{ sponsorship.payment_status }} ·
                  {{ dateLabel(sponsorship.paid_at) }}
                </dd>
              </div>
              <div>
                <dt>Details recus</dt>
                <dd>
                  {{ dateLabel(sponsorship.sponsor_details_submitted_at) }}
                </dd>
              </div>
              <div>
                <dt>Derniere revue</dt>
                <dd>{{ dateLabel(sponsorship.sponsor_reviewed_at) }}</dd>
              </div>
            </dl>

            <p class="sponsor-message" *ngIf="sponsorship.sponsor_message">
              {{ sponsorship.sponsor_message }}
            </p>

            <label class="review-note-label">
              Note interne
              <textarea
                rows="3"
                maxlength="1000"
                [value]="reviewNoteFor(sponsorship.id)"
                (input)="setReviewNote(sponsorship.id, $event)"
              ></textarea>
            </label>

            <section
              class="publication-editor"
              aria-label="Visibilite publique et feeds"
            >
              <header>
                <div>
                  <span>Publication</span>
                  <h3>Commanditaire et feeds</h3>
                </div>
                <button
                  type="button"
                  class="publication-save"
                  [disabled]="actionState() === sponsorship.id"
                  (click)="savePublication(sponsorship)"
                >
                  Enregistrer
                </button>
              </header>

              <div class="publication-grid">
                <label>
                  Slug public
                  <input
                    type="text"
                    maxlength="120"
                    [value]="publicationDraftFor(sponsorship.id).publicSlug"
                    (input)="
                      setPublicationField(sponsorship.id, 'publicSlug', $event)
                    "
                  />
                </label>

                <label>
                  Destination feed
                  <select
                    [value]="publicationDraftFor(sponsorship.id).feedTarget"
                    (change)="
                      setPublicationField(sponsorship.id, 'feedTarget', $event)
                    "
                  >
                    <option value="">Aucune</option>
                    <option value="openg7">OpenG7</option>
                    <option value="openg20">OpenG20</option>
                  </select>
                </label>

                <label>
                  Statut feed
                  <select
                    [value]="publicationDraftFor(sponsorship.id).feedStatus"
                    (change)="
                      setPublicationField(sponsorship.id, 'feedStatus', $event)
                    "
                  >
                    <option
                      *ngFor="let status of feedStatuses"
                      [value]="status"
                    >
                      {{ feedStatusLabel(status) }}
                    </option>
                  </select>
                </label>

                <fieldset>
                  <legend>Canaux</legend>
                  <label>
                    <input
                      type="checkbox"
                      [checked]="publicationDraftFor(sponsorship.id).facebook"
                      (change)="
                        setPublicationChannel(
                          sponsorship.id,
                          'facebook',
                          $event
                        )
                      "
                    />
                    Facebook
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      [checked]="publicationDraftFor(sponsorship.id).linkedin"
                      (change)="
                        setPublicationChannel(
                          sponsorship.id,
                          'linkedin',
                          $event
                        )
                      "
                    />
                    LinkedIn
                  </label>
                </fieldset>

                <label class="publication-span-2">
                  Resume public
                  <textarea
                    rows="3"
                    maxlength="500"
                    [value]="publicationDraftFor(sponsorship.id).publicSummary"
                    (input)="
                      setPublicationField(
                        sponsorship.id,
                        'publicSummary',
                        $event
                      )
                    "
                  ></textarea>
                </label>

                <label>
                  Lien de publication
                  <input
                    type="url"
                    maxlength="2048"
                    [value]="publicationDraftFor(sponsorship.id).feedPublicUrl"
                    (input)="
                      setPublicationField(
                        sponsorship.id,
                        'feedPublicUrl',
                        $event
                      )
                    "
                  />
                </label>

                <label class="publication-span-2">
                  Notes feed
                  <textarea
                    rows="3"
                    maxlength="1000"
                    [value]="publicationDraftFor(sponsorship.id).feedNotes"
                    (input)="
                      setPublicationField(sponsorship.id, 'feedNotes', $event)
                    "
                  ></textarea>
                </label>
              </div>
            </section>

            <footer>
              <button
                type="button"
                class="review-button neutral"
                [disabled]="actionState() === sponsorship.id"
                (click)="review(sponsorship, 'pending_review')"
              >
                Remettre en attente
              </button>
              <button
                type="button"
                class="review-button reject"
                [disabled]="actionState() === sponsorship.id"
                (click)="review(sponsorship, 'rejected')"
              >
                Refuser
              </button>
              <button
                type="button"
                class="review-button approve"
                [disabled]="actionState() === sponsorship.id"
                (click)="review(sponsorship, 'approved')"
              >
                Accepter
              </button>
            </footer>
          </article>

          <article
            class="empty-admin-state"
            *ngIf="state() === 'ready' && sponsorships().length === 0"
          >
            <h2>Aucune commandite a reviser</h2>
            <p>
              Les commandites payees apparaitront ici apres confirmation Stripe
              et synchronisation PostgreSQL.
            </p>
          </article>

          <article
            class="empty-admin-state"
            *ngIf="
              state() === 'ready' &&
              sponsorships().length > 0 &&
              filteredSponsorships().length === 0
            "
          >
            <h2>Aucune commandite ne correspond aux filtres</h2>
            <p>Modifiez la recherche, le statut de revue ou le statut feed.</p>
          </article>
        </section>
      </section>
    </main>
  `,
  styles: [
    `
      .admin-shell {
        background: #f5f7fb;
        color: #172033;
        display: grid;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        gap: 1rem;
        grid-template-columns: 15rem minmax(0, 1fr);
        min-height: 100vh;
        padding: 1.25rem;
      }

      .admin-content {
        min-width: 0;
      }

      .admin-topbar,
      .admin-auth-panel,
      .admin-summary-grid,
      .admin-filters,
      .sponsorship-admin-list {
        margin: 0 auto;
        max-width: 72rem;
      }

      .admin-topbar {
        align-items: center;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
        margin-bottom: 1rem;
      }

      .admin-topbar span,
      .admin-summary-grid span,
      .sponsorship-admin-item dt {
        color: #667085;
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .admin-topbar h1,
      .admin-auth-panel h2,
      .sponsorship-admin-item h2,
      .empty-admin-state h2 {
        margin: 0;
      }

      .admin-topbar a {
        color: #254db8;
        font-weight: 800;
        text-decoration: none;
      }

      .admin-auth-panel {
        align-items: end;
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.45rem;
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem) auto;
        padding: 1rem;
      }

      .admin-auth-panel p,
      .empty-admin-state p,
      .sponsor-message {
        color: #526070;
        line-height: 1.55;
        margin: 0.35rem 0 0;
      }

      .admin-auth-panel label,
      .review-note-label,
      .publication-grid label,
      .publication-editor fieldset,
      .admin-filters label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.85rem;
        font-weight: 800;
      }

      .admin-auth-panel input,
      .admin-filters input,
      .admin-filters select,
      .review-note-label textarea,
      .publication-grid input,
      .publication-grid select,
      .publication-grid textarea {
        border: 1px solid #cdd6e3;
        border-radius: 0.35rem;
        font: inherit;
        padding: 0.65rem 0.75rem;
      }

      .admin-auth-panel button,
      .review-button,
      .publication-save {
        border: 0;
        border-radius: 0.35rem;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
        min-height: 2.7rem;
        padding: 0 0.9rem;
      }

      .admin-auth-panel button {
        background: #18233a;
        color: #fff;
      }

      .admin-summary-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        margin-top: 1rem;
      }

      .admin-summary-grid article,
      .admin-filters,
      .sponsorship-admin-item,
      .empty-admin-state {
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.45rem;
      }

      .admin-summary-grid article {
        padding: 1rem;
      }

      .admin-summary-grid strong {
        display: block;
        font-size: 2rem;
        margin-top: 0.2rem;
      }

      .admin-filters {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: minmax(14rem, 2fr) repeat(2, minmax(10rem, 1fr));
        margin-top: 1rem;
        padding: 1rem;
      }

      .state {
        margin: 1rem auto 0;
        max-width: 72rem;
      }

      .state-error {
        color: #9f1d2f;
        font-weight: 800;
      }

      .sponsorship-admin-list {
        display: grid;
        gap: 1rem;
        margin-top: 1rem;
      }

      .sponsorship-admin-item {
        display: grid;
        gap: 1rem;
        padding: 1rem;
      }

      .sponsorship-admin-item header,
      .sponsorship-admin-item footer {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .sponsorship-admin-item header strong {
        color: #172033;
        font-size: 1.35rem;
      }

      .amount-and-tier {
        display: grid;
        gap: 0.25rem;
        justify-items: end;
        text-align: right;
      }

      .tier-badge {
        background: #eef1f8;
        border-radius: 999px;
        color: #38425a;
        font-size: 0.7rem;
        font-weight: 800;
        padding: 0.2rem 0.55rem;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .status-badge {
        border-radius: 999px;
        display: inline-flex;
        font-size: 0.72rem;
        font-weight: 900;
        margin-bottom: 0.35rem;
        padding: 0.25rem 0.55rem;
        text-transform: uppercase;
      }

      .status-pending {
        background: #fff2cf;
        color: #8a5a00;
      }

      .status-approved {
        background: #dff7e8;
        color: #176236;
      }

      .status-rejected {
        background: #ffe0e5;
        color: #9f1d2f;
      }

      .sponsorship-admin-fields {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        margin: 0;
      }

      .sponsorship-admin-fields div {
        min-width: 0;
      }

      .sponsorship-admin-fields dd {
        margin: 0.15rem 0 0;
        overflow-wrap: anywhere;
      }

      .sponsorship-admin-fields a {
        color: #254db8;
      }

      .reference-code {
        font-family:
          ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace;
        font-weight: 900;
        letter-spacing: 0;
      }

      .logo-preview {
        align-items: center;
        background: #f4f7fb;
        border: 1px solid #d9e0ea;
        border-radius: 0.35rem;
        display: flex;
        height: 4.5rem;
        justify-content: center;
        margin: 0.35rem 0 0.5rem;
        overflow: hidden;
        width: 8rem;
      }

      .logo-preview img {
        display: block;
        max-height: 100%;
        max-width: 100%;
        object-fit: contain;
      }

      .logo-upload-control {
        color: #172033;
        display: grid;
        gap: 0.35rem;
        margin-top: 0.5rem;
      }

      .logo-delete-button {
        background: #fff0f2;
        border: 1px solid #f1a8b4;
        border-radius: 0.35rem;
        color: #9f1d2f;
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        font-size: 0.8rem;
        font-weight: 900;
        margin-top: 0.5rem;
        padding: 0.45rem 0.65rem;
      }

      .logo-delete-button:disabled {
        cursor: wait;
        opacity: 0.62;
      }

      .logo-upload-control input {
        font: inherit;
        max-width: 100%;
      }

      .logo-upload-state {
        color: #667085;
        display: block;
        font-weight: 800;
        margin-top: 0.35rem;
      }

      .review-note-label textarea {
        min-height: 5rem;
        resize: vertical;
      }

      .publication-editor {
        border: 1px solid #d9e0ea;
        border-radius: 0.45rem;
        display: grid;
        gap: 0.85rem;
        padding: 1rem;
      }

      .publication-editor header {
        margin: 0;
      }

      .publication-editor header span {
        color: #667085;
        display: block;
        font-size: 0.72rem;
        font-weight: 900;
        letter-spacing: 0;
        margin-bottom: 0.2rem;
        text-transform: uppercase;
      }

      .publication-editor h3 {
        margin: 0;
      }

      .publication-save {
        background: #254db8;
        color: #fff;
      }

      .publication-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .publication-grid textarea {
        min-height: 5rem;
        resize: vertical;
      }

      .publication-span-2 {
        grid-column: span 2;
      }

      .publication-editor fieldset {
        border: 1px solid #d9e0ea;
        border-radius: 0.35rem;
        margin: 0;
        padding: 0.65rem 0.75rem;
      }

      .publication-editor fieldset label {
        align-items: center;
        display: flex;
        gap: 0.45rem;
        font-weight: 700;
      }

      .publication-editor fieldset input {
        height: 1rem;
        width: 1rem;
      }

      .sponsorship-admin-item footer {
        justify-content: flex-end;
      }

      .review-button:disabled {
        cursor: wait;
        opacity: 0.62;
      }

      .review-button.neutral {
        background: #eef2f7;
        color: #1f2937;
      }

      .review-button.reject {
        background: #9f1d2f;
        color: #fff;
      }

      .review-button.approve {
        background: #176236;
        color: #fff;
      }

      .empty-admin-state {
        padding: 1rem;
      }

      @media (max-width: 860px) {
        .admin-shell,
        .admin-auth-panel,
        .admin-summary-grid,
        .admin-filters,
        .sponsorship-admin-fields,
        .publication-grid {
          grid-template-columns: 1fr;
        }

        .publication-span-2 {
          grid-column: auto;
        }

        .admin-topbar {
          align-items: start;
          flex-direction: column;
        }
      }
    `
  ]
})
export class AdminSponsorsPageComponent implements OnInit, OnDestroy {
  private readonly admin = inject(FundingAdminService);

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
  readonly feedStatuses = feedStatuses;

  readonly filteredSponsorships = computed(() => {
    const search = this.search().trim().toLowerCase();
    const reviewFilter = this.reviewFilter();
    const feedFilter = this.feedFilter();

    return this.sponsorships().filter((sponsorship) => {
      const searchable = [
        sponsorship.public_reference,
        sponsorship.sponsor_company_name,
        sponsorship.sponsor_contact_name,
        sponsorship.sponsor_contact_email,
        sponsorship.sponsor_website_url,
        sponsorship.public_name,
        sponsorship.sponsor_public_slug
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return (
        (!search || searchable.includes(search)) &&
        (reviewFilter === 'all' ||
          sponsorship.sponsor_review_status === reviewFilter) &&
        (feedFilter === 'all' || sponsorship.sponsor_feed_status === feedFilter)
      );
    });
  });

  readonly pendingCount = computed(
    () =>
      this.sponsorships().filter(
        (item) => item.sponsor_review_status === 'pending_review'
      ).length
  );
  readonly approvedCount = computed(
    () =>
      this.sponsorships().filter(
        (item) => item.sponsor_review_status === 'approved'
      ).length
  );
  readonly rejectedCount = computed(
    () =>
      this.sponsorships().filter(
        (item) => item.sponsor_review_status === 'rejected'
      ).length
  );

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    void this.loadSponsorships();
  }

  ngOnDestroy(): void {
    this.revokeLogoPreviews();
  }

  async loadSponsorships(): Promise<void> {
    this.state.set('loading');

    try {
      const response = await this.admin.getSponsorships(this.adminToken());
      this.sponsorships.set(response.sponsorships);
      this.reviewNotes.set(
        Object.fromEntries(
          response.sponsorships.map((item) => [
            item.id,
            item.sponsor_review_note ?? ''
          ])
        )
      );
      this.publicationDrafts.set(
        Object.fromEntries(
          response.sponsorships.map((item) => [
            item.id,
            this.toPublicationDraft(item)
          ])
        )
      );
      this.state.set('ready');
      this.saveToken();
      void this.loadLogoPreviews(response.sponsorships);
    } catch {
      this.state.set('error');
    }
  }

  async review(
    sponsorship: AdminSponsorshipRecord,
    reviewStatus: SponsorshipReviewStatus
  ): Promise<void> {
    this.actionState.set(sponsorship.id);

    try {
      await this.admin.reviewSponsorship(this.adminToken(), {
        contributionId: sponsorship.id,
        reviewStatus,
        reviewNote: this.reviewNoteFor(sponsorship.id).trim() || undefined
      });
      await this.loadSponsorships();
    } catch {
      this.state.set('error');
    } finally {
      this.actionState.set(null);
    }
  }

  async savePublication(sponsorship: AdminSponsorshipRecord): Promise<void> {
    const draft = this.publicationDraftFor(sponsorship.id);
    this.actionState.set(sponsorship.id);

    try {
      await this.admin.updateSponsorshipPublication(this.adminToken(), {
        contributionId: sponsorship.id,
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
    } catch {
      this.state.set('error');
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
        file
      );
      this.setLogoUploadMessage(
        sponsorship.id,
        `Logo enregistre (${Math.ceil(result.sizeBytes / 1024)} KiB).`
      );
      await this.loadSponsorships();
    } catch {
      this.setLogoUploadMessage(sponsorship.id, 'Upload du logo impossible.');
      this.state.set('error');
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
      await this.admin.deleteSponsorLogo(this.adminToken(), sponsorship.id);
      this.setLogoUploadMessage(sponsorship.id, 'Logo supprime.');
      await this.loadSponsorships();
    } catch {
      this.setLogoUploadMessage(
        sponsorship.id,
        'Suppression du logo impossible.'
      );
      this.state.set('error');
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
  }

  setReviewFilter(event: Event): void {
    const value = this.valueFromEvent(event);
    this.reviewFilter.set(
      value === 'pending_review' || value === 'approved' || value === 'rejected'
        ? value
        : 'all'
    );
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
  }

  setReviewNote(id: string, event: Event): void {
    const value = this.valueFromEvent(event);
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
    const value = this.valueFromEvent(event);
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
    channel: 'facebook' | 'linkedin',
    event: Event
  ): void {
    const checked = (event.target as HTMLInputElement | null)?.checked ?? false;
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

  publicationDraftFor(id: string): SponsorshipPublicationDraft {
    return this.publicationDrafts()[id] ?? this.emptyPublicationDraft();
  }

  trackById(_: number, sponsorship: AdminSponsorshipRecord): string {
    return sponsorship.id;
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

  statusClass(status: SponsorshipReviewStatus): string {
    return `status-badge status-${status.replace('_review', '')}`;
  }

  formatMoney(sponsorship: AdminSponsorshipRecord): string {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: sponsorship.currency || 'CAD'
    }).format(sponsorship.amount);
  }

  sponsorshipTierLabel(sponsorship: AdminSponsorshipRecord): string {
    const { tier } = resolveSponsorshipBenefits(
      sponsorship.amount,
      DEFAULT_SPONSORSHIP_PRICING_CONFIG
    );

    switch (tier) {
      case 'website_facebook_linkedin':
        return 'Palier OpenG7.org + Facebook + LinkedIn';
      case 'website_facebook':
        return 'Palier OpenG7.org + Facebook';
      case 'website_only':
        return 'Palier OpenG7.org';
      default:
        return 'Palier indetermine';
    }
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

  dateLabel(value: string | null): string {
    if (!value) {
      return 'Non disponible';
    }

    return new Intl.DateTimeFormat('fr-CA', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  }

  publicNameLabel(sponsorship: AdminSponsorshipRecord): string {
    if (!sponsorship.public_display_consent) {
      return 'Non consenti';
    }

    return sponsorship.public_name || 'Consenti, nom manquant';
  }

  private toPublicationDraft(
    sponsorship: AdminSponsorshipRecord
  ): SponsorshipPublicationDraft {
    return {
      publicSlug: sponsorship.sponsor_public_slug ?? '',
      publicSummary: sponsorship.sponsor_public_summary ?? '',
      feedTarget: sponsorship.sponsor_feed_target ?? '',
      facebook: sponsorship.sponsor_feed_channels.includes('facebook'),
      linkedin: sponsorship.sponsor_feed_channels.includes('linkedin'),
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

  private saveToken(): void {
    this.admin.saveAdminToken(this.adminToken());
  }

  private setLogoUploadMessage(id: string, message: string): void {
    this.logoUploadMessages.update((messages) => ({
      ...messages,
      [id]: message
    }));
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
