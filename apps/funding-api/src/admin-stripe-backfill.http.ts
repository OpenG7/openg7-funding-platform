import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AdminStripeBackfillService } from './admin-stripe-backfill.service.js';
import { createRouteMatcher } from './http-routing.js';
import type { createHttpTransport } from './http-transport.js';

type ApiRequest = IncomingMessage;
type ApiResponse = ServerResponse<IncomingMessage>;

/** The service retains bounded scopes, provider settlement, receipts and audit. */
export interface AdminStripeBackfillHttpDependencies {
  readonly publicBaseOrigin: string;
  readonly allowedOrigins: readonly string[];
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
  readonly adminStripeBackfill: Pick<
    AdminStripeBackfillService,
    'read' | 'preview' | 'execute'
  > | null;
  readonly AdminStripeBackfillError: new (
    status: number,
    code: string
  ) => Error & { readonly status: number; readonly code: string };
}

export const createAdminStripeBackfillHttpHandler = ({
  publicBaseOrigin,
  allowedOrigins,
  ensureAdminAccess,
  resolveAdminAuthorization,
  getAdminAuditActor,
  readBody,
  writeJson,
  adminStripeBackfill,
  AdminStripeBackfillError
}: AdminStripeBackfillHttpDependencies) => {
  const { routeMatches } = createRouteMatcher(publicBaseOrigin);
  return async (
    request: ApiRequest,
    response: ApiResponse
  ): Promise<boolean> => {
    if (
      !routeMatches(
        request.url,
        '/admin/stripe-backfill',
        '/api/admin/stripe-backfill'
      )
    )
      return false;
    response.setHeader('Cache-Control', 'private, no-store');
    if (!ensureAdminAccess(request, response)) return true;
    if (resolveAdminAuthorization(request)?.source === 'local-dev') {
      writeJson(request, response, 401, { code: 'ADMIN_SESSION_REQUIRED' });
      return true;
    }
    if (!adminStripeBackfill) {
      writeJson(request, response, 503, { code: 'BACKFILL_UNAVAILABLE' });
      return true;
    }
    const actor = getAdminAuditActor(request);
    try {
      if (request.method === 'GET') {
        const id = new URL(
          request.url ?? '/',
          publicBaseOrigin
        ).searchParams.get('id');
        writeJson(request, response, 200, {
          run: await adminStripeBackfill.read(id, actor)
        });
      } else if (request.method === 'POST') {
        if (
          request.headers.origin &&
          ![publicBaseOrigin, ...allowedOrigins].includes(
            request.headers.origin
          )
        ) {
          writeJson(request, response, 403, { code: 'ORIGIN_FORBIDDEN' });
          return true;
        }
        if (
          request.headers['content-type']?.split(';')[0].trim() !==
          'application/json'
        ) {
          writeJson(request, response, 415, { code: 'JSON_REQUIRED' });
          return true;
        }
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(await readBody(request, 4096));
          if (!input || typeof input !== 'object' || Array.isArray(input))
            throw new Error();
          const fields =
            input.action === 'preview'
              ? ['action', 'scope']
              : ['action', 'id', 'confirmation'];
          if (
            Object.keys(input).some((key) => !fields.includes(key)) ||
            !['preview', 'execute'].includes(String(input.action))
          )
            throw new Error();
        } catch {
          writeJson(request, response, 400, { code: 'INVALID_REQUEST' });
          return true;
        }
        const run =
          input.action === 'preview'
            ? await adminStripeBackfill.preview(input.scope, actor)
            : await adminStripeBackfill.execute(
                input.id,
                input.confirmation,
                actor
              );
        writeJson(request, response, 200, { run });
      } else writeJson(request, response, 405, { code: 'METHOD_NOT_ALLOWED' });
    } catch (error) {
      const known = error instanceof AdminStripeBackfillError;
      writeJson(request, response, known ? error.status : 503, {
        code: known ? error.code : 'BACKFILL_UNAVAILABLE'
      });
    }
    return true;
  };
};
