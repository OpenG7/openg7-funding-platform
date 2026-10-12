import type {
  SponsorshipHistoricalAuditFilter,
  SponsorshipHistoricalAuditPreview,
  SponsorshipHistoricalAuditReviewRequest,
  SponsorshipHistoricalAuditReviewResponse
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';

export interface HistoricalSponsorshipAuditQuery {
  readonly contributionId?: string;
  readonly finding?: SponsorshipHistoricalAuditFilter;
  readonly cursor?: string;
  readonly pageSize?: 25 | 50 | 100;
}
export class FundingAdminHistoricalAuditClient {
  constructor(private readonly session: FundingAdminSession) {}
  async preview(
    query: HistoricalSponsorshipAuditQuery
  ): Promise<SponsorshipHistoricalAuditPreview> {
    const params = new URLSearchParams({
      pageSize: String(query.pageSize ?? 25)
    });
    if (query.contributionId)
      params.set('contributionId', query.contributionId);
    if (query.finding) params.set('finding', query.finding);
    if (query.cursor) params.set('cursor', query.cursor);
    return this.session.requestAdminData(
      `/admin/sponsorship-commitments/historical-audit?${params}`,
      { auth: 'saved', cache: 'no-store' }
    );
  }
  async review(
    payload: SponsorshipHistoricalAuditReviewRequest
  ): Promise<SponsorshipHistoricalAuditReviewResponse> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorship-commitments/historical-audit/review',
      {
        auth: 'saved',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }
    );
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as {
        code?: unknown;
      } | null;
      throw new AdminDashboardRequestError(
        response.status,
        'Historical evidence review could not be recorded.',
        typeof error?.code === 'string' ? error.code : undefined
      );
    }
    return response.json();
  }
}
