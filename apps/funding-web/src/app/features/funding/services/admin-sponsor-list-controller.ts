import { computed, signal } from '@angular/core';
import type {
  AdminPagination,
  AdminSponsorshipRecord,
  AdminSponsorshipProgress,
  SponsorFeedStatus
} from '@openg7/funding-core';

import type { SponsorshipApprovalFeedback } from '../models/admin-sponsor-workflow.ports.js';
import type {
  AdminSponsorFeedStatusOption,
  SponsorDetailsTab,
  SponsorFeedStatusFilter,
  SponsorPaymentStatusFilter,
  SponsorshipReviewFilter
} from '../models/admin-sponsors-ui.models.js';

import type { FundingAdminService } from './funding-admin.service.js';

export interface AdminSponsorDossierSection {
  readonly fragment: string;
  readonly sponsorshipId: string;
  readonly tab: SponsorDetailsTab;
}

/** Route and DOM adapters stay on the routed page. No browser access at construction. */
export interface AdminSponsorListNavigationPorts {
  getScrollPosition(): [number, number];
  scrollToPosition(position: [number, number]): void;
  hasPendingNavigation(): boolean;
  navigateDossier(id: string | null, tab: SponsorDetailsTab | null): void;
  afterRender(callback: () => void): void;
  focusDossier(): void;
  focusListRow(id: string | null): void;
}

/** Existing workflows remain owners of drafts, media and mutation decisions. */
export interface AdminSponsorListPorts {
  admin: Pick<
    FundingAdminService,
    | 'getSponsorships'
    | 'getSavedAdminToken'
    | 'saveAdminToken'
    | 'selectSponsorship'
    | 'refreshWorkQueue'
  >;
  t(key: string, params?: Record<string, unknown>): string;
  navigation: AdminSponsorListNavigationPorts;
  reconcile(
    previous: readonly AdminSponsorshipRecord[],
    current: readonly AdminSponsorshipRecord[],
    preserveDrafts: boolean
  ): void;
  loadLogoPreviews(
    sponsorships: readonly AdminSponsorshipRecord[]
  ): Promise<void>;
  loadSponsorMedia(id: string | null): Promise<void>;
  closeDecisionPanels(): void;
  messageFromError(error: unknown, fallback: string): string;
}

const feedStatuses: readonly SponsorFeedStatus[] = [
  'not_planned',
  'planned',
  'drafted',
  'published'
];
const pageSizeOptions = [6, 10, 25] as const;
const defaultPagination: AdminPagination = {
  page: 1,
  pageSize: 6,
  totalItems: 0,
  totalPages: 1,
  hasPreviousPage: false,
  hasNextPage: false
};
const dossierTabs: readonly SponsorDetailsTab[] = [
  'overview',
  'identity',
  'media',
  'publication',
  'billing',
  'refund',
  'audit'
];

/** Per-page listing and dossier lifetime; all server facts come from FundingAdminService. */
export class AdminSponsorListController {
  readonly adminToken = signal('');
  readonly sponsorships = signal<readonly AdminSponsorshipRecord[]>([]);
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly actionState = signal<string | null>(null);
  readonly approvalFeedback = signal<SponsorshipApprovalFeedback | null>(null);
  readonly search = signal('');
  readonly reviewFilter = signal<SponsorshipReviewFilter>('all');
  readonly feedFilter = signal<SponsorFeedStatusFilter>('all');
  readonly paymentFilter = signal<SponsorPaymentStatusFilter>('all');
  readonly assistantRefresh = signal(0);
  readonly progress = signal<AdminSponsorshipProgress | null>(null);
  readonly websiteSettingsOpen = signal(false);
  readonly versionConflict = signal(false);
  readonly selectedSponsorshipId = signal<string | null>(null);
  readonly activeTab = signal<SponsorDetailsTab>('overview');
  readonly page = signal(1);
  readonly pageSize = signal(6);
  readonly pagination = signal<AdminPagination>(defaultPagination);
  readonly selectionPulseId = signal<string | null>(null);
  readonly copyMessages = signal<Record<string, string>>({});
  readonly pendingSection = signal<AdminSponsorDossierSection | null>(null);
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
    const id = this.selectedSponsorshipId();
    return id
      ? (this.sponsorships().find((item) => item.id === id) ?? null)
      : null;
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

