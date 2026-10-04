import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Pool } from 'pg';
import type Stripe from 'stripe';

import type { AdminAssistantHttpDependencies } from '../admin-assistant.http.js';
import type { AdminBackupsHttpDependencies } from '../admin-backups.http.js';
import type { AdminContributionActivityHttpDependencies } from '../admin-contribution-activity.http.js';
import type { AdminContributionsHttpDependencies } from '../admin-contributions.http.js';
import type { AdminDocumentsHttpDependencies } from '../admin-documents.http.js';
import type { AdminEmailHttpDependencies } from '../admin-email.http.js';
import type { AdminIdentityService } from '../admin-identity.js';
import type { AdminInsightsHttpDependencies } from '../admin-insights.http.js';
import type { AdminPilotageHttpDependencies } from '../admin-pilotage.http.js';
import type { AdminPublicationAutomationHttpDependencies } from '../admin-publication-automation.http.js';
import type { AdminPublicationBatchesHttpDependencies } from '../admin-publication-batches.http.js';
import type { AdminSessionHttpDependencies } from '../admin-session.http.js';
import type { AdminSetupHttpDependencies } from '../admin-setup.http.js';
import type { AdminSponsorshipMediaHttpDependencies } from '../admin-sponsorship-media.http.js';
import type { AdminSponsorshipRefundHttpDependencies } from '../admin-sponsorship-refund.http.js';
import type { AdminStripeBackfillHttpDependencies } from '../admin-stripe-backfill.http.js';
import type { ApiRuntimeConfig } from '../api-runtime-config.js';
import type { createHttpTransport, readBody } from '../http-transport.js';
import type { createRouteMatcher } from '../http-routing.js';
import type { PublicFundingHttpDependencies } from '../public-funding.http.js';
import type { PublicPaymentsHttpDependencies } from '../public-payments.http.js';
import type { PublicSponsorMediaHttpDependencies } from '../public-sponsor-media.http.js';
import type { SponsorshipFollowupHttpDependencies } from '../sponsorship-followup.http.js';
import type { SponsorshipFollowupMediaHttpDependencies } from '../sponsorship-followup-media.http.js';

export type ApiRequest = IncomingMessage;
export type ApiResponse = ServerResponse<IncomingMessage>;
export type HttpHandler = (
  request: ApiRequest,
  response: ApiResponse
) => Promise<boolean>;
export type HttpDispatcher = (
  request: ApiRequest,
  response: ApiResponse
) => Promise<void>;

export interface PublicHttpHandlers {
  readonly handlePublicFundingRequest: HttpHandler;
  readonly handlePublicPaymentsRequest: HttpHandler;
  readonly handleReferenceLookupRequest: HttpHandler;
  readonly handleReferenceRecoveryRequest: HttpHandler;
  readonly handlePublicSponsorMediaRequest: HttpHandler;
  readonly handleSponsorshipFollowupRequest: HttpHandler;
  readonly handleSponsorshipFollowupMediaRequest: HttpHandler;
  readonly handleLegacySponsorshipDetailsRequest: HttpHandler;
  readonly handleStripeWebhookRequest: HttpHandler;
}

export interface AdminHttpHandlers {
  readonly handleAdminContributionsRequest: HttpHandler;
  readonly handleAdminDocumentsRequest: HttpHandler;
  readonly handleAdminAccountingRequest: HttpHandler;
  readonly handleAdminEmailRequest: HttpHandler;
  readonly handleAdminInsightsRequest: HttpHandler;
  readonly handleAdminSponsorshipRecordsRequest: HttpHandler;
  readonly handleAdminSponsorshipDecisionsRequest: HttpHandler;
  readonly handleAdminSponsorshipMediaRequest: HttpHandler;
  readonly handleAdminAssistantRequest: HttpHandler;
  readonly handleAdminPublicationDraftsRequest: HttpHandler;
  readonly handleAdminPublicationSlotsRequest: HttpHandler;
  readonly handleAdminPublicationBatchesRequest: HttpHandler;
  readonly handleAdminPilotageRequest: HttpHandler;
  readonly handleAdminPublicationAutomationRequest: HttpHandler;
  readonly handleAdminSponsorshipRefundRequest: HttpHandler;
  readonly handleAdminStripeBackfillRequest: HttpHandler;
  readonly handleAdminContributionActivityRequest: HttpHandler;
  readonly handleAdminSessionRequest: HttpHandler;
  readonly handleAdminBackupsRequest: HttpHandler;
  readonly handleAdminSetupRequest: HttpHandler;
  readonly handleAdminAuditRequest: HttpHandler;
  readonly handleAdminSponsorshipAccessRequest: HttpHandler;
}

export type HttpHandlers = PublicHttpHandlers & AdminHttpHandlers;

