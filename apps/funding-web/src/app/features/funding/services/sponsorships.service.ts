import { Injectable } from '@angular/core';
import type { PublicSponsorshipsResponse } from '@openg7/funding-core';

import { resolveFundingApiBaseUrl } from './funding-api-base-url.js';
import { FundingPublicClient } from './funding-public.client.js';

@Injectable({ providedIn: 'root' })
export class SponsorshipsService {
  private readonly publicClient = new FundingPublicClient(
    resolveFundingApiBaseUrl()
  );

  async getPublicSponsorshipPage(
    page: number,
    pageSize: number,
    signal?: AbortSignal
  ): Promise<PublicSponsorshipsResponse> {
    return this.publicClient.getPublicSponsorshipPage(page, pageSize, signal);
  }

  async getPublicSponsorships(
    signal?: AbortSignal,
    params?: URLSearchParams
  ): Promise<PublicSponsorshipsResponse> {
    return this.publicClient.getPublicSponsorships(signal, params);
  }
}
