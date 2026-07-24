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
  AdminPublicationBatchRecord,
  AdminPublicationBatchesResponse,
  AdminPublicationDraftRecord,
  AdminPublicationDraftsResponse,
  AdminPublicationSlotRecord,
  AdminPublicationSlotsResponse,
  AdminSocialPublicationJobRecord,
  AdminSocialPublicationJobsResponse,
  AdminSponsorshipRecord,
  PublicationBatchStatus,
  PublicationDraftStatus,
  PublicationSlotStatus,
  SponsorFeedChannel,
  SponsorFeedTarget
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

interface PublicationSlotEdit {
  readonly startsAt: string;
  readonly timezone: string;
  readonly capacity: string;
  readonly notes: string;
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

        <p class="state" *ngIf="state() === 'loading'">
          Chargement des publications...
        </p>
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
              <option
                *ngFor="let status of publicationStatuses"
                [value]="status"
              >
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
              *ngFor="
                let sponsorship of eligibleSponsorships();
                trackBy: trackBySponsor
              "
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

          <article
            class="empty-state"
            *ngIf="eligibleSponsorships().length === 0"
          >
            <h3>Aucune commandite prete</h3>
            <p>Approuvez une commandite et ajoutez une cible/canal feed.</p>
          </article>
        </section>

        <section class="admin-panel" aria-labelledby="calendar-title">
          <header>
            <div>
              <span>{{ slots().length }} creneau(x)</span>
              <h2 id="calendar-title">Calendrier de publication</h2>
            </div>
          </header>
          <p>
            Les creneaux fixent la cible, le canal, l'horaire local et la
            capacite avant l'assignation des lots ou des brouillons. La page
            publique ne recoit que les dates, canaux, cibles et fuseaux.
          </p>

          <form
            class="slot-create-form"
            (submit)="$event.preventDefault(); createSlot()"
          >
            <label>
              Cible
              <select
                [value]="newSlotFeedTarget()"
                (change)="setNewSlotFeedTarget($event)"
              >
                <option value="openg7">OpenG7</option>
                <option value="openg20">OpenG20</option>
              </select>
            </label>
            <label>
              Canal
              <select
                [value]="newSlotChannel()"
                (change)="setNewSlotChannel($event)"
              >
                <option value="facebook">Facebook</option>
                <option value="linkedin">LinkedIn</option>
              </select>
            </label>
            <label>
              Date et heure
              <input
                type="datetime-local"
                [value]="newSlotStartsAt()"
                (input)="setNewSlotStartsAt($event)"
              />
            </label>
            <label>
              Fuseau
              <input
                type="text"
                maxlength="64"
                [value]="newSlotTimezone()"
                (input)="setNewSlotTimezone($event)"
              />
            </label>
            <label>
              Capacite
              <input
                type="number"
                min="1"
                max="50"
                [value]="newSlotCapacity()"
                (input)="setNewSlotCapacity($event)"
              />
            </label>
            <label class="slot-notes-field">
              Notes
              <input
                type="text"
                maxlength="500"
                [value]="newSlotNotes()"
                (input)="setNewSlotNotes($event)"
              />
            </label>
            <button type="submit" [disabled]="slotActionState() === 'create'">
              Creer un creneau
            </button>
          </form>

          <div class="slot-list" *ngIf="slots().length > 0">
            <article
              class="slot-card"
              *ngFor="let slot of slots(); trackBy: trackBySlot"
            >
              <header>
                <div>
                  <span>{{ slotStatusLabel(slot.status) }}</span>
                  <h3>
                    {{ feedTargetName(slot.feedTarget) }} /
                    {{ channelLabel(slot.channel) }}
                  </h3>
                </div>
                <small>
                  {{ dateLabel(slot.startsAt) }} - {{ slot.timezone }}
                </small>
              </header>

              <div class="slot-capacity">
                <strong>{{ slot.capacityUsed }}/{{ slot.capacity }}</strong>
                <span
                  >{{ slot.capacityAvailable }} place(s) restante(s)</span
                >
              </div>

