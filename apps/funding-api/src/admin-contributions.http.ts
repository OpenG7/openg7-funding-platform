import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AdminContributionsResponse } from '@openg7/funding-core';

import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

/** Contribution ports retain selection validation and audited export in the service. */
export interface AdminContributionsHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAccess: (
    request: ApiRequest,
    response: ApiResponse
  ) => boolean;
  readonly getAdminAuditActor: (request: ApiRequest) => string;
  readonly readBody: (request: ApiRequest, maxBytes: number) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly writeCsv: ReturnType<typeof createHttpTransport>['writeCsv'];
  readonly listAdminContributions: (
    contributionId?: string
  ) => Promise<AdminContributionsResponse>;
  readonly exportAdminContributions: (
    input: unknown,
    actor: string
  ) => Promise<{ csv: string; requestId: string }>;
  readonly ContributionExportError: new (
    status: 400 | 409 | 503,
    code: string
  ) => Error & { readonly status: 400 | 409 | 503; readonly code: string };
  readonly reportFailure: (message: string, error?: unknown) => void;
}

/** Unowned routes fall through; private CSV access is checked before parsing. */
export const createAdminContributionsHttpHandler = ({
  publicBaseOrigin,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  writeCsv,
  listAdminContributions,
  exportAdminContributions,
  ContributionExportError,
  reportFailure
}: AdminContributionsHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);

  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method === 'GET' &&
      routeMatches(
        request.url,
        '/admin/contributions',
        '/api/admin/contributions'
      )
    ) {
      if (!ensureAdminAccess(request, response)) {
        return true;
      }

      try {
        const contributionId =
          new URL(request.url!, publicBaseOrigin).searchParams.get(
            'contributionId'
          ) ?? undefined;
        if (
          contributionId !== undefined &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            contributionId
          )
        ) {
          writeJson(request, response, 400, {
            error: 'Invalid contribution identifier.'
          });
          return true;
        }
        const result = await listAdminContributions(contributionId);
        writeJson(request, response, 200, result);
      } catch (error) {
        reportFailure('Failed to load admin contributions.', error);
        writeJson(request, response, 502, {
          error: 'Admin contributions could not be loaded.'
        });
      }
      return true;
    }

    if (
      routeMatches(
        request.url,
        '/admin/contributions.csv',
        '/api/admin/contributions.csv'
      )
    ) {
      response.setHeader('Cache-Control', 'private, no-store');
      if (!ensureAdminAccess(request, response)) {
        return true;
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        writeJson(request, response, 405, {
          error: 'Private exports require a confirmed POST selection.'
        });
        return true;
      }
      if (
        request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !==
        'application/json'
      ) {
        writeJson(request, response, 415, {
          error: 'A JSON export selection is required.'
        });
        return true;
      }
      let input: unknown;
      try {
        input = JSON.parse(await readBody(request, 64 * 1024));
      } catch {
        writeJson(request, response, 400, {
          error: 'Invalid export request.',
          code: 'invalid_export_selection'
        });
        return true;
      }
      try {
        const result = await exportAdminContributions(
          input,
          getAdminAuditActor(request)
        );
        response.setHeader('X-Request-Id', result.requestId);
        writeCsv(
          request,
          response,
          200,
          result.csv,
          'openg7-admin-contributions.csv'
        );
      } catch (error) {
        if (!(error instanceof ContributionExportError))
          reportFailure('Private contribution export unavailable.');
        writeJson(
          request,
          response,
          error instanceof ContributionExportError ? error.status : 503,
          {
            error: 'Admin contributions export could not be generated.',
            code:
              error instanceof ContributionExportError
                ? error.code
                : 'export_unavailable'
          }
        );
      }
      return true;
    }

    return false;
  };
};
