import path from 'node:path';

import type { ContributionType } from '@openg7/funding-core';
import type Stripe from 'stripe';

import {
  loadAdminAssistantConfig,
  type AdminAssistantConfig
} from './admin-assistant/config.js';
import {
  loadAdminSponsorshipReviewReminderConfig,
  type AdminSponsorshipReviewReminderConfig
} from './admin-reminder.service.js';
import {
  parseBooleanEnv,
  parseNonNegativeIntegerEnv,
  parsePositiveIntegerEnv
} from './environment-values.js';
import { loadTrustedProxyHops } from './request-client-ip.js';
import { loadEmailQueueWorkerEnabled } from './services/email/index.js';
import { loadSponsorMediaLimits } from './sponsor-media-limits.js';
import type { SponsorLogoStorageConfig } from './sponsor-media-storage.js';
import { simulatedCheckoutEnabled } from './stripe-checkout-config.js';

// Keep these loaders separate so composition can retain its startup order.
// SMTP deliberately uses its strict parsers, rather than the optional-setting
// parsers used for rate limits and feature defaults below.
export { loadTransactionalEmailConfig as loadApiRuntimeEmailConfig } from './services/email/index.js';
export { loadSocialPublicationConfig as loadApiRuntimeSocialPublicationConfig } from './social-publication.service.js';
export { contributionNotificationConfig as loadApiRuntimeContributionNotificationConfig } from './contribution-activity.service.js';

export interface ApiRuntimeStartupConfig {
  readonly port: number;
  readonly stripeSecretKey: string | undefined;
  readonly stripeWebhookSecret: string | undefined;
  readonly projectId: string;
  readonly environment: string;
  readonly isProduction: boolean;
  readonly businessSponsorshipEnabled: boolean;
  readonly adminToken: string;
  readonly adminSessionSecret: string;
  readonly adminSessionTtlMinutes: number;
  readonly sponsorshipFollowupTokenTtlDays: number;
  readonly rateLimitWindowMs: number;
  readonly publicWriteRateLimitMax: number;
  readonly sponsorshipFollowupRateLimitMax: number;
  readonly referenceLookupRateLimitMax: number;
  readonly referenceRecoveryRateLimitMax: number;
  readonly adminRateLimitMax: number;
  readonly emailQueueWorkerEnabled: boolean;
  readonly emailQueuePollIntervalMs: number;
  readonly emailQueueBatchSize: number;
  readonly adminSponsorshipReviewReminderConfig: AdminSponsorshipReviewReminderConfig;
  readonly adminAssistantConfig: AdminAssistantConfig;
  readonly sponsorLogoMaxBytes: number;
  readonly sponsorMediaStorageConfig: SponsorLogoStorageConfig;
}

export interface ApiRuntimeHttpConfig {
  readonly sponsorMediaMaxBytes: number;
  readonly sponsorMediaMaxSupportingImages: number;
  readonly trustedProxyHops: number;
  readonly allowedOrigins: string[];
  readonly publicBaseUrl: string | null;
  readonly publicBaseOrigin: string;
  readonly allowedReturnHostnames: Set<string>;
  readonly allowedContributionAmounts: Set<number>;
  readonly allowedContributionTypes: Set<ContributionType>;
  readonly stripeApiHost: string | undefined;
  readonly stripeApiPort: string | undefined;
  readonly stripeApiProtocol: 'http' | 'https' | undefined;
  readonly navigableSimulatedCheckout: boolean;
  readonly stripeOptions: Stripe.StripeConfig;
  readonly stripeBackfillOptions: Stripe.StripeConfig;
}

export interface ApiRuntimeConfig
  extends ApiRuntimeStartupConfig, ApiRuntimeHttpConfig {}

const runtimeEnvironment = (env: NodeJS.ProcessEnv): string => {
  const key =
    env.FUNDING_PLATFORM_ENV === undefined
      ? 'NODE_ENV'
      : 'FUNDING_PLATFORM_ENV';
  const value = env[key] ?? 'development';
  if (!['development', 'test', 'production'].includes(value)) {
    throw new Error(`${key} must be development, test, or production.`);
  }
  return value;
};

