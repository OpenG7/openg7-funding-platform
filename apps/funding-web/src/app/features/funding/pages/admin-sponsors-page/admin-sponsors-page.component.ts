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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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

import { AdminSponsorsNavigationAdapter } from './admin-sponsors-navigation.adapter.js';

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
  templateUrl: './admin-sponsors-page.component.html',
  styleUrls: [
    '../../components/admin-ui/admin-theme.css',
    '../../components/admin-ui/admin-controls.css',
    '../../components/admin-ui/admin-forms.css',
    './admin-sponsors-workspace.css',
    './admin-sponsors-page.component.css'
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
      deleteSponsorLogo: (token, id, version, confirmation) =>
        this.admin.deleteSponsorLogo(token, id, version, confirmation),
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

  private readonly navigationAdapter = new AdminSponsorsNavigationAdapter({
    controller: this.listController,
    selectedSponsorshipId: () => this.selectedSponsorshipId(),
    currentUrl: () => this.router.url,
    currentNavigation: () => this.router.currentNavigation(),
    parseUrl: (url) => this.router.parseUrl(url)
  });

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
      .subscribe((event) => this.navigationAdapter.handleRouterEvent(event));
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) =>
        this.navigationAdapter.applyRouteSelection(params)
      );
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