              <div
                class="slot-edit-grid"
                *ngIf="slot.status === 'open' || slot.status === 'scheduled'"
              >
                <label>
                  Date et heure
                  <input
                    type="datetime-local"
                    [value]="slotEditFor(slot.id).startsAt"
                    (input)="setSlotEditField(slot.id, 'startsAt', $event)"
                  />
                </label>
                <label>
                  Fuseau
                  <input
                    type="text"
                    maxlength="64"
                    [value]="slotEditFor(slot.id).timezone"
                    (input)="setSlotEditField(slot.id, 'timezone', $event)"
                  />
                </label>
                <label>
                  Capacite
                  <input
                    type="number"
                    min="1"
                    max="50"
                    [value]="slotEditFor(slot.id).capacity"
                    (input)="setSlotEditField(slot.id, 'capacity', $event)"
                  />
                </label>
                <label>
                  Notes
                  <input
                    type="text"
                    maxlength="500"
                    [value]="slotEditFor(slot.id).notes"
                    (input)="setSlotEditField(slot.id, 'notes', $event)"
                  />
                </label>
                <button
                  type="button"
                  class="neutral"
                  [disabled]="slotActionState() === slot.id"
                  (click)="updateSlot(slot)"
                >
                  Mettre a jour
                </button>
              </div>

              <div
                class="draft-batch-row"
                *ngIf="slot.status === 'open' || slot.status === 'scheduled'"
              >
                <label class="inline">
                  Lot
                  <select
                    [value]="slotBatchSelection(slot.id)"
                    (change)="setSlotBatchSelection(slot.id, $event)"
                  >
                    <option value="">Choisir un lot compatible...</option>
                    <option
                      *ngFor="let batch of assignableBatchesForSlot(slot)"
                      [value]="batch.id"
                    >
                      {{ channelLabel(batch.channel) }} ({{
                        batch.capacityUsed
                      }}/{{ batch.capacity }})
                    </option>
                  </select>
                </label>
                <button
                  type="button"
                  class="neutral"
                  [disabled]="
                    !slotBatchSelection(slot.id) ||
                    slotActionState() === slot.id
                  "
                  (click)="assignBatchToSlot(slot)"
                >
                  Assigner le lot
                </button>
                <label class="inline">
                  Brouillon
                  <select
                    [value]="slotDraftSelection(slot.id)"
                    (change)="setSlotDraftSelection(slot.id, $event)"
                  >
                    <option value="">Choisir un brouillon...</option>
                    <option
                      *ngFor="let draft of assignableDraftsForSlot(slot)"
                      [value]="draft.id"
                    >
                      {{ draft.sponsor_company_name }}
                    </option>
                  </select>
                </label>
                <button
                  type="button"
                  class="neutral"
                  [disabled]="
                    !slotDraftSelection(slot.id) ||
                    slotActionState() === slot.id
                  "
                  (click)="assignDraftToSlot(slot)"
                >
                  Assigner brouillon
                </button>
              </div>

              <footer>
                <button
                  type="button"
                  class="approve"
                  *ngIf="slot.status === 'scheduled'"
                  [disabled]="
                    slot.capacityUsed === 0 || slotActionState() === slot.id
                  "
                  (click)="publishSlot(slot)"
                >
                  Publier le creneau
                </button>
                <button
                  type="button"
                  class="reject"
                  *ngIf="slot.status === 'open' || slot.status === 'scheduled'"
                  [disabled]="slotActionState() === slot.id"
                  (click)="cancelSlot(slot)"
                >
                  Annuler le creneau
                </button>
              </footer>
            </article>
          </div>

          <article class="empty-state" *ngIf="slots().length === 0">
            <h3>Aucun creneau</h3>
            <p>
              Creez plusieurs creneaux futurs par canal pour organiser les
              publications Facebook et LinkedIn.
            </p>
          </article>
        </section>

        <section class="admin-panel" aria-labelledby="batches-title">
          <header>
            <div>
              <span>{{ batches().length }} lot(s)</span>
              <h2 id="batches-title">Lots de publication collective</h2>
            </div>
          </header>
          <p>
            Chaque lot regroupe plusieurs commandites approuvees dans une seule
            publication collective Facebook ou LinkedIn, jusqu'a sa capacite.
            Planifier puis publier restent deux actions manuelles distinctes:
            aucune publication n'est jamais automatique.
          </p>
          <p class="social-runtime">
            API sociale: {{ socialPublicationModeLabel() }} -
            {{ socialPublicationConfiguredChannelsLabel() }}
          </p>

