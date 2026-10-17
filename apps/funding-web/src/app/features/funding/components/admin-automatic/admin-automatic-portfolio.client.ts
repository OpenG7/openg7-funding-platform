import type {
  AdminAutomaticRun,
  AdminAutomaticRunReport,
  AdminAutomaticRunState,
  AdminPreparationReceipt,
  AdminPreparationApproveRequest
} from '@openg7/funding-core';

import type { FundingAdminService } from '../../services/funding-admin.service.js';

/** Optional admin client: session transport owns authentication and never retries. */
export class AdminAutomaticPortfolioClient {
  constructor(private readonly admin: FundingAdminService) {}

  read(runId?: string): Promise<AdminAutomaticRunState> {
    return this.request(runId ? '?' + new URLSearchParams({ runId }) : '');
  }

  start(): Promise<AdminAutomaticRunState> {
    return this.request('', {
      requestId: crypto.randomUUID()
    });
  }

  advance(run: AdminAutomaticRun): Promise<AdminAutomaticRunState> {
    return this.request('/advance', this.command(run));
  }

  control(
    run: AdminAutomaticRun,
    action: 'pause' | 'resume' | 'recheck' | 'reconcile'
  ): Promise<AdminAutomaticRunState> {
    return this.request('/control', {
      ...this.command(run),
      action
    });
  }

  report(runId: string, after?: number): Promise<AdminAutomaticRunReport> {
    const query = new URLSearchParams({ runId, limit: '50' });
    if (after !== undefined) query.set('after', String(after));
    return this.request('/report?' + query);
  }

  preparation(
    runId: string,
    position: number
  ): Promise<AdminPreparationReceipt> {
    return this.request(
      '/preparation?' +
        new URLSearchParams({ runId, position: String(position) })
    );
  }

  approvePreparation(
    input: AdminPreparationApproveRequest
  ): Promise<AdminPreparationReceipt> {
    return this.request('/preparation/approve', input);
  }

  private async request<T>(suffix: string, body?: object): Promise<T> {
    try {
      const response = await this.admin.automaticRunRequest(suffix, body);
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          code?: unknown;
        } | null;
        throw Object.assign(new Error('AUTOMATIC_RUN_REQUEST_FAILED'), {
          status: response.status,
          code: typeof payload?.code === 'string' ? payload.code : undefined
        });
      }
      return response.json() as Promise<T>;
    } catch (error) {
      if ((error as { status?: number } | null)?.status === 401)
        this.admin.clearAdminSession();
      throw error;
    }
  }

  private command(run: AdminAutomaticRun) {
    return {
      runId: run.id,
      requestId: crypto.randomUUID(),
      expectedVersion: run.version
    };
  }
}
