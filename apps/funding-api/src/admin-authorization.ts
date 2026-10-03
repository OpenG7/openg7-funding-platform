import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AdminIdentityService } from './admin-identity.js';
import type { AdminSessionPayload } from './admin-token-session.js';
import type { createHttpTransport } from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

export interface AdminAuthorization {
  readonly actor: string;
  readonly source: 'session' | 'static-token' | 'local-dev' | 'oidc';
}

export interface AdminAuthorizationDependencies {
  readonly adminIdentity: Pick<
    AdminIdentityService,
    'identity' | 'permits'
  > | null;
  readonly adminTokenConfigured: boolean;
  readonly isProduction: boolean;
  readonly hasDatabase: boolean;
  readonly verifyAdminSession: (token: string) => AdminSessionPayload | null;
  readonly adminTokenMatches: (token: string) => boolean;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
}

export const readAdminToken = (request: ApiRequest): string | null => {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string') {
    const [scheme, token] = authorization.split(/\s+/, 2);
    if (scheme.toLowerCase() === 'bearer' && token) {
      return token;
    }
  }

  const headerToken = request.headers['x-funding-admin-token'];
  return typeof headerToken === 'string' ? headerToken : null;
};

/** Authorization can serve setup reads without requiring database availability. */
export const createAdminAuthorization = ({
  adminIdentity,
  adminTokenConfigured,
  isProduction,
  hasDatabase,
  verifyAdminSession,
  adminTokenMatches,
  writeJson
}: AdminAuthorizationDependencies) => {
  const resolveAdminAuthorization = (
    request: ApiRequest
  ): AdminAuthorization | null => {
    if (adminIdentity) {
      const identity = adminIdentity.identity(request);
      return identity
        ? { actor: `admin:${identity.id}`, source: 'oidc' }
        : null;
    }
    if (!adminTokenConfigured) {
      return isProduction
        ? null
        : {
            actor: 'local-dev-admin',
            source: 'local-dev'
          };
    }

    const token = readAdminToken(request);
    if (!token) {
      return null;
    }

    if (verifyAdminSession(token)) {
      return {
        actor: 'funding-admin-session',
        source: 'session'
      };
    }

    if (adminTokenMatches(token)) {
      return {
        actor: 'funding-admin-token',
        source: 'static-token'
      };
    }

    return null;
  };

  const isAdminAuthorized = (request: ApiRequest): boolean => {
    return Boolean(resolveAdminAuthorization(request));
  };

  const ensureAdminAuthorization = (
    request: ApiRequest,
    response: ApiResponse
  ): boolean => {
    if (!adminIdentity && !adminTokenConfigured && isProduction) {
      writeJson(request, response, 503, {
        error: 'Admin review is not configured.'
      });
      return false;
    }

    if (
      adminIdentity &&
      adminIdentity.identity(request) &&
      !adminIdentity.permits(request)
    ) {
      writeJson(request, response, 403, {
        error: 'This action is not permitted for this account or origin.'
      });
      return false;
    }
    if (!isAdminAuthorized(request)) {
      writeJson(request, response, 401, {
        error: 'Admin authorization is required.'
      });
      return false;
    }

    return true;
  };

  const ensureAdminAccess = (
    request: ApiRequest,
    response: ApiResponse
  ): boolean => {
    if (!ensureAdminAuthorization(request, response)) {
      return false;
    }

    if (!hasDatabase) {
      writeJson(request, response, 503, {
        error: 'Admin review requires DATABASE_URL and PostgreSQL migrations.'
      });
      return false;
    }

    return true;
  };

  const getAdminAuditActor = (request: ApiRequest): string =>
    resolveAdminAuthorization(request)?.actor ?? 'local-dev-admin';

  return {
    resolveAdminAuthorization,
    isAdminAuthorized,
    ensureAdminAuthorization,
    ensureAdminAccess,
    getAdminAuditActor
  };
};
