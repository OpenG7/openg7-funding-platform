import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
  DEFAULT_SPONSORSHIP_PRICING_CONFIG,
  resolveSponsorshipBenefits
} from '@openg7/funding-core';
import type {
  AdminAuditLogEntry,
  AdminSponsorshipRejectionRefundHandling,
  AdminPagination,
  AdminSponsorshipRecord,
  AdminSponsorshipProgress,
  AdminSponsorshipRefundResult,
  AdminSponsorshipRefundWorkflowStatus,
  AdminSponsorshipStripeRefundReason,
  AdminSponsorshipReviewResult,
  SponsorMediaAsset,
  SponsorFeedChannel,
  SponsorFeedStatus,
  SponsorFeedTarget,
  SponsorshipBenefitId,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminAssistantContextComponent } from '../../components/admin-assistant/admin-assistant-context.component.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import { AdminSponsorDetailMediaComponent } from '../../components/admin-sponsors/admin-sponsor-detail-media.component.js';
import { AdminSponsorshipProgressComponent } from '../../components/admin-sponsors/admin-sponsorship-progress.component.js';
import { AdminSponsorshipAccessComponent } from '../../components/admin-sponsors/admin-sponsorship-access.component.js';
import { AdminSponsorshipFactsComponent } from '../../components/admin-sponsors/admin-sponsorship-facts.component.js';
import { AdminSponsorDetailHeaderComponent } from '../../components/admin-sponsors/admin-sponsor-detail-header.component.js';
import { AdminSponsorEditComponent } from '../../components/admin-sponsors/admin-sponsor-edit.component.js';
import { AdminSponsorDetailIdentityComponent } from '../../components/admin-sponsors/admin-sponsor-detail-identity.component.js';
import { AdminSponsorDetailOverviewComponent } from '../../components/admin-sponsors/admin-sponsor-detail-overview.component.js';
import { AdminSponsorDetailTabsComponent } from '../../components/admin-sponsors/admin-sponsor-detail-tabs.component.js';
import { AdminSponsorsListPanelComponent } from '../../components/admin-sponsors/admin-sponsors-list-panel.component.js';
import { AdminSponsorsSummaryComponent } from '../../components/admin-sponsors/admin-sponsors-summary.component.js';
import type {
  AdminSponsorDetailHeaderView,
  AdminSponsorDetailIdentityView,
  AdminSponsorDetailOverviewView,
  AdminSponsorFeedStatusOption,
  AdminSponsorListRow,
  AdminSponsorMediaDeleteEvent,
  AdminSponsorMediaReviewEvent,
  SponsorDetailsTab,
  SponsorFeedStatusFilter,
  SponsorPaymentStatusFilter,
  SponsorshipReviewFilter
} from '../../models/admin-sponsors-ui.models.js';

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

