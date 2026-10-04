import type { StripeSetupDevStatus } from '../../services/stripe-setup-dev.service.js';

export const DEV_TOOLS_FALLBACK_STATUS: StripeSetupDevStatus = {
  environment: 'development',
  apiReachable: false,
  stripeSecretKeyConfigured: false,
  stripeWebhookSecretConfigured: false,
  databaseUrlConfigured: false,
  databaseReachable: false,
  transparencySource: 'none',
  localApiBaseUrl: 'http://localhost:3333',
  checkoutEndpoint: 'http://localhost:3333/api/checkout-sessions',
  webhookEndpoint: 'http://localhost:3333/api/stripe/webhook',
  publicTransparencyEndpoint:
    'http://localhost:3333/api/public/fund-transparency',
  stripeDashboardUrl: 'https://dashboard.stripe.com/test/webhooks',
  lastCheckedAt: new Date(0).toISOString()
};
