import { Injectable } from '@angular/core';
import type {
  AdminSponsorshipReviewRequest,
  AdminSponsorshipReviewResult,
  AdminSponsorshipsResponse
} from '@openg7/funding-core';

@Injectable({ providedIn: 'root' })
export class FundingAdminService {
  private readonly apiBaseUrl = this.resolveApiBaseUrl();

  async getSponsorships(token: string): Promise<AdminSponsorshipsResponse> {
    const response = await fetch(`${this.apiBaseUrl}/admin/sponsorships`, {
      method: 'GET',
      headers: this.createHeaders(token)
    });

    if (!response.ok) {
      throw new Error('Admin sponsorships could not be loaded.');
    }

    return (await response.json()) as AdminSponsorshipsResponse;
  }

  async reviewSponsorship(
    token: string,
    payload: AdminSponsorshipReviewRequest
  ): Promise<AdminSponsorshipReviewResult> {
    const response = await fetch(`${this.apiBaseUrl}/admin/sponsorships/review`, {
      method: 'POST',
      headers: {
        ...this.createHeaders(token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('Sponsorship review could not be updated.');
    }

    return (await response.json()) as AdminSponsorshipReviewResult;
  }

  private createHeaders(token: string): Record<string, string> {
    return {
      Accept: 'application/json',
      ...(token.trim()
        ? {
            Authorization: `Bearer ${token.trim()}`
          }
        : {})
    };
  }

  private resolveApiBaseUrl(): string {
    const globalApiBaseUrl =
      typeof window !== 'undefined'
        ? (window as Window & {
            readonly __OPENG7_FUNDING_API_BASE_URL__?: string;
          }).__OPENG7_FUNDING_API_BASE_URL__
        : undefined;

    return globalApiBaseUrl?.replace(/\/$/, '') ?? '/api';
  }
}
