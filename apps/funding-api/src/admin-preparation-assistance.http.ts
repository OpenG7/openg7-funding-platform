import type { IncomingMessage, ServerResponse } from 'node:http';

import { isValidUuid } from './business-helpers/request-validation.js';
import { firstHeaderValue, isJsonContentType } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';
import { PreparationAssistanceError } from './preparation-assistance/errors.js';
import type { PreparationAssistanceService } from './preparation-assistance/service.js';

interface PreparationAssistanceHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAccess: (
    request: IncomingMessage,
    response: ServerResponse
  ) => boolean;
  readonly canOwn: (request: IncomingMessage) => boolean;
  readonly getAdminAuditActor: (request: IncomingMessage) => string;
  readonly readBody: (
    request: IncomingMessage,
    maxBytes?: number
  ) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly assistance: Pick<
    PreparationAssistanceService,
    'read' | 'summary' | 'saveSource' | 'enqueue' | 'review' | 'apply'
  > | null;
}

/** Agreement text and compact workflow observations are owner-only on every route. */
export function createAdminPreparationAssistanceHttpHandler(
  deps: PreparationAssistanceHttpDependencies
) {
  const base = '/admin/preparation-assistance';
  const actions = ['/source', '/runs', '/review', '/apply'];
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
    const summaryPath = base + '/summary';
    if (
      path !== base &&
      path !== summaryPath &&
      !actions.some((action) => path === base + action)
    )
      return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!deps.ensureAdminAccess(request, response)) return true;
    if (!deps.canOwn(request)) {
      deps.writeJson(request, response, 403, { code: 'ADMIN_ROLE_FORBIDDEN' });
      return true;
    }
    try {
      const reading =
        (path === base || path === summaryPath) && request.method === 'GET';
      if (
        !reading &&
        (request.method !== 'POST' || path === base || path === summaryPath)
      ) {
        deps.writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
        return true;
      }
      const compactRun =
        path === base + '/runs' && url.searchParams.get('view') === 'summary';
      const allowed = reading
        ? ['contributionId']
        : path === base + '/runs'
          ? ['view']
          : [];
      if (
        [...url.searchParams.keys()].some(
          (key) =>
            !allowed.includes(key) || url.searchParams.getAll(key).length !== 1
        ) ||
        (reading && !isValidUuid(url.searchParams.get('contributionId'))) ||
        (!reading && url.searchParams.has('view') && !compactRun)
      ) {
        deps.writeJson(request, response, 400, { code: 'ASSISTANCE_INVALID' });
        return true;
      }
      if (!deps.assistance) {
        deps.writeJson(request, response, 503, {
          code: 'ASSISTANCE_UNAVAILABLE'
        });
        return true;
      }
      if (reading) {
        const contributionId = url.searchParams.get('contributionId')!;
        const state =
          path === summaryPath
            ? await deps.assistance.summary(contributionId)
            : await deps.assistance.read(contributionId);
        deps.writeJson(request, response, 200, state);
        return true;
      }
      if (
        !isJsonContentType(
          firstHeaderValue(request.headers['content-type']) ?? undefined
        )
      ) {
        deps.writeJson(request, response, 415, { code: 'JSON_REQUIRED' });
        return true;
      }
      let input: unknown;
      try {
        input = JSON.parse(await deps.readBody(request, 96 * 1024));
      } catch {
        deps.writeJson(request, response, 400, { code: 'ASSISTANCE_INVALID' });
        return true;
      }
      const actor = deps.getAdminAuditActor(request);
      const state =
        path === base + '/source'
          ? await deps.assistance.saveSource(input, actor)
          : path === base + '/runs'
            ? await deps.assistance.enqueue(input, actor)
            : path === base + '/review'
              ? await deps.assistance.review(input, actor)
              : await deps.assistance.apply(input, actor);
      deps.writeJson(
        request,
        response,
        200,
        compactRun ? await deps.assistance.summary(state.contributionId) : state
      );
    } catch (error) {
      const known = error instanceof PreparationAssistanceError;
      deps.writeJson(request, response, known ? error.status : 503, {
        code: known ? error.code : 'ASSISTANCE_UNAVAILABLE'
      });
    }
    return true;
  };
}
