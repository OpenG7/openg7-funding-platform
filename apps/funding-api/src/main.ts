import { createServer } from 'node:http';

import type { SponsorFeedChannel } from '@openg7/funding-core';
import Stripe from 'stripe';

import { createAdminAuthorization } from './admin-authorization.js';
import { createApiBackgroundWorkers } from './api-background-workers.js';
import {
  createCheckoutReturnUrlResolver,
  loadApiRuntimeAdminAuthMode,
  loadApiRuntimeConfig,
  loadApiRuntimeContributionNotificationConfig,
  loadApiRuntimeEmailConfig,
  loadApiRuntimeHttpConfig,
  loadApiRuntimeSocialPublicationConfig,
  validateApiRuntimeConfig
} from './api-runtime-config.js';
import { readSnapshot } from './admin-cockpit/read.js';
import { readStripeConnection } from './admin-cockpit/stripe-connection.js';
import {
  createCockpitSystemsReader,
  readSystemObservation
} from './admin-cockpit/systems.js';
import {
  AdminIdentityService,
  buildAdminIdentitySetupStatus
} from './admin-identity.js';
import { AdminPilotageService } from './admin-pilotage.service.js';
import {
  buildSponsorshipReviewReminderAdminUrl,
  queueDueSponsorshipReviewReminder
} from './admin-reminder.service.js';
import { AdminStripeBackfillService } from './admin-stripe-backfill.service.js';
import { createAdminTokenSessionService } from './admin-token-session.js';
import { ContributionActivityService } from './contribution-activity.service.js';
import { dbPool, hasDatabase } from './database.js';
import { assertProductionDatabasePrivileges } from './database-runtime-security.js';
import {
  getEmailQueueStatus,
  processQueuedEmailMessages
} from './email-notification.service.js';
import { insertAdminAuditLog } from './fund-admin.repository.js';
import {
  getSponsorshipFollowupByTokenHash,
  upsertCheckoutSessionFromWebhook
} from './fund-contributions.repository.js';
import { createRequestRateLimit } from './http-rate-limit.js';
import { createRouteMatcher } from './http-routing.js';
import {
  createHttpTransport,
  readBody,
  readBodyBuffer
} from './http-transport.js';
import { createPublicTransparencyCache } from './public-transparency-cache.js';
import { privateDataEncryptionKey } from './private-data-protection.js';
import { PublicationAutomationService } from './publication-automation/service.js';
import { getTransactionalEmailConfigStatus } from './services/email/index.js';
import { configuredSocialPublicationChannels } from './social-publication.service.js';
import {
  createSponsorLogoStorage,
  createSponsorMediaStorage
} from './sponsor-media-storage.js';
import { sponsorshipInvoiceConfig } from './sponsorship-invoice-config.js';
import { getStripePublicTransparencySummary } from './stripe-transparency.service.js';
import { createAdminSetupHelpers } from './business-helpers/admin-setup.js';
import { createAssistantAuditRecorder } from './business-helpers/assistant-audit.js';
import { createContributionReferenceHelpers } from './business-helpers/contribution-reference.js';
import { createHttpErrorHelpers } from './business-helpers/http-errors.js';
import { createMediaExposureHelpers } from './business-helpers/media-exposure.js';
import { createRequestValidationHelpers } from './business-helpers/request-validation.js';
import { createSponsorshipFollowupHelpers } from './business-helpers/sponsorship-followup.js';
import { createPublicHttpHandlers } from './http-composition/public-handlers.js';
import { createAdminHttpHandlers } from './http-composition/admin-handlers.js';
import { createHttpDispatcher } from './http-composition/dispatcher.js';
import { createApiRequestListener } from './http-composition/request-listener.js';

const startupConfig = loadApiRuntimeConfig();
const {
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
} = startupConfig;
const adminAuthMode = loadApiRuntimeAdminAuthMode();
const { adminTokenMatches, createAdminSession, verifyAdminSession } =
  createAdminTokenSessionService({
    enabled: adminAuthMode === 'token',
    adminToken,
    sessionSecret: adminSessionSecret,
    sessionTtlMinutes: adminSessionTtlMinutes,
    isProduction,
    projectId
  });
