import { isJsonContentType } from '../http-routing.js';

import type { HttpDispatcher, HttpDispatcherContext } from './contracts.js';

/** Importing or composing dispatch has no effects; global guards precede all routes. */
export const createHttpDispatcher = ({
  transport,
  enforceRequestRateLimit,
  matcher,
  adminAuthMode,
  adminIdentity,
  handlers,
  isProduction,
  readDevelopmentStatus
}: HttpDispatcherContext): HttpDispatcher => {
  const { writeOptions, writeJson, writeText } = transport;
  const { routeMatches, routeStartsWith } = matcher;
  const {
    handleAdminStripeBackfillRequest,
    handleAdminPilotageRequest,
    handleAdminContributionActivityRequest,
    handleAdminPublicationAutomationRequest,
    handleAdminSponsorshipMediaRequest,
    handleSponsorshipFollowupMediaRequest,
    handleReferenceLookupRequest,
    handlePublicPaymentsRequest,
    handleReferenceRecoveryRequest,
    handleSponsorshipFollowupRequest,
    handleAdminSponsorshipAccessRequest,
    handleLegacySponsorshipDetailsRequest,
    handleStripeWebhookRequest,
    handleAdminSessionRequest,
    handleAdminBackupsRequest,
    handleAdminSetupRequest,
    handleAdminEmailRequest,
    handleAdminDocumentsRequest,
    handlePublicSponsorMediaRequest,
    handleAdminInsightsRequest,
    handleAdminSponsorshipRecordsRequest,
    handleAdminAssistantRequest,
    handleAdminContributionsRequest,
    handleAdminAccountingRequest,
    handleAdminPublicationDraftsRequest,
    handleAdminPublicationSlotsRequest,
    handleAdminPublicationBatchesRequest,
    handleAdminAuditRequest,
    handleAdminSponsorshipDecisionsRequest,
    handleAdminSponsorshipRefundRequest,
    handlePublicFundingRequest
  } = handlers;

  return async (request, response): Promise<void> => {
    if (request.method === 'OPTIONS') {
      writeOptions(request, response);
      return;
    }

    if (!enforceRequestRateLimit(request, response)) {
      return;
    }
    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/sponsorship-followup/details',
        '/api/sponsorship-followup/details',
        '/sponsorship-followup/draft',
        '/api/sponsorship-followup/draft',
        '/sponsorship-followup/recover',
        '/api/sponsorship-followup/recover',
        '/sponsorship-followup/media/delete',
        '/api/sponsorship-followup/media/delete'
      ) &&
      !isJsonContentType(request.headers['content-type'])
    ) {
      writeJson(request, response, 415, {
        code: 'JSON_REQUIRED',
        error: 'Content-Type must be application/json.'
      });
      return;
    }

    if (
      request.method === 'GET' &&
      routeMatches(request.url, '/admin/auth/config', '/api/admin/auth/config')
    ) {
      writeJson(request, response, 200, { mode: adminAuthMode });
      return;
    }
    if (
      adminIdentity &&
      routeStartsWith(request.url, '/admin/', '/api/admin/')
    ) {
      try {
        await adminIdentity.resolve(request);
        if (await adminIdentity.handle(request, response)) return;
      } catch {
        writeJson(request, response, 503, {
          error: 'Identity service unavailable.'
        });
        return;
      }
    }

    // Keep the historical interleaving: regrouping public/admin routes changes precedence.
    if (await handleAdminStripeBackfillRequest(request, response)) return;
    if (await handleAdminPilotageRequest(request, response)) return;
    if (await handleAdminContributionActivityRequest(request, response)) return;
    if (await handleAdminPublicationAutomationRequest(request, response))
      return;
    if (await handleAdminSponsorshipMediaRequest(request, response)) return;
    if (await handleSponsorshipFollowupMediaRequest(request, response)) return;
    if (await handleReferenceLookupRequest(request, response)) return;
    if (await handlePublicPaymentsRequest(request, response)) return;
    if (await handleReferenceRecoveryRequest(request, response)) return;
    if (await handleSponsorshipFollowupRequest(request, response)) return;
    if (await handleAdminSponsorshipAccessRequest(request, response)) return;
    if (await handleLegacySponsorshipDetailsRequest(request, response)) return;
    if (await handleStripeWebhookRequest(request, response)) return;
    if (await handleAdminSessionRequest(request, response)) return;
    if (await handleAdminBackupsRequest(request, response)) return;
    if (await handleAdminSetupRequest(request, response)) return;
    if (await handleAdminEmailRequest(request, response)) return;
    if (await handleAdminDocumentsRequest(request, response)) return;
    if (await handlePublicSponsorMediaRequest(request, response)) return;
    if (await handleAdminInsightsRequest(request, response)) return;
    if (await handleAdminSponsorshipRecordsRequest(request, response)) return;
    if (await handleAdminAssistantRequest(request, response)) return;
    if (await handleAdminContributionsRequest(request, response)) return;
    if (await handleAdminAccountingRequest(request, response)) return;
    if (await handleAdminPublicationDraftsRequest(request, response)) return;
    if (await handleAdminPublicationSlotsRequest(request, response)) return;
    if (await handleAdminPublicationBatchesRequest(request, response)) return;
    if (await handleAdminAuditRequest(request, response)) return;
    if (await handleAdminSponsorshipDecisionsRequest(request, response)) return;
    if (await handleAdminSponsorshipRefundRequest(request, response)) return;
    if (await handlePublicFundingRequest(request, response)) return;

    if (request.method === 'GET' && routeMatches(request.url, '/health')) {
      writeText(request, response, 200, 'ok');
      return;
    }

    if (
      !isProduction &&
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/dev/stripe-setup-status',
        '/api/dev/stripe-setup-status'
      )
    ) {
      writeJson(request, response, 200, await readDevelopmentStatus());
      return;
    }

    writeJson(request, response, 404, { error: 'Not found' });
  };
};
