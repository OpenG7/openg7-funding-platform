import type { IncomingMessage, ServerResponse } from 'node:http';

import type { createHttpTransport } from '../http-transport.js';
import { isValidUuid } from '../business-helpers/request-validation.js';

interface PreflightHttpDependencies {
  publicBaseOrigin: string;
  enabled: boolean;
  ensureAdminAccess: (
    request: IncomingMessage,
    response: ServerResponse
  ) => boolean;
  writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  listPreparations: (contributionId: string) => Promise<unknown>;
  connectorStatus: () => Promise<unknown>;
}

/** Read-only proposal inspection. Business approval endpoints remain in their owning domain. */
export function createPreflightHttpHandler(deps: PreflightHttpDependencies) {
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
      !['/admin/preflight/preparations', '/admin/preflight/status'].includes(
        path
      )
    )
      return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!deps.ensureAdminAccess(request, response)) return true;
    if (request.method !== 'GET') {
      deps.writeJson(request, response, 405, {
        code: 'METHOD_NOT_ALLOWED',
        error: 'This resource is read-only.'
      });
      return true;
    }
    const allowed = path.endsWith('/preparations') ? ['sponsorshipId'] : [];
    if (
      [...url.searchParams.keys()].some(
        (key) =>
          !allowed.includes(key) || url.searchParams.getAll(key).length !== 1
      ) ||
      (path.endsWith('/preparations') &&
        !isValidUuid(url.searchParams.get('sponsorshipId')))
    ) {
      deps.writeJson(request, response, 400, {
        code: 'PREFLIGHT_INVALID_REQUEST',
        error: 'Invalid Preflight query.'
      });
      return true;
    }
    if (!deps.enabled) {
      deps.writeJson(request, response, 200, {
        enabled: false,
        connectionState: 'disabled',
        ...(path.endsWith('/preparations') ? { items: [] } : {})
      });
      return true;
    }
    try {
      const result = path.endsWith('/preparations')
        ? await deps.listPreparations(url.searchParams.get('sponsorshipId')!)
        : await deps.connectorStatus();
      deps.writeJson(request, response, 200, {
        enabled: true,
        connectionState: 'not_verified',
        authority: 'funding-platform',
        businessDecisionExecuted: false,
        ...(typeof result === 'object' && result ? result : {})
      });
    } catch {
      deps.writeJson(request, response, 503, {
        code: 'PREFLIGHT_UNAVAILABLE',
        error: 'Preflight preparations are temporarily unavailable.'
      });
    }
    return true;
  };
}
