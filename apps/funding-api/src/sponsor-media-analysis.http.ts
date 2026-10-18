import type { IncomingMessage, ServerResponse } from 'node:http';

import { isValidUuid } from './business-helpers/request-validation.js';
import { firstHeaderValue, isJsonContentType } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';
import {
  SponsorMediaAnalysisError,
  type SponsorMediaAnalysisService
} from './sponsor-media-analysis/service.js';

export interface SponsorMediaAnalysisHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAccess: (
    request: IncomingMessage,
    response: ServerResponse
  ) => boolean;
  /** Checks private analysis reads as well as commands; the assistant receives no mutation port. */
  readonly canReview: (request: IncomingMessage) => boolean;
  readonly getAdminAuditActor: (request: IncomingMessage) => string;
  readonly readBody: (
    request: IncomingMessage,
    maxBytes?: number
  ) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly mediaAnalysis: Pick<
    SponsorMediaAnalysisService,
    'read' | 'start' | 'review' | 'receipt'
  > | null;
}
export function createSponsorMediaAnalysisHttpHandler(
  deps: SponsorMediaAnalysisHttpDependencies
) {
  const base = '/admin/sponsorships/media/analyses';
  return async (
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<boolean> => {
    let url: URL;
    try {
      url = new URL(request.url ?? '/', deps.publicBaseOrigin);
    } catch {
      return false;
    }
    const path = url.pathname.replace(/^\/api(?=\/)/, '');
    if (
      path !== base &&
      path !== base + '/review' &&
      path !== base + '/receipt'
    )
      return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!deps.ensureAdminAccess(request, response)) return true;
    if (!deps.canReview(request)) {
      deps.writeJson(request, response, 403, {
        code: 'MEDIA_ANALYSIS_REVIEWER_REQUIRED'
      });
      return true;
    }
    try {
      const reading =
        request.method === 'GET' &&
        (path === base || path === base + '/receipt');
      const receipt = path === base + '/receipt';
      if (!reading && (request.method !== 'POST' || receipt)) {
        deps.writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
        return true;
      }
      if (
        reading
          ? [...url.searchParams.keys()].length !== (receipt ? 2 : 1) ||
            url.searchParams.getAll('contributionId').length !== 1 ||
            !isValidUuid(url.searchParams.get('contributionId')) ||
            (receipt &&
              (url.searchParams.getAll('requestId').length !== 1 ||
                !isValidUuid(url.searchParams.get('requestId'))))
          : url.search.length > 0
      )
        throw new SponsorMediaAnalysisError('MEDIA_ANALYSIS_INVALID', 400);
      if (!deps.mediaAnalysis)
        throw new SponsorMediaAnalysisError('MEDIA_ANALYSIS_UNAVAILABLE', 503);
      if (reading) {
        deps.writeJson(
          request,
          response,
          200,
          receipt
            ? await deps.mediaAnalysis.receipt(
                url.searchParams.get('contributionId')!,
                url.searchParams.get('requestId')!,
                deps.getAdminAuditActor(request)
              )
            : await deps.mediaAnalysis.read(
                url.searchParams.get('contributionId')!
              )
        );
        return true;
      }
      if (
        !isJsonContentType(
          firstHeaderValue(request.headers['content-type']) ?? undefined
        )
      )
        throw new SponsorMediaAnalysisError('JSON_REQUIRED', 415);
      let input: unknown;
      try {
        input = JSON.parse(await deps.readBody(request, 8 * 1024));
      } catch {
        throw new SponsorMediaAnalysisError('MEDIA_ANALYSIS_INVALID', 400);
      }
      const actor = deps.getAdminAuditActor(request);
      deps.writeJson(
        request,
        response,
        200,
        path === base
          ? await deps.mediaAnalysis.start(input, actor)
          : await deps.mediaAnalysis.review(input, actor)
      );
    } catch (error) {
      deps.writeJson(
        request,
        response,
        error instanceof SponsorMediaAnalysisError ? error.status : 503,
        {
          code:
            error instanceof SponsorMediaAnalysisError
              ? error.code
              : 'MEDIA_ANALYSIS_UNAVAILABLE'
        }
      );
    }
    return true;
  };
}