export const loadApiRuntimeConfig = (
  env: NodeJS.ProcessEnv = process.env
): ApiRuntimeStartupConfig => {
  const port = Number(env.FUNDING_API_PORT ?? 3333);
  const stripeSecretKey = env.STRIPE_SECRET_KEY;
  const stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET;
  const projectId = env.FUNDING_PROJECT_ID ?? 'openg7';
  const environment = runtimeEnvironment(env);
  const isProduction = environment === 'production';
  const businessSponsorshipEnabled = parseBooleanEnv(
    env.FUNDING_BUSINESS_SPONSORSHIP_ENABLED,
    false
  );
  const adminToken = env.FUNDING_ADMIN_TOKEN?.trim() ?? '';
  const adminSessionSecret = env.FUNDING_ADMIN_SESSION_SECRET?.trim() ?? '';
  const adminSessionTtlMinutes = parsePositiveIntegerEnv(
    env.FUNDING_ADMIN_SESSION_TTL_MINUTES,
    60
  );
  if (
    (env.FUNDING_ADMIN_AUTH_MODE ?? 'token') === 'token' &&
    !isProduction &&
    env.FUNDING_ADMIN_SESSION_TTL_MINUTES !== undefined &&
    (!/^\d+$/.test(env.FUNDING_ADMIN_SESSION_TTL_MINUTES) ||
      Number(env.FUNDING_ADMIN_SESSION_TTL_MINUTES) < 1 ||
      Number(env.FUNDING_ADMIN_SESSION_TTL_MINUTES) > 60)
  )
    throw new Error(
      'FUNDING_ADMIN_SESSION_TTL_MINUTES must be an integer between 1 and 60.'
    );
  const sponsorshipFollowupTokenTtlDays = parsePositiveIntegerEnv(
    env.FUNDING_SPONSORSHIP_FOLLOWUP_TOKEN_TTL_DAYS,
    30
  );
  const rateLimitWindowMs = parsePositiveIntegerEnv(
    env.FUNDING_RATE_LIMIT_WINDOW_MS,
    60_000
  );
  const publicWriteRateLimitMax = parseNonNegativeIntegerEnv(
    env.FUNDING_PUBLIC_WRITE_RATE_LIMIT_MAX,
    60
  );
  const sponsorshipFollowupRateLimitMax = parseNonNegativeIntegerEnv(
    env.FUNDING_SPONSORSHIP_FOLLOWUP_RATE_LIMIT_MAX,
    60
  );
  const referenceLookupRateLimitMax = parseNonNegativeIntegerEnv(
    env.FUNDING_REFERENCE_LOOKUP_RATE_LIMIT_MAX,
    30
  );
  const referenceRecoveryRateLimitMax = parseNonNegativeIntegerEnv(
    env.FUNDING_REFERENCE_RECOVERY_RATE_LIMIT_MAX,
    10
  );
  const adminRateLimitMax = parseNonNegativeIntegerEnv(
    env.FUNDING_ADMIN_RATE_LIMIT_MAX,
    120
  );
  const emailQueueWorkerEnabled = loadEmailQueueWorkerEnabled(env);
  const emailQueuePollIntervalMs = parsePositiveIntegerEnv(
    env.FUNDING_EMAIL_QUEUE_POLL_INTERVAL_MS,
    30_000
  );
  const emailQueueBatchSize = parsePositiveIntegerEnv(
    env.FUNDING_EMAIL_QUEUE_BATCH_SIZE,
    10
  );
  const adminSponsorshipReviewReminderConfig =
    loadAdminSponsorshipReviewReminderConfig(env);
  // Defaults to disabled; the deterministic summary remains available.
  const adminAssistantConfig = loadAdminAssistantConfig(env);
  const sponsorLogoMaxBytes = parsePositiveIntegerEnv(
    env.FUNDING_SPONSOR_LOGO_MAX_BYTES,
    512 * 1024
  );
  const sponsorLogoStorageDir = path.resolve(
    env.FUNDING_SPONSOR_LOGO_STORAGE_DIR ?? 'var/sponsor-logos'
  );
  const sponsorMediaStorageConfig: SponsorLogoStorageConfig = {
    driver: env.SPONSOR_MEDIA_STORAGE_DRIVER,
    localStorageDir: sponsorLogoStorageDir,
    s3: {
      region: env.SPONSOR_MEDIA_REGION,
      endpoint: env.SPONSOR_MEDIA_ENDPOINT,
      publicBucket: env.SPONSOR_MEDIA_PUBLIC_BUCKET,
      publicBaseUrl: env.SPONSOR_MEDIA_PUBLIC_BASE_URL,
      privateBucket: env.SPONSOR_MEDIA_PRIVATE_BUCKET,
      privateBaseUrl: env.SPONSOR_MEDIA_PRIVATE_BASE_URL,
      accessKeyId: env.OVH_S3_ACCESS_KEY_ID,
      secretAccessKey: env.OVH_S3_SECRET_ACCESS_KEY
    }
  };
  return {
    port,
    stripeSecretKey,
    stripeWebhookSecret,
    projectId,
    environment,
    isProduction,
    businessSponsorshipEnabled,
    adminToken,
    adminSessionSecret,
    adminSessionTtlMinutes,
    sponsorshipFollowupTokenTtlDays,
    rateLimitWindowMs,
    publicWriteRateLimitMax,
    sponsorshipFollowupRateLimitMax,
    referenceLookupRateLimitMax,
    referenceRecoveryRateLimitMax,
    adminRateLimitMax,
    emailQueueWorkerEnabled,
    emailQueuePollIntervalMs,
    emailQueueBatchSize,
    adminSponsorshipReviewReminderConfig,
    adminAssistantConfig,
    sponsorLogoMaxBytes,
    sponsorMediaStorageConfig
  };
};