const sponsorLogoStorage = createSponsorLogoStorage(sponsorMediaStorageConfig);
const sponsorMediaStorage = createSponsorMediaStorage(
  sponsorMediaStorageConfig
);
const httpConfig = loadApiRuntimeHttpConfig();
const runtimeConfig = { ...startupConfig, ...httpConfig };
const {
  sponsorMediaMaxBytes,
  sponsorMediaMaxSupportingImages,
  trustedProxyHops,
  allowedOrigins,
  publicBaseUrl,
  publicBaseOrigin,
  allowedContributionAmounts,
  allowedContributionTypes,
  stripeApiHost,
  navigableSimulatedCheckout,
  stripeOptions,
  stripeBackfillOptions
} = httpConfig;
const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, stripeOptions)
  : null;
const readStripeTransparency = stripe
  ? createPublicTransparencyCache(() =>
      getStripePublicTransparencySummary(stripe, { projectId })
    )
  : null;
const adminStripeBackfill =
  dbPool && stripeSecretKey
    ? new AdminStripeBackfillService(
        dbPool,
        new Stripe(stripeSecretKey, stripeBackfillOptions),
        {
          apiKey: stripeSecretKey,
          projectId,
          environment
        }
      )
    : null;

loadApiRuntimeEmailConfig();
const readCockpitSystems = createCockpitSystemsReader({
  stripeApiConfigured: Boolean(stripe),
  stripeConnection: async () => {
    if (!stripe) throw new Error('Stripe API not configured');
    await readStripeConnection(stripe);
  },
  stripeConfigured: Boolean(stripe && stripeWebhookSecret),
  emailConfigured: getTransactionalEmailConfigStatus().configured,
  storageProvider: sponsorMediaStorage.driver === 'ovh-s3' ? 'OVH S3' : 'Local',
  databaseConfigured: Boolean(dbPool),
  database: async () => {
    if (!dbPool) throw new Error('Database unavailable');
    await readSnapshot(dbPool, async (client) => {
      await client.query('SELECT 1');
    });
  },
  stripe: () => readSystemObservation(dbPool, 'stripe'),
  email: () => readSystemObservation(dbPool, 'email'),
  storage: async (signal) => {
    if (!sponsorMediaStorage.checkReadAccess)
      throw new Error('Storage check unavailable');
    await sponsorMediaStorage.checkReadAccess(signal);
  }
});
const socialPublicationConfig = loadApiRuntimeSocialPublicationConfig();
validateApiRuntimeConfig(runtimeConfig);
const privateDataEncryptionConfigured = privateDataEncryptionKey() !== null;

const { writeJson, writeText, writeCsv, writeBinary, writePdf, writeOptions } =
  createHttpTransport({ isProduction, allowedOrigins });
const { routeMatches, routeStartsWith } = createRouteMatcher(publicBaseOrigin);
const enforceRequestRateLimit = createRequestRateLimit(
  {
    publicBaseOrigin,
    trustedProxyHops,
    rateLimitWindowMs,
    publicWriteRateLimitMax,
    sponsorshipFollowupRateLimitMax,
    referenceLookupRateLimitMax,
    referenceRecoveryRateLimitMax,
    adminRateLimitMax
  },
  writeJson
);

const { isAllowedContributionType } = createRequestValidationHelpers({
  allowedContributionTypes
});
const { buildContributionCheckoutSuccessUrl } =
  createContributionReferenceHelpers({ publicBaseOrigin });
const {
  getSponsorLogoFilenameFromUrl,
  deleteControlledSponsorLogoFile,
  sponsorMediaPublicUrl,
  routeAssetId,
  deleteSponsorMediaObjects
} = createMediaExposureHelpers({
  publicBaseOrigin,
  sponsorLogoStorage,
  sponsorMediaStorage,
  reportWarning: (message, details) => console.warn(message, details)
});
const {
  writeSponsorMediaMutationFailure,
  writeSponsorshipMutationFailure,
  writeSponsorshipRefundIneligible
} = createHttpErrorHelpers({ writeJson });
const { getFreshSponsorshipFollowupByToken } = createSponsorshipFollowupHelpers(
  {
    sponsorshipFollowupTokenTtlDays,
    stripe,
    getSponsorshipFollowupByTokenHash: (tokenHash, cutoffIso) =>
      getSponsorshipFollowupByTokenHash(dbPool, tokenHash, cutoffIso),
    upsertCheckoutSessionFromWebhook: (input) =>
      upsertCheckoutSessionFromWebhook(dbPool, input),
    reportFailure: (message, error) => console.error(message, error)
  }
);

