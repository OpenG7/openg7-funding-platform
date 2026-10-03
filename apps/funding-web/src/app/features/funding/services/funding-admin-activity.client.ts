import type { ContributionActivityResponse } from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';

/** Funding admin contribution activity and presentation claims. Authentication belongs to the shared session. */
export class FundingAdminActivityClient {
  constructor(
    private readonly session: FundingAdminSession,
    private readonly clearAdminSession: () => void
  ) {}

  async contributionActivity(
    query: { before?: string; after?: string; id?: string } = {}
  ): Promise<ContributionActivityResponse> {
    return this.activityRequest('?' + new URLSearchParams(query));
  }

  async claimContributionToasts(ids: string[]): Promise<{ ids: string[] }> {
    return this.activityRequest('/present', { ids });
  }

  private async activityRequest<T>(path: string, body?: object): Promise<T> {
    const response = await this.session.requestAdminJson(
      `/admin/contribution-activity${path}`,
      {
        auth: 'saved',
        method: body ? 'POST' : 'GET',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(10000)
      }
    );
    if (!response.ok) {
      if (response.status === 401) this.clearAdminSession();
      throw new AdminDashboardRequestError(
        response.status,
        'ACTIVITY_UNAVAILABLE'
      );
    }
    return response.json() as Promise<T>;
  }
}
