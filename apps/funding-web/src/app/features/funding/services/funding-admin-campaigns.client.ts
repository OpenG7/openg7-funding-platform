import type {
  AdminCampaignsQuery,
  AdminCampaignsResponse
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';

/** Private read projection; promises and preparation remain owned by the API. */
export class FundingAdminCampaignsClient {
  constructor(
    private readonly session: Pick<FundingAdminSession, 'requestAdminJson'>
  ) {}

  async list(
    query: AdminCampaignsQuery,
    signal?: AbortSignal
  ): Promise<AdminCampaignsResponse> {
    const params = new URLSearchParams();
    for (const key of [
      'page',
      'pageSize',
      'channel',
      'target',
      'state',
      'search',
      'sort',
      'direction'
    ] as const) {
      const value = query[key];
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const response = await this.session.requestAdminJson(
      `/admin/campaigns?${params}`,
      { auth: 'saved', cache: 'no-store', signal, abortBeforeFetch: true }
    );
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as {
        code?: unknown;
      } | null;
      throw new AdminDashboardRequestError(
        response.status,
        'Campaigns could not be loaded.',
        typeof error?.code === 'string' ? error.code : undefined
      );
    }
    return response.json() as Promise<AdminCampaignsResponse>;
  }
}
