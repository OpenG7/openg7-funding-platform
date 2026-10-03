import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AdminAuditLogResponse } from '@openg7/funding-core';

import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

export interface AdminAuditHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly ensureAdminAccess: (
    request: ApiRequest,
    response: ApiResponse
  ) => boolean;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly isValidUuid: (value: unknown) => value is string;
  readonly listAdminAuditLog: (
    entryId?: string
  ) => Promise<AdminAuditLogResponse>;
  readonly reportFailure: (message: string, error: unknown) => void;
}

export const createAdminAuditHttpHandler = ({
  publicBaseOrigin,
  ensureAdminAccess,
  writeJson,
  isValidUuid,
  listAdminAuditLog,
  reportFailure
}: AdminAuditHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method !== 'GET' ||
      !routeMatches(request.url, '/admin/audit-log', '/api/admin/audit-log')
    )
      return false;
    if (!ensureAdminAccess(request, response)) return true;
    try {
      const entryId = new URL(
        request.url ?? '/',
        'http://localhost'
      ).searchParams.get('entryId');
      response.setHeader('Cache-Control', 'no-store');
      if (entryId !== null && !isValidUuid(entryId)) {
        writeJson(request, response, 400, { error: 'Invalid entryId.' });
        return true;
      }
      const result = await listAdminAuditLog(entryId ?? undefined);
      writeJson(request, response, 200, result);
    } catch (error) {
      reportFailure('Failed to load admin audit log.', error);
      writeJson(request, response, 502, {
        error: 'Admin audit log could not be loaded.'
      });
    }
    return true;
  };
};
