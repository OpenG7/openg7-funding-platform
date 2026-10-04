import {
  CommonModule,
  ViewportScroller,
  isPlatformBrowser
} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  PLATFORM_ID,
  ViewChild,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationCancel,
  NavigationError,
  NavigationSkipped,
  NavigationSkippedCode,
  NavigationStart,
  Router,
  RouterLink,
  Scroll,
  UrlTree
} from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type {
  AdminSponsorshipRecord,
  SponsorFeedStatus,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

import type {
  AdminSponsorActionPorts,
  AdminSponsorSelectionPorts,
  SponsorshipApprovalFeedback
} from '../../models/admin-sponsor-workflow.ports.js';
import { AdminSponsorPresentationProjection } from '../../models/admin-sponsor-presentation.projection.js';
import { AdminSponsorReviewWorkflow } from '../../services/admin-sponsor-review-workflow.js';
import { AdminSponsorPublicationWorkflow } from '../../services/admin-sponsor-publication-workflow.js';
import { AdminSponsorHistoryProjection } from '../../models/admin-sponsor-history.projection.js';
import { AdminSponsorRefundWorkflow } from '../../services/admin-sponsor-refund-workflow.js';
import { AdminSponsorMediaWorkflow } from '../../services/admin-sponsor-media-workflow.js';
import { AdminSponsorListController } from '../../services/admin-sponsor-list-controller.js';
import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import { dossierSectionTab } from '../../models/admin-sponsorship-navigation.js';
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
import { AdminSponsorshipGuideComponent } from '../../components/admin-sponsors/admin-sponsorship-guide.component.js';
import { AdminSponsorshipInterventionsComponent } from '../../components/admin-sponsors/admin-sponsorship-interventions.component.js';
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
  AdminSponsorRefundHistoryView,
  AdminSponsorAuditHistoryView,
  SponsorDetailsTab
} from '../../models/admin-sponsors-ui.models.js';
import { AdminSponsorPublicationPanelComponent } from '../../components/admin-sponsors/admin-sponsor-publication-panel.component.js';
import { AdminSponsorRefundHistoryComponent } from '../../components/admin-sponsors/admin-sponsor-refund-history.component.js';
import { AdminSponsorAuditHistoryComponent } from '../../components/admin-sponsors/admin-sponsor-audit-history.component.js';
import { AdminSponsorRejectionPanelComponent } from '../../components/admin-sponsors/admin-sponsor-rejection-panel.component.js';
import { AdminSponsorRefundPanelComponent } from '../../components/admin-sponsors/admin-sponsor-refund-panel.component.js';
import { AdminSponsorDecisionActionsComponent } from '../../components/admin-sponsors/admin-sponsor-decision-actions.component.js';

