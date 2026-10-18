import type {
  SponsorMediaAnalysisRequest,
  SponsorMediaAnalysisReceipt,
  SponsorMediaAnalysisResponse,
  SponsorMediaAnalysisReviewRequest
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';
import { errorDetailsFromResponse } from './funding-admin-response.js';

/** No automatic POST replay; durable request ids are owned by the calling workspace. */
export class FundingAdminMediaAnalysisClient {
  constructor(private readonly session: FundingAdminSession) {}
  read(contributionId: string): Promise<SponsorMediaAnalysisResponse> {
    return this.request('?' + new URLSearchParams({ contributionId }));
  }
  receipt(
    contributionId: string,
    requestId: string
  ): Promise<SponsorMediaAnalysisReceipt> {
    return this.request<SponsorMediaAnalysisReceipt>(
      '/receipt?' + new URLSearchParams({ contributionId, requestId })
    );
  }
  start(
    request: SponsorMediaAnalysisRequest
  ): Promise<SponsorMediaAnalysisResponse> {
    return this.request('', request);
  }
  review(
    request: SponsorMediaAnalysisReviewRequest
  ): Promise<SponsorMediaAnalysisResponse> {
    return this.request('/review', request);
  }
  private async request<T = SponsorMediaAnalysisResponse>(
    suffix: string,
    body?: object
  ): Promise<T> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/media/analyses' + suffix,
      {
        auth: 'saved',
        method: body ? 'POST' : 'GET',
        cache: 'no-store',
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body }
          : {})
      }
    );
    if (!response.ok) {
      const details = await errorDetailsFromResponse(response);
      throw new AdminDashboardRequestError(
        response.status,
        undefined,
        details.code
      );
    }
    return response.json() as Promise<T>;
  }
}
