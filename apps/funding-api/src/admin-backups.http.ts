import type { IncomingMessage, ServerResponse } from 'node:http';

import type {
  AdminBackupsResponse,
  AdminDatabaseBackup
} from '@openg7/funding-core';

import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

/** Acceptance queues the audited job; capture and storage remain worker-owned. */
export interface AdminBackupsHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly allowedOrigins: readonly string[];
  readonly databaseAvailable: () => boolean;
  readonly ensureAdminAccess: (
    request: ApiRequest,
    response: ApiResponse
  ) => boolean;
  readonly resolveAdminAuthorization: (
    request: ApiRequest
  ) => { readonly source: string } | null;
  readonly getAdminAuditActor: (request: ApiRequest) => string;
  readonly readBody: (request: ApiRequest, maxBytes: number) => Promise<string>;
  readonly writeJson: ReturnType<typeof createHttpTransport>['writeJson'];
  readonly isBackupId: (value: unknown) => value is string;
  readonly BackupError: new (
    code: string,
    status?: number
  ) => Error & { readonly code: string; readonly status: number };
  readonly backupStatus: (requestId?: string) => Promise<AdminBackupsResponse>;
  readonly requestBackup: (
    requestId: string,
    actor: string
  ) => Promise<AdminDatabaseBackup | null>;
}

export const createAdminBackupsHttpHandler = ({
  publicBaseOrigin,
  allowedOrigins,
  databaseAvailable,
  ensureAdminAccess,
  resolveAdminAuthorization,
  getAdminAuditActor,
  readBody,
  writeJson,
  isBackupId,
  BackupError,
  backupStatus,
  requestBackup
}: AdminBackupsHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (!routeMatches(request.url, '/admin/backups', '/api/admin/backups'))
      return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!ensureAdminAccess(request, response) || !databaseAvailable())
      return true;
    if (
      !['oidc', 'session'].includes(
        resolveAdminAuthorization(request)?.source ?? ''
      )
    ) {
      writeJson(request, response, 401, { code: 'ADMIN_SESSION_REQUIRED' });
      return true;
    }
    if (
      request.method === 'POST' &&
      request.headers.origin &&
      ![publicBaseOrigin, ...allowedOrigins].includes(request.headers.origin)
    ) {
      writeJson(request, response, 403, { code: 'ORIGIN_FORBIDDEN' });
      return true;
    }
    try {
      if (request.method === 'GET') {
        const id = new URL(
          request.url ?? '/',
          publicBaseOrigin
        ).searchParams.get('requestId');
        if (id !== null && !isBackupId(id))
          throw new BackupError('INVALID_BACKUP_REQUEST', 400);
        writeJson(request, response, 200, await backupStatus(id ?? undefined));
      } else if (request.method === 'POST') {
        if (
          request.headers['content-type']
            ?.split(';')[0]
            .trim()
            .toLowerCase() !== 'application/json'
        )
          throw new BackupError('INVALID_BACKUP_REQUEST', 415);
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(await readBody(request, 2048));
          if (
            !input ||
            Array.isArray(input) ||
            !isBackupId(input.requestId) ||
            Object.keys(input).some(
              (key) => !['requestId', 'confirmation'].includes(key)
            )
          )
            throw new Error();
        } catch {
          throw new BackupError('INVALID_BACKUP_REQUEST', 400);
        }
        if (input.confirmation !== 'BACKUP_DATABASE')
          throw new BackupError('CONFIRMATION_REQUIRED', 400);
        const job = await requestBackup(
          input.requestId as string,
          getAdminAuditActor(request)
        );
        writeJson(request, response, 202, job);
      } else {
        response.setHeader('Allow', 'GET, POST');
        writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
      }
    } catch (error) {
      writeJson(
        request,
        response,
        error instanceof BackupError ? error.status : 503,
        {
          code: error instanceof BackupError ? error.code : 'BACKUP_UNAVAILABLE'
        }
      );
    }
    return true;
  };
};
