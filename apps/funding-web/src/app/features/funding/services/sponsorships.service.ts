import { Injectable } from '@angular/core';
import type { PublicSponsorshipsResponse } from '@openg7/funding-core';

@Injectable({ providedIn: 'root' })
export class SponsorshipsService {
  private readonly apiBaseUrl = this.resolveApiBaseUrl();

  async getPublicSponsorshipPage(
    page: number,
    pageSize: number,
    signal?: AbortSignal
  ): Promise<PublicSponsorshipsResponse> {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });
    return this.getPublicSponsorships(signal, params);
  }

  async getPublicSponsorships(
    signal?: AbortSignal,
    params?: URLSearchParams
  ): Promise<PublicSponsorshipsResponse> {
    const response = await fetch(
      `${this.apiBaseUrl}/public/sponsorships${params ? '?' + params : ''}`,
      {
        method: 'GET',
        signal,
        headers: {
          Accept: 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to load public sponsorship data');
    }

    return (await response.json()) as PublicSponsorshipsResponse;
  }

  private resolveApiBaseUrl(): string {
    const globalApiBaseUrl =
      typeof window !== 'undefined'
        ? (
            window as Window & {
              readonly __OPENG7_FUNDING_API_BASE_URL__?: string;
            }
          ).__OPENG7_FUNDING_API_BASE_URL__
        : undefined;

    return globalApiBaseUrl?.replace(/\/$/, '') ?? '/api';
  }
}