@Component({
  selector: 'openg7-admin-sponsors-page',
  standalone: true,
  imports: [
    AdminSponsorPublicationPanelComponent,
    AdminSponsorRefundHistoryComponent,
    AdminSponsorAuditHistoryComponent,
    AdminSponsorRejectionPanelComponent,
    AdminSponsorRefundPanelComponent,
    AdminSponsorDecisionActionsComponent,
    AdminAssistantContextComponent,
    TranslatePipe,
    AdminSponsorDetailMediaComponent,
    AdminSponsorshipProgressComponent,
    AdminSponsorshipGuideComponent,
    AdminSponsorshipInterventionsComponent,
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
      <section
        class="admin-workspace"
        [class.has-dossier]="!!selectedSponsorship()"
      >
        <header class="admin-page-header" [hidden]="!!selectedSponsorship()">
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
          [hidden]="!!selectedSponsorship()"
          [totalSponsorships]="pagination().totalItems"
          [visibleCount]="visibleCount()"
          [activeCount]="activeCount()"
          [totalContributionLabel]="
            presentationProjection.formatSummaryMoney(totalContribution())
          "
        />

        <section
          class="sponsors-board"
          [class.has-selection]="!!selectedSponsorship()"
          [attr.aria-label]="'admin.legacy.commandites_admin' | translate"
        >
          <openg7-admin-sponsors-list-panel
            #sponsorsList
            [compact]="!!selectedSponsorship()"
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
            data-og7="sponsorship-dossier"
            class="sponsor-detail-panel"
            tabindex="-1"
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
              <nav
                class="dossier-toolbar"
                [attr.aria-label]="
                  'admin.dossier.workspace.navigation' | translate
                "
              >
                <button
                  type="button"
                  class="workspace-back"
                  data-og7="dossier-back"
                  (click)="closeDetails()"
                >
                  <span aria-hidden="true">←</span>
                  {{ 'admin.dossier.workspace.back' | translate }}
                </button>
                <div class="dossier-neighbours">
                  <button
                    type="button"
                    [disabled]="!adjacentDossier(-1)"
                    (click)="openAdjacentDossier(-1)"
                    [attr.aria-label]="
                      'admin.dossier.workspace.previous' | translate
                    "
                  >
                    ←
                  </button>
                  <span>{{
                    'admin.dossier.workspace.dossier' | translate
                  }}</span>
                  <button
                    type="button"
                    [disabled]="!adjacentDossier(1)"
                    (click)="openAdjacentDossier(1)"
                    [attr.aria-label]="
                      'admin.dossier.workspace.next' | translate
                    "
                  >
                    →
                  </button>
                </div>
              </nav>
              <openg7-admin-sponsor-detail-header
                *ngIf="selectedSponsorDetailHeader() as detailHeader"
                [detail]="detailHeader"
                [reviewStatus]="selected.sponsor_review_status"
                [reviewAnchor]="!canManage() && activeTab() === 'overview'"
                [website]="
                  progress()?.contributionId === selected.id
                    ? progress()?.website
                    : undefined
                "
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
                    (click)="loadSponsorships(true)"
                  >
                    {{ 'admin.dossier.refresh' | translate }}
                  </button>
                </p>
              }
              <openg7-admin-sponsor-detail-tabs
                [activeTab]="activeTab()"
                (activeTabChange)="setActiveTab($event)"
              />
              <openg7-admin-sponsorship-progress
                [sponsorshipId]="selected.id"
                [streamlined]="true"
                [activeTab]="activeTab()"
                [refreshKey]="assistantRefresh()"
                [disabled]="actionState() !== null || state() === 'loading'"
                (loaded)="progress.set($event)"
                (refreshRequested)="loadSponsorships(true)"
              />
              <div class="dossier-utilities">
                <openg7-admin-sponsor-edit
                  #sponsorEdit
                  [sponsorship]="selected"
                  [disabled]="actionsDisabled()"
                  (saved)="loadSponsorships()"
                  (conflicted)="versionConflict.set(true)"
                />

                @if (progress(); as dossier) {
                  @if (dossier.contributionId === selected.id) {
                    <openg7-admin-sponsorship-guide
                      [dossier]="dossier"
                      [expanded]="guideExpanded()"
                      (expandedChange)="guideExpanded.set($event)"
                      [canManage]="canManage()"
                      [canUseOwnerActions]="canUseOwnerActions()"
                      [disabled]="actionsDisabled()"
                      (editIdentity)="sponsorEdit.open()"
                      (openAccess)="openFollowupAccess()"
                    />
                  }
                }
                @if (canUseOwnerActions()) {
                  <details #followupAccess class="dossier-access">
                    <summary>
                      {{ 'admin.dossier.workspace.access' | translate }}
                    </summary>
                    <openg7-admin-sponsorship-access
                      [contributionId]="selected.id"
                      [token]="adminToken()"
                      [disabled]="actionsDisabled()"
                      (queued)="loadSponsorships()"
                    />
                  </details>
                }
              </div>
              <openg7-admin-sponsorship-interventions
                [hidden]="activeTab() !== 'audit' && activeTab() !== 'refund'"
                [contributionId]="selected.id"
                [refreshKey]="assistantRefresh()"
                [canManage]="canManage()"
                [canResendAccess]="canUseOwnerActions()"
                [disabled]="actionsDisabled()"
                [autoOpen]="activeTab() === 'refund' || activeTab() === 'audit'"
                (accessRequested)="openFollowupAccess()"
                (saved)="loadSponsorships()"
              />
              @if (!canManage()) {
                <p role="status">{{ 'admin.dossier.readOnly' | translate }}</p>
              }

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
                  [disabled]="actionsDisabled()"
                  (copyReference)="copyReference(selected)"
                  (reviewNoteChange)="
                    reviewWorkflow.setReviewNoteValue(selected.id, $event)
                  "
                  (saveReviewNote)="reviewWorkflow.saveReviewNote(selected)"
                />
              </ng-container>

              <ng-container
                *ngIf="activeTab() === 'identity' || activeTab() === 'media'"
              >
                <openg7-admin-sponsor-detail-identity
                  *ngIf="selectedSponsorDetailOverview() as identity"
                  [identity]="identity"
                  [sponsorship]="selected"
                  [canEdit]="canManage()"
                  [canResendAccess]="canUseOwnerActions()"
                  [disabled]="actionsDisabled()"
                  (editRequested)="sponsorEdit.open()"
                  (accessRequested)="openFollowupAccess()"
                />
              </ng-container>

              <ng-container
                *ngIf="activeTab() === 'identity' || activeTab() === 'media'"
              >
                <openg7-admin-sponsor-detail-media
                  *ngIf="selectedSponsorDetailIdentity() as identity"
                  [identity]="identity"
                  (uploadLogo)="mediaWorkflow.uploadLogo(selected, $event)"
                  (previewMedia)="
                    inspection.media($event.id, selected.id, $event.alt)
                  "
                  (deleteLogo)="mediaWorkflow.deleteLogo(selected)"
                  (reviewMedia)="
                    mediaWorkflow.reviewSponsorMedia(selected, $event)
                  "
                  (approveAllMedia)="
                    mediaWorkflow.approveAllSponsorMedia(selected, $event)
                  "
                  (deleteMedia)="
                    mediaWorkflow.deleteSponsorMedia(selected, $event)
                  "
                />
              </ng-container>

              @if (activeTab() === 'billing' || activeTab() === 'refund') {
                <openg7-admin-sponsorship-facts
                  view="billing"
                  [dossier]="progress()"
                />
              }
              @if (activeTab() === 'publication') {
                <openg7-admin-sponsorship-facts
                  view="publication"
                  [dossier]="progress()"
                  [canManageWebsite]="canManage()"
                  [websiteDisabled]="actionsDisabled()"
                  [websiteMessage]="
                    publicationWorkflow.websiteMessages()[selected.id] || ''
                  "
                  (changeWebsiteVisibility)="
                    publicationWorkflow.changeWebsiteVisibility(
                      selected,
                      $event
                    )
                  "
                  (editWebsite)="openWebsiteSettings()"
                />
              }
              @if (activeTab() === 'billing' || activeTab() === 'refund') {
                <openg7-admin-sponsorship-facts
                  view="refund"
                  [dossier]="progress()"
                />
              }

              <section
                class="detail-body"
                *ngIf="activeTab() === 'publication'"
                [attr.aria-label]="
                  'admin.dossier.publicationBridge.advanced' | translate
                "
              >
                <openg7-admin-sponsor-publication-panel
                  [sponsorship]="selected"
                  [draft]="publicationWorkflow.publicationDraftFor(selected.id)"
                  [expanded]="websiteSettingsOpen()"
                  [actionsDisabled]="actionsDisabled()"
                  [dirty]="publicationWorkflow.publicationDirtyFor(selected)"
                  [canSave]="publicationWorkflow.canSavePublication(selected)"
                  [saving]="
                    isActionPending(
                      publicationWorkflow.publicationActionId(selected.id)
                    )
                  "
                  [stateLabel]="
                    publicationWorkflow.publicationStateLabel(selected)
                  "
                  [slugError]="publicationWorkflow.slugErrorFor(selected)"
                  [promisedChannels]="
                    publicationWorkflow.promisedFeedChannelsFor(selected)
                  "
                  [promisedChannelTitle]="
                    'admin.dossier.publicationBridge.promisedChannel'
                      | translate
                  "
                  [feedStatusOptions]="feedStatusOptions()"
                  [logoSource]="
                    mediaWorkflow.logoPreviewSourceFor(selected) || null
                  "
                  [logoAlt]="
                    ('funding.followup.media.logo' | translate) +
                    ' ' +
                    presentationProjection.publicNameLabel(selected)
                  "
                  [publicName]="
                    presentationProjection.publicNameLabel(selected)
                  "
                  [channelsLabel]="
                    publicationWorkflow.draftChannelsLabel(selected.id)
                  "
                  (expandedChange)="websiteSettingsOpen.set($event)"
                  (fieldChange)="
                    publicationWorkflow.setPublicationField(
                      selected.id,
                      $event.field,
                      $event.event
                    )
                  "
                  (channelChange)="
                    publicationWorkflow.setPublicationChannel(
                      selected.id,
                      $event.channel,
                      $event.event
                    )
                  "
                  (save)="publicationWorkflow.savePublication(selected)"
                />
              </section>

              @if (isFinanceTab()) {
                @if (selectedSponsorRefundHistory(); as history) {
                  <openg7-admin-sponsor-refund-history [view]="history" />
                }
              }
              @if (activeTab() === 'audit') {
                @if (selectedSponsorAuditHistory(); as history) {
                  <openg7-admin-sponsor-audit-history
                    [view]="history"
                    (inspect)="inspection.history(selected)"
                  />
                }
              }
              @if (
                canManage() && reviewWorkflow.isRejectionPanelOpen(selected)
              ) {
                <openg7-admin-sponsor-rejection-panel
                  [draft]="reviewWorkflow.rejectionDraftFor(selected)"
                  [reviewNote]="reviewWorkflow.reviewNoteFor(selected.id)"
                  [validationMessage]="
                    reviewWorkflow.rejectionValidationMessage(selected)
                  "
                  [canConfirm]="reviewWorkflow.canConfirmRejection(selected)"
                  [actionsDisabled]="actionsDisabled()"
                  [actionPending]="actionState() !== null"
                  [busy]="
                    isActionPending(reviewWorkflow.reviewActionId(selected.id))
                  "
                  (reviewNoteChange)="
                    reviewWorkflow.setReviewNote(selected.id, $event)
                  "
                  (draftFieldChange)="
                    reviewWorkflow.setRejectionDraftField(
                      selected.id,
                      $event.field,
                      $event.event
                    )
                  "
                  (notifySponsorChange)="
                    reviewWorkflow.setRejectionDraftBoolean(
                      selected.id,
                      'notifySponsor',
                      $event
                    )
                  "
                  (refundHandlingChange)="
                    reviewWorkflow.setRejectionRefundHandling(
                      selected.id,
                      $event
                    )
                  "
                  (cancelled)="closeRejectionPanel()"
                  (confirmed)="reviewWorkflow.confirmRejection(selected)"
                />
              }
              @if (
                canUseOwnerActions() &&
                refundWorkflow.isRefundPanelOpen(selected)
              ) {
                <openg7-admin-sponsor-refund-panel
                  [sponsorship]="selected"
                  [draft]="refundWorkflow.refundDraftFor(selected)"
                  [confirmationText]="
                    refundWorkflow.refundConfirmationText(selected)
                  "
                  [draftAmountLabel]="
                    refundWorkflow.refundDraftAmountLabel(selected)
                  "
                  [paymentAmountLabel]="
                    presentationProjection.formatMoney(selected)
                  "
                  [validationMessage]="
                    refundWorkflow.refundValidationMessage(selected)
                  "
                  [canConfirm]="refundWorkflow.canConfirmRefund(selected)"
                  [actionsDisabled]="actionsDisabled()"
                  [pending]="actionState() !== null"
                  [busy]="
                    isActionPending(refundWorkflow.refundActionId(selected.id))
                  "
                  (draftFieldChange)="
                    refundWorkflow.setRefundDraftField(
                      selected.id,
                      $event.field,
                      $event.event
                    )
                  "
                  (reasonChange)="
                    refundWorkflow.setRefundDraftReason(selected.id, $event)
                  "
                  (notifySponsorChange)="
                    refundWorkflow.setRefundDraftBoolean(
                      selected.id,
                      'notifySponsor',
                      $event
                    )
                  "
                  (cancelled)="closeRefundPanel()"
                  (confirmed)="refundWorkflow.confirmRefund(selected)"
                />
              }
              @if (
                canManage() &&
                (!isFinanceTab() || canUseOwnerActions()) &&
                activeTab() !== 'publication' &&
                activeTab() !== 'audit'
              ) {
                <openg7-admin-sponsor-decision-actions
                  [sponsorship]="selected"
                  [financeTab]="isFinanceTab()"
                  [ownerActions]="canUseOwnerActions()"
                  [actionsDisabled]="actionsDisabled()"
                  [canApprove]="reviewWorkflow.canApproveSponsorship(selected)"
                  [canRefund]="refundWorkflow.canRefundSponsorship(selected)"
                  [approvalState]="approvalState(selected.id)"
                  [reviewMessage]="reviewWorkflow.reviewMessageFor(selected.id)"
                  [anchor]="
                    activeTab() === 'overview' ? 'dossier-review' : null
                  "
                  (returnPending)="
                    reviewWorkflow.review(selected, 'pending_review')
                  "
                  (openRejection)="openRejectionPanel(selected)"
                  (openRefund)="openRefundPanel(selected)"
                  (approve)="reviewWorkflow.review(selected, 'approved')"
                />
              }
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
    '../../components/admin-ui/admin-forms.css',
    './admin-sponsors-workspace.css'
  ],
  styles: [
    `
      .admin-workspace {
        display: grid;
        gap: 1rem;
        min-width: 0;
      }

      .admin-page-header,
      .sponsors-board {
        width: 100%;
      }

      .admin-page-header {
        display: grid;
        gap: 1rem;
      }

      .admin-breadcrumb,
      .admin-title-row,
      .admin-actions {
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
        font-weight: 500;
        text-decoration: none;
      }

      .admin-title-row {
        align-items: end;
        justify-content: space-between;
      }

      .admin-title-row h1,
      .empty-detail-state h2 {
        margin: 0;
      }

      .admin-title-row p,
      .muted-copy,
      .empty-detail-state p {
        color: var(--admin-muted);
        margin: 0.35rem 0 0;
      }

      .admin-kicker {
        color: var(--admin-muted);
        font-size: 0.76rem;
        font-weight: var(--admin-label-weight);
        letter-spacing: 0;
        text-transform: uppercase;
      }

      button,
      input,
      select,
      textarea {
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
      }

      button:focus-visible,
      a:focus-visible,
      input:focus-visible,
      select:focus-visible,
      textarea:focus-visible {
        outline: 3px solid var(--admin-focus);
        outline-offset: 2px;
      }

      .primary-action,
      .secondary-action,
      .tertiary-action,
      .secondary-danger-action,
      .mini-action,
      .icon-action {
        align-items: center;
        border-radius: 0.4rem;
        cursor: pointer;
        display: inline-flex;
        font-weight: var(--admin-control-weight);
        justify-content: center;
        min-height: 2.5rem;
        padding: 0 0.85rem;
        text-decoration: none;
      }

      .primary-action {
        background: var(--og7-admin-warning-bg, #3c3221);
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

      .sponsor-detail-panel,
      .empty-detail-state {
        background: var(--admin-panel);
        border: 1px solid var(--admin-border);
        border-radius: 0.5rem;
      }

      .sponsors-board {
        align-items: start;
        display: grid;
        gap: 1rem;
        grid-template-columns: minmax(52rem, 1fr) minmax(22rem, 32rem);
      }

      .sponsor-detail-panel {
        min-width: 0;
        overflow: hidden;
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

      .empty-detail-state {
        display: grid;
        gap: 0.7rem;
        padding: 1rem;
      }

      .sponsor-detail-panel {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        grid-auto-rows: max-content;
        max-height: calc(100vh - 2.5rem);
        overflow-y: auto;
        position: sticky;
        top: 1.25rem;
        scroll-padding-bottom: 12rem;
      }

      .sponsor-detail-panel.selection-pulse {
        animation: selected-box-fade-in 0.52s ease both;
      }

      .payment-alert {
        background: var(--og7-admin-danger-bg, #3c3221);
        border: 1px solid var(--admin-border);
        border-radius: 0.45rem;
        color: var(--admin-danger);
        font-weight: 500;
        grid-column: 1 / -1;
        margin: 0 1rem 1rem;
        padding: 0.75rem 0.9rem;
      }

      .detail-body {
        display: grid;
        gap: 0.9rem;
        overflow: auto;
        padding: 1rem;
      }

      @keyframes selected-box-fade-in {
        0% {
          box-shadow:
            inset 0.18rem 0 0 var(--admin-focus),
            0 0 0 0 rgb(37 99 235 / 0%);
          opacity: 0.62;
          transform: translateY(0.25rem);
        }
        45% {
          box-shadow:
            inset 0.18rem 0 0 var(--admin-focus),
            0 0 0 0.28rem rgb(37 99 235 / 14%);
          opacity: 1;
        }
        100% {
          box-shadow:
            inset 0.18rem 0 0 var(--admin-focus),
            0 0 0 0 rgb(37 99 235 / 0%);
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (max-width: 1500px) {
        .sponsors-board {
          grid-template-columns: 1fr;
        }
        .sponsor-detail-panel {
          max-height: none;
          overflow: visible;
          position: static;
        }
      }

      @media (max-width: 860px) {
        .admin-shell {
          grid-template-columns: 1fr;
        }

        .admin-title-row,
        .admin-actions {
          align-items: stretch;
          flex-direction: column;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .sponsor-detail-panel.selection-pulse {
          animation: none;
        }
      }
    `
  ]
})
export class AdminSponsorsPageComponent implements OnInit {
  readonly guideExpanded = signal(false);
  readonly sponsorsList = viewChild(AdminSponsorsListPanelComponent);
  private readonly followupAccess =
    viewChild<ElementRef<HTMLDetailsElement>>('followupAccess');
  readonly isFinanceTab = computed(
    () => this.activeTab() === 'billing' || this.activeTab() === 'refund'
  );

