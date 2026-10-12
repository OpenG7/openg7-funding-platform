import type {
  SponsorshipCommitmentRecord,
  SponsorshipCommitmentQualificationRequest,
  SponsorshipObligationAdjustmentRequest,
  SponsorshipCommitmentAdoptionPreview,
  SponsorshipTimingCommandRequest,
  SponsorshipObligationTiming
} from '@openg7/funding-core';

import {
  AdminDashboardRequestError,
  type FundingAdminSession
} from './funding-admin-session.js';

/** Authenticated commercial records; this client never derives an agreement from a price. */
export class FundingAdminCommitmentsClient {
  constructor(private readonly session: FundingAdminSession) {}
  get(
    contributionId: string
  ): Promise<{ commitment: SponsorshipCommitmentRecord | null }> {
    return this.request(
      `/admin/sponsorship-commitments?${new URLSearchParams({ contributionId })}`
    );
  }
  qualify(
    payload: SponsorshipCommitmentQualificationRequest
  ): Promise<{ commitment: SponsorshipCommitmentRecord | null }> {
    return this.request('/admin/sponsorship-commitments/qualify', payload);
  }
  adjust(
    payload: SponsorshipObligationAdjustmentRequest
  ): Promise<{ commitment: SponsorshipCommitmentRecord | null }> {
    return this.request('/admin/sponsorship-commitments/adjust', payload);
  }
  timing(
    payload: SponsorshipTimingCommandRequest
  ): Promise<{ obligationId: string; timing: SponsorshipObligationTiming }> {
    return this.request('/admin/sponsorship-commitments/timing', payload);
  }
  adoptionPreview(
    pageSize: 25 | 50 = 25,
    cursor?: string
  ): Promise<SponsorshipCommitmentAdoptionPreview> {
    return this.request(
      `/admin/sponsorship-commitments/adoption-preview?${new URLSearchParams({ pageSize: String(pageSize), ...(cursor ? { cursor } : {}) })}`
    );
  }
  private async request<T>(path: string, body?: object): Promise<T> {
    const response = await this.session.requestAdminJson(path, {
      auth: 'saved',
      cache: 'no-store',
      ...(body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
          }
        : {})
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as {
        code?: unknown;
      } | null;
      throw new AdminDashboardRequestError(
        response.status,
        'Commercial request failed.',
        typeof error?.code === 'string' ? error.code : undefined
      );
    }
    return response.json() as Promise<T>;
  }
}
