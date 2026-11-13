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
  effect,
  inject,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationSkipped,
  NavigationStart,
  Router,
  RouterLink,
  Scroll
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
import {
  projectSponsorOverview,
  type OverviewDestination
} from '../../models/admin-sponsor-overview.projection.js';
import { AdminSponsorReviewWorkflow } from '../../services/admin-sponsor-review-workflow.js';
import { AdminSponsorPublicationWorkflow } from '../../services/admin-sponsor-publication-workflow.js';
import { AdminSponsorHistoryProjection } from '../../models/admin-sponsor-history.projection.js';
import { AdminSponsorRefundWorkflow } from '../../services/admin-sponsor-refund-workflow.js';
import { AdminSponsorMediaWorkflow } from '../../services/admin-sponsor-media-workflow.js';
import { AdminSponsorListController } from '../../services/admin-sponsor-list-controller.js';
import { AdminInspectionService } from '../../services/admin-inspection.service.js';
import { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import { AdminLayoutComponent } from '../../components/admin-layout/admin-layout.component.js';
import { AdminIconComponent } from '../../components/admin-ui/admin-icon.component.js';
import { FundingModerationService } from '../../services/funding-moderation.service.js';
import { FundingModerationActionsComponent } from '../../components/admin-moderation/funding-moderation-actions.component.js';
import {
  AdminDashboardRequestError,
  FundingAdminService
} from '../../services/funding-admin.service.js';
import { FundingI18nService } from '../../services/funding-i18n.service.js';
import enPublication from '../../../../../assets/i18n/admin-publication-schedule.en.json' with { type: 'json' };
import frPublication from '../../../../../assets/i18n/admin-publication-schedule.fr-CA.json' with { type: 'json' };
import enFinance from '../../../../../assets/i18n/admin-finance.en.json' with { type: 'json' };
import frFinance from '../../../../../assets/i18n/admin-finance.fr-CA.json' with { type: 'json' };
import enProfile from '../../../../../assets/i18n/admin-sponsor-profile.en.json' with { type: 'json' };
import frProfile from '../../../../../assets/i18n/admin-sponsor-profile.fr-CA.json' with { type: 'json' };
import enHistory from '../../../../../assets/i18n/admin-history.en.json' with { type: 'json' };
import frHistory from '../../../../../assets/i18n/admin-history.fr-CA.json' with { type: 'json' };
import enAssistance from '../../../../../assets/i18n/admin-dossier-assistance.en.json' with { type: 'json' };
import frAssistance from '../../../../../assets/i18n/admin-dossier-assistance.fr-CA.json' with { type: 'json' };
import enCleanup from '../../../../../assets/i18n/admin-sponsors-cleanup.en.json' with { type: 'json' };
import frCleanup from '../../../../../assets/i18n/admin-sponsors-cleanup.fr-CA.json' with { type: 'json' };
import enOverview from '../../../../../assets/i18n/admin-sponsor-overview.en.json' with { type: 'json' };
import frOverview from '../../../../../assets/i18n/admin-sponsor-overview.fr-CA.json' with { type: 'json' };
import { AdminSponsorDetailMediaComponent } from '../../components/admin-sponsors/admin-sponsor-detail-media.component.js';
import { AdminSponsorshipProgressComponent } from '../../components/admin-sponsors/admin-sponsorship-progress.component.js';
import { AdminSponsorshipNextStepComponent } from '../../components/admin-sponsors/admin-sponsorship-next-step.component.js';
import { AdminSponsorshipInterventionsComponent } from '../../components/admin-sponsors/admin-sponsorship-interventions.component.js';
import { AdminSponsorshipAccessComponent } from '../../components/admin-sponsors/admin-sponsorship-access.component.js';
import { AdminSponsorshipFactsComponent } from '../../components/admin-sponsors/admin-sponsorship-facts.component.js';
import { AdminSponsorDetailHeaderComponent } from '../../components/admin-sponsors/admin-sponsor-detail-header.component.js';
import { AdminSponsorEditComponent } from '../../components/admin-sponsors/admin-sponsor-edit.component.js';
import { AdminSponsorDetailIdentityComponent } from '../../components/admin-sponsors/admin-sponsor-detail-identity.component.js';
import { AdminSponsorDetailOverviewComponent } from '../../components/admin-sponsors/admin-sponsor-detail-overview.component.js';
import { AdminSponsorNoteComponent } from '../../components/admin-sponsors/admin-sponsor-note.component.js';
import { AdminSponsorDetailTabsComponent } from '../../components/admin-sponsors/admin-sponsor-detail-tabs.component.js';
import { AdminSponsorsListPanelComponent } from '../../components/admin-sponsors/admin-sponsors-list-panel.component.js';
import { AdminSponsorsSummaryComponent } from '../../components/admin-sponsors/admin-sponsors-summary.component.js';
import type {
  AdminSponsorRefundHistoryView,
  AdminSponsorAuditHistoryView,
  SponsorDetailsTab
} from '../../models/admin-sponsors-ui.models.js';
import { AdminSponsorPublicationPanelComponent } from '../../components/admin-sponsors/admin-sponsor-publication-panel.component.js';
import { AdminSponsorshipCommitmentsComponent } from '../../components/admin-sponsors/admin-sponsorship-commitments.component.js';
import { AdminSponsorRefundHistoryComponent } from '../../components/admin-sponsors/admin-sponsor-refund-history.component.js';
import { AdminSponsorAuditHistoryComponent } from '../../components/admin-sponsors/admin-sponsor-audit-history.component.js';
import { AdminSponsorRejectionPanelComponent } from '../../components/admin-sponsors/admin-sponsor-rejection-panel.component.js';
import { AdminSponsorRefundPanelComponent } from '../../components/admin-sponsors/admin-sponsor-refund-panel.component.js';
import { AdminSponsorDecisionActionsComponent } from '../../components/admin-sponsors/admin-sponsor-decision-actions.component.js';
import { AdminAutomaticPreparationDirective } from '../../components/admin-automatic/admin-automatic-preparation.directive.js';
import {
  AssistantDossierNavigation,
  assistantDossierQuery
} from '../../models/admin-assistant-navigation.js';

import { AdminSponsorsNavigationAdapter } from './admin-sponsors-navigation.adapter.js';

type SponsorDossierTool = 'moderation' | 'access' | 'agreement';

@Component({
  selector: 'openg7-admin-sponsors-page',
  standalone: true,
  imports: [
    AdminSponsorPublicationPanelComponent,
    AdminSponsorshipCommitmentsComponent,
    AdminSponsorRefundHistoryComponent,
    AdminSponsorAuditHistoryComponent,
    AdminSponsorRejectionPanelComponent,
    AdminSponsorRefundPanelComponent,
    AdminSponsorDecisionActionsComponent,
    TranslatePipe,
    AdminSponsorDetailMediaComponent,
    AdminSponsorshipProgressComponent,
    AdminSponsorshipNextStepComponent,
    AdminSponsorshipInterventionsComponent,
    AdminSponsorshipFactsComponent,
    CommonModule,
    RouterLink,
    AdminLayoutComponent,
    AdminIconComponent,
    FundingModerationActionsComponent,
    AdminSponsorDetailHeaderComponent,
    AdminSponsorEditComponent,
    AdminSponsorDetailIdentityComponent,
    AdminSponsorDetailOverviewComponent,
    AdminSponsorNoteComponent,
    AdminSponsorDetailTabsComponent,
    AdminSponsorsListPanelComponent,
    AdminSponsorsSummaryComponent,
    AdminSponsorshipAccessComponent,
    AdminAutomaticPreparationDirective
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
  readonly reservedDossierHeight = signal<number | null>(null);
  private readonly layoutNavigationSettled = signal(true);

  private preserveTabLayout(tab: string | null): void {
    if (tab !== 'media' || !isPlatformBrowser(this.platformId)) {
      this.reservedDossierHeight.set(null);
      return;
    }
    const height =
      this.sponsorDetailPanel?.nativeElement.getBoundingClientRect().height;
    this.reservedDossierHeight.set(height && height > 0 ? height : null);
  }
  readonly sponsorsList = viewChild(AdminSponsorsListPanelComponent);
  readonly dossierTool = signal<SponsorDossierTool | null>(null);
  private dossierToolReturnTarget: HTMLElement | null = null;
  readonly visitedDossierTools = signal<ReadonlySet<SponsorDossierTool>>(
    new Set()
  );
  private readonly dossierToolPanel =
    viewChild<ElementRef<HTMLElement>>('dossierToolPanel');
  private readonly dossierModeration = viewChild(
    FundingModerationActionsComponent
  );
  private readonly sponsorEdit = viewChild(AdminSponsorEditComponent);
  private readonly sponsorInterventions = viewChild(
    AdminSponsorshipInterventionsComponent
  );
  private readonly dossierAgreement = viewChild(
    AdminSponsorshipCommitmentsComponent
  );
  readonly dossierToolBusy = computed(
    () =>
      !!this.sponsorAccess()?.busy() ||
      !!this.dossierModeration()?.busy() ||
      !!this.dossierAgreement()?.c.saving() ||
      !!this.dossierAgreement()?.c.pending()
  );
  private readonly dossierToolSessionKey = computed(() => {
    const identity = this.admin.identity();
    return `${this.admin.sessionGeneration()}:${identity?.id ?? 'token'}:${identity?.sessionId ?? 'token'}:${identity?.role ?? 'owner'}`;
  });
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
    this.openDossierTool('access', false);
  }

  openHistoryInterventions(): void {
    if (!this.dossierToolBusy()) void this.sponsorInterventions()?.open();
  }

  openDossierTool(tool: SponsorDossierTool, toggle = true): void {
    if (
      this.dossierToolBusy() ||
      (tool === 'access' && !this.canUseOwnerActions()) ||
      (tool === 'moderation' && !this.canManage())
    )
      return;
    if (toggle && this.dossierTool() === tool) {
      this.closeDossierTool();
      return;
    }
    const panel = this.sponsorDetailPanel?.nativeElement;
    const active = panel?.ownerDocument.activeElement as HTMLElement | null;
    this.dossierToolReturnTarget =
      active && panel?.contains(active) ? active : null;
    this.visitedDossierTools.update((visited) => new Set([...visited, tool]));
    this.dossierTool.set(tool);
    const sponsorshipId = this.selectedSponsorshipId();
    afterNextRender(
      () => {
        if (
          this.dossierTool() !== tool ||
          this.selectedSponsorshipId() !== sponsorshipId
        )
          return;
        const panel = this.dossierToolPanel()?.nativeElement;
        const accessAction =
          tool === 'access'
            ? panel?.querySelector<HTMLElement>(
                '[data-og7="admin-followup-access"] button:not(:disabled)'
              )
            : null;
        const focusTarget =
          accessAction ??
          panel?.querySelector<HTMLElement>('[data-og7="dossier-tool-close"]');
        focusTarget?.focus({ preventScroll: true });
        panel?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      },
      { injector: this.injector }
    );
  }

  closeDossierTool(event?: Event): void {
    if (this.dossierToolBusy()) return;
    event?.stopPropagation();
    const tool = this.dossierTool();
    const sponsorshipId = this.selectedSponsorshipId();
    const returnTarget = this.dossierToolReturnTarget;
    this.dossierToolReturnTarget = null;
    this.dossierTool.set(null);
    if (
      tool === 'agreement' &&
      [
        'dossier-agreement',
        'dossier-assistance-source',
        'dossier-assistance-review'
      ].includes(this.websiteSettingsFragment() ?? '')
    ) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParamsHandling: 'preserve',
        replaceUrl: true
      });
    }
    afterNextRender(
      () => {
        if (
          this.dossierTool() !== null ||
          this.selectedSponsorshipId() !== sponsorshipId
        )
          return;
        const trigger =
          returnTarget?.isConnected && returnTarget.getClientRects().length
            ? returnTarget
            : this.sponsorDetailPanel?.nativeElement.querySelector<HTMLElement>(
                `[data-og7="dossier-tool-toggle"][data-og7-id="${tool}"]`
              );
        if (!trigger) return;
        this.revealDossierControl(trigger);
        trigger.focus({ preventScroll: true });
        const rect = trigger.getBoundingClientRect();
        const visible = trigger.ownerDocument.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        if (!visible || !trigger.contains(visible))
          trigger.scrollIntoView({ block: 'center', behavior: 'instant' });
      },
      { injector: this.injector }
    );
  }

  openIdentityEditor(): void {
    if (this.dossierToolBusy()) return;
    this.sponsorEdit()?.open();
  }

  private revealDossierControl(target: HTMLElement | null | undefined): void {
    for (
      let parent = target?.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (parent.tagName === 'DETAILS')
        (parent as HTMLDetailsElement).open = true;
    }
  }

  openReviewNote(): void {
    this.sponsorNote()?.openNote();
  }

  openDossierSection(tab: SponsorDetailsTab): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { sponsorshipId: this.selectedSponsorshipId(), tab },
      queryParamsHandling: 'merge',
      fragment: 'dossier-' + tab
    });
  }

  openOverviewDestination(destination: OverviewDestination): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        sponsorshipId: this.selectedSponsorshipId(),
        tab: destination.tab
      },
      queryParamsHandling: 'merge',
      fragment: 'dossier-' + (destination.section ?? destination.tab)
    });
  }

  inspectGalleryServices(): void {
    const selected = this.selectedSponsorship();
    const dossier = this.progress();
    if (!selected || dossier?.contributionId !== selected.id) return;
    const obligations = dossier.commitment?.obligations ?? [];
    const obligation =
      obligations.find(
        (item) => item.state !== 'fulfilled' && item.state !== 'adjusted'
      ) ?? obligations[0];
    if (!obligation) {
      this.openDossierSection('publication');
      return;
    }
    void this.router.navigate(['/admin/fundraiser/preflight'], {
      queryParams: {
        view: 'desk',
        sponsorshipId: selected.id,
        obligationId: obligation.id
      }
    });
  }

  private readonly sponsorNote = viewChild(AdminSponsorNoteComponent);
  readonly sponsorAccess = viewChild(AdminSponsorshipAccessComponent);
  private readonly sponsorProgress = viewChild(
    AdminSponsorshipProgressComponent
  );
  private readonly sponsorLibrary = viewChild(AdminSponsorDetailMediaComponent);
  private readonly i18n = inject(FundingI18nService);
  private readonly confirmation = inject(AdminConfirmationService);
  private readonly moderation = inject(FundingModerationService);
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
  readonly canManage = computed(() => this.admin.identity()?.role !== 'reader');
  readonly canUseOwnerActions = computed(
    () => !this.admin.identity() || this.admin.identity()?.role === 'owner'
  );
  readonly actionsDisabled = computed(
    () =>
      !this.canManage() ||
      this.state() === 'loading' ||
      this.actionState() !== null ||
      this.admin.mediaMutationBusy() ||
      this.versionConflict()
  );
  private readonly route = inject(ActivatedRoute);
  readonly websiteSettingsFragment = toSignal(this.route.fragment);
  private readonly actionParams = toSignal(this.route.queryParamMap);
  private consumingDossierAction = false;
  private readonly viewport = inject(ViewportScroller);
  private readonly destroyRef = inject(DestroyRef);
  @ViewChild('sponsorDetailPanel')
  private readonly sponsorDetailPanel?: ElementRef<HTMLElement>;

  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private assistantReturnFocus = this.router.currentNavigation()?.extras.info;
  private readonly assistantReturnReady = signal(false);
  private readonly layout = viewChild(AdminLayoutComponent);
  readonly assistantNavigation = computed(() => {
    const id = this.selectedSponsorshipId();
    return id ? new AssistantDossierNavigation(id, 'dossier') : undefined;
  });

  assistantQueryParams(): { sponsorshipId?: string; returnTo?: string } {
    return assistantDossierQuery(
      this.router,
      this.router.url,
      this.selectedSponsorshipId()
    );
  }

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
    moderate: (subject, level, initial) =>
      this.moderation.requestDecision(subject, level, initial),
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
  readonly mediaWorkflow: AdminSponsorMediaWorkflow =
    new AdminSponsorMediaWorkflow(
      {
        ...this.sponsorActionPorts,
        canContinue: (sponsorship) =>
          !this.destroyRef.destroyed &&
          this.canManage() &&
          this.state() !== 'loading' &&
          !this.versionConflict() &&
          this.selectedSponsorship()?.id === sponsorship.id &&
          this.selectedSponsorship()?.version === sponsorship.version,
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
          updateSponsorMediaMetadata: (token, payload) =>
            this.admin.updateSponsorMediaMetadata(token, payload),
          deleteSponsorMedia: (token, payload) =>
            this.admin.deleteSponsorMedia(token, payload)
        },
        confirm: (message) => this.confirmation.confirm(message),
        moderate: (subject, level, initial) =>
          this.moderation.requestDecision(subject, level, initial),
        isBrowser: () => isPlatformBrowser(this.platformId),
        mediaLoaded: () => this.assistantRefresh.update((value) => value + 1)
      },
      { eagerMediaPreviews: false }
    );

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

  focusRefreshedFacts(source: HTMLElement): void {
    const sponsorshipId = this.selectedSponsorshipId();
    const tab = this.activeTab();
    afterNextRender(
      () => {
        if (
          this.destroyRef.destroyed ||
          this.selectedSponsorshipId() !== sponsorshipId ||
          this.activeTab() !== tab ||
          source.ownerDocument.activeElement !== source
        )
          return;
        const panel = this.sponsorDetailPanel?.nativeElement;
        const target =
          panel?.querySelector<HTMLElement>('[data-og7="dossier-facts"]') ??
          panel;
        target?.focus({ preventScroll: true });
      },
      { injector: this.injector }
    );
  }
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
  readonly selectedSponsorOverview = computed(() => {
    const selected = this.selectedSponsorship();
    const progress = this.progress();
    return projectSponsorOverview({
      dossier:
        selected && progress?.contributionId === selected.id ? progress : null,
      media:
        selected &&
        this.mediaWorkflow.sponsorMediaReadState()[selected.id] === 'ready'
          ? (this.mediaWorkflow.sponsorMedia()[selected.id] ?? null)
          : null,
      canManage: this.canManage(),
      canUseOwnerActions: this.canUseOwnerActions()
    });
  });
  readonly selectedSponsorNote = computed(() => {
    const selected = this.selectedSponsorship();
    return selected
      ? this.presentationProjection.note(selected, {
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
            dateTime: entry.date,
            dateTimeLabel: this.dateTimeLabel(entry.date),
            label: entry.label,
            detail: entry.detail,
            stateClass: history.refundHistoryEntryClass(entry)
          })),
        auditEntries: history.refundAuditEntriesFor(selected).map((entry) => ({
          id: entry.id,
          dateTime: entry.date,
          dateTimeLabel: this.dateTimeLabel(entry.date),
          label: entry.label,
          detail: entry.detail,
          actorLabel: entry.actorLabel,
          domain: entry.domain,
          actorDetail: entry.actorDetail
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
                dateTime: entry.date,
                dateTimeLabel: this.dateTimeLabel(entry.date),
                label: entry.label,
                detail: entry.detail,
                actorLabel: entry.actorLabel,
                domain: entry.domain,
                actorDetail: entry.actorDetail
              }))
          }
        : null;
    });
  readonly hasActiveFilters = this.listController.hasActiveFilters;
  readonly visibleCount = this.listController.visibleCount;
  readonly activeCount = this.listController.activeCount;
  readonly pendingReviewCount = computed(
    () =>
      this.sponsorships().filter(
        (item) => item.sponsor_review_status === 'pending_review'
      ).length
  );
  private readonly pendingSection = this.listController.pendingSection;

  private readonly navigationAdapter = new AdminSponsorsNavigationAdapter({
    preserveTabLayout: (tab) => this.preserveTabLayout(tab),
    controller: this.listController,
    selectedSponsorshipId: () => this.selectedSponsorshipId(),
    currentUrl: () => this.router.url,
    currentNavigation: () => this.router.currentNavigation(),
    parseUrl: (url) => this.router.parseUrl(url)
  });

  constructor() {
    afterRenderEffect(() => {
      if (
        this.reservedDossierHeight() === null ||
        !this.layoutNavigationSettled()
      )
        return;
      if (!this.selectedSponsorshipId() || this.state() === 'error') {
        this.reservedDossierHeight.set(null);
        return;
      }
      if (
        this.state() === 'loading' ||
        this.sponsorProgress()?.state() === 'loading'
      )
        return;
      if (this.activeTab() === 'media' && !this.sponsorLibrary()?.layoutReady())
        return;
      // Keep the captured viewport valid while the two lazy gallery layers mount.
      // Releasing the reserve lets the browser apply the legitimate final clamp.
      this.reservedDossierHeight.set(null);
    });
    effect(() => {
      const language = this.i18n.currentLanguage();
      untracked(() => {
        const { adminOverrides, ...schedule } =
          language === 'en' ? enPublication : frPublication;
        this.i18n.mergeTranslations(language, adminOverrides);
        this.i18n.mergeTranslations(language, {
          admin: {
            finance: language === 'en' ? enFinance : frFinance,
            dossier: {
              ...(language === 'en' ? enProfile : frProfile),
              overviewDashboard: language === 'en' ? enOverview : frOverview,
              publicationBridge: { schedule }
            },
            history: language === 'en' ? enHistory : frHistory,
            sponsorsCleanup: language === 'en' ? enCleanup : frCleanup,
            dossierAssistance: language === 'en' ? enAssistance : frAssistance
          }
        });
      });
    });
    let toolSelection: string | null = null;
    let toolTab = this.activeTab();
    let toolSessionKey = this.dossierToolSessionKey();
    effect(() => {
      const selectedId = this.selectedSponsorshipId();
      const tab = this.activeTab();
      const sessionKey = this.dossierToolSessionKey();
      const resetTools =
        selectedId !== toolSelection || sessionKey !== toolSessionKey;
      if (resetTools) this.visitedDossierTools.set(new Set());
      if (resetTools || (tab !== toolTab && !this.dossierToolBusy())) {
        this.dossierTool.set(null);
        toolSelection = selectedId;
        toolTab = tab;
        toolSessionKey = sessionKey;
      }
      const tool = this.dossierTool();
      if (
        (tool === 'access' && !this.canUseOwnerActions()) ||
        (tool === 'moderation' && !this.canManage())
      ) {
        this.dossierTool.set(null);
      }
    });
    let agreementRoute = '';
    afterRenderEffect(() => {
      const fragment = this.websiteSettingsFragment();
      const sponsorshipId = this.selectedSponsorshipId();
      const session = this.dossierToolSessionKey();
      const requested = [
        'dossier-agreement',
        'dossier-assistance-source',
        'dossier-assistance-review'
      ].includes(fragment ?? '');
      const key = requested ? `${sponsorshipId}:${session}:${fragment}` : '';
      if (!requested) {
        agreementRoute = '';
        return;
      }
      if (
        key === agreementRoute ||
        this.state() !== 'ready' ||
        !sponsorshipId ||
        this.progress()?.contributionId !== sponsorshipId ||
        this.activeTab() !== 'publication'
      )
        return;
      untracked(() => {
        if (this.dossierToolBusy()) return;
        agreementRoute = key;
        this.openDossierTool('agreement', false);
      });
    });
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
      const params = this.actionParams();
      const action = params?.get('action');
      if (
        (action !== 'edit-identity' && action !== 'followup-access') ||
        this.state() !== 'ready' ||
        this.dossierToolBusy()
      )
        return;
      const sponsorshipId = params?.get('sponsorshipId') ?? null;
      const validContext =
        !!sponsorshipId &&
        params?.get('tab') === 'identity' &&
        this.selectedSponsorship()?.id === sponsorshipId &&
        this.activeTab() === 'identity';
      untracked(
        () =>
          void this.consumeIdentityAction(action, sponsorshipId, validContext)
      );
    });
    afterRenderEffect(() => {
      const focus = this.assistantReturnFocus;
      if (
        focus instanceof AssistantDossierNavigation &&
        this.assistantReturnReady() &&
        this.state() === 'ready' &&
        this.selectedSponsorship()?.id === focus.sponsorshipId &&
        this.sponsorProgress()?.state() !== 'loading'
      ) {
        const link =
          this.sponsorDetailPanel?.nativeElement.querySelector<HTMLElement>(
            '[data-og7="dossier-assistant"]'
          );
        const restored =
          focus.source === 'shell'
            ? this.layout()?.restoreAssistantFocus()
            : !!link;
        if (!restored) return;
        this.assistantReturnFocus = null;
        this.pendingSection.set(null);
        if (focus.source === 'dossier') {
          this.revealDossierControl(link);
          link?.focus({ preventScroll: true });
          link?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
        return;
      }
      const pending = this.pendingSection();
      if (
        !pending ||
        this.state() !== 'ready' ||
        this.selectedSponsorship()?.id !== pending.sponsorshipId ||
        this.activeTab() !== pending.tab ||
        this.sponsorProgress()?.state() === 'loading'
      )
        return;
      if (pending.tab === 'media' && !this.sponsorLibrary()?.languageReady())
        return;
      const element =
        this.sponsorDetailPanel?.nativeElement.querySelector<HTMLElement>(
          `#${pending.fragment}`
        );
      if (!element) return;
      this.pendingSection.set(null);
      this.revealDossierControl(element);
      // Resolve the new section's layout before native focus/scroll alignment.
      // Keep scrollIntoView so nested workspaces and CSS scroll margins apply.
      element.getBoundingClientRect();
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }

  /** Only an explicit, scoped identity intent may open the existing owner control. */
  private async consumeIdentityAction(
    action: 'edit-identity' | 'followup-access',
    sponsorshipId: string | null,
    validContext: boolean
  ): Promise<void> {
    if (this.consumingDossierAction) return;
    this.consumingDossierAction = true;
    try {
      const navigated = await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { action: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
        scroll: 'manual'
      });
      if (
        !navigated ||
        !validContext ||
        this.destroyRef.destroyed ||
        this.selectedSponsorship()?.id !== sponsorshipId ||
        this.activeTab() !== 'identity'
      )
        return;
      if (
        action === 'edit-identity' &&
        this.canManage() &&
        !this.actionsDisabled()
      ) {
        this.openIdentityEditor();
      }
      if (action === 'followup-access' && this.canUseOwnerActions())
        this.openFollowupAccess();
    } finally {
      this.consumingDossierAction = false;
    }
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
          this.assistantReturnFocus = null;
          this.assistantReturnReady.set(false);
        }
        if (event instanceof NavigationStart)
          this.layoutNavigationSettled.set(false);
        this.navigationAdapter.handleRouterEvent(event);
        if (event instanceof Scroll || event instanceof NavigationSkipped)
          this.layoutNavigationSettled.set(true);
        if (event instanceof Scroll) this.assistantReturnReady.set(true);
      });
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
    this.setActiveTab('publication');
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
