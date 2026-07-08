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
import { RouterLink } from '@angular/router';
import type {
  AdminSponsorshipRecord,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

import { FundingAdminService } from '../../services/funding-admin.service.js';

const tokenStorageKey = 'openg7-admin-token';

@Component({
  selector: 'openg7-admin-sponsors-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="admin-shell">
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

      <p class="state" *ngIf="state() === 'loading'">Chargement des commandites...</p>
      <p class="state state-error" *ngIf="state() === 'error'">
        Impossible de charger ou modifier les commandites. Verifiez le jeton,
        la base de donnees et les migrations.
      </p>

      <section class="sponsorship-admin-list" aria-label="Liste des commandites">
        <article
          class="sponsorship-admin-item"
          *ngFor="let sponsorship of sponsorships(); trackBy: trackById"
        >
          <header>
            <div>
              <span [class]="statusClass(sponsorship.sponsor_review_status)">
                {{ reviewStatusLabel(sponsorship.sponsor_review_status) }}
              </span>
              <h2>
                {{ sponsorship.sponsor_company_name || 'Entreprise sans nom' }}
              </h2>
            </div>
            <strong>{{ formatMoney(sponsorship) }}</strong>
          </header>

          <dl class="sponsorship-admin-fields">
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
                <a
                  *ngIf="sponsorship.sponsor_logo_url; else emptyLogo"
                  [href]="sponsorship.sponsor_logo_url"
                  target="_blank"
                  rel="noreferrer"
                >
                  {{ sponsorship.sponsor_logo_url }}
                </a>
                <ng-template #emptyLogo>Non fourni</ng-template>
              </dd>
            </div>
            <div>
              <dt>Nom public</dt>
              <dd>{{ publicNameLabel(sponsorship) }}</dd>
            </div>
            <div>
              <dt>Paiement</dt>
              <dd>{{ sponsorship.payment_status }} · {{ dateLabel(sponsorship.paid_at) }}</dd>
            </div>
            <div>
              <dt>Details recus</dt>
              <dd>{{ dateLabel(sponsorship.sponsor_details_submitted_at) }}</dd>
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
      </section>
    </main>
  `,
  styles: [
    `
      .admin-shell {
        background: #f5f7fb;
        color: #172033;
        font-family: 'Trebuchet MS', Arial, sans-serif;
        min-height: 100vh;
        padding: 1.25rem;
      }

      .admin-topbar,
      .admin-auth-panel,
      .admin-summary-grid,
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
      .review-note-label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.85rem;
        font-weight: 800;
      }

      .admin-auth-panel input,
      .review-note-label textarea {
        border: 1px solid #cdd6e3;
        border-radius: 0.35rem;
        font: inherit;
        padding: 0.65rem 0.75rem;
      }

      .admin-auth-panel button,
      .review-button {
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

      .review-note-label textarea {
        min-height: 5rem;
        resize: vertical;
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
        .admin-auth-panel,
        .admin-summary-grid,
        .sponsorship-admin-fields {
          grid-template-columns: 1fr;
        }

        .admin-topbar {
          align-items: start;
          flex-direction: column;
        }
      }
    `
  ]
})
export class AdminSponsorsPageComponent implements OnInit {
  private readonly admin = inject(FundingAdminService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly adminToken = signal<string>('');
  readonly sponsorships = signal<readonly AdminSponsorshipRecord[]>([]);
  readonly reviewNotes = signal<Record<string, string>>({});
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly actionState = signal<string | null>(null);

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
    if (isPlatformBrowser(this.platformId)) {
      this.adminToken.set(sessionStorage.getItem(tokenStorageKey) ?? '');
    }

    void this.loadSponsorships();
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
      this.state.set('ready');
      this.saveToken();
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

  setAdminToken(event: Event): void {
    this.adminToken.set(this.valueFromEvent(event));
    this.saveToken();
  }

  setReviewNote(id: string, event: Event): void {
    const value = this.valueFromEvent(event);
    this.reviewNotes.update((notes) => ({
      ...notes,
      [id]: value
    }));
  }

  reviewNoteFor(id: string): string {
    return this.reviewNotes()[id] ?? '';
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

  statusClass(status: SponsorshipReviewStatus): string {
    return `status-badge status-${status.replace('_review', '')}`;
  }

  formatMoney(sponsorship: AdminSponsorshipRecord): string {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: sponsorship.currency || 'CAD'
    }).format(sponsorship.amount);
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

  private saveToken(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const token = this.adminToken().trim();
    if (token) {
      sessionStorage.setItem(tokenStorageKey, token);
      return;
    }

    sessionStorage.removeItem(tokenStorageKey);
  }

  private valueFromEvent(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement | null)
      ?.value ?? '';
  }
}
