import { Injectable } from '@angular/core';
import type {
  FundTransparencyPublicResponse,
  PublicBuildersResponse
} from '@openg7/funding-core';

import { resolveFundingApiBaseUrl } from './funding-api-base-url.js';

@Injectable({ providedIn: 'root' })
export class FundTransparencyService {
  private readonly apiBaseUrl = resolveFundingApiBaseUrl();

  async getPublicBuilders(
    page: number,
    pageSize: number,
    signal?: AbortSignal
  ): Promise<PublicBuildersResponse> {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize)
    });
    const response = await fetch(
      `${this.apiBaseUrl}/public/builders?${params}`,
      {
        signal,
        headers: { Accept: 'application/json' }
      }
    );
    if (!response.ok) throw new Error('Failed to load public builders');
    return (await response.json()) as PublicBuildersResponse;
  }

  async getPublicTransparency(
    signal?: AbortSignal
  ): Promise<FundTransparencyPublicResponse> {
    const response = await fetch(
      `${this.apiBaseUrl}/public/fund-transparency`,
      {
        signal,
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to load public transparency data');
    }

    return (await response.json()) as FundTransparencyPublicResponse;
  }
}
