import type {
  AdminIdentitySetupStatus,
  AdminSetupStatusResponse
} from '@openg7/funding-core';

import type { AdminSponsorshipReviewReminderConfig } from '../admin-reminder.service.js';
import type { EmailQueueStatus } from '../email-notification.service.js';
import type { TransactionalEmailConfigStatus } from '../services/email/index.js';
import type { SponsorshipInvoiceConfig } from '../sponsorship-invoice-config.js';

import type { ReportFailure } from './contracts.js';

export interface AdminSetupDependencies {
  readonly getAdminIdentitySetupStatus: () => AdminIdentitySetupStatus;
  readonly checkDatabaseConnection: (() => Promise<unknown>) | null;
  readonly getEmailQueueStatus: () => Promise<EmailQueueStatus>;
  readonly getTransactionalEmailConfigStatus: () => TransactionalEmailConfigStatus;
  readonly hasDatabase: boolean;
  readonly stripeConfigured: boolean;
  readonly stripeSecretKeyConfigured: boolean;
  readonly stripeWebhookSecretConfigured: boolean;
  readonly stripeLiveMode: boolean;
  readonly businessSponsorshipEnabled: boolean;
  readonly publicBaseUrl: string | null;
  readonly publicBaseOrigin: string;
  readonly allowedOrigins: readonly string[];
  readonly adminSponsorshipReviewReminderConfig: Pick<
    AdminSponsorshipReviewReminderConfig,
    'enabled' | 'minAgeDays' | 'pollIntervalMs' | 'maxItems'
  >;
  readonly emailQueuePollIntervalMs: number;
  readonly emailQueueBatchSize: number;
  readonly sponsorshipInvoiceConfig: Pick<
    SponsorshipInvoiceConfig,
    'invoicePrefix' | 'issuerName' | 'issuerEmail' | 'taxLabel'
  > & {
    readonly issuerAddressConfigured: boolean;
    readonly issuerTaxIdConfigured: boolean;
  };
  readonly readEnvironment: (
    key: 'FUNDING_PLATFORM_ENV' | 'FUNDING_ADMIN_NOTIFICATION_EMAIL'
  ) => string | undefined;
  readonly reportFailure: ReportFailure;
}

export const createAdminSetupHelpers = ({
  getAdminIdentitySetupStatus,
  checkDatabaseConnection,
  getEmailQueueStatus,
  getTransactionalEmailConfigStatus,
  hasDatabase,
  stripeConfigured,
  stripeSecretKeyConfigured,
  stripeWebhookSecretConfigured,
  stripeLiveMode,
  businessSponsorshipEnabled,
  publicBaseUrl,
  publicBaseOrigin,
  allowedOrigins,
  adminSponsorshipReviewReminderConfig,
  emailQueuePollIntervalMs,
  emailQueueBatchSize,
  sponsorshipInvoiceConfig,
  readEnvironment,
  reportFailure
}: AdminSetupDependencies) => {
  const getDatabaseConnectionStatus = async (): Promise<boolean> => {
    if (!checkDatabaseConnection) {
      return false;
    }

    try {
      await checkDatabaseConnection();
      return true;
    } catch {
      return false;
    }
  };

  const buildAdminSetupStatus = async (): Promise<AdminSetupStatusResponse> => {
    const databaseReachable = await getDatabaseConnectionStatus();
    let emailQueueStatus: EmailQueueStatus = {
      queuedCount: 0,
      sendingCount: 0,
      sentCount: 0,
      failedCount: 0,
      lastFailedAt: null,
      lastError: null
    };
    let emailQueueStatusError: string | null = null;
    const emailStatus = getTransactionalEmailConfigStatus();

    try {
      emailQueueStatus = await getEmailQueueStatus();
    } catch (error) {
      reportFailure('Failed to inspect email queue status.', error);
      emailQueueStatusError =
        'Email queue status could not be loaded. Apply migration 010.';
    }

    return {
      data_source: hasDatabase
        ? 'database'
        : stripeConfigured
          ? 'stripe_direct'
          : 'empty',
      environment: readEnvironment('FUNDING_PLATFORM_ENV') ?? 'development',
      public_base_url: publicBaseUrl ?? null,
      allowed_origins: allowedOrigins,
      identity: getAdminIdentitySetupStatus(),
      stripe: {
        secret_key_configured: stripeSecretKeyConfigured,
        webhook_secret_configured: stripeWebhookSecretConfigured,
        business_sponsorship_enabled: businessSponsorshipEnabled,
        dashboard_url: stripeLiveMode
          ? 'https://dashboard.stripe.com/webhooks'
          : 'https://dashboard.stripe.com/test/webhooks',
        webhook_endpoint: `${publicBaseUrl ?? publicBaseOrigin}/api/stripe/webhook`
      },
      email: {
        smtp_enabled: emailStatus.enabled,
        smtp_configured: emailStatus.configured,
        smtp_host: emailStatus.host,
        smtp_port: emailStatus.port,
        smtp_secure: emailStatus.secure,
        smtp_user_configured: emailStatus.userConfigured,
        smtp_password_configured: emailStatus.passwordConfigured,
        from: emailStatus.from,
        reply_to: emailStatus.replyTo,
        admin_notification_email:
          readEnvironment('FUNDING_ADMIN_NOTIFICATION_EMAIL')?.trim() || null,
        admin_review_reminder_enabled:
          adminSponsorshipReviewReminderConfig.enabled,
        admin_review_reminder_min_age_days:
          adminSponsorshipReviewReminderConfig.minAgeDays,
        admin_review_reminder_poll_interval_ms:
          adminSponsorshipReviewReminderConfig.pollIntervalMs,
        admin_review_reminder_max_items:
          adminSponsorshipReviewReminderConfig.maxItems,
        queue_available: Boolean(checkDatabaseConnection && databaseReachable),
        queue_poll_interval_ms: emailQueuePollIntervalMs,
        queue_batch_size: emailQueueBatchSize,
        queued_count: emailQueueStatus.queuedCount,
        sending_count: emailQueueStatus.sendingCount,
        sent_count: emailQueueStatus.sentCount,
        failed_count: emailQueueStatus.failedCount,
        last_failed_at: emailQueueStatus.lastFailedAt,
        last_error: emailQueueStatus.lastError ?? emailQueueStatusError
      },
      invoice: {
        prefix: sponsorshipInvoiceConfig.invoicePrefix,
        issuer_name: sponsorshipInvoiceConfig.issuerName || null,
        issuer_email: sponsorshipInvoiceConfig.issuerEmail || null,
        issuer_address_configured:
          sponsorshipInvoiceConfig.issuerAddressConfigured,
        issuer_tax_id_configured:
          sponsorshipInvoiceConfig.issuerTaxIdConfigured,
        tax_label: sponsorshipInvoiceConfig.taxLabel,
        ready: Boolean(
          sponsorshipInvoiceConfig.issuerName &&
          sponsorshipInvoiceConfig.issuerEmail
        )
      },
      database: {
        configured: hasDatabase,
        reachable: databaseReachable
      },
      last_updated_at: new Date().toISOString()
    };
  };

  return { getDatabaseConnectionStatus, buildAdminSetupStatus };
};
