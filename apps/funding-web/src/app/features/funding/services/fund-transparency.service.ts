import { Injectable } from '@angular/core';
import type { FundTransparencyPublicResponse } from '@openg7/funding-core';

@Injectable({ providedIn: 'root' })
export class FundTransparencyService {
  private readonly apiBaseUrl = this.resolveApiBaseUrl();

  async getPublicTransparency(): Promise<FundTransparencyPublicResponse> {
    const response = await fetch(`${this.apiBaseUrl}/public/fund-transparency`, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load public transparency data');
    }

    return (await response.json()) as FundTransparencyPublicResponse;
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
