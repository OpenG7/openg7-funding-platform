import { Injectable } from '@angular/core';

import { resolveFundingApiBaseUrl } from './funding-api-base-url.js';

export interface StripeSetupDevStatus {
  readonly environment: string;
  readonly apiReachable: boolean;
  readonly stripeSecretKeyConfigured: boolean;
  readonly stripeWebhookSecretConfigured: boolean;
  readonly databaseUrlConfigured: boolean;
  readonly databaseReachable: boolean;
  readonly transparencySource: 'database' | 'stripe' | 'none';
  readonly localApiBaseUrl: string;
  readonly checkoutEndpoint: string;
  readonly webhookEndpoint: string;
  readonly publicTransparencyEndpoint: string;
  readonly stripeDashboardUrl: string;
  readonly lastCheckedAt: string;
}

@Injectable({ providedIn: 'root' })
export class StripeSetupDevService {
  private readonly apiBaseUrl = resolveFundingApiBaseUrl();

  async getStatus(): Promise<StripeSetupDevStatus> {
    const response = await fetch(`${this.apiBaseUrl}/dev/stripe-setup-status`, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load Stripe setup status');
    }

    return (await response.json()) as StripeSetupDevStatus;
  }
}