  private loadGeneration = 0;
  private routeInitialized = false;
  private disposed = false;
  private revision = 0;
  private listPosition: [number, number] = [0, 0];
  private selectionPulseTimer: ReturnType<typeof setTimeout> | null = null;
  private approvalFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTabScroll: { id: number; position: [number, number] } | null =
    null;

  constructor(private readonly ports: AdminSponsorListPorts) {}

  initialize(): void {
    if (!this.disposed)
      this.adminToken.set(this.ports.admin.getSavedAdminToken());
  }

  selectionRevision(): number {
    return this.revision;
  }

  isCurrentSelection(id: string): boolean {
    return !this.disposed && this.selectedSponsorshipId() === id;
  }

  applyRouteSelection(id: string | null, tab: string | null): void {
    if (this.disposed) return;
    const sponsorshipId = id?.trim() || null;
    this.activeTab.set(
      dossierTabs.includes(tab as SponsorDetailsTab)
        ? (tab as SponsorDetailsTab)
        : 'overview'
    );
    if (this.routeInitialized && sponsorshipId === this.selectedSponsorshipId())
      return;
    const alreadyLoaded = this.sponsorships().some(
      (item) => item.id === sponsorshipId
    );
    this.setSelectedSponsorshipId(sponsorshipId);
    this.ports.admin.selectSponsorship(sponsorshipId);
    if (this.routeInitialized && (!sponsorshipId || alreadyLoaded)) {
      void this.ports.loadSponsorMedia(sponsorshipId);
      return;
    }
    this.routeInitialized = true;
    this.search.set(sponsorshipId ?? '');
    this.page.set(1);
    void this.loadSponsorships();
  }

