import { Injectable } from '@angular/core';
import type {
  FundTransparencyPublicResponse,
  PublicBuildersResponse
} from '@openg7/funding-core';

import { resolveFundingApiBaseUrl } from './funding-api-base-url.js';
import { FundingPublicClient } from './funding-public.client.js';

@Injectable({ providedIn: 'root' })
export class FundTransparencyService {
  private readonly publicClient = new FundingPublicClient(
    resolveFundingApiBaseUrl()
  );

  async getPublicBuilders(
    page: number,
    pageSize: number,
    signal?: AbortSignal
  ): Promise<PublicBuildersResponse> {
    return this.publicClient.getPublicBuilders(page, pageSize, signal);
  }

  async getPublicTransparency(
    signal?: AbortSignal
  ): Promise<FundTransparencyPublicResponse> {
    return this.publicClient.getPublicTransparency(signal);
  }
}