const socialPublicationRuntime = (): {
  readonly mode: typeof socialPublicationConfig.mode;
  readonly configuredChannels: readonly SponsorFeedChannel[];
} => ({
  mode: socialPublicationConfig.mode,
  configuredChannels: configuredSocialPublicationChannels(
    socialPublicationConfig
  )
});

if (adminAuthMode === 'oidc' && !dbPool)
  throw new Error('OIDC requires PostgreSQL.');
const adminIdentity =
  adminAuthMode === 'oidc'
    ? new AdminIdentityService(dbPool!, process.env)
    : null;

const {
  resolveAdminAuthorization,
  ensureAdminAuthorization,
  ensureAdminAccess,
  getAdminAuditActor
} = createAdminAuthorization({
  adminIdentity,
  adminTokenConfigured: Boolean(adminToken),
  isProduction,
  hasDatabase,
  verifyAdminSession,
  adminTokenMatches,
  writeJson
});

const recordAdminAssistantAudit = createAssistantAuditRecorder({
  auditAvailable: Boolean(dbPool),
  getAdminAuditActor,
  insertAdminAuditLog: (input) => insertAdminAuditLog(dbPool, input),
  reportFailure: (message, error) => console.error(message, error)
});

const resolveCheckoutReturnUrl = createCheckoutReturnUrlResolver(runtimeConfig);

const setupDatabasePool = dbPool;
const { getDatabaseConnectionStatus, buildAdminSetupStatus } =
  createAdminSetupHelpers({
    getAdminIdentitySetupStatus: () =>
      buildAdminIdentitySetupStatus(
        adminIdentity,
        privateDataEncryptionConfigured
      ),
    checkDatabaseConnection: setupDatabasePool
      ? () => setupDatabasePool.query('SELECT 1')
      : null,
    getEmailQueueStatus: () => getEmailQueueStatus(dbPool),
    getTransactionalEmailConfigStatus,
    hasDatabase,
    stripeConfigured: Boolean(stripe),
    stripeSecretKeyConfigured: Boolean(stripeSecretKey),
    stripeWebhookSecretConfigured: Boolean(stripeWebhookSecret),
    stripeLiveMode: Boolean(stripeSecretKey?.startsWith('sk_live_')),
    businessSponsorshipEnabled,
    publicBaseUrl,
    publicBaseOrigin,
    allowedOrigins,
    adminSponsorshipReviewReminderConfig,
    emailQueuePollIntervalMs,
    emailQueueBatchSize,
    sponsorshipInvoiceConfig: {
      invoicePrefix: sponsorshipInvoiceConfig.invoicePrefix,
      issuerName: sponsorshipInvoiceConfig.issuerName,
      issuerEmail: sponsorshipInvoiceConfig.issuerEmail,
      taxLabel: sponsorshipInvoiceConfig.taxLabel,
      issuerAddressConfigured: Boolean(sponsorshipInvoiceConfig.issuerAddress),
      issuerTaxIdConfigured: Boolean(sponsorshipInvoiceConfig.issuerTaxId)
    },
    readEnvironment: (key) => process.env[key],
    reportFailure: (message, error) => console.error(message, error)
  });

const publicationAutomation = dbPool
  ? new PublicationAutomationService(dbPool, sponsorMediaStorage)
  : null;
const contributionNotifications = loadApiRuntimeContributionNotificationConfig(
  process.env
);
const contributionActivity = dbPool
  ? new ContributionActivityService(dbPool, contributionNotifications)
  : null;
const adminPilotage =
  dbPool && publicationAutomation
    ? new AdminPilotageService(dbPool, publicationAutomation)
    : null;
const backgroundWorkers = createApiBackgroundWorkers({
  hasDatabase,
  dbPool,
  emailQueueWorkerEnabled,
  emailQueueBatchSize,
  emailQueuePollIntervalMs,
  adminSponsorshipReviewReminderConfig,
  publicBaseUrl,
  processQueuedEmailMessages,
  queueDueSponsorshipReviewReminder,
  buildSponsorshipReviewReminderAdminUrl,
  contributionActivity,
  publicationAutomation
});