/** Loaded after storage construction to retain startup validation precedence. */
export const loadApiRuntimeHttpConfig = (
  env: NodeJS.ProcessEnv = process.env
): ApiRuntimeHttpConfig => {
  const {
    maxUploadBytes: sponsorMediaMaxBytes,
    maxSupportingImages: sponsorMediaMaxSupportingImages
  } = loadSponsorMediaLimits(env);
  const trustedProxyHops = loadTrustedProxyHops(env.FUNDING_TRUSTED_PROXY_HOPS);
  const allowedOrigins = (env.FUNDING_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const publicBaseUrl =
    env.FUNDING_PUBLIC_BASE_URL ??
    allowedOrigins[0] ??
    (env.APP_DOMAIN ? `https://${env.APP_DOMAIN}` : null);
  const publicBaseOrigin = publicBaseUrl
    ? new URL(publicBaseUrl).origin
    : 'https://example.org';
  const allowedReturnHostnames = new Set(
    [publicBaseUrl, ...allowedOrigins]
      .filter(Boolean)
      .map((origin) => new URL(origin).hostname)
  );
  const allowedContributionAmounts = new Set(
    (env.FUNDING_ALLOWED_AMOUNTS ?? '5,10,25,50')
      .split(',')
      .map((amount) => Number(amount.trim()))
      .filter((amount) => Number.isFinite(amount) && amount > 0)
  );
  // Local E2E overrides; absent settings keep the SDK defaults.
  const stripeApiHost = env.STRIPE_API_HOST;
  const navigableSimulatedCheckout = simulatedCheckoutEnabled(env);
  const stripeApiPort = env.STRIPE_API_PORT;
  const stripeApiProtocol = env.STRIPE_API_PROTOCOL as
    'http' | 'https' | undefined;
  const stripeOptions: Stripe.StripeConfig = {
    ...(stripeApiHost ? { host: stripeApiHost } : {}),
    ...(stripeApiPort ? { port: stripeApiPort } : {}),
    ...(stripeApiProtocol ? { protocol: stripeApiProtocol } : {})
  };

  return {
    sponsorMediaMaxBytes,
    sponsorMediaMaxSupportingImages,
    trustedProxyHops,
    allowedOrigins,
    publicBaseUrl,
    publicBaseOrigin,
    allowedReturnHostnames,
    allowedContributionAmounts,
    allowedContributionTypes: new Set<ContributionType>([
      'personal_support',
      'sponsorship_interest'
    ]),
    stripeApiHost,
    stripeApiPort,
    stripeApiProtocol,
    navigableSimulatedCheckout,
    stripeOptions,
    stripeBackfillOptions: {
      ...stripeOptions,
      timeout: 10000,
      maxNetworkRetries: 0
    }
  };
};

export const validateApiRuntimeConfig = (
  config: Pick<
    ApiRuntimeConfig,
    'isProduction' | 'stripeSecretKey' | 'publicBaseUrl'
  >
): void => {
  if (config.isProduction && !config.stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY is required in production.');
  }

  if (config.isProduction && !config.publicBaseUrl) {
    throw new Error(
      'FUNDING_PUBLIC_BASE_URL or FUNDING_ALLOWED_ORIGINS is required in production.'
    );
  }
};

export const loadApiRuntimeAdminAuthMode = (
  env: NodeJS.ProcessEnv = process.env
): 'token' | 'oidc' => {
  const mode = env.FUNDING_ADMIN_AUTH_MODE ?? 'token';
  if (mode !== 'token' && mode !== 'oidc')
    throw new Error('Invalid admin auth mode.');
  if (runtimeEnvironment(env) === 'production' && mode !== 'oidc')
    throw new Error('FUNDING_ADMIN_AUTH_MODE must be oidc in production.');
  return mode;
};

export const createCheckoutReturnUrlResolver = ({
  publicBaseOrigin,
  allowedOrigins,
  allowedReturnHostnames,
  isProduction
}: Pick<
  ApiRuntimeConfig,
  | 'publicBaseOrigin'
  | 'allowedOrigins'
  | 'allowedReturnHostnames'
  | 'isProduction'
>) => {
  return (candidateUrl: string, fallbackPath: string): string => {
    const fallback = new URL(fallbackPath, publicBaseOrigin);

    try {
      const candidate = new URL(candidateUrl);
      const allowedOriginSet = new Set([...allowedOrigins, publicBaseOrigin]);

      if (
        !isProduction &&
        candidate.protocol === 'http:' &&
        (candidate.hostname === 'localhost' ||
          candidate.hostname === '127.0.0.1')
      ) {
        return candidate.toString();
      }

      if (candidate.protocol !== 'https:') {
        return fallback.toString();
      }

      if (candidate.port && allowedReturnHostnames.has(candidate.hostname)) {
        return new URL(
          `${candidate.pathname}${candidate.search}${candidate.hash}`,
          publicBaseOrigin
        ).toString();
      }

      if (allowedOriginSet.has(candidate.origin)) {
        return candidate.toString();
      }
    } catch {
      return fallback.toString();
    }

    return fallback.toString();
  };
};
