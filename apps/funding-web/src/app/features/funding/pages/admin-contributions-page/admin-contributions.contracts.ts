import type { AdminContributionRecord } from '@openg7/funding-core';

import type { AdminConfirmationService } from '../../services/admin-confirmation.service.js';
import type { FundingAdminService } from '../../services/funding-admin.service.js';

export type ContributionsReadState = 'idle' | 'loading' | 'ready' | 'error';
export type ContributionExportPhase = 'idle' | 'confirmation' | 'request';

export interface AdminContributionsReadPorts {
  readonly admin: Pick<
    FundingAdminService,
    'getContributions' | 'saveAdminToken'
  >;
  token(): string;
  canExport(): boolean;
}

/** Every scope transition invalidates a pending confirmation or private result. */
export interface AdminContributionsExportPorts {
  readonly admin: Pick<FundingAdminService, 'getContributionsCsv'>;
  readonly confirmation: Pick<AdminConfirmationService, 'confirm'>;
  token(): string;
  ready(): boolean;
  scopeRevision(): number;
  canExport(): boolean;
  contributions(): readonly AdminContributionRecord[];
  t(key: string, params?: Record<string, unknown>): string;
  saveCsv(csv: string): void;
}