const publicHandlers = createPublicHttpHandlers({
  dbPool,
  hasDatabase,
  stripe,
  stripeWebhookSecret,
  publicBaseUrl,
  publicBaseOrigin,
  projectId,
  isProduction,
  businessSponsorshipEnabled,
  allowedContributionAmounts,
  stripeApiHost,
  navigableSimulatedCheckout,
  sponsorshipFollowupTokenTtlDays,
  sponsorMediaMaxBytes,
  sponsorMediaMaxSupportingImages,
  readBody,
  readBodyBuffer,
  writeJson,
  writeBinary,
  isAllowedContributionType,
  resolveCheckoutReturnUrl,
  buildContributionCheckoutSuccessUrl,
  getFreshSponsorshipFollowupByToken,
  routeAssetId,
  deleteSponsorMediaObjects,
  writeSponsorMediaMutationFailure,
  getSponsorLogoFilenameFromUrl,
  sponsorLogoStorage,
  sponsorMediaStorage,
  readStripeTransparency
});

const adminHandlers = createAdminHttpHandlers({
  dbPool,
  publicBaseOrigin,
  allowedOrigins,
  isProduction,
  stripe,
  sponsorshipFollowupTokenTtlDays,
  sponsorMediaMaxBytes,
  sponsorMediaMaxSupportingImages,
  sponsorLogoMaxBytes,
  ensureAdminAccess,
  ensureAdminAuthorization,
  resolveAdminAuthorization,
  getAdminAuditActor,
  readBody,
  readBodyBuffer,
  writeJson,
  writeCsv,
  writePdf,
  writeBinary,
  routeAssetId,
  sponsorMediaStorage,
  sponsorMediaPublicUrl,
  deleteSponsorMediaObjects,
  writeSponsorMediaMutationFailure,
  sponsorLogoStorage,
  getSponsorLogoFilenameFromUrl,
  deleteControlledSponsorLogoFile,
  writeSponsorshipMutationFailure,
  recordAdminAssistantAudit,
  adminAssistantConfig,
  readCockpitSystems,
  socialPublicationRuntime,
  adminPilotage,
  adminIdentity,
  publicationAutomation,
  writeSponsorshipRefundIneligible,
  adminStripeBackfill,
  contributionActivity,
  adminTokenConfigured: Boolean(adminToken),
  adminTokenMatches,
  createAdminSession,
  buildAdminSetupStatus,
  adminNotificationRecipient: () =>
    process.env.FUNDING_ADMIN_NOTIFICATION_EMAIL?.trim() ?? ''
});

const handleRequest = createHttpDispatcher({
  transport: { writeOptions, writeJson, writeText },
  enforceRequestRateLimit,
  matcher: { routeMatches, routeStartsWith },
  adminAuthMode,
  adminIdentity,
  handlers: { ...publicHandlers, ...adminHandlers },
  isProduction,
  readDevelopmentStatus: async () => ({
    environment: process.env.FUNDING_PLATFORM_ENV ?? 'development',
    apiReachable: true,
    stripeSecretKeyConfigured: Boolean(stripeSecretKey),
    stripeWebhookSecretConfigured: Boolean(stripeWebhookSecret),
    businessSponsorshipEnabled,
    databaseUrlConfigured: hasDatabase,
    databaseReachable: await getDatabaseConnectionStatus(),
    transparencySource: hasDatabase ? 'database' : stripe ? 'stripe' : 'none',
    localApiBaseUrl: `http://localhost:${port}`,
    checkoutEndpoint: `http://localhost:${port}/api/checkout-sessions`,
    webhookEndpoint: `http://localhost:${port}/api/stripe/webhook`,
    publicTransparencyEndpoint: `http://localhost:${port}/api/public/fund-transparency`,
    stripeDashboardUrl: 'https://dashboard.stripe.com/test/webhooks',
    lastCheckedAt: new Date().toISOString()
  })
});

try {
  await assertProductionDatabasePrivileges(dbPool, isProduction);
} catch (error) {
  await dbPool?.end();
  throw error;
}

createServer(
  createApiRequestListener({
    handleRequest,
    writeJson,
    reportFailure: (message) => console.error(message)
  })
).listen(port, () => {
  console.log(`Funding API listening on http://localhost:${port}`);
  if (!hasDatabase) {
    console.info(
      'DATABASE_URL is not configured. Using Stripe-direct public transparency.'
    );
    return;
  }

  backgroundWorkers.start();
});