          <form
            class="batch-create-form"
            (submit)="$event.preventDefault(); createBatch()"
          >
            <label>
              Canal
              <select
                [value]="newBatchChannel()"
                (change)="setNewBatchChannel($event)"
              >
                <option value="facebook">Facebook</option>
                <option value="linkedin">LinkedIn</option>
              </select>
            </label>
            <label>
              Capacite
              <input
                type="number"
                min="1"
                max="50"
                [value]="newBatchCapacity()"
                (input)="setNewBatchCapacity($event)"
              />
            </label>
            <button type="submit" [disabled]="batchActionState() === 'create'">
              Creer un lot
            </button>
          </form>

          <div class="batch-timeline" *ngIf="batches().length > 0">
            <section
              class="batch-timeline-channel"
              *ngFor="let channel of batchChannels"
            >
              <h3
                class="batch-timeline-heading"
                *ngIf="batchesForChannel(channel).length > 0"
              >
                {{ channelLabel(channel) }}
              </h3>
              <div class="batch-list">
                <article
                  class="batch-card"
                  *ngFor="
                    let batch of batchesForChannel(channel);
                    trackBy: trackByBatch
                  "
                >
                  <header>
                    <div>
                      <span>{{ batchStatusLabel(batch.status) }}</span>
                      <h3>
                        {{ channelLabel(batch.channel) }} -
                        {{ batch.capacityUsed }}/{{ batch.capacity }}
                      </h3>
                    </div>
                    <small *ngIf="batch.scheduledAt"
                      >Prochaine disponibilite:
                      {{ dateLabel(batch.scheduledAt) }}</small
                    >
                  </header>

                  <div
                    class="social-job"
                    *ngIf="socialJobForBatch(batch.id) as job"
                  >
                    <div>
                      <span>{{ socialJobStatusLabel(job.status) }}</span>
                      <small>{{ job.provider }} / {{ job.mode }}</small>
                    </div>
                    <a
                      *ngIf="job.externalPostUrl"
                      [href]="job.externalPostUrl"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Voir la publication
                    </a>
                    <small class="state-error" *ngIf="job.errorMessage">
                      {{ job.errorMessage }}
                    </small>
                  </div>

                  <div
                    class="draft-grid"
                    *ngIf="
                      batch.status === 'open' || batch.status === 'scheduled'
                    "
                  >
                    <label>
                      Prochaine disponibilite
                      <input
                        type="datetime-local"
                        [value]="batchScheduleFor(batch.id)"
                        (input)="setBatchSchedule(batch.id, $event)"
                      />
                    </label>
                    <button
                      type="button"
                      class="neutral"
                      [disabled]="
                        !batchScheduleFor(batch.id) ||
                        batchActionState() === batch.id
                      "
                      (click)="scheduleBatch(batch)"
                    >
                      Planifier
                    </button>
                  </div>

                  <footer>
                    <button
                      type="button"
                      class="neutral"
                      *ngIf="batch.status === 'scheduled'"
                      [disabled]="
                        !canPublishSocialBatch(batch) ||
                        batchActionState() === 'social:' + batch.id
                      "
                      (click)="publishSocialBatch(batch)"
                    >
                      Publier via API sociale
                    </button>
                    <button
                      type="button"
                      class="approve"
                      *ngIf="batch.status === 'scheduled'"
                      [disabled]="batchActionState() === batch.id"
                      (click)="publishBatch(batch)"
                    >
                      Publier maintenant
                    </button>
                    <button
                      type="button"
                      class="reject"
                      *ngIf="
                        batch.status === 'open' || batch.status === 'scheduled'
                      "
                      [disabled]="batchActionState() === batch.id"
                      (click)="cancelBatch(batch)"
                    >
                      Annuler le lot
                    </button>
                  </footer>
                </article>
              </div>
            </section>
          </div>

          <article class="empty-state" *ngIf="batches().length === 0">
            <h3>Aucun lot</h3>
            <p>
              Creez un lot pour regrouper plusieurs commandites approuvees dans
              une seule publication collective.
            </p>
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
              <small
                >{{ draft.feed_target }} /
                {{ channelLabel(draft.channel) }}</small
              >
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

