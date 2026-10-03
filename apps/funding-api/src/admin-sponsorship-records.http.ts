import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminInformationRequest,
  AdminInformationRequestResult,
  AdminSponsorshipDetailsResult,
  AdminSponsorshipsResponse,
  SponsorFeedStatus,
  SponsorshipIntervention,
  SponsorshipInterventionsResponse,
  AdminSponsorshipProgressResponse,
  SponsorshipReviewStatus
} from '@openg7/funding-core';

import type { listAdminSponsorships } from './fund-contributions.repository.js';
import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';
import { SponsorshipDetailsError } from './admin-sponsorship-details.service.js';
import { SponsorshipInterventionError } from './sponsorship-interventions.service.js';
import {
  InformationRequestError,
  validateInformationRequest
} from './sponsorship-information.service.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;
type AdminSponsorshipListInput = Parameters<typeof listAdminSponsorships>[1];
type AdminAuthorizationCheck = (
  request: ApiRequest,
  response: ApiResponse
) => boolean;

/** Dossier ports preserve authoritative validation, versioning and transactional audit in their services. */
export interface AdminSponsorshipRecordsHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAuthorization: AdminAuthorizationCheck;
  readonly ensureAdminAccess: AdminAuthorizationCheck;
  readonly getAdminAuditActor: (request: ApiRequest) => string;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly readBody: (request: ApiRequest, maxBytes: number) => Promise<string>;
  readonly isValidUuid: (value: unknown) => value is string;
  readonly allowedSponsorshipReviewStatuses: ReadonlySet<SponsorshipReviewStatus>;
  readonly allowedSponsorFeedStatuses: ReadonlySet<SponsorFeedStatus>;
  readonly listAdminSponsorships: (
    query: AdminSponsorshipListInput
  ) => ReturnType<typeof listAdminSponsorships>;
  readonly getSponsorshipProgress: (
    sponsorshipId?: string
  ) => Promise<AdminSponsorshipProgressResponse>;
  readonly requestSponsorshipInformation: (
    input: AdminInformationRequest,
    actor: string
  ) => Promise<AdminInformationRequestResult>;
  readonly updateAdminSponsorshipDetails: (
    input: unknown,
    actor: string
  ) => Promise<AdminSponsorshipDetailsResult>;
  readonly getSponsorshipInterventions: (
    sponsorshipId: string | null,
    before: string | null
  ) => Promise<SponsorshipInterventionsResponse>;
  readonly recordSponsorshipIntervention: (
    input: unknown,
    actor: string
  ) => Promise<SponsorshipIntervention>;
  readonly reportFailure: (message: string, error: unknown) => void;
}

const adminSponsorshipPageSizes = new Set([6, 10, 25]);
const adminSponsorshipPaymentStatuses = new Set([
  'paid',
  'refunded',
  'disputed'
]);
const adminSponsorshipSorts = new Set([
  'priority',
  'paid_at',
  'submitted_at',
  'amount',
  'company',
  'updated_at'
]);