// Each composition receives only its runtime instances and already configured
// helpers. Dependency types belong to the existing handlers; imports are inert.
export interface PublicHttpCompositionContext
  extends
    Pick<
      PublicPaymentsHttpDependencies,
      | 'publicBaseOrigin'
      | 'readBody'
      | 'writeJson'
      | 'projectId'
      | 'isProduction'
      | 'businessSponsorshipEnabled'
      | 'allowedContributionAmounts'
      | 'stripeApiHost'
      | 'navigableSimulatedCheckout'
      | 'isAllowedContributionType'
      | 'resolveCheckoutReturnUrl'
      | 'buildContributionCheckoutSuccessUrl'
    >,
    Pick<
      SponsorshipFollowupHttpDependencies,
      | 'hasDatabase'
      | 'sponsorshipFollowupTokenTtlDays'
      | 'getFreshSponsorshipFollowupByToken'
    >,
    Pick<
      SponsorshipFollowupMediaHttpDependencies,
      | 'sponsorMediaMaxBytes'
      | 'sponsorMediaMaxSupportingImages'
      | 'readBodyBuffer'
      | 'writeBinary'
      | 'routeAssetId'
      | 'deleteSponsorMediaObjects'
      | 'writeSponsorMediaMutationFailure'
    >,
    Pick<
      PublicSponsorMediaHttpDependencies,
      'getSponsorLogoFilenameFromUrl' | 'sponsorLogoStorage'
    > {
  readonly dbPool: Pool | null;
  readonly stripe: Stripe | null;
  readonly stripeWebhookSecret: ApiRuntimeConfig['stripeWebhookSecret'];
  readonly publicBaseUrl: ApiRuntimeConfig['publicBaseUrl'];
  readonly sponsorMediaStorage: PublicSponsorMediaHttpDependencies['sponsorMediaStorage'] &
    SponsorshipFollowupMediaHttpDependencies['sponsorMediaStorage'];
  readonly readStripeTransparency:
    PublicFundingHttpDependencies['getPublicTransparencySummary'] | null;
}

export interface AdminHttpCompositionContext
  extends
    Pick<
      AdminContributionsHttpDependencies,
      | 'publicBaseOrigin'
      | 'ensureAdminAccess'
      | 'getAdminAuditActor'
      | 'writeJson'
      | 'writeCsv'
    >,
    Pick<AdminDocumentsHttpDependencies, 'writePdf'>,
    Pick<
      AdminEmailHttpDependencies,
      'ensureAdminAuthorization' | 'adminNotificationRecipient'
    >,
    Pick<AdminInsightsHttpDependencies, 'readCockpitSystems'>,
    Pick<
      AdminSponsorshipMediaHttpDependencies,
      | 'sponsorMediaMaxBytes'
      | 'sponsorMediaMaxSupportingImages'
      | 'sponsorLogoMaxBytes'
      | 'readBodyBuffer'
      | 'writeBinary'
      | 'routeAssetId'
      | 'sponsorMediaStorage'
      | 'sponsorMediaPublicUrl'
      | 'deleteSponsorMediaObjects'
      | 'writeSponsorMediaMutationFailure'
      | 'sponsorLogoStorage'
      | 'getSponsorLogoFilenameFromUrl'
      | 'deleteControlledSponsorLogoFile'
      | 'writeSponsorshipMutationFailure'
    >,
    Pick<AdminAssistantHttpDependencies, 'recordAdminAssistantAudit'>,
    Pick<AdminPublicationBatchesHttpDependencies, 'socialPublicationRuntime'>,
    Pick<AdminPilotageHttpDependencies, 'adminPilotage' | 'adminIdentity'>,
    Pick<AdminPublicationAutomationHttpDependencies, 'publicationAutomation'>,
    Pick<
      AdminSponsorshipRefundHttpDependencies,
      'isProduction' | 'stripe' | 'writeSponsorshipRefundIneligible'
    >,
    Pick<AdminStripeBackfillHttpDependencies, 'adminStripeBackfill'>,
    Pick<AdminContributionActivityHttpDependencies, 'contributionActivity'>,
    Pick<
      AdminSessionHttpDependencies,
      'adminTokenConfigured' | 'adminTokenMatches' | 'createAdminSession'
    >,
    Pick<
      AdminBackupsHttpDependencies,
      'allowedOrigins' | 'resolveAdminAuthorization'
    >,
    Pick<AdminSetupHttpDependencies, 'buildAdminSetupStatus'> {
  readonly dbPool: Pool | null;
  readonly readBody: typeof readBody;
  readonly sponsorshipFollowupTokenTtlDays: ApiRuntimeConfig['sponsorshipFollowupTokenTtlDays'];
  readonly adminAssistantConfig: ApiRuntimeConfig['adminAssistantConfig'];
}

// The dispatcher owns global precedence and interleaves named public/admin ports
// in the historical order. It requires no runtime constructors or environment.
export interface HttpDispatcherContext {
  readonly transport: Pick<
    ReturnType<typeof createHttpTransport>,
    'writeOptions' | 'writeJson' | 'writeText'
  >;
  readonly enforceRequestRateLimit: (
    request: ApiRequest,
    response: ApiResponse
  ) => boolean;
  readonly matcher: ReturnType<typeof createRouteMatcher>;
  readonly adminAuthMode: 'token' | 'oidc';
  readonly adminIdentity: Pick<
    AdminIdentityService,
    'resolve' | 'handle'
  > | null;
  readonly handlers: HttpHandlers;
  readonly isProduction: boolean;
  readonly readDevelopmentStatus: () => Promise<unknown>;
}

export interface ApiRequestListenerContext {
  readonly handleRequest: HttpDispatcher;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly reportFailure: (message: string) => void;
}
