import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  FundTransparencyPublicResponse,
  PublicBuildersResponse,
  PublicFundingRuntimeConfig,
  PublicSponsorshipBatchAvailabilityResponse,
  PublicSponsorshipsResponse
} from '@openg7/funding-core';

import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';
import {
  parsePublicDirectoryPagination,
  type PublicDirectoryPagination
} from './public-directory-pagination.js';
import {
  parsePublicSponsorshipPagination,
  type PublicSponsorshipPagination
} from './public-sponsorship-pagination.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

/** Public projections retain eligibility and source selection in their readers. */
export interface PublicFundingHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly listPublicSponsorships: (
    pagination: PublicSponsorshipPagination
  ) => Promise<PublicSponsorshipsResponse>;
  readonly listPublicBuilders: (
    pagination: PublicDirectoryPagination
  ) => Promise<PublicBuildersResponse>;
  readonly getPublicSponsorshipBatchAvailability: () => Promise<PublicSponsorshipBatchAvailabilityResponse>;
  readonly getPublicFundingRuntimeConfig: () => PublicFundingRuntimeConfig;
  readonly getPublicTransparencySummary: () => Promise<FundTransparencyPublicResponse>;
  readonly reportFailure: (message: string, error?: unknown) => void;
}

/** Read-only routes accept only public result ports, without provider or admin access. */
export const createPublicFundingHttpHandler = ({
  publicBaseOrigin,
  writeJson,
  listPublicSponsorships,
  listPublicBuilders,
  getPublicSponsorshipBatchAvailability,
  getPublicFundingRuntimeConfig,
  getPublicTransparencySummary,
  reportFailure
}: PublicFundingHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);

  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/public/sponsorships',
        '/api/public/sponsorships'
      )
    ) {
      try {
        const pagination = parsePublicSponsorshipPagination(
          new URL(request.url ?? '/', publicBaseOrigin).searchParams
        );
        if (!pagination) {
          writeJson(request, response, 400, {
            error: 'Invalid public sponsorship pagination.'
          });
          return true;
        }
        const sponsorships = await listPublicSponsorships(pagination);
        writeJson(request, response, 200, sponsorships);
      } catch (error) {
        reportFailure('Failed to load public sponsorships.', error);
        writeJson(request, response, 502, {
          error: 'Public sponsorships could not be loaded.'
        });
      }
      return true;
    }

    if (
      request.method === 'GET' &&
      routeMatches(request.url, '/public/builders', '/api/public/builders')
    ) {
      const pagination = parsePublicDirectoryPagination(
        new URL(request.url ?? '/', publicBaseOrigin).searchParams,
        24
      );
      if (!pagination) {
        writeJson(request, response, 400, {
          error: 'Invalid public directory pagination.'
        });
        return true;
      }
      try {
        writeJson(request, response, 200, await listPublicBuilders(pagination));
      } catch {
        reportFailure('Failed to load public builders.');
        writeJson(request, response, 502, {
          error: 'Public builders could not be loaded.'
        });
      }
      return true;
    }

    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/public/sponsorship-batches/availability',
        '/api/public/sponsorship-batches/availability'
      )
    ) {
      try {
        const availability = await getPublicSponsorshipBatchAvailability();
        writeJson(request, response, 200, availability);
      } catch (error) {
        reportFailure(
          'Failed to load public sponsorship batch availability.',
          error
        );
        writeJson(request, response, 502, {
          error: 'Sponsorship batch availability could not be loaded.'
        });
      }
      return true;
    }

    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/public/funding-config',
        '/api/public/funding-config'
      )
    ) {
      writeJson(request, response, 200, getPublicFundingRuntimeConfig());
      return true;
    }

    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/public/fund-transparency',
        '/api/public/fund-transparency'
      )
    ) {
      try {
        const summary = await getPublicTransparencySummary();
        writeJson(request, response, 200, summary);
      } catch (error) {
        reportFailure(
          'Failed to build public fund transparency summary.',
          error
        );
        writeJson(request, response, 502, {
          error: 'Public fund transparency summary could not be loaded.'
        });
      }
      return true;
    }

    return false;
  };
};
