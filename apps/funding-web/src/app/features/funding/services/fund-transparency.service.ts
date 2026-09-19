import { Injectable } from '@angular/core';
import type {
  FundTransparencyPublicResponse,
  PublicBuildersResponse
} from '@openg7/funding-core';

@Injectable({ providedIn: 'root' })
export class FundTransparencyService {
  private readonly apiBaseUrl = this.resolveApiBaseUrl();

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