  async loadSponsorships(preserveDrafts = false): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.loadGeneration;
    this.state.set('loading');
    try {
      const response = await this.ports.admin.getSponsorships(
        this.adminToken(),
        {
          page: this.page(),
          pageSize: this.pageSize(),
          search: this.search(),
          reviewStatus: this.reviewFilter(),
          feedStatus: this.feedFilter(),
          paymentStatus: this.paymentFilter(),
          sort: 'priority',
          direction: 'desc'
        }
      );
      if (generation !== this.loadGeneration || this.disposed) return;
      const sponsorships = response.items ?? response.sponsorships;
      this.ports.reconcile(this.sponsorships(), sponsorships, preserveDrafts);
      this.versionConflict.set(false);
      this.sponsorships.set(sponsorships);
      this.assistantRefresh.update((value) => value + 1);
      this.pagination.set(response.pagination ?? defaultPagination);
      this.page.set(response.pagination?.page ?? this.page());
      if (
        this.selectedSponsorshipId() &&
        !sponsorships.some((item) => item.id === this.selectedSponsorshipId())
      ) {
        this.setSelectedSponsorshipId(null);
      }
      if (this.selectedSponsorshipId())
        this.ports.admin.selectSponsorship(this.selectedSponsorshipId());
      void this.ports.admin.refreshWorkQueue();
      this.state.set('ready');
      this.saveToken();
      void this.ports.loadLogoPreviews(sponsorships);
      void this.ports.loadSponsorMedia(this.selectedSponsorshipId());
    } catch (error) {
      if (generation !== this.loadGeneration || this.disposed) return;
      this.sponsorships.set([]);
      this.progress.set(null);
      this.ports.messageFromError(error, '');
      this.state.set('error');
    }
  }

  setSearchValue(value: string): void {
    if (this.disposed) return;
    this.search.set(value);
    this.reloadFirstPage();
  }
  setReviewFilterValue(value: string): void {
    if (this.disposed) return;
    this.reviewFilter.set(
      value === 'pending_review' || value === 'approved' || value === 'rejected'
        ? value
        : 'all'
    );
    this.reloadFirstPage();
  }
  setFeedFilterValue(value: string): void {
    if (this.disposed) return;
    this.feedFilter.set(
      value === 'not_planned' ||
        value === 'planned' ||
        value === 'drafted' ||
        value === 'published'
        ? value
        : 'all'
    );
    this.reloadFirstPage();
  }
  setPaymentFilterValue(value: string): void {
    if (this.disposed) return;
    this.paymentFilter.set(
      value === 'paid' || value === 'refunded' || value === 'disputed'
        ? value
        : 'all'
    );
    this.reloadFirstPage();
  }
  resetFilters(): void {
    if (this.disposed) return;
    this.search.set('');
    this.reviewFilter.set('all');
    this.feedFilter.set('all');
    this.paymentFilter.set('all');
    this.reloadFirstPage();
  }
  setPageSizeValue(value: number): void {
    if (this.disposed) return;
    this.pageSize.set(
      pageSizeOptions.some((size) => size === value) ? value : 6
    );
    this.reloadFirstPage();
  }
  previousPage(): void {
    if (this.disposed) return;
    this.page.set(Math.max(1, this.normalizedPage() - 1));
    void this.loadSponsorships();
  }
  nextPage(): void {
    if (this.disposed) return;
    this.page.set(Math.min(this.totalPages(), this.normalizedPage() + 1));
    void this.loadSponsorships();
  }

  adjacentDossier(direction: -1 | 1): string | null {
    const rows = this.sponsorships();
    const index = rows.findIndex(
      (item) => item.id === this.selectedSponsorshipId()
    );
    return index < 0 ? null : (rows[index + direction]?.id ?? null);
  }
  openAdjacentDossier(direction: -1 | 1): void {
    const id = this.adjacentDossier(direction);
    if (id) this.selectSponsorshipById(id);
  }
  selectSponsorshipById(id: string): void {
    if (this.disposed) return;
    if (!this.selectedSponsorshipId())
      this.listPosition = this.ports.navigation.getScrollPosition();
    this.setSelectedSponsorshipId(id);
    this.ports.admin.selectSponsorship(id);
    this.ports.navigation.navigateDossier(id, this.activeTab());
    void this.ports.loadSponsorMedia(id);
    this.pulseSelection(id);
    this.scrollSelectedSponsorshipIntoView(id, this.revision);
  }
  closeDetails(): void {
    if (this.disposed) return;
    const previousId = this.selectedSponsorshipId();
    if (this.search() === previousId) {
      this.search.set('');
      void this.loadSponsorships();
    }
    this.setSelectedSponsorshipId(null);
    this.ports.admin.selectSponsorship(null);
    this.ports.navigation.navigateDossier(null, null);
    this.ports.closeDecisionPanels();
    const revision = this.revision;
    this.ports.navigation.afterRender(() => {
      if (
        this.disposed ||
        this.revision !== revision ||
        this.selectedSponsorshipId() !== null
      )
        return;
      this.ports.navigation.scrollToPosition(this.listPosition);
      this.ports.navigation.focusListRow(previousId);
    });
  }
  setActiveTab(tab: SponsorDetailsTab): void {
    if (this.disposed || tab === this.activeTab()) return;
    this.activeTab.set(tab);
    this.ports.navigation.navigateDossier(this.selectedSponsorshipId(), tab);
    if (tab === 'media')
      void this.ports.loadSponsorMedia(this.selectedSponsorshipId());
  }

  navigationStarted(id: number, preservePosition: boolean): void {
    if (this.disposed) return;
    this.pendingSection.set(null);
    this.pendingTabScroll = preservePosition
      ? { id, position: this.ports.navigation.getScrollPosition() }
      : null;
  }
  navigationCancelled(id: number): void {
    if (this.pendingTabScroll?.id === id) this.pendingTabScroll = null;
  }
  navigationScrolled(
    id: number,
    section: AdminSponsorDossierSection | null
  ): void {
    if (this.disposed || this.ports.navigation.hasPendingNavigation()) return;
    if (section) {
      this.pendingTabScroll = null;
      this.pendingSection.set(section);
      return;
    }
    const pending = this.pendingTabScroll;
    if (pending?.id !== id) return;
    // Run after the router's own Scroll subscriber, regardless of subscription order.
    queueMicrotask(() => {
      if (
        this.disposed ||
        this.ports.navigation.hasPendingNavigation() ||
        this.pendingTabScroll !== pending
      )
        return;
      this.pendingTabScroll = null;
      this.ports.navigation.scrollToPosition(pending.position);
    });
  }

  beginApprovalFeedback(id: string | null): SponsorshipApprovalFeedback | null {
    this.clearApprovalFeedback();
    if (this.disposed) return null;
    const attempt: SponsorshipApprovalFeedback | null = id
      ? { id, phase: 'pending' }
      : null;
    this.approvalFeedback.set(attempt);
    return attempt;
  }
  finishApprovalFeedback(
    attempt: SponsorshipApprovalFeedback,
    phase: 'success' | 'error'
  ): void {
    if (
      this.disposed ||
      this.approvalFeedback() !== attempt ||
      this.selectedSponsorshipId() !== attempt.id
    )
      return;
    this.approvalFeedback.set({ ...attempt, phase });
    this.approvalFeedbackTimer = setTimeout(
      () => this.clearApprovalFeedback(),
      3000
    );
  }
  clearApprovalFeedback(): void {
    if (this.approvalFeedbackTimer) clearTimeout(this.approvalFeedbackTimer);
    this.approvalFeedbackTimer = null;
    this.approvalFeedback.set(null);
  }
  pulseSelection(id: string): void {
    if (this.disposed) return;
    this.clearSelectionPulseTimer();
    this.selectionPulseId.set(null);
    this.selectionPulseTimer = setTimeout(() => {
      this.selectionPulseId.set(id);
      this.selectionPulseTimer = setTimeout(() => {
        if (this.selectionPulseId() === id) this.selectionPulseId.set(null);
        this.selectionPulseTimer = null;
      }, 520);
    }, 0);
  }

  async copyReference(sponsorship: AdminSponsorshipRecord): Promise<void> {
    if (this.disposed || !sponsorship.public_reference) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard)
        await navigator.clipboard.writeText(sponsorship.public_reference);
      if (!this.disposed)
        this.setCopyMessage(
          sponsorship.id,
          this.ports.t('admin.messages.reference_copiee')
        );
    } catch {
      if (!this.disposed)
        this.setCopyMessage(
          sponsorship.id,
          this.ports.t('admin.messages.copie_impossible')
        );
    }
  }
  feedStatusLabel(status: SponsorFeedStatus): string {
    if (status === 'published') return this.ports.t('admin.messages.publie');
    if (status === 'drafted') return this.ports.t('admin.legacy.brouillon');
    if (status === 'planned') return this.ports.t('admin.messages.planifie');
    return this.ports.t('admin.messages.non_planifie');
  }
  saveToken(): void {
    if (!this.disposed) this.ports.admin.saveAdminToken(this.adminToken());
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadGeneration += 1;
    this.pendingTabScroll = null;
    this.pendingSection.set(null);
    this.clearSelectionPulseTimer();
    this.selectionPulseId.set(null);
    this.clearApprovalFeedback();
  }

  private scrollSelectedSponsorshipIntoView(
    id: string,
    revision: number
  ): void {
    this.ports.navigation.afterRender(() => {
      if (this.isCurrentSelection(id) && this.revision === revision)
        this.ports.navigation.focusDossier();
    });
  }

  private reloadFirstPage(): void {
    this.page.set(1);
    void this.loadSponsorships();
  }
  private setSelectedSponsorshipId(id: string | null): void {
    if (this.selectedSponsorshipId() !== id) {
      this.revision += 1;
      this.clearSelectionPulseTimer();
      this.selectionPulseId.set(null);
      this.clearApprovalFeedback();
    }
    this.selectedSponsorshipId.set(id);
  }
  private clearSelectionPulseTimer(): void {
    if (this.selectionPulseTimer) clearTimeout(this.selectionPulseTimer);
    this.selectionPulseTimer = null;
  }
  private setCopyMessage(id: string, message: string): void {
    this.copyMessages.update((messages) => ({ ...messages, [id]: message }));
  }
}
