import type {
  AdminSearchRequest,
  AdminSearchResponse,
  AdminStripeEventResponse,
  AdminCockpitMetrics,
  AdminCockpitActivity,
  AdminCockpitSystems,
  AdminAuditLogResponse,
  AdminDashboardResponse
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';

/** Funding admin dashboard, cockpit and protected inspection endpoints. Authentication belongs to the shared session. */
export class FundingAdminDiagnosticsClient {
  constructor(private readonly session: FundingAdminSession) {}

  async getDashboard(token: string): Promise<AdminDashboardResponse> {
    return this.session.requestAdminData('/admin/dashboard', {
      auth: { token },
      method: 'GET'
    });
  }

  async getCockpit<T extends 'metrics' | 'activity' | 'systems'>(
    block: T,
    token: string
  ): Promise<
    {
      metrics: AdminCockpitMetrics;
      activity: AdminCockpitActivity;
      systems: AdminCockpitSystems;
    }[T]
  > {
    return this.session.requestAdminData(`/admin/cockpit/${block}`, {
      auth: { token }
    });
  }

  async getStripeEvent(
    token: string,
    eventId: string
  ): Promise<AdminStripeEventResponse> {
    return this.session.requestAdminData(
      `/admin/stripe-event?${new URLSearchParams({ eventId })}`,
      {
        auth: { token },
        cache: 'no-store'
      }
    );
  }

  async search(
    token: string,
    query: AdminSearchRequest,
    signal: AbortSignal
  ): Promise<AdminSearchResponse> {
    const response = await this.session.requestAdminJson('/admin/search', {
      auth: { token },
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: query,
      signal,
      cache: 'no-store',
      abortBeforeFetch: true
    });
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return (await response.json()) as AdminSearchResponse;
  }

  async getAuditLog(
    token: string,
    entryId?: string
  ): Promise<AdminAuditLogResponse> {
    const response = await this.session.requestAdminJson(
      `/admin/audit-log${entryId ? '?entryId=' + encodeURIComponent(entryId) : ''}`,
      { auth: { token }, method: 'GET', cache: 'no-store' }
    );

    if (!response.ok) {
      throw new Error('Admin audit log could not be loaded.');
    }

    return (await response.json()) as AdminAuditLogResponse;
  }
}