/** Unknown paths fall through; each owned route authorizes before accessing dossier data. */
export const createAdminSponsorshipRecordsHttpHandler = ({
  publicBaseOrigin,
  ensureAdminAuthorization,
  ensureAdminAccess,
  getAdminAuditActor,
  writeJson,
  readBody,
  isValidUuid,
  allowedSponsorshipReviewStatuses,
  allowedSponsorFeedStatuses,
  listAdminSponsorships,
  getSponsorshipProgress,
  requestSponsorshipInformation,
  updateAdminSponsorshipDetails,
  getSponsorshipInterventions,
  recordSponsorshipIntervention,
  reportFailure
}: AdminSponsorshipRecordsHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  const parseAdminSponsorshipsQuery = (
    url: string | undefined
  ): AdminSponsorshipListInput => {
    const searchParams = new URL(url ?? '/', publicBaseOrigin).searchParams;
    const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
    const requestedPageSize = Number.parseInt(
      searchParams.get('pageSize') ?? '6',
      10
    );
    const reviewStatus =
      searchParams.get('reviewStatus') === 'pending'
        ? 'pending_review'
        : searchParams.get('reviewStatus');
    const feedStatus = searchParams.get('feedStatus');
    const paymentStatus = searchParams.get('paymentStatus');
    const sort = searchParams.get('sort');
    const direction = searchParams.get('direction');
    const search = searchParams.get('search')?.trim();

    return {
      page:
        Number.isInteger(requestedPage) && requestedPage > 0
          ? requestedPage
          : 1,
      pageSize: adminSponsorshipPageSizes.has(requestedPageSize)
        ? requestedPageSize
        : 6,
      search: search || undefined,
      reviewStatus:
        reviewStatus &&
        allowedSponsorshipReviewStatuses.has(
          reviewStatus as SponsorshipReviewStatus
        )
          ? (reviewStatus as SponsorshipReviewStatus)
          : undefined,
      feedStatus:
        feedStatus &&
        allowedSponsorFeedStatuses.has(feedStatus as SponsorFeedStatus)
          ? (feedStatus as SponsorFeedStatus)
          : undefined,
      paymentStatus:
        paymentStatus && adminSponsorshipPaymentStatuses.has(paymentStatus)
          ? (paymentStatus as 'paid' | 'refunded' | 'disputed')
          : undefined,
      sort:
        sort && adminSponsorshipSorts.has(sort)
          ? (sort as NonNullable<AdminSponsorshipListInput['sort']>)
          : 'priority',
      direction: direction === 'asc' ? 'asc' : 'desc'
    };
  };

  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/sponsorships/progress',
        '/api/admin/sponsorships/progress'
      )
    ) {
      if (!ensureAdminAuthorization(request, response)) return true;
      const id = new URL(request.url!, 'http://localhost').searchParams.get(
        'sponsorshipId'
      );
      if (id !== null && !isValidUuid(id)) {
        writeJson(request, response, 400, { error: 'Invalid sponsorship ID.' });
        return true;
      }
      try {
        writeJson(
          request,
          response,
          200,
          await getSponsorshipProgress(id ?? undefined),
          { 'Cache-Control': 'private, no-store' }
        );
      } catch {
        writeJson(
          request,
          response,
          503,
          { error: 'Sponsorship progress unavailable.' },
          { 'Cache-Control': 'private, no-store' }
        );
      }
      return true;
    }

    if (
      request.method === 'POST' &&
      routeMatches(
        request.url,
        '/admin/sponsorships/request-information',
        '/api/admin/sponsorships/request-information'
      )
    ) {
      if (!ensureAdminAccess(request, response)) return true;
      try {
        let input;
        try {
          input = validateInformationRequest(
            JSON.parse(await readBody(request, 32 * 1024))
          );
        } catch {
          throw new InformationRequestError(400);
        }
        const result = await requestSponsorshipInformation(
          input,
          getAdminAuditActor(request)
        );
        writeJson(request, response, 200, result, {
          'Cache-Control': 'private, no-store'
        });
      } catch (error) {
        writeJson(
          request,
          response,
          error instanceof InformationRequestError ? error.status : 503,
          {
            error:
              'Information request could not be queued. Refresh the record before trying again.'
          },
          { 'Cache-Control': 'private, no-store' }
        );
      }
      return true;
    }

    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/sponsorships',
        '/api/admin/sponsorships'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      try {
        const sponsorships = await listAdminSponsorships(
          parseAdminSponsorshipsQuery(request.url)
        );
        const result: AdminSponsorshipsResponse = {
          data_source: 'database',
          items: sponsorships.items,
          sponsorships: sponsorships.items,
          pagination: sponsorships.pagination,
          last_updated_at: sponsorships.lastUpdatedAt
        };

        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to load admin sponsorships.', error);
        writeJson(request, response, 502, {
          error: 'Admin sponsorships could not be loaded.'
        });
      }
      return true;
    }

    if (
      routeMatches(
        request.url,
        '/admin/sponsorships/details',
        '/api/admin/sponsorships/details'
      )
    ) {
      if (!ensureAdminAccess(request, response)) return true;
      response.setHeader('Cache-Control', 'private, no-store');
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        writeJson(request, response, 405, { error: 'Method not allowed.' });
        return true;
      }
      if (
        request.headers['content-type']?.split(';')[0].trim().toLowerCase() !==
        'application/json'
      ) {
        writeJson(request, response, 415, { error: 'JSON body required.' });
        return true;
      }
      let input: unknown;
      try {
        input = JSON.parse(await readBody(request, 16 * 1024));
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid sponsorship details request.'
        });
        return true;
      }
      try {
        const result = await updateAdminSponsorshipDetails(
          input,
          getAdminAuditActor(request)
        );
        writeJson(request, response, 200, result);
      } catch (error) {
        writeJson(
          request,
          response,
          error instanceof SponsorshipDetailsError ? error.status : 503,
          { error: 'Sponsorship details could not be updated.' }
        );
      }
      return true;
    }

    if (
      routeMatches(
        request.url,
        '/admin/sponsorships/interventions',
        '/api/admin/sponsorships/interventions'
      )
    ) {
      response.setHeader('Cache-Control', 'private, no-store');
      if (!ensureAdminAccess(request, response)) return true;
      if (request.method !== 'GET' && request.method !== 'POST') {
        response.setHeader('Allow', 'GET, POST');
        writeJson(request, response, 405, { error: 'Method not allowed.' });
        return true;
      }
      try {
        if (request.method === 'GET') {
          const params = new URL(request.url!, 'http://localhost').searchParams;
          writeJson(
            request,
            response,
            200,
            await getSponsorshipInterventions(
              params.get('sponsorshipId'),
              params.get('before')
            )
          );
        } else {
          if (
            request.headers['content-type']
              ?.split(';')[0]
              .trim()
              .toLowerCase() !== 'application/json'
          ) {
            writeJson(request, response, 415, { error: 'JSON body required.' });
            return true;
          }
          let input: unknown;
          try {
            input = JSON.parse(await readBody(request, 16 * 1024));
          } catch {
            throw new SponsorshipInterventionError(400);
          }
          writeJson(
            request,
            response,
            200,
            await recordSponsorshipIntervention(
              input,
              getAdminAuditActor(request)
            )
          );
        }
      } catch (error) {
        writeJson(
          request,
          response,
          error instanceof SponsorshipInterventionError ? error.status : 503,
          {
            code: 'SPONSORSHIP_INTERVENTION_FAILED',
            error: 'Sponsorship interventions could not be processed.'
          }
        );
      }
      return true;
    }

    return false;
  };
};