interface SponsorRefundHistoryEntry {
  readonly id: string;
  readonly date: string;
  readonly label: string;
  readonly detail?: string;
  readonly tone: AdminSponsorshipRefundWorkflowStatus;
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
  readonly refundAmount: string;
  readonly refundReason: AdminSponsorshipStripeRefundReason;
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
  imports: [
    AdminAssistantContextComponent,
    TranslatePipe,
    AdminSponsorDetailMediaComponent,
    AdminSponsorshipProgressComponent,
    AdminSponsorshipFactsComponent,
    CommonModule,
    RouterLink,
    AdminLayoutComponent,
    AdminSponsorDetailHeaderComponent,
    AdminSponsorEditComponent,
    AdminSponsorDetailIdentityComponent,
    AdminSponsorDetailOverviewComponent,
    AdminSponsorDetailTabsComponent,
    AdminSponsorsListPanelComponent,
    AdminSponsorsSummaryComponent,
    AdminSponsorshipAccessComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <openg7-admin-layout>
      <section class="admin-workspace">
        <header class="admin-page-header">
          <nav
            class="admin-breadcrumb"
            [attr.aria-label]="'admin.legacy.fil_d_ariane_admin' | translate"
          >
            <a routerLink="/admin/fundraiser">{{
              'admin.legacy.accueil' | translate
            }}</a>
            <span aria-hidden="true">/</span>
            <a routerLink="/admin/fundraiser">{{
              'admin.legacy.fundraiser' | translate
            }}</a>
            <span aria-hidden="true">/</span>
            <strong>{{ 'admin.legacy.commanditaires' | translate }}</strong>
          </nav>

          <div class="admin-title-row">
            <div>
              <span class="admin-kicker">{{
                'admin.legacy.administration' | translate
              }}</span>
              <h1>
                {{ 'admin.legacy.commanditaires_partenaires' | translate }}
              </h1>
              <p>
                {{
                  'admin.legacy.gestion_des_organisations_commanditaires_statut_de_revue_et_visib'
                    | translate
                }}
              </p>
            </div>

            <div class="admin-actions">
              <button
                type="button"
                class="secondary-action"
                (click)="loadSponsorships()"
                [disabled]="state() === 'loading'"
              >
                {{ 'admin.legacy.actualiser' | translate }}
              </button>
              <a class="primary-action" routerLink="/fonds-des-batisseurs">{{
                'admin.legacy.retour_public' | translate
              }}</a>
            </div>
          </div>
        </header>

        <openg7-admin-sponsors-summary
          [totalSponsorships]="pagination().totalItems"
          [visibleCount]="visibleCount()"
          [activeCount]="activeCount()"
          [totalContributionLabel]="formatSummaryMoney(totalContribution())"
        />

        <section
          class="sponsors-board"
          [attr.aria-label]="'admin.legacy.commandites_admin' | translate"
        >
          <openg7-admin-sponsors-list-panel
            [state]="state()"
            [rows]="sponsorListRows()"
            [sponsorshipCount]="sponsorships().length"
            [hasActiveFilters]="hasActiveFilters()"
            [selectedSponsorshipId]="selectedSponsorshipId()"
            [selectionPulseId]="selectionPulseId()"
            [search]="search()"
            [reviewFilter]="reviewFilter()"
            [feedFilter]="feedFilter()"
            [paymentFilter]="paymentFilter()"
            [feedStatusOptions]="feedStatusOptions()"
            [pageSizeOptions]="pageSizeOptions"
            [paginationStart]="paginationStart()"
            [paginationEnd]="paginationEnd()"
            [totalItems]="pagination().totalItems"
            [page]="normalizedPage()"
            [totalPages]="totalPages()"
            [pageSize]="pageSize()"
            (refresh)="loadSponsorships()"
            (searchChange)="setSearchValue($event)"
            (reviewFilterChange)="setReviewFilterValue($event)"
            (feedFilterChange)="setFeedFilterValue($event)"
            (paymentFilterChange)="setPaymentFilterValue($event)"
            (resetFilters)="resetFilters()"
            (selectSponsorship)="selectSponsorshipById($event)"
            (previousPage)="previousPage()"
            (nextPage)="nextPage()"
            (pageSizeChange)="setPageSizeValue($event)"
          />

          <aside
            #sponsorDetailPanel
            class="sponsor-detail-panel"
            [class.is-empty]="!selectedSponsorship()"
            [class.selection-pulse]="
              selectedSponsorship() &&
              selectionPulseId() === selectedSponsorship()?.id
            "
            [attr.aria-label]="
              'admin.legacy.dossier_commanditaire_selectionne' | translate
            "
          >
            <ng-container
              *ngIf="selectedSponsorship() as selected; else noSelection"
            >
              <openg7-admin-sponsor-detail-header
                *ngIf="selectedSponsorDetailHeader() as detailHeader"
                [detail]="detailHeader"
                (close)="closeDetails()"
              />
              <openg7-admin-sponsor-edit
                [sponsorship]="selected"
                [disabled]="state() === 'loading' || actionState() !== null"
                (saved)="loadSponsorships()"
                (conflicted)="versionConflict.set(true)"
              />

              <p
                class="payment-alert"
                *ngIf="paymentEligibilityMessage(selected)"
                role="alert"
              >
                {{ paymentEligibilityMessage(selected) }}
              </p>

              @if (versionConflict()) {
                <p role="alert">
                  {{ 'admin.dossier.conflict' | translate }}
                  <button
                    type="button"
                    [disabled]="state() === 'loading' || actionState() !== null"
                    (click)="loadSponsorships()"
                  >
                    {{ 'admin.dossier.refresh' | translate }}
                  </button>
                </p>
              }
              <openg7-admin-sponsorship-progress
                [sponsorshipId]="selected.id"
                [refreshKey]="assistantRefresh()"
                [disabled]="actionState() !== null"
                (loaded)="progress.set($event)"
              />
              <openg7-admin-sponsorship-access
                [contributionId]="selected.id"
                [token]="adminToken()"
                (queued)="loadSponsorships()"
              />
              <openg7-admin-sponsor-detail-tabs
                [activeTab]="activeTab()"
                (activeTabChange)="setActiveTab($event)"
              />

              <ng-container *ngIf="activeTab() === 'overview'">
                <openg7-admin-assistant-context
                  [sponsorshipId]="selected.id"
                  [refreshKey]="assistantRefresh()"
                  [compact]="true"
                  [inlineDossier]="true"
                  (dossierOpen)="sponsorOverview()?.focusDetails()"
                />
                <openg7-admin-sponsorship-facts
                  view="overview"
                  [dossier]="progress()"
                />
                <openg7-admin-sponsor-detail-overview
                  *ngIf="selectedSponsorDetailOverview() as overview"
                  [overview]="overview"
                  (copyReference)="copyReference(selected)"
                  (reviewNoteChange)="setReviewNoteValue(selected.id, $event)"
                  (saveReviewNote)="saveReviewNote(selected)"
                />
              </ng-container>

              <ng-container *ngIf="activeTab() === 'identity'">
                <openg7-admin-sponsor-detail-identity
                  *ngIf="selectedSponsorDetailOverview() as identity"
                  [identity]="identity"
                />
              </ng-container>

              <ng-container *ngIf="activeTab() === 'media'">
                <openg7-admin-sponsor-detail-media
                  *ngIf="selectedSponsorDetailIdentity() as identity"
                  [identity]="identity"
                  (uploadLogo)="uploadLogo(selected, $event)"
                  (previewMedia)="
                    inspection.media($event.id, selected.id, $event.alt)
                  "
                  (deleteLogo)="deleteLogo(selected)"
                  (reviewMedia)="reviewSponsorMedia(selected, $event)"
                  (approveAllMedia)="approveAllSponsorMedia(selected)"
                  (deleteMedia)="deleteSponsorMedia(selected, $event)"
                />
              </ng-container>

              @if (activeTab() === 'billing') {
                <openg7-admin-sponsorship-facts
                  view="billing"
                  [dossier]="progress()"
                />
              }
              @if (activeTab() === 'publication') {
                <openg7-admin-sponsorship-facts
                  view="publication"
                  [dossier]="progress()"
                />
              }
              @if (activeTab() === 'refund') {
                <openg7-admin-sponsorship-facts
                  view="refund"
                  [dossier]="progress()"
                />
              }

              <section
                class="detail-body"
                *ngIf="activeTab() === 'publication'"
                [attr.aria-label]="'admin.legacy.publication' | translate"
              >
                <article class="detail-card publication-editor">
                  <header>
                    <div>
                      <span>{{ 'admin.legacy.publication' | translate }}</span>
                      <h3>
                        {{ 'admin.legacy.commanditaire_et_feeds' | translate }}
                      </h3>
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
                          ? ('admin.legacy.enregistrement' | translate)
                          : ('admin.legacy.enregistrer' | translate)
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
                      >{{ 'admin.legacy.slug_public' | translate
                      }}<input
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
                      >{{ 'admin.legacy.destination_feed' | translate
                      }}<select
                        [value]="publicationDraftFor(selected.id).feedTarget"
                        (change)="
                          setPublicationField(selected.id, 'feedTarget', $event)
                        "
                      >
                        <option value="">
                          {{ 'admin.legacy.aucune' | translate }}
                        </option>
                        <option value="openg7">OpenG7</option>
                        <option value="openg20">OpenG20</option>
                      </select></label
                    >
                    <label
                      >{{ 'admin.legacy.statut_feed' | translate
                      }}<select
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
                      <legend>{{ 'admin.legacy.canaux' | translate }}</legend>
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
                      >{{ 'admin.legacy.resume_public' | translate
                      }}<textarea
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
                      >{{ 'admin.legacy.lien_de_publication' | translate
                      }}<input
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
                      >{{ 'admin.legacy.notes_feed' | translate
                      }}<textarea
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
                  <span>{{
                    'admin.legacy.previsualisation_non_publiee' | translate
                  }}</span>
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
                            ('admin.legacy.aucun_resume_public_pour_le_moment'
                              | translate)
                        }}
                      </p>
                    </div>
                  </div>
                  <dl class="compact-definition-list">
                    <div>
                      <dt>{{ 'admin.legacy.destination' | translate }}</dt>
                      <dd>
                        {{
                          publicationDraftFor(selected.id).feedTarget ||
                            ('admin.legacy.aucune' | translate)
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>{{ 'admin.legacy.canaux' | translate }}</dt>
                      <dd>{{ draftChannelsLabel(selected.id) }}</dd>
                    </div>
                    <div>
                      <dt>{{ 'admin.legacy.lien' | translate }}</dt>
                      <dd>
                        {{
                          publicationDraftFor(selected.id).feedPublicUrl ||
                            ('admin.legacy.non_defini' | translate)
                        }}
                      </dd>
                    </div>
                  </dl>
                </article>
              </section>

              <section
                class="detail-body refund-history-body"
                *ngIf="activeTab() === 'refund'"
                [attr.aria-label]="
                  'admin.legacy.historique_remboursement' | translate
                "
              >
                <article class="detail-card">
                  <h3>{{ 'admin.legacy.suivi_remboursement' | translate }}</h3>
                  <div class="refund-summary-grid">
                    <div>
                      <span>{{ 'admin.legacy.statut' | translate }}</span>
                      <strong
                        ><span
                          [class]="
                            refundWorkflowStatusClass(
                              selected.sponsorship_refund_status
                            )
                          "
                          >{{
                            refundWorkflowStatusLabel(
                              selected.sponsorship_refund_status
                            )
                          }}</span
                        ></strong
                      >
                    </div>
                    <div>
                      <span>{{
                        'admin.legacy.montant_commandite' | translate
                      }}</span>
                      <strong>{{ formatMoney(selected) }}</strong>
                    </div>
                    <div>
                      <span>{{
                        'admin.legacy.dernier_montant_rembourse' | translate
                      }}</span>
                      <strong>{{
                        selected.sponsorship_refund_amount
                          ? formatAmount(
                              selected.sponsorship_refund_amount,
                              selected.currency
                            )
                          : ('admin.legacy.non_associe' | translate)
                      }}</strong>
                    </div>
                    <div>
                      <span>{{
                        'admin.legacy.raison_stripe' | translate
                      }}</span>
                      <strong>{{
                        selected.sponsorship_refund_reason
                          ? stripeRefundReasonLabel(
                              selected.sponsorship_refund_reason
                            )
                          : ('admin.legacy.non_associee' | translate)
                      }}</strong>
                    </div>
                    <div>
                      <span>{{
                        'admin.legacy.reference_publique' | translate
                      }}</span>
                      <code>{{
                        selected.public_reference ||
                          ('admin.legacy.non_attribuee_175' | translate)
                      }}</code>
                    </div>
                    <div>
                      <span>{{
                        'admin.legacy.refund_stripe' | translate
                      }}</span>
                      <code>{{
                        selected.sponsorship_refund_id ||
                          ('admin.legacy.non_associe' | translate)
                      }}</code>
                    </div>
                  </div>
                  <p class="muted-copy" *ngIf="!hasRefundWorkflow(selected)">
                    {{
                      'admin.legacy.aucun_remboursement_n_est_demande_pour_cette_commandite'
                        | translate
                    }}
                  </p>
                </article>

                <article class="detail-card">
                  <h3>{{ 'admin.legacy.jalons_remboursement' | translate }}</h3>
                  <ol
                    class="refund-history-list"
                    *ngIf="
                      refundHistoryEntriesFor(selected).length > 0;
                      else noRefundHistory
                    "
                  >
                    <li
                      *ngFor="
                        let entry of refundHistoryEntriesFor(selected);
                        trackBy: trackByRefundHistoryEntry
                      "
                      [class]="refundHistoryEntryClass(entry)"
                    >
                      <time>{{ dateTimeLabel(entry.date) }}</time>
                      <p>{{ entry.label }}</p>
                      <small *ngIf="entry.detail">{{ entry.detail }}</small>
                    </li>
                  </ol>
                  <ng-template #noRefundHistory
                    ><p class="muted-copy">
                      {{
                        'admin.legacy.aucun_jalon_de_remboursement_n_est_encore_date_pour_ce_dossier'
                          | translate
                      }}
                    </p></ng-template
                  >
                </article>

                <article
                  class="detail-card"
                  *ngIf="
                    selected.sponsorship_refund_note ||
                    selected.sponsorship_refund_error
                  "
                >
                  <h3>{{ 'admin.legacy.notes_et_erreurs' | translate }}</h3>
                  <dl class="compact-definition-list">
                    <div *ngIf="selected.sponsorship_refund_note">
                      <dt>
                        {{ 'admin.legacy.note_remboursement' | translate }}
                      </dt>
                      <dd class="preserve-lines">
                        {{ selected.sponsorship_refund_note }}
                      </dd>
                    </div>
                    <div *ngIf="selected.sponsorship_refund_error">
                      <dt>{{ 'admin.legacy.derniere_erreur' | translate }}</dt>
                      <dd class="preserve-lines">
                        {{ selected.sponsorship_refund_error }}
                      </dd>
                    </div>
                  </dl>
                </article>

                <article class="detail-card">
                  <h3>{{ 'admin.legacy.actions_admin_liees' | translate }}</h3>
                  <ol
                    class="audit-list"
                    *ngIf="
                      refundAuditEntriesFor(selected).length > 0;
                      else noRefundAudit
                    "
                  >
                    <li
                      *ngFor="
                        let entry of refundAuditEntriesFor(selected);
                        trackBy: trackByAuditEntry
                      "
                    >
                      <time>{{ dateTimeLabel(entry.date) }}</time>
                      <p>{{ entry.label }}</p>
                      <small *ngIf="entry.detail">{{ entry.detail }}</small>
                    </li>
                  </ol>
                  <ng-template #noRefundAudit
                    ><p class="muted-copy">
                      {{
                        'admin.legacy.aucune_action_admin_de_remboursement_n_est_encore_associee_a_cett'
                          | translate
                      }}
                    </p></ng-template
                  >
                </article>
              </section>

              <section
                class="detail-body"
                *ngIf="activeTab() === 'audit'"
                [attr.aria-label]="
                  'admin.legacy.historique_et_audit' | translate
                "
              >
                <article class="detail-card">
                  <h3>
                    {{ 'admin.legacy.historique_disponible' | translate }}
                  </h3>
                  <button type="button" (click)="inspection.history(selected)">
                    {{ 'admin.inspector.kinds.history' | translate }}
                  </button>
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
                      {{
                        'admin.legacy.aucun_historique_administratif_detaille_n_est_encore_disponible_p'
                          | translate
                      }}
                    </p></ng-template
                  >
                  <p class="muted-copy">
                    {{
                      'admin.legacy.les_actions_admin_proviennent_du_journal_prive_et_restent_limitee'
                        | translate
                    }}
                  </p>
                </article>
              </section>

              <section
                class="rejection-workflow"
                *ngIf="isRejectionPanelOpen(selected)"
                [attr.aria-label]="
                  'admin.legacy.refus_de_commandite' | translate
                "
              >
                <header>
                  <div>
                    <span>{{
                      'admin.legacy.action_sensible' | translate
                    }}</span>
                    <h3>
                      {{ 'admin.legacy.refuser_la_commandite' | translate }}
                    </h3>
                  </div>
                  <button
                    type="button"
                    class="icon-action"
                    (click)="closeRejectionPanel()"
                    [attr.aria-label]="
                      'admin.legacy.fermer_le_refus' | translate
                    "
                  >
                    ?
                  </button>
                </header>

                <label class="rejection-span-2"
                  >{{ 'admin.legacy.raison_interne_du_refus' | translate
                  }}<textarea
                    rows="4"
                    maxlength="1000"
                    [value]="reviewNoteFor(selected.id)"
                    (input)="setReviewNote(selected.id, $event)"
                  ></textarea>
                </label>

                <label class="rejection-span-2"
                  >{{ 'admin.legacy.message_au_commanditaire' | translate
                  }}<textarea
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
                  {{
                    'admin.legacy.envoyer_le_courriel_de_refus' | translate
                  }}</label
                >

                <label
                  >{{ 'admin.legacy.destinataire' | translate
                  }}<input
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
                  >{{ 'admin.legacy.remboursement' | translate
                  }}<select
                    [value]="rejectionDraftFor(selected).refundHandling"
                    (change)="setRejectionRefundHandling(selected.id, $event)"
                  >
                    <option value="none">
                      {{
                        'admin.legacy.ne_pas_rembourser_maintenant' | translate
                      }}
                    </option>
                    <option value="manual_required">
                      {{
                        'admin.legacy.a_traiter_manuellement_dans_stripe'
                          | translate
                      }}
                    </option>
                    <option value="manual_completed">
                      {{
                        'admin.legacy.deja_rembourse_manuellement' | translate
                      }}
                    </option>
                  </select></label
                >

                <label class="rejection-span-2"
                  >{{ 'admin.legacy.note_remboursement' | translate
                  }}<textarea
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
                    {{ 'admin.legacy.annuler' | translate }}
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
                        ? ('admin.legacy.refus_en_cours' | translate)
                        : ('admin.legacy.confirmer_le_refus' | translate)
                    }}
                  </button>
                </footer>
              </section>

              <section
                class="refund-workflow"
                *ngIf="isRefundPanelOpen(selected)"
                [attr.aria-label]="
                  'admin.legacy.remboursement_stripe' | translate
                "
              >
                <header>
                  <div>
                    <span>Stripe</span>
                    <h3>
                      {{ 'admin.legacy.remboursement_stripe' | translate }}
                    </h3>
                  </div>
                  <button
                    type="button"
                    class="icon-action"
                    (click)="closeRefundPanel()"
                    [attr.aria-label]="
                      'admin.legacy.fermer_le_remboursement' | translate
                    "
                  >
                    ?
                  </button>
                </header>

                <p class="refund-warning rejection-span-2">
                  {{
                    'admin.legacy.cette_action_declenche_un_remboursement_stripe_de_p0_sur_un_paiem'
                      | translate
                        : {
                            p0: refundDraftAmountLabel(selected),
                            p1: formatMoney(selected)
                          }
                  }}
                </p>

                <label
                  >{{ 'admin.legacy.montant_a_rembourser' | translate
                  }}<input
                    type="number"
                    min="0.01"
                    [max]="selected.amount"
                    step="0.01"
                    inputmode="decimal"
                    [value]="refundDraftFor(selected).refundAmount"
                    (input)="
                      setRefundDraftField(selected.id, 'refundAmount', $event)
                    "
                /></label>

                <label
                  >{{ 'admin.legacy.raison_stripe' | translate
                  }}<select
                    [value]="refundDraftFor(selected).refundReason"
                    (change)="setRefundDraftReason(selected.id, $event)"
                  >
                    <option value="requested_by_customer">
                      {{ 'admin.legacy.demande_du_commanditaire' | translate }}
                    </option>
                    <option value="duplicate">
                      {{ 'admin.legacy.paiement_en_double' | translate }}
                    </option>
                    <option value="fraudulent">
                      {{ 'admin.legacy.paiement_frauduleux' | translate }}
                    </option>
                  </select></label
                >

                <label class="rejection-span-2"
                  >{{ 'admin.legacy.texte_de_confirmation' | translate
                  }}<small
                    >{{ 'admin.legacy.recopiez' | translate
                    }}<code>{{ refundConfirmationText(selected) }}</code></small
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
                  {{
                    'admin.legacy.envoyer_le_courriel_de_remboursement'
                      | translate
                  }}</label
                >

                <label
                  >{{ 'admin.legacy.destinataire' | translate
                  }}<input
                    type="email"
                    autocomplete="email"
                    [disabled]="!refundDraftFor(selected).notifySponsor"
                    [value]="refundDraftFor(selected).recipientEmail"
                    (input)="
                      setRefundDraftField(selected.id, 'recipientEmail', $event)
                    "
                /></label>

                <label
                  >{{ 'admin.legacy.message_au_commanditaire_405' | translate
                  }}<textarea
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
                  >{{ 'admin.legacy.note_remboursement' | translate
                  }}<textarea
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
                    {{ 'admin.legacy.annuler' | translate }}
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
                        ? ('admin.legacy.remboursement_406' | translate)
                        : ('admin.legacy.rembourser_stripe' | translate)
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
                  {{ 'admin.legacy.remettre_en_attente' | translate }}
                </button>
                <button
                  type="button"
                  class="review-button reject"
                  [disabled]="isAnyActionPending(selected.id)"
                  (click)="openRejectionPanel(selected)"
                >
                  {{ 'admin.legacy.refuser' | translate }}
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
                  {{ 'admin.legacy.rembourser_stripe' | translate }}
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
                  {{ 'admin.legacy.accepter' | translate }}
                </button>
              </footer>
            </ng-container>

            <ng-template #noSelection
              ><article class="empty-detail-state">
                <h2>
                  {{
                    'admin.legacy.aucun_commanditaire_selectionne' | translate
                  }}
                </h2>
                <p>
                  {{
                    'admin.legacy.selectionnez_une_ligne_dans_la_liste_pour_ouvrir_le_dossier_revis'
                      | translate
                  }}
                </p>
              </article></ng-template
            >
          </aside>
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
        color: var(--admin-muted);
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
        color: var(--admin-muted);
        line-height: 1.55;
        margin: 0.35rem 0 0;
      }

      .admin-kicker,
      .admin-summary-grid article span:not(.metric-mark),
      dt,
      .publication-editor header span,
      .public-preview > span {
        color: var(--admin-muted);
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
        background: #3c3221;
        border: 1px solid var(--admin-border);
        color: var(--admin-text);
      }

      .secondary-action,
      .tertiary-action,
      .mini-action,
      .icon-action {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        color: var(--admin-text);
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
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        color: var(--admin-danger);
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
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
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
        background: var(--admin-panel-raised);
        color: var(--admin-text);
        height: 3rem;
        width: 3rem;
      }

      .metric-mark.gold {
        background: #3c3221;
        color: var(--admin-warning);
      }
      .metric-mark.green {
        background: var(--admin-panel-raised);
        color: var(--admin-success);
      }
      .metric-mark.money {
        background: #3c3221;
        color: var(--admin-warning);
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
        color: var(--admin-muted);
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
        border-bottom: 1px solid var(--admin-border);
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
        border: 1px solid var(--admin-border);
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
        background: var(--admin-panel);
        color: var(--admin-danger);
      }
      .state-loading {
        color: var(--admin-muted);
      }

      .skeleton-list {
        display: grid;
        gap: 0.65rem;
      }

      .skeleton-list span {
        background: linear-gradient(
          90deg,
          var(--admin-panel-raised),
          var(--admin-panel),
          var(--admin-panel-raised)
        );
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
        border-bottom: 1px solid var(--admin-border);
        color: var(--admin-muted);
        font-size: 0.76rem;
        font-weight: 900;
      }

      .sponsor-table-row {
        appearance: none;
        background: var(--sponsor-row-bg, var(--admin-panel));
        border: 0;
        border-bottom: 1px solid var(--admin-border);
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
        background: var(--sponsor-row-hover-bg, var(--admin-panel));
      }

      .sponsor-table-row.selected {
        background: var(--sponsor-row-selected-bg, var(--admin-panel));
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
        background: var(--admin-panel-raised);
        color: var(--admin-text);
        height: 2.35rem;
        width: 2.35rem;
      }

      .sponsor-avatar.large {
        font-size: 1.05rem;
        height: 3.5rem;
        width: 3.5rem;
      }

      .row-open {
        color: var(--admin-muted);
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
        grid-template-columns: minmax(0, 1fr);
        grid-auto-rows: max-content;
        max-height: calc(100vh - 2.5rem);
        overflow-y: auto;
        position: sticky;
        top: 1.25rem;
      }

      .review-toast {
        animation: review-toast-in 0.22s ease both;
        background: var(--admin-panel-raised);
        border: 1px solid rgb(255 255 255 / 12%);
        border-radius: 0.45rem;
        box-shadow: 0 16px 34px rgb(15 23 42 / 24%);
        color: var(--admin-text);
        font-size: 0.86rem;
        font-weight: 900;
        margin: 0;
        max-width: min(24rem, calc(100% - 2rem));
        padding: 0.75rem 0.9rem;
        pointer-events: none;
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
        color: var(--admin-muted);
        margin: 0.2rem 0 0;
      }

      .payment-alert {
        background: #3c3221;
        border: 1px solid var(--admin-border);
        border-radius: 0.45rem;
        color: var(--admin-danger);
        font-weight: 900;
        grid-column: 1 / -1;
        margin: 0 1rem 1rem;
        padding: 0.75rem 0.9rem;
      }

      .rejection-workflow {
        background: var(--admin-panel);
        border-top: 1px solid var(--admin-border);
        display: grid;
        gap: 0.85rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        padding: 1rem;
      }

      .refund-workflow {
        background: var(--admin-panel-raised);
        border-top: 1px solid var(--admin-border);
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
        color: var(--admin-danger);
        font-size: 0.72rem;
        font-weight: 900;
        text-transform: uppercase;
      }

      .refund-workflow header span {
        color: var(--admin-muted);
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
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
        border-radius: 0.4rem;
        color: var(--admin-muted);
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
        border-bottom: 1px solid var(--admin-border);
        border-top: 1px solid var(--admin-border);
        display: flex;
        gap: 0.25rem;
        overflow-x: auto;
        padding: 0 1rem;
      }

      .detail-tabs button {
        background: transparent;
        border: 0;
        border-bottom: 0.18rem solid transparent;
        color: var(--admin-muted);
        cursor: pointer;
        font-weight: 900;
        padding: 0.9rem 0.65rem 0.72rem;
        white-space: nowrap;
      }

      .detail-tabs button.active {
        border-color: var(--admin-border);
        color: var(--admin-muted);
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
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
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
        border: 1px solid var(--admin-border);
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
        color: var(--admin-warning);
      }

      .detail-actions {
        align-items: center;
        background: var(--admin-panel);
        border-top: 1px solid var(--admin-border);
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
      .refund-badge,
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
      .refund-requested,
      .visibility-review,
      .tier-gold {
        background: #3c3221;
        color: var(--admin-warning);
      }
      .status-approved,
      .feed-published,
      .payment-paid,
      .refund-completed,
      .visibility-visible {
        background: #193d32;
        color: var(--admin-success);
      }
      .status-rejected,
      .payment-failed,
      .refund-failed {
        background: #422532;
        color: var(--admin-danger);
      }
      .visibility-hidden,
      .feed-not_planned,
      .refund-not-requested {
        background: var(--admin-panel-raised);
        color: var(--admin-muted);
      }
      .refund-processing {
        background: var(--admin-panel-raised);
        color: var(--admin-muted);
      }
      .feed-drafted {
        background: var(--admin-panel-raised);
        color: var(--admin-muted);
      }
      .tier-silver {
        background: var(--admin-panel-raised);
        color: var(--admin-muted);
      }
      .tier-bronze {
        background: #3c3221;
        color: var(--admin-warning);
      }

      .field-error {
        color: var(--admin-danger);
        font-weight: 800;
      }
      .inline-status.is-dirty {
        color: var(--admin-warning);
        font-weight: 900;
      }

      .review-button.neutral {
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
        color: var(--admin-text);
      }
      .review-button.reject {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        color: var(--admin-danger);
      }
      .review-button.approve {
        background: #193d32;
        border: 1px solid var(--admin-border);
        color: var(--admin-text);
      }
      .review-button.refund {
        background: var(--admin-panel-raised);
        border: 1px solid var(--admin-border);
        color: var(--admin-text);
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

      .refund-summary-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .refund-summary-grid div {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-radius: 8px;
        min-width: 0;
        padding: 0.8rem;
      }

      .refund-summary-grid code,
      .refund-summary-grid strong {
        display: block;
        min-width: 0;
      }

      .refund-summary-grid > div > span {
        color: var(--admin-muted);
        font-size: 0.78rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      .refund-summary-grid strong,
      .refund-summary-grid code {
        color: var(--admin-text);
        font-size: 0.9rem;
        margin-top: 0.3rem;
        overflow-wrap: anywhere;
      }

      .refund-history-list {
        display: grid;
        gap: 0.75rem;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .refund-history-list li {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-left: 0.28rem solid var(--admin-border);
        border-radius: 8px;
        padding: 0.8rem 0.9rem;
      }

      .refund-history-requested {
        background: #3c3221;
        border-left-color: var(--admin-border);
      }

      .refund-history-processing {
        background: var(--admin-panel-raised);
        border-left-color: var(--admin-border);
      }

      .refund-history-completed {
        background: var(--admin-panel-raised);
        border-left-color: var(--admin-border);
      }

      .refund-history-failed {
        background: var(--admin-panel-raised);
        border-left-color: var(--admin-border);
      }

      .refund-history-not-requested {
        background: var(--admin-panel);
        border-left-color: var(--admin-border);
      }

      .audit-list time {
        color: var(--admin-muted);
        font-size: 0.82rem;
        font-weight: 800;
      }

      .refund-history-list time {
        color: var(--admin-muted);
        font-size: 0.82rem;
        font-weight: 800;
      }

      .audit-list p {
        margin: 0.15rem 0;
      }

      .refund-history-list p {
        font-weight: 800;
        margin: 0.15rem 0;
      }

      .preserve-lines {
        white-space: pre-wrap;
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
        .refund-summary-grid,
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
  readonly sponsorOverview = viewChild(AdminSponsorDetailOverviewComponent);
  private readonly i18n = inject(FundingI18nService);
  private readonly confirmation = inject(AdminConfirmationService);
  readonly inspection = inject(AdminInspectionService);
  private readonly admin = inject(FundingAdminService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
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
  readonly sponsorMedia = signal<Record<string, readonly SponsorMediaAsset[]>>(
    {}
  );
  readonly sponsorMediaPreviewUrls = signal<Record<string, string>>({});
  readonly sponsorMediaMessages = signal<Record<string, string>>({});
  readonly search = signal<string>('');
  readonly reviewFilter = signal<SponsorshipReviewFilter>('all');
  readonly feedFilter = signal<SponsorFeedStatusFilter>('all');
  readonly paymentFilter = signal<SponsorPaymentStatusFilter>('all');
  readonly assistantRefresh = signal(0);
  readonly progress = signal<AdminSponsorshipProgress | null>(null);
  readonly versionConflict = signal(false);
  private readonly router = inject(Router);

  private loadGeneration = 0;
  private routeInitialized = false;
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
  readonly feedStatusOptions = computed<
    readonly AdminSponsorFeedStatusOption[]
  >(() =>
    this.feedStatuses.map((status) => ({
      value: status,
      label: this.feedStatusLabel(status)
    }))
  );

  readonly totalPages = computed(() => this.pagination().totalPages);
  readonly normalizedPage = computed(() => this.pagination().page);
  readonly paginatedSponsorships = computed(() => this.sponsorships());
  readonly sponsorListRows = computed<readonly AdminSponsorListRow[]>(() =>
    this.paginatedSponsorships().map((sponsorship) => ({
      id: sponsorship.id,
      rowStateClass: this.sponsorshipRowStateClass(sponsorship),
      processingLabel: this.sponsorshipProcessingLabel(sponsorship),
      initials: this.initialsFor(sponsorship),
      companyName:
        sponsorship.sponsor_company_name ||
        this.i18n.t('admin.messages.entreprise_sans_nom'),
      contactEmail:
        sponsorship.sponsor_contact_email ||
        this.i18n.t('admin.messages.courriel_non_fourni'),
      amountLabel: this.formatMoney(sponsorship),
      tierClass: this.tierClass(sponsorship),
      tierLabel: this.sponsorshipTierLabel(sponsorship),
      reviewStatusClass: this.statusClass(sponsorship.sponsor_review_status),
      reviewStatusLabel: this.reviewStatusLabel(
        sponsorship.sponsor_review_status
      ),
      visibilityClass: this.visibilityClass(sponsorship),
      visibilityLabel: this.visibilityLabel(sponsorship),
      feedStatusClass: this.feedStatusClass(sponsorship.sponsor_feed_status),
      feedStatusLabel: this.feedStatusLabel(sponsorship.sponsor_feed_status),
      feedTargetLabel: this.feedTargetLabel(sponsorship),
      feedChannelsLabel: this.feedChannelsLabel(sponsorship),
      paymentStatusClass: this.paymentStatusClass(sponsorship.payment_status),
      paymentStatusLabel: this.paymentStatusLabel(sponsorship.payment_status),
      refundWorkflowStatusClass: this.hasRefundWorkflow(sponsorship)
        ? this.refundWorkflowStatusClass(sponsorship.sponsorship_refund_status)
        : null,
      refundWorkflowStatusLabel: this.hasRefundWorkflow(sponsorship)
        ? this.refundWorkflowStatusLabel(sponsorship.sponsorship_refund_status)
        : null,
      paidAtLabel: this.dateOnlyLabel(sponsorship.paid_at),
      submittedAtLabel: this.dateOnlyLabel(this.submittedAt(sponsorship))
    }))
  );
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
  readonly selectedSponsorDetailHeader =
    computed<AdminSponsorDetailHeaderView | null>(() => {
      const selected = this.selectedSponsorship();
      if (!selected) {
        return null;
      }

      const hasRefundWorkflow = this.hasRefundWorkflow(selected);

      return {
        initials: this.initialsFor(selected),
        companyName:
          selected.sponsor_company_name ||
          this.i18n.t('admin.messages.entreprise_sans_nom'),
        amountLabel: this.formatMoney(selected),
        tierLabel: this.sponsorshipTierLabel(selected),
        reviewStatusClass: this.statusClass(selected.sponsor_review_status),
        reviewStatusLabel: this.reviewStatusLabel(
          selected.sponsor_review_status
        ),
        visibilityClass: this.visibilityClass(selected),
        visibilityLabel: this.visibilityLabel(selected),
        paymentStatusClass: this.paymentStatusClass(selected.payment_status),
        paymentStatusLabel: this.paymentStatusLabel(selected.payment_status),
        refundWorkflowStatusClass: hasRefundWorkflow
          ? this.refundWorkflowStatusClass(selected.sponsorship_refund_status)
          : null,
        refundWorkflowStatusLabel: hasRefundWorkflow
          ? this.refundWorkflowStatusLabel(selected.sponsorship_refund_status)
          : null,
        publicReferenceLabel:
          selected.public_reference ||
          this.i18n.t('admin.legacy.non_attribuee_175'),
        submittedAtLabel: this.dateOnlyLabel(this.submittedAt(selected)),
        reviewedAtLabel: this.dateOnlyLabel(selected.sponsor_reviewed_at)
      };
    });
  readonly selectedSponsorDetailOverview =
    computed<AdminSponsorDetailOverviewView | null>(() => {
      const selected = this.selectedSponsorship();
      if (!selected) {
        return null;
      }

      return {
        companyName:
          selected.sponsor_company_name ||
          this.i18n.t('admin.messages.entreprise_sans_nom'),
        publicNameLabel: this.publicNameLabel(selected),
        contactName:
          selected.sponsor_contact_name ||
          this.i18n.t('admin.legacy.non_fourni'),
        contactEmail: selected.sponsor_contact_email || null,
        websiteUrl: selected.sponsor_website_url || null,
        publicReference: selected.public_reference || null,
        copyMessage: this.copyMessageFor(selected.id),
        amountLabel: this.formatMoney(selected),
        tierClass: this.tierClass(selected),
        tierLabel: this.sponsorshipTierLabel(selected),
        benefitsLabel: this.sponsorshipBenefitsLabel(selected),
        paymentStatusClass: this.paymentStatusClass(selected.payment_status),
        paymentStatusLabel: this.paymentStatusLabel(selected.payment_status),
        refundStatusClass: this.refundWorkflowStatusClass(
          selected.sponsorship_refund_status
        ),
        refundStatusLabel: this.refundWorkflowStatusLabel(
          selected.sponsorship_refund_status
        ),
        hasRefundWorkflow: this.hasRefundWorkflow(selected),
        refundWorkflowTimelineLabel: this.refundWorkflowTimelineLabel(selected),
        refundId: selected.sponsorship_refund_id || null,
        paidAtLabel: this.dateOnlyLabel(selected.paid_at),
        sponsorMessage: selected.sponsor_message || null,
        reviewNote: this.reviewNoteFor(selected.id),
        reviewNoteDirty: this.isReviewNoteDirty(selected),
        reviewNoteStateLabel: this.reviewNoteStateLabel(selected),
        reviewNoteSaving: this.isActionPending(this.noteActionId(selected.id))
      };
    });
  readonly selectedSponsorDetailIdentity =
    computed<AdminSponsorDetailIdentityView | null>(() => {
      const selected = this.selectedSponsorship();
      if (!selected) {
        return null;
      }

      const logoBusy =
        this.isActionPending(this.logoActionId(selected.id)) ||
        this.isActionPending(this.deleteLogoActionId(selected.id));
      const mediaBusy = this.actionState()?.startsWith('media:') ?? false;
      const mediaAssets = (this.sponsorMedia()[selected.id] ?? []).map(
        (asset) => ({
          id: asset.id,
          version: asset.version,
          kindLabel:
            asset.kind === 'logo'
              ? this.i18n.t('admin.messages.logo_propose')
              : this.i18n.t('admin.messages.photo_de_presentation'),
          reviewStatus: asset.reviewStatus,
          reviewStatusLabel: this.sponsorMediaStatusLabel(asset.reviewStatus),
          previewSource: this.sponsorMediaPreviewUrls()[asset.id] ?? null,
          altText: asset.altText ?? '',
          dimensionsLabel: `${asset.width} x ${asset.height} px`,
          sizeLabel: this.formatMediaSize(asset.processedSizeBytes)
        })
      );

      return {
        companyName:
          selected.sponsor_company_name ||
          this.i18n.t('admin.messages.entreprise_sans_nom'),
        logoPreviewSource: this.logoPreviewSourceFor(selected) || null,
        logoUrl: selected.sponsor_logo_url || null,
        publicNameLabel: this.publicNameLabel(selected),
        websiteUrl: selected.sponsor_website_url || null,
        logoActionLabel: selected.sponsor_logo_url
          ? this.i18n.t('admin.messages.remplacer_le_logo')
          : this.i18n.t('admin.messages.televerser_un_logo'),
        uploadDisabled: logoBusy,
        deleteDisabled: !selected.sponsor_logo_url || logoBusy,
        statusMessage:
          this.logoUploadMessageFor(selected.id) ||
          this.i18n.t(
            'admin.messages.formats_acceptes_png_jpeg_ou_webp_max_512_kib'
          ),
        mediaAssets,
        mediaMessage:
          this.sponsorMediaMessages()[selected.id] ??
          this.i18n.t(
            'admin.messages.les_decisions_media_sont_independantes_de_la_revue_de_la_commandite'
          ),
        mediaBusy,
        approvableMediaCount: mediaAssets.filter(
          (asset) => asset.reviewStatus !== 'approved'
        ).length
      };
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
          item.public_display_consent
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
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const sponsorshipId = params.get('sponsorshipId')?.trim() || null;
        const tab = params.get('tab') as SponsorDetailsTab;
        this.activeTab.set(
          [
            'overview',
            'identity',
            'media',
            'publication',
            'billing',
            'refund',
            'audit'
          ].includes(tab)
            ? tab
            : 'overview'
        );
        if (
          this.routeInitialized &&
          sponsorshipId === this.selectedSponsorshipId()
        )
          return;
        const alreadyLoaded = this.sponsorships().some(
          (item) => item.id === sponsorshipId
        );
        this.selectedSponsorshipId.set(sponsorshipId);
        this.admin.selectSponsorship(sponsorshipId);
        if (this.routeInitialized && (!sponsorshipId || alreadyLoaded)) {
          void this.loadSponsorMedia(sponsorshipId);
          return;
        }
        this.routeInitialized = true;
        this.search.set(sponsorshipId ?? '');
        this.page.set(1);
        void this.loadSponsorships();
      });
  }

  ngOnDestroy(): void {
    this.revokeLogoPreviews();
    this.revokeSponsorMediaPreviews();
    this.clearReviewMessageTimers();
    this.clearSelectionPulseTimer();
  }

  async loadSponsorships(): Promise<void> {
    const generation = ++this.loadGeneration;
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
      if (generation !== this.loadGeneration || this.destroyRef.destroyed)
        return;
      this.versionConflict.set(false);
      this.sponsorships.set(sponsorships);
      this.assistantRefresh.update((value) => value + 1);
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
        !sponsorships.some((item) => item.id === this.selectedSponsorshipId())
      ) {
        const directId = this.route.snapshot.queryParamMap.get('sponsorshipId');
        this.selectedSponsorshipId.set(
          directId && this.search() === directId
            ? null
            : (sponsorships[0]?.id ?? null)
        );
      }
      if (this.selectedSponsorshipId())
        this.admin.selectSponsorship(this.selectedSponsorshipId());
      void this.admin.refreshWorkQueue();
      this.state.set('ready');
      this.saveToken();
      void this.loadLogoPreviews(sponsorships);
      void this.loadSponsorMedia(this.selectedSponsorshipId());
    } catch (error) {
      if (generation !== this.loadGeneration || this.destroyRef.destroyed)
        return;
      this.sponsorships.set([]);
      this.progress.set(null);
      this.messageFromError(error, '');
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
          this.i18n.t(
            'admin.messages.action_impossible_le_paiement_n_est_pas_admissible'
          ),
        true
      );
      return;
    }

    const reviewNote = this.reviewNoteFor(sponsorship.id).trim();

    if (
      reviewStatus === 'pending_review' &&
      sponsorship.sponsor_review_status !== 'pending_review' &&
      !(await this.confirmation.confirm(
        this.i18n.t('admin.messages.remettre_ce_dossier_en_attente')
      ))
    ) {
      return;
    }

    this.actionState.set(this.reviewActionId(sponsorship.id));
    this.setReviewMessage(
      sponsorship.id,
      this.i18n.t('admin.messages.action_en_cours_p0', {
        p0: this.reviewActionName(reviewStatus)
      })
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
          this.i18n.t(
            'admin.messages.action_impossible_la_revue_n_a_pas_pu_etre_enregistree'
          )
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
      this.i18n.t(
        'admin.messages.completez_la_raison_le_message_et_le_traitement_du_remboursement'
      )
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
      return this.i18n.t('admin.messages.raison_interne_obligatoire');
    }

    if (draft.notifySponsor && !this.isValidEmailDraft(draft.recipientEmail)) {
      return this.i18n.t('admin.messages.destinataire_courriel_requis');
    }

    if (draft.notifySponsor && !draft.sponsorMessage.trim()) {
      return this.i18n.t('admin.messages.message_au_commanditaire_obligatoire');
    }

    return draft.notifySponsor
      ? this.i18n.t('admin.messages.pret_a_refuser_et_envoyer_le_courriel')
      : this.i18n.t('admin.messages.pret_a_refuser_sans_courriel');
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
    this.setReviewMessage(
      sponsorship.id,
      this.i18n.t('admin.messages.action_en_cours_refus')
    );

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
          this.rejectionRefundResultLabel(
            result.refundHandling,
            result.refundWorkflowStatus
          )
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
          this.i18n.t(
            'admin.messages.action_impossible_le_refus_n_a_pas_pu_etre_enregistre'
          )
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
      this.i18n.t(
        'admin.messages.recopiez_p0_pour_confirmer_le_remboursement_stripe',
        { p0: this.refundConfirmationText(sponsorship) }
      )
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
      | 'confirmationText'
      | 'refundAmount'
      | 'recipientEmail'
      | 'sponsorMessage'
      | 'refundNote',
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

  setRefundDraftReason(id: string, event: Event): void {
    const input = event.target as HTMLSelectElement;
    const value = input.value as AdminSponsorshipStripeRefundReason;
    this.refundDrafts.update((drafts) => {
      const current = drafts[id] ?? this.emptyRefundDraft();
      return {
        ...drafts,
        [id]: {
          ...current,
          refundReason: value
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
    return (
      sponsorship.payment_status === 'paid' &&
      sponsorship.sponsorship_refund_status !== 'processing' &&
      !(
        sponsorship.sponsorship_refund_status === 'completed' &&
        !sponsorship.sponsorship_refund_id
      )
    );
  }

  refundConfirmationText(sponsorship: AdminSponsorshipRecord): string {
    return sponsorship.public_reference || sponsorship.id;
  }

  refundAmountFor(sponsorship: AdminSponsorshipRecord): number | null {
    const value = this.refundDraftFor(sponsorship)
      .refundAmount.trim()
      .replace(',', '.');
    if (!value) {
      return null;
    }

    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
      return null;
    }

    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      return null;
    }

    return amount;
  }

  refundDraftAmountLabel(sponsorship: AdminSponsorshipRecord): string {
    const amount = this.refundAmountFor(sponsorship);
    return amount
      ? this.formatAmount(amount, sponsorship.currency)
      : 'montant invalide';
  }

  isFullRefundDraft(sponsorship: AdminSponsorshipRecord): boolean {
    const amount = this.refundAmountFor(sponsorship);
    return (
      amount !== null &&
      Math.round(amount * 100) === Math.round(sponsorship.amount * 100)
    );
  }

  canConfirmRefund(sponsorship: AdminSponsorshipRecord): boolean {
    const draft = this.refundDraftFor(sponsorship);
    const refundAmount = this.refundAmountFor(sponsorship);
    return (
      this.canRefundSponsorship(sponsorship) &&
      refundAmount !== null &&
      refundAmount > 0 &&
      refundAmount <= sponsorship.amount &&
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
      if (sponsorship.sponsorship_refund_status === 'completed') {
        return this.i18n.t(
          'admin.messages.remboursement_manuel_deja_marque_comme_complete'
        );
      }

      if (sponsorship.sponsorship_refund_status === 'processing') {
        return this.i18n.t('admin.messages.un_remboursement_est_deja_en_cours');
      }

      return this.i18n.t(
        'admin.messages.remboursement_stripe_disponible_seulement_pour_un_paiement_paye'
      );
    }

    const refundAmount = this.refundAmountFor(sponsorship);
    if (refundAmount === null || refundAmount <= 0) {
      return this.i18n.t('admin.messages.montant_de_remboursement_obligatoire');
    }

    if (refundAmount > sponsorship.amount) {
      return this.i18n.t('admin.messages.montant_maximum_p0', {
        p0: this.formatMoney(sponsorship)
      });
    }

    if (!draft.confirmationText.trim()) {
      return this.i18n.t('admin.messages.texte_de_confirmation_obligatoire');
    }

    if (
      draft.confirmationText.trim() !== this.refundConfirmationText(sponsorship)
    ) {
      return this.i18n.t(
        'admin.messages.le_texte_ne_correspond_pas_a_la_reference_demandee'
      );
    }

    if (draft.notifySponsor && !this.isValidEmailDraft(draft.recipientEmail)) {
      return this.i18n.t('admin.messages.destinataire_courriel_requis');
    }

    if (draft.notifySponsor && !draft.sponsorMessage.trim()) {
      return this.i18n.t('admin.messages.message_au_commanditaire_obligatoire');
    }

    const refundType = this.isFullRefundDraft(sponsorship)
      ? this.i18n.t('admin.messages.complet')
      : this.i18n.t('admin.messages.partiel');
    return draft.notifySponsor
      ? this.i18n.t(
          'admin.messages.pret_a_declencher_le_remboursement_p0_et_envoyer_le_courriel',
          { p0: refundType }
        )
      : this.i18n.t(
          'admin.messages.pret_a_declencher_le_remboursement_stripe_p0',
          { p0: refundType }
        );
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
    this.setReviewMessage(
      sponsorship.id,
      this.i18n.t('admin.messages.remboursement_stripe_en_cours')
    );

    try {
      const result = await this.admin.refundSponsorship(this.adminToken(), {
        contributionId: sponsorship.id,
        expectedVersion: sponsorship.version,
        confirmationText: draft.confirmationText.trim(),
        amount: this.refundAmountFor(sponsorship) ?? sponsorship.amount,
        refundReason: draft.refundReason,
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
          this.i18n.t(
            'admin.messages.action_impossible_le_remboursement_stripe_n_a_pas_pu_etre_cree'
          )
        ),
        true
      );
    } finally {
      this.actionState.set(null);
    }
  }

  async saveReviewNote(sponsorship: AdminSponsorshipRecord): Promise<void> {
    if (this.actionState()) return;
    this.actionState.set(this.noteActionId(sponsorship.id));
    this.setNoteMessage(
      sponsorship.id,
      this.i18n.t('admin.messages.enregistrement_en_cours')
    );

    try {
      await this.admin.reviewSponsorship(this.adminToken(), {
        contributionId: sponsorship.id,
        reviewStatus: sponsorship.sponsor_review_status,
        reviewNote: this.reviewNoteFor(sponsorship.id).trim() || undefined,
        expectedVersion: sponsorship.version
      });
      await this.loadSponsorships();
      this.setNoteMessage(
        sponsorship.id,
        this.i18n.t('admin.messages.note_enregistree_')
      );
    } catch (error) {
      this.setNoteMessage(
        sponsorship.id,
        this.messageFromError(
          error,
          this.i18n.t('admin.messages.la_note_n_a_pas_pu_etre_enregistree')
        )
      );
    } finally {
      this.actionState.set(null);
    }
  }

  async savePublication(sponsorship: AdminSponsorshipRecord): Promise<void> {
    if (this.actionState()) return;
    const draft = this.publicationDraftFor(sponsorship.id);
    const slugError = this.slugErrorFor(sponsorship);
    if (!this.publicationDirtyFor(sponsorship) || slugError) {
      this.setPublicationMessage(
        sponsorship.id,
        slugError ||
          this.i18n.t('admin.messages.aucune_modification_a_enregistrer')
      );
      return;
    }

    if (!this.canSavePublication(sponsorship)) {
      this.setPublicationMessage(
        sponsorship.id,
        this.paymentEligibilityMessage(sponsorship) ||
          this.i18n.t(
            'admin.messages.publication_bloquee_le_paiement_n_est_pas_admissible'
          )
      );
      return;
    }

    if (
      draft.feedStatus !== sponsorship.sponsor_feed_status &&
      (draft.feedStatus === 'published' ||
        sponsorship.sponsor_feed_status === 'published')
    ) {
      if (
        !(await this.confirmation.confirm(
          this.i18n.t(
            draft.feedStatus === 'published'
              ? 'admin.confirmation.publish'
              : 'admin.confirmation.cancelPublication'
          ),
          sponsorship.public_reference ?? sponsorship.id
        ))
      )
        return;
    }
    this.actionState.set(this.publicationActionId(sponsorship.id));
    this.setPublicationMessage(
      sponsorship.id,
      this.i18n.t('admin.messages.enregistrement_en_cours')
    );

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
      this.setPublicationMessage(
        sponsorship.id,
        this.i18n.t('admin.messages.publication_enregistree_')
      );
    } catch (error) {
      this.setPublicationMessage(
        sponsorship.id,
        this.messageFromError(
          error,
          this.i18n.t(
            'admin.messages.les_donnees_de_publication_n_ont_pas_pu_etre_enregistrees'
          )
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
        this.i18n.t('admin.messages.logo_refuse_png_jpeg_ou_webp_max_512_kib')
      );
      if (input) {
        input.value = '';
      }
      return;
    }

    this.actionState.set(this.logoActionId(sponsorship.id));
    this.setLogoUploadMessage(
      sponsorship.id,
      this.i18n.t('admin.messages.upload_en_cours')
    );

    try {
      const result = await this.admin.uploadSponsorLogo(
        this.adminToken(),
        sponsorship.id,
        sponsorship.version,
        file
      );
      this.setLogoUploadMessage(
        sponsorship.id,
        this.i18n.t('admin.messages.logo_enregistre_p0_kib', {
          p0: Math.ceil(result.sizeBytes / 1024)
        })
      );
      await this.loadSponsorships();
    } catch (error) {
      this.setLogoUploadMessage(
        sponsorship.id,
        this.messageFromError(
          error,
          this.i18n.t('admin.messages.upload_du_logo_impossible')
        )
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
      !(await this.confirmation.confirm(
        this.i18n.t('admin.messages.supprimer_ce_logo_commanditaire')
      ))
    ) {
      return;
    }

    this.actionState.set(this.deleteLogoActionId(sponsorship.id));
    this.setLogoUploadMessage(
      sponsorship.id,
      this.i18n.t('admin.messages.suppression_en_cours')
    );

    try {
      await this.admin.deleteSponsorLogo(
        this.adminToken(),
        sponsorship.id,
        sponsorship.version
      );
      this.setLogoUploadMessage(
        sponsorship.id,
        this.i18n.t('admin.messages.logo_supprime')
      );
      await this.loadSponsorships();
    } catch (error) {
      this.setLogoUploadMessage(
        sponsorship.id,
        this.messageFromError(
          error,
          this.i18n.t('admin.messages.suppression_du_logo_impossible')
        )
      );
    } finally {
      this.actionState.set(null);
    }
  }

  async reviewSponsorMedia(
    sponsorship: AdminSponsorshipRecord,
    event: AdminSponsorMediaReviewEvent
  ): Promise<void> {
    if (
      event.reviewStatus === 'rejected' &&
      !(await this.confirmation.confirm(
        this.i18n.t('admin.messages.refuser_ce_media_commanditaire')
      ))
    ) {
      return;
    }
    this.actionState.set(this.sponsorMediaActionId(event.assetId));
    this.setSponsorMediaMessage(
      sponsorship.id,
      this.i18n.t('admin.messages.decision_en_cours')
    );
    try {
      await this.saveSponsorMediaReview(event);
      await this.loadSponsorMedia(sponsorship.id);
      this.setSponsorMediaMessage(
        sponsorship.id,
        event.reviewStatus === 'approved'
          ? this.i18n.t(
              'admin.messages.media_approuve_il_sera_visible_seulement_lorsque_la_commandite_publique_est_admissible'
            )
          : this.i18n.t(
              'admin.messages.media_refuse_le_fichier_public_a_ete_retire'
            )
      );
    } catch (error) {
      this.setSponsorMediaMessage(
        sponsorship.id,
        this.messageFromError(
          error,
          this.i18n.t(
            'admin.messages.la_decision_sur_ce_media_n_a_pas_pu_etre_enregistree'
          )
        )
      );
    } finally {
      this.actionState.set(null);
    }
  }

  async approveAllSponsorMedia(
    sponsorship: AdminSponsorshipRecord
  ): Promise<void> {
    const media = (this.sponsorMedia()[sponsorship.id] ?? []).filter(
      (asset) => asset.reviewStatus !== 'approved'
    );
    if (media.length === 0) {
      this.setSponsorMediaMessage(
        sponsorship.id,
        this.i18n.t('admin.messages.tous_les_medias_sont_deja_approuves')
      );
      return;
    }

    this.actionState.set(this.sponsorMediaBulkActionId(sponsorship.id));
    this.setSponsorMediaMessage(
      sponsorship.id,
      this.i18n.t('admin.messages.approbation_de_p0_media_p1_en_cours', {
        p0: media.length,
        p1: media.length > 1 ? 's' : ''
      })
    );

    let approvedCount = 0;
    try {
      for (const asset of media) {
        await this.saveSponsorMediaReview({
          assetId: asset.id,
          expectedVersion: asset.version,
          reviewStatus: 'approved',
          altText: asset.altText ?? ''
        });
        approvedCount += 1;
      }
      await this.loadSponsorMedia(sponsorship.id);
      this.setSponsorMediaMessage(
        sponsorship.id,
        this.i18n.t(
          'admin.messages.p0_media_p1_approuve_p2_la_visibilite_publique_reste_controlee_par_le_statut_de_la_commandite',
          {
            p0: approvedCount,
            p1: approvedCount > 1 ? 's' : '',
            p2: approvedCount > 1 ? 's' : ''
          }
        )
      );
    } catch (error) {
      await this.loadSponsorMedia(sponsorship.id);
      this.setSponsorMediaMessage(
        sponsorship.id,
        this.messageFromError(
          error,
          this.i18n.t(
            'admin.messages.p0_media_p1_approuve_p2_l_approbation_groupee_s_est_interrompue',
            {
              p0: approvedCount,
              p1: approvedCount > 1 ? 's' : '',
              p2: approvedCount > 1 ? 's' : ''
            }
          )
        )
      );
    } finally {
      this.actionState.set(null);
    }
  }

  private async saveSponsorMediaReview(
    event: AdminSponsorMediaReviewEvent
  ): Promise<void> {
    const altText = event.altText.trim();
    await this.admin.reviewSponsorMedia(this.adminToken(), {
      assetId: event.assetId,
      expectedVersion: event.expectedVersion,
      reviewStatus: event.reviewStatus,
      altText: altText || undefined
    });
  }

  async deleteSponsorMedia(
    sponsorship: AdminSponsorshipRecord,
    event: AdminSponsorMediaDeleteEvent
  ): Promise<void> {
    if (
      !(await this.confirmation.confirm(
        this.i18n.t(
          'admin.messages.supprimer_ce_media_y_compris_ses_copies_privee_et_publique'
        )
      ))
    ) {
      return;
    }
    this.actionState.set(this.sponsorMediaActionId(event.assetId));
    this.setSponsorMediaMessage(
      sponsorship.id,
      this.i18n.t('admin.messages.suppression_en_cours')
    );
    try {
      await this.admin.deleteSponsorMedia(this.adminToken(), {
        assetId: event.assetId,
        expectedVersion: event.expectedVersion,
        confirmation: event.assetId
      });
      await this.loadSponsorMedia(sponsorship.id);
      this.setSponsorMediaMessage(
        sponsorship.id,
        this.i18n.t('admin.messages.media_supprime')
      );
    } catch (error) {
      this.setSponsorMediaMessage(
        sponsorship.id,
        this.messageFromError(
          error,
          this.i18n.t('admin.messages.le_media_n_a_pas_pu_etre_supprime')
        )
      );
    } finally {
      this.actionState.set(null);
    }
  }

  setAdminToken(event: Event): void {
    this.adminToken.set(this.valueFromEvent(event));
    this.saveToken();
  }

  setSearchValue(value: string): void {
    this.search.set(value);
    this.page.set(1);
    void this.loadSponsorships();
  }

  setReviewFilterValue(value: string): void {
    this.reviewFilter.set(
      value === 'pending_review' || value === 'approved' || value === 'rejected'
        ? value
        : 'all'
    );
    this.page.set(1);
    void this.loadSponsorships();
  }

  setFeedFilterValue(value: string): void {
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

  setPaymentFilterValue(value: string): void {
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

  setPageSizeValue(value: number): void {
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

  selectSponsorshipById(id: string): void {
    this.selectedSponsorshipId.set(id);
    this.admin.selectSponsorship(id);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { sponsorshipId: id, tab: this.activeTab() },
      queryParamsHandling: 'merge'
    });
    void this.loadSponsorMedia(id);
    this.pulseSelection(id);
    this.scrollSelectedSponsorshipIntoView();
  }

  closeDetails(): void {
    this.selectedSponsorshipId.set(null);
    this.admin.selectSponsorship(null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { sponsorshipId: null, tab: null },
      queryParamsHandling: 'merge'
    });
    this.activeRejectionId.set(null);
    this.activeRefundId.set(null);
  }

  setActiveTab(tab: SponsorDetailsTab): void {
    this.activeTab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { sponsorshipId: this.selectedSponsorshipId(), tab },
      queryParamsHandling: 'merge'
    });
    if (tab === 'media') {
      void this.loadSponsorMedia(this.selectedSponsorshipId());
    }
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

  sponsorMediaActionId(id: string): string {
    return `media:${id}`;
  }

  sponsorMediaBulkActionId(id: string): string {
    return `media:all:${id}`;
  }

  sponsorMediaStatusLabel(status: SponsorMediaAsset['reviewStatus']): string {
    if (status === 'approved') {
      return this.i18n.t('admin.messages.approuve');
    }
    if (status === 'rejected') {
      return this.i18n.t('admin.messages.refuse');
    }
    return this.i18n.t('admin.legacy.en_attente');
  }

  formatMediaSize(bytes: number): string {
    return bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
      : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
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
    this.i18n.trackTranslationState();
    return this.i18n.t(
      sponsorship.public_display_consent
        ? 'admin.dossier.consentGranted'
        : 'admin.dossier.consentMissing'
    );
  }

  visibilityClass(sponsorship: AdminSponsorshipRecord): string {
    return sponsorship.public_display_consent
      ? 'visibility-badge visibility-visible'
      : 'visibility-badge visibility-hidden';
  }

  reviewActionName(status: SponsorshipReviewStatus): string {
    if (status === 'approved') {
      return this.i18n.t('admin.messages.acceptation');
    }

    if (status === 'rejected') {
      return this.i18n.t('admin.messages.refus');
    }

    return this.i18n.t('admin.messages.remise_en_attente');
  }

  reviewSuccessMessage(status: SponsorshipReviewStatus): string {
    if (status === 'approved') {
      return this.i18n.t('admin.messages.action_confirmee_commandite_acceptee');
    }

    if (status === 'rejected') {
      return this.i18n.t('admin.messages.action_confirmee_commandite_refusee');
    }

    return this.i18n.t(
      'admin.messages.action_confirmee_commandite_remise_en_attente'
    );
  }

  reviewStatusLabel(status: SponsorshipReviewStatus): string {
    if (status === 'approved') {
      return this.i18n.t('admin.messages.approuvee');
    }

    if (status === 'rejected') {
      return this.i18n.t('admin.messages.refusee');
    }

    return this.i18n.t('admin.legacy.en_attente');
  }

  feedStatusLabel(status: SponsorFeedStatus): string {
    if (status === 'published') {
      return this.i18n.t('admin.messages.publie');
    }

    if (status === 'drafted') {
      return this.i18n.t('admin.legacy.brouillon');
    }

    if (status === 'planned') {
      return this.i18n.t('admin.messages.planifie');
    }

    return this.i18n.t('admin.messages.non_planifie');
  }

  feedStatusClass(status: SponsorFeedStatus): string {
    return `feed-badge feed-${status}`;
  }

  sponsorshipProcessingState(
    sponsorship: AdminSponsorshipRecord
  ): SponsorProcessingState {
    const isBlocked =
      sponsorship.sponsor_review_status === 'rejected' ||
      sponsorship.sponsorship_refund_status === 'processing' ||
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
        return this.i18n.t('admin.messages.traitement_requis');
      case 'approved-ready':
        return 'Approuvee, publication a planifier';
      case 'publication-progress':
        return this.i18n.t('admin.messages.publication_en_preparation');
      case 'published':
        return this.i18n.t('admin.messages.publication_terminee');
      case 'blocked':
        return this.i18n.t('admin.messages.commandite_bloquee');
      case 'waiting-payment':
        return this.i18n.t('admin.messages.paiement_en_attente');
    }
  }

  feedTargetLabel(sponsorship: AdminSponsorshipRecord): string {
    if (sponsorship.sponsor_feed_target === 'openg7') {
      return 'OpenG7';
    }

    if (sponsorship.sponsor_feed_target === 'openg20') {
      return 'OpenG20';
    }

    return this.i18n.t('admin.legacy.aucune');
  }

  feedChannelsLabel(sponsorship: AdminSponsorshipRecord): string {
    if (sponsorship.sponsor_feed_channels.length === 0) {
      return this.i18n.t('admin.messages.aucun_canal');
    }

    return sponsorship.sponsor_feed_channels
      .map((channel) =>
        channel === 'linkedin'
          ? 'LinkedIn'
          : this.i18n.t('admin.messages.facebook')
      )
      .join(' / ');
  }

  draftChannelsLabel(id: string): string {
    const draft = this.publicationDraftFor(id);
    const channels = [
      ...(draft.facebook ? [this.i18n.t('admin.messages.facebook')] : []),
      ...(draft.linkedin ? ['LinkedIn'] : [])
    ];

    return channels.length > 0
      ? channels.join(' / ')
      : this.i18n.t('admin.messages.aucun_canal');
  }

  statusClass(status: SponsorshipReviewStatus): string {
    return `status-badge status-${status.replace('_review', '')}`;
  }

  paymentStatusLabel(status: string): string {
    if (status === 'paid') {
      return this.i18n.t('admin.legacy.paye');
    }

    if (status === 'refunded') {
      return this.i18n.t('admin.legacy.rembourse');
    }

    if (status === 'disputed') {
      return this.i18n.t('admin.legacy.litige');
    }

    if (status === 'failed') {
      return this.i18n.t('admin.messages.echec_de_paiement');
    }

    return this.i18n.t('admin.legacy.en_attente');
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

  hasRefundWorkflow(sponsorship: AdminSponsorshipRecord): boolean {
    return sponsorship.sponsorship_refund_status !== 'not_requested';
  }

  refundWorkflowStatusLabel(
    status: AdminSponsorshipRefundWorkflowStatus
  ): string {
    if (status === 'requested') {
      return this.i18n.t('admin.messages.remboursement_demande');
    }

    if (status === 'processing') {
      return this.i18n.t('admin.messages.remboursement_en_cours');
    }

    if (status === 'completed') {
      return this.i18n.t('admin.messages.remboursement_complete_');
    }

    if (status === 'failed') {
      return this.i18n.t('admin.messages.remboursement_en_echec_');
    }

    return this.i18n.t('admin.messages.aucun_remboursement_demande_');
  }

  stripeRefundReasonLabel(reason: AdminSponsorshipStripeRefundReason): string {
    if (reason === 'duplicate') {
      return this.i18n.t('admin.legacy.paiement_en_double');
    }

    if (reason === 'fraudulent') {
      return this.i18n.t('admin.legacy.paiement_frauduleux');
    }

    return this.i18n.t('admin.legacy.demande_du_commanditaire');
  }

  refundWorkflowStatusClass(
    status: AdminSponsorshipRefundWorkflowStatus
  ): string {
    return `refund-badge refund-${status.replace('_', '-')}`;
  }

  refundWorkflowTimelineLabel(sponsorship: AdminSponsorshipRecord): string {
    if (sponsorship.sponsorship_refund_status === 'completed') {
      return this.i18n.t('admin.messages.complete_le_p0', {
        p0: this.dateOnlyLabel(sponsorship.sponsorship_refund_completed_at)
      });
    }

    if (sponsorship.sponsorship_refund_status === 'processing') {
      return this.i18n.t('admin.messages.en_cours_depuis_p0', {
        p0: this.dateOnlyLabel(
          sponsorship.sponsorship_refund_processed_at ??
            sponsorship.sponsorship_refund_requested_at
        )
      });
    }

    if (sponsorship.sponsorship_refund_status === 'requested') {
      return this.i18n.t('admin.messages.demande_le_p0', {
        p0: this.dateOnlyLabel(sponsorship.sponsorship_refund_requested_at)
      });
    }

    if (sponsorship.sponsorship_refund_status === 'failed') {
      return sponsorship.sponsorship_refund_error
        ? `Echec: ${sponsorship.sponsorship_refund_error}`
        : this.i18n.t('admin.messages.derniere_tentative_en_echec');
    }

    return this.i18n.t('admin.messages.aucun_remboursement_demande');
  }

  refundHistoryEntriesFor(
    sponsorship: AdminSponsorshipRecord
  ): SponsorRefundHistoryEntry[] {
    if (!this.hasRefundWorkflow(sponsorship)) {
      return [];
    }

    const entries: SponsorRefundHistoryEntry[] = [];
    const refundNote = sponsorship.sponsorship_refund_note?.trim();

    if (sponsorship.sponsorship_refund_requested_at) {
      entries.push({
        id: `${sponsorship.id}:refund-requested`,
        date: sponsorship.sponsorship_refund_requested_at,
        label: this.i18n.t(
          'admin.messages.demande_de_remboursement_enregistree'
        ),
        detail: refundNote
          ? this.i18n.t('admin.messages.note_p0', { p0: refundNote })
          : undefined,
        tone: 'requested'
      });
    }

    if (
      sponsorship.sponsorship_refund_processed_at &&
      ['processing', 'completed', 'failed'].includes(
        sponsorship.sponsorship_refund_status
      )
    ) {
      entries.push({
        id: `${sponsorship.id}:refund-processing`,
        date: sponsorship.sponsorship_refund_processed_at,
        label: this.i18n.t('admin.messages.traitement_du_remboursement_lance'),
        detail: this.refundProcessingDetail(sponsorship),
        tone: 'processing'
      });
    }

    if (sponsorship.sponsorship_refund_completed_at) {
      entries.push({
        id: `${sponsorship.id}:refund-completed`,
        date: sponsorship.sponsorship_refund_completed_at,
        label: this.i18n.t('admin.messages.remboursement_complete'),
        detail: this.refundCompletionDetail(sponsorship),
        tone: 'completed'
      });
    }

    if (sponsorship.sponsorship_refund_status === 'failed') {
      entries.push({
        id: `${sponsorship.id}:refund-failed`,
        date: this.refundHistoryFallbackDate(sponsorship),
        label: this.i18n.t('admin.messages.remboursement_en_echec'),
        detail:
          sponsorship.sponsorship_refund_error ||
          this.i18n.t(
            'admin.messages.consultez_stripe_et_le_journal_admin_avant_de_relancer'
          ),
        tone: 'failed'
      });
    }

    if (entries.length === 0) {
      entries.push({
        id: `${sponsorship.id}:refund-current`,
        date: sponsorship.updated_at,
        label: this.refundWorkflowStatusLabel(
          sponsorship.sponsorship_refund_status
        ),
        detail: this.i18n.t(
          'admin.messages.aucun_horodatage_detaille_expose_pour_ce_statut'
        ),
        tone: sponsorship.sponsorship_refund_status
      });
    }

    return entries.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }

  trackByRefundHistoryEntry(
    _: number,
    entry: SponsorRefundHistoryEntry
  ): string {
    return entry.id;
  }

  refundHistoryEntryClass(entry: SponsorRefundHistoryEntry): string {
    return `refund-history-${entry.tone.replace('_', '-')}`;
  }

  refundAuditEntriesFor(
    sponsorship: AdminSponsorshipRecord
  ): SponsorAuditEntry[] {
    return (sponsorship.admin_audit_entries ?? [])
      .filter((entry) => this.isRefundAuditEntry(entry))
      .map((entry) => ({
        id: entry.id,
        date: entry.created_at,
        label: this.adminAuditLabel(entry),
        detail: this.adminAuditDetail(entry)
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private refundProcessingDetail(sponsorship: AdminSponsorshipRecord): string {
    const details = [this.i18n.t('admin.messages.statut_traitement_en_cours')];

    if (sponsorship.sponsorship_refund_amount) {
      details.push(
        this.i18n.t('admin.messages.montant_p0', {
          p0: this.formatAmount(
            sponsorship.sponsorship_refund_amount,
            sponsorship.currency
          )
        })
      );
    }

    if (sponsorship.sponsorship_refund_reason) {
      details.push(
        this.i18n.t('admin.messages.raison_p0', {
          p0: this.stripeRefundReasonLabel(
            sponsorship.sponsorship_refund_reason
          )
        })
      );
    }

    if (sponsorship.sponsorship_refund_id) {
      details.push(
        this.i18n.t('admin.messages.refund_stripe_p0', {
          p0: sponsorship.sponsorship_refund_id
        })
      );
    }

    if (sponsorship.sponsorship_refund_note) {
      details.push(
        this.i18n.t('admin.messages.note_p0', {
          p0: sponsorship.sponsorship_refund_note
        })
      );
    }

    return details.join(' - ');
  }

  private refundCompletionDetail(sponsorship: AdminSponsorshipRecord): string {
    const details = [
      this.i18n.t('admin.messages.paiement_p0', {
        p0: this.paymentStatusLabel(sponsorship.payment_status)
      })
    ];

    if (sponsorship.sponsorship_refund_amount) {
      details.push(
        this.i18n.t('admin.messages.montant_p0', {
          p0: this.formatAmount(
            sponsorship.sponsorship_refund_amount,
            sponsorship.currency
          )
        })
      );
    }

    if (sponsorship.sponsorship_refund_reason) {
      details.push(
        this.i18n.t('admin.messages.raison_p0', {
          p0: this.stripeRefundReasonLabel(
            sponsorship.sponsorship_refund_reason
          )
        })
      );
    }

    if (sponsorship.sponsorship_refund_id) {
      details.push(
        this.i18n.t('admin.messages.refund_stripe_p0', {
          p0: sponsorship.sponsorship_refund_id
        })
      );
    }

    return details.join(' - ');
  }

  private refundHistoryFallbackDate(
    sponsorship: AdminSponsorshipRecord
  ): string {
    return (
      sponsorship.sponsorship_refund_processed_at ??
      sponsorship.sponsorship_refund_requested_at ??
      sponsorship.updated_at
    );
  }

  private isRefundAuditEntry(entry: AdminAuditLogEntry): boolean {
    if (
      entry.action === 'sponsorship_refund.stripe_full' ||
      entry.action === 'sponsorship_refund.stripe_partial'
    ) {
      return true;
    }

    if (!entry.action.startsWith('sponsorship_review.')) {
      return false;
    }

    const refundHandling = this.metadataString(entry, 'refundHandling');
    return (
      this.metadataString(entry, 'refundWorkflowStatus') !== null ||
      (refundHandling !== null && refundHandling !== 'none') ||
      this.metadataBoolean(entry, 'hasRefundNote') === true
    );
  }

  paymentEligibilityMessage(sponsorship: AdminSponsorshipRecord): string {
    if (sponsorship.sponsorship_refund_status === 'requested') {
      return this.i18n.t(
        'admin.messages.remboursement_demande_traitez_le_dossier_ou_lancez_le_remboursement_stripe_guide'
      );
    }

    if (sponsorship.sponsorship_refund_status === 'processing') {
      return this.i18n.t(
        'admin.messages.remboursement_en_cours_attendez_la_confirmation_stripe_avant_de_relancer'
      );
    }

    if (sponsorship.sponsorship_refund_status === 'completed') {
      return sponsorship.payment_status === 'refunded'
        ? this.i18n.t(
            'admin.messages.remboursement_complet_les_nouvelles_approbations_et_publications_publiques_sont_bloquees'
          )
        : this.i18n.t(
            'admin.messages.dernier_remboursement_complete_le_paiement_demeure_actif_pour_la_commandite'
          );
    }

    if (sponsorship.sponsorship_refund_status === 'failed') {
      return this.i18n.t(
        'admin.messages.derniere_tentative_de_remboursement_en_echec_le_remboursement_stripe_peut_etre_relance_apres_ve'
      );
    }

    if (sponsorship.payment_status === 'refunded') {
      return this.i18n.t(
        'admin.messages.paiement_rembourse_les_nouvelles_approbations_et_publications_publiques_sont_bloquees'
      );
    }

    if (sponsorship.payment_status === 'disputed') {
      return this.i18n.t(
        'admin.messages.paiement_conteste_la_visibilite_et_les_nouvelles_publications_sont_bloquees_jusqu_a_resolution'
      );
    }

    return '';
  }

  canApproveSponsorship(sponsorship: AdminSponsorshipRecord): boolean {
    return (
      (sponsorship.payment_status === 'paid' &&
        !['requested', 'processing'].includes(
          sponsorship.sponsorship_refund_status
        )) ||
      sponsorship.sponsor_review_status === 'approved'
    );
  }

  canSavePublication(sponsorship: AdminSponsorshipRecord): boolean {
    return (
      sponsorship.payment_status === 'paid' &&
      sponsorship.sponsorship_refund_status !== 'processing'
    );
  }

  formatMoney(sponsorship: AdminSponsorshipRecord): string {
    return `${new Intl.NumberFormat(this.i18n.currentLanguage(), {
      maximumFractionDigits: 0
    }).format(
      sponsorship.amount
    )} $ ${(sponsorship.currency || 'CAD').toUpperCase()}`;
  }

  formatSummaryMoney(amount: number): string {
    return `${new Intl.NumberFormat(this.i18n.currentLanguage(), {
      maximumFractionDigits: 0
    }).format(amount)} $ CAD`;
  }

  formatAmount(amount: number, currency: string): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
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
        return this.i18n.t('admin.messages.argent');
      case 'website_only':
        return this.i18n.t('admin.messages.bronze');
      default:
        return this.i18n.t('admin.messages.indetermine');
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
      return this.i18n.t(
        'admin.messages.aucun_avantage_montant_sous_le_minimum_de_commandite'
      );
    }

    const labels: Record<(typeof achievedBenefits)[number], string> = {
      website_mention: this.i18n.t('admin.messages.mention_openg7_org'),
      facebook_batch: this.i18n.t('admin.messages.lot_collectif_facebook'),
      linkedin_batch: this.i18n.t('admin.messages.lot_collectif_linkedin')
    };

    return achievedBenefits.map((benefit) => labels[benefit]).join(', ');
  }

  dateOnlyLabel(value: string | null): string {
    if (!value) {
      return this.i18n.t('admin.dashboard.notAvailable');
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return this.i18n.t('admin.dashboard.notAvailable');
    }

    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
      dateStyle: 'medium'
    }).format(date);
  }

  dateTimeLabel(value: string | null): string {
    if (!value) {
      return this.i18n.t('admin.dashboard.notAvailable');
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return this.i18n.t('admin.dashboard.notAvailable');
    }

    return new Intl.DateTimeFormat(this.i18n.currentLanguage(), {
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
      return this.i18n.t('admin.messages.non_consenti');
    }

    return sponsorship.public_name || 'Consenti, nom manquant';
  }

  rejectionNotificationResultLabel(
    result: AdminSponsorshipReviewResult
  ): string {
    if (!result.notification) {
      return this.i18n.t('admin.messages.aucun_courriel_envoye');
    }

    if (result.notification.sent) {
      return this.i18n.t('admin.messages.courriel_envoye_au_commanditaire');
    }

    if (result.notification.queued) {
      return this.i18n.t('admin.messages.courriel_mis_en_file');
    }

    return result.notification.error
      ? this.i18n.t('admin.messages.courriel_non_envoye_p0', {
          p0: result.notification.error
        })
      : this.i18n.t('admin.messages.courriel_non_envoye_');
  }

  rejectionRefundResultLabel(
    handling: AdminSponsorshipRejectionRefundHandling | undefined,
    workflowStatus?: AdminSponsorshipRefundWorkflowStatus
  ): string {
    const workflow = workflowStatus
      ? ` Suivi: ${this.refundWorkflowStatusLabel(workflowStatus)}.`
      : '';

    if (handling === 'manual_required') {
      return this.i18n.t(
        'admin.messages.remboursement_a_traiter_manuellement_p0',
        { p0: workflow }
      );
    }

    if (handling === 'manual_completed') {
      return this.i18n.t(
        'admin.messages.remboursement_marque_comme_deja_traite_p0',
        { p0: workflow }
      );
    }

    return '';
  }

  refundResultLabel(result: AdminSponsorshipRefundResult): string {
    const status = result.refundStatus
      ? this.i18n.t('admin.messages.statut_stripe_p0', {
          p0: result.refundStatus
        })
      : '';
    const refundType = result.fullRefund
      ? this.i18n.t('admin.messages.complet')
      : this.i18n.t('admin.messages.partiel');
    const reason = this.i18n.t('admin.messages.raison_p0', {
      p0: this.stripeRefundReasonLabel(result.refundReason)
    });
    const workflow = ` Suivi: ${this.refundWorkflowStatusLabel(
      result.refundWorkflowStatus
    )}.`;
    const localStatus = result.paymentStatusUpdated
      ? this.i18n.t('admin.messages.commandite_marquee_comme_remboursee')
      : '';
    const creditNote = result.creditNote
      ? this.i18n.t('admin.messages.avoir_cree_p0', {
          p0: result.creditNote.credit_note_number
        })
      : '';

    return this.i18n.t(
      'admin.messages.remboursement_stripe_p0_cree_p1_p2_p3_p4_p5_p6',
      {
        p0: refundType,
        p1: this.formatAmount(result.amount, result.currency),
        p2: reason,
        p3: status,
        p4: workflow,
        p5: localStatus,
        p6: creditNote
      }
    );
  }

  refundNotificationResultLabel(result: AdminSponsorshipRefundResult): string {
    if (!result.notification) {
      return '';
    }

    if (result.notification.sent) {
      return this.i18n.t(
        'admin.messages.courriel_de_remboursement_avoir_envoye'
      );
    }

    if (result.notification.queued) {
      return this.i18n.t(
        'admin.messages.courriel_de_remboursement_avoir_mis_en_file'
      );
    }

    return result.notification.error
      ? `Courriel de remboursement/avoir non envoye: ${result.notification.error}`
      : this.i18n.t(
          'admin.messages.courriel_de_remboursement_avoir_non_envoye'
        );
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
      ? this.i18n.t('admin.messages.modifications_non_enregistrees')
      : this.i18n.t('admin.messages.note_enregistree');
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
      ? this.i18n.t('admin.messages.modifications_non_enregistrees')
      : this.i18n.t('admin.messages.publication_enregistree');
  }

  slugErrorFor(sponsorship: AdminSponsorshipRecord): string {
    const slug = this.publicationDraftFor(sponsorship.id).publicSlug.trim();
    if (!slug) {
      return '';
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return this.i18n.t(
        'admin.messages.utilisez_seulement_des_lettres_chiffres_et_tirets'
      );
    }

    const duplicate = this.sponsorships().some(
      (item) =>
        item.id !== sponsorship.id &&
        this.normalizeSlug(item.sponsor_public_slug ?? '') === slug
    );

    return duplicate
      ? this.i18n.t('admin.messages.ce_slug_est_deja_utilise')
      : '';
  }

  hasSlugError(sponsorship: AdminSponsorshipRecord): boolean {
    return Boolean(this.slugErrorFor(sponsorship));
  }

  auditEntriesFor(sponsorship: AdminSponsorshipRecord): SponsorAuditEntry[] {
    const entries: SponsorAuditEntry[] = [];
    entries.push({
      id: `${sponsorship.id}:created`,
      date: sponsorship.created_at,
      label: this.i18n.t('admin.messages.reception_de_la_commandite')
    });

    if (sponsorship.paid_at) {
      entries.push({
        id: `${sponsorship.id}:paid`,
        date: sponsorship.paid_at,
        label: this.i18n.t('admin.messages.paiement_confirme'),
        detail: this.paymentStatusLabel(sponsorship.payment_status)
      });
    }

    if (sponsorship.sponsor_details_submitted_at) {
      entries.push({
        id: `${sponsorship.id}:details`,
        date: sponsorship.sponsor_details_submitted_at,
        label: this.i18n.t('admin.messages.details_commanditaire_recus')
      });
    }

    if (sponsorship.sponsor_reviewed_at) {
      entries.push({
        id: `${sponsorship.id}:reviewed`,
        date: sponsorship.sponsor_reviewed_at,
        label: this.i18n.t('admin.messages.statut_de_revue_p0', {
          p0: this.reviewStatusLabel(sponsorship.sponsor_review_status)
        })
      });
    }

    if (sponsorship.sponsor_visibility_updated_at) {
      entries.push({
        id: `${sponsorship.id}:visibility`,
        date: sponsorship.sponsor_visibility_updated_at,
        label: this.i18n.t(
          'admin.messages.donnees_de_publication_mises_a_jour'
        ),
        detail: this.feedStatusLabel(sponsorship.sponsor_feed_status)
      });
    }

    if (
      sponsorship.sponsorship_refund_status !== 'not_requested' &&
      sponsorship.sponsorship_refund_requested_at
    ) {
      entries.push({
        id: `${sponsorship.id}:refund-workflow`,
        date:
          sponsorship.sponsorship_refund_completed_at ??
          sponsorship.sponsorship_refund_processed_at ??
          sponsorship.sponsorship_refund_requested_at,
        label: this.refundWorkflowStatusLabel(
          sponsorship.sponsorship_refund_status
        ),
        detail: this.refundWorkflowTimelineLabel(sponsorship)
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

  private metadataString(
    entry: AdminAuditLogEntry,
    key: string
  ): string | null {
    const value = entry.metadata[key];
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private metadataNumber(
    entry: AdminAuditLogEntry,
    key: string
  ): number | null {
    const value = entry.metadata[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private metadataBoolean(
    entry: AdminAuditLogEntry,
    key: string
  ): boolean | null {
    const value = entry.metadata[key];
    return typeof value === 'boolean' ? value : null;
  }

  private refundHandlingAuditLabel(
    handling: AdminSponsorshipRejectionRefundHandling
  ): string {
    if (handling === 'manual_required') {
      return this.i18n.t('admin.messages.remboursement_manuel_demande');
    }

    if (handling === 'manual_completed') {
      return this.i18n.t('admin.messages.remboursement_manuel_deja_traite');
    }

    return this.i18n.t('admin.messages.aucun_remboursement_demande');
  }

  private adminAuditLabel(entry: AdminAuditLogEntry): string {
    if (entry.action.startsWith('sponsorship_review.')) {
      const reviewStatus =
        typeof entry.metadata.reviewStatus === 'string'
          ? (entry.metadata.reviewStatus as SponsorshipReviewStatus)
          : null;
      return reviewStatus
        ? this.i18n.t('admin.messages.decision_admin_p0', {
            p0: this.reviewStatusLabel(reviewStatus)
          })
        : this.i18n.t('admin.messages.decision_admin_enregistree');
    }

    switch (entry.action) {
      case 'sponsorship.details.update':
        return this.i18n.t('admin.editDossier.history');
      case 'sponsorship.logo.upload':
        return this.i18n.t(
          'admin.messages.logo_commanditaire_ajoute_ou_remplace'
        );
      case 'sponsorship.logo.delete':
        return this.i18n.t('admin.messages.logo_commanditaire_supprime');
      case 'sponsorship_refund.stripe_full':
        return this.i18n.t('admin.messages.remboursement_stripe_complet_cree');
      case 'sponsorship_refund.stripe_partial':
        return this.i18n.t('admin.messages.remboursement_stripe_partiel_cree');
      case 'sponsorship_publication.update':
        return this.i18n.t(
          'admin.messages.publication_commanditaire_mise_a_jour'
        );
      default:
        return entry.summary || entry.action;
    }
  }

  private adminAuditDetail(entry: AdminAuditLogEntry): string {
    if (entry.action === 'sponsorship.details.update') {
      const fields = Array.isArray(entry.metadata.changedFields)
        ? entry.metadata.changedFields.filter(
            (field): field is string =>
              typeof field === 'string' &&
              [
                'companyName',
                'publicName',
                'contactName',
                'contactEmail',
                'websiteUrl'
              ].includes(field)
          )
        : [];
      const reason = this.metadataString(entry, 'reason');
      return [
        this.i18n.t('admin.editDossier.actor', { actor: entry.actor }),
        fields
          .map((field) => this.i18n.t('admin.editDossier.fields.' + field))
          .join(', '),
        reason &&
        ['correction', 'contact_update', 'organization_update'].includes(reason)
          ? this.i18n.t('admin.editDossier.reasons.' + reason)
          : ''
      ]
        .filter(Boolean)
        .join(' · ');
    }
    const details = [`Acteur: ${entry.actor}`];

    if (
      entry.action === 'sponsorship_refund.stripe_full' ||
      entry.action === 'sponsorship_refund.stripe_partial'
    ) {
      const amount = this.metadataNumber(entry, 'amount');
      const currency = this.metadataString(entry, 'currency');
      const fullRefund = this.metadataBoolean(entry, 'fullRefund');
      const refundId = this.metadataString(entry, 'refundId');
      const refundReason = this.metadataString(
        entry,
        'refundReason'
      ) as AdminSponsorshipStripeRefundReason | null;
      const paymentIntentId = this.metadataString(entry, 'paymentIntentId');
      const refundStatus = this.metadataString(entry, 'refundStatus');
      const refundWorkflowStatus = this.metadataString(
        entry,
        'refundWorkflowStatus'
      ) as AdminSponsorshipRefundWorkflowStatus | null;
      const creditNoteNumber = this.metadataString(entry, 'creditNoteNumber');
      const creditNoteError = this.metadataString(entry, 'creditNoteError');
      const notificationSent = this.metadataBoolean(entry, 'notificationSent');
      const notificationError = this.metadataString(entry, 'notificationError');

      if (amount !== null && currency) {
        details.push(
          this.i18n.t('admin.messages.montant_p0', {
            p0: this.formatAmount(amount / 100, currency)
          })
        );
      }
      if (fullRefund !== null) {
        details.push(
          fullRefund
            ? this.i18n.t('admin.messages.type_complet')
            : this.i18n.t('admin.messages.type_partiel')
        );
      }
      if (refundReason) {
        details.push(
          this.i18n.t('admin.messages.raison_p0', {
            p0: this.stripeRefundReasonLabel(refundReason)
          })
        );
      }
      if (refundId) {
        details.push(`Refund: ${refundId}`);
      }
      if (paymentIntentId) {
        details.push(`PaymentIntent: ${paymentIntentId}`);
      }
      if (refundStatus) {
        details.push(`Statut: ${refundStatus}`);
      }
      if (refundWorkflowStatus) {
        details.push(
          `Suivi: ${this.refundWorkflowStatusLabel(refundWorkflowStatus)}`
        );
      }
      if (creditNoteNumber) {
        details.push(`Avoir: ${creditNoteNumber}`);
      }
      if (creditNoteError) {
        details.push(
          this.i18n.t('admin.messages.erreur_avoir_p0', { p0: creditNoteError })
        );
      }
      if (notificationSent !== null) {
        details.push(
          notificationSent
            ? this.i18n.t('admin.messages.courriel_envoye')
            : this.i18n.t('admin.messages.courriel_non_envoye')
        );
      }
      if (notificationError) {
        details.push(
          this.i18n.t('admin.messages.erreur_courriel_p0', {
            p0: notificationError
          })
        );
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
      const notificationSent = this.metadataBoolean(entry, 'notificationSent');
      const refundHandling = this.metadataString(
        entry,
        'refundHandling'
      ) as AdminSponsorshipRejectionRefundHandling | null;
      const refundWorkflowStatus = this.metadataString(
        entry,
        'refundWorkflowStatus'
      ) as AdminSponsorshipRefundWorkflowStatus | null;
      const hasRefundNote = this.metadataBoolean(entry, 'hasRefundNote');
      if (notificationSent !== null) {
        details.push(
          notificationSent
            ? this.i18n.t('admin.messages.courriel_envoye')
            : this.i18n.t('admin.messages.courriel_non_envoye')
        );
      }
      if (refundHandling && refundHandling !== 'none') {
        details.push(
          `Traitement: ${this.refundHandlingAuditLabel(refundHandling)}`
        );
      }
      if (refundWorkflowStatus) {
        details.push(
          `Suivi: ${this.refundWorkflowStatusLabel(refundWorkflowStatus)}`
        );
      }
      if (hasRefundNote) {
        details.push(this.i18n.t('admin.messages.note_remboursement_presente'));
      }
    }

    return details.join(' - ');
  }

  async copyReference(sponsorship: AdminSponsorshipRecord): Promise<void> {
    if (!sponsorship.public_reference) {
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(sponsorship.public_reference);
      }
      this.setCopyMessage(
        sponsorship.id,
        this.i18n.t('admin.messages.reference_copiee')
      );
    } catch {
      this.setCopyMessage(
        sponsorship.id,
        this.i18n.t('admin.messages.copie_impossible')
      );
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
        this.i18n.t('admin.messages.bonjour_p0', { p0: sponsorName }),
        '',
        this.i18n.t(
          'admin.messages.apres_revision_nous_ne_pouvons_pas_accepter_cette_commandite_openg7_pour_le_moment'
        ),
        '',
        this.i18n.t(
          'admin.messages.merci_de_votre_comprehension_vous_pouvez_repondre_a_ce_courriel_si_vous_souhaitez_clarifier_la_'
        )
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
      refundAmount: sponsorship.amount.toFixed(2),
      refundReason: 'requested_by_customer',
      notifySponsor: Boolean(sponsorship.sponsor_contact_email),
      recipientEmail: sponsorship.sponsor_contact_email ?? '',
      sponsorMessage: [
        this.i18n.t('admin.messages.bonjour_p0', { p0: sponsorName }),
        '',
        this.i18n.t(
          'admin.messages.nous_confirmons_que_le_remboursement_stripe_de_votre_commandite_openg7_vient_d_etre_lance'
        ),
        '',
        this.i18n.t(
          'admin.messages.selon_votre_institution_financiere_le_credit_peut_prendre_quelques_jours_ouvrables_avant_d_appa'
        )
      ].join('\n'),
      refundNote: ''
    };
  }

  private emptyRefundDraft(): SponsorRefundDraft {
    return {
      confirmationText: '',
      refundAmount: '',
      refundReason: 'requested_by_customer',
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

  private setSponsorMediaMessage(id: string, message: string): void {
    this.sponsorMediaMessages.update((messages) => ({
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
    if (error instanceof AdminDashboardRequestError && error.status === 409) {
      this.versionConflict.set(true);
      return this.i18n.t('admin.dossier.conflict');
    }
    if (error instanceof AdminDashboardRequestError && error.status === 401) {
      this.admin.clearAdminSession();
      this.sponsorships.set([]);
      this.progress.set(null);
      void this.router.navigate(['/admin/login'], {
        queryParams: { returnUrl: this.router.url, sessionExpired: '1' }
      });
    }
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

  private async loadSponsorMedia(contributionId: string | null): Promise<void> {
    if (!contributionId) {
      return;
    }
    try {
      const response = await this.admin.getSponsorMedia(
        this.adminToken(),
        contributionId
      );
      this.sponsorMedia.update((current) => ({
        ...current,
        [contributionId]: response.assets
      }));
      this.assistantRefresh.update((value) => value + 1);
      await this.loadSponsorMediaPreviews(response.assets);
    } catch (error) {
      this.setSponsorMediaMessage(
        contributionId,
        this.messageFromError(
          error,
          this.i18n.t(
            'admin.messages.les_medias_commanditaires_ne_peuvent_pas_etre_charges'
          )
        )
      );
    }
  }

  private async loadSponsorMediaPreviews(
    assets: readonly SponsorMediaAsset[]
  ): Promise<void> {
    this.revokeSponsorMediaPreviews();
    if (
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      return;
    }
    const entries = await Promise.all(
      assets.map(async (asset): Promise<readonly [string, string] | null> => {
        try {
          const preview = await this.admin.getSponsorMediaPreview(
            this.adminToken(),
            asset.id
          );
          return [asset.id, URL.createObjectURL(preview)] as const;
        } catch {
          return null;
        }
      })
    );
    this.sponsorMediaPreviewUrls.set(
      Object.fromEntries(
        entries.filter(
          (entry): entry is readonly [string, string] => entry !== null
        )
      )
    );
  }

  private revokeSponsorMediaPreviews(): void {
    if (
      typeof URL !== 'undefined' &&
      typeof URL.revokeObjectURL === 'function'
    ) {
      for (const objectUrl of Object.values(this.sponsorMediaPreviewUrls())) {
        URL.revokeObjectURL(objectUrl);
      }
    }
    this.sponsorMediaPreviewUrls.set({});
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
