import type { AdminSetupStatusResponse } from '@openg7/funding-core';
import type { Page } from '@playwright/test';

/** Local token sessions used by setup and email UI fixtures. */
export async function installAdminTokenSession(
  page: Page,
  token: string,
  language = 'fr-CA'
): Promise<void> {
  await page.addInitScript(
    ({ locale, sessionToken }) => {
      localStorage.setItem('openg7.language', locale);
      sessionStorage.setItem('openg7-admin-session-token', sessionToken);
      sessionStorage.setItem(
        'openg7-admin-session-expires-at',
        '2099-01-01T00:00:00Z'
      );
    },
    { locale: language, sessionToken: token }
  );
}

export const setupFixture = (): AdminSetupStatusResponse => ({
  data_source: 'database',
  environment: 'test',
  public_base_url: 'https://example.test',
  allowed_origins: [],
  identity: {
    mode: 'oidc',
    issuer: 'https://auth.example.test/realms/funding',
    callback_url: 'https://example.test/api/admin/auth/callback',
    client_id_configured: true,
    client_secret_configured: true,
    owner_bootstrap_configured: false,
    mfa_policy: 'amr',
    private_data_encryption_configured: true
  },
  stripe: {
    secret_key_configured: false,
    webhook_secret_configured: false,
    business_sponsorship_enabled: false,
    dashboard_url: 'https://dashboard.stripe.com/test',
    webhook_endpoint: '/api/stripe/webhook'
  },
  email: {
    smtp_enabled: true,
    smtp_configured: true,
    smtp_host: 'smtp.example.test',
    smtp_port: 465,
    smtp_secure: true,
    smtp_user_configured: true,
    smtp_password_configured: true,
    from: 'sender@example.test',
    reply_to: null,
    admin_notification_email: 'admin@example.test',
    admin_review_reminder_enabled: false,
    admin_review_reminder_min_age_days: 1,
    admin_review_reminder_poll_interval_ms: 3600000,
    admin_review_reminder_max_items: 5,
    queue_available: true,
    queue_poll_interval_ms: 30000,
    queue_batch_size: 10,
    queued_count: 0,
    sending_count: 0,
    sent_count: 0,
    failed_count: 0,
    last_failed_at: null,
    last_error: null
  },
  invoice: {
    prefix: 'TEST',
    issuer_name: null,
    issuer_email: null,
    issuer_address_configured: false,
    issuer_tax_id_configured: false,
    tax_label: '',
    ready: false
  },
  database: { configured: true, reachable: true },
  last_updated_at: '2026-09-24T12:00:00Z'
});
