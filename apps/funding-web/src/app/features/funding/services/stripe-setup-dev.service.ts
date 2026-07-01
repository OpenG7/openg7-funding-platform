import { Injectable } from '@angular/core';

export interface StripeSetupDevStatus {
  readonly environment: string;
  readonly apiReachable: boolean;
  readonly stripeSecretKeyConfigured: boolean;
  readonly stripeWebhookSecretConfigured: boolean;
  readonly databaseUrlConfigured: boolean;
  readonly databaseReachable: boolean;
  readonly localApiBaseUrl: string;
  readonly checkoutEndpoint: string;
  readonly webhookEndpoint: string;
  readonly publicTransparencyEndpoint: string;
  readonly stripeDashboardUrl: string;
  readonly lastCheckedAt: string;
}

@Injectable({ providedIn: 'root' })
export class StripeSetupDevService {
  private readonly apiBaseUrl = this.resolveApiBaseUrl();

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
