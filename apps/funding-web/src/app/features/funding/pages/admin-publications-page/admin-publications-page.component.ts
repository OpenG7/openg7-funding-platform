import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import type {
  AdminPublicationDraftRecord,
  AdminPublicationDraftsResponse,
  AdminSponsorshipRecord,
  PublicationDraftStatus,
  SponsorFeedChannel
} from '@openg7/funding-core';

import { AdminNavComponent } from '../../components/admin-nav/admin-nav.component.js';
import { FundingAdminService } from '../../services/funding-admin.service.js';

interface PublicationDraftEdit {
  readonly title: string;
  readonly body: string;
  readonly disclosureText: string;
  readonly publicUrl: string;
  readonly scheduledAt: string;
  readonly reviewNote: string;
}

const publicationStatuses: readonly PublicationDraftStatus[] = [
  'draft',
  'pending_review',
  'approved',
  'scheduled',
  'published',
  'rejected',
  'cancelled'
];

@Component({
  selector: 'openg7-admin-publications-page',
  standalone: true,
  imports: [CommonModule, AdminNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="admin-shell">
      <openg7-admin-nav />

      <section class="admin-content">
        <header class="admin-topbar">
          <div>
            <span>Administration</span>
            <h1>Publications commanditees</h1>
          </div>
          <button type="button" (click)="load()">Actualiser</button>
        </header>

        <section class="admin-auth-panel" aria-labelledby="admin-auth-title">
          <div>
            <h2 id="admin-auth-title">Acces admin</h2>
            <p>Brouillons et approbations restent prives.</p>
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
        </section>

        <p class="state" *ngIf="state() === 'loading'">Chargement des publications...</p>
        <p class="state state-error" *ngIf="state() === 'error'">
          Impossible de charger ou modifier les publications.
        </p>

        <section class="admin-summary-grid" aria-label="Resume publications">
          <article>
            <span>Brouillons</span>
            <strong>{{ draftCount() }}</strong>
          </article>
          <article>
            <span>A approuver</span>
            <strong>{{ pendingCount() }}</strong>
          </article>
          <article>
            <span>Approuvees</span>
            <strong>{{ approvedCount() }}</strong>
          </article>
          <article>
            <span>Publiees</span>
            <strong>{{ publishedCount() }}</strong>
          </article>
        </section>

        <section class="filters" aria-label="Filtres publications">
          <label>
            Recherche
            <input
              type="search"
              placeholder="Entreprise, titre, texte..."
              [value]="search()"
              (input)="setSearch($event)"
            />
          </label>
          <label>
            Statut
            <select [value]="statusFilter()" (change)="setStatusFilter($event)">
              <option value="all">Tous</option>
              <option *ngFor="let status of publicationStatuses" [value]="status">
                {{ statusLabel(status) }}
              </option>
            </select>
          </label>
        </section>

        <section class="admin-panel" aria-labelledby="eligible-title">
          <header>
            <div>
              <span>{{ eligibleSponsorships().length }} commandite(s)</span>
              <h2 id="eligible-title">Commandites pretes</h2>
            </div>
          </header>

          <div class="eligible-list" *ngIf="eligibleSponsorships().length > 0">
            <article
              *ngFor="let sponsorship of eligibleSponsorships(); trackBy: trackBySponsor"
            >
              <div>
                <strong>{{ sponsorship.sponsor_company_name }}</strong>
                <small>{{ feedTargetLabel(sponsorship) }}</small>
              </div>
              <nav>
                <button
                  type="button"
                  *ngFor="let channel of sponsorship.sponsor_feed_channels"
                  [disabled]="actionState() === sponsorship.id + channel"
                  (click)="createDraft(sponsorship, channel)"
                >
                  {{ channelLabel(channel) }}
                </button>
              </nav>
            </article>
          </div>

          <article class="empty-state" *ngIf="eligibleSponsorships().length === 0">
            <h3>Aucune commandite prete</h3>
            <p>Approuvez une commandite et ajoutez une cible/canal feed.</p>
          </article>
        </section>

        <section class="draft-list" aria-label="Brouillons de publication">
          <article
            class="draft-card"
            *ngFor="let draft of filteredDrafts(); trackBy: trackByDraft"
          >
            <header>
              <div>
                <span>{{ statusLabel(draft.status) }}</span>
                <h2>{{ draft.sponsor_company_name }}</h2>
              </div>
              <small>{{ draft.feed_target }} / {{ channelLabel(draft.channel) }}</small>
            </header>

            <label>
              Titre
              <input
                type="text"
                maxlength="160"
                [value]="editFor(draft.id).title"
                (input)="setEditField(draft.id, 'title', $event)"
              />
            </label>

            <label>
              Texte
              <textarea
                rows="8"
                maxlength="2500"
                [value]="editFor(draft.id).body"
                (input)="setEditField(draft.id, 'body', $event)"
              ></textarea>
            </label>

            <label>
              Divulgation
              <input
                type="text"
                maxlength="300"
                [value]="editFor(draft.id).disclosureText"
                (input)="setEditField(draft.id, 'disclosureText', $event)"
              />
            </label>

            <div class="draft-grid">
              <label>
                URL publique
                <input
                  type="url"
                  maxlength="2048"
                  [value]="editFor(draft.id).publicUrl"
                  (input)="setEditField(draft.id, 'publicUrl', $event)"
                />
              </label>
              <label>
                Planification
                <input
                  type="datetime-local"
                  [value]="editFor(draft.id).scheduledAt"
                  (input)="setEditField(draft.id, 'scheduledAt', $event)"
                />
              </label>
            </div>

            <label>
              Note revue
              <textarea
                rows="3"
                maxlength="1000"
                [value]="editFor(draft.id).reviewNote"
                (input)="setEditField(draft.id, 'reviewNote', $event)"
              ></textarea>
            </label>

            <footer>
              <button type="button" (click)="copyDraft(draft)">Copier</button>
              <button type="button" (click)="saveDraft(draft)">Enregistrer</button>
              <button type="button" (click)="saveDraft(draft, 'pending_review')">
                Revue
              </button>
              <button type="button" class="approve" (click)="saveDraft(draft, 'approved')">
                Approuver
              </button>
              <button type="button" class="neutral" (click)="saveDraft(draft, 'scheduled')">
                Planifier
              </button>
              <button type="button" class="approve" (click)="saveDraft(draft, 'published')">
                Publiee
              </button>
              <button type="button" class="reject" (click)="saveDraft(draft, 'rejected')">
                Refuser
              </button>
            </footer>
          </article>

          <article class="empty-state" *ngIf="state() === 'ready' && filteredDrafts().length === 0">
            <h3>Aucun brouillon trouve</h3>
            <p>Generez un brouillon ou modifiez les filtres.</p>
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
        display: grid;
        gap: 1rem;
        min-width: 0;
      }

      .admin-topbar,
      .admin-auth-panel,
      .admin-summary-grid,
      .filters,
      .admin-panel,
      .draft-list,
      .state {
        margin: 0 auto;
        max-width: 78rem;
        width: 100%;
      }

      .admin-topbar,
      .admin-panel header,
      .draft-card header,
      .eligible-list article,
      .draft-card footer {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .admin-topbar span,
      .admin-summary-grid span,
      .admin-panel span,
      .draft-card header span {
        color: #667085;
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .admin-topbar h1,
      .admin-auth-panel h2,
      .admin-panel h2,
      .draft-card h2,
      .empty-state h3 {
        margin: 0;
      }

      .admin-auth-panel,
      .filters,
      .admin-summary-grid article,
      .admin-panel,
      .draft-card,
      .empty-state {
        background: #fff;
        border: 1px solid #d9e0ea;
        border-radius: 0.45rem;
      }

      .admin-auth-panel,
      .filters,
      .admin-panel,
      .draft-card,
      .empty-state {
        padding: 1rem;
      }

      .admin-auth-panel {
        align-items: end;
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(0, 1fr) minmax(16rem, 24rem);
      }

      .admin-auth-panel p,
      .empty-state p,
      small {
        color: #526070;
        line-height: 1.55;
        margin: 0.35rem 0 0;
      }

      .admin-summary-grid,
      .filters,
      .draft-grid {
        display: grid;
        gap: 0.75rem;
      }

      .admin-summary-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .admin-summary-grid article {
        padding: 1rem;
      }

      .admin-summary-grid strong {
        display: block;
        font-size: 1.75rem;
        margin-top: 0.2rem;
      }

      .filters,
      .draft-grid {
        grid-template-columns: minmax(14rem, 2fr) minmax(10rem, 1fr);
      }

      label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.85rem;
        font-weight: 800;
      }

      input,
      select,
      textarea {
        border: 1px solid #cdd6e3;
        border-radius: 0.35rem;
        font: inherit;
        padding: 0.65rem 0.75rem;
      }

      textarea {
        resize: vertical;
      }

      button {
        background: #18233a;
        border: 0;
        border-radius: 0.35rem;
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
        min-height: 2.55rem;
        padding: 0 0.85rem;
      }

      button:disabled {
        cursor: wait;
        opacity: 0.62;
      }

      button.neutral {
        background: #254db8;
      }

      button.approve {
        background: #176236;
      }

      button.reject {
        background: #9f1d2f;
      }

      .admin-panel,
      .draft-list,
      .draft-card {
        display: grid;
        gap: 0.85rem;
      }

      .eligible-list {
        display: grid;
        gap: 0.75rem;
      }

      .eligible-list article {
        background: #f7f9fc;
        border: 1px solid #e4e9f2;
        border-radius: 0.45rem;
        padding: 0.85rem;
      }

      .eligible-list nav,
      .draft-card footer {
        display: flex;
        flex-wrap: wrap;
        gap: 0.55rem;
      }

      .state-error {
        color: #9f1d2f;
        font-weight: 800;
      }

      @media (max-width: 900px) {
        .admin-shell,
        .admin-auth-panel,
        .admin-summary-grid,
        .filters,
        .draft-grid {
          grid-template-columns: 1fr;
        }

        .admin-topbar,
        .admin-panel header,
        .draft-card header,
        .eligible-list article {
          align-items: start;
          flex-direction: column;
        }
      }
    `
  ]
})
export class AdminPublicationsPageComponent implements OnInit {
  private readonly admin = inject(FundingAdminService);

  readonly publicationStatuses = publicationStatuses;
  readonly adminToken = signal<string>('');
  readonly sponsorships = signal<readonly AdminSponsorshipRecord[]>([]);
  readonly draftsResponse = signal<AdminPublicationDraftsResponse | null>(null);
  readonly draftEdits = signal<Record<string, PublicationDraftEdit>>({});
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly actionState = signal<string | null>(null);
  readonly search = signal<string>('');
  readonly statusFilter = signal<'all' | PublicationDraftStatus>('all');

  readonly drafts = computed(() => this.draftsResponse()?.drafts ?? []);
  readonly eligibleSponsorships = computed(() =>
    this.sponsorships().filter(
      (sponsorship) =>
        sponsorship.sponsor_review_status === 'approved' &&
        sponsorship.public_display_consent &&
        Boolean(sponsorship.sponsor_feed_target) &&
        sponsorship.sponsor_feed_channels.length > 0
    )
  );
  readonly filteredDrafts = computed(() => {
    const search = this.search().trim().toLowerCase();
    const status = this.statusFilter();

    return this.drafts().filter((draft) => {
      const searchable = [
        draft.sponsor_company_name,
        draft.title,
        draft.body,
        draft.feed_target,
        draft.channel
      ]
        .join(' ')
        .toLowerCase();

      return (
        (!search || searchable.includes(search)) &&
        (status === 'all' || draft.status === status)
      );
    });
  });
  readonly draftCount = computed(
    () => this.drafts().filter((draft) => draft.status === 'draft').length
  );
  readonly pendingCount = computed(
    () =>
      this.drafts().filter((draft) => draft.status === 'pending_review').length
  );
  readonly approvedCount = computed(
    () => this.drafts().filter((draft) => draft.status === 'approved').length
  );
  readonly publishedCount = computed(
    () => this.drafts().filter((draft) => draft.status === 'published').length
  );

  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    void this.load();
  }

  async load(): Promise<void> {
    this.state.set('loading');

    try {
      const [sponsorships, drafts] = await Promise.all([
        this.admin.getSponsorships(this.adminToken()),
        this.admin.getPublicationDrafts(this.adminToken())
      ]);
      this.sponsorships.set(sponsorships.sponsorships);
      this.draftsResponse.set(drafts);
      this.draftEdits.set(
        Object.fromEntries(
          drafts.drafts.map((draft) => [draft.id, this.toEdit(draft)])
        )
      );
      this.state.set('ready');
      this.admin.saveAdminToken(this.adminToken());
    } catch {
      this.state.set('error');
    }
  }

  async createDraft(
    sponsorship: AdminSponsorshipRecord,
    channel: SponsorFeedChannel
  ): Promise<void> {
    if (!sponsorship.sponsor_feed_target) {
      return;
    }

    this.actionState.set(sponsorship.id + channel);
    try {
      await this.admin.createPublicationDraft(this.adminToken(), {
        contributionId: sponsorship.id,
        feedTarget: sponsorship.sponsor_feed_target,
        channel
      });
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.actionState.set(null);
    }
  }

  async saveDraft(
    draft: AdminPublicationDraftRecord,
    status?: PublicationDraftStatus
  ): Promise<void> {
    const edit = this.editFor(draft.id);
    this.actionState.set(draft.id);

    try {
      await this.admin.updatePublicationDraft(this.adminToken(), {
        draftId: draft.id,
        title: edit.title,
        body: edit.body,
        disclosureText: edit.disclosureText,
        status,
        publicUrl: edit.publicUrl,
        scheduledAt: edit.scheduledAt
          ? new Date(edit.scheduledAt).toISOString()
          : null,
        reviewNote: edit.reviewNote
      });
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.actionState.set(null);
    }
  }

  async copyDraft(draft: AdminPublicationDraftRecord): Promise<void> {
    const edit = this.editFor(draft.id);
    const text = [edit.title, edit.body, edit.disclosureText]
      .filter(Boolean)
      .join('\n\n');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
  }

  setAdminToken(event: Event): void {
    this.adminToken.set(this.valueFromEvent(event));
    this.admin.saveAdminToken(this.adminToken());
  }

  setSearch(event: Event): void {
    this.search.set(this.valueFromEvent(event));
  }

  setStatusFilter(event: Event): void {
    const value = this.valueFromEvent(event);
    this.statusFilter.set(
      publicationStatuses.includes(value as PublicationDraftStatus)
        ? (value as PublicationDraftStatus)
        : 'all'
    );
  }

  setEditField(
    draftId: string,
    field: keyof PublicationDraftEdit,
    event: Event
  ): void {
    const value = this.valueFromEvent(event);
    this.draftEdits.update((edits) => ({
      ...edits,
      [draftId]: {
        ...(edits[draftId] ?? this.emptyEdit()),
        [field]: value
      }
    }));
  }

  editFor(draftId: string): PublicationDraftEdit {
    return this.draftEdits()[draftId] ?? this.emptyEdit();
  }

  trackBySponsor(_: number, sponsorship: AdminSponsorshipRecord): string {
    return sponsorship.id;
  }

  trackByDraft(_: number, draft: AdminPublicationDraftRecord): string {
    return draft.id;
  }

  channelLabel(channel: SponsorFeedChannel): string {
    return channel === 'linkedin' ? 'LinkedIn' : 'Facebook';
  }

  feedTargetLabel(sponsorship: AdminSponsorshipRecord): string {
    return sponsorship.sponsor_feed_target === 'openg20' ? 'OpenG20' : 'OpenG7';
  }

  statusLabel(status: PublicationDraftStatus): string {
    const labels: Record<PublicationDraftStatus, string> = {
      draft: 'Brouillon',
      pending_review: 'A approuver',
      approved: 'Approuvee',
      scheduled: 'Planifiee',
      published: 'Publiee',
      rejected: 'Refusee',
      cancelled: 'Annulee'
    };

    return labels[status];
  }

  private toEdit(draft: AdminPublicationDraftRecord): PublicationDraftEdit {
    return {
      title: draft.title,
      body: draft.body,
      disclosureText: draft.disclosure_text,
      publicUrl: draft.public_url ?? '',
      scheduledAt: this.toDateTimeLocal(draft.scheduled_at),
      reviewNote: draft.review_note ?? ''
    };
  }

  private emptyEdit(): PublicationDraftEdit {
    return {
      title: '',
      body: '',
      disclosureText: '',
      publicUrl: '',
      scheduledAt: '',
      reviewNote: ''
    };
  }

  private toDateTimeLocal(value: string | null): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return '';
    }

    return date.toISOString().slice(0, 16);
  }

  private valueFromEvent(event: Event): string {
    return (
      (
        event.target as
          | HTMLInputElement
          | HTMLSelectElement
          | HTMLTextAreaElement
          | null
      )?.value ?? ''
    );
  }
}
