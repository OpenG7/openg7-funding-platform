import type {
  PreparationAssistanceApplyRequest,
  PreparationAssistanceReviewRequest,
  PreparationAssistanceRunRequest,
  PreparationAssistanceSourceRequest,
  PreparationAssistanceSummary,
  PreparationAssistanceState
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';
import { errorDetailsFromResponse } from './funding-admin-response.js';

/** Private durable assistance. The shared session owns authentication and never retries a command. */
export class FundingAdminPreparationAssistanceClient {
  constructor(private readonly session: FundingAdminSession) {}

  read(contributionId: string): Promise<PreparationAssistanceState> {
    return this.request('?' + new URLSearchParams({ contributionId }));
  }
  summary(contributionId: string): Promise<PreparationAssistanceSummary> {
    return this.request<PreparationAssistanceSummary>(
      '/summary?' + new URLSearchParams({ contributionId })
    );
  }
  rerunSummary(
    request: PreparationAssistanceRunRequest
  ): Promise<PreparationAssistanceSummary> {
    return this.request<PreparationAssistanceSummary>(
      '/runs?view=summary',
      request
    );
  }
  source(
    request: PreparationAssistanceSourceRequest
  ): Promise<PreparationAssistanceState> {
    return this.request('/source', request);
  }
  run(
    request: PreparationAssistanceRunRequest
  ): Promise<PreparationAssistanceState> {
    return this.request('/runs', request);
  }
  review(
    request: PreparationAssistanceReviewRequest
  ): Promise<PreparationAssistanceState> {
    return this.request('/review', request);
  }
  apply(
    request: PreparationAssistanceApplyRequest
  ): Promise<PreparationAssistanceState> {
    return this.request('/apply', request);
  }
  private async request<T = PreparationAssistanceState>(
    suffix: string,
    body?: object
  ): Promise<T> {
    const response = await this.session.requestAdminJson(
      '/admin/preparation-assistance' + suffix,
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
