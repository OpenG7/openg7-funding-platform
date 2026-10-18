import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  AdminCampaignsError,
  parseAdminCampaignsQuery
} from './admin-campaigns-query.js';
import type { AdminCampaignsService } from './admin-campaigns.service.js';
import type { createHttpTransport } from './http-transport.js';

export interface AdminCampaignsHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAccess: (
    request: IncomingMessage,
    response: ServerResponse
  ) => boolean;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly campaigns: Pick<AdminCampaignsService, 'list'> | null;
}

export function createAdminCampaignsHttpHandler(
  deps: AdminCampaignsHttpDependencies
) {
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
    if (url.pathname.replace(/^\/api(?=\/)/, '') !== '/admin/campaigns')
      return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!deps.ensureAdminAccess(request, response)) return true;
    if (request.method !== 'GET') {
      deps.writeJson(
        request,
        response,
        405,
        { code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' },
        { Allow: 'GET' }
      );
      return true;
    }
    try {
      const query = parseAdminCampaignsQuery(url.searchParams);
      if (!deps.campaigns)
        throw new AdminCampaignsError('CAMPAIGNS_UNAVAILABLE', 503);
      deps.writeJson(request, response, 200, await deps.campaigns.list(query));
    } catch (error) {
      const failure =
        error instanceof AdminCampaignsError
          ? error
          : new AdminCampaignsError('CAMPAIGNS_UNAVAILABLE', 503);
      deps.writeJson(request, response, failure.status, {
        code: failure.code,
        error:
          failure.status === 400
            ? 'Invalid campaign filters.'
            : 'Campaigns are unavailable.'
      });
    }
    return true;
  };
}