            <div
              class="draft-batch-row"
              *ngIf="draft.status === 'approved' || draft.batch_id"
            >
              <ng-container *ngIf="!draft.batch_id">
                <label class="inline">
                  Lot
                  <select
                    [value]="draftBatchSelection(draft.id)"
                    (change)="setDraftBatchSelection(draft.id, $event)"
                  >
                    <option value="">Choisir un lot ouvert...</option>
                    <option
                      *ngFor="let batch of openBatchesForChannel(draft.channel)"
                      [value]="batch.id"
                    >
                      {{ channelLabel(batch.channel) }} ({{
                        batch.capacityUsed
                      }}/{{ batch.capacity }})
                    </option>
                  </select>
                </label>
                <button
                  type="button"
                  class="neutral"
                  [disabled]="
                    !draftBatchSelection(draft.id) || actionState() === draft.id
                  "
                  (click)="assignToBatch(draft)"
                >
                  Assigner au lot
                </button>
              </ng-container>
              <ng-container *ngIf="draft.batch_id as batchId">
                <span
                  >Dans un lot ({{
                    batchStatusLabel(batchStatusById(batchId))
                  }})</span
                >
                <button
                  type="button"
                  class="reject"
                  [disabled]="actionState() === draft.id"
                  (click)="unassignFromBatch(draft)"
                >
                  Retirer du lot
                </button>
              </ng-container>
            </div>

            <footer>
              <button type="button" (click)="copyDraft(draft)">Copier</button>
              <button type="button" (click)="saveDraft(draft)">
                Enregistrer
              </button>
              <button
                type="button"
                (click)="saveDraft(draft, 'pending_review')"
              >
                Revue
              </button>
              <button
                type="button"
                class="approve"
                (click)="saveDraft(draft, 'approved')"
              >
                Approuver
              </button>
              <button
                type="button"
                class="neutral"
                (click)="saveDraft(draft, 'scheduled')"
              >
                Planifier
              </button>
              <button
                type="button"
                class="approve"
                (click)="saveDraft(draft, 'published')"
              >
                Publiee
              </button>
              <button
                type="button"
                class="reject"
                (click)="saveDraft(draft, 'rejected')"
              >
                Refuser
              </button>
            </footer>
          </article>

          <article
            class="empty-state"
            *ngIf="state() === 'ready' && filteredDrafts().length === 0"
          >
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
      .batch-card footer,
      .slot-card footer,
      .draft-card footer {
        display: flex;
        flex-wrap: wrap;
        gap: 0.55rem;
      }

      .batch-create-form {
        align-items: end;
        display: grid;
        gap: 0.75rem;
        grid-template-columns: minmax(8rem, 12rem) minmax(6rem, 8rem) auto;
      }

      .slot-create-form {
        align-items: end;
        display: grid;
        gap: 0.75rem;
        grid-template-columns:
          minmax(7rem, 0.8fr) minmax(7rem, 0.8fr) minmax(12rem, 1.2fr)
          minmax(10rem, 1fr) minmax(6rem, 0.6fr) minmax(12rem, 1.5fr)
          auto;
      }

      .slot-notes-field {
        min-width: 0;
      }

      .batch-timeline {
        display: grid;
        gap: 1rem;
      }

      .batch-timeline-heading {
        color: #667085;
        font-size: 0.78rem;
        font-weight: 900;
        letter-spacing: 0;
        margin: 0 0 0.5rem;
        text-transform: uppercase;
      }

      .batch-list {
        display: grid;
        gap: 0.75rem;
      }

      .slot-list {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
      }

      .batch-card {
        background: #f7f9fc;
        border: 1px solid #e4e9f2;
        border-radius: 0.45rem;
        display: grid;
        gap: 0.75rem;
        padding: 0.85rem;
      }

      .slot-card {
        background: #f7f9fc;
        border: 1px solid #d9e7dd;
        border-radius: 0.45rem;
        display: grid;
        gap: 0.75rem;
        padding: 0.85rem;
      }

      .slot-capacity {
        align-items: center;
        background: #edf8f1;
        border: 1px solid #c9e6d1;
        border-radius: 0.45rem;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
        padding: 0.75rem;
      }

      .slot-capacity strong {
        font-size: 1.35rem;
      }

      .slot-capacity span {
        color: #176236;
        font-size: 0.85rem;
        font-weight: 900;
      }

