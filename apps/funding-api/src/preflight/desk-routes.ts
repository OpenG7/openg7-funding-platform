import type { IncomingMessage, ServerResponse } from 'node:http';

import type { createHttpTransport } from '../http-transport.js';

import {
  parsePreflightDeskQuery,
  PreflightDeskError,
  type PreflightDeskService
} from './desk.js';

interface Dependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAccess: (
    request: IncomingMessage,
    response: ServerResponse
  ) => boolean;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly desk: Pick<PreflightDeskService, 'list'> | null;
}

export function createPreflightDeskHttpHandler(deps: Dependencies) {
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
    if (url.pathname.replace(/^\/api(?=\/)/, '') !== '/admin/preflight/desk')
      return false;
    if (!deps.ensureAdminAccess(request, response)) return true;
    const write = (status: number, payload: unknown) =>
      deps.writeJson(request, response, status, payload, {
        'Cache-Control': 'private, no-store'
      });
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      write(405, {
        code: 'METHOD_NOT_ALLOWED',
        error: 'This resource is read-only.'
      });
      return true;
    }
    try {
      const query = parsePreflightDeskQuery(url.searchParams);
      if (!deps.desk)
        throw new PreflightDeskError('PREFLIGHT_DESK_UNAVAILABLE', 503);
      write(200, await deps.desk.list(query));
    } catch (error) {
      const failure =
        error instanceof PreflightDeskError
          ? error
          : new PreflightDeskError('PREFLIGHT_DESK_UNAVAILABLE', 503);
      write(failure.status, {
        code: failure.code,
        error:
          failure.status === 400
            ? 'Invalid desk filters.'
            : 'The operational desk is unavailable.'
      });
    }
    return true;
  };
}
