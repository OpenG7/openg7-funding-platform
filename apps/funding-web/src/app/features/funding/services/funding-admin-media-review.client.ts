import type {
  SponsorMediaWorkspace,
  SponsorMediaRuleRequest,
  SponsorMediaBatchRequest,
  SponsorMediaBatchPlanRequest,
  SponsorMediaBatchPlan,
  SponsorMediaBatchExecuteRequest,
  SponsorMediaBatchReceipt
} from '@openg7/funding-core';
import type {
  SponsorMediaKind,
  SponsorMediaUploadResult
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';
import { errorDetailsFromResponse } from './funding-admin-response.js';

export interface MediaReviewHistoryResponse {
  readonly entries: readonly {
    readonly id: string;
    readonly occurredAt: string;
    readonly kind: 'rights' | 'moderation' | 'operation';
    readonly action: string;
    readonly actor: string;
    readonly summary: string;
    readonly evidenceReference?: string;
  }[];
  readonly nextCursor: string | null;
}

/** Authenticated workspace transport. Mutations are never replayed automatically. */
export class FundingAdminMediaReviewClient {
  constructor(private readonly session: FundingAdminSession) {}

  read(contributionId: string): Promise<SponsorMediaWorkspace> {
    return this.request(
      '/workspace?' + new URLSearchParams({ contributionId })
    );
  }
  rules(body: SponsorMediaRuleRequest): Promise<SponsorMediaWorkspace> {
    return this.request('/rules', body);
  }
  batch(body: SponsorMediaBatchRequest): Promise<SponsorMediaWorkspace> {
    return this.request('/batches', body);
  }
  plan(body: SponsorMediaBatchPlanRequest): Promise<SponsorMediaBatchPlan> {
    return this.request('/batch/plan', body);
  }
  execute(
    body: SponsorMediaBatchExecuteRequest
  ): Promise<SponsorMediaBatchReceipt> {
    return this.request('/batch/execute', body);
  }
  receipt(
    contributionId: string,
    requestId: string
  ): Promise<{ found: boolean; result?: unknown }> {
    return this.request(
      '/receipt?' + new URLSearchParams({ contributionId, requestId })
    );
  }
  history(
    contributionId: string,
    assetId: string,
    cursor?: string
  ): Promise<MediaReviewHistoryResponse> {
    return this.request(
      '/workspace/history?' +
        new URLSearchParams({
          contributionId,
          assetId,
          ...(cursor ? { cursor } : {})
        })
    );
  }
  async upload(
    contributionId: string,
    kind: SponsorMediaKind,
    file: File,
    requestId: string
  ): Promise<SponsorMediaUploadResult> {
    const body = new FormData();
    body.set('contributionId', contributionId);
    body.set('kind', kind);
    body.set('media', file);
    body.set('requestId', requestId);
    const response = await this.session.requestAdmin(
      '/admin/sponsorships/media/upload',
      { auth: 'saved', method: 'POST', body }
    );
    if (!response.ok) {
      const details = await errorDetailsFromResponse(response);
      throw new AdminDashboardRequestError(
        response.status,
        undefined,
        details.code
      );
    }
    return response.json() as Promise<SponsorMediaUploadResult>;
  }
  async thumbnail(assetId: string): Promise<Blob> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/media/content/' +
        encodeURIComponent(assetId) +
        '?variant=thumbnail',
      { auth: 'saved', cache: 'no-store', headers: { Accept: 'image/webp' } }
    );
    if (!response.ok) throw new AdminDashboardRequestError(response.status);
    return response.blob();
  }
  private async request<T>(suffix: string, body?: object): Promise<T> {
    const response = await this.session.requestAdminJson(
      '/admin/sponsorships/media' + suffix,
      {
        auth: 'saved',
        cache: 'no-store',
        method: body ? 'POST' : 'GET',
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
