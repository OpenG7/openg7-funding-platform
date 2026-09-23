import { TranslatePipe } from '@ngx-translate/core';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink
} from '@angular/router';
import { distinctUntilChanged, filter, map, startWith } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
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

import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminDrawerComponent } from '../../components/admin-ui/admin-drawer.component.js';
import { AdminPublicationCalendarComponent } from '../../components/admin-publications/admin-publication-calendar.component.js';
import type { PublicationCalendarEntry } from '../../components/admin-publications/publication-calendar.js';
import { AdminPublicationQueueComponent } from '../../components/admin-publications/admin-publication-queue.component.js';
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

type PublicationView = 'overview' | 'drafts' | 'batches' | 'calendar';

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
  imports: [
    CommonModule,
    AdminLayoutComponent,
    AdminPublicationQueueComponent,
    AdminPublicationCalendarComponent,
    AdminDrawerComponent,
    RouterLink,
    TranslatePipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <openg7-admin-layout>
      <section
        class="admin-content"
        data-og7="publications-page"
        [attr.data-og7-view]="activeView()"
      >
        @if (activeView() !== 'overview') {
          <nav
            class="publication-breadcrumb"
            [attr.aria-label]="'admin.publications.navigation' | translate"
          >
            <a
              [routerLink]="publicationPath"
              [queryParams]="navigationParams()"
              data-og7="publications-home"
            >
              <span aria-hidden="true">←</span>
              {{ 'admin.publications.back' | translate }}
            </a>
          </nav>
        }
        <header class="admin-topbar">
          <div>
            <span>{{
              (activeView() === 'overview'
                ? 'admin.legacy.administration'
                : 'admin.publications.title'
              ) | translate
            }}</span>
            <h1 id="publication-heading" tabindex="-1">
              {{
                'admin.publications.spaces.' + activeView() + '.title'
                  | translate
              }}
            </h1>
            <p class="page-help">
              {{
                'admin.publications.spaces.' + activeView() + '.help'
                  | translate
              }}
            </p>
          </div>
          <div class="header-actions" data-og7="publication-header-actions">
            @if (activeView() === 'drafts') {
              <button
                type="button"
                class="admin-button admin-button--primary"
                id="publication-prepare"
                [attr.aria-expanded]="showEligible()"
                aria-controls="publication-eligible"
                (click)="prepareDraft()"
              >
                {{ 'admin.publications.prepare' | translate }}
              </button>
            }
            @if (activeView() === 'batches') {
              <button
                type="button"
                class="admin-button admin-button--primary"
                [attr.aria-expanded]="newBatchOpen()"
                aria-controls="new-batch-form"
                (click)="newBatchOpen.set(!newBatchOpen())"
              >
                {{ 'admin.publications.newBatch' | translate }}
              </button>
            }
            @if (activeView() === 'calendar') {
              <button
                type="button"
                class="admin-button admin-button--primary"
                [attr.aria-expanded]="newSlotOpen()"
                aria-controls="new-slot-form"
                (click)="newSlotOpen.set(!newSlotOpen())"
              >
                {{ 'admin.publications.newSlot' | translate }}
              </button>
            }
            <a
              [routerLink]="publicationPath + '/automation'"
              class="admin-button"
              >{{ 'admin.publicationAutomation.title' | translate }}</a
            >
            <button
              type="button"
              class="admin-button"
              (click)="load()"
              [disabled]="state() === 'loading'"
            >
              {{ 'admin.legacy.actualiser' | translate }}
            </button>
          </div>
        </header>
        @if (targetId) {
          <p class="state" data-og7="attention-object-target">
            {{ 'admin.attention.targetObject' | translate: { id: targetId } }}
          </p>
        }
        @if (state() === 'ready' && !targetFound()) {
          <p role="status">{{ 'admin.attention.objectMissing' | translate }}</p>
        }

        <p class="state" role="status" *ngIf="state() === 'loading'">
          {{ 'admin.legacy.chargement_des_publications' | translate }}
        </p>
        <p class="state state-error" role="alert" *ngIf="state() === 'error'">
          {{
            'admin.legacy.impossible_de_charger_ou_modifier_les_publications'
              | translate
          }}
        </p>

        <p class="action-notice" role="status">{{ notice() | translate }}</p>
        <section
          class="publication-view"
          id="publication-panel-overview"
          aria-labelledby="publication-heading"
          [hidden]="activeView() !== 'overview'"
        >
          @if (activeView() === 'overview') {
            <nav
              class="publication-spaces"
              [attr.aria-label]="'admin.publications.navigation' | translate"
            >
              @for (
                space of publicationSpaces;
                track space;
                let index = $index
              ) {
                <a
                  [routerLink]="[publicationPath, space]"
                  [queryParams]="navigationParams()"
                  data-og7="publication-space"
                  [attr.data-og7-id]="space"
                >
                  <span class="space-number" aria-hidden="true"
                    >0{{ index + 1 }}</span
                  >
                  <div>
                    <h2>
                      {{
                        'admin.publications.spaces.' + space + '.title'
                          | translate
                      }}
                    </h2>
                    <p>
                      {{
                        'admin.publications.spaces.' + space + '.help'
                          | translate
                      }}
                    </p>
                  </div>
                  <span class="space-open"
                    >{{
                      'admin.publications.spaces.' + space + '.open' | translate
                    }}
                    <span aria-hidden="true">→</span></span
                  >
                </a>
              }
            </nav>
            <openg7-admin-publication-queue
              [batches]="batches()"
              [drafts]="drafts()"
              [slots]="slots()"
              [state]="state()"
              (openBatch)="focusBatch($event)"
              (retry)="load()"
            />
          }
        </section>
        <section
          class="publication-view"
          id="publication-panel-drafts"
          aria-labelledby="publication-heading"
          [hidden]="activeView() !== 'drafts'"
        >
          @if (activeView() === 'drafts') {
            <section
              class="filters"
              [attr.aria-label]="
                'admin.legacy.filtres_publications' | translate
              "
            >
              <label>
                {{ 'admin.legacy.recherche' | translate
                }}<input
                  type="search"
                  [attr.placeholder]="
                    'admin.legacy.entreprise_titre_texte' | translate
                  "
                  [value]="search()"
                  (input)="setSearch($event)"
                />
              </label>
              <label>
                {{ 'admin.legacy.statut' | translate
                }}<select
                  [value]="statusFilter()"
                  (change)="setStatusFilter($event)"
                >
                  <option value="active">
                    {{ 'admin.publications.activeDrafts' | translate }}
                  </option>
                  <option value="all">
                    {{ 'admin.legacy.tous' | translate }}
                  </option>
                  <option
                    *ngFor="let status of publicationStatuses"
                    [value]="status"
                  >
                    {{ statusLabel(status) }}
                  </option>
                </select>
              </label>
            </section>

            <section
              *ngIf="showEligible()"
              class="admin-panel"
              id="publication-eligible"
              aria-labelledby="eligible-title"
            >
              <header>
                <div>
                  <span>{{
                    'admin.legacy.p0_commandite_s'
                      | translate: { p0: eligibleSponsorships().length }
                  }}</span>
                  <h2 id="eligible-title">
                    {{ 'admin.legacy.commandites_pretes' | translate }}
                  </h2>
                </div>
                <button type="button" (click)="closePreparation()">
                  {{ 'admin.publications.close' | translate }}
                </button>
              </header>

              <div
                class="eligible-list"
                *ngIf="eligibleSponsorships().length > 0"
              >
                <article
                  data-og7="publication-eligible-sponsor"
                  [attr.data-og7-id]="sponsorship.id"
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
                <h3>
                  {{ 'admin.legacy.aucune_commandite_prete' | translate }}
                </h3>
                <p>
                  {{
                    'admin.legacy.approuvez_une_commandite_et_ajoutez_une_cible_canal_feed'
                      | translate
                  }}
                </p>
              </article>
            </section>

            <section
              class="draft-list"
              [attr.aria-label]="
                'admin.legacy.brouillons_de_publication' | translate
              "
            >
              <article
                class="draft-card"
                data-og7="publication-draft"
                [attr.data-og7-id]="draft.id"
                *ngFor="let draft of filteredDrafts(); trackBy: trackByDraft"
                [attr.id]="'attention-object-' + draft.id"
                tabindex="-1"
              >
                <header>
                  <div>
                    <span>{{ statusLabel(draft.status) }}</span>
                    <h2>{{ draft.sponsor_company_name }}</h2>
                    @if (dirtyDraftIds().has(draft.id)) {
                      <small class="dirty-note">{{
                        'admin.publications.unsaved' | translate
                      }}</small>
                    }
                  </div>
                  <small
                    >{{ draft.feed_target }} /
                    {{ channelLabel(draft.channel) }}</small
                  >
                  <button
                    type="button"
                    class="neutral"
                    [attr.aria-expanded]="selectedDraftId() === draft.id"
                    [attr.aria-controls]="'draft-editor-' + draft.id"
                    (click)="
                      selectedDraftId.set(
                        selectedDraftId() === draft.id ? null : draft.id
                      )
                    "
                  >
                    {{
                      (selectedDraftId() === draft.id
                        ? 'admin.publications.close'
                        : 'admin.publications.open'
                      ) | translate
                    }}
                  </button>
                </header>
                @if (selectedDraftId() === draft.id) {
                  <fieldset
                    class="item-editor"
                    [disabled]="!!actionState()"
                    [attr.id]="'draft-editor-' + draft.id"
                  >
                    <label>
                      {{ 'admin.legacy.titre' | translate
                      }}<input
                        type="text"
                        maxlength="160"
                        [value]="editFor(draft.id).title"
                        (input)="setEditField(draft.id, 'title', $event)"
                      />
                    </label>

                    <label>
                      {{ 'admin.legacy.texte' | translate
                      }}<textarea
                        rows="8"
                        maxlength="2500"
                        [value]="editFor(draft.id).body"
                        (input)="setEditField(draft.id, 'body', $event)"
                      ></textarea>
                    </label>

                    <label>
                      {{ 'admin.legacy.divulgation' | translate
                      }}<input
                        type="text"
                        maxlength="300"
                        [value]="editFor(draft.id).disclosureText"
                        (input)="
                          setEditField(draft.id, 'disclosureText', $event)
                        "
                      />
                    </label>

                    <details class="secondary-options">
                      <summary>
                        {{ 'admin.publications.draftOptions' | translate }}
                      </summary>
                      <div class="draft-grid">
                        <label>
                          {{ 'admin.legacy.url_publique' | translate
                          }}<input
                            type="url"
                            maxlength="2048"
                            [value]="editFor(draft.id).publicUrl"
                            (input)="
                              setEditField(draft.id, 'publicUrl', $event)
                            "
                          />
                        </label>
                        <label>
                          {{ 'admin.legacy.planification' | translate
                          }}<input
                            type="datetime-local"
                            [value]="editFor(draft.id).scheduledAt"
                            (input)="
                              setEditField(draft.id, 'scheduledAt', $event)
                            "
                          />
                        </label>
                      </div>

                      <label>
                        {{ 'admin.legacy.note_revue' | translate
                        }}<textarea
                          rows="3"
                          maxlength="1000"
                          [value]="editFor(draft.id).reviewNote"
                          (input)="setEditField(draft.id, 'reviewNote', $event)"
                        ></textarea>
                      </label>
                    </details>
                    <div
                      class="draft-batch-row"
                      *ngIf="draft.status === 'approved' || draft.batch_id"
                    >
                      <ng-container *ngIf="!draft.batch_id">
                        <label class="inline">
                          {{ 'admin.legacy.lot' | translate
                          }}<select
                            [value]="draftBatchSelection(draft.id)"
                            (change)="setDraftBatchSelection(draft.id, $event)"
                          >
                            <option value="">
                              {{
                                'admin.legacy.choisir_un_lot_ouvert' | translate
                              }}
                            </option>
                            <option
                              *ngFor="
                                let batch of openBatchesForChannel(
                                  draft.channel
                                )
                              "
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
                            !draftBatchSelection(draft.id) ||
                            actionState() === draft.id
                          "
                          (click)="assignToBatch(draft)"
                        >
                          {{ 'admin.legacy.assigner_au_lot' | translate }}
                        </button>
                      </ng-container>
                      <ng-container *ngIf="draft.batch_id as batchId">
                        <span>{{
                          'admin.legacy.dans_un_lot_p0'
                            | translate
                              : {
                                  p0: batchStatusLabel(batchStatusById(batchId))
                                }
                        }}</span>
                        <button
                          type="button"
                          class="reject"
                          [disabled]="actionState() === draft.id"
                          (click)="unassignFromBatch(draft)"
                        >
                          {{ 'admin.legacy.retirer_du_lot' | translate }}
                        </button>
                      </ng-container>
                    </div>

                    <footer>
                      <button
                        type="button"
                        class="primary-action"
                        (click)="saveDraft(draft)"
                      >
                        {{ 'admin.legacy.enregistrer' | translate }}
                      </button>
                      @if (draft.status === 'pending_review') {
                        <button
                          type="button"
                          class="approve"
                          (click)="saveDraft(draft, 'approved')"
                        >
                          {{ 'admin.legacy.approuver' | translate }}
                        </button>
                      } @else if (
                        draft.status === 'draft' || draft.status === 'rejected'
                      ) {
                        <button
                          type="button"
                          (click)="saveDraft(draft, 'pending_review')"
                        >
                          {{ 'admin.publications.submitReview' | translate }}
                        </button>
                      }
                      <button
                        type="button"
                        class="neutral"
                        (click)="copyDraft(draft)"
                      >
                        {{ 'admin.legacy.copier' | translate }}
                      </button>
                    </footer>
                    <details class="secondary-options">
                      <summary>
                        {{ 'admin.publications.otherActions' | translate }}
                      </summary>
                      <div class="secondary-actions">
                        <button
                          *ngIf="
                            draft.status !== 'draft' &&
                            draft.status !== 'rejected' &&
                            draft.status !== 'pending_review'
                          "
                          type="button"
                          (click)="saveDraft(draft, 'pending_review')"
                        >
                          {{ 'admin.legacy.revue' | translate }}
                        </button>
                        <button
                          *ngIf="
                            draft.status !== 'pending_review' &&
                            draft.status !== 'approved'
                          "
                          type="button"
                          class="approve"
                          (click)="saveDraft(draft, 'approved')"
                        >
                          {{ 'admin.legacy.approuver' | translate }}
                        </button>
                        <button
                          *ngIf="draft.status !== 'scheduled'"
                          type="button"
                          class="neutral"
                          (click)="saveDraft(draft, 'scheduled')"
                        >
                          {{ 'admin.legacy.planifier' | translate }}
                        </button>
                        <button
                          *ngIf="draft.status !== 'published'"
                          type="button"
                          class="neutral"
                          (click)="saveDraft(draft, 'published')"
                        >
                          {{ 'admin.publications.markPublished' | translate }}
                        </button>
                        <button
                          *ngIf="draft.status !== 'rejected'"
                          type="button"
                          class="reject"
                          (click)="saveDraft(draft, 'rejected')"
                        >
                          {{ 'admin.legacy.refuser' | translate }}
                        </button>
                      </div>
                    </details>
                  </fieldset>
                }
              </article>

              <article
                class="empty-state"
                *ngIf="state() === 'ready' && filteredDrafts().length === 0"
              >
                <h3>{{ 'admin.legacy.aucun_brouillon_trouve' | translate }}</h3>
                <p>
                  {{
                    'admin.legacy.generez_un_brouillon_ou_modifiez_les_filtres'
                      | translate
                  }}
                </p>
              </article>
            </section>
          }
        </section>
        <section
          class="publication-view"
          id="publication-panel-batches"
          aria-labelledby="publication-heading"
          [hidden]="activeView() !== 'batches'"
        >
          @if (activeView() === 'batches') {
            <section class="admin-panel" aria-labelledby="batches-title">
              <h2 class="visually-hidden" id="batches-title">
                {{ 'admin.legacy.lots_de_publication_collective' | translate }}
              </h2>
              <form
                class="batch-create-form"
                id="new-batch-form"
                *ngIf="newBatchOpen()"
                (submit)="$event.preventDefault(); createBatch()"
              >
                <label>
                  {{ 'admin.legacy.canal' | translate
                  }}<select
                    [value]="newBatchChannel()"
                    (change)="setNewBatchChannel($event)"
                  >
                    <option value="facebook">Facebook</option>
                    <option value="linkedin">LinkedIn</option>
                  </select>
                </label>
                <label>
                  {{ 'admin.legacy.capacite' | translate
                  }}<input
                    type="number"
                    min="1"
                    max="50"
                    [value]="newBatchCapacity()"
                    (input)="setNewBatchCapacity($event)"
                  />
                </label>
                <button
                  type="submit"
                  [disabled]="batchActionState() === 'create'"
                >
                  {{ 'admin.legacy.creer_un_lot' | translate }}
                </button>
              </form>
              <label class="history-toggle"
                ><input
                  type="checkbox"
                  [checked]="showBatchHistory()"
                  (change)="showBatchHistory.set(!showBatchHistory())"
                />{{ 'admin.publications.showHistory' | translate }}</label
              >

              <openg7-admin-publication-calendar
                [entries]="batchCalendarEntries()"
                [selectedId]="selectedBatchId()"
                [state]="state()"
                (openEntry)="selectedBatchId.set($event)"
                (retry)="load()"
              />
              <openg7-admin-drawer
                [opened]="!!selectedBatch()"
                [title]="'admin.publicationCalendar.batchDetail' | translate"
                [closeLabel]="'admin.publications.close' | translate"
                [busy]="!!batchActionState()"
                (closed)="selectedBatchId.set(null)"
              >
                @if (selectedBatch(); as batch) {
                  @if (state() === 'error') {
                    <p class="state-error" role="alert">
                      {{
                        'admin.legacy.impossible_de_charger_ou_modifier_les_publications'
                          | translate
                      }}
                    </p>
                  }
                  <p>
                    {{
                      'admin.legacy.chaque_lot_regroupe_plusieurs_commandites_approuvees_dans_une_seu'
                        | translate
                    }}
                  </p>
                  <p class="social-runtime">
                    {{
                      'admin.legacy.api_sociale_p0_p1'
                        | translate
                          : {
                              p0: socialPublicationModeLabel(),
                              p1: socialPublicationConfiguredChannelsLabel()
                            }
                    }}
                  </p>
                  <article
                    class="batch-card"
                    data-og7="publication-batch"
                    [attr.data-og7-id]="batch.id"
                    [attr.id]="'attention-object-' + batch.id"
                    tabindex="-1"
                  >
                    <header>
                      <div>
                        <span>{{ batchStatusLabel(batch.status) }}</span>
                        <h3>
                          {{ channelLabel(batch.channel) }} -
                          {{ batch.capacityUsed }}/{{ batch.capacity }}
                        </h3>
                      </div>
                      <small *ngIf="batch.scheduledAt">{{
                        'admin.legacy.prochaine_disponibilite_p0'
                          | translate: { p0: dateLabel(batch.scheduledAt) }
                      }}</small>
                    </header>
                    @if (selectedBatchId() === batch.id) {
                      <div
                        class="item-editor"
                        [attr.id]="'batch-editor-' + batch.id"
                      >
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
                            {{
                              'admin.legacy.voir_la_publication' | translate
                            }}</a
                          >
                          <small class="state-error" *ngIf="job.errorMessage">
                            {{ job.errorMessage }}
                          </small>
                        </div>

                        <div
                          class="draft-grid"
                          *ngIf="
                            batch.status === 'open' ||
                            batch.status === 'scheduled'
                          "
                        >
                          <label>
                            {{
                              'admin.legacy.prochaine_disponibilite'
                                | translate
                            }}<input
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
                            {{ 'admin.legacy.planifier' | translate }}
                          </button>
                        </div>

                        <footer>
                          <button
                            type="button"
                            class="neutral"
                            *ngIf="
                              batch.status === 'scheduled' ||
                              batch.status === 'open'
                            "
                            [disabled]="
                              !canPublishSocialBatch(batch) ||
                              batchActionState() === 'social:' + batch.id
                            "
                            (click)="publishSocialBatch(batch)"
                          >
                            {{
                              'admin.publicationAutomation.prepareSend'
                                | translate
                            }}
                          </button>
                        </footer>
                        <details class="secondary-options">
                          <summary>
                            {{ 'admin.publications.otherActions' | translate }}
                          </summary>
                          <div class="secondary-actions">
                            <button
                              type="button"
                              class="approve"
                              *ngIf="batch.status === 'scheduled'"
                              [disabled]="batchActionState() === batch.id"
                              (click)="publishBatch(batch)"
                            >
                              {{
                                'admin.publications.markPublished' | translate
                              }}
                            </button>
                            <button
                              type="button"
                              class="reject"
                              *ngIf="
                                batch.status === 'open' ||
                                batch.status === 'scheduled'
                              "
                              [disabled]="batchActionState() === batch.id"
                              (click)="cancelBatch(batch)"
                            >
                              {{ 'admin.legacy.annuler_le_lot' | translate }}
                            </button>
                          </div>
                        </details>
                      </div>
                    }
                  </article>
                }
              </openg7-admin-drawer>

              <article
                class="empty-state"
                *ngIf="visibleBatches().length === 0"
              >
                <h3>{{ 'admin.legacy.aucun_lot' | translate }}</h3>
                <p>
                  {{
                    'admin.legacy.creez_un_lot_pour_regrouper_plusieurs_commandites_approuvees_dans'
                      | translate
                  }}
                </p>
              </article>
            </section>
          }
        </section>
        <section
          class="publication-view"
          id="publication-panel-calendar"
          aria-labelledby="publication-heading"
          [hidden]="activeView() !== 'calendar'"
        >
          @if (activeView() === 'calendar') {
            <section class="admin-panel" aria-labelledby="calendar-title">
              <h2 class="visually-hidden" id="calendar-title">
                {{ 'admin.legacy.calendrier_de_publication' | translate }}
              </h2>
              <form
                class="slot-create-form"
                id="new-slot-form"
                *ngIf="newSlotOpen()"
                (submit)="$event.preventDefault(); createSlot()"
              >
                <label>
                  {{ 'admin.legacy.cible' | translate
                  }}<select
                    [value]="newSlotFeedTarget()"
                    (change)="setNewSlotFeedTarget($event)"
                  >
                    <option value="openg7">OpenG7</option>
                    <option value="openg20">OpenG20</option>
                  </select>
                </label>
                <label>
                  {{ 'admin.legacy.canal' | translate
                  }}<select
                    [value]="newSlotChannel()"
                    (change)="setNewSlotChannel($event)"
                  >
                    <option value="facebook">Facebook</option>
                    <option value="linkedin">LinkedIn</option>
                  </select>
                </label>
                <label>
                  {{ 'admin.legacy.date_et_heure' | translate
                  }}<input
                    type="datetime-local"
                    [value]="newSlotStartsAt()"
                    (input)="setNewSlotStartsAt($event)"
                  />
                </label>
                <label>
                  {{ 'admin.legacy.fuseau' | translate
                  }}<input
                    type="text"
                    maxlength="64"
                    [value]="newSlotTimezone()"
                    (input)="setNewSlotTimezone($event)"
                  />
                </label>
                <label>
                  {{ 'admin.legacy.capacite' | translate
                  }}<input
                    type="number"
                    min="1"
                    max="50"
                    [value]="newSlotCapacity()"
                    (input)="setNewSlotCapacity($event)"
                  />
                </label>
                <label class="slot-notes-field">
                  {{ 'admin.legacy.notes' | translate
                  }}<input
                    type="text"
                    maxlength="500"
                    [value]="newSlotNotes()"
                    (input)="setNewSlotNotes($event)"
                  />
                </label>
                <button
                  type="submit"
                  [disabled]="slotActionState() === 'create'"
                >
                  {{ 'admin.legacy.creer_un_creneau' | translate }}
                </button>
              </form>
              <label class="history-toggle"
                ><input
                  type="checkbox"
                  [checked]="showSlotHistory()"
                  (change)="showSlotHistory.set(!showSlotHistory())"
                />{{ 'admin.publications.showHistory' | translate }}</label
              >

              <openg7-admin-publication-calendar
                [entries]="slotCalendarEntries()"
                [selectedId]="selectedSlotId()"
                [state]="state()"
                (openEntry)="selectedSlotId.set($event)"
                (retry)="load()"
              />
              <openg7-admin-drawer
                [opened]="!!selectedSlot()"
                [title]="'admin.publicationCalendar.slotDetail' | translate"
                [closeLabel]="'admin.publications.close' | translate"
                [busy]="!!slotActionState()"
                (closed)="selectedSlotId.set(null)"
              >
                @if (selectedSlot(); as slot) {
                  @if (state() === 'error') {
                    <p class="state-error" role="alert">
                      {{
                        'admin.legacy.impossible_de_charger_ou_modifier_les_publications'
                          | translate
                      }}
                    </p>
                  }
                  <p>
                    {{
                      'admin.legacy.les_creneaux_fixent_la_cible_le_canal_l_horaire_local_et_la_capac'
                        | translate
                    }}
                  </p>
                  <article
                    class="slot-card"
                    data-og7="publication-slot"
                    [attr.data-og7-id]="slot.id"
                    [attr.id]="'attention-object-' + slot.id"
                    tabindex="-1"
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
                        {{ dateLabel(slot.startsAt, slot.timezone) }} -
                        {{ slot.timezone }}
                      </small>
                    </header>
                    @if (selectedSlotId() === slot.id) {
                      <div
                        class="item-editor"
                        [attr.id]="'slot-editor-' + slot.id"
                      >
                        <div class="slot-capacity">
                          <strong
                            >{{ slot.capacityUsed }}/{{ slot.capacity }}</strong
                          >
                          <span>{{
                            'admin.legacy.p0_place_s_restante_s'
                              | translate: { p0: slot.capacityAvailable }
                          }}</span>
                        </div>

                        <div
                          class="slot-edit-grid"
                          *ngIf="
                            slot.status === 'open' ||
                            slot.status === 'scheduled'
                          "
                        >
                          <label>
                            {{ 'admin.legacy.date_et_heure' | translate
                            }}<input
                              type="datetime-local"
                              [value]="slotEditFor(slot.id).startsAt"
                              (input)="
                                setSlotEditField(slot.id, 'startsAt', $event)
                              "
                            />
                          </label>
                          <label>
                            {{ 'admin.legacy.fuseau' | translate
                            }}<input
                              type="text"
                              maxlength="64"
                              [value]="slotEditFor(slot.id).timezone"
                              (input)="
                                setSlotEditField(slot.id, 'timezone', $event)
                              "
                            />
                          </label>
                          <label>
                            {{ 'admin.legacy.capacite' | translate
                            }}<input
                              type="number"
                              min="1"
                              max="50"
                              [value]="slotEditFor(slot.id).capacity"
                              (input)="
                                setSlotEditField(slot.id, 'capacity', $event)
                              "
                            />
                          </label>
                          <label>
                            {{ 'admin.legacy.notes' | translate
                            }}<input
                              type="text"
                              maxlength="500"
                              [value]="slotEditFor(slot.id).notes"
                              (input)="
                                setSlotEditField(slot.id, 'notes', $event)
                              "
                            />
                          </label>
                          <button
                            type="button"
                            class="neutral"
                            [disabled]="slotActionState() === slot.id"
                            (click)="updateSlot(slot)"
                          >
                            {{ 'admin.legacy.mettre_a_jour' | translate }}
                          </button>
                        </div>

                        <div
                          class="draft-batch-row"
                          *ngIf="
                            slot.status === 'open' ||
                            slot.status === 'scheduled'
                          "
                        >
                          <label class="inline">
                            {{ 'admin.legacy.lot' | translate
                            }}<select
                              [value]="slotBatchSelection(slot.id)"
                              (change)="setSlotBatchSelection(slot.id, $event)"
                            >
                              <option value="">
                                {{
                                  'admin.legacy.choisir_un_lot_compatible'
                                    | translate
                                }}
                              </option>
                              <option
                                *ngFor="
                                  let batch of assignableBatchesForSlot(slot)
                                "
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
                            {{ 'admin.legacy.assigner_le_lot' | translate }}
                          </button>
                          <label class="inline">
                            {{ 'admin.legacy.brouillon' | translate
                            }}<select
                              [value]="slotDraftSelection(slot.id)"
                              (change)="setSlotDraftSelection(slot.id, $event)"
                            >
                              <option value="">
                                {{
                                  'admin.legacy.choisir_un_brouillon'
                                    | translate
                                }}
                              </option>
                              <option
                                *ngFor="
                                  let draft of assignableDraftsForSlot(slot)
                                "
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
                            {{ 'admin.legacy.assigner_brouillon' | translate }}
                          </button>
                        </div>

                        <footer>
                          <button
                            type="button"
                            class="approve"
                            *ngIf="slot.status === 'scheduled'"
                            [disabled]="
                              slot.capacityUsed === 0 ||
                              slotActionState() === slot.id
                            "
                            (click)="publishSlot(slot)"
                          >
                            {{ 'admin.publications.markPublished' | translate }}
                          </button>
                          <button
                            type="button"
                            class="reject"
                            *ngIf="
                              slot.status === 'open' ||
                              slot.status === 'scheduled'
                            "
                            [disabled]="slotActionState() === slot.id"
                            (click)="cancelSlot(slot)"
                          >
                            {{ 'admin.legacy.annuler_le_creneau' | translate }}
                          </button>
                        </footer>
                      </div>
                    }
                  </article>
                }
              </openg7-admin-drawer>

              <article class="empty-state" *ngIf="visibleSlots().length === 0">
                <h3>{{ 'admin.legacy.aucun_creneau' | translate }}</h3>
                <p>
                  {{
                    'admin.legacy.creez_plusieurs_creneaux_futurs_par_canal_pour_organiser_les_publ'
                      | translate
                  }}
                </p>
              </article>
            </section>
          }
        </section>
      </section>
    </openg7-admin-layout>
  `,
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css'
  ],
  styles: [
    `
      .admin-content {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 1rem;
        min-width: 0;
      }

      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }

      .publication-view[hidden] {
        display: none;
      }

      .publication-view,
      .item-editor {
        display: grid;
        gap: 1rem;
        min-width: 0;
      }

      .publication-breadcrumb,
      .publication-spaces,
      .action-notice {
        width: 100%;
        max-width: 78rem;
        margin: 0 auto;
      }

      .header-actions,
      .secondary-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .header-actions {
        align-items: center;
      }

      .admin-topbar {
        flex-wrap: wrap;
      }

      .publication-breadcrumb a {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        min-height: 2.75rem;
        color: var(--admin-gold);
        text-decoration: none;
      }

      .publication-breadcrumb a:hover {
        text-decoration: underline;
      }

      .page-help {
        color: var(--admin-muted);
        font-size: 0.9rem;
        margin: 0.5rem 0 0;
      }

      .publication-spaces {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.75rem;
      }

      .publication-spaces a {
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 1rem;
        padding: 1.25rem;
        border: 1px solid var(--admin-border);
        border-radius: 0.75rem;
        background: var(--admin-panel);
        color: var(--admin-text);
        text-decoration: none;
      }

      .publication-spaces a:hover {
        border-color: var(--admin-gold);
      }

      .publication-spaces a:focus-visible,
      .publication-breadcrumb a:focus-visible {
        outline: 3px solid var(--admin-focus);
        outline-offset: 4px;
      }

      .publication-spaces h2 {
        margin: 0;
        font-size: 1.15rem;
      }

      .publication-spaces p {
        margin: 0.5rem 0 0;
        color: var(--admin-muted);
        line-height: 1.5;
      }

      .space-number {
        color: var(--admin-gold);
        font-size: 0.8rem;
        letter-spacing: 0.08em;
      }

      .space-open {
        display: flex;
        justify-content: space-between;
        gap: 0.5rem;
        color: var(--admin-gold);
        font-weight: 600;
      }

      .item-editor {
        border: 0;
        border-top: 1px solid var(--admin-border);
        margin: 0;
        padding: 1rem 0 0;
      }

      .secondary-options {
        border: 1px solid var(--admin-border);
        border-radius: 0.4rem;
        padding: 0.75rem;
      }

      .secondary-options summary {
        cursor: pointer;
        font-weight: 600;
        min-height: 2rem;
      }

      .secondary-options[open] > :not(summary) {
        margin-top: 0.75rem;
      }

      .secondary-options summary:focus-visible {
        outline: 3px solid var(--admin-focus);
        outline-offset: 3px;
      }

      .history-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 500;
      }

      .action-notice {
        color: var(--admin-success);
      }

      .action-notice:empty {
        display: none;
      }

      .dirty-note {
        color: var(--admin-warning);
      }

      @media (max-width: 700px) {
        .publication-spaces {
          grid-template-columns: minmax(0, 1fr);
        }
        .publication-spaces a {
          grid-template-columns: auto minmax(0, 1fr);
          grid-template-rows: auto auto;
          gap: 0.65rem 1rem;
          padding: 1rem;
        }
        .space-open {
          grid-column: 2;
        }
      }

      .batch-card:focus {
        outline: 3px solid var(--admin-focus);
        outline-offset: 4px;
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
        color: var(--admin-muted);
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
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
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
        color: var(--admin-muted);
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
        border: 1px solid var(--admin-border);
        border-radius: 0.35rem;
        font: inherit;
        padding: 0.65rem 0.75rem;
      }

      textarea {
        resize: vertical;
      }

      button {
        background: var(--admin-panel-raised);
        border: 0;
        border-radius: 0.35rem;
        color: var(--admin-text);
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
        background: var(--admin-panel-raised);
      }

      button.approve {
        background: #193d32;
      }

      button.reject {
        background: #422532;
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
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
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

      .batch-card {
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
        border-radius: 0.45rem;
        display: grid;
        gap: 0.75rem;
        padding: 0.85rem;
      }

      .slot-card {
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
        border-radius: 0.45rem;
        display: grid;
        gap: 0.75rem;
        padding: 0.85rem;
      }

      .slot-capacity {
        align-items: center;
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
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
        color: var(--admin-success);
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
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
        border-radius: 0.45rem;
        color: var(--admin-muted);
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
        color: var(--admin-muted);
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
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
        border-radius: 0.45rem;
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        padding: 0.75rem;
      }

      .draft-batch-row span {
        color: var(--admin-muted);
        font-size: 0.82rem;
        font-weight: 700;
      }

      label.inline {
        margin: 0;
        min-width: min(14rem, 100%);
      }

      .state-error {
        color: var(--admin-danger);
        font-weight: 800;
      }

      @media (max-width: 900px) {
        .admin-shell,
        .admin-auth-panel,
        .admin-summary-grid,
        .filters,
        .draft-grid,
        .batch-create-form,
        .slot-create-form,
        .slot-edit-grid {
          grid-template-columns: minmax(0, 1fr);
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
  readonly i18n = inject(FundingI18nService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly admin = inject(FundingAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly destroy = inject(DestroyRef);
  private loadGeneration = 0;
  readonly publicationPath = '/admin/fundraiser/publications';
  readonly publicationSpaces = ['drafts', 'batches', 'calendar'] as const;
  readonly navigationParams = signal<Record<string, string>>({});
  readonly activeView = signal<PublicationView>('overview');
  readonly selectedDraftId = signal<string | null>(null);
  readonly selectedBatchId = signal<string | null>(null);
  readonly selectedSlotId = signal<string | null>(null);
  readonly showEligible = signal(false);
  readonly newBatchOpen = signal(false);
  readonly newSlotOpen = signal(false);
  readonly showBatchHistory = signal(false);
  readonly showSlotHistory = signal(false);
  readonly dirtyDraftIds = signal<ReadonlySet<string>>(new Set());
  readonly dirtySlotIds = signal<ReadonlySet<string>>(new Set());
  readonly notice = signal('');
  private readonly target = signal<string | null>(null);
  get targetId(): string | null {
    return this.target();
  }
  readonly targetFound = computed(
    () =>
      !this.targetId ||
      [
        ...this.slots(),
        ...this.batches(),
        ...this.drafts(),
        ...this.sponsorships()
      ].some((item) => item.id === this.targetId)
  );

  readonly publicationStatuses = publicationStatuses;
  readonly adminToken = signal<string>('');
  readonly sponsorships = signal<readonly AdminSponsorshipRecord[]>([]);
  readonly draftsResponse = signal<AdminPublicationDraftsResponse | null>(null);
  readonly draftEdits = signal<Record<string, PublicationDraftEdit>>({});
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly actionState = signal<string | null>(null);
  readonly search = signal<string>('');
  readonly statusFilter = signal<'active' | 'all' | PublicationDraftStatus>(
    'active'
  );

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
  readonly selectedBatch = computed(
    () =>
      this.batches().find((batch) => batch.id === this.selectedBatchId()) ??
      null
  );
  readonly selectedSlot = computed(
    () => this.slots().find((slot) => slot.id === this.selectedSlotId()) ?? null
  );
  readonly batchCalendarEntries = computed<readonly PublicationCalendarEntry[]>(
    () =>
      this.visibleBatches().map((batch) => ({
        id: batch.id,
        channel: batch.channel,
        status: batch.status,
        startsAt: batch.scheduledAt ?? batch.publishedAt,
        capacity: batch.capacity,
        capacityUsed: batch.capacityUsed
      }))
  );
  readonly slotCalendarEntries = computed<readonly PublicationCalendarEntry[]>(
    () =>
      this.visibleSlots().map((slot) => ({
        id: slot.id,
        channel: slot.channel,
        status: slot.status,
        startsAt: slot.startsAt,
        capacity: slot.capacity,
        capacityUsed: slot.capacityUsed,
        target: this.feedTargetName(slot.feedTarget)
      }))
  );
  readonly visibleBatches = computed(() =>
    this.batches().filter(
      (batch) =>
        this.showBatchHistory() ||
        batch.status === 'open' ||
        batch.status === 'scheduled' ||
        batch.id === this.selectedBatchId()
    )
  );
  readonly visibleSlots = computed(() =>
    this.slots().filter(
      (slot) =>
        this.showSlotHistory() ||
        slot.status === 'open' ||
        slot.status === 'scheduled' ||
        slot.id === this.selectedSlotId()
    )
  );
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
        (status === 'all' ||
          (status === 'active' &&
            draft.status !== 'published' &&
            draft.status !== 'cancelled') ||
          draft.status === status ||
          draft.id === this.selectedDraftId())
      );
    });
  });
  ngOnInit(): void {
    this.adminToken.set(this.admin.getSavedAdminToken());
    this.destroy.onDestroy(() => this.loadGeneration++);
    // Read both path and query parameters after a completed navigation so a
    // history traversal cannot briefly apply parameters from two different URLs.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        startWith(null),
        map(() => this.router.url),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroy)
      )
      .subscribe(() => {
        const params = this.route.snapshot.queryParamMap;
        const view = (this.route.snapshot.paramMap.get('workspace') ??
          'overview') as PublicationView;
        const targetView = params.has('slotId')
          ? 'calendar'
          : params.has('batchId')
            ? 'batches'
            : params.has('draftId')
              ? 'drafts'
              : null;
        // Existing attention and search links continue to open the right page.
        if (targetView && view !== targetView) {
          void this.router.navigate([this.publicationPath, targetView], {
            queryParams: this.route.snapshot.queryParams,
            replaceUrl: true
          });
          return;
        }
        const previousView = this.activeView();
        const previousTarget = this.target();
        const target =
          params.get('slotId') ||
          params.get('batchId') ||
          params.get('draftId');
        this.target.set(target);
        this.activeView.set(view);
        this.navigationParams.set(
          params.has('returnTo') ? { returnTo: params.get('returnTo')! } : {}
        );
        if (params.has('slotId')) this.selectedSlotId.set(params.get('slotId'));
        if (params.has('batchId'))
          this.selectedBatchId.set(params.get('batchId'));
        if (params.has('draftId')) {
          this.selectedDraftId.set(params.get('draftId'));
          this.search.set('');
          this.statusFilter.set('all');
        }
        if (previousView !== view) this.notice.set('');
        if (this.state() === 'idle' || previousTarget !== target) {
          void this.load();
        } else if (target) {
          this.focusObject(target);
        }
        if (!target && previousView !== view) {
          afterNextRender(
            () => this.document.getElementById('publication-heading')?.focus(),
            { injector: this.injector }
          );
        }
      });
  }

  async load(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.state.set('loading');

    try {
      const [sponsorships, drafts, batches, slots, socialJobs] =
        await Promise.all([
          this.loadApprovedSponsorships(generation),
          this.admin.getPublicationDrafts(
            this.adminToken(),
            this.route.snapshot.queryParamMap.get('draftId') ?? undefined
          ),
          this.admin.getPublicationBatches(
            this.adminToken(),
            this.route.snapshot.queryParamMap.get('batchId') ?? undefined
          ),
          this.admin.getPublicationSlots(
            this.adminToken(),
            this.route.snapshot.queryParamMap.get('slotId') ?? undefined
          ),
          this.admin.getSocialPublicationJobs(this.adminToken())
        ]);
      if (generation !== this.loadGeneration) return;
      this.sponsorships.set(sponsorships);
      this.draftsResponse.set(drafts);
      this.draftEdits.set(
        Object.fromEntries(
          drafts.drafts.map((draft) => [
            draft.id,
            this.dirtyDraftIds().has(draft.id)
              ? (this.draftEdits()[draft.id] ?? this.toEdit(draft))
              : this.toEdit(draft)
          ])
        )
      );
      this.batchesResponse.set(batches);
      this.slotsResponse.set(slots);
      this.slotEdits.set(
        Object.fromEntries(
          slots.slots.map((slot) => [
            slot.id,
            this.dirtySlotIds().has(slot.id)
              ? (this.slotEdits()[slot.id] ?? this.toSlotEdit(slot))
              : this.toSlotEdit(slot)
          ])
        )
      );
      this.socialJobsResponse.set(socialJobs);
      this.state.set('ready');
      if (this.targetId)
        afterNextRender(
          () => {
            if (generation !== this.loadGeneration) return;
            const target = this.document.getElementById(
              'attention-object-' + this.targetId
            );
            target?.focus({ preventScroll: true });
            target?.scrollIntoView({ block: 'center' });
          },
          { injector: this.injector }
        );
      this.admin.saveAdminToken(this.adminToken());
    } catch {
      if (generation !== this.loadGeneration) return;
      this.state.set('error');
    }
  }

  private async loadApprovedSponsorships(
    generation: number
  ): Promise<readonly AdminSponsorshipRecord[]> {
    const sponsors: AdminSponsorshipRecord[] = [];
    const token = this.adminToken();
    for (let page = 1; ; page++) {
      const response = await this.admin.getSponsorships(token, {
        page,
        pageSize: 25,
        reviewStatus: 'approved',
        paymentStatus: 'paid',
        sort: 'company',
        direction: 'asc'
      });
      if (generation !== this.loadGeneration) return [];
      sponsors.push(...response.sponsorships);
      if (!response.pagination.hasNextPage) return sponsors;
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
      const result = await this.admin.createPublicationDraft(
        this.adminToken(),
        {
          contributionId: sponsorship.id,
          feedTarget: sponsorship.sponsor_feed_target,
          channel
        }
      );
      await this.load();
      if (result.draft) {
        this.showEligible.set(false);
        this.selectedDraftId.set(result.draft.id);
        this.statusFilter.set('all');
        this.focusObject(result.draft.id);
      }
    } catch {
      this.state.set('error');
    } finally {
      this.actionState.set(null);
    }
  }

  async focusBatch(batchId: string): Promise<void> {
    if (
      !(await this.router.navigate([this.publicationPath, 'batches'], {
        queryParams: this.navigationParams()
      }))
    )
      return;
    this.selectedBatchId.set(batchId);
    this.focusObject(batchId);
  }

  private focusObject(id: string): void {
    afterNextRender(
      () => {
        const target = this.document.getElementById('attention-object-' + id);
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'center' });
      },
      { injector: this.injector }
    );
  }

  prepareDraft(): void {
    this.showEligible.set(true);
  }

  closePreparation(): void {
    this.showEligible.set(false);
    this.document.getElementById('publication-prepare')?.focus();
  }

  async saveDraft(
    draft: AdminPublicationDraftRecord,
    status?: PublicationDraftStatus
  ): Promise<void> {
    if (this.actionState()) return;
    if (
      status === 'rejected' &&
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.refuse'),
        draft.title
      ))
    )
      return;
    if (
      status === 'published' &&
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.publish'),
        draft.title
      ))
    )
      return;
    const edit = this.editFor(draft.id);
    this.actionState.set(draft.id);

    try {
      const result = await this.admin.updatePublicationDraft(
        this.adminToken(),
        {
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
        }
      );
      if (!result.updated) throw new Error('Draft was not saved.');
      this.dirtyDraftIds.update((ids) => {
        const next = new Set(ids);
        next.delete(draft.id);
        return next;
      });
      this.notice.set('admin.publications.saved');
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
      try {
        await navigator.clipboard.writeText(text);
        this.notice.set('admin.publications.copied');
      } catch {
        this.notice.set('admin.publications.copyFailed');
      }
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
      const result = await this.admin.createPublicationSlot(this.adminToken(), {
        feedTarget: this.newSlotFeedTarget(),
        channel: this.newSlotChannel(),
        startsAt: new Date(this.newSlotStartsAt()).toISOString(),
        timezone: this.newSlotTimezone().trim() || 'America/Toronto',
        capacity,
        notes: this.newSlotNotes()
      });
      this.newSlotNotes.set('');
      this.newSlotOpen.set(false);
      this.selectedSlotId.set(result.slot?.id ?? null);
      await this.load();
      if (result.slot) this.focusObject(result.slot.id);
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
      const result = await this.admin.updatePublicationSlot(this.adminToken(), {
        slotId: slot.id,
        startsAt: new Date(edit.startsAt).toISOString(),
        timezone: edit.timezone.trim() || 'America/Toronto',
        capacity,
        notes: edit.notes
      });
      if (!result.updated) throw new Error('Slot was not saved.');
      if (this.slotEdits()[slot.id] === edit)
        this.dirtySlotIds.update((ids) => {
          const next = new Set(ids);
          next.delete(slot.id);
          return next;
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
    if (this.slotActionState()) return;
    if (
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.publish'),
        slot.id
      ))
    )
      return;
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
    if (this.slotActionState()) return;
    if (
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.cancelPublication'),
        slot.id
      ))
    )
      return;
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
      const result = await this.admin.createPublicationBatch(
        this.adminToken(),
        {
          channel: this.newBatchChannel(),
          capacity
        }
      );
      this.newBatchOpen.set(false);
      this.selectedBatchId.set(result.batch?.id ?? null);
      await this.load();
      if (result.batch) this.focusObject(result.batch.id);
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
    if (this.batchActionState()) return;
    if (
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.publish'),
        batch.id
      ))
    )
      return;
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
    const drafts = this.drafts().filter((d) => d.batch_id === batch.id);
    const target = drafts[0]?.feed_target;
    if (!target) return;
    await this.router.navigate([this.publicationPath + '/automation'], {
      queryParams: { batchId: batch.id, feedId: target + ':' + batch.channel }
    });
  }

  async cancelBatch(batch: AdminPublicationBatchRecord): Promise<void> {
    if (this.batchActionState()) return;
    if (
      !(await this.confirmation.confirm(
        this.i18n.t('admin.confirmation.cancelPublication'),
        batch.id
      ))
    )
      return;
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
    this.selectedDraftId.set(null);
    this.statusFilter.set(
      value === 'active'
        ? 'active'
        : publicationStatuses.includes(value as PublicationDraftStatus)
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
    this.dirtySlotIds.update((ids) => new Set([...ids, slotId]));
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
      disabled: this.i18n.t('admin.messages.desactive'),
      mock: this.i18n.t('admin.dossier.simulation'),
      live: this.i18n.t('admin.messages.connecte')
    } as const;

    return labels[mode];
  }

  socialPublicationConfiguredChannelsLabel(): string {
    const channels = this.socialJobsResponse()?.configuredChannels ?? [];
    return channels.length > 0
      ? channels.map((channel) => this.channelLabel(channel)).join(', ')
      : this.i18n.t('admin.messages.aucun_canal');
  }

  socialJobForBatch(batchId: string): AdminSocialPublicationJobRecord | null {
    return this.socialJobByBatchId().get(batchId) ?? null;
  }

  canPublishSocialBatch(batch: AdminPublicationBatchRecord): boolean {
    const job = this.socialJobForBatch(batch.id);
    return (
      ['open', 'scheduled'].includes(batch.status) &&
      batch.capacityUsed > 0 &&
      !['publishing', 'published', 'failed'].includes(job?.status ?? '')
    );
  }

  socialJobStatusLabel(
    status: AdminSocialPublicationJobRecord['status']
  ): string {
    const labels: Record<AdminSocialPublicationJobRecord['status'], string> = {
      pending: this.i18n.t('admin.legacy.en_attente'),
      publishing: this.i18n.t('admin.messages.envoi_en_cours'),
      published: this.i18n.t('admin.messages.publie_via_api'),
      failed: this.i18n.t('admin.messages.echec_api')
    };

    return labels[status];
  }

  setEditField(
    draftId: string,
    field: keyof PublicationDraftEdit,
    event: Event
  ): void {
    this.dirtyDraftIds.update((ids) => new Set([...ids, draftId]));
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
    return channel === 'linkedin'
      ? 'LinkedIn'
      : this.i18n.t('admin.messages.facebook');
  }

  feedTargetName(feedTarget: SponsorFeedTarget): string {
    return feedTarget === 'openg20' ? 'OpenG20' : 'OpenG7';
  }

  batchStatusLabel(status: PublicationBatchStatus | null): string {
    if (!status) {
      return this.i18n.t('admin.cockpit.health.unknown');
    }

    const labels: Record<PublicationBatchStatus, string> = {
      open: this.i18n.t('admin.dossier.values.open'),
      scheduled: this.i18n.t('admin.messages.planifie'),
      published: this.i18n.t('admin.messages.publie'),
      cancelled: this.i18n.t('admin.messages.annule')
    };

    return labels[status];
  }

  slotStatusLabel(status: PublicationSlotStatus): string {
    const labels: Record<PublicationSlotStatus, string> = {
      open: this.i18n.t('admin.dossier.values.open'),
      scheduled: this.i18n.t('admin.messages.planifie'),
      published: this.i18n.t('admin.messages.publie'),
      cancelled: this.i18n.t('admin.messages.annule')
    };

    return labels[status];
  }

  dateLabel(value: string | null, timezone = 'America/Toronto'): string {
    if (!value) {
      return this.i18n.t('admin.dashboard.notAvailable');
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return this.i18n.t('admin.dashboard.notAvailable');
    }

    try {
      return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone
      }).format(date);
    } catch {
      return value;
    }
  }

  feedTargetLabel(sponsorship: AdminSponsorshipRecord): string {
    return sponsorship.sponsor_feed_target === 'openg20' ? 'OpenG20' : 'OpenG7';
  }

  statusLabel(status: PublicationDraftStatus): string {
    const labels: Record<PublicationDraftStatus, string> = {
      draft: this.i18n.t('admin.legacy.brouillon'),
      pending_review: this.i18n.t('admin.legacy.a_approuver'),
      approved: this.i18n.t('admin.messages.approuvee'),
      scheduled: this.i18n.t('admin.messages.planifiee'),
      published: this.i18n.t('admin.legacy.publiee'),
      rejected: this.i18n.t('admin.messages.refusee'),
      cancelled: this.i18n.t('admin.messages.annulee')
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
