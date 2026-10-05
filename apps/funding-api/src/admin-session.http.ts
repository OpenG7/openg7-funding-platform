import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminSessionCreateRequest,
  AdminSessionResponse
} from '@openg7/funding-core';

import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

export interface AdminSessionHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly adminTokenConfigured: boolean;
  readonly isProduction: boolean;
  readonly adminTokenMatches: (token: string) => boolean;
  readonly createAdminSession: () => AdminSessionResponse | null;
  readonly readBody: (request: ApiRequest, maxBytes: number) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
}

/** Token comparison and signing stay in the configured session service. */
export const createAdminSessionHttpHandler = ({
  publicBaseOrigin,
  adminTokenConfigured,
  isProduction,
  adminTokenMatches,
  createAdminSession,
  readBody,
  writeJson
}: AdminSessionHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      request.method !== 'POST' ||
      !routeMatches(request.url, '/admin/session', '/api/admin/session')
    )
      return false;
    if (isProduction) {
      writeJson(request, response, 403, {
        error: 'OIDC admin sign-in is required in production.'
      });
      return true;
    }
    if (!adminTokenConfigured) {
      writeJson(request, response, 503, {
        error: 'Admin session is not configured.'
      });
      return true;
    }
    if (
      request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !==
      'application/json'
    ) {
      writeJson(request, response, 415, {
        error: 'Content-Type must be application/json.'
      });
      return true;
    }
    if (request.headers.origin && request.headers.origin !== publicBaseOrigin) {
      writeJson(request, response, 403, { error: 'Origin refused.' });
      return true;
    }
    let parsed: AdminSessionCreateRequest;
    try {
      const body = await readBody(request, 16 * 1024);
      parsed = JSON.parse(body) as AdminSessionCreateRequest;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Invalid admin session request body.');
    } catch {
      writeJson(request, response, 400, {
        error: 'Invalid admin session request body.'
      });
      return true;
    }
    const suppliedToken =
      typeof parsed.token === 'string' ? parsed.token.trim() : '';
    if (!adminTokenMatches(suppliedToken)) {
      writeJson(request, response, 401, {
        error: 'Admin authorization is required.'
      });
      return true;
    }
    const session = createAdminSession();
    if (!session) {
      writeJson(request, response, 503, {
        error: 'Admin session signing is not configured.'
      });
      return true;
    }
    writeJson(request, response, 200, session);
    return true;
  };
};
