import { computed, signal } from '@angular/core';

import { AdminDashboardRequestError } from '../../services/funding-admin-session.js';

import type {
  AdminContributionsExportPorts,
  ContributionExportPhase
} from './admin-contributions.contracts.js';

/** A confirmation authorizes only its frozen, versioned selection. */
export class AdminContributionsExportWorkflow {
  readonly phase = signal<ContributionExportPhase>('idle');
  readonly exporting = computed(() => this.phase() === 'request');
  readonly error = signal('');
  private disposed = false;

  constructor(private readonly ports: AdminContributionsExportPorts) {}

  async exportCsv(): Promise<void> {
    if (
      this.disposed ||
      !this.ports.ready() ||
      this.phase() !== 'idle' ||
      !this.ports.canExport() ||
      !this.ports.contributions().length
    )
      return;

    const contributions = this.ports.contributions().map((row) => ({
      id: row.id,
      expectedVersion: row.updated_at
    }));
    const revision = this.ports.scopeRevision();
    const token = this.ports.token();
    const scopeIsCurrent = () =>
      !this.disposed &&
      revision === this.ports.scopeRevision() &&
      token === this.ports.token() &&
      this.ports.ready() &&
      this.ports.canExport();

    this.phase.set('confirmation');
    this.clearError();
    try {
      if (
        !(await this.ports.confirmation.confirm(
          this.ports.t(
            contributions.length === 1
              ? 'admin.contributionsExport.confirmOne'
              : 'admin.contributionsExport.confirm',
            { count: contributions.length }
          )
        )) ||
        !scopeIsCurrent()
      )
        return;

      this.phase.set('request');
      const csv = await this.ports.admin.getContributionsCsv(token, {
        confirmation: 'export_private_contributions',
        contributions
      });
      if (!scopeIsCurrent()) return;
      this.ports.saveCsv(csv);
    } catch (error) {
      if (!scopeIsCurrent()) return;
      const status =
        error instanceof AdminDashboardRequestError ? error.status : 0;
      if (status === 401) this.ports.unauthorized?.();
      this.error.set(
        `admin.contributionsExport.${status === 409 ? 'changed' : status === 403 ? 'forbidden' : status === 401 ? 'sessionExpired' : 'failed'}`
      );
    } finally {
      if (!this.disposed) this.phase.set('idle');
    }
  }

  clearError(): void {
    if (!this.disposed) this.error.set('');
  }

  dispose(): void {
    this.disposed = true;
  }
}