      .slot-edit-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
      }

      .social-runtime,
      .social-job {
        background: #eef4ff;
        border: 1px solid #c8dcff;
        border-radius: 0.45rem;
        color: #25406f;
        font-size: 0.9rem;
        font-weight: 800;
        margin: 0;
        padding: 0.75rem;
      }

      .social-job {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .social-job a {
        color: #254db8;
        font-weight: 900;
      }

      .batch-card header,
      .slot-card header {
        align-items: center;
        display: flex;
        gap: 0.75rem;
        justify-content: space-between;
      }

      .batch-card h3,
      .slot-card h3 {
        margin: 0;
      }

      .draft-batch-row {
        align-items: end;
        background: #f7f9fc;
        border: 1px solid #e4e9f2;
        border-radius: 0.45rem;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        padding: 0.75rem;
      }

      .draft-batch-row span {
        color: #526070;
        font-size: 0.82rem;
        font-weight: 700;
      }

      label.inline {
        margin: 0;
        min-width: 14rem;
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
        .draft-grid,
        .slot-create-form,
        .slot-edit-grid {
          grid-template-columns: 1fr;
        }

        .admin-topbar,
        .admin-panel header,
        .draft-card header,
        .eligible-list article,
        .slot-card header {
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

  readonly batchesResponse = signal<AdminPublicationBatchesResponse | null>(
    null
  );
  readonly slotsResponse = signal<AdminPublicationSlotsResponse | null>(null);
  readonly slotEdits = signal<Record<string, PublicationSlotEdit>>({});
  readonly socialJobsResponse =
    signal<AdminSocialPublicationJobsResponse | null>(null);
  readonly batchActionState = signal<string | null>(null);
  readonly slotActionState = signal<string | null>(null);
  readonly newSlotFeedTarget = signal<SponsorFeedTarget>('openg7');
  readonly newSlotChannel = signal<SponsorFeedChannel>('facebook');
  readonly newSlotStartsAt = signal<string>('');
  readonly newSlotTimezone = signal<string>('America/Toronto');
  readonly newSlotCapacity = signal<string>('5');
  readonly newSlotNotes = signal<string>('');
  readonly newBatchChannel = signal<SponsorFeedChannel>('facebook');
  readonly newBatchCapacity = signal<string>('5');
  readonly batchScheduleEdits = signal<Record<string, string>>({});
  readonly draftBatchSelections = signal<Record<string, string>>({});
  readonly slotBatchSelections = signal<Record<string, string>>({});
  readonly slotDraftSelections = signal<Record<string, string>>({});

  readonly drafts = computed(() => this.draftsResponse()?.drafts ?? []);
  readonly batches = computed(() => this.batchesResponse()?.batches ?? []);
  readonly slots = computed(() => this.slotsResponse()?.slots ?? []);
  readonly socialJobs = computed(() => this.socialJobsResponse()?.jobs ?? []);
  readonly socialJobByBatchId = computed(() => {
    const jobs = new Map<string, AdminSocialPublicationJobRecord>();
    for (const job of this.socialJobs()) {
      if (!jobs.has(job.batchId)) {
        jobs.set(job.batchId, job);
      }
    }
    return jobs;
  });
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
      const [sponsorships, drafts, batches, slots, socialJobs] =
        await Promise.all([
        this.admin.getSponsorships(this.adminToken()),
        this.admin.getPublicationDrafts(this.adminToken()),
        this.admin.getPublicationBatches(this.adminToken()),
        this.admin.getPublicationSlots(this.adminToken()),
        this.admin.getSocialPublicationJobs(this.adminToken())
      ]);
      this.sponsorships.set(sponsorships.sponsorships);
      this.draftsResponse.set(drafts);
      this.draftEdits.set(
        Object.fromEntries(
          drafts.drafts.map((draft) => [draft.id, this.toEdit(draft)])
        )
      );
      this.batchesResponse.set(batches);
      this.slotsResponse.set(slots);
      this.slotEdits.set(
        Object.fromEntries(
          slots.slots.map((slot) => [slot.id, this.toSlotEdit(slot)])
        )
      );
      this.socialJobsResponse.set(socialJobs);
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

  async createSlot(): Promise<void> {
    const capacity = Number.parseInt(this.newSlotCapacity(), 10);
    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 50 ||
      !this.newSlotStartsAt()
    ) {
      this.state.set('error');
      return;
    }

    this.slotActionState.set('create');
    try {
      await this.admin.createPublicationSlot(this.adminToken(), {
        feedTarget: this.newSlotFeedTarget(),
        channel: this.newSlotChannel(),
        startsAt: new Date(this.newSlotStartsAt()).toISOString(),
        timezone: this.newSlotTimezone().trim() || 'America/Toronto',
        capacity,
        notes: this.newSlotNotes()
      });
      this.newSlotNotes.set('');
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.slotActionState.set(null);
    }
  }

  async updateSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    const edit = this.slotEditFor(slot.id);
    const capacity = Number.parseInt(edit.capacity, 10);
    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 50 ||
      !edit.startsAt
    ) {
      this.state.set('error');
      return;
    }

    this.slotActionState.set(slot.id);
    try {
      await this.admin.updatePublicationSlot(this.adminToken(), {
        slotId: slot.id,
        startsAt: new Date(edit.startsAt).toISOString(),
        timezone: edit.timezone.trim() || 'America/Toronto',
        capacity,
        notes: edit.notes
      });
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.slotActionState.set(null);
    }
  }

  async assignBatchToSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    const batchId = this.slotBatchSelection(slot.id);
    if (!batchId) {
      return;
    }

    this.slotActionState.set(slot.id);
    try {
      await this.admin.assignBatchToPublicationSlot(this.adminToken(), {
        slotId: slot.id,
        batchId
      });
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.slotActionState.set(null);
    }
  }

  async assignDraftToSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    const draftId = this.slotDraftSelection(slot.id);
    if (!draftId) {
      return;
    }

    this.slotActionState.set(slot.id);
    try {
      await this.admin.assignDraftToPublicationSlot(this.adminToken(), {
        slotId: slot.id,
        draftId
      });
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.slotActionState.set(null);
    }
  }

  async publishSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    this.slotActionState.set(slot.id);
    try {
      await this.admin.publishPublicationSlot(this.adminToken(), {
        slotId: slot.id
      });
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.slotActionState.set(null);
    }
  }

  async cancelSlot(slot: AdminPublicationSlotRecord): Promise<void> {
    this.slotActionState.set(slot.id);
    try {
      await this.admin.cancelPublicationSlot(this.adminToken(), {
        slotId: slot.id
      });
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.slotActionState.set(null);
    }
  }

  async createBatch(): Promise<void> {
    const capacity = Number.parseInt(this.newBatchCapacity(), 10);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) {
      this.state.set('error');
      return;
    }

    this.batchActionState.set('create');
    try {
      await this.admin.createPublicationBatch(this.adminToken(), {
        channel: this.newBatchChannel(),
        capacity
      });
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.batchActionState.set(null);
    }
  }

  async assignToBatch(draft: AdminPublicationDraftRecord): Promise<void> {
    const batchId = this.draftBatchSelection(draft.id);
    if (!batchId) {
      return;
    }

    this.actionState.set(draft.id);
    try {
      await this.admin.assignDraftToBatch(this.adminToken(), {
        draftId: draft.id,
        batchId
      });
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.actionState.set(null);
    }
  }

  async unassignFromBatch(draft: AdminPublicationDraftRecord): Promise<void> {
    this.actionState.set(draft.id);
    try {
      await this.admin.unassignDraftFromBatch(this.adminToken(), {
        draftId: draft.id
      });
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.actionState.set(null);
    }
  }

  async scheduleBatch(batch: AdminPublicationBatchRecord): Promise<void> {
    const scheduledAt = this.batchScheduleFor(batch.id);
    if (!scheduledAt) {
      return;
    }

    this.batchActionState.set(batch.id);
    try {
      await this.admin.schedulePublicationBatch(this.adminToken(), {
        batchId: batch.id,
        scheduledAt: new Date(scheduledAt).toISOString()
      });
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.batchActionState.set(null);
    }
  }

  async publishBatch(batch: AdminPublicationBatchRecord): Promise<void> {
    this.batchActionState.set(batch.id);
    try {
      await this.admin.publishPublicationBatch(this.adminToken(), {
        batchId: batch.id
      });
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.batchActionState.set(null);
    }
  }

  async publishSocialBatch(batch: AdminPublicationBatchRecord): Promise<void> {
    if (!this.canPublishSocialBatch(batch)) {
      return;
    }

    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `Publier le lot ${batch.id} sur ${this.channelLabel(batch.channel)} ?`
      )
    ) {
      return;
    }

    this.batchActionState.set(`social:${batch.id}`);
    try {
      await this.admin.publishSocialPublicationBatch(this.adminToken(), {
        batchId: batch.id,
        confirmationText: batch.id
      });
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.batchActionState.set(null);
    }
  }

  async cancelBatch(batch: AdminPublicationBatchRecord): Promise<void> {
    this.batchActionState.set(batch.id);
    try {
      await this.admin.cancelPublicationBatch(this.adminToken(), {
        batchId: batch.id
      });
      await this.load();
    } catch {
      this.state.set('error');
    } finally {
      this.batchActionState.set(null);
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

  setNewSlotFeedTarget(event: Event): void {
    const value = this.valueFromEvent(event);
    this.newSlotFeedTarget.set(value === 'openg20' ? 'openg20' : 'openg7');
  }

  setNewSlotChannel(event: Event): void {
    const value = this.valueFromEvent(event);
    this.newSlotChannel.set(value === 'linkedin' ? 'linkedin' : 'facebook');
  }

  setNewSlotStartsAt(event: Event): void {
    this.newSlotStartsAt.set(this.valueFromEvent(event));
  }

  setNewSlotTimezone(event: Event): void {
    this.newSlotTimezone.set(this.valueFromEvent(event));
  }

  setNewSlotCapacity(event: Event): void {
    this.newSlotCapacity.set(this.valueFromEvent(event));
  }

  setNewSlotNotes(event: Event): void {
    this.newSlotNotes.set(this.valueFromEvent(event));
  }

  setNewBatchChannel(event: Event): void {
    const value = this.valueFromEvent(event);
    this.newBatchChannel.set(value === 'linkedin' ? 'linkedin' : 'facebook');
  }

  setNewBatchCapacity(event: Event): void {
    this.newBatchCapacity.set(this.valueFromEvent(event));
  }

  batchScheduleFor(batchId: string): string {
    return this.batchScheduleEdits()[batchId] ?? '';
  }

  setBatchSchedule(batchId: string, event: Event): void {
    const value = this.valueFromEvent(event);
    this.batchScheduleEdits.update((edits) => ({
      ...edits,
      [batchId]: value
    }));
  }

  draftBatchSelection(draftId: string): string {
    return this.draftBatchSelections()[draftId] ?? '';
  }

  setDraftBatchSelection(draftId: string, event: Event): void {
    const value = this.valueFromEvent(event);
    this.draftBatchSelections.update((selections) => ({
      ...selections,
      [draftId]: value
    }));
  }

  slotEditFor(slotId: string): PublicationSlotEdit {
    return this.slotEdits()[slotId] ?? this.emptySlotEdit();
  }

  setSlotEditField(
    slotId: string,
    field: keyof PublicationSlotEdit,
    event: Event
  ): void {
    const value = this.valueFromEvent(event);
    this.slotEdits.update((edits) => ({
      ...edits,
      [slotId]: {
        ...(edits[slotId] ?? this.emptySlotEdit()),
        [field]: value
      }
    }));
  }

  slotBatchSelection(slotId: string): string {
    return this.slotBatchSelections()[slotId] ?? '';
  }

  setSlotBatchSelection(slotId: string, event: Event): void {
    const value = this.valueFromEvent(event);
    this.slotBatchSelections.update((selections) => ({
      ...selections,
      [slotId]: value
    }));
  }

  slotDraftSelection(slotId: string): string {
    return this.slotDraftSelections()[slotId] ?? '';
  }

  setSlotDraftSelection(slotId: string, event: Event): void {
    const value = this.valueFromEvent(event);
    this.slotDraftSelections.update((selections) => ({
      ...selections,
      [slotId]: value
    }));
  }

  readonly batchChannels: readonly SponsorFeedChannel[] = [
    'facebook',
    'linkedin'
  ];

  batchesForChannel(
    channel: SponsorFeedChannel
  ): readonly AdminPublicationBatchRecord[] {
    return this.batches().filter((batch) => batch.channel === channel);
  }

  openBatchesForChannel(
    channel: SponsorFeedChannel
  ): readonly AdminPublicationBatchRecord[] {
    return this.batches().filter(
      (batch) => batch.channel === channel && batch.status === 'open'
    );
  }

  assignableBatchesForSlot(
    slot: AdminPublicationSlotRecord
  ): readonly AdminPublicationBatchRecord[] {
    return this.batches().filter(
      (batch) =>
        batch.channel === slot.channel &&
        (batch.status === 'open' || batch.status === 'scheduled') &&
        (batch.slotId === null || batch.slotId === slot.id) &&
        (batch.slotId === slot.id ||
          batch.capacityUsed <= slot.capacityAvailable) &&
        this.batchDraftsMatchSlot(batch, slot)
    );
  }

  assignableDraftsForSlot(
    slot: AdminPublicationSlotRecord
  ): readonly AdminPublicationDraftRecord[] {
    return this.drafts().filter(
      (draft) =>
        draft.channel === slot.channel &&
        draft.feed_target === slot.feedTarget &&
        draft.batch_id === null &&
        (draft.status === 'approved' ||
          (draft.status === 'scheduled' && draft.slot_id === slot.id)) &&
        (draft.slot_id === null || draft.slot_id === slot.id) &&
        (draft.slot_id === slot.id || slot.capacityAvailable > 0)
    );
  }

  batchStatusById(batchId: string): PublicationBatchStatus | null {
    return this.batches().find((batch) => batch.id === batchId)?.status ?? null;
  }

  socialPublicationModeLabel(): string {
    const mode = this.socialJobsResponse()?.mode ?? 'disabled';
    const labels = {
      disabled: 'Desactive',
      mock: 'Simulation',
      live: 'Connecte'
    } as const;

    return labels[mode];
  }

  socialPublicationConfiguredChannelsLabel(): string {
    const channels = this.socialJobsResponse()?.configuredChannels ?? [];
    return channels.length > 0
      ? channels.map((channel) => this.channelLabel(channel)).join(', ')
      : 'Aucun canal';
  }

  socialJobForBatch(batchId: string): AdminSocialPublicationJobRecord | null {
    return this.socialJobByBatchId().get(batchId) ?? null;
  }

  canPublishSocialBatch(batch: AdminPublicationBatchRecord): boolean {
    const response = this.socialJobsResponse();
    const job = this.socialJobForBatch(batch.id);
    return Boolean(
      response &&
      response.mode !== 'disabled' &&
      response.configuredChannels.includes(batch.channel) &&
      batch.status === 'scheduled' &&
      batch.capacityUsed > 0 &&
      job?.status !== 'publishing' &&
      job?.status !== 'published'
    );
  }

  socialJobStatusLabel(
    status: AdminSocialPublicationJobRecord['status']
  ): string {
    const labels: Record<AdminSocialPublicationJobRecord['status'], string> = {
      pending: 'En attente',
      publishing: 'Envoi en cours',
      published: 'Publie via API',
      failed: 'Echec API'
    };

    return labels[status];
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

  trackByBatch(_: number, batch: AdminPublicationBatchRecord): string {
    return batch.id;
  }

  trackBySlot(_: number, slot: AdminPublicationSlotRecord): string {
    return slot.id;
  }

  channelLabel(channel: SponsorFeedChannel): string {
    return channel === 'linkedin' ? 'LinkedIn' : 'Facebook';
  }

  feedTargetName(feedTarget: SponsorFeedTarget): string {
    return feedTarget === 'openg20' ? 'OpenG20' : 'OpenG7';
  }

  batchStatusLabel(status: PublicationBatchStatus | null): string {
    if (!status) {
      return 'Inconnu';
    }

    const labels: Record<PublicationBatchStatus, string> = {
      open: 'Ouvert',
      scheduled: 'Planifie',
      published: 'Publie',
      cancelled: 'Annule'
    };

    return labels[status];
  }

  slotStatusLabel(status: PublicationSlotStatus): string {
    const labels: Record<PublicationSlotStatus, string> = {
      open: 'Ouvert',
      scheduled: 'Planifie',
      published: 'Publie',
      cancelled: 'Annule'
    };

    return labels[status];
  }

  dateLabel(value: string | null): string {
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

  private toSlotEdit(slot: AdminPublicationSlotRecord): PublicationSlotEdit {
    return {
      startsAt: this.toDateTimeLocal(slot.startsAt),
      timezone: slot.timezone,
      capacity: String(slot.capacity),
      notes: slot.notes ?? ''
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

  private emptySlotEdit(): PublicationSlotEdit {
    return {
      startsAt: '',
      timezone: 'America/Toronto',
      capacity: '5',
      notes: ''
    };
  }

  private batchDraftsMatchSlot(
    batch: AdminPublicationBatchRecord,
    slot: AdminPublicationSlotRecord
  ): boolean {
    const assignedDrafts = this.drafts().filter(
      (draft) => draft.batch_id === batch.id
    );

    return assignedDrafts.every(
      (draft) => draft.feed_target === slot.feedTarget
    );
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
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
      )?.value ?? ''
    );
  }
}
