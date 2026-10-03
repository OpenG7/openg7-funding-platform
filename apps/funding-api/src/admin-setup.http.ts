import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AdminSetupStatusResponse } from '@openg7/funding-core';

import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

export interface AdminSetupHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAuthorization: (
    request: ApiRequest,
    response: ApiResponse
  ) => boolean;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly buildAdminSetupStatus: () => Promise<AdminSetupStatusResponse>;
  readonly reportFailure: (message: string, error: unknown) => void;
}

/** Setup reads require authorization without imposing database availability. */
export const createAdminSetupHttpHandler = ({
  publicBaseOrigin,
  ensureAdminAuthorization,
  writeJson,
  buildAdminSetupStatus,
  reportFailure
}: AdminSetupHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method !== 'GET' ||
      !routeMatches(
        request.url,
        '/admin/setup-status',
        '/api/admin/setup-status'
      )
    )
      return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!ensureAdminAuthorization(request, response)) return true;
    try {
      const setupStatus = await buildAdminSetupStatus();
      writeJson(request, response, 200, setupStatus);
    } catch (error) {
      reportFailure('Failed to load admin setup status.', error);
      writeJson(request, response, 502, {
        error: 'Admin setup status could not be loaded.'
      });
    }
    return true;
  };
};