  adjacentDossier(direction: -1 | 1): string | null {
    return this.listController.adjacentDossier(direction);
  }

  openAdjacentDossier(direction: -1 | 1): void {
    this.listController.openAdjacentDossier(direction);
  }

  openFollowupAccess(): void {
    const panel = this.followupAccess()?.nativeElement;
    if (panel) panel.open = true;
    this.sponsorAccess()?.focus();
  }

  readonly sponsorOverview = viewChild(AdminSponsorDetailOverviewComponent);
  readonly sponsorAccess = viewChild(AdminSponsorshipAccessComponent);
  private readonly sponsorProgress = viewChild(
    AdminSponsorshipProgressComponent
  );
  private readonly sponsorAssistant = viewChild(AdminAssistantContextComponent);
  private readonly i18n = inject(FundingI18nService);
  private readonly confirmation = inject(AdminConfirmationService);
  readonly inspection = inject(AdminInspectionService);
  private readonly admin = inject(FundingAdminService);
  private readonly injector = inject(Injector);
  private readonly rejectionPanel = viewChild(
    AdminSponsorRejectionPanelComponent
  );
  private readonly refundPanel = viewChild(AdminSponsorRefundPanelComponent);
  private readonly decisionActions = viewChild(
    AdminSponsorDecisionActionsComponent
  );
  private readonly publicationPanel = viewChild(
    AdminSponsorPublicationPanelComponent
  );
  readonly canManage = computed(() => this.admin.identity()?.role !== 'reader');
  readonly canUseOwnerActions = computed(
    () => !this.admin.identity() || this.admin.identity()?.role === 'owner'
  );
  readonly actionsDisabled = computed(
    () =>
      !this.canManage() ||
      this.state() === 'loading' ||
      this.actionState() !== null ||
      this.versionConflict()
  );
  private readonly route = inject(ActivatedRoute);
  private readonly viewport = inject(ViewportScroller);
  private readonly destroyRef = inject(DestroyRef);
  @ViewChild('sponsorDetailPanel')
  private readonly sponsorDetailPanel?: ElementRef<HTMLElement>;

  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  readonly listController = new AdminSponsorListController({
    admin: this.admin,
    t: (key, params) => this.i18n.t(key, params),
    reconcile: (previous, current, preserveDrafts) => {
      this.reviewWorkflow.reconcile(previous, current, preserveDrafts);
      this.publicationWorkflow.reconcile(previous, current, preserveDrafts);
    },
    loadLogoPreviews: (sponsorships) =>
      this.mediaWorkflow.loadLogoPreviews(sponsorships),
    loadSponsorMedia: (id) => this.mediaWorkflow.loadSponsorMedia(id),
    closeDecisionPanels: () => {
      this.reviewWorkflow.activeRejectionId.set(null);
      this.refundWorkflow.activeRefundId.set(null);
    },
    messageFromError: (error, fallback) =>
      this.messageFromError(error, fallback),
    navigation: {
      getScrollPosition: () => this.viewport.getScrollPosition(),
      scrollToPosition: (position) =>
        this.viewport.scrollToPosition(position, { behavior: 'instant' }),
      hasPendingNavigation: () => !!this.router.currentNavigation(),
      navigateDossier: (sponsorshipId, tab) => {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { sponsorshipId, tab },
          queryParamsHandling: 'merge'
        });
      },
      afterRender: (callback) => {
        afterNextRender(callback, { injector: this.injector });
      },
      focusDossier: () => {
        const panel = this.sponsorDetailPanel?.nativeElement;
        panel?.focus({ preventScroll: true });
        panel?.scrollIntoView({ behavior: 'instant', block: 'start' });
      },
      focusListRow: (id) => this.sponsorsList()?.focusRow(id)
    }
  });
  private readonly sponsorActionPorts: AdminSponsorActionPorts = {
    t: (key, params) => this.i18n.t(key, params),
    adminToken: () => this.adminToken(),
    canActOn: (sponsorship) => this.canActOn(sponsorship),
    actionPending: () => this.actionState() !== null,
    setActionState: (action) => this.actionState.set(action),
    reloadSponsorships: () => this.loadSponsorships(),
    messageFromError: (error, fallback) =>
      this.messageFromError(error, fallback)
  };

  private readonly sponsorSelectionPorts: AdminSponsorSelectionPorts = {
    ...this.sponsorActionPorts,
    selectionRevision: () => this.listController.selectionRevision(),
    isCurrentSelection: (id) =>
      !this.destroyRef.destroyed && this.listController.isCurrentSelection(id)
  };
  readonly reviewWorkflow = new AdminSponsorReviewWorkflow({
    ...this.sponsorSelectionPorts,
    admin: {
      reviewSponsorship: (token, payload) =>
        this.admin.reviewSponsorship(token, payload)
    },
    confirm: (message, detail) => this.confirmation.confirm(message, detail),
    canManage: () => this.canManage(),
    paymentEligibilityMessage: (sponsorship) =>
      this.paymentEligibilityMessage(sponsorship),
    openRejectionPanel: (sponsorship) => this.openRejectionPanel(sponsorship),
    beginApprovalFeedback: (id) =>
      this.listController.beginApprovalFeedback(id),
    finishApprovalFeedback: (attempt, phase) =>
      this.listController.finishApprovalFeedback(attempt, phase),
    pulseSelection: (id) => this.listController.pulseSelection(id),
    refundWorkflowStatusLabel: (status) =>
      this.historyProjection.refundWorkflowStatusLabel(status)
  });
  readonly publicationWorkflow = new AdminSponsorPublicationWorkflow({
    ...this.sponsorSelectionPorts,
    admin: {
      updateSponsorshipPublication: (token, payload) =>
        this.admin.updateSponsorshipPublication(token, payload),
      setSponsorshipWebsiteVisibility: (token, payload) =>
        this.admin.setSponsorshipWebsiteVisibility(token, payload)
    },
    confirm: (message, detail) => this.confirmation.confirm(message, detail),
    sponsorships: () => this.sponsorships(),
    progress: () => this.progress(),
    paymentEligibilityMessage: (sponsorship) =>
      this.paymentEligibilityMessage(sponsorship)
  });
  readonly presentationProjection = new AdminSponsorPresentationProjection({
    t: (key, params) => this.i18n.t(key, params),
    currentLanguage: () => this.i18n.currentLanguage(),
    formatAmount: (amount, currency) => this.formatAmount(amount, currency),
    dateOnlyLabel: (value) => this.dateOnlyLabel(value),
    paymentStatusLabel: (status) => this.paymentStatusLabel(status),
    reviewStatusLabel: (status) => this.reviewStatusLabel(status),
    feedStatusLabel: (status) => this.feedStatusLabel(status),
    history: {
      hasRefundWorkflow: (sponsorship) =>
        this.historyProjection.hasRefundWorkflow(sponsorship),
      refundWorkflowStatusClass: (status) =>
        this.historyProjection.refundWorkflowStatusClass(status),
      refundWorkflowStatusLabel: (status) =>
        this.historyProjection.refundWorkflowStatusLabel(status),
      refundWorkflowTimelineLabel: (sponsorship) =>
        this.historyProjection.refundWorkflowTimelineLabel(sponsorship)
    },
    media: {
      sponsorMediaStatusLabel: (status) =>
        this.mediaWorkflow.sponsorMediaStatusLabel(status),
      formatMediaSize: (bytes) => this.mediaWorkflow.formatMediaSize(bytes)
    }
  });

  readonly historyProjection = new AdminSponsorHistoryProjection({
    t: (key, params) => this.i18n.t(key, params),
    formatAmount: (amount, currency) => this.formatAmount(amount, currency),
    dateOnlyLabel: (value) => this.dateOnlyLabel(value),
    paymentStatusLabel: (status) => this.paymentStatusLabel(status),
    reviewStatusLabel: (status) => this.reviewStatusLabel(status),
    feedStatusLabel: (status) => this.feedStatusLabel(status)
  });
  readonly refundWorkflow = new AdminSponsorRefundWorkflow({
    ...this.sponsorActionPorts,
    admin: {
      refundSponsorship: (token, payload) =>
        this.admin.refundSponsorship(token, payload)
    },
    canUseOwnerActions: () => this.canUseOwnerActions(),
    setReviewMessage: (id, message, autoHide) =>
      this.reviewWorkflow.setReviewMessage(id, message, autoHide),
    pulseSelection: (id) => this.listController.pulseSelection(id),
    formatAmount: (amount, currency) => this.formatAmount(amount, currency),
    formatMoney: (sponsorship) =>
      this.presentationProjection.formatMoney(sponsorship),
    refundWorkflowStatusLabel: (status) =>
      this.historyProjection.refundWorkflowStatusLabel(status),
    stripeRefundReasonLabel: (reason) =>
      this.historyProjection.stripeRefundReasonLabel(reason)
  });
  readonly mediaWorkflow = new AdminSponsorMediaWorkflow({
    ...this.sponsorActionPorts,
    admin: {
      uploadSponsorLogo: (token, id, version, file) =>
        this.admin.uploadSponsorLogo(token, id, version, file),
      deleteSponsorLogo: (token, id, version) =>
        this.admin.deleteSponsorLogo(token, id, version),
      getSponsorLogoPreview: (token, id) =>
        this.admin.getSponsorLogoPreview(token, id),
      getSponsorMedia: (token, id) => this.admin.getSponsorMedia(token, id),
      getSponsorMediaPreview: (token, id) =>
        this.admin.getSponsorMediaPreview(token, id),
      reviewSponsorMedia: (token, payload) =>
        this.admin.reviewSponsorMedia(token, payload),
      deleteSponsorMedia: (token, payload) =>
        this.admin.deleteSponsorMedia(token, payload)
    },
    confirm: (message) => this.confirmation.confirm(message),
    isBrowser: () => isPlatformBrowser(this.platformId),
    mediaLoaded: () => this.assistantRefresh.update((value) => value + 1)
  });

  readonly adminToken = this.listController.adminToken;
  readonly sponsorships = this.listController.sponsorships;
  readonly state = this.listController.state;
  readonly actionState = this.listController.actionState;
  readonly approvalFeedback = this.listController.approvalFeedback;
  readonly search = this.listController.search;
  readonly reviewFilter = this.listController.reviewFilter;
  readonly feedFilter = this.listController.feedFilter;
  readonly paymentFilter = this.listController.paymentFilter;
  readonly assistantRefresh = this.listController.assistantRefresh;
  readonly progress = this.listController.progress;
  readonly websiteSettingsOpen = this.listController.websiteSettingsOpen;
  readonly versionConflict = this.listController.versionConflict;
  readonly selectedSponsorshipId = this.listController.selectedSponsorshipId;
  readonly activeTab = this.listController.activeTab;
  readonly page = this.listController.page;
  readonly pageSize = this.listController.pageSize;
  readonly pagination = this.listController.pagination;
  readonly selectionPulseId = this.listController.selectionPulseId;
  readonly copyMessages = this.listController.copyMessages;
  readonly feedStatuses = this.listController.feedStatuses;
  readonly pageSizeOptions = this.listController.pageSizeOptions;
  readonly feedStatusOptions = this.listController.feedStatusOptions;
  readonly totalPages = this.listController.totalPages;
  readonly normalizedPage = this.listController.normalizedPage;
  readonly paginatedSponsorships = this.listController.sponsorships;
  readonly sponsorListRows = computed(() =>
    this.paginatedSponsorships().map((sponsorship) =>
      this.presentationProjection.listRow(sponsorship)
    )
  );
  readonly paginationStart = this.listController.paginationStart;
  readonly paginationEnd = this.listController.paginationEnd;
  readonly selectedSponsorship = this.listController.selectedSponsorship;
  readonly selectedSponsorDetailHeader = computed(() => {
    const selected = this.selectedSponsorship();
    return selected ? this.presentationProjection.header(selected) : null;
  });
  readonly selectedSponsorDetailOverview = computed(() => {
    const selected = this.selectedSponsorship();
    return selected
      ? this.presentationProjection.overview(selected, {
          copyMessage: this.copyMessageFor(selected.id),
          reviewNote: this.reviewWorkflow.reviewNoteFor(selected.id),
          reviewNoteDirty: this.reviewWorkflow.isReviewNoteDirty(selected),
          reviewNoteStateLabel:
            this.reviewWorkflow.reviewNoteStateLabel(selected),
          reviewNoteSaving: this.isActionPending(
            this.reviewWorkflow.noteActionId(selected.id)
          )
        })
      : null;
  });
  readonly selectedSponsorDetailIdentity = computed(() => {
    const selected = this.selectedSponsorship();
    return selected
      ? this.presentationProjection.identity(selected, {
          disabled: this.actionsDisabled(),
          logoPreviewSource:
            this.mediaWorkflow.logoPreviewSourceFor(selected) || null,
          logoMessage: this.mediaWorkflow.logoUploadMessageFor(selected.id),
          mediaAssets: this.mediaWorkflow.sponsorMedia()[selected.id] ?? [],
          mediaPreviewUrls: this.mediaWorkflow.sponsorMediaPreviewUrls(),
          mediaMessage: this.mediaWorkflow.sponsorMediaMessages()[selected.id]
        })
      : null;
  });
  readonly selectedSponsorRefundHistory =
    computed<AdminSponsorRefundHistoryView | null>(() => {
      const selected = this.selectedSponsorship();
      if (!selected) return null;
      const history = this.historyProjection;
      return {
        statusClass: history.refundWorkflowStatusClass(
          selected.sponsorship_refund_status
        ),
        statusLabel: history.refundWorkflowStatusLabel(
          selected.sponsorship_refund_status
        ),
        amountLabel: this.presentationProjection.formatMoney(selected),
        refundAmountLabel: selected.sponsorship_refund_amount
          ? this.formatAmount(
              selected.sponsorship_refund_amount,
              selected.currency
            )
          : this.i18n.t('admin.legacy.non_associe'),
        refundReasonLabel: selected.sponsorship_refund_reason
          ? history.stripeRefundReasonLabel(selected.sponsorship_refund_reason)
          : this.i18n.t('admin.legacy.non_associee'),
        publicReferenceLabel:
          selected.public_reference ||
          this.i18n.t('admin.legacy.non_attribuee_175'),
        refundIdLabel:
          selected.sponsorship_refund_id ||
          this.i18n.t('admin.legacy.non_associe'),
        hasRefundWorkflow: history.hasRefundWorkflow(selected),
        refundNote: selected.sponsorship_refund_note,
        refundError: selected.sponsorship_refund_error,
        timelineEntries: history
          .refundHistoryEntriesFor(selected)
          .map((entry) => ({
            id: entry.id,
            dateTimeLabel: this.dateTimeLabel(entry.date),
            label: entry.label,
            detail: entry.detail,
            stateClass: history.refundHistoryEntryClass(entry)
          })),
        auditEntries: history.refundAuditEntriesFor(selected).map((entry) => ({
          id: entry.id,
          dateTimeLabel: this.dateTimeLabel(entry.date),
          label: entry.label,
          detail: entry.detail
        }))
      };
    });
  readonly selectedSponsorAuditHistory =
    computed<AdminSponsorAuditHistoryView | null>(() => {
      const selected = this.selectedSponsorship();
      return selected
        ? {
            entries: this.historyProjection
              .auditEntriesFor(selected)
              .map((entry) => ({
                id: entry.id,
                dateTimeLabel: this.dateTimeLabel(entry.date),
                label: entry.label,
                detail: entry.detail
              }))
          }
        : null;
    });
  readonly hasActiveFilters = this.listController.hasActiveFilters;
  readonly visibleCount = this.listController.visibleCount;
  readonly activeCount = this.listController.activeCount;
  readonly totalContribution = this.listController.totalContribution;
  private readonly pendingSection = this.listController.pendingSection;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.listController.dispose();
      this.mediaWorkflow.dispose();
      this.reviewWorkflow.dispose();
      this.publicationWorkflow.dispose();
    });
    afterRenderEffect(() => {
      const feedback = this.approvalFeedback();
      if (feedback && feedback.id !== this.selectedSponsorshipId()) {
        this.listController.clearApprovalFeedback();
      }
    });
    afterRenderEffect(() => {
      const pending = this.pendingSection();
      if (
        !pending ||
        this.state() !== 'ready' ||
        this.selectedSponsorship()?.id !== pending.sponsorshipId ||
        this.activeTab() !== pending.tab ||
        this.sponsorProgress()?.state() === 'loading' ||
        this.sponsorAssistant()?.state() === 'loading'
      )
        return;
      const element =
        this.sponsorDetailPanel?.nativeElement.querySelector<HTMLElement>(
          `#${pending.fragment}`
        );
      if (!element) return;
      this.pendingSection.set(null);
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }

  ngOnInit(): void {
    this.listController.initialize();
    this.router.events
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (
          event instanceof NavigationStart ||
          event instanceof NavigationSkipped
        ) {
          const imperative =
            event instanceof NavigationStart
              ? event.navigationTrigger === 'imperative'
              : event.code === NavigationSkippedCode.IgnoredSameUrlNavigation &&
                this.router.currentNavigation()?.trigger === 'imperative';
          this.listController.navigationStarted(
            event.id,
            imperative && this.isDossierTabNavigation(event.url)
          );
          return;
        }
        if (
          event instanceof NavigationCancel ||
          event instanceof NavigationError
        ) {
          this.listController.navigationCancelled(event.id);
          return;
        }
        if (!(event instanceof Scroll)) return;
        if (this.router.currentNavigation()) return;
        const targetTab = dossierSectionTab(event.anchor);
        if (!event.position && event.anchor && targetTab) {
          const url = this.router.parseUrl(event.routerEvent.url);
          const sponsorshipId = url.queryParams['sponsorshipId'];
          if (
            sponsorshipId &&
            (url.queryParams['tab'] ?? 'overview') === targetTab
          ) {
            this.listController.navigationScrolled(event.routerEvent.id, {
              fragment: event.anchor,
              sponsorshipId,
              tab: targetTab
            });
            return;
          }
        }
        this.listController.navigationScrolled(event.routerEvent.id, null);
      });
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.listController.applyRouteSelection(
          params.get('sponsorshipId'),
          params.get('tab')
        );
      });
  }

  loadSponsorships(preserveDrafts = false): Promise<void> {
    return this.listController.loadSponsorships(preserveDrafts);
  }
  openRejectionPanel(sponsorship: AdminSponsorshipRecord): void {
    if (!this.reviewWorkflow.openRejectionPanel(sponsorship)) return;
    this.setActiveTab('overview');
    this.refundWorkflow.activeRefundId.set(null);
    afterNextRender(() => this.rejectionPanel()?.focusReason(), {
      injector: this.injector
    });
  }
  closeRejectionPanel(): void {
    if (!this.reviewWorkflow.closeRejectionPanel()) return;
    this.decisionActions()?.focusRejectButton();
  }

  openRefundPanel(sponsorship: AdminSponsorshipRecord): void {
    if (!this.refundWorkflow.openRefundPanel(sponsorship)) return;
    this.reviewWorkflow.activeRejectionId.set(null);
    afterNextRender(() => this.refundPanel()?.focusAmount(), {
      injector: this.injector
    });
  }

  closeRefundPanel(): void {
    if (!this.refundWorkflow.closeRefundPanel()) return;
    this.decisionActions()?.focusRefundButton();
  }

  openWebsiteSettings(): void {
    this.websiteSettingsOpen.set(true);
    afterNextRender(
      () => {
        this.publicationPanel()?.focusSummary();
      },
      { injector: this.injector }
    );
  }

  setAdminToken(event: Event): void {
    this.adminToken.set(this.valueFromEvent(event));
    this.listController.saveToken();
  }

  setSearchValue(value: string): void {
    this.listController.setSearchValue(value);
  }
  setReviewFilterValue(value: string): void {
    this.listController.setReviewFilterValue(value);
  }
  setFeedFilterValue(value: string): void {
    this.listController.setFeedFilterValue(value);
  }
  setPaymentFilterValue(value: string): void {
    this.listController.setPaymentFilterValue(value);
  }
  resetFilters(): void {
    this.listController.resetFilters();
  }
  setPageSizeValue(value: number): void {
    this.listController.setPageSizeValue(value);
  }
  previousPage(): void {
    this.listController.previousPage();
  }
  nextPage(): void {
    this.listController.nextPage();
  }
  selectSponsorshipById(id: string): void {
    this.listController.selectSponsorshipById(id);
  }
  closeDetails(): void {
    this.listController.closeDetails();
  }
  setActiveTab(tab: SponsorDetailsTab): void {
    this.listController.setActiveTab(tab);
  }

  private isDossierTabNavigation(url: string): boolean {
    const id = this.selectedSponsorshipId();
    if (!id) return false;
    const current = this.router.parseUrl(this.router.url);
    const target = this.router.parseUrl(url);
    if (
      current.queryParams['sponsorshipId'] !== id ||
      target.queryParams['sponsorshipId'] !== id ||
      new UrlTree(current.root).toString() !==
        new UrlTree(target.root).toString() ||
      (current.fragment !== target.fragment &&
        !(target.fragment === null && dossierSectionTab(current.fragment)))
    )
      return false;
    const keys = new Set([
      ...Object.keys(current.queryParams),
      ...Object.keys(target.queryParams)
    ]);
    return [...keys].every(
      (key) =>
        key === 'tab' ||
        JSON.stringify(current.queryParams[key]) ===
          JSON.stringify(target.queryParams[key])
    );
  }

  approvalState(id: string): SponsorshipApprovalFeedback['phase'] | 'idle' {
    const feedback = this.approvalFeedback();
    return feedback?.id === id ? feedback.phase : 'idle';
  }

  copyMessageFor(id: string): string {
    return this.copyMessages()[id] ?? '';
  }

  isActionPending(actionId: string): boolean {
    return this.actionState() === actionId;
  }

  private canActOn(sponsorship: AdminSponsorshipRecord): boolean {
    return (
      !this.destroyRef.destroyed &&
      !this.actionsDisabled() &&
      this.selectedSponsorship()?.id === sponsorship.id &&
      this.selectedSponsorship()?.version === sponsorship.version
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
    return this.listController.feedStatusLabel(status);
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

  formatAmount(amount: number, currency: string): string {
    return new Intl.NumberFormat(this.i18n.currentLanguage(), {
      currency: currency || 'CAD',
      style: 'currency'
    }).format(amount);
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

  copyReference(sponsorship: AdminSponsorshipRecord): Promise<void> {
    return this.listController.copyReference(sponsorship);
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

  private valueFromEvent(event: Event): string {
    return (
      (
        event.target as
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
      )?.value ?? ''
    );
  }
}
