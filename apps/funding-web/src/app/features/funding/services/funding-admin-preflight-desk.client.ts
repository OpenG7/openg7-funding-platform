import type {
  PreflightDeskQuery,
  PreflightDeskResponse
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';

/** Read-only projection of Funding's existing promised-service records. */
export class FundingAdminPreflightDeskClient {
  constructor(
    private readonly session: FundingAdminSession,
    private readonly clearSession: () => void
  ) {}

  async read(
    query: PreflightDeskQuery,
    signal?: AbortSignal
  ): Promise<PreflightDeskResponse> {
    const generation = this.session.sessionGeneration();
    const params = new URLSearchParams({
      page: String(query.page),
      pageSize: String(query.pageSize),
      stage: query.stage
    });
    if (query.search) params.set('search', query.search);
    const cancellation = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000);
    const response = await this.session.requestAdminJson(
      `/admin/preflight/desk?${params}`,
      {
        auth: 'saved',
        cache: 'no-store',
        signal: cancellation,
        abortBeforeFetch: true
      }
    );
    if (!response.ok) {
      if (
        response.status === 401 &&
        !cancellation.aborted &&
        generation === this.session.sessionGeneration()
      )
        this.clearSession();
      throw new AdminDashboardRequestError(response.status);
    }
    const body = (await response.json()) as PreflightDeskResponse | null;
    const summary = body?.summary;
    if (
      !body ||
      !summary ||
      !Array.isArray(body.orders) ||
      !body.pagination ||
      ![
        summary.total,
        summary.toPrepare,
        summary.toReview,
        summary.toDeliver,
        summary.delivered,
        summary.excludedAdjusted,
        summary.orders
      ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      summary.total !==
        summary.toPrepare +
          summary.toReview +
          summary.toDeliver +
          summary.delivered ||
      summary.scope !== 'recorded_promised_services' ||
      !Number.isFinite(Date.parse(body.generatedAt))
    ) {
      throw new AdminDashboardRequestError(502);
    }
    return body;
  }
}
