import { computed, signal } from '@angular/core';
import type { AdminContributionsResponse } from '@openg7/funding-core';

import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

import type {
  AdminContributionsReadPorts,
  ContributionsReadState
} from './admin-contributions.contracts.js';
import type {
  ContributionTypeFilter,
  PublicDisplayFilter
} from './admin-contributions-view.js';

/** Reads and filter transitions own the lifetime of the displayed selection. */
export class AdminContributionsController {
  readonly data = signal<AdminContributionsResponse | null>(null);
  readonly state = signal<ContributionsReadState>('idle');
  readonly search = signal('');
  readonly selectedContributionId = signal<string | null>(null);
  readonly typeFilter = signal<ContributionTypeFilter>('all');
  readonly statusFilter = signal('all');
  readonly publicFilter = signal<PublicDisplayFilter>('all');
  readonly scopeRevision = signal(0);
  readonly contributions = computed(() => this.data()?.contributions ?? []);
  readonly selectedContribution = computed(() => {
    const selectedId = this.selectedContributionId();
    return this.contributions().find((item) => item.id === selectedId) ?? null;
  });
  readonly filteredContributions = computed(() => {
    const search = this.search().trim().toLowerCase();
    const typeFilter = this.typeFilter();
    const statusFilter = this.statusFilter();
    const publicFilter = this.publicFilter();

    return this.contributions().filter((contribution) => {
      const searchable = [
        contribution.id,
        contribution.public_reference,
        contribution.public_name,
        contribution.email_private,
        contribution.sponsor_company_name,
        contribution.sponsor_contact_name,
        contribution.sponsor_contact_email,
        contribution.stripe_session_id,
        contribution.stripe_payment_intent_id
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return (
        (!search || searchable.includes(search)) &&
        (typeFilter === 'all' ||
          contribution.contribution_type === typeFilter) &&
        (statusFilter === 'all' ||
          contribution.payment_status === statusFilter) &&
        (publicFilter === 'all' ||
          (publicFilter === 'public'
            ? contribution.public_display_consent
            : !contribution.public_display_consent))
      );
    });
  });
  private generation = 0;
  private disposed = false;
  private contributionId: string | undefined;
  private exportAccess: boolean;

  constructor(private readonly ports: AdminContributionsReadPorts) {
    this.exportAccess = ports.canExport();
  }

  setRouteContribution(contributionId: string | null): void {
    if (this.disposed) return;
    ++this.generation;
    this.invalidateExportScope();
    this.contributionId = contributionId ?? undefined;
    this.selectedContributionId.set(contributionId?.trim() || null);
    this.search.set('');
    this.typeFilter.set('all');
    this.statusFilter.set('all');
    this.publicFilter.set('all');
    this.data.set(null);
  }

  async load(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    const accessRevision = this.ports.accessRevision();
    this.invalidateExportScope();
    const token = this.ports.token();
    this.state.set('loading');
    try {
      const response = await this.ports.admin.getContributions(
        token,
        this.contributionId
      );
      if (!this.currentAccess(generation, accessRevision)) return;
      this.data.set(response);
      this.state.set('ready');
      this.ports.admin.saveAdminToken(token);
    } catch (error) {
      if (!this.currentAccess(generation, accessRevision)) return;
      if (
        error instanceof AdminDashboardRequestError &&
        (error.status === 401 || error.status === 403)
      ) {
        this.notifyAccessChanged();
        if (error.status === 401) this.ports.unauthorized();
      }
      this.state.set('error');
    }
  }

  setSearch(value: string): void {
    if (this.disposed || value === this.search()) return;
    this.invalidateExportScope();
    this.search.set(value);
  }

  setTypeFilter(value: ContributionTypeFilter): void {
    if (this.disposed || value === this.typeFilter()) return;
    this.invalidateExportScope();
    this.typeFilter.set(value);
  }

  setStatusFilter(value: string): void {
    if (this.disposed || value === this.statusFilter()) return;
    this.invalidateExportScope();
    this.statusFilter.set(value);
  }

  setPublicFilter(value: PublicDisplayFilter): void {
    if (this.disposed || value === this.publicFilter()) return;
    this.invalidateExportScope();
    this.publicFilter.set(value);
  }

  selectContribution(contributionId: string): void {
    if (this.disposed) return;
    this.invalidateExportScope();
    this.selectedContributionId.set(contributionId);
  }

  /** Notification preserves access transitions even when the role is restored. */
  notifyAccessChanged(): void {
    if (this.disposed) return;
    ++this.generation;
    this.data.set(null);
    this.selectedContributionId.set(null);
    this.state.set('idle');
    this.search.set('');
    this.exportAccess = this.ports.canExport();
    this.invalidateExportScope();
  }

  /** Sample current access at action boundaries as well as page notifications. */
  exportScopeRevision(): number {
    if (this.exportAccess !== this.ports.canExport()) {
      this.notifyAccessChanged();
    }
    return this.scopeRevision();
  }

  invalidateExportScope(): void {
    if (!this.disposed) this.scopeRevision.update((revision) => revision + 1);
  }

  dispose(): void {
    if (this.disposed) return;
    this.invalidateExportScope();
    this.disposed = true;
    ++this.generation;
  }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private currentAccess(generation: number, accessRevision: number): boolean {
    if (!this.current(generation)) return false;
    if (accessRevision === this.ports.accessRevision()) return true;
    this.notifyAccessChanged();
    return false;
  }
}
