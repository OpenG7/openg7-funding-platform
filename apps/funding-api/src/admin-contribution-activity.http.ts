import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ContributionActivityService } from './contribution-activity.service.js';
import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

export interface AdminContributionActivityHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAccess: (
    request: ApiRequest,
    response: ApiResponse
  ) => boolean;
  readonly getAdminAuditActor: (request: ApiRequest) => string;
  readonly readBody: (
    request: ApiRequest,
    maxBytes?: number
  ) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly contributionActivity: Pick<
    ContributionActivityService,
    'list' | 'claimPresentation'
  > | null;
}

/** Presentation claims remain actor-scoped and idempotent in the service. */
export const createAdminContributionActivityHttpHandler = ({
  publicBaseOrigin,
  ensureAdminAccess,
  getAdminAuditActor,
  readBody,
  writeJson,
  contributionActivity
}: AdminContributionActivityHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      routeMatches(
        request.url,
        '/admin/contribution-activity/present',
        '/api/admin/contribution-activity/present'
      )
    ) {
      if (!ensureAdminAccess(request, response)) return true;
      if (request.method !== 'POST') {
        writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
        return true;
      }
      try {
        const input = JSON.parse(await readBody(request)) as { ids?: unknown };
        const result = await contributionActivity!.claimPresentation(
          input?.ids,
          getAdminAuditActor(request)
        );
        writeJson(request, response, 200, result);
      } catch (error) {
        writeJson(
          request,
          response,
          error instanceof RangeError || error instanceof SyntaxError
            ? 400
            : 503,
          { code: 'ACTIVITY_PRESENTATION_FAILED' }
        );
      }
      return true;
    }
    if (
      routeMatches(
        request.url,
        '/admin/contribution-activity',
        '/api/admin/contribution-activity'
      )
    ) {
      if (!ensureAdminAccess(request, response)) return true;
      if (request.method !== 'GET') {
        writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
        return true;
      }
      try {
        const params = new URL(request.url ?? '/', publicBaseOrigin)
          .searchParams;
        const result = await contributionActivity!.list({
          ...(params.has('before') ? { before: params.get('before')! } : {}),
          ...(params.has('after') ? { after: params.get('after')! } : {}),
          ...(params.has('id') ? { id: params.get('id')! } : {})
        });
        writeJson(request, response, 200, result);
      } catch (error) {
        writeJson(request, response, error instanceof RangeError ? 400 : 503, {
          code:
            error instanceof RangeError
              ? 'INVALID_ACTIVITY_CURSOR'
              : 'ACTIVITY_UNAVAILABLE'
        });
      }
      return true;
    }
    return false;
  };
};
